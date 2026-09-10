'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { privateRoot } = require('./cure-form-workspace');
const { DeploymentBudget } = require('./cure-form-deployment-policy');
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));

// Deliberately separate from ordinary deployment: never clear as a deployment prerequisite.
async function recoveryTest({ packageValue, rowId, outputRoot, confirmClear, operator, reason, budgetOptions }, api) {
  if (!confirmClear || !operator || !reason || !/^\d+$/.test(String(rowId))) throw new Error('Recovery test requires explicit clear authorization, RowID, operator and reason.');
  api.validate(packageValue);
  const budget = new DeploymentBudget(budgetOptions);
  if (api.setDeadline) api.setDeadline(budget.startedAt + budget.totalMs);
  const call = async (fn) => {
    budget.check();
    const result = await fn();
    // Preserve a known operation result before the next deadline check.
    budget.progressAt = budget.now();
    return result;
  };
  if (packageValue.changes.strategy !== 'in-place-overwrite') throw new Error('Recovery test requires an in-place restore package.');
  const snapshot = await call(() => api.inspect(packageValue));
  const selected = snapshot.templates.find((t) => String(t.rowId) === String(rowId));
  const target = packageValue.changes.templates.filter((t) => !t.referenceOnly);
  if (!selected || !selected.content || target.length !== 1 || String(target[0].rowId) !== String(rowId) || target[0].content !== selected.content) throw new Error('Restore package must preserve exactly one nonempty current template content.');
  if (String(snapshot.version) !== String(packageValue.expectedVersion) || snapshot.contentHash !== packageValue.expectedContentHash) throw new Error('Server baseline changed; do not clear.');
  const root = path.join(privateRoot({ workRoot: outputRoot }), 'recovery', `${rowId}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  const save = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + '\n');
  save('before.json', snapshot); save('restore-baseline-package.json', packageValue);
  if (hash(JSON.parse(fs.readFileSync(path.join(root, 'before.json'), 'utf8'))) !== hash(snapshot)) throw new Error('Backup readback failed.');
  const report = { schema: 'cure-form-recovery-test/v1', status: 'preflight', rowId: String(rowId), backupHash: hash(snapshot), startedAt: Date.now() };
  const record = () => save('result.json', report);
  record();
  const requireOk = (value) => { if (!value || !value.ok) throw new Error(value && value.code || 'Server operation failed'); return value; };
  try {
    requireOk(await call(() => api.validateRemote(packageValue)));
    const clear = clone(packageValue);
    clear.changes.templates = snapshot.templates.map((t) => String(t.rowId) === String(rowId) ? { rowId: String(rowId), content: '' } : { rowId: String(t.rowId), referenceOnly: true });
    clear.changes.map = {};
    clear.recoveryTest = { phase: 'clear', rowId: String(rowId), backupHash: report.backupHash, restorePackageHash: hash(packageValue) };
    // An empty page has no browser acceptance. Never falsely attach the restore preview as clear-page evidence.
    clear.previewVerification = null;
    clear.plannedChangesHash = hash(clear.changes);
    save('clear-test-package.json', clear);
    requireOk(await call(() => api.validateRemote(clear)));
    budget.check();
    report.status = 'clear-outcome-unknown'; record();
    const cleared = requireOk(await call(() => api.apply(clear, operator, reason)));
    if (!cleared.operationId) throw new Error('Clear did not return operation ID.');
    report.clearOperationId = cleared.operationId; report.status = 'cleared'; record();
    const empty = await call(() => api.inspect(packageValue));
    const emptyTarget = empty.templates.find((t) => String(t.rowId) === String(rowId));
    if (!emptyTarget || emptyTarget.content !== '') throw new Error('Clear readback did not find empty content.');
    const normalized = clone(empty); normalized.templates.find((t) => String(t.rowId) === String(rowId)).content = selected.content;
    if (hash(normalized.templates) !== hash(snapshot.templates) || hash(empty.map) !== hash(snapshot.map)) throw new Error('Clear changed protected metadata.');
    save('cleared.json', empty);
    const restore = clone(packageValue);
    restore.expectedVersion = empty.version; restore.expectedContentHash = empty.contentHash;
    restore.recoveryTest = { phase: 'restore', clearOperationId: cleared.operationId, backupHash: report.backupHash };
    api.validate(restore); save('restore-package.json', restore);
    report.status = 'restoring'; record();
    const restored = await call(() => api.deploy(path.join(root, 'restore-package.json')));
    report.deployment = restored;
    if (restored.status !== 'verified') {
      report.status = restored.status === 'write-outcome-unknown' ? 'restore-outcome-unknown' : 'restore-failed';
      record(); throw new Error('Automatic restoration did not verify.');
    }
    const after = await call(() => api.inspect(packageValue)); save('after.json', after);
    if (hash(after.templates) !== hash(snapshot.templates) || hash(after.map) !== hash(snapshot.map)) throw new Error('Restored configuration does not match backup.');
    report.status = 'restored-and-verified'; report.restoreOperationId = restored.operations[0].operationId;
  } catch (error) {
    report.error = error.message;
    if (report.status === 'preflight') report.status = 'manual-handoff-required';
    // Unknown writes are never retried. A known failed restore may use the explicit test recovery authorization.
    if (report.clearOperationId && ['cleared', 'restore-failed'].includes(report.status)) {
      // A known clear needs a bounded safety recovery even if the normal budget expired.
      if (api.setDeadline) api.setDeadline(Date.now() + 120000);
      try { requireOk(await api.rollback(report.clearOperationId, operator, reason)); report.status = 'rolled-back-after-test-failure'; }
      catch (rollbackError) { report.rollbackError = rollbackError.message; report.status = 'rollback-outcome-unknown'; }
    }
  }
  report.elapsedMs = Date.now() - report.startedAt; record();
  return { ...report, reportPath: path.join(root, 'result.json') };
}
module.exports = { recoveryTest };
