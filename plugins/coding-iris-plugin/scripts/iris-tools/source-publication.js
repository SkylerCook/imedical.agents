'use strict';

// A publication approval identifies one reviewed commit and one remote baseline.
// It is deliberately separate from overwrite and recovery decisions.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const guard = require('./deploy-guard');
const SCHEMA = 'iris-source-publication/v1';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) :
  Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
    '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const fingerprint = value => guard.digest(canonical(value));
const samePath = (left, right) => {
  left = path.resolve(left); right = path.resolve(right);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};
const checkedHash = (value, field, nullable = false) => {
  if (nullable && value === null) return value;
  if (!/^[a-f0-9]{64}$/.test(value || '')) guard.stop('publication-invalid-hash', {field});
  return value;
};
function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {encoding: 'utf8', windowsHide: true, timeout: 30000});
  if (result.status !== 0) guard.stop('publication-git-check-failed', {operation: args[0]});
  return result.stdout.trim();
}
function freeze(input) {
  if (!input || !input.gitRoot || !/^[a-f0-9]{40,64}$/.test(input.head || '') ||
      !input.environmentAlias || !['test', 'development', 'production'].includes(input.environmentType)) guard.stop('publication-identity-required');
  const files = input.files?.map(file => {
    if (!file.path || path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..') ||
        !path.isAbsolute(file.sourcePath || '') || !file.document || !['backend', 'frontend'].includes(file.kind)) guard.stop('publication-invalid-file');
    const sourcePath = path.resolve(file.sourcePath), gitPath = file.gitPath || path.relative(input.gitRoot, sourcePath).split(path.sep).join('/');
    if (!gitPath || path.isAbsolute(gitPath) || gitPath.split(/[\\/]/).includes('..')) guard.stop('publication-file-outside-repository');
    const localSha256 = checkedHash(file.localSha256, 'localSha256');
    let artifactSha256 = file.artifactSha256;
    if (!artifactSha256) {
      const source = fs.readFileSync(sourcePath);
      if (guard.hash(source) !== localSha256) guard.stop('publication-local-source-changed', {file: file.path});
      artifactSha256 = guard.hash(file.kind === 'backend' ? Buffer.from(guard.text(source)) : source);
    }
    return {path: file.path.replace(/\\/g, '/'), sourcePath, gitPath, document: file.document, kind: file.kind,
      localSha256, artifactSha256: checkedHash(artifactSha256, 'artifactSha256'),
      remoteSha256: checkedHash(file.remoteSha256, 'remoteSha256', true), remoteTs: file.remoteTs ?? null};
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (!files?.length || new Set(files.map(file => file.path)).size !== files.length ||
      new Set(files.map(file => file.document)).size !== files.length || new Set(files.map(file => file.sourcePath)).size !== files.length) guard.stop('publication-invalid-file-set');
  const publication = {schema: SCHEMA, environmentAlias: input.environmentAlias, environmentType: input.environmentType,
    configurationFingerprint: checkedHash(input.configurationFingerprint, 'configurationFingerprint'),
    gitRoot: path.resolve(input.gitRoot), head: input.head,
    indexSha256: checkedHash(input.indexSha256 || fingerprint(git(input.gitRoot, ['ls-files', '--stage', '-v', '-z'])), 'indexSha256'), files};
  return {...publication, sha256: fingerprint(publication)};
}
function validate(publication) {
  if (publication?.schema !== SCHEMA) guard.stop('publication-schema-unsupported');
  const {sha256, ...binding} = publication;
  if (fingerprint(binding) !== sha256) guard.stop('publication-binding-changed');
  // Reconstruct to reject unknown shapes, invalid hashes and duplicate identities.
  if (freeze(binding).sha256 !== sha256) guard.stop('publication-binding-invalid');
  return publication;
}
function required(context, config = {}, options = {}) {
  const file = path.join(context.contextRoot, 'config', 'project_context_profile.md');
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const onDemand = config.contextMode === 'intent-first-on-demand-export' || /^\s*[-*]?\s*`?contextMode`?\s*[:：=]\s*`?intent-first-on-demand-export\b/mi.test(content);
  if (!onDemand) return false;
  return require('./source-sync-core').demandKind(context, options).kind === 'project';
}
function load(planPath) {
  const plan = guard.read(path.resolve(planPath));
  if (plan.schema === 'iris-source-sync/v1') return require('./source-sync-core').load(planPath).plan;
  if (plan.schema === 'iris-demand-promotion/v2') return require('./promote-demand').loadPlan(planPath);
  guard.stop('source-plan-schema-unsupported');
}
function save(plan) {
  if (plan.schema === 'iris-source-sync/v1') return require('./source-sync-core').save(plan);
  if (plan.schema === 'iris-demand-promotion/v2') return require('./promote-demand').savePlan(plan);
  guard.stop('source-plan-schema-unsupported');
}
function assertSource(publication) {
  if (git(publication.gitRoot, ['rev-parse', 'HEAD']) !== publication.head) guard.stop('publication-head-changed');
  if (fingerprint(git(publication.gitRoot, ['ls-files', '--stage', '-v', '-z'])) !== publication.indexSha256) guard.stop('publication-index-changed');
  for (const file of publication.files) {
    if (!samePath(fs.realpathSync(file.sourcePath), file.sourcePath)) guard.stop('publication-source-link-changed', {file: file.path});
    if (guard.hash(fs.readFileSync(file.sourcePath)) !== file.localSha256) guard.stop('publication-local-source-changed', {file: file.path});
    if (git(publication.gitRoot, ['status', '--porcelain', '--untracked-files=all', '--', file.gitPath])) guard.stop('publication-uncommitted-source', {file: file.path});
  }
}
function assertReady({plan, context, configurationFingerprint, files, environmentAlias, decision, kind}) {
  if (plan.state !== 'ready-to-publish') guard.stop('source-plan-review-required', {state: plan.state});
  if (!samePath(plan.contextRoot || '', context.contextRoot) || !samePath(plan.projectRoot || '', context.workspaceRoot)) guard.stop('source-plan-workspace-mismatch');
  const publication = validate(plan.publication);
  const kinds = [...new Set(publication.files.map(file => file.kind))];
  kind ||= kinds.length === 1 ? kinds[0] : null;
  if (!kinds.includes(kind)) guard.stop('publication-kind-required');
  if (plan.deploymentGroups?.[kind]?.status === 'verified') guard.stop('publication-group-already-verified', {kind});
  const declarationFile = path.join(context.contextRoot, 'config', 'iris-development.json');
  if (fs.existsSync(declarationFile)) {
    const declared = guard.read(declarationFile);
    if (declared.environmentAlias !== publication.environmentAlias || declared.environmentType !== publication.environmentType) guard.stop('publication-environment-changed');
  }
  if (publication.configurationFingerprint !== configurationFingerprint || (environmentAlias && publication.environmentAlias !== environmentAlias)) guard.stop('publication-environment-changed');
  assertSource(publication);
  const selectedFiles = publication.files.filter(file => file.kind === kind);
  if (files.length !== selectedFiles.length) guard.stop('publication-file-set-changed');
  const selected = files.map(file => {
    const published = selectedFiles.find(item => samePath(item.sourcePath, file.localPath));
    if (!published || published.document !== (file.publicationDocument || file.remotePath) || guard.hash(guard.readSource(file)) !== published.localSha256) guard.stop('publication-local-source-changed', {file: file.remotePath});
    if (git(publication.gitRoot, ['status', '--porcelain', '--untracked-files=all', '--', published.gitPath])) guard.stop('publication-uncommitted-source', {file: published.path});
    return {...file, publicationArtifactSha256: published.artifactSha256};
  });
  if (publication.environmentType === 'production') {
    if (!decision || decision.schema !== 'iris-publication-decision/v1' || decision.action !== 'publish' || decision.token !== publication.sha256) {
      guard.stop('production-approval-required', {token: publication.sha256, publication});
    }
  } else if (decision) guard.stop('publication-decision-not-applicable');
  return {publication, files: selected, kind};
}
function bindAdapter(adapter, publication, {context} = {}) {
  const checked = new Set(), originals = new Map(publication.files.map(file => [file.document, file]));
  const assertConfiguration = () => {
    if (context && fingerprint(require('./source-sync-core').projectConfiguration(context)) !== publication.configurationFingerprint) guard.stop('publication-environment-changed');
  };
  const bound = Object.create(adapter);
  bound.read = async file => {
    assertConfiguration();
    const bytes = await adapter.read(file);
    if (!checked.has(file.remotePath)) {
      if (guard.hash(bytes) !== originals.get(file.publicationDocument || file.remotePath)?.remoteSha256) guard.stop('publication-remote-baseline-changed', {file: file.remotePath});
      checked.add(file.remotePath);
    }
    return bytes;
  };
  bound.put = async file => {
    assertConfiguration();
    assertSource(publication);
    if (!checked.has(file.remotePath) || guard.hash(file.bytes) !== originals.get(file.publicationDocument || file.remotePath)?.artifactSha256) guard.stop('publication-artifact-changed', {file: file.remotePath});
    return adapter.put(file);
  };
  bound.compile = async files => { assertConfiguration(); assertSource(publication); return adapter.compile(files); };
  // Published project code has already been merged and reviewed locally.
  // The direct SFTP batch shortcut cannot provide this per-target baseline gate.
  bound.batch = undefined;
  return bound;
}
async function finalReadback(plan, kind, result, adapter) {
  const kinds = [...new Set(plan.publication.files.map(file => file.kind))];
  if (result.status !== 'verified' || kinds.some(group => group !== kind && plan.deploymentGroups?.[group]?.status !== 'verified')) return;
  const groups = {...plan.deploymentGroups, [kind]: result};
  const expected = Object.values(groups).flatMap(group => group.files || []);
  for (const file of plan.publication.files) {
    const bytes = await adapter.readPublished(file);
    const observed = bytes === null ? null : guard.hash(file.kind === 'backend' ? Buffer.from(guard.text(bytes)) : bytes);
    const recorded = expected.find(entry => entry.document === file.document);
    if (!recorded?.postCompileSha256 || observed !== recorded.postCompileSha256) {
      guard.stop('publication-final-readback-mismatch', {file: file.path});
    }
  }
  result.finalPublicationReadback = 'verified';
}
function record(planPath, result, {kind} = {}) {
  const plan = load(planPath);
  const kinds = [...new Set(plan.publication.files.map(file => file.kind))];
  kind ||= kinds.length === 1 ? kinds[0] : result.publicationKind;
  if (!kinds.includes(kind)) guard.stop('publication-kind-required');
  plan.deploymentGroups ||= {};
  plan.deploymentGroups[kind] = {...result, recordedAt: new Date().toISOString()};
  plan.deployment = {...result, recordedAt: new Date().toISOString()};
  plan.reason = result.reason || null;
  if (result.status === 'verified') {
    const pending = kinds.filter(group => plan.deploymentGroups[group]?.status !== 'verified');
    if (pending.length) {
      plan.state = 'ready-to-publish'; result.status = 'group-verified'; result.pendingPublicationGroups = pending;
      plan.deployment.status = 'group-verified'; plan.deployment.pendingPublicationGroups = pending;
    } else {
      plan.state = 'verified';
      plan.deployment.files = kinds.flatMap(group => plan.deploymentGroups[group].files);
      plan.deployment.finalPublicationReadback = result.finalPublicationReadback;
    }
  } else plan.state = result.status === 'post-compile-review' ? 'post-compile-review' : 'failed-or-unknown';
  result.sourcePlanStatus = plan.state;
  save(plan);
  return result;
}
module.exports = {SCHEMA, canonical, fingerprint, freeze, validate, required, load, save, assertSource, assertReady, bindAdapter, finalReadback, record};
