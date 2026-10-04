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
  const result = {schema: 'iris-direct-deploy/v1', mode: 'direct', status: 'checking', files: []};
  let stage = 'preflight', writing = false, activeFile;
  try {
    const names = new Set(), prepared = [];
    for (const file of files) {
      activeFile = file.remotePath;
      if (names.has(file.remotePath)) guard.stop('duplicate-remote-path', {file: file.remotePath});
      names.add(file.remotePath);
      const source = fs.readFileSync(file.localPath), local = guard.text(source);
      const remoteBytes = await adapter.read(file), remote = guard.text(remoteBytes);
      const content = prepare(file.remotePath, local, remote);
      // Frontend files keep original UTF-8 bytes, BOM and newlines.
      const bytes = kind === 'backend' ? Buffer.from(content) : source;
      prepared.push({...file, source, content, bytes, remoteBytes});
    }
    // Finish every preflight before the first write. Later failures are partial.
    for (const file of prepared) {
      stage = 'upload';
      activeFile = file.remotePath;
      if (!fs.readFileSync(file.localPath).equals(file.source)) guard.stop('local-changed-during-deploy', {file: file.remotePath});
      const latest = await adapter.read(file);
      if (guard.hash(latest) !== guard.hash(file.remoteBytes)) guard.stop('remote-changed-during-deploy', {file: file.remotePath});
      const unchanged = kind === 'backend' ? guard.text(latest) === file.content : guard.hash(latest) === guard.hash(file.bytes);
      if (!unchanged) {
        writing = true;
        await adapter.put({...file, expected: guard.hash(latest)});
        const back = await adapter.read(file);
        const matches = kind === 'backend' ? guard.text(back) === file.content : guard.hash(back) === guard.hash(file.bytes);
        if (!matches) guard.stop('readback-mismatch', {file: file.remotePath});
      }
      result.files.push({file: file.remotePath, status: unchanged ? 'unchanged' : 'uploaded', sha256: guard.hash(file.bytes)});
    }
    stage = 'compile';
    activeFile = undefined;
    // Compile unchanged documents too: an earlier compilation may have failed.
    result.compilation = await adapter.compile(prepared);
    if (result.compilation && result.compilation.status !== 'compiled') {
      return {...result, status: 'compile-failed', failedStage: stage};
    }
    return {...result, status: 'verified'};
  } catch (error) {
    return {...result, status: error.reason === 'compile-failed' ? 'compile-failed' : writing || stage === 'compile' ? 'failed-or-unknown' : 'blocked',
      reason: error.reason || 'transport-or-configuration-failed', failedStage: stage, failedFile: activeFile,
      partialOrUnknown: writing || stage === 'compile', details: error.details || {},
      message: 'No automatic retry or rollback. Inspect affected server files before continuing.'};
  }
}

module.exports = {prepare, run};
