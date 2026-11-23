'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function loadLexer() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('cls-syntax-engine-unavailable: requires win32-x64');
  return require('../../../../vendor/intersystems-language-server/2.8.7/win32-x64/server/out/9b3dee7319f825c69fd409ec3d78e50f.node');
}

// Input is one command's tokens. A space terminates the condition only at depth zero.
function splitPostcondition(line, start) {
  const command = /^(?:q(?:uit)?|continue|s(?:et)?):(?=\()/i.exec(line.slice(start));
  if (!command) return;
  let depth = 0;
  let quoted = false;
  for (let i = start + command[0].length; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i+1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (ch === '(') depth++;
      if (ch === ')' && --depth === 0) {
        if (/^[ \t]+(?:&&|\|\|)/.test(line.slice(i+1))) {
          return 'enclose the complete postcondition, e.g. q:((A)||(B))';
        }
        return;
      }
    }
  }
}

const commandRules = {OS001: splitPostcondition};

function sessionAccessIssues(lines, parsed, selected) {
  const issues = [];
  let recent = [];
  parsed.forEach((tokens, row) => {
    for (const token of tokens) {
      if (token.l !== 1) { recent = []; continue; }
      recent.push({text:lines[row].slice(token.p, token.p+token.c), line:row+1, column:token.p+1});
      if (recent.length > 6) recent.shift();
      if (recent.length !== 6) continue;
      const [receiver, dot, member, open, key, delimiter] = recent;
      if (receiver.text !== '%session' || dot.text !== '.' || member.text !== 'Get' || open.text !== '(') continue;
      if (![')', ','].includes(delimiter.text)) continue;
      if (!/^"LOGON\.(?:CTLOCID|USERID)"$/.test(key.text) || !recent.some(t => selected(t.line))) continue;
      issues.push({line:receiver.line, column:receiver.column,
        message:'OS004: read login context through sessionStr or the shared session accessor'});
    }
  });
  return issues;
}

// Conditional field and parameter explanations are reviewed against the business contract.
function missingDocumentation(lines, declaration) {
  const tags = new Set();
  let continuation = false;
  for (let row = declaration.line - 2; row >= 0 && lines[row].startsWith('///'); row--) {
    const text = lines[row].slice(3).trim();
    const match = /^(Name|名称|Table|表名|Desc(?:ription)?|说明|Return|返回|Param|参数|Debug|调试|Demand|需求|Example|示例)\s*[:：]\s*(.*)$/i.exec(text);
    if (match) {
      if (match[2].trim() || continuation) tags.add(match[1].toLowerCase());
      continuation = false;
    } else if (text) continuation = true;
  }
  const requirements = [['Name', '名称']];
  if (declaration.table) requirements.push(['Table', '表名']);
  if (declaration.isClass) requirements.push(['Description', 'Desc', '说明']);
  if (declaration.returnsValue) requirements.push(['Return', '返回']);
  return requirements.filter(group => !group.some(tag => tags.has(tag.toLowerCase()))).map(group => group[0]);
}

function inspect(source, selected = () => true, baseline = '', sessionLines = selected) {
  const lexer = loadLexer();
  const attrs = lexer.GetLanguageAttributes('COS');
  const lines = source.split(/\r\n|\n|\r/);
  const parsed = lexer.Tokenize(source, 'CLS', false, 0x24001);
  const {procedureScopes, checkProcedureScopes} = require('./cls-procedure-scope');
  const udl = lexer.GetLanguageAttributes('CLS');
  const oldDeclarations = new Map(), declarations = new Map();
  const oldLines = baseline.split(/\r\n|\n|\r/);
  const oldParsed = baseline ? lexer.Tokenize(baseline, 'CLS', false, 0x24001) : [];
  const previous = procedureScopes(oldLines, oldParsed, udl, oldDeclarations);
  const current = procedureScopes(lines, parsed, udl, declarations);
  const issues = checkProcedureScopes(current, previous);
  const {namespaceIssues} = require('./cls-namespace-scope');
  const historical = new Map();
  const identity = item => JSON.stringify([item.key, item.label, item.source, !!item.manual, !!item.manualRestore, item.conditions]);
  for (const item of namespaceIssues(oldLines, oldParsed, previous, attrs)) {
    const id = identity(item);
    historical.set(id, (historical.get(id) || 0) + 1);
  }
  for (const item of namespaceIssues(lines, parsed, current, attrs)) {
    const id = identity(item);
    if (historical.get(id)) historical.set(id, historical.get(id)-1);
    else issues.push({line:item.line, column:item.column,
      ...(item.manual || item.conditional ? {status:'manual-review'} : {}),
      message:item.conditional ? 'OS008: verify the active preprocessor branches and namespace protection in the target build' : item.manual ? 'OS008: verify the calling frame and namespace restoration on each exit path' : item.manualRestore ? 'OS008: a manual ZN restore can be skipped on error; use a local call with New $Namespace and Set $Namespace' : 'OS008: isolate the temporary switch in a called local context; New $Namespace must precede Set'});
  }
  for (const [key, declaration] of declarations) {
    if (oldDeclarations.has(key)) continue;
    const missing = missingDocumentation(lines, declaration);
    if (missing.length) issues.push({line:declaration.line, column:declaration.column,
      message:'OS006: ' + declaration.name + ' missing documentation: ' + missing.join(', ')});
  }
  issues.push(...sessionAccessIssues(lines, parsed, sessionLines));
  for (const [key, method] of current) {
    if (previous.has(key) || method.bodyStart === undefined) continue;
    for (let row = method.bodyStart; row < method.bodyEnd; row++) {
      const dots = parsed[row].find(t => t.l === 1 && attrs[t.s] === 'Dots');
      if (dots) issues.push({line:row+1, column:dots.p+1,
        message:'OS003: use a brace block { } instead of dot indentation in new method ' + method.name});
    }
  }
  parsed.forEach((tokens, row) => {
    if (!selected(row + 1)) return;
    const line = lines[row];
    // Some legacy method bodies arrive as a single neutral COS token.
    // Only retry an explicit command at the start of such a line.
    const commands = tokens.filter(token => token.l === 1 && attrs[token.s] === 'Command').map(token => token.p);
    if (tokens.length === 1 && tokens[0].l === 1 && attrs[tokens[0].s] === 'Neutral') {
      const prefix = /^\s*(?:\.\s*)*/.exec(line)[0];
      commands.push(prefix.length);
    }
    for (const start of commands) {
      for (const [id, rule] of Object.entries(commandRules)) {
        const message = rule(line, start);
        if (message) issues.push({line:row+1, column:start+1, message:id + ': ' + message});
      }
    }
    for (const token of tokens) {
      if (token.l === 1 && attrs[token.s] === 'Error') {
        issues.push({line:row+1, column:token.p+1, message:token.e || 'ObjectScript syntax error'});
      }
    }
  });
  return issues;
}

function stagedFiles(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(item => {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) return stagedFiles(file);
    return item.isFile() ? [file] : [];
  });
}

function reviewFiles(changes, originals, paths) {
  const binding = [];
  const digest = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const output = [];
  const manual = [];
  for (const relative of paths.map(name => name.split(path.sep).join('/')).sort()) {
    const file = path.join(changes,relative), before = path.join(originals,relative);
    const current = fs.readFileSync(file), original = fs.readFileSync(before);
    if (original.equals(current)) continue;
    binding.push([relative,digest(original),digest(current)]);
    if (!/\.cls$/i.test(relative)) continue;
    const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--text', '-U0', '--', before, file], {encoding:'utf8', windowsHide:true, maxBuffer:64*1024*1024});
    if (diff.status !== 1) throw new Error('cls-gate-diff-failed: ' + relative);
    const ranges = [...diff.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
      .map(match => [Number(match[1]), Number(match[2] ?? 1)]);
    const issues = inspect(current.toString('utf8'), n => ranges.some(([start,count]) => n >= start && n < start+count), original.toString('utf8'));
    for (const issue of issues) {
      const message = relative + ':' + issue.line + ':' + issue.column + ' ' + issue.message;
      if (issue.status === 'manual-review') manual.push(message);
      else output.push(message);
    }
  }
  if (output.length) throw new Error(output.join('\n'));
  return {manual, changed:binding.map(row => row[0]), token:digest(JSON.stringify([binding, manual]))};
}

function readReview(baseline, token) {
  const file = path.join(baseline,'source-review.json');
  const receipt = fs.existsSync(file) && JSON.parse(fs.readFileSync(file,'utf8'));
  return receipt.token === token ? receipt : {token};
}

function reviewRequirements(review,kind,receipt) {
  const pending = [];
  if (review.manual.length && !receipt.os008?.trim()) pending.push('OS008-review-required: '+review.manual.join('\n'));
  if (kind === 'standard' && review.changed.length &&
      (!['passed','no-visible-impact'].includes(receipt.i18n?.result) || !receipt.i18n.evidence?.trim())) pending.push('i18n-review-required');
  return pending;
}

if (require.main === module) {
  try {
    const changes = path.join(process.argv[2],'changes');
    const paths = stagedFiles(changes).map(file => path.relative(changes,file));
    const review = reviewFiles(changes,path.join(process.argv[2],'rollback'),paths);
    const kind = process.argv[4];
    if (!['standard','project'].includes(kind)) throw new Error('explicit-demand-kind-required');
    const receipt = readReview(process.argv[3], review.token);
    const pending = reviewRequirements(review,kind,receipt);
    if (pending.length) throw new Error(pending.join('\n'));
    if (review.manual.length) console.log([...review.manual,receipt.os008].join('\n'));
    if (kind === 'standard') console.log('i18n '+receipt.i18n.result+' '+receipt.i18n.evidence);

  }
  catch (error) { console.error('cls-delivery-blocked: ' + error.message); process.exitCode = 1; }
}
module.exports = {inspect, commandRules, reviewFiles, readReview, reviewRequirements};
