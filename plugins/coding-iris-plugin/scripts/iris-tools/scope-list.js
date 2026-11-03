'use strict';

const {normalizeDocument} = require('./xml-package-core');
function fail(code) { throw Object.assign(new Error(code), {code}); }
function parseScopeList(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  if (bytes.length > 128 * 1024 * 1024) fail('scope-list-size-limit');
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { fail('scope-list-utf8-required'); }
  const items = [], seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#')) continue;
    const backend = !entry.includes('/') && entry.match(/\.(cls|mac|inc|int)$/i);
    if (!backend && !(entry.startsWith('/') && /\.(csp|csr|js|css|html|htm|png|jpg|jpeg|gif|ico|bmp|svg|webp|avif)$/i.test(entry))) fail('scope-list-format-invalid');
    const item = normalizeDocument({name: entry, type: backend ? backend[1].toUpperCase() : 'CSP'});
    const key = item.identity.toLowerCase();
    if (seen.has(key)) fail('duplicate-scope-item');
    seen.add(key); items.push({name: item.name, type: item.type});
  }
  if (!items.length) fail('scope-list-empty');
  return items;
}
function buildScopeList(items) {
  const text = items.map(item => {
    const normalized = normalizeDocument(item);
    return (normalized.type === 'CSP' ? '/' : '') + normalized.document;
  }).join('\n') + '\n';
  parseScopeList(text);
  return text;
}
module.exports = {parseScopeList, buildScopeList};
