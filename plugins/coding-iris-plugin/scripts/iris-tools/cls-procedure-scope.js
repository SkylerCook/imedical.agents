'use strict';

// Read declaration metadata from UDL tokens, excluding method bodies and comments.
function procedureScopes(lines, parsed, attributes, declarations = new Map()) {
  const scopes = new Map();
  let header;
  let className;
  let classEnabled = true;
  let classLanguage = 'objectscript';
  let body;
  function finish(row, delimiter) {
    const name = header.name.join('');
    const isClass = header.kind === 'class';
    if (isClass) {
      className = name;
      classEnabled = header.enabled ?? true;
      classLanguage = header.language ?? 'objectscript';
    }
    const language = header.language ?? classLanguage;
    const key = isClass ? 'class:' + name : 'method:' + className + ':' + name;
    const isField = ['property', 'relationship'].includes(header.kind);
    const identity = isField ? 'field:' + className + ':' + name : key;
    declarations.set(identity, {name, line:header.line, column:header.column, isClass,
      returnsValue:!isClass && !isField && header.returnType && !/^%?(?:Library\.)?void$/i.test(header.returnType),
      table:isClass && header.persistent});
    if (!isField && (isClass || language === 'objectscript')) {
      const scope = {disabled: !(header.enabled ?? classEnabled), explicit:header.enabled === false,
        bareMethod:!isClass && header.bareProcedureBlock,
        line:header.line, column:header.column, name, isClass};
      scopes.set(key, scope);
      if (!isClass && delimiter === '{') {
        scope.bodyStart = row;
        scope.bodyEnd = parsed.length;
        body = scope;
      }
    }
    header = undefined;
  }
  parsed.forEach((tokens, row) => {
    const parts = tokens.filter(t => t.l === 3 && !/comment/i.test(attributes[t.s]))
      .map(t => ({text:lines[row].slice(t.p,t.p+t.c), type:attributes[t.s], column:t.p+1}));
    for (const [i, part] of parts.entries()) {
      const word = part.text.toLowerCase();
      if (body && word === '}' && part.type === 'Delimiter') {
        body.bodyEnd = row;
        body = undefined;
      }
      if (!header && i === 0 && part.type === 'Keyword' && /^(class|classmethod|method|clientmethod|property|relationship)$/.test(word)) {
        header = {kind:word, name:[], naming:true, depth:0, keywords:[], line:row+1, column:part.column};
        continue;
      }
      if (!header) continue;
      if (header.naming && (part.type === 'Class Name' || part.type === 'Identifier')) {
        header.name.push(part.text);
        continue;
      }
      header.naming = false;
      if (header.kind === 'class' && !header.inKeywords) {
        header.superName = part.type === 'Class Name' ? (header.superName || '') + word : '';
        if (['%persistent', '%library.persistent'].includes(header.superName)) header.persistent = true;
      }
      if (part.type === 'Keyword' && word === 'sqltablename') header.persistent = true;
      if (!header.inKeywords) {
        if (header.expectReturn && part.type === 'Class Name') {
          header.returnType = (header.returnType || '') + part.text;
        } else {
          header.expectReturn = header.paramsClosed && part.type === 'Keyword' && word === 'as';
        }
        if (part.type === 'Delimiter') {
          for (const ch of word) {
            if (ch === '(') header.depth++;
            if (ch === ')' && --header.depth === 0) header.paramsClosed = true;
          }
        }
      }
      if (word === '[') header.inKeywords = true;
      if (word === ']') header.inKeywords = false;
      if (header.inKeywords) header.keywords.push(part);
      if (word !== '{' && word !== ';') continue;
      const kw = header.keywords;
      for (const [j,k] of kw.entries()) {
        if (k.type !== 'Keyword') continue;
        if (/^procedureblock$/i.test(k.text)) {
          header.bareProcedureBlock = kw[j+1]?.text !== '=' && !/^not$/i.test(kw[j-1]?.text);
          header.enabled = !(/^not$/i.test(kw[j-1]?.text) ||
            (kw[j+1]?.text === '=' && kw[j+2]?.text === '0'));
        }
        if (/^language$/i.test(k.text) && kw[j+1]?.text === '=') {
          header.language = kw[j+2]?.text.replace(/^"|"$/g,'').toLowerCase();
        }
      }
      finish(row, word);
    }
  });
  return scopes;
}

function checkProcedureScopes(current, baseline) {
  const issues = [];
  for (const [key, scope] of current) {
    const previous = baseline.get(key);
    if (scope.bareMethod && !previous?.bareMethod) {
      issues.push({line:scope.line, column:scope.column, message:'OS002: ' + scope.name + ' must specify [ ProcedureBlock = 1 ] on the method'});
    }
    if (!scope.disabled || (previous?.disabled && (!scope.explicit || previous.explicit))) continue;
    issues.push({line:scope.line, column:scope.column, message:'OS002: ' + scope.name +
      (scope.isClass ? ' must enable ProcedureBlock by default' : ' must use a procedure block; specify [ ProcedureBlock = 1 ] when the class default is disabled')});
  }
  return issues;
}

module.exports = {procedureScopes, checkProcedureScopes};
