'use strict';

const crypto = require('node:crypto');
const {SaxesParser} = require('../../../../vendor/xml-parser/saxes/saxes');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(code, details = {}) { throw Object.assign(new Error(code), {code, ...details}); }
function xmlText(input, maxBytes = 128 * 1024 * 1024) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  if (bytes.length > maxBytes) fail('xml-size-limit');
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { fail('xml-utf8-required'); }
}

// The dependency verifies XML syntax. This layer limits resource use and
// validates the two IRIS formats; it never fetches a DTD or external entity.
function parseXml(input, options = {}) {
  const text = xmlText(input, options.maxBytes);
  const parser = new SaxesParser({xmlns: false, defaultXMLVersion: '1.0', forceXMLVersion: true});
  const stack = []; let root, nodes = 0;
  parser.on('doctype', () => fail('xml-doctype-forbidden'));
  parser.on('processinginstruction', () => fail('xml-processing-instruction-forbidden'));
  parser.on('error', () => fail('invalid-xml'));
  parser.on('opentag', tag => {
    if (++nodes > (options.maxNodes || 1000000) || stack.length >= (options.maxDepth || 128)) fail('xml-structure-limit');
    const node = {tag: tag.name, attributes: {...tag.attributes}, children: [], content: []};
    if (stack.length) { const parent = stack[stack.length - 1]; parent.children.push(node); parent.content.push(node); }
    else { if (root) fail('xml-multiple-roots'); root = node; }
    stack.push(node);
  });
  const append = value => { if (stack.length) stack[stack.length - 1].content.push(value); else if (value.trim()) fail('xml-outside-root'); };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => stack.pop());
  try { parser.write(text).close(); }
  catch (error) { if (error.code) throw error; fail('invalid-xml'); }
  if (!root || stack.length) fail('invalid-xml');
  return root;
}
function textContent(node) { return node.content.map(value => typeof value === 'string' ? value : textContent(value)).join(''); }
function onlyChildren(node, tag) {
  if (node.children.some(child => child.tag !== tag) || node.content.some(value => typeof value === 'string' && value.trim())) fail('unsupported-project-xml');
  return node.children;
}
function normalizeDocument(item) {
  if (typeof item === 'string') {
    const extension = item.match(/\.(cls|mac|inc|int)$/i);
    item = {name: item, type: extension ? extension[1].toUpperCase() : 'CSP'};
  }
  if (!item || typeof item.name !== 'string') fail('invalid-document');
  const type = String(item.type || '').toUpperCase();
  let name = item.name;
  if (name !== name.trim() || !name || /[,;*?%#\\\x00-\x1f\x7f]/.test(name.replace(/^%/, ''))) fail('unsafe-document-name');
  if (['CLS', 'MAC', 'INC', 'INT'].includes(type)) {
    const extension = '.' + type.toLowerCase();
    if (name.toLowerCase().endsWith(extension)) name = name.slice(0, -extension.length);
    if (!/^[%A-Za-z][%A-Za-z0-9]*(?:\.[%A-Za-z][%A-Za-z0-9]*)*$/.test(name)) fail('invalid-backend-document');
    const document = name + extension;
    return {...item, name, type, document, identity: type + ':' + document};
  }
  if (type !== 'CSP') fail('unsupported-document-type');
  name = name.replace(/^\//, '');
  if (!name || /[:\\]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) fail('unsafe-document-name');
  return {...item, name, type, document: name, identity: 'CSP:' + name};
}
function parseProjectItems(input) {
  const root = parseXml(input);
  if (root.tag !== 'Export') fail('unsupported-project-xml');
  const projects = onlyChildren(root, 'Project');
  if (projects.length !== 1) fail('unsupported-project-xml');
  const lists = onlyChildren(projects[0], 'Items');
  if (lists.length !== 1) fail('unsupported-project-xml');
  const nodes = onlyChildren(lists[0], 'ProjectItem'), seen = new Set();
  if (!nodes.length) fail('unsupported-project-xml');
  return nodes.map(node => {
    if (node.children.length || textContent(node).trim() || Object.keys(node.attributes).some(key => !['name', 'type'].includes(key))) fail('unsupported-project-item');
    const {name, type} = node.attributes, normalized = normalizeDocument({name, type});
    const key = normalized.identity.toLowerCase();
    if (seen.has(key)) fail('duplicate-project-item');
    seen.add(key); return {name, type: normalized.type};
  });
}
function strictBase64(text) {
  const value = text.replace(/[\t\r\n ]/g, '');
  if (!value || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('invalid-csp-base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail('invalid-csp-base64');
  return bytes;
}
function canonicalNode(node) {
  return [node.tag, Object.entries(node.attributes).sort(([a], [b]) => a.localeCompare(b, 'en')),
    node.content.map(value => typeof value === 'string' ? value : canonicalNode(value))];
}
function parseExportXml(input, options = {}) {
  const root = parseXml(input, options);
  if (root.tag !== 'Export' || root.content.some(value => typeof value === 'string' && value.trim())) fail('unsupported-export-xml');
  const seen = new Set();
  const items = root.children.map(node => {
    const {name, application} = node.attributes;
    let type, descriptor, payloadBytes;
    if (node.tag === 'Class') {
      type = 'CLS'; descriptor = normalizeDocument({name, type});
      payloadBytes = Buffer.from(JSON.stringify(canonicalNode(node)), 'utf8');
    } else if (node.tag === 'Routine') {
      type = String(node.attributes.type || name?.match(/\.(mac|inc|int)$/i)?.[1] || '').toUpperCase();
      descriptor = normalizeDocument({name, type}); payloadBytes = Buffer.from(textContent(node), 'utf8');
    } else if (node.tag === 'CSP' || node.tag === 'CSPBase64') {
      if (node.children.length || typeof name !== 'string' || name.startsWith('/') || typeof application !== 'string' || !application.startsWith('/')) fail('invalid-csp-entry');
      const prefix = application.replace(/^\//, '').replace(/\/$/, '');
      if (prefix && prefix.split('/').some(part => !part || part === '.' || part === '..')) fail('invalid-csp-entry');
      const document = prefix ? prefix + '/' + name : name;
      type = 'CSP'; descriptor = normalizeDocument({name: document, type});
      payloadBytes = node.tag === 'CSPBase64' ? strictBase64(textContent(node)) : Buffer.from(textContent(node), 'utf8');
    } else fail('unsupported-export-item', {tag: node.tag});
    if (seen.has(descriptor.identity)) fail('duplicate-export-item');
    seen.add(descriptor.identity);
    return {...descriptor, tag: node.tag, name, ...(application ? {application} : {}), payloadBytes, sha256: hash(payloadBytes)};
  });
  if (!items.length) fail('empty-export');
  return {generator: root.attributes.generator || '', version: root.attributes.version || '', items};
}
function validatePackage(input, expected) {
  if (!Array.isArray(expected) || !expected.length) fail('expected-export-items-required');
  const packageData = parseExportXml(input), identities = expected.map(item => normalizeDocument(item).identity);
  if (new Set(identities).size !== identities.length) fail('duplicate-expected-item');
  const actual = new Set(packageData.items.map(item => item.identity)), wanted = new Set(identities);
  const missing = identities.filter(identity => !actual.has(identity)), extra = [...actual].filter(identity => !wanted.has(identity));
  if (missing.length || extra.length) fail('export-scope-mismatch', {missing, extra});
  return {...packageData, sha256: hash(Buffer.isBuffer(input) ? input : Buffer.from(input)), status: 'verified'};
}
module.exports = {parseXml, parseProjectItems, normalizeDocument, parseExportXml, validatePackage, strictBase64, hash};
