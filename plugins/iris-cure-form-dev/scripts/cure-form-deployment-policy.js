'use strict';

// A single budget spans preflight, staging, apply, and verification.
class DeploymentBudget {
  constructor({ now = Date.now, startedAt, idleMs = 300000, totalMs = 900000 } = {}) {
    if (![idleMs, totalMs].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Invalid deployment budget.');
    this.now = now;
    this.startedAt = startedAt == null ? now() : startedAt;
    this.progressAt = this.startedAt;
    this.idleMs = idleMs;
    this.totalMs = totalMs;
    this.writeStarted = false;
  }
  remaining() {
    return Math.max(0, Math.min(this.totalMs - (this.now() - this.startedAt), this.idleMs - (this.now() - this.progressAt)));
  }
  check() {
    if (this.remaining() === 0) {
      const error = new Error(this.writeStarted ? 'write-outcome-unknown' : 'manual-handoff-required');
      error.code = error.message;
      throw error;
    }
  }
  progress() { this.check(); this.progressAt = this.now(); }
}

function selectDeployment({ mode = 'manual', strategy = 'versioned-clone', assets = 'manual', channel = 'transaction-package' } = {}) {
  if (!['automatic', 'manual'].includes(mode)) throw new Error('Deployment mode must be automatic or manual.');
  if (!['versioned-clone', 'in-place-overwrite'].includes(strategy)) throw new Error('Unsupported deployment strategy.');
  if (!['automatic', 'manual'].includes(assets)) throw new Error('Asset deployment must be automatic or manual.');
  if (!['transaction-package', 'lightweight-sql'].includes(channel)) throw new Error('Unknown deployment channel.');
  return { mode, strategy, assets, channel, idleTimeoutMs: channel === 'lightweight-sql' ? 60000 : 300000, totalTimeoutMs: channel === 'lightweight-sql' ? 120000 : 900000 };
}

function validateOverwrite(changes, snapshot) {
  if (changes.strategy !== 'in-place-overwrite') return;
  if (!snapshot || !snapshot.exists || !snapshot.map || !Array.isArray(snapshot.templates)) throw new Error('Overwrite requires an existing server snapshot.');
  const ids = changes.templates.map((item) => String(item.rowId || ''));
  if (ids.join('||') !== snapshot.map.showTemp || ids.some((id) => !/^\d+$/.test(id))) throw new Error('Overwrite must preserve the exact Map composition.');
  if (changes.templateCategory) throw new Error('Overwrite cannot change template category.');
  for (const template of changes.templates) {
    const before = snapshot.templates.find((item) => String(item.rowId) === String(template.rowId));
    if (!before) throw new Error('Overwrite target was not in the snapshot.');
    if (template.sourceTemplateRowId != null && String(template.sourceTemplateRowId) !== String(template.rowId)) throw new Error('Overwrite cannot replace its source template identity.');
    if (template.referenceOnly) {
      if ('content' in template || 'items' in template) throw new Error('Reference-only template must not carry content or items.');
      continue;
    }
    if (typeof template.content !== 'string') throw new Error('Overwrite content must be a string.');
    for (const key of Object.keys(template)) {
      if (['rowId', 'sourceTemplateRowId', 'content'].includes(key)) continue;
      if (JSON.stringify(template[key]) !== JSON.stringify(before[key])) throw new Error(`Overwrite changes protected template field: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(changes.map || {})) {
    if (key !== 'showJS' && JSON.stringify(value) !== JSON.stringify(snapshot.map[key])) throw new Error(`Overwrite changes protected Map field: ${key}`);
  }
}

module.exports = { DeploymentBudget, selectDeployment, validateOverwrite };
