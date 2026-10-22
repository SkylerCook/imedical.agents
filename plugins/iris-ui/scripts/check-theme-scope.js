#!/usr/bin/env node
'use strict';

// Read-only review candidates, not a CSS/JavaScript parser or a compliance gate.
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { resolveWorkspaceContext, resolveSourceFilePath } = require('../../../scripts/lib/workspace-context');

const EXTENSIONS = new Set(['.csp', '.csr', '.html', '.js', '.css']);
const THEME_ATTRIBUTE = /^(?:data[-_:]?)?(?:hisui[-_:]?(?:theme|style(?:code)?|family)|theme|stylecode)$/i;
const THEME_METHOD = /^(?:getHisuiStyle|getTheme|getStyleCode|isPure|isIhos)$/i;
const LIMITATIONS = [
  'Candidates require Agent review: presence is not a violation; zero candidates is not UI acceptance.',
  'Lexical matching only: no execution, full AST, control-flow, CSS cascade or business-semantics analysis.',
  'Only explicit files and embedded client style/script blocks are read; no directory or dependency traversal.',
  'Dynamic/computed access, generated selectors, template interpolation, opaque wrappers and cross-file helpers may be missed.',
  'Same-file helper calls are matched by identifier spelling, not lexical binding; shadowed names require manual review.',
  'Class-only theme selectors, inline event handlers, server-side ObjectScript conditions and external resource contents are not analyzed.'
];

function argumentsFrom(argv) {
  let projectRoot;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (!['--project-root', '--file'].includes(name) || !argv[i + 1]?.trim() || argv[i + 1].startsWith('--')) {
      throw new Error('Usage: check-theme-scope.js --project-root <WorkspaceRoot> --file <exact file> [--file <exact file> ...]');
    }
    if (name === '--project-root') {
      if (projectRoot) throw new Error('--project-root must be supplied once');
      projectRoot = argv[++i];
    } else files.push(argv[++i]);
  }
  if (!projectRoot || !files.length) throw new Error('--project-root and at least one --file are required');
  return { projectRoot: path.resolve(projectRoot), files };
}

function blank(value) { return value.replace(/[^\r\n]/g, ' '); }

// Tokens retain offsets while comments, string contents and regex literals cannot
// accidentally become executable identifiers. Quoted values remain string tokens.
function jsTokens(source, offset) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const start = i;
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i + 2);
      if (i < 0) break;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      let value = '';
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') { value += source.slice(i, i + 2); i += 2; }
        else value += source[i++];
      }
      i = Math.min(source.length, i + 1);
      tokens.push({ type: ch === '`' ? 'template' : 'string', value, start: start + offset, end: i + offset });
      continue;
    }
    const previous = tokens.at(-1);
    if (ch === '/' && (!previous || /^(?:[({[=,:;!?]|return|case|=>|&&|\|\|)$/.test(previous.value))) {
      i += 1;
      let characterClass = false;
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') characterClass = true;
        if (source[i] === ']') characterClass = false;
        if (source[i++] === '/' && !characterClass) break;
      }
      while (/[a-z]/i.test(source[i] || '') && i < source.length) i += 1;
      tokens.push({ type: 'regex', value: '', start: start + offset, end: i + offset });
      continue;
    }
    const word = /^[\w$]+/.exec(source.slice(i));
    if (word) {
      i += word[0].length;
      tokens.push({ type: 'identifier', value: word[0], start: start + offset, end: i + offset });
      continue;
    }
    const operator = /^(?:===|!==|=>|==|!=|&&|\|\||\?\.)/.exec(source.slice(i));
    const value = operator ? operator[0] : ch;
    i += value.length;
    tokens.push({ type: 'punctuation', value, start: start + offset, end: i + offset });
  }
  return tokens;
}

function matching(tokens, start, open, close) {
  let depth = 0;
  for (let i = start; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'punctuation') continue;
    if (tokens[i].value === open) depth += 1;
    if (tokens[i].value === close && --depth === 0) return i;
  }
  return -1;
}

function scriptCandidates(tokens, add) {
  const themePositions = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'identifier') continue;
    const isGlobal = token.value === 'HISUIStyleCode';
    const isHisui = token.value.toLowerCase() === 'hisui' && tokens[i + 1]?.value === '.' &&
      (THEME_METHOD.test(tokens[i + 2]?.value || '') || tokens[i + 2]?.value === 'hisuiStyle');
    const isAttribute = /^(?:attr|getAttribute)$/.test(token.value) && tokens[i + 1]?.value === '(' &&
      tokens[i + 2]?.type === 'string' && THEME_ATTRIBUTE.test(tokens[i + 2].value);
    if (isGlobal || isHisui || isAttribute) {
      themePositions.push(token.start);
      add(token.start, isAttribute ? 'theme-attribute-read' : 'hisui-theme-read', token.value);
    }
  }

  const definitions = [];
  for (let i = 0; i < tokens.length; i += 1) {
    let nameIndex;
    let bodyIndex;
    if (tokens[i].value === 'function') {
      if (tokens[i + 1]?.type === 'identifier' && tokens[i + 2]?.value === '(') nameIndex = i + 1;
      else if (tokens[i - 1]?.value === '=' && tokens[i - 2]?.type === 'identifier') nameIndex = i - 2;
      else continue;
      const parameters = tokens[i + 1]?.value === '(' ? i + 1 : i + 2;
      const close = matching(tokens, parameters, '(', ')');
      if (close >= 0 && tokens[close + 1]?.value === '{') bodyIndex = close + 1;
    } else if (tokens[i].value === '=>') {
      // A simple variable-bound arrow function, including parenthesized arguments.
      let before = i - 1;
      if (tokens[before]?.value === ')') {
        let depth = 1;
        while (--before >= 0 && depth) {
          if (tokens[before].value === ')') depth += 1;
          if (tokens[before].value === '(') depth -= 1;
        }
        before += 1;
      }
      if (tokens[before - 1]?.value === '=' && tokens[before - 2]?.type === 'identifier') {
        nameIndex = before - 2;
        bodyIndex = i + 1;
      }
    }
    if (nameIndex === undefined || bodyIndex === undefined) continue;
    let endIndex;
    if (tokens[bodyIndex]?.value === '{') endIndex = matching(tokens, bodyIndex, '{', '}');
    else {
      endIndex = bodyIndex;
      let depth = 0;
      while (endIndex < tokens.length) {
        const token = tokens[endIndex];
        if (token.type === 'punctuation') {
          if (depth === 0 && [',', ';'].includes(token.value)) break;
          if (['(', '[', '{'].includes(token.value)) depth += 1;
          if ([')', ']', '}'].includes(token.value)) {
            if (depth === 0) break;
            depth -= 1;
          }
        }
        endIndex += 1;
      }
      endIndex -= 1;
    }
    if (endIndex >= 0) definitions.push({ name: tokens[nameIndex].value, nameIndex,
      start: tokens[bodyIndex].start, end: tokens[endIndex].end });
  }
  const helpers = definitions.filter(definition => themePositions.some(position => position >= definition.start && position < definition.end));
  // Follow only direct, same-file helper calls; no files or module graph are read.
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      if (helpers.includes(definition)) continue;
      if (tokens.some((token, index) => token.start >= definition.start && token.end < definition.end &&
          token.type === 'identifier' && tokens[index + 1]?.value === '(' &&
          !['.', '?.'].includes(tokens[index - 1]?.value) && helpers.some(helper => helper.name === token.value))) {
        helpers.push(definition);
        changed = true;
      }
    }
  }
  for (const helper of helpers) {
    add(tokens[helper.nameIndex].start, 'same-file-theme-helper-definition', helper.name);
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].type === 'identifier' && tokens[i].value === helper.name && tokens[i + 1]?.value === '(' &&
          i !== helper.nameIndex && !['.', '?.'].includes(tokens[i - 1]?.value)) {
        add(tokens[i].start, 'same-file-theme-helper-call', helper.name);
      }
    }
  }
}

function styleCandidates(source, offset, add) {
  // Ignore comments and quoted strings outside attribute selectors. Values in a
  // selector may themselves be quoted; scan selector preludes, not declarations.
  const masked = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  let boundary = 0;
  let quote = '';
  let bracket = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') bracket += 1;
    if (ch === ']') bracket -= 1;
    if (bracket === 0 && ch === '{') {
      const prelude = masked.slice(boundary, i);
      const attributes = /\[\s*([\w:-]+)\s*(?:[~|^$*]?=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\]\s]+)\s*(?:[is]\s*)?)?\]/gi;
      for (const match of prelude.matchAll(attributes)) {
        if (THEME_ATTRIBUTE.test(match[1])) add(offset + boundary + match.index, 'css-theme-attribute-selector', match[1]);
      }
      boundary = i + 1;
    } else if (bracket === 0 && (ch === '}' || ch === ';')) boundary = i + 1;
  }
}

function scanSource(source, extension, file) {
  const candidates = [];
  const seen = new Set();
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') lineStarts.push(i + 1);
  const add = (offset, conditionType, symbol) => {
    const key = `${offset}:${conditionType}:${symbol}`;
    if (seen.has(key)) return;
    seen.add(key);
    let lower = 0;
    let upper = lineStarts.length;
    while (lower + 1 < upper) {
      const middle = (lower + upper) >>> 1;
      if (lineStarts[middle] <= offset) lower = middle;
      else upper = middle;
    }
    candidates.push({ file, line: lower + 1, column: offset - lineStarts[lower] + 1, conditionType, symbol });
  };
  if (extension === '.js') scriptCandidates(jsTokens(source, 0), add);
  else if (extension === '.css') styleCandidates(source, 0, add);
  else {
    // Match raw-text blocks before looking for another HTML comment. A comment
    // marker inside a script string is JavaScript text, not a block to erase.
    const blocks = /<!--[\s\S]*?-->|<(script|style)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/\1\s*>/gi;
    const tokens = [];
    for (const match of source.matchAll(blocks)) {
      if (!match[1]) continue;
      const offset = match.index + match[1].length + match[2].length + 2;
      if (match[1].toLowerCase() === 'style') styleCandidates(match[3], offset, add);
      else if (!/\b(?:language\s*=\s*["']?(?:cache|objectscript)|runat\s*=\s*["']?server)/i.test(match[2]) &&
          !/\btype\s*=\s*["']?(?:application\/(?:json|ld\+json)|text\/template)/i.test(match[2])) {
        tokens.push(...jsTokens(match[3], offset));
      }
    }
    scriptCandidates(tokens, add);
  }
  return candidates.sort((a, b) => a.line - b.line || a.column - b.column || a.conditionType.localeCompare(b.conditionType));
}

function scanFiles(options, io = fs) {
  if (!io.statSync(options.projectRoot).isDirectory()) throw new Error('--project-root must be a directory');
  const context = resolveWorkspaceContext(options.projectRoot);
  const files = [];
  const candidates = [];
  const seen = new Set();
  for (const supplied of options.files) {
    if (!EXTENSIONS.has(path.extname(supplied).toLowerCase())) throw new Error('Unsupported file extension: ' + supplied);
    const physical = resolveSourceFilePath(context, supplied);
    if (!EXTENSIONS.has(path.extname(physical).toLowerCase())) throw new Error('Resolved file has unsupported extension: ' + supplied);
    const key = process.platform === 'win32' ? physical.toLowerCase() : physical;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!io.statSync(physical).isFile()) throw new Error('--file must identify a regular file: ' + supplied);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(io.readFileSync(physical));
    const file = path.relative(options.projectRoot, path.resolve(options.projectRoot, supplied)).split(path.sep).join('/');
    files.push({ file, status: 'scanned' });
    candidates.push(...scanSource(source, path.extname(physical).toLowerCase(), file));
  }
  return { schema: 'iris-ui-theme-scope/v1', status: 'scanned', readOnly: true,
    files, candidates, coverage: { mode: 'lexical-candidates', limitations: LIMITATIONS } };
}

function main(argv) {
  try {
    const result = scanFiles(argumentsFrom(argv));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ schema: 'iris-ui-theme-scope/v1', status: 'error', readOnly: true,
      error: { code: error.code || 'INVALID_INPUT', message: error.message },
      coverage: { mode: 'lexical-candidates', limitations: LIMITATIONS } }, null, 2) + '\n');
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { argumentsFrom, scanSource, scanFiles, main };
