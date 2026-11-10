'use strict';
// Development deployment uses explicit files without a Git baseline session.
const fs = require('node:fs');
const guard = require('./deploy-guard');

function prepare(file, local, remote) {
  if (!/\.cls$/i.test(file)) {
    guard.validate(file, local, local, local);
    return local;
  }
  const ownStorage = guard.storage(local), serverStorage = guard.storage(remote);
  if (remote !== null && ownStorage && ownStorage !== serverStorage) {
    guard.stop('storage-review-required', {file});
  }
  let content = local;
  if (!ownStorage && serverStorage) {
    if (!/\}\s*$/.test(local)) guard.stop('storage-format-unknown', {file});
    content = local.replace(/\}\s*$/, serverStorage + '\n\n}\n');
  }
  guard.validate(file, content, content, content);
  return content;
}

async function run({files, adapter, kind}) {
  adapter = require('./deploy-recovery').wrap(adapter);
  const result = {schema: 'iris-direct-deploy/v1', mode: 'direct', status: 'checking', files: [], recovery: adapter.deploymentRecovery};
  let stage = 'preflight', writing = false, activeFile, compiled = false;
  const storageSynced = [];
  try {
    const names = new Set(), prepared = [];
    for (const file of files) {
      activeFile = file.remotePath;
      if (names.has(file.remotePath)) guard.stop('duplicate-remote-path', {file: file.remotePath});
      names.add(file.remotePath);
      const source = guard.readSource(file), local = guard.text(source);
      const remoteBytes = await adapter.read(file), remote = guard.text(remoteBytes);
      const content = prepare(file.remotePath, local, remote);
      // Frontend files keep original UTF-8 bytes, BOM and newlines.
      const bytes = kind === 'backend' ? Buffer.from(content) : source;
      if (file.publicationArtifactSha256 && guard.hash(bytes) !== file.publicationArtifactSha256) guard.stop('publication-artifact-changed', {file: file.remotePath});
      prepared.push({...file, source, content, bytes, remoteBytes});
    }
    // Finish every preflight before the first write. Later failures are partial.
    for (const file of prepared) {
      stage = 'upload';
      activeFile = file.remotePath;
      if (!guard.readSource(file).equals(file.source)) guard.stop('local-changed-during-deploy', {file: file.remotePath});
      const latest = await adapter.read(file);
      if (guard.hash(latest) !== guard.hash(file.remoteBytes)) guard.stop('remote-changed-during-deploy', {file: file.remotePath});
      if (!guard.readSource(file).equals(file.source)) guard.stop('local-changed-during-deploy', {file: file.remotePath});
      const unchanged = kind === 'backend' ? guard.text(latest) === file.content : guard.hash(latest) === guard.hash(file.bytes);
      if (!unchanged) {
        const earlierWriting = writing;
        writing = true;
        try { await adapter.put({...file, expected: guard.hash(latest)}); }
        catch (error) { if (error.beforeSend === true) writing = earlierWriting; throw error; }
        const back = await adapter.read(file);
        const matches = kind === 'backend' ? guard.text(back) === file.content : guard.hash(back) === guard.hash(file.bytes);
        if (!matches) guard.stop('readback-mismatch', {file: file.remotePath});
      }
      result.files.push({file: file.remotePath, document: file.publicationDocument || file.document || file.remotePath,
        status: unchanged ? 'unchanged' : 'uploaded', sha256: guard.hash(file.bytes), uploadSha256: guard.hash(file.bytes), localSha256: guard.hash(file.source)});
    }
    stage = 'compile';
    activeFile = undefined;
    // Compile unchanged documents too: an earlier compilation may have failed.
    result.compilation = await adapter.compile(prepared);
    if (result.compilation && result.compilation.status !== 'compiled') {
      return {...result, status: 'compile-failed', failedStage: stage};
    }
    compiled = true;
    result.remoteCompilation = result.compilation ? 'compiled' : 'not-required';
    if (kind === 'backend') {
      stage = 'post-compile';
      const plans = await require('./storage-sync').reconcile(prepared, adapter, {
        onFile: file => { activeFile = file.remotePath; },
        onSynced: plan => { storageSynced.push(plan.file.remotePath); }
      });
      result.localStorageSync = {status: 'verified', files: storageSynced};
      result.files = result.files.map((file, i) => ({...file, sha256: guard.hash(plans[i].compiled), postCompileSha256: guard.hash(plans[i].compiled), localSha256: guard.hash(plans[i].bytes), storageSynced: plans[i].synced}));
    } else {
      // Compilation may change an earlier verified Web document. Check the
      // entire final batch, including JS/CSS, after all compile actions finish.
      stage = 'post-compile';
      for (const file of prepared) {
        activeFile = file.remotePath;
        const back = await adapter.read(file);
        if (guard.hash(back) !== guard.hash(file.bytes)) guard.stop('post-compile-source-changed', {file: file.remotePath});
        if (!guard.readSource(file).equals(file.source)) guard.stop('local-changed-during-deploy', {file: file.remotePath});
        result.files.find(item => item.file === file.remotePath).postCompileSha256 = guard.hash(back);
      }
    }
    return {...result, status: 'verified'};
  } catch (error) {
    const knownUnsent = error.deploymentOperation === 'put' && error.beforeSend === true && require('./deploy-recovery').transient(error);
    if (!knownUnsent && (writing || stage === 'compile' || compiled) && error.reason !== 'compile-failed' &&
        !(compiled && /^(?:local-|frozen-storage-sync-requires-source-review)/.test(error.reason || ''))) {
      // A semantic readback failure is as important as a lost HTTP response.
      // Keep the participating pool closed until this attempt is reconciled.
      try {adapter.markUnknown?.(error.reason || error.code || 'deployment-outcome-unknown');} catch {}
    }
    return {...result, status: knownUnsent ? 'blocked' : compiled ? (kind === 'backend' ? 'storage-sync-incomplete' : 'failed-or-unknown') : error.reason === 'compile-failed' ? 'compile-failed' : writing || stage === 'compile' ? 'failed-or-unknown' : 'blocked',
      reason: error.reason || error.code || 'transport-or-configuration-failed', failedStage: stage, failedFile: activeFile,
      partialOrUnknown: writing || stage === 'compile' || compiled, details: error.details || {},
      ...(compiled ? {remoteCompilation: 'compiled', localStorageSync: {status: 'incomplete', files: storageSynced}} : {}),
      message: 'Safe recovery exhausted or inapplicable. Inspect affected server files; unknown writes and compilation are not replayed.'};
  }
}

module.exports = {prepare, run};
