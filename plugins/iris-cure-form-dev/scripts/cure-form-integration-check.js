'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { runnerFingerprint } = require('./cure-form-runner-fingerprint');
const { compareContract } = require('./cure-form-contract-check');
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const jsonHash = (v) => hash(JSON.stringify(stable(v)));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function integrationCheck(deliveries) {
  if (!Array.isArray(deliveries) || !deliveries.length) throw new Error('Nonempty delivery list required.');
  const owners = new Map(), maps = new Set(), results = [];
  for (const delivery of deliveries) {
    if (maps.has(delivery.mapCode)) throw new Error('Duplicate Map delivery.');
    maps.add(delivery.mapCode);
    if (!Array.isArray(delivery.files) || !delivery.files.length || !Array.isArray(delivery.unresolved) || delivery.unresolved.length) throw new Error('Delivery files missing or unresolved items remain.');
    for (const item of delivery.files) {
      const real = fs.realpathSync(item.path), identity = process.platform === 'win32' ? real.toLowerCase() : real;
      if (owners.has(identity)) throw new Error(`Overlapping file ownership: ${item.path}`);
      if (/^(?:adaptation|asscom)\.css$/i.test(path.basename(real))) throw new Error('Parallel deliveries may not own shared CSS.');
      if (hash(fs.readFileSync(real)) !== item.sha256) throw new Error(`Delivery artifact changed: ${item.path}`);
      owners.set(identity, delivery.mapCode);
    }
    const snapshot = read(delivery.snapshot), changes = read(delivery.changes), verification = read(delivery.previewVerification);
    if (jsonHash(snapshot) !== delivery.snapshotHash || changes.mapCode !== delivery.mapCode || snapshot.mapCode !== delivery.mapCode) throw new Error('Snapshot identity/hash mismatch.');
    if (verification.status !== 'passed' || verification.snapshotHash !== jsonHash(snapshot) || verification.changesHash !== jsonHash(changes) || verification.runner.implementationHash !== runnerFingerprint()) throw new Error('Stale or failed browser evidence.');
    const contracts = changes.templates.filter((t) => !t.referenceOnly).map((t) => {
      const original = snapshot.templates.find((b) => String(b.rowId) === String(t.sourceTemplateRowId || t.rowId));
      if (!original) throw new Error('Missing original template.');
      return { rowId: original.rowId, ...compareContract(original.content, t.content) };
    });
    if (!contracts.length || contracts.some((r) => r.status !== 'passed')) throw new Error('Runtime contract changed.');
    results.push({ mapCode: delivery.mapCode, status: 'passed', fileCount: delivery.files.length, snapshotHash: delivery.snapshotHash, contracts });
  }
  return { schema: 'cure-form-integration-check/v1', status: 'passed', results };
}
module.exports = { integrationCheck };
