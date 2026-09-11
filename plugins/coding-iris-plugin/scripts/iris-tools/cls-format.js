'use strict';

// Read-only UDL boundary hints for coding. No source rewriting or commit gate.
function inspect(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (/\bLanguage\s*=\s*(?!objectscript\b)\w+/i.test(source)) return { supported: false, separators: [], lines };
  const separators = [];
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
    for (let p = 0; p < line.length; p++) {
      const c = line[p], next = line[p + 1];
      if (block) { if (c === '*' && next === '/') { block = false; p++; } continue; }
      if (quote) { if (c === '"') { if (next === '"') p++; else quote = false; } continue; }
      if (c === '"') { quote = true; continue; }
      if ((c === '/' && next === '/') || c === ';') break;
      if (c === '/' && next === '*') { block = true; p++; continue; }
      if (c === '{') { depth++; opened = true; }
      if (c === '}') { depth--; if (depth === 0) closed = true; }
      if (depth < 0) return { supported: false, separators: [], lines };
    }
    if (quote) return { supported: false, separators: [], lines };
  }
  return { supported: opened && closed && depth === 0 && !block, separators, lines };
}

function check(source, ranges = null) {
  const result = inspect(source);
  if (!result.supported) return [{ rule: 'CLS-STRUCTURE', status: 'manual-review', line: 1 }];
  const affected = (start, end) => !ranges || ranges.some(r => start <= r.end && end >= r.start);
  const issues = result.separators.filter(s => s.end - s.start !== 1 && affected(s.start + 1, s.end + 1))
    .map(s => ({ rule: 'CLS-SEPARATOR', status: 'fail', line: s.start + 1 }));
  const eof = source.replace(/\r\n/g, '\n');
  if ((!eof.endsWith('\n') || eof.endsWith('\n\n')) && affected(result.lines.length - 1, result.lines.length)) issues.push({ rule: 'CLS-EOF', status: 'fail', line: result.lines.length });
  return issues;
}

module.exports = { inspect, check };
