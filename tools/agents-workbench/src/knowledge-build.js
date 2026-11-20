'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { readPolicy, previewTransfer, build } = require('../../../scripts/lib/knowledge-retrieval');
const { resolveEmbedding } = require('../../../scripts/lib/knowledge-embedding');
const { resolveWorkspaceContext } = require('../../../scripts/lib/workspace-context');

const failure = code => Object.assign(new Error(code), {workbenchCode:code});

function safetyMessage(error) {
  if (error.workbenchCode) return error.workbenchCode;
  if (['knowledge-preview-stale','knowledge-build-busy'].includes(error.message)) return error.message;
  if (/^embedding-(?:config|provider)-/.test(error.message)) return 'knowledge-provider-config';
  return 'knowledge-build-unavailable';
}

function resolveBoundContext(root) {
  const context = resolveWorkspaceContext(root);
  if (context.mode !== 'standard' || context.manifestPath) throw failure('knowledge-root-required');
  const identity = [root, context.capabilityRoot, path.join(context.capabilityRoot,'.git')].map(directory => {
    const stat = fs.lstatSync(directory,{bigint:true,throwIfNoEntry:false});
    if (!stat?.isDirectory()) throw failure('knowledge-root-required');
    return [fs.realpathSync.native(directory),String(stat.dev),String(stat.ino)];
  });
  return {context,identity};
}

function isConfiguredProvider(profile) {
  const required = profile.type === 'gateway' ? [profile.baseUrl,profile.method,profile.appId,profile.appKey] : [profile.apiKey];
  return required.every(value => typeof value === 'string' && value.trim() && value.trim() !== 'TODO');
}

async function execute(root, action, secret, approved, options = {}) {
  function inputs() {
    const bound = resolveBoundContext(root);
    const profile = resolveEmbedding({provider:readPolicy(bound.context).defaultProvider,env:options.env});
    return {...bound,profile};
  }
  const {context,identity,profile} = inputs();
  const proposal = previewTransfer(context,{embedding:profile});
  const sign = (binding,embedding) => crypto.createHmac('sha256',secret)
    .update(JSON.stringify([binding,embedding,proposal.transferSnapshot])).digest('hex');
  const signature = sign(identity,profile);
  const providerReady = !proposal.pendingVectors || isConfiguredProvider(profile);
  if (action === 'preview') {
    const {provider,model,dimensions,chunks,localOnlyChunks,pendingVectors,transferDirectories,
      estimatedMaximumUsd,tokenUpperBound,priceDate} = proposal;
    return {signature,preview:{provider,model,dimensions,chunks,localOnlyChunks,pendingVectors,transferDirectories,
      estimatedMaximumUsd,tokenUpperBound,priceDate,providerReady}};
  }
  if (action !== 'start' || signature !== approved) throw failure('knowledge-preview-stale');
  if (!providerReady) throw failure('knowledge-provider-config');
  const result = await build(context,{embedding:profile,approveTransfer:proposal.transferSnapshot,
    fetch:options.fetch,onProgress:options.onProgress,shouldStop:options.shouldStop,confirmProfile:() => {
      const current = inputs();
      return sign(current.identity,current.profile) === approved;
    }});
  const {indexed,remainingVectors,embeddingTokens} = result;
  const complete = result.complete && remainingVectors === 0 && result.warnings.length === 0;
  return {complete,indexed,remainingVectors,embeddingTokens,retryable:!complete,...(result.stopped && {stopped:true})};
}

function createKnowledgeBuildService(root) {
  const secret = crypto.randomBytes(32);
  let proposal, run, stopFlag, inFlight, closing;

  function worker(action, approved, onProgress, stopBuffer) {
    return new Promise((resolve,reject) => {
      const job = new Worker(__filename,{workerData:{root,action,secret,approved,stopBuffer}});
      let result, error;
      job.on('message',message => {
        if (message.progress) onProgress?.(message.progress);
        else result = message;
      });
      job.once('error',cause => { error = cause; });
      job.once('exit',code => {
        if (error) reject(error);
        else if (code !== 0 || !result) reject(failure('knowledge-build-unavailable'));
        else if (result.error) reject(failure(result.error));
        else resolve(result.value);
      });
    });
  }

  function requestStop() {
    Atomics.store(stopFlag,0,1);
    run.stopRequested = true;
  }

  function shutdown() {
    if (!closing) {
      proposal = undefined;
      if (run?.status === 'running') requestStop();
      closing = inFlight ? inFlight.then(() => {}, () => {}) : Promise.resolve();
    }
    return closing;
  }

  async function handle(data, observation) {
    try {
      if (data.action === 'status') return {run};
      if (data.action === 'stop') {
        if (run?.status !== 'running' || data.runId !== run.runId) throw failure('knowledge-run-changed');
        requestStop();
        return {run};
      }
      if (closing) throw failure('knowledge-shutting-down');
      if (inFlight) throw failure('knowledge-build-busy');
      if (observation.status !== 'standard') throw failure('knowledge-root-required');
      if (data.action === 'preview') {
        proposal = undefined;
        inFlight = worker('preview');
        try {
          const {signature,preview} = await inFlight;
          if (closing) throw failure('knowledge-shutting-down');
          proposal = {signature,revision:observation.revision,binding:observation.binding,id:crypto.randomUUID()};
          return {planId:proposal.id,preview};
        } finally { inFlight = undefined; }
      }
      if (!proposal || data.planId !== proposal.id || observation.revision !== proposal.revision ||
          observation.binding !== proposal.binding) throw failure('knowledge-preview-stale');
      const approved = proposal.signature;
      proposal = undefined;
      stopFlag = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      run = {status:'running',runId:crypto.randomUUID()};
      inFlight = worker('start',approved,progress => { run.progress = progress; },stopFlag.buffer).then(result => {
        run = {status:result.complete?'complete':result.stopped?'paused':'partial',...result};
      }).catch(error => { run = {status:'failed',error:safetyMessage(error)}; }).finally(() => {
        inFlight = undefined;
        stopFlag = undefined;
      });
      return {run};
    } catch (error) { return {error:safetyMessage(error)}; }
  }

  return {handle,shutdown};
}

module.exports = { createKnowledgeBuildService, execute };

if (!isMainThread) {
  const {root,action,secret,approved,stopBuffer} = workerData;
  const stopFlag = stopBuffer ? new Int32Array(stopBuffer) : null;
  void execute(root,action,secret,approved,{
    onProgress:progress => parentPort.postMessage({progress}),
    shouldStop:stopFlag ? () => Atomics.load(stopFlag,0) === 1 : undefined,
  })
    .then(value => parentPort.postMessage({value}), error => parentPort.postMessage({error:safetyMessage(error)}));
}
