'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATIC_HELPER = '$g';
const DEFAULT_PLACEHOLDER_HELPER = '$trans';

function usage() {
  return [
    'Usage: node check-i18n-helper-usage.js --file <path> [--file <path>...]',
    "       [--static-helper '$g'] [--placeholder-helper '$trans']",
    '',
    'Checks that translation helper keys are stable string literals.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    files: [],
    staticHelper: DEFAULT_STATIC_HELPER,
    placeholderHelper: DEFAULT_PLACEHOLDER_HELPER,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (argument === '--file') {
      if (!value) throw new Error('--file requires a path');
      options.files.push(value);
      index += 1;
      continue;
    }
    if (argument === '--static-helper') {
      if (!value) throw new Error('--static-helper requires a helper name');
      options.staticHelper = value;
      index += 1;
      continue;
    }
    if (argument === '--placeholder-helper') {
      if (!value) throw new Error('--placeholder-helper requires a helper name');
      options.placeholderHelper = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.help && options.files.length === 0) {
    throw new Error('At least one --file is required');
  }
  if (!options.staticHelper.trim() || !options.placeholderHelper.trim()) {
    throw new Error('Helper names must not be empty');
  }
  if (options.staticHelper === options.placeholderHelper) {
    throw new Error('Static and placeholder helper names must be different');
  }
  return options;
}

function isIdentifierCharacter(character) {
  return Boolean(character && /[A-Za-z0-9_$]/.test(character));
}

function skipWhitespaceAndComments(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index + 2);
      return newline === -1 ? source.length : skipWhitespaceAndComments(source, newline + 1);
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      return close === -1 ? source.length : skipWhitespaceAndComments(source, close + 2);
    }
    break;
  }
  return index;
}

function readQuotedLiteral(source, start, quote) {
  let index = start + 1;
  let interpolated = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && character === '$' && source[index + 1] === '{') {
      interpolated = true;
    }
    if (character === quote) {
      return { end: index + 1, interpolated, terminated: true };
    }
    index += 1;
  }
  return { end: source.length, interpolated, terminated: false };
}

function inspectFirstArgument(source, openParen) {
  const start = skipWhitespaceAndComments(source, openParen + 1);
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return { valid: false, reason: 'non-literal' };
  }

  const literal = readQuotedLiteral(source, start, quote);
  if (!literal.terminated) return { valid: false, reason: 'unterminated-literal' };
  if (literal.interpolated) return { valid: false, reason: 'template-interpolation' };

  const next = skipWhitespaceAndComments(source, literal.end);
  if (source[next] !== ',' && source[next] !== ')') {
    return { valid: false, reason: 'dynamic-expression' };
  }
  return { valid: true };
}

function lineAndColumn(source, index) {
  const prefix = source.slice(0, index);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function blank(source) {
  return source.replace(/[^\r\n]/g, ' ');
}

// Keep offsets while selecting executable client regions. CSP server blocks and
// HTML text/ordinary attributes are not JavaScript translation-helper calls.
function maskServerExpressions(source) {
  const output = source.split('');
  const starts = /##?\(/g;
  let match;
  while ((match = starts.exec(source))) {
    let index = starts.lastIndex;
    let depth = 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '"') {
        index += 1;
        while (index < source.length) {
          if (source[index++] === '"') {
            if (source[index] === '"') index += 1;
            else break;
          }
        }
      } else {
        if (source[index] === '(') depth += 1;
        if (source[index] === ')') depth -= 1;
        index += 1;
      }
    }
    const suffix = match[0].startsWith('##') ? '##' : '#';
    if (depth !== 0 || !source.startsWith(suffix, index)) continue;
    index += suffix.length;
    for (let cursor = match.index; cursor < index; cursor += 1) {
      if (!/[\r\n]/.test(output[cursor])) output[cursor] = ' ';
    }
    starts.lastIndex = index;
  }
  return output.join('');
}

function clientRegions(source) {
  const masked = maskServerExpressions(source.replace(/<!--[\s\S]*?-->|<%[\s\S]*?%>/g, blank));
  const regions = [];
  const copy = (start, end) => regions.push({source: masked.slice(start, end), offset: start});
  const tags = /<([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  let tag;
  while ((tag = tags.exec(masked))) {
    const attributes = [];
    const pattern = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const bodyStart = tag.index + 1 + tag[1].length;
    const body = tag[0].slice(1 + tag[1].length, -1);
    let attribute;
    while ((attribute = pattern.exec(body))) {
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      const equal = attribute[0].indexOf('=');
      const valueOffset = equal < 0 ? attribute[0].length : equal + 1 + attribute[0].slice(equal + 1).search(/\S/);
      const quoted = attribute[2] !== undefined || attribute[3] !== undefined;
      attributes.push({ name: attribute[1].toLowerCase(), value,
        start: bodyStart + attribute.index + valueOffset + (quoted ? 1 : 0) });
    }
    const values = Object.fromEntries(attributes.map(item => [item.name, item.value.toLowerCase()]));
    const name = tag[1].toLowerCase();
    if (name === 'script' || name === 'style') {
      const closing = new RegExp('</' + name + '\\s*>', 'gi');
      closing.lastIndex = tags.lastIndex;
      const close = closing.exec(masked);
      const end = close ? close.index : masked.length;
      const client = name === 'script' && values.runat !== 'server'
        && (!values.language || /^(javascript|jscript|ecmascript)$/i.test(values.language))
        && (!values.type || /^(module|(?:text|application)\/(?:javascript|ecmascript))$/i.test(values.type));
      if (client) copy(tags.lastIndex, end);
      tags.lastIndex = close ? closing.lastIndex : masked.length;
      continue;
    }
    if (values.runat === 'server') continue;
    for (const attribute of attributes) {
      if (!/^on[a-z]+$/.test(attribute.name)) continue;
      const offsets = [];
      let cursor = 0;
      // HTML decodes character references before compiling event handlers.
      // Map decoded offsets back to the original attribute for diagnostics.
      const decoded = attribute.value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[\da-f]+);/gi, (entity, offset) => {
        while (cursor < offset) offsets.push(cursor++);
        const key = entity.slice(1, -1).toLowerCase();
        const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : key.startsWith('#') ? Number(key.slice(1)) : null;
        const value = code === null ? ({quot: '"', apos: "'", amp: '&', lt: '<', gt: '>'})[key]
          : code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
        for (let i = 0; i < value.length; i += 1) offsets.push(offset);
        cursor = offset + entity.length;
        return value;
      });
      while (cursor < attribute.value.length) offsets.push(cursor++);
      regions.push({source: decoded, offset: attribute.start, offsets});
    }
  }
  return regions;
}

function scanSource(source, options = {}) {
  const markup = /\.(csp|html?)$/i.test(options.filePath || '');
  const regions = markup ? clientRegions(source) : [{source, offset: 0}];
  return regions.flatMap(region => scanJavaScript(region.source, options).map(violation => {
    const {offset, ...details} = violation;
    const original = region.offset + (region.offsets ? region.offsets[offset] : offset);
    return {...details, ...lineAndColumn(source, original)};
  }));
}

function scanJavaScript(source, options = {}) {
  const staticHelper = options.staticHelper || DEFAULT_STATIC_HELPER;
  const placeholderHelper = options.placeholderHelper || DEFAULT_PLACEHOLDER_HELPER;
  const helpers = [
    { name: staticHelper, kind: 'static' },
    { name: placeholderHelper, kind: 'placeholder' },
  ].sort((left, right) => right.name.length - left.name.length);
  const violations = [];
  function scanCode(start, interpolation = false) {
    let index = start;
    let braces = 0;
    while (index < source.length) {
      const character = source[index];
      if (character === '{') braces += 1;
      if (character === '}') {
        if (interpolation && braces === 0) return index + 1;
        braces -= 1;
      }
      if (character === '/' && source[index + 1] === '/') {
        const newline = source.indexOf('\n', index + 2);
        index = newline === -1 ? source.length : newline + 1;
        continue;
      }
      if (character === '/' && source[index + 1] === '*') {
        const close = source.indexOf('*/', index + 2);
        index = close === -1 ? source.length : close + 2;
        continue;
      }
      if (character === '`') {
        index += 1;
        while (index < source.length) {
          if (source[index] === '\\') { index += 2; continue; }
          if (source[index] === '`') { index += 1; break; }
          if (source[index] === '$' && source[index + 1] === '{') {
            index = scanCode(index + 2, true);
          } else index += 1;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        index = readQuotedLiteral(source, index, character).end;
        continue;
      }

      let matched = false;
      for (const helper of helpers) {
        if (!source.startsWith(helper.name, index)) continue;
        if (isIdentifierCharacter(source[index - 1]) || isIdentifierCharacter(source[index + helper.name.length])) continue;
        const openParen = skipWhitespaceAndComments(source, index + helper.name.length);
        if (source[openParen] !== '(') continue;

        const result = inspectFirstArgument(source, openParen);
        if (!result.valid) {
          const location = lineAndColumn(source, index);
          violations.push({
            ...location,
            offset: index,
            helper: helper.name,
            helperKind: helper.kind,
            reason: result.reason,
            code: 'dynamic-translation-key',
          });
        }
        index = openParen + 1;
        matched = true;
        break;
      }
      if (!matched) index += 1;
    }
    return index;
  }
  scanCode(0);
  return violations;
}

function formatViolation(filePath, violation, placeholderHelper) {
  const advice = violation.helperKind === 'static'
    ? `keep the key literal and pass runtime values through ${placeholderHelper} placeholders`
    : 'keep the template key literal and pass runtime values as later arguments';
  return `${filePath}:${violation.line}:${violation.column} [${violation.code}] ${violation.helper} first argument must be a stable string literal; ${advice}.`;
}

function run(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  let violationCount = 0;
  for (const file of options.files) {
    const resolved = path.resolve(file);
    let source;
    try {
      source = fs.readFileSync(resolved, 'utf8');
    } catch (error) {
      stderr.write(`${file}: [file-read-error] ${error.message}\n`);
      return 2;
    }

    const violations = scanSource(source, { ...options, filePath: resolved });
    violationCount += violations.length;
    for (const violation of violations) {
      stderr.write(`${formatViolation(file, violation, options.placeholderHelper)}\n`);
    }
  }

  if (violationCount > 0) {
    stderr.write(`i18n helper check failed: ${violationCount} violation(s).\n`);
    return 1;
  }
  stdout.write(`i18n helper check passed: ${options.files.length} file(s).\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = {
  DEFAULT_PLACEHOLDER_HELPER,
  DEFAULT_STATIC_HELPER,
  formatViolation,
  parseArgs,
  run,
  scanSource,
};
