#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {parseXml, normalizeDocument, exportItem, hash} = require('./xml-package-core');
const {classUdl, xmlMarkup} = require('./xml-class-udl');

const USAGE = 'IRIS / Caché XML 转源码\nnode xml-to-source.js --input <XML文件或目录> --out <新目录>';

function fail(code, details = {}) {
  throw Object.assign(new Error(code), {code, ...details});
}

function parseArgs(argv) {
  const options = {};
  while (argv.length) {
    const [key, value] = argv.splice(0, 2);
    if (!['--input', '--out'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(options, key)) {
      fail('invalid-conversion-arguments');
    }
    options[key] = value;
  }
  if (!options['--input'] || !options['--out']) fail('input-and-output-required');
  return options;
}

function inputFiles(input) {
  const stat = fs.lstatSync(input, {throwIfNoEntry: false});
  if (!stat) fail('xml-input-not-found', {input});
  if (stat.isFile() && /\.xml$/i.test(input)) return [input];
  if (!stat.isDirectory()) fail('xml-file-or-directory-required');
  const files = fs.readdirSync(input, {withFileTypes: true})
    .filter(entry => /\.xml$/i.test(entry.name) && !entry.isDirectory())
    .map(entry => path.join(input, entry.name)).sort();
  if (!files.length) fail('xml-input-empty');
  return files;
}

function annotate(error, info) {
  for (const [key, value] of Object.entries(info)) {
    if (!Object.hasOwn(error, key)) error[key] = value;
  }
  throw error;
}

function parsePackage(input) {
  const stat = fs.lstatSync(input);
  if (!stat.isFile()) fail('regular-xml-file-required');
  if (stat.size > 128 * 1024 * 1024) fail('xml-size-limit');
  const bytes = fs.readFileSync(input);
  const encoding = /^\uFEFF?<\?xml\s[^?]*\bencoding\s*=\s*(['"])([^'"]+)\1/i.exec(bytes.subarray(0, 1024).toString('utf8'));
  if (encoding && !/^utf-8$/i.test(encoding[2])) fail('xml-utf8-required');
  const root = parseXml(bytes, {cspFraming: true});
  if (root.tag !== 'Export' || root.content.some(value => typeof value === 'string' && value.trim())) fail('unsupported-export-xml');
  return {root, sha256: hash(bytes)};
}

function safeOutputPath(relative) {
  for (const name of relative.split('/')) {
    if (!name || name === '.' || name === '..' || name.toLowerCase() === '.git' ||
        /[<>:"\\|?*\x00-\x1f\x7f]|[ .]$/.test(name) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) {
      fail('unsafe-source-output-path', {relativePath: relative});
    }
  }
  return relative;
}

function routineBytes(node, item) {
  const text = item.payloadBytes.toString('utf8');
  const routineName = item.document.slice(0, -(item.type.length + 1));
  const actualType = node.attributes.name?.match(/\.(mac|int|inc)$/i)?.[1];
  if (actualType && actualType.toUpperCase() !== item.type) fail('routine-type-conflict', {field: '@type'});
  if (node.children.length) fail('unsupported-routine-payload');
  if (/^\s*ROUTINE\b/i.test(text)) {
    const heading = /^\s*ROUTINE[ \t]+([%\w.]+)(?:[ \t]+\[([^\r\n]+)\])?[ \t]*(?:\n|$)/i.exec(text);
    const headingType = heading?.[2]?.match(/(?:^|,)\s*Type\s*=\s*([A-Za-z]+)(?:\s*,|\s*$)/i)?.[1];
    if (!heading || heading[1] !== routineName || headingType && headingType.toUpperCase() !== item.type) {
      fail('routine-header-conflict');
    }
    return Buffer.from(text.trimStart(), 'utf8');
  }
  const language = node.attributes.languagemode;
  const lang = language ? ', LanguageMode = ' + language : '';
  return Buffer.from('ROUTINE ' + routineName + ' [Type = ' + item.type + lang + ']\n' + text.replace(/^\n/, ''), 'utf8');
}

function convertItem(node, nativeExport) {
  if (node.tag === 'Class') {
    const name = node.attributes.name;
    // Class/@name is a qualified class name, including when its final part is "cls".
    const {identity} = normalizeDocument({type: 'CLS', name: name && name + '.cls'});
    const relativePath = safeOutputPath(name.replace(/\./g, '/') + '.cls');
    return {identity, relativePath, bytes: Buffer.from(classUdl(node, name), 'utf8')};
  }
  const descriptor = exportItem(node);
  const {document, identity, type, payloadBytes} = descriptor;
  const allowed = node.tag === 'Routine' ? ['name', 'type', 'timestamp', 'languagemode'] : ['name', 'application', 'timestamp', 'default'];
  for (const key of Object.keys(node.attributes)) {
    if (!allowed.includes(key)) fail('unsupported-export-attribute', {field: '@' + key});
  }
  if (node.attributes.languagemode && !/^[A-Za-z][A-Za-z0-9]*$/.test(node.attributes.languagemode)) {
    fail('unsupported-export-attribute', {field: '@languagemode'});
  }
  let bytes;
  if (type === 'CSP') {
    // Native exports put one framing LF at the start of text CSP CDATA.
    const framingLength = nativeExport && node.startsWithCdata && payloadBytes[0] === 0x0a ? 1 : 0;
    bytes = payloadBytes.subarray(framingLength);
  } else {
    bytes = routineBytes(node, descriptor);
  }
  return {identity, relativePath: safeOutputPath(document), bytes};
}

function addItem(items, paths, item, source) {
  const identity = item.identity.normalize('NFC').toLowerCase();
  const previous = items.get(identity);
  if (previous) {
    if (previous.identity !== item.identity || !previous.bytes.equals(item.bytes)) {
      fail('source-object-conflict', {firstInput: previous.sources[0].file});
    }
    previous.sources.push(source);
    return;
  }
  const parts = item.relativePath.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const spelling = parts.slice(0, index).join('/');
    const key = spelling.normalize('NFC').toLowerCase();
    const file = index === parts.length;
    const prior = paths.get(key);
    if (prior && (file || prior.file || prior.spelling !== spelling)) {
      fail('source-path-conflict', {relativePath: item.relativePath, firstInput: prior.source.file});
    }
    paths.set(key, {spelling, file, source: prior?.source || source});
  }
  items.set(identity, {...item, sources: [source], sha256: hash(item.bytes)});
}

function collect(input) {
  const items = new Map(), paths = new Map(), inputs = [];
  for (const file of inputFiles(input)) {
    const source = path.basename(file);
    try {
      const {root, sha256} = parsePackage(file);
      const nativeExport = /^(?:IRIS|Cache)$/i.test(root.attributes.generator || '');
      const metadata = [];
      for (const node of root.children) {
        if (['Package', 'Project'].includes(node.tag)) {
          metadata.push({tag: node.tag, attributes: node.attributes, xml: xmlMarkup(node)});
          continue;
        }
        try { addItem(items, paths, convertItem(node, nativeExport), {file: source, tag: node.tag, attributes: node.attributes}); }
        catch (error) {
          annotate(error, {object: node.tag + ':' + [node.attributes.application, node.attributes.name].filter(Boolean).join(' ')});
        }
      }
      inputs.push({file: source, sha256, export: root.attributes, metadata});
    } catch (error) {
      annotate(error, {input: source});
    }
  }
  if (!items.size) fail('xml-source-objects-required', {input: path.basename(input)});
  return {inputs, items: [...items.values()].sort((a, b) => a.relativePath < b.relativePath ? -1 : 1)};
}

function assertAbsent(output) {
  if (fs.lstatSync(output, {throwIfNoEntry: false})) fail('source-output-already-exists', {output});
}

function publish(output, {inputs, items}) {
  const parent = path.dirname(output);
  if (!fs.lstatSync(parent, {throwIfNoEntry: false})?.isDirectory() || parent === output) {
    fail('source-output-parent-required', {output});
  }
  assertAbsent(output);
  const lock = path.join(parent, '.' + path.basename(output) + '.xtoc-lock');
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') fail('source-output-busy', {output});
    throw error;
  }
  let stage;
  try {
    assertAbsent(output);
    stage = fs.mkdtempSync(path.join(lock, 'stage-'));
    for (const item of items) {
      const file = path.join(stage, 'src', item.relativePath);
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file, item.bytes, {flag: 'wx'});
    }
    const manifest = {schema: 'iris-xml-to-source/v1', inputs, files: items.map(({identity, relativePath, sources, sha256}) =>
      ({identity, path: 'src/' + relativePath, sources, sha256}))};
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    assertAbsent(output);
    fs.renameSync(stage, output);
    stage = undefined;
  } finally {
    if (stage && path.dirname(stage) === lock) fs.rmSync(stage, {recursive: true, force: true});
    fs.rmdirSync(lock);
  }
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const options = parseArgs(argv);
  const output = path.resolve(options['--out']);
  assertAbsent(output);
  const batch = collect(path.resolve(options['--input']));
  publish(output, batch);
  console.log(JSON.stringify({state: 'converted', inputs: batch.inputs.length, files: batch.items.length,
    output, manifest: path.join(output, 'manifest.json')}));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    const {code, input, object, field, output, firstInput, relativePath} = error;
    console.error(JSON.stringify({state: 'failed', reason: code || error.message, input, object, field, output, firstInput, relativePath}));
    process.exitCode = 1;
  }
}
