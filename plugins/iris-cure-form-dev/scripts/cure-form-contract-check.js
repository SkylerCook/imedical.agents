'use strict';
const crypto = require('crypto');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function contract(html) {
  const controls = [], labels = [];
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  for (const match of clean.matchAll(/<(input|select|textarea|option|label)\b([^>]*?)>/gi)) {
    const tag = match[1].toLowerCase(), attributes = {};
    for (const a of match[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? null;
    if (tag === 'label') { if ('for' in attributes) labels.push(attributes.for); continue; }
    const entry = { tag };
    for (const name of ['id', 'name', 'value', 'type', 'checked', 'selected', 'multiple', 'data-cache-tag']) if (name in attributes) entry[name] = attributes[name];
    controls.push(entry);
  }
  return { controls, labels };
}
function compareContract(before, after) {
  const original = contract(before), changed = contract(after);
  return { schema: 'cure-form-contract-check/v1', status: hash(original) === hash(changed) ? 'passed' : 'failed', originalHash: hash(original), changedHash: hash(changed), controlCount: original.controls.length, labelCount: original.labels.length };
}
module.exports = { contract, compareContract };
