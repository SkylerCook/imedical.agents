#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {resolveWorkspaceContext, validateWorkspaceContext} = require('../../../../scripts/lib/workspace-context');
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
  const root=fs.realpathSync(path.resolve(context.workspaceRoot,source));
  if(!context.sourceRoots.some(s=>inside(root,fs.realpathSync(s.target))))throw new Error('Source root outside declared workspace');
  const remote=env.REMOTE_PATH;
  if(typeof remote!=='string' || !remote.startsWith('/') || /[\\\x00-\x1f]/.test(remote) || remote.split('/').includes('..'))throw new Error('Invalid REMOTE_PATH');
  const files=[],seen=new Set();
  for(const input of args.files) {
    const local=fs.realpathSync(path.resolve(context.workspaceRoot,input));
    if(!inside(local,root) || !fs.statSync(local).isFile())throw new Error('Source outside upload root or not a file');
    const relative=path.relative(root,local).split(path.sep).join('/');
    if(!/^(csp|scripts|css)\//.test(relative) || !/\.(csp|js|css|html|htm)$/i.test(relative))throw new Error('Unsupported frontend path');
    const bytes=fs.readFileSync(local);
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
    files.push({file:relative,localPath:local,remotePath:destination,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),document});
  }
  return {schema:'iris-frontend-deploy/v1',status:'planned',sourceRoot:root,files,documents:files.map(f=>f.document).filter(Boolean)};
}

function uploadBatch(python, worker, env, plan) {
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-B',worker],{cwd:env.CODEX_WORKSPACE,env:{...process.env,...env,PYTHONDONTWRITEBYTECODE:'1',ALLOW_REMOTE_COMMANDS:'false'},stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output='',errorBytes=0;
    const deadline=setTimeout(()=>{child.kill();reject(new Error('Upload deadline exceeded; outcome unknown'));},300000);
    child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>4*1024*1024){child.kill();reject(new Error('Worker output too large'));}});
    child.stderr.on('data',chunk=>{errorBytes+=chunk.length;}); // Never print credentials from third-party diagnostics.
    child.stdin.on('error',()=>{});
    child.on('error',error=>{clearTimeout(deadline);reject(error);});
    child.on('close',code=>{
      clearTimeout(deadline);
      try {
        const result=JSON.parse(output);
        if(code!==0 && result.status==='verified')throw new Error('Worker failed after upload');
        resolve(result);
      } catch {reject(new Error(errorBytes?'Upload worker failed; check interpreter/dependencies and server state':'Invalid worker response'));}
    });
    child.stdin.end(JSON.stringify({files:plan.files}));
  });
}

async function execute(plan, upload, compile) {
  const result={schema:plan.schema,status:'uploading',files:[],timings:{}};
  let tick=performance.now();
  try {
    const sent=await upload(plan);
    result.timings.uploadVerifyMs=Math.round(performance.now()-tick);
    result.files=sent.files || [];
    if(sent.status!=='verified')return {...result,status:'upload-failed',errorType:sent.errorType};
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
  if(argv.includes('--help')) {console.log('Usage: node deploy-frontend.js --project-root <project> [--source-root <frontend-root>] --files <project-relative-files...> [--python <interpreter>] [--known-hosts <file> | --host-key-sha256 <trusted-SHA256:fingerprint>] [--execute]\nDefault: local plan. Execute: one SFTP connection, hash comparison/upload/readback, then one Atelier CSP compilation. No temporary scripts; no retries.');return;}
  const args=parse(argv), context=resolveWorkspaceContext(args.projectRoot);
  if(validateWorkspaceContext(context).some(r=>['manifest-invalid','schema-version-unsupported'].includes(r.status)))throw new Error('Invalid workspace context');
  const config=readJson(path.join(context.contextRoot,'config/project-env.json'));
  const mcp=readJson(path.join(context.workspaceRoot,'.mcp.json'));
  const server=mcp.mcpServers?.[config.sftp?.serverName || 'sftp-server'];
  if(!server || server.disabled===true)throw new Error('SFTP configuration missing or disabled');
  const env={...server.env};
  const plan=buildPlan(args,config,env,context);
  if(!args.execute){console.log(JSON.stringify(plan));return;}
  // Resolve compiler configuration before any upload, so missing settings cannot cause partial deployment.
  const connection=plan.documents.length?csp.connection(config,mcp):null;
  const worker=path.resolve(__dirname,'../../../../vendor/sftp-server/src/upload-batch.py');
  if(!fs.existsSync(worker))throw new Error('Bundled upload worker missing');
  env.LOCAL_PATH=plan.sourceRoot;
  env.CODEX_WORKSPACE=context.workspaceRoot;
  if(args.knownHosts){env.TARGET_KNOWN_HOSTS=path.resolve(context.workspaceRoot,args.knownHosts);delete env.TARGET_HOST_KEY_SHA256;}
  if(args.fingerprint){env.TARGET_HOST_KEY_SHA256=args.fingerprint;delete env.TARGET_KNOWN_HOSTS;}
  const result=await execute(plan,p=>uploadBatch(args.python || server.command,worker,env,p),documents=>csp.compile(connection,csp.plan(documents,config.web.cspBasePath)));
  result.timings.commandElapsedMs=Math.round(performance.now());
  result.timings.scope='command-only; excludes conversation and approval wait';
  const passwords=[env.TARGET_PASSWORD,connection?.auth?.slice(connection.auth.indexOf(':')+1)].filter(Boolean);
  console.log(JSON.stringify(result,(_,value)=>typeof value==='string'?passwords.reduce((s,p)=>s.split(p).join('[redacted]'),value):value));
  if(result.status!=='verified')process.exitCode=1;
}
module.exports={parse,buildPlan,execute,uploadBatch};
if(require.main===module)main(process.argv.slice(2)).catch(()=>{
  console.error(JSON.stringify({schema:'iris-frontend-deploy/v1',status:'failed-or-unknown',message:'Check input files, source root, private configuration, interpreter and SSH trust; no automatic retry',commandElapsedMs:Math.round(performance.now())}));process.exitCode=1;
});
