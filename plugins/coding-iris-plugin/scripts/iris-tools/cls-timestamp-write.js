'use strict';

const timestamp = /^%(?:Library\.)?(?:DateTime|TimeStamp)$/i;
const local = /^[%A-Za-z][\w]*$/;
const compact = tokens => tokens.map(token => token.text).join('');
const word = (token, name) => token?.text.toLowerCase() === name;

function splitList(tokens) {
  const result = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.text === ',' && depth === 0) result.push([]);
    else result.at(-1).push(token);
    if (token.text === '(') depth++;
    if (token.text === ')') depth--;
  }
  return result;
}

// Class and property declarations are local evidence. Never infer a foreign
// column type from its spelling or from a similarly named local property.
function metadata(rows) {
  const fields = new Map(), columns = new Map();
  let table, shared, persistent, className;
  for (const row of rows) {
    const text = row.filter(t => t.lang === 3).map(t => t.text).join(' ').replace(/\s*\.\s*/g,'.');
    const cls = /^Class ([\w.]+) Extends (.*)/i.exec(text);
    if (cls) {
      className = cls[1];
      shared = /^DHCDoc\.Util\.RegisteredObject(?:\s*\[|$)/i.test(cls[2]);
      persistent = /%(?:Library\.)?Persistent\b/i.test(cls[2]);
      const names = cls[1].split('.');
      const short = names.pop();
      table = [...(names.length ? [names.join('_')] : []), /\bSqlTableName\s*=\s*(\w+)/i.exec(text)?.[1] || short].join('.').toLowerCase();
    }
    const field = /^Property (\w+) As ([%.\w]+)/i.exec(text);
    if (field) {
      const type = timestamp.test(field[2]) ? true : /^%(?:Library\.)?(?:String|Integer|Numeric|Boolean|Date|Time)$/i.test(field[2]) ? false : undefined;
      fields.set(field[1],type);
      columns.set((/\bSqlFieldName\s*=\s*(\w+)/i.exec(text)?.[1] || field[1]).toLowerCase(),type);
    }
  }
  return {fields,columns,table,persistent,shared,className};
}

function classify(expr, vars, meta, overrides) {
  if (expr.length === 1 && vars.has(expr[0].text)) return vars.get(expr[0].text);
  const value = compact(expr);
  if (/^##class\(%(?:Library\.)?(?:DateTime|TimeStamp)\)\.(?:DisplayToLogical|OdbcToLogical)\([%\w]+\)$/i.test(value)) return 'logical';
  if (/^\$z(?:dt|datetime)\([^(),]+,3(?:,1)?\)$/i.test(value)) return 'logical';
  if (/^"(?:\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?|)"$/.test(value)) return 'logical';
  const parts = value.split('_');
  const types = parts.map(part => {
    if (part === '" "') return 'space';
    const call = /^\.\.(%Z[DT])\(([%\w]+)(?:,(\d+))?\)$/i.exec(part);
    if (/^##class\(websys\.Conversions\)\.DateLogicalToHtml\([%\w]+\)$/i.test(part)) return 'display';
    if (!call || !meta.shared || overrides.has(call[1].toUpperCase())) return 'unknown';
    if (!call[3]) return call[1].toUpperCase() === '%ZD' ? 'display' : 'candidate';
    return call[3] === (call[1].toUpperCase() === '%ZD' ? '3' : '1') ? call[1].toUpperCase() : 'unknown';
  });
  if (types.includes('display') && !types.includes('unknown')) return 'display';
  if (types.join(',') === '%ZD,space,%ZT') return 'logical';
  if (expr.some(t => t.type === 'Object member' && /^%Z[DT]$/i.test(t.text) ||
      ['Local variable','Parameter'].includes(t.type) && ['display','candidate'].includes(vars.get(t.text)))) return 'candidate';
  return 'unknown';
}

function sqlWrites(tokens, consume) {
  const update = /^update$/i.test(tokens[0]?.text);
  const insert = /^insert$/i.test(tokens[0]?.text);
  if (!update && !insert) return;
  const set = tokens.findIndex(t=>word(t,'set'));
  const open = tokens.findIndex(t=>t.text === '(');
  const values = tokens.findIndex(t=>word(t,'values'));
  const hosts = tokens.filter(t=>t.type === 'Host variable name');
  const handled = new Set();
  function bind(table,column,rhs) {
    const inputs = rhs.filter(t=>hosts.includes(t));
    for (const input of inputs) {
      consume(table,column,input,rhs.length === 1);
      handled.add(input);
    }
  }
  if (update && set > 1) {
    const where = tokens.findIndex(t=>word(t,'where'));
    const table = compact(tokens.slice(1,set));
    for (const assignment of splitList(tokens.slice(set+1,where < 0 ? undefined : where))) {
      if (assignment[1]?.text === '=') bind(table,assignment[0].text,assignment.slice(2));
    }
    if (where >= 0) for (const token of tokens.slice(where)) handled.add(token);
  } else if (insert && word(tokens[1],'into') && open > 2 && values > open && tokens[values+1]?.text === '(') {
    const columns = splitList(tokens.slice(open+1,values-1));
    const args = splitList(tokens.slice(values+2,-1));
    if (columns.length === args.length) args.forEach((rhs,i)=>bind(compact(tokens.slice(2,open)),compact(columns[i]),rhs));
  }
  for (const input of hosts) if (!handled.has(input)) consume('',null,input,false);
}

function sourceRows(lines, parsed, lexer) {
  const attrs = {1:lexer.GetLanguageAttributes('COS'),2:lexer.GetLanguageAttributes('SQL'),3:lexer.GetLanguageAttributes('CLS')};
  return parsed.map((row,i)=>row.filter(t=>attrs[t.l]).map(t=>({
    text:lines[i].slice(t.p,t.p+t.c),type:attrs[t.l][t.s],lang:t.l,line:i+1,column:t.p+1
  })).filter(t=>!/comment/i.test(t.type)));
}

function timestampSchema(source,lexer) {
  const lines = source.split(/\r\n|\n|\r/);
  return metadata(sourceRows(lines,lexer.Tokenize(source,'CLS',false,0x24001),lexer));
}

function timestampIssues(lines, parsed, methods, lexer, tables) {
  const rows = sourceRows(lines,parsed,lexer);
  const meta = metadata(rows);
  const classes = new Map();
  for (const schema of tables?.values() || []) if (schema) classes.set(schema.className,schema);
  classes.set(meta.className,meta);
  const overrides = new Set([...methods.values()].filter(m=>!m.isClass).map(m=>m.name.toUpperCase()));
  const issues = [];
  for (const [key,method] of methods) {
    if (method.bodyStart === undefined) continue;
    const vars = new Map();
    const objects = new Map();
    const origins = new Map();
    let sql = [], depth = 0, conditionalDepth = 0;
    function check(type,source,token,target,direct,origin) {
      if (type === false || source === 'logical' || type === undefined && !['display','candidate'].includes(source)) return;
      const hard = direct && type === true && source === 'display';
      issues.push({key,target,origin,line:token.line,column:token.column,source:lines[token.line-1].trim(),
        status:hard?'fail':'manual-review', message:hard?'OS009: display-formatted value written to timestamp '+target:
          'OS009: verify timestamp type, value source and conversion at '+target});
    }
    for (let i=method.bodyStart;i<method.bodyEnd;i++) {
      const row = rows[i];
      if (row[0]?.type === 'Pre-Processor Command') {
        if (/^if(?:def|ndef|undef)?$/i.test(row[1]?.text)) conditionalDepth++;
        if (word(row[1],'endif')) conditionalDepth = Math.max(0,conditionalDepth-1);
        continue;
      }
      for (const [j,t] of row.entries()) {
        if (t.lang === 2) {sql.push(t); continue;}
        if (t.type === 'Embedding close' && sql.length) {
          sqlWrites(sql,(table,column,input,direct)=>{
            const name = table.toLowerCase();
            const schema = meta.persistent && name === meta.table ? meta : tables?.get(name);
            check(schema?.columns.get(column?.toLowerCase()), vars.get(input.text.slice(1)) || 'unknown',input,[table,column].filter(Boolean).join('.') || 'SQL write',direct,origins.get(input.text.slice(1)));
          });
          sql=[];
        }
        if (t.type === 'Brace') depth = Math.max(0,depth+(t.text === '{' ? 1 : -1));
        if (t.lang !== 1 || t.type !== 'Command' || !/^(?:s|set)$/i.test(t.text)) continue;
        let tail = row.slice(j+1);
        const postconditional = tail[0]?.text === ':';
        if (postconditional) {
          const start = tail.findIndex((v,k)=>k && v.column > tail[k-1].column+tail[k-1].text.length);
          tail = start < 0 ? [] : tail.slice(start);
        }
        const end = tail.findIndex(v=>v.type === 'Command' || v.type === 'Brace');
        for (const assignment of splitList(tail.slice(0,end < 0 ? undefined : end))) {
          const eq = assignment.findIndex(v=>v.text === '=');
          if (eq < 1) continue;
          const lhs = compact(assignment.slice(0,eq));
          const rhs = assignment.slice(eq+1);
          const source = classify(rhs,vars,meta,overrides);
          const origin = rhs.length === 1 && origins.has(rhs[0].text) ? origins.get(rhs[0].text) : compact(rhs);
          if (local.test(lhs)) {
            const object = /^##class\(([%.\w]+)\)\.%(?:New|OpenId)\(/i.exec(compact(rhs));
            if (object && !depth && !j && !conditionalDepth && !postconditional) objects.set(lhs,classes.get(object[1]));
            else objects.delete(lhs);
            origins.set(lhs,origin);
            const previous = vars.get(lhs);
            if ((depth || conditionalDepth || postconditional || j) && previous !== source) vars.set(lhs,[previous,source].some(v=>['display','candidate'].includes(v))?'candidate':'unknown');
            else vars.set(lhs,source);
          } else if (/^(?:\.\.|[%\w]+\.)\w+$/.test(lhs)) {
            const [receiver,property] = lhs.split('.');
            const fieldType = lhs.startsWith('..') ? meta.fields.get(lhs.slice(2)) : objects.get(receiver)?.fields.get(property);
            check(fieldType,source,t,lhs,true,origin);
          }
        }
      }
    }
  }
  return issues;
}
module.exports = {timestampIssues,timestampSchema};
