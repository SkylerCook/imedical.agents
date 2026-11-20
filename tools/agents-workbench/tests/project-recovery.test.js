'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { createFrameworkService } = require('../src/framework-service');
const { readReceipts } = require('../../ai-dev-offline/configure-project');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function writeFixtureReceipt(root, id, receipt, updated) {
  const directory = path.join(root, '.ai-dev-config-backups', id);
  fs.mkdirSync(directory, { recursive:true });
  const file = path.join(directory, 'receipt.json');
  fs.writeFileSync(file, JSON.stringify(receipt));
  if (updated) fs.utimesSync(file, updated, updated);
  return file;
}

function fixture(t) {
  const root = createTempDirectory('workbench-project-recovery-');
  t.after(() => {
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive:true, force:true, maxRetries:3 });
  });
  const first = path.join(root, '.mcp.json');
  const second = path.join(root, '.iris-agentic-dev.toml');
  const originalPassword = randomUUID();
  const changedPassword = randomUUID();
  const original = '\uFEFF' + JSON.stringify({password:originalPassword},null,2).replace(/\n/g,'\r\n') + '\r\n';
  const changed = JSON.stringify({password:changedPassword});
  fs.writeFileSync(first, changed);
  const id = randomUUID();
  const receipt = {schema:1, tool:'ai-dev-project', state:'prepared', projectRoot:root, entries:[
    {file:first,beforeHash:hash(original),afterHash:hash(changed),original:Buffer.from(original).toString('base64')},
    {file:second,beforeHash:'absent',afterHash:hash('target = "fixture"'),original:''},
  ]};
  const file = writeFixtureReceipt(root, id, receipt);
  return {root,first,second,file,id,receipt,original,changed,originalPassword,changedPassword};
}

function assertPrivateReceiptDataOmitted(row, fixture) {
  const summary = JSON.stringify(row);
  assert.doesNotMatch(summary, /beforeHash|afterHash|projectRoot|\.mcp\.json/);
  assert.ok(!summary.includes(fixture.originalPassword));
  assert.ok(!summary.includes(fixture.changedPassword));
}

test('receipt summaries are read-only and omit backup data, paths and arbitrary states', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file);
  const {receipts:[row]} = readReceipts(f.root);
  assert.equal(row.id, f.id);
  assert.equal(row.state, 'prepared');
  assert.equal(row.files, 2);
  assert.equal(row.recovery, process.platform === 'win32' ? 'available' : 'unsupported');
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(fs.readFileSync(f.first,'utf8'), f.changed);
  assertPrivateReceiptDataOmitted(row, f);

  fs.writeFileSync(f.first, 'independent external edit');
  assert.equal(readReceipts(f.root).receipts[0].recovery, 'conflict');
  fs.writeFileSync(f.first, f.original);
  assert.equal(readReceipts(f.root).receipts[0].recovery, 'unchanged');
  fs.writeFileSync(f.first, f.changed);
  fs.writeFileSync(f.second, 'target = "fixture"');
  assert.equal(readReceipts(f.root).receipts[0].recovery, 'review-required');

  const linkedId = randomUUID();
  const linkedDir = path.join(path.dirname(path.dirname(f.file)),linkedId);
  fs.mkdirSync(linkedDir);
  fs.linkSync(f.file,path.join(linkedDir,'receipt.json'));
  assert.deepEqual(readReceipts(f.root),{receipts:[],receiptIssue:true});
  fs.unlinkSync(path.join(linkedDir,'receipt.json'));
  fs.writeFileSync(f.file,JSON.stringify({...f.receipt,state:'fixture-private-unexpected-state'}));
  assert.deepEqual(readReceipts(f.root),{receipts:[],receiptIssue:true});
});

async function recoverySession(t, f) {
  const service = createFrameworkService(f.root, {releaseUpdate:{available:false}});
  const server = http.createServer((req,res) => service.handle(req,res,req.url.slice(1),origin).catch(err=>res.destroy(err)));
  let origin;
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
  const headers = {'content-type':'application/json',origin,'x-workbench-request':'1'};
  const post = async (route, body, added) => {
    const response = await fetch(`${origin}/framework/${route}`, {method:'POST',headers:{...headers,...added},body:JSON.stringify(body)});
    return [response.status,await response.json(),response.headers.get('set-cookie')];
  };
  const [,session,cookie] = await post('session',{token:service.bootstrap});
  const auth = {cookie:cookie.split(';')[0],'x-workbench-csrf':session.csrf};
  const {projectId} = await (await fetch(origin+'/framework.json',{headers})).json();
  return {service, post, auth, projectId};
}

test('an authenticated bound window restores one prepared receipt after checking current files', {skip:process.platform!=='win32'}, async t => {
  const f = fixture(t);
  const {service, post, auth, projectId} = await recoverySession(t, f);
  const {recoveryToken} = readReceipts(f.root,service.signRecovery).receipts[0];
  assert.match(recoveryToken,/^[a-f0-9]{64}$/);
  const withoutToken = {projectId,revision:null,receiptId:f.id};
  const request = {...withoutToken,recoveryToken};
  const recover = 'recover-project-config';
  assert.deepEqual((await post(recover,request)).slice(0,2),[403,{error:'session-required'}]);
  assert.deepEqual((await post(recover,{...request,receiptId:'../receipt.json'},auth)).slice(0,2),[400,{error:'invalid-action'}]);
  assert.deepEqual((await post(recover,{...request,receiptFile:f.file},auth)).slice(0,2),[400,{error:'invalid-action'}]);
  assert.deepEqual((await post(recover,withoutToken,auth)).slice(0,2),[400,{error:'invalid-action'}]);
  assert.deepEqual((await post(recover,{...request,projectId:'wrong-project'},auth)).slice(0,2),[409,{error:'binding-mismatch'}]);
  assert.deepEqual((await post(recover,{...request,revision:'old'},auth)).slice(0,2),[409,{error:'stale-observation'}]);
  assert.deepEqual((await post(recover,{...request,recoveryToken:'0'.repeat(64)},auth)).slice(0,2),[409,{error:'project-recovery-conflict'}]);
  fs.writeFileSync(f.second,'target = "fixture"');
  assert.deepEqual((await post(recover,request,auth)).slice(0,2),[409,{error:'project-recovery-not-available'}]);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.changed);
  assert.equal(fs.readFileSync(f.second,'utf8'),'target = "fixture"');
  fs.writeFileSync(f.first,f.original);
  // The number of partial writes is unchanged, but the file that would be restored is different.
  assert.equal(readReceipts(f.root,service.signRecovery).receipts[0].restoreFiles,1);
  assert.deepEqual((await post(recover,request,auth)).slice(0,2),[409,{error:'project-recovery-conflict'}]);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.original);
  assert.equal(fs.readFileSync(f.second,'utf8'),'target = "fixture"');
  fs.writeFileSync(f.first,f.changed);
  fs.writeFileSync(f.second,'target = "other"');
  assert.deepEqual((await post(recover,request,auth)).slice(0,2),[409,{error:'project-recovery-conflict'}]);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.changed);
  assert.equal(fs.readFileSync(f.second,'utf8'),'target = "other"');
  fs.unlinkSync(f.second);

  const git = (...args) => execFileSync('git',['-C',f.root,...args],{windowsHide:true});
  git('init','-q');
  fs.writeFileSync(path.join(f.root,'.gitignore'),'/.ai-dev-config-backups/\n/.mcp.json\n');
  git('add','-f','--','.mcp.json');
  assert.deepEqual((await post(recover,request,auth)).slice(0,2),[409,{error:'project-recovery-unavailable'}]);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.changed);
  git('rm','--cached','--','.mcp.json');

  assert.deepEqual((await post(recover,request,auth)).slice(0,2),[200,{receiptId:f.id,state:'reverted-after-interruption'}]);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.original);
  assert.equal(fs.existsSync(f.second),false);
  assert.equal(readReceipts(f.root).receipts[0].state,'reverted-after-interruption');
  assert.deepEqual((await post(recover,request,auth)).slice(0,2),[409,{error:'project-recovery-not-available'}]);
});

test('an authenticated window verifies all written files and records completion without rewriting them', {skip:process.platform!=='win32'}, async t => {
  const f = fixture(t);
  const {service, post, auth, projectId} = await recoverySession(t, f);
  const summarize = () => readReceipts(f.root,service.signRecovery).receipts[0];
  const partial = summarize();
  assert.match(partial.recoveryToken,/^[a-f0-9]{64}$/u);
  fs.writeFileSync(f.second,'target = "fixture"');
  const full = summarize();
  assert.equal(full.recovery,'review-required');
  assert.equal(full.restoreFiles,2);
  assert.match(full.recoveryToken,/^[a-f0-9]{64}$/u);
  assert.notEqual(full.recoveryToken,partial.recoveryToken);

  const binding = {projectId, revision:null, receiptId:f.id};
  const request = async data => (await post('recover-project-config',{...binding,...data},auth)).slice(0,2);
  const verify = (recoveryToken = full.recoveryToken) => request({recoveryToken,intent:'verify'});
  const receiptBefore = fs.readFileSync(f.file);
  assert.deepEqual(await request({recoveryToken:full.recoveryToken}),[409,{error:'project-recovery-not-available'}]);
  assert.deepEqual(await verify(partial.recoveryToken),[409,{error:'project-recovery-conflict'}]);
  assert.deepEqual(fs.readFileSync(f.file),receiptBefore);

  fs.writeFileSync(f.second,'target = "external edit"');
  assert.deepEqual(await verify(),[409,{error:'project-recovery-conflict'}]);
  assert.equal(fs.readFileSync(f.second,'utf8'),'target = "external edit"');
  assert.deepEqual(fs.readFileSync(f.file),receiptBefore);
  fs.writeFileSync(f.second,'target = "fixture"');

  const git = (...args) => execFileSync('git',['-C',f.root,...args],{windowsHide:true});
  const receiptPath = path.relative(f.root,f.file);
  git('init','-q');
  fs.writeFileSync(path.join(f.root,'.gitignore'),'/.ai-dev-config-backups/\n/.mcp.json\n/.iris-agentic-dev.toml\n');
  git('add','-f','--',receiptPath);
  assert.deepEqual(await verify(),[409,{error:'project-recovery-unavailable'}]);
  assert.deepEqual(fs.readFileSync(f.file),receiptBefore);
  git('rm','--cached','--',receiptPath);
  fs.writeFileSync(path.join(f.root,'.gitignore'),'!/.ai-dev-config-backups/\n/.mcp.json\n/.iris-agentic-dev.toml\n');
  assert.deepEqual(await verify(),[409,{error:'project-recovery-unavailable'}]);
  assert.deepEqual(fs.readFileSync(f.file),receiptBefore);
  fs.writeFileSync(path.join(f.root,'.gitignore'),'/.ai-dev-config-backups/\n/.mcp.json\n/.iris-agentic-dev.toml\n');

  const configuration = () => [f.first,f.second].map(file => ({
    content:fs.readFileSync(file), modified:fs.statSync(file,{bigint:true}).mtimeNs,
  }));
  const before = configuration();
  assert.deepEqual(await verify(),[200,{receiptId:f.id,state:'applied'}]);
  assert.deepEqual(configuration(),before);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file,'utf8')),{...f.receipt,state:'applied'});
  const applied = summarize();
  assert.equal(applied.state,'applied');
  assert.equal(applied.recovery,'undo-available');
  assert.match(applied.recoveryToken,/^[a-f0-9]{64}$/u);
  assert.notEqual(applied.recoveryToken,full.recoveryToken);
  assert.deepEqual(await verify(),[409,{error:'project-recovery-not-available'}]);
});

test('a bound rollback restores exact backup bytes and removes the file created by that save', {skip:process.platform!=='win32'}, async t => {
  const f = fixture(t);
  const applied = {...f.receipt, state:'applied'};
  writeFixtureReceipt(f.root, f.id, applied);
  fs.writeFileSync(f.second,'target = "fixture"');
  const git = (...args) => execFileSync('git',['-C',f.root,...args],{windowsHide:true});
  git('init','-q');
  fs.writeFileSync(path.join(f.root,'.gitignore'),'/.ai-dev-config-backups/\n/.mcp.json\n/.iris-agentic-dev.toml\n');

  const {service, post, auth, projectId} = await recoverySession(t, f);
  const readRow = () => readReceipts(f.root,service.signRecovery).receipts[0];
  const row = readRow();
  assert.equal(row.recovery,'undo-available');
  assert.equal(row.restoreFiles,2);
  assert.match(row.recoveryToken,/^[a-f0-9]{64}$/u);
  assertPrivateReceiptDataOmitted(row, f);
  const route = 'recover-project-config';
  const request = {projectId, revision:null, receiptId:f.id, intent:'rollback', recoveryToken:row.recoveryToken};
  const rollback = async data => (await post(route,{...request,...data},auth)).slice(0,2);
  assert.deepEqual((await post(route,request)).slice(0,2),[403,{error:'session-required'}]);
  assert.deepEqual(await rollback({projectId:'wrong-project'}),[409,{error:'binding-mismatch'}]);
  assert.deepEqual(await rollback({intent:'verify'}),[409,{error:'project-recovery-not-available'}]);

  const receiptBefore = fs.readFileSync(f.file);
  const externalEdit = JSON.stringify({password:randomUUID()});
  fs.writeFileSync(f.first,externalEdit);
  assert.notEqual(readRow().recovery,'undo-available');
  assert.equal((await rollback())[0],409);
  assert.equal(fs.readFileSync(f.first,'utf8'),externalEdit);
  assert.equal(fs.readFileSync(f.second,'utf8'),'target = "fixture"');
  assert.deepEqual(fs.readFileSync(f.file),receiptBefore);
  fs.writeFileSync(f.first,f.changed);

  // This file would be removed on rollback, so even tracking it after confirmation must stop the whole operation.
  git('add','-f','--','.iris-agentic-dev.toml');
  assert.deepEqual(await rollback(),[409,{error:'project-recovery-unavailable'}]);
  assert.deepEqual(fs.readFileSync(f.file),receiptBefore);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.changed);
  assert.equal(fs.readFileSync(f.second,'utf8'),'target = "fixture"');
  git('rm','--cached','--','.iris-agentic-dev.toml');

  fs.appendFileSync(f.file,'\n');
  assert.deepEqual(await rollback(),[409,{error:'project-recovery-conflict'}]);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.changed);
  assert.equal(fs.readFileSync(f.second,'utf8'),'target = "fixture"');
  const recoveryToken = readRow().recoveryToken;
  assert.notEqual(recoveryToken,row.recoveryToken);
  assert.deepEqual(await rollback({recoveryToken}),[200,{receiptId:f.id,state:'rolled-back'}]);
  assert.deepEqual(fs.readFileSync(f.first),Buffer.from(f.original,'utf8'));
  assert.equal(fs.existsSync(f.second),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file,'utf8')),{...applied,state:'rolled-back'});
  assert.equal(readRow().state,'rolled-back');
  assert.equal(readRow().recoveryToken,undefined);

  const finalReceipt = fs.readFileSync(f.file);
  assert.deepEqual(await rollback({recoveryToken}),[409,{error:'project-recovery-not-available'}]);
  assert.deepEqual(fs.readFileSync(f.file),finalReceipt);
  assert.deepEqual(fs.readFileSync(f.first),Buffer.from(f.original,'utf8'));
  assert.equal(fs.existsSync(f.second),false);
});

test('only the newest completed save can be rolled back and pending writes keep it protected', {skip:process.platform!=='win32'}, async t => {
  const f = fixture(t);
  writeFixtureReceipt(f.root, f.id, {...f.receipt,state:'applied'}, new Date('2026-01-01T00:00:00Z'));
  fs.writeFileSync(f.second,'target = "fixture"');
  const {service, post, auth, projectId} = await recoverySession(t, f);
  const find = id => readReceipts(f.root,service.signRecovery).receipts.find(row => row.id === id);
  const rollback = async (receiptId,recoveryToken) => post('recover-project-config',{
    projectId,revision:null,receiptId,recoveryToken,intent:'rollback',
  },auth);
  const olderToken = find(f.id).recoveryToken;
  assert.match(olderToken,/^[a-f0-9]{64}$/u);

  const laterId = randomUUID();
  const settings = path.join(f.root,'.vscode','settings.json');
  const laterValue = '{"fixture":true}';
  fs.mkdirSync(path.dirname(settings));
  fs.writeFileSync(settings,laterValue);
  const laterEntry = {file:settings,beforeHash:'absent',afterHash:hash(laterValue),original:''};
  const laterReceipt = writeFixtureReceipt(f.root, laterId, {...f.receipt,state:'applied',entries:[laterEntry]}, new Date('2026-01-01T00:00:01Z'));
  assert.notEqual(find(f.id).recovery,'undo-available');
  assert.equal(find(f.id).recoveryToken,undefined);
  const newest = find(laterId);
  assert.equal(newest.recovery,'undo-available');
  assert.equal(newest.restoreFiles,1);
  assert.equal((await rollback(f.id,olderToken))[0],409);
  assert.equal(fs.readFileSync(f.first,'utf8'),f.changed);
  assert.equal(fs.readFileSync(settings,'utf8'),laterValue);

  const pendingId = randomUUID();
  const pendingValue = 'target = "fixture-pending"';
  const pendingEntry = {file:f.second,beforeHash:hash('target = "fixture"'),afterHash:hash(pendingValue),
    original:Buffer.from('target = "fixture"').toString('base64')};
  const pending = writeFixtureReceipt(f.root, pendingId, {...f.receipt,entries:[f.receipt.entries[0],pendingEntry]}, new Date('2026-01-01T00:00:02Z'));
  const previousReceipts = [f.file,laterReceipt,pending].map(file => fs.readFileSync(file));
  for (const [content,expectedPending] of [['target = "fixture"','available'],[pendingValue,'review-required']]) {
    fs.writeFileSync(f.second,content);
    assert.equal(find(pendingId).recovery,expectedPending);
    assert.notEqual(find(laterId).recovery,'undo-available');
    assert.equal((await rollback(laterId,newest.recoveryToken))[0],409);
    assert.deepEqual([f.file,laterReceipt,pending].map(file => fs.readFileSync(file)),previousReceipts);
    assert.equal(fs.readFileSync(f.first,'utf8'),f.changed);
    assert.equal(fs.readFileSync(f.second,'utf8'),content);
    assert.equal(fs.readFileSync(settings,'utf8'),laterValue);
  }
});

test('an unreadable receipt with equal or newer order blocks an older undo token', {skip:process.platform!=='win32'}, async t => {
  const f = fixture(t);
  const before = new Date('2026-01-01T00:00:00Z');
  const same = new Date('2026-01-01T00:00:01Z');
  const after = new Date('2026-01-01T00:00:02Z');
  writeFixtureReceipt(f.root, f.id, {...f.receipt,state:'applied'}, same);
  fs.writeFileSync(f.second,'target = "fixture"');
  const {service, post, auth, projectId} = await recoverySession(t, f);
  const read = () => readReceipts(f.root,service.signRecovery);
  const token = read().receipts[0].recoveryToken;
  assert.match(token,/^[a-f0-9]{64}$/u);
  const request = {projectId,revision:null,receiptId:f.id,recoveryToken:token,intent:'rollback'};
  const tracked = [f.file,f.first,f.second];
  const originals = tracked.map(file=>fs.readFileSync(file));

  const privateDir = path.join(path.dirname(path.dirname(f.file)),randomUUID());
  fs.mkdirSync(privateDir);
  const broken = path.join(privateDir,'receipt.json');
  assert.equal(read().receiptIssue,undefined);
  assert.equal(read().receipts[0].recoveryToken,token);

  fs.writeFileSync(broken,'{"state":"applied",');
  fs.utimesSync(broken,before,before);
  assert.equal(read().receiptIssue,true);
  assert.equal(read().receipts[0].recoveryToken,token);

  for (const updated of [same,after]) {
    fs.utimesSync(broken,updated,updated);
    const current = read();
    assert.equal(current.receiptIssue,true);
    assert.deepEqual(current.receipts.map(row=>row.id),[f.id]);
    assert.equal(current.receipts[0].recoveryToken,undefined);
    assert.deepEqual((await post('recover-project-config',request,auth)).slice(0,2),[409,{error:'project-recovery-not-available'}]);
    assert.deepEqual(tracked.map(file=>fs.readFileSync(file)),originals);
  }

  fs.unlinkSync(broken);
  assert.equal(read().receiptIssue,undefined);
  assert.equal(read().receipts[0].recoveryToken,token);
});

test('an interrupted rollback needs a new confirmation for the files that are still written', {skip:process.platform!=='win32'}, async t => {
  for (const remaining of [1,0]) await t.test(`${remaining} written files remain`, async subtest => {
    const f = fixture(subtest);
    const applied = {...f.receipt,state:'applied'};
    writeFixtureReceipt(f.root,f.id,applied);
    fs.writeFileSync(f.second,'target = "fixture"');
    const {service,post,auth,projectId} = await recoverySession(subtest,f);
    const readRow = () => readReceipts(f.root,service.signRecovery).receipts[0];
    const beforeInterruption = readRow();
    assert.match(beforeInterruption.recoveryToken,/^[a-f0-9]{64}$/u);

    // The previous process has persisted its intention and restored at least one file.
    writeFixtureReceipt(f.root,f.id,{...applied,state:'rolling-back'});
    fs.unlinkSync(f.second);
    if (!remaining) fs.writeFileSync(f.first,f.original);
    const interrupted = readRow();
    assert.equal(interrupted.state,'rolling-back');
    assert.equal(interrupted.restoreFiles,remaining);
    assert.match(interrupted.recoveryToken,/^[a-f0-9]{64}$/u);
    assert.notEqual(interrupted.recoveryToken,beforeInterruption.recoveryToken);
    const rollback = async recoveryToken => (await post('recover-project-config',{
      projectId,revision:null,receiptId:f.id,recoveryToken,intent:'rollback',
    },auth)).slice(0,2);
    const receiptBefore = fs.readFileSync(f.file);
    const firstBefore = fs.readFileSync(f.first);
    const modifiedBefore = fs.statSync(f.first,{bigint:true}).mtimeNs;
    assert.equal((await rollback(beforeInterruption.recoveryToken))[0],409);
    assert.deepEqual(fs.readFileSync(f.file),receiptBefore);
    assert.deepEqual(fs.readFileSync(f.first),firstBefore);

    assert.deepEqual(await rollback(interrupted.recoveryToken),[200,{receiptId:f.id,state:'rolled-back'}]);
    assert.deepEqual(fs.readFileSync(f.first),Buffer.from(f.original,'utf8'));
    if (!remaining) assert.equal(fs.statSync(f.first,{bigint:true}).mtimeNs,modifiedBefore);
    assert.equal(fs.existsSync(f.second),false);
    assert.equal(readRow().state,'rolled-back');
  });
});
