'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DeploymentBudget, validateOverwrite } = require('./cure-form-deployment-policy');
const { privateRoot } = require('./cure-form-workspace');
const { writeHandoff } = require('./cure-form-manual-handoff');
const { compareContract } = require('./cure-form-contract-check');
const { McpClient, buildServerArgs, findWorkspaceRoot } = require('./cure-form-staged-transport');
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(stable(v)), 'utf8').digest('hex');
const TABLE = 'SQLUser.DHC_DocAppBLTemple';
const MAP = 'SQLUser.DHC_DocAppBLMap';
const REF = "('||' || COALESCE(APPMap_ShowTemp,'') || '||') LIKE ?";
const READ = 'SELECT RowID AS rowId, APP_Name AS name, APP_Type AS type, APP_Content AS content, APP_ID AS appId, APP_JSStr AS js, APP_MapType AS mapType, APP_LastID AS lastId FROM ' + TABLE + ' WHERE RowID = ?';
const REFERENCES = 'SELECT RowID AS rowId, APPMap_Code AS code, APPMap_ShowTemp AS showTemp, APPMap_ShowJS AS showJS, APPMap_MapType AS mapType FROM ' + MAP + ' WHERE ' + REF;
// Fixed SQL only: content is never concatenated into SQL; no arbitrary table/column/query inputs.
const UPDATE = 'UPDATE ' + TABLE + ' SET APP_Content = ? WHERE RowID = ? AND APP_MapType = ? AND %EXACT(COALESCE(APP_Content,CHAR(0))) = %EXACT(COALESCE(?,CHAR(0))) AND COALESCE(LENGTH(APP_Content),0) = COALESCE(LENGTH(?),0)' +
 ' AND (SELECT COUNT(*) FROM ' + MAP + ' WHERE ' + REF + ') = 1' +
 ' AND EXISTS (SELECT 1 FROM ' + MAP + ' WHERE RowID = ? AND APPMap_MapType = ? AND %EXACT(APPMap_Code) = %EXACT(?) AND %EXACT(APPMap_ShowTemp) = %EXACT(?) AND LENGTH(APPMap_ShowTemp) = LENGTH(?) AND %EXACT(COALESCE(APPMap_ShowJS,CHAR(0))) = %EXACT(COALESCE(?,CHAR(0))) AND COALESCE(LENGTH(APPMap_ShowJS),0) = COALESCE(LENGTH(?),0))';
const normalize = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)]));
const selectedTemplate = (t) => normalize(Object.fromEntries(['rowId','name','type','content','appId','js','mapType','lastId'].map(k=>[k,t[k]])));
const selectedMap = (m) => normalize(Object.fromEntries(['rowId','code','showTemp','showJS','mapType'].map(k=>[k,m[k]])));

function targetOf(pkg, snapshot) {
 if (pkg.expectedVersion === 'NEW' || pkg.changes.strategy !== 'in-place-overwrite') throw new Error('Lightweight SQL requires existing in-place-overwrite.');
 validateOverwrite(pkg.changes, snapshot);
 if (snapshot.formType !== pkg.formType || snapshot.mapCode !== pkg.mapCode || hash(snapshot) !== pkg.sourceSnapshotHash) throw new Error('Snapshot is not bound to this package.');
 const targets = pkg.changes.templates.filter(t=>!t.referenceOnly);
 if (targets.length !== 1) throw new Error('Lightweight SQL accepts exactly one target template.');
 const target = targets[0], before = snapshot.templates.find(t=>String(t.rowId)===String(target.rowId));
 if (Object.keys(target).some(k=>!['rowId','sourceTemplateRowId','content'].includes(k))) throw new Error('Lightweight SQL changes content only.');
 if (!target.content || !target.content.trim()) throw new Error('Lightweight SQL never clears content.');
 if (Object.keys(pkg.changes.map || {}).some(k => JSON.stringify(pkg.changes.map[k]) !== JSON.stringify(snapshot.map[k]))) throw new Error('Map changes require the full transaction-package channel.');
 if (!before || !['CA','CR'].includes(before.mapType) || before.mapType !== pkg.formType) throw new Error('Invalid target template type.');
 if (compareContract(before.content, target.content).status !== 'passed') throw new Error('Runtime field contract changed.');
 return { target, before: selectedTemplate(before), map: selectedMap(snapshot.map) };
}

function resultOf(response) {
 if (response.error || response.result?.isError) throw new Error('MCP SQL failed; inspect private diagnostics.');
 const value = response.result?.structuredContent || JSON.parse(response.result?.content?.find(c=>c.type==='text')?.text || '{}');
 if (value.success !== true || value.truncated || value.is_truncated || value.has_more) throw new Error('SQL response failed or was truncated.');
 return value;
}

async function connectSql(budget) {
 const root = findWorkspaceRoot();
 const server = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')).mcpServers?.['iris-agentic-dev'];
 if (!server?.env?.IRIS_NAMESPACE) throw new Error('Configured IRIS server and namespace required.');
 const client = new McpClient(server.command, buildServerArgs(root, server), root, server.env);
 client.budget = budget;
 try {
  await client.request('initialize', {protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'cure-form-sql-cover',version:'1'}});
  client.notify('notifications/initialized', {});
  const listed = await client.request('tools/list', {});
  const props = listed.result?.tools?.find(t=>t.name==='iris_query')?.inputSchema?.properties;
  if (!props?.parameters || !props.mode || !props.max_rows_affected) throw new Error('MCP lacks parameterized bounded SQL write schema.');
  if (!listed.result?.tools?.some(t=>t.name==='iris_execute')) throw new Error('MCP lacks fixed SQL binding transport.');
  return {
   async query(query, parameters, writing = false) {
    if (![READ, REFERENCES, UPDATE].includes(query) || writing !== (query===UPDATE)) throw new Error('SQL is outside the fixed channel allowlist.');
    if(writing) return require('./cure-form-sql-binding').executeBoundUpdate(client,server.env.IRIS_NAMESPACE,parameters);
    return resultOf(await client.request('tools/call', {name:'iris_query',arguments:{query,parameters,namespace:server.env.IRIS_NAMESPACE,mode:writing?'write':'read',...(writing?{max_rows_affected:1}:{})}}, 30000));
   },
   close:()=>client.close()
  };
 } catch (e) {client.close();throw e;}
}

async function sqlCover({ packageValue, snapshot, outputRoot, mode = 'manual', confirmWrite, confirmRemoteExecution, operator, reason, connect = connectSql, budgetOptions }, validatePackage) {
 if (!['manual','automatic'].includes(mode)) throw new Error('Unknown deployment mode.');
 validatePackage(packageValue, false);
 const {target,before,map} = targetOf(packageValue,snapshot);
 const handoff = writeHandoff(packageValue,path.join(outputRoot,packageValue.mapCode,'manual-deploy'));
 if (mode==='manual') return {status:'manual-ready',channel:'lightweight-sql',label:'轻量 SQL 覆盖',handoff,serverWrite:false};
 if (!confirmWrite || !confirmRemoteExecution || !operator || !reason) throw new Error('Automatic SQL requires explicit write/remote confirmation, operator and reason.');
 const privateDir=path.join(privateRoot({workRoot:outputRoot}),'sql-cover');
 fs.mkdirSync(privateDir,{recursive:true});
 const reportPath=path.join(privateDir,'result.json');
 const fd=fs.openSync(reportPath,'wx');fs.closeSync(fd);
 const budget=new DeploymentBudget({idleMs:60000,totalMs:120000,...budgetOptions});
 const report={schema:'cure-form-sql-cover-result/v1',channel:'lightweight-sql',writeTransport:'mcp-fixed-sql-binding',status:'preflight',auditId:crypto.randomUUID(),auditMode:'local-only',operationId:null,mapCode:packageValue.mapCode,rowId:target.rowId,operator,reason,startedAt:Date.now(),packageHash:hash(packageValue),backupHash:null,handoff};
 const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 save();let api;
 const pattern='%||'+target.rowId+'||%';
 const read=async()=>{
  budget.check();
  const templates=await api.query(READ,[String(target.rowId)]);
  const refs=await api.query(REFERENCES,[pattern]);
  if (!Array.isArray(templates.rows)||templates.rows.length!==1||!Array.isArray(refs.rows)||refs.rows.length!==1) throw new Error('Missing target or shared template; use full transaction channel.');
  const value={template:normalize(templates.rows[0]),map:normalize(refs.rows[0])};
  if (value.template.rowId!==String(target.rowId)||value.map.code!==packageValue.mapCode) throw new Error('SQL identity mismatch.');
  return value;
 };
 try {
  api=await connect(budget);
  const baseline=await read();
  if (hash(baseline.template)!==hash(before)||hash(baseline.map)!==hash(map)) throw new Error('Current SQL baseline differs from approved snapshot.');
  const backupFile=path.join(privateDir,'before.json');
  fs.writeFileSync(backupFile,JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});
  report.backupHash=hash(baseline);
  if(hash(JSON.parse(fs.readFileSync(backupFile,'utf8')))!==report.backupHash) throw new Error('Backup readback mismatch.');
  const desired={template:{...before,content:target.content},map};
  fs.writeFileSync(path.join(privateDir,'desired.json'),JSON.stringify(desired,null,2)+'\n',{flag:'wx'});
  budget.progress();
  if (before.content===target.content) {report.status='unchanged';report.serverWrite=false;report.elapsedMs=Date.now()-report.startedAt;return {...report,reportPath};}
  budget.check();budget.writeStarted=true;report.status='write-outcome-unknown';save();
  const result=await api.query(UPDATE,[target.content,String(target.rowId),packageValue.formType,before.content,before.content,pattern,map.rowId,packageValue.formType,map.code,map.showTemp,map.showTemp,map.showJS,map.showJS],true);
  const affected=result.rows_affected ?? result.affected_rows ?? result.affectedRows;
  if(affected===0) {report.status='concurrency-conflict';throw new Error('Conditional UPDATE affected zero rows.');}
  if(affected!==1) throw new Error('UPDATE did not confirm exactly one affected row; do not retry.');
  report.status='applied';save();budget.writeStarted=false;budget.progress();
  const after=await read();fs.writeFileSync(path.join(privateDir,'after.json'),JSON.stringify(after,null,2)+'\n',{flag:'wx'});
  if(hash(after)!==hash(desired)) {report.status='verification-failed';throw new Error('SQL readback differs from desired content or protected metadata.');}
  report.status='verified';report.contentHash=hash(after.template.content);report.serverWrite=true;
 } catch(e) {
  if(report.status==='preflight')report.status='manual-handoff-required';
  if(report.status==='applied')report.status='verification-unavailable';
  report.error=e.message; // Do not include SQL payloads, credentials or raw transport errors.
 } finally {
  if(api)api.close();
  report.elapsedMs=Date.now()-report.startedAt;save();
 }
 return {...report,reportPath};
}
module.exports={sqlCover,targetOf,connectSql,resultOf,READ,REFERENCES,UPDATE,hash};
