'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function fileState(file) {
  const stat=fs.lstatSync(file,{throwIfNoEntry:false,bigint:true});
  if (!stat) return 'absent';
  if (!stat.isFile() || stat.nlink!==1n) throw Error('profile-verification-path-invalid');
  return crypto.createHash('sha256').update(fs.readFileSync(file)).update(stat.mtimeNs.toString()).digest('hex');
}
function snapshot(context) {
  const dir=path.join(context.contextRoot,'config');
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) throw Error('profile-verification-path-invalid');
  const main=path.join(dir,'project.jsonc');
  const data=require('./configuration-file-io').parse(fs.readFileSync(main,'utf8')).irisConnections;
  if (!data || !Object.hasOwn(data.profiles,data.active)) return null;
  const files=[main,path.join(dir,'project-env.json'),path.join(dir,'iris-session-backend.json'),
    path.join(dir,'iris-profile-credentials.json'),
    ...['.vscode/settings.json','.mcp.json','.iris-agentic-dev.toml'].map(f=>path.join(context.workspaceRoot,f))];
  return {file:path.join(dir,'iris-profile-verification.json'),identity:crypto.createHash('sha256').update(files.map(fileState).join('|')).digest('hex')};
}
function record(context,before,verified) {
  if (!before || snapshot(context)?.identity!==before.identity) throw Error('profile-verification-target-changed');
  const result={identity:before.identity,verified:verified===true,checkedAt:new Date().toISOString()};
  const temp=before.file+'.'+crypto.randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temp,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
    fs.renameSync(temp,before.file);
  } finally {if(fs.existsSync(temp)) fs.unlinkSync(temp);}
}
function latest(context) {
  const state=snapshot(context);
  if (!state || !fs.existsSync(state.file)) return null;
  fileState(state.file);
  const record=JSON.parse(fs.readFileSync(state.file,'utf8'));
  return record.identity===state.identity && typeof record.verified==='boolean' && Number.isFinite(Date.parse(record.checkedAt)) ?
    {verified:record.verified,checkedAt:record.checkedAt}:null;
}
module.exports={snapshot,record,latest};
