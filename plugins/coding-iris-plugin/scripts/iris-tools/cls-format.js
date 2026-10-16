'use strict';

// Read-only UDL boundary hints for coding. No source rewriting or commit gate.
function inspect(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (/\bLanguage\s*=\s*(?!objectscript\b)\w+/i.test(source)) return { supported: false, separators: [], lines };
  const separators = [], codeLines = [];
  let depth = 0, block = false, opened = false, closed = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (depth === 1 && /^\s*(XData|Storage)\b/i.test(line)) return { supported: false, separators: [], lines };
    if (/^\s*#/.test(line)) return { supported: false, separators: [], lines };
    if (depth === 1 && !block && line === '') {
      const start = n;
      while (n + 1 < lines.length && lines[n + 1] === '') n++;
      const previous = lines[start - 1] || '';
      const following = lines[n + 1] || '';
      if (/^(?:\}|\{)$|;\s*$/.test(previous) && /^(?:\/\/\/|(?:ClassMethod|Method|Property|Parameter|Query|Index|Relationship|ForeignKey|Trigger)\b|})/.test(following)) separators.push({ start, end: n + 1 });
      continue;
    }
    if (depth === 1 && !block && /^(?:\/\/\/|(?:ClassMethod|Method|Property|Parameter|Query|Index|Relationship|ForeignKey|Trigger)\b|})/.test(line)) {
      const previous = lines[n - 1] || '';
      if (/^(?:\}|\{)$|;\s*$/.test(previous) && !separators.some(s => s.end === n)) separators.push({ start: n, end: n });
    }
    let quote = false;
    const code = Array(line.length).fill(' '), lineDepth = depth;
    for (let p = 0; p < line.length; p++) {
      const c = line[p], next = line[p + 1];
      if (block) { if (c === '*' && next === '/') { block = false; p++; } continue; }
      if (quote) { if (c === '"') { if (next === '"') p++; else quote = false; } continue; }
      if (c === '"') { quote = true; code[p] = '"'; continue; }
      if ((c === '/' && next === '/') || c === ';') break;
      if (c === '/' && next === '*') { block = true; p++; continue; }
      code[p] = c;
      if (c === '{') { depth++; opened = true; }
      if (c === '}') { depth--; if (depth === 0) closed = true; }
      if (depth < 0) return { supported: false, separators: [], lines };
    }
    if (quote) return { supported: false, separators: [], lines };
    if (/&(?:sql|html|js|javascript)\s*\(|\$\$\$|##(?:expression|lit|sql)\s*\(/i.test(code.join(''))) return { supported: false, separators: [], lines };
    codeLines.push({ code: code.join(''), depth: lineDepth, line: n + 1 });
  }
  return { supported: opened && closed && depth === 0 && !block, separators, lines, codeLines };
}

// Narrow lexical diagnostics, not a UDL parser or a symbol resolver.
function parameterIssues(codeLines, affected) {
  const issues = [];
  for (const { code, depth, line } of codeLines) {
    if (!affected(line, line)) continue;
    const report = (rule, status, message) => issues.push({ rule, status, line, message });
    if (depth === 1 && /^\s*Parameter\b/i.test(code)) {
      const name = /^\s*Parameter\s+([^\s=;\[]+)/i.exec(code)?.[1];
      if (!name || name.includes('"') || /[^\x00-\x7f]/.test(name)) {
        report('CLS-PARAMETER-NAME', 'manual-review', 'Check delimited, non-ASCII or incomplete Parameter declaration against the target IRIS version.');
      } else if (!/^[A-Za-z%][A-Za-z0-9]*$/.test(name)) {
        report('CLS-PARAMETER-NAME', 'fail', 'Unquoted Parameter names start with a letter or % and continue with letters or digits; use a name such as DefineCode.');
      }
    }
    if (depth < 1) continue;
    // Underscore is also concatenation: never label a reference as a syntax failure.
    for (const match of code.matchAll(/\.#([^\s,(){}+*/=<>!&|\[\]:;]*)/g)) {
      if (!/^[A-Za-z%][A-Za-z0-9]*$/.test(match[1])) {
        report('CLS-PARAMETER-REFERENCE', 'manual-review', 'Check Parameter reference spelling and declaration; underscore may be concatenation, and delimited or dynamic names need manual review.');
      }
    }
    if (/\$parameter\s*\(/i.test(code)) {
      report('CLS-PARAMETER-REFERENCE', 'manual-review', 'Resolve $PARAMETER class/name arguments and verify the declaration manually.');
    }
  }
  return issues;
}

function check(source, ranges = null) {
  const result = inspect(source);
  if (!result.supported) return [{ rule: 'CLS-STRUCTURE', status: 'manual-review', line: 1 }];
  const affected = (start, end) => !ranges || ranges.some(r => start <= r.end && end >= r.start);
  const issues = result.separators.filter(s => s.end - s.start !== 1 && affected(s.start + 1, s.end + 1))
    .map(s => ({ rule: 'CLS-SEPARATOR', status: 'fail', line: s.start + 1 }));
  issues.push(...parameterIssues(result.codeLines, affected));
  const eof = source.replace(/\r\n/g, '\n');
  if ((!eof.endsWith('\n') || eof.endsWith('\n\n')) && affected(result.lines.length - 1, result.lines.length)) issues.push({ rule: 'CLS-EOF', status: 'fail', line: result.lines.length });
  return issues;
}

module.exports = { inspect, check };
