#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {resolveWorkspaceContext, workspaceContextBlockers} = require('../../../../scripts/lib/workspace-context');
const csp = require('./compile-csp');

const inside = (file, root) => {const rel=path.relative(root,file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..'+path.sep);};
const readJson = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));

function parse(argv) {
  const args={projectRoot:process.cwd(),files:[],execute:false};
  const keys={'--project-root':'projectRoot','--source-root':'sourceRoot','--python':'python','--known-hosts':'knownHosts','--host-key-sha256':'fingerprint'};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--execute') args.execute=true;
    else if(argv[i]==='--files') {while(argv[i+1] && !argv[i+1].startsWith('--'))args.files.push(argv[++i]);}
    else if(keys[argv[i]]) {const key=keys[argv[i]]; const value=argv[++i]; if(!value || value.startsWith('--'))throw new Error('Missing option value'); args[key]=value;}
    else throw new Error('Unknown option');
  }
  if(!args.files.length)throw new Error('--files is required');
  if(args.knownHosts && args.fingerprint)throw new Error('Choose a known_hosts file or a fingerprint');
  if(args.fingerprint && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(args.fingerprint))throw new Error('Invalid fingerprint');
  return args;
}

function buildPlan(args, config, env, context) {
  let source=args.sourceRoot || env.LOCAL_PATH;
  if(!source)throw new Error('Missing LOCAL_PATH; use --source-root');
  for(const token of ['__PROJECT_ROOT__','${workspaceFolder}','${cwd}'])source=source.replaceAll(token,context.workspaceRoot);
  const requestedRoot=path.resolve(context.workspaceRoot,source);
  const root=fs.existsSync(requestedRoot)?fs.realpathSync(requestedRoot):requestedRoot;
  if(!context.sourceRoots.some(s=>inside(root,fs.realpathSync(s.target))))throw new Error('Source root outside declared workspace');
  const remote=env.REMOTE_PATH;
  if(typeof remote!=='string' || !remote.startsWith('/') || /[\\\x00-\x1f]/.test(remote) || remote.split('/').includes('..'))throw new Error('Invalid REMOTE_PATH');
  const files=[],seen=new Set();
  for(const input of args.files) {
    const requested=path.resolve(context.workspaceRoot,input);
    const immutable=context.deploymentArtifacts?.get(requested)||(fs.existsSync(requested)?context.deploymentArtifacts?.get(fs.realpathSync(requested)):undefined);
    const local=immutable?.sourcePath||(immutable?requested:fs.realpathSync(requested));
    if(!inside(local,root) || !fs.statSync(immutable?.immutablePath||local).isFile())throw new Error('Source outside upload root or not a file');
    const relative=path.relative(root,local).split(path.sep).join('/');
    if(!/^(csp|scripts|css)\//.test(relative) || !/\.(csp|js|css|html|htm)$/i.test(relative))throw new Error('Unsupported frontend path');
    const bytes=immutable?require('./deploy-guard').readSource({localPath:local,...immutable}):fs.readFileSync(local);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(text.includes('\uFFFD'))throw new Error('Replacement characters in source');
    const destination=path.posix.join(remote,relative);
    if(seen.has(destination))throw new Error('Duplicate remote destination');
    seen.add(destination);
    let document=null;
    if(/\.csp$/i.test(relative)) {
      if(!relative.startsWith('csp/'))throw new Error('CSP must be below source-root/csp');
      document=csp.plan([config.web.cspBasePath.replace(/\/$/,'')+'/'+relative.slice(4)],config.web.cspBasePath).documents[0];
    }
    const sourceGitRoot=context.sourceRoots.find(s=>inside(local,fs.realpathSync(s.target)))?.gitRoot;
    files.push({file:relative,localPath:local,...immutable,...(sourceGitRoot?{sourceGitRoot}:{}),remotePath:destination,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),document});
  }
  return {schema:'iris-frontend-deploy/v1',status:'planned',sourceRoot:root,files,documents:files.map(f=>f.document).filter(Boolean)};
}

async function uploadBatch(python, worker, env, plan) {
    const session = require('./sftp-worker').createSession(python, worker, env, {timeoutMs: 300000});
    try {
        const result = await session.request({files: plan.files});
        return {...result, transport: session.stats};
    } catch (error) {
        return {status: 'upload-failed', failedStage: 'worker', transport: error.transport || session.stats,
            files: plan.files.map((file, index) => error.fileResults?.get(index) || {
                file: file.file, status: index === error.activeIndex ? 'failed-or-unknown' : 'not-executed'
            })};
    } finally {
        await session.close();
    }
}

async function execute(plan, upload, compile) {
  const result={schema:plan.schema,status:'uploading',files:[],timings:{}};
  let tick=performance.now();
  try {
    const sent=await upload(plan);
    result.timings.uploadVerifyMs=Math.round(performance.now()-tick);
    result.files=(sent.files || []).map(file => {
      const source = plan.files.find(planned => planned.file === file.file);
      return {...file, document: file.document || source?.publicationDocument || source?.document || null,
        ...(source ? {localSha256: source.sha256} : {})};
    });
    if (sent.transport) result.transport = sent.transport;
    if(sent.status!=='verified')return {...result,status:'upload-failed',failedStage:sent.failedStage,failedFile:sent.failedFile,errorType:sent.errorType};
    // Only complete, ordered evidence for every planned file permits compilation.
    if(result.files.length!==plan.files.length || result.files.some((f,i)=>f.file!==plan.files[i].file || f.sha256!==plan.files[i].sha256 || !['uploaded','unchanged'].includes(f.status)))throw new Error('Incomplete upload verification');
    if(plan.documents.length) {
      result.status='compiling'; tick=performance.now();
      result.compilation=await compile(plan.documents);
      result.timings.compileMs=Math.round(performance.now()-tick);
      if(result.compilation.status!=='compiled')return {...result,status:'compile-failed'};
    }
    result.status='verified';
    return result;
  } catch(error) {
    return {...result,status:'failed-or-unknown',failedStage:result.status,errorType:error.name,message:'Inspect server state before retrying; completed uploads are not rolled back'};
  }
}

async function main(argv) {
  if(argv.includes('--help')) console.log('--kind standard|project: explicit task type overrides the project default. Project + on-demand mode requires a source plan; License admission remains shared.');
  if(argv.includes('--help')) {console.log('Usage: node deploy-frontend.js --project-root <project> [--source-root <frontend-root>] --files <project-relative-files...> [--python <interpreter>] [--known-hosts <file> | --host-key-sha256 <trusted-SHA256:fingerprint>] [--execute] [--mode direct|guarded] [--demand <id>] [--source-plan <reviewed-plan.json>] [--publication-decision <publish-receipt.json>] [--run-directory <run> --work-item <id> --environment-alias <alias>]\nDefault: local plan. On-demand project mode requires a reviewed source plan, a local Git commit and a separate production publication receipt. Other projects retain direct/guarded compatibility. Upload/readback precedes CSP compilation and final batch readback. Up to two safe read/confirmed-unsent upload recoveries per per-file deployment; unknown writes and compilation are never replayed.');return;}
  if (argv.some(value=>['--execute','--demand','--mode','--decision','--source-plan','--publication-decision','--kind'].includes(value))) return require('./deploy-protected').main('frontend', argv);
  const args=parse(argv), context=resolveWorkspaceContext(args.projectRoot);
  require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(context);
  if(workspaceContextBlockers(context).length)throw new Error('Invalid workspace context');
  const {config}=require('./project-env').readProjectEnv(context);
  const mcp=readJson(path.join(context.workspaceRoot,'.mcp.json'));
  require('./project-env').validateTarget(config,mcp.mcpServers?.[config.mcp?.serverName||'iris-agentic-dev']?.env||{});
  const protectedDeploy=require('./deploy-protected');
  const plan=protectedDeploy.frontendPlan(args,config,mcp,context);
  // This branch is plan-only; execution returned through deploy-protected above.
  console.log(JSON.stringify(plan));
  return;
}
module.exports={parse,buildPlan,execute,uploadBatch};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{
  if (['offline-development-remote-disabled','development-mode-invalid'].includes(error.code)) {
    console.error(JSON.stringify({schema:'iris-frontend-deploy/v1',status:'blocked',reason:error.code})); process.exitCode=1; return;
  }
  console.error(JSON.stringify({schema:'iris-frontend-deploy/v1',status:'failed-or-unknown',message:'Check input files, source root, private configuration, interpreter and SSH trust; diagnose within existing authority before requesting a user decision',commandElapsedMs:Math.round(performance.now())}));process.exitCode=1;
});
