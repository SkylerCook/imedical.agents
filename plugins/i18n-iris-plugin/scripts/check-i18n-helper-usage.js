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

function scanSource(source, options = {}) {
  const staticHelper = options.staticHelper || DEFAULT_STATIC_HELPER;
  const placeholderHelper = options.placeholderHelper || DEFAULT_PLACEHOLDER_HELPER;
  const helpers = [
    { name: staticHelper, kind: 'static' },
    { name: placeholderHelper, kind: 'placeholder' },
  ].sort((left, right) => right.name.length - left.name.length);
  const violations = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];
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
    if (character === '"' || character === "'" || character === '`') {
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

    const violations = scanSource(source, options);
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
