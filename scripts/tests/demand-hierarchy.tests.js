'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const entry = require('../../plugins/bos-plugin/scripts/demand-entry');
const log = require('../../plugins/bos-plugin/scripts/bos-code-update-log');
const acceptance = require('../../plugins/demand-delivery-plugin/scripts/acceptance-session');
const { normalizeBindings } = require('../lib/demand-code-binding');
const description = { format: 'bug', steps: ['打开目标入口并查看操作图标。'], expected: '各主题操作图标一致。', actual: '部分主题仍显示文字操作。' };
function fixture(t) {
  const base = process.env.AGENT_TEST_TMPDIR || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'demand-hierarchy-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(base)); fs.rmSync(root, { recursive: true, force: true }); });
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  const global = path.join(root, 'empty-config'); fs.writeFileSync(global, '');
  const hooks = path.join(root, 'hooks'); fs.mkdirSync(hooks);
  function git(...args) {
    const r = spawnSync('git', ['-c', 'core.hooksPath=' + hooks, '-c', 'commit.gpgSign=false', '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-C', repo, ...args],
      { encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: global } });
    assert.equal(r.status, 0, r.error?.message || r.stderr); return r.stdout.trim();
  }
  git('init', '-b', 'dev'); fs.writeFileSync(path.join(repo, 'actions.js'), 'old\n'); git('add', '.'); git('commit', '-m', 'base');
  fs.appendFileSync(path.join(repo, 'actions.js'), 'shared icons\n');
  const facts = entry.collect({ repo, files: ['actions.js'] }); fs.writeFileSync(path.join(root, 'facts.json'), JSON.stringify(facts));
  const spec = { kind: 'standard', common: { 模块编码: 'SYNTHETIC' }, requirements: [
    { key: 'p', name: '{WEB} 操作图标统一', description, type: 'fix', subject: '操作图标', codeBinding: { kind: 'own' }, changes: [{ evidence: 'facts.json', modification: '使用公共图标配置替代主题分支，使各主题操作一致并保留原有事件' }] },
    ...[1, 2, 3].map(n => ({ key: 'c' + n, parentKey: 'p', codeBinding: { kind: 'parent' }, name: '{WEB} 入口' + n + '图标统一', description }))
  ] };
  const commit = () => { git('add', 'actions.js'); git('commit', '-m', 'fix(100):操作图标\n修改说明:使用公共配置处理各主题图标，保留原有操作'); return git('rev-parse', 'HEAD'); };
  return { root, repo, git, spec, commit };
}
test('one owner and three children render, bind and share evidence without independent child plans', t => {
  const f = fixture(t), draft = entry.prepare(f.spec, f.root, f.repo);
  assert.equal(draft.schema, 'iris-standard-demand/v4');
  assert.equal(draft.requirements.filter(item => item.changes).length, 1);
  const out = path.join(f.root, 'output'); entry.deliver(draft, out, true);
  for (const name of ['p.txt', 'c1.txt', 'c2.txt', 'c3.txt', 'draft.json', 'relations.md', 'requirements.xlsx']) assert.ok(fs.existsSync(path.join(out, name)));
  entry.bind(draft, 'p', '100', '主需求'); entry.bind(draft, 'c1', '101', '子需求1');
  const before = f.git('status', '--porcelain');
  const route = entry.messages(draft, 'c1', f.repo);
  assert.equal(route.status, 'references-parent'); assert.equal(route.parentDemand, '100'); assert.equal(route.canCommit, false);
  assert.match(route.messages[0].message, /^fix\(100\):/);
  assert.throws(() => entry.planArguments(draft, 'c1', f.repo), /归属主需求/);
  assert.throws(() => entry.bind(draft, 'c2', '101', '重复编号'), /同一需求号/);
  assert.equal(f.git('status', '--porcelain'), before);
  assert.match(entry.relationText(draft), /c1 \| p \| parent \| 101/);
});
test('hierarchy rejects invalid ownership, cycles and unrelated duplicate files; legacy remains readable', t => {
  const f = fixture(t);
  const clone = () => JSON.parse(JSON.stringify(f.spec));
  let spec = clone(); spec.requirements[1].parentKey = 'missing'; assert.throws(() => entry.prepare(spec, f.root, f.repo), /主需求不存在/);
  spec = clone(); spec.requirements[0].parentKey = 'c1'; assert.throws(() => entry.prepare(spec, f.root, f.repo), /一级|循环/);
  spec = clone(); spec.requirements[1].changes = spec.requirements[0].changes; assert.throws(() => entry.prepare(spec, f.root, f.repo), /重复分配/);
  spec = clone(); spec.requirements.push({ ...spec.requirements[0], key: 'independent' }); assert.throws(() => entry.prepare(spec, f.root, f.repo), /共用文件/);
  spec = clone(); spec.requirements = [spec.requirements[0]]; delete spec.requirements[0].codeBinding;
  const legacy = entry.prepare(spec, f.root, f.repo); assert.equal(legacy.schema, 'iris-standard-demand/v2');
  entry.bind(legacy, 'p', '100', '原需求'); assert.match(entry.messages(legacy, 'p', f.repo)[0].message, /^fix\(100\):/);
  assert.throws(() => normalizeBindings([{ key: 'a', codeBinding: { kind: 'none' } }]), /说明原因/);
});
test('explicit no-code drafts skip code dependencies but unknown or missing evidence stays blocked', t => {
  const f = fixture(t), spec = { kind: 'standard', requirements: [{ key: 'n', name: '{WEB} 基线已满足', description, codeBinding: { kind: 'none', reason: '已核对基线满足，无需新增代码且无对应历史提交' } }] };
  const draft = entry.prepare(spec, f.root, '/missing-project');
  assert.equal(entry.messages(draft, 'n', '/missing-project').status, 'not-applicable');
  assert.throws(() => entry.planArguments(draft, 'n', '/missing-project'), /无代码提交对象/);
  spec.requirements[0].codeBinding = { kind: 'own' };
  assert.throws(() => entry.prepare(spec, f.root, f.repo), /type|subject|取证/);
});
test('main and child BOS logs reuse immutable commits with distinct targets and strict owner validation', async t => {
  const f = fixture(t), hash = f.commit(), select = [{ repo: f.repo, ref: 'refs/heads/dev', hash }];
  const file = path.join(f.root, 'private.json'); fs.writeFileSync(file, JSON.stringify({ 'bos-code-update-log': { url: 'https://example.invalid/code-log', token: randomBytes(24).toString('hex'), linkProject: 'synthetic' } }));
  let requests = 0, sent;
  const options = { env: { BOS_MCP_CONFIG: file }, fetchImpl: async (_url, req) => { requests++; sent = JSON.parse(req.body); return { ok: true, status: 200, json: async () => ({ ResultCode: '000' }) }; } };
  const input = { bindings: ['100', '101', '102', '103', '101'].map(requirementCode => ({ requirementCode, codeOwnerRequirementCode: '100', select })) };
  const plan = await log.main(['plan', JSON.stringify(input)], options);
  assert.equal(requests, 0); assert.equal(plan.payload.length, 4);
  assert.deepEqual(plan.summary.map(item => item.requirementCode), ['100','101','102','103']);
  for (const payload of plan.payload) { assert.equal(payload.Repository.length, 1); assert.equal(payload.Repository[0].CodeRepositoryVersion, hash); assert.equal(payload.Repository[0].ModifyFiles, 'actions.js'); }
  assert.match(plan.payload[1].ModifyDesc, /复用主需求 100/);
  await log.main(['submit', JSON.stringify(input)], options); assert.equal(requests, 0);
  const result = await log.main(['submit', JSON.stringify(input), '--confirm'], options);
  assert.equal(result.submitted, true); assert.equal(requests, 1); assert.deepEqual(sent, plan.payload);
  const bad = { bindings: [{ requirementCode: '101', codeOwnerRequirementCode: '999', select }] };
  await assert.rejects(log.main(['plan', JSON.stringify(bad)], options), /主需求不一致/);
  await assert.rejects(log.main(['plan', JSON.stringify({ bindings: [{ requirementCode: '101', select }] })], options), /所属主需求号/);
  await assert.rejects(log.main(['plan', JSON.stringify({ ...input, select })], options), /互斥/);
  await assert.rejects(log.main(['plan', JSON.stringify({ select: [] })], options), /至少提供/);
  assert.equal(requests, 1);
});
function session(f, extra = []) {
  const directory = path.join(f.repo, 'docs', 'acceptance');
  const state = acceptance.create(directory, { projectRoot: f.repo, deliveryActions: ['commit', 'bos-log', 'push'], demands: [
    { id: '100', title: '主需求', codeBinding: { kind: 'own' }, repositories: [{ key: 'ui', root: f.repo, remote: 'origin', ref: 'refs/heads/dev', files: ['actions.js'] }] },
    ...['101','102','103'].map(id => ({ id, title: '子需求' + id, parentId: '100', codeBinding: { kind: 'parent' } })), ...extra
  ] });
  const act = (command, input) => acceptance.mutate(directory, s => acceptance.apply(s, command, input));
  const load = () => acceptance.load(directory);
  const passed = id => act('decide', { id, actor: 'user', quote: id + '验收通过', status: 'passed' });
  const own = id => { act('claim', { id, owner: 'worker' }); act('publish', { id, owner: 'worker' }); };
  const record = (id, phase, status, receipt) => act('record', { id, owner: 'worker', phase, status, receipt });
  const authorize = () => act('authorize', { actor: 'user', quote: '本批通过后提交、补日志、推送', actions: ['commit','bos-log','push'] });
  const item = id => load().demands.find(item => item.id === id);
  const bos = id => ({ requirementCode: id, codeOwnerRequirementCode: '100', select: acceptance.selection(item(id)), submitted: true, resultCodes: ['000'], linkProject: 'synthetic' });
  return { directory, state, act, load, passed, own, record, authorize, item, bos };
}
test('group acceptance gates shared commit, then child logs and one push inherit exact verified receipts', t => {
  const f = fixture(t), s = session(f), hash = f.commit();
  assert.equal(s.state.schema, 'demand-acceptance-session/v2');
  s.authorize(); s.passed('100'); s.passed('101');
  assert.throws(() => s.own('100'), /All related child/);
  assert.equal(acceptance.readyForClaim(s.load(), s.item('100')), false);
  s.passed('102'); s.passed('103'); s.own('100');
  const receipt = { status: 'verified', demand: '100', repositories: [{ root: f.repo, files: ['actions.js'], message: 'fix(100):操作图标\n修改说明:统一操作', execution: { status: 'verified', commit: hash } }] };
  s.record('100', 'commit', 'succeeded', receipt);
  s.record('100', 'bos', 'succeeded', s.bos('100'));
  const push = { repositories: [{ key: 'ui', commit: hash, remote: 'origin', ref: 'refs/heads/dev', verified: true, remoteHash: hash }] };
  assert.throws(() => s.record('100', 'push', 'running'), /All child BOS/);
  for (const id of ['101','102','103']) {
    s.own(id); s.act('inherit', { id, owner: 'worker' });
    assert.equal(s.item(id).delivery.commit.status, 'inherited'); assert.equal(s.item(id).delivery.commit.records[0].hash, hash);
    assert.throws(() => s.record(id, 'commit', 'succeeded', receipt), /not applicable/);
    assert.throws(() => s.record(id, 'bos', 'succeeded', { ...s.bos(id), requirementCode: '100' }), /target demand/);
    if (id === '101') {
      s.record(id, 'bos', 'running', s.bos(id)); s.record(id, 'bos', 'unknown');
      assert.equal(acceptance.completed(s.load(), s.item(id)), false);
      assert.throws(() => s.record(id, 'bos', 'running'), /reconcile|Reconcile/);
      assert.throws(() => s.act('reconcile-bos', { id, owner: 'worker', actor: 'user', quote: '核对其他项目', status: 'succeeded', receipt: { ...s.bos(id), linkProject: 'different-project' } }), /associated project changed/);
      s.act('reconcile-bos', { id, owner: 'worker', actor: 'user', quote: '已核对相同目标及提交日志存在', status: 'succeeded', receipt: s.bos(id) });
    } else s.record(id, 'bos', 'succeeded', s.bos(id));
  }
  s.record('100', 'push', 'succeeded', push);
  assert.equal(acceptance.summarize(s.load(), 'delivered').count, 4);
  for (const id of ['101','102','103']) assert.equal(s.item(id).delivery.push.status, 'inherited');
  assert.throws(() => s.record('100', 'push', 'succeeded', push), /not claimed|already/);
});
test('no-code acceptance uses not-applicable phases, scope mutations stop, legacy sessions stay v1', t => {
  const f = fixture(t), s = session(f, [{ id: '200', title: '无代码核对', codeBinding: { kind: 'none', reason: '基线已满足，无相关提交' } }]);
  assert.equal(s.item('200').delivery.bos.status, 'not-applicable');
  assert.equal(acceptance.completed(s.load(), s.item('200')), false);
  s.passed('200'); assert.equal(acceptance.completed(s.load(), s.item('200')), true);
  assert.throws(() => s.own('200'), /already delivered/);
  const file = path.join(s.directory, 'session.json'), changed = s.load(); changed.demands[1].codeBinding = { kind: 'none', reason: 'changed scope' };
  fs.writeFileSync(file, JSON.stringify(changed)); assert.throws(() => s.load(), /scope changed/);
  const dir = path.join(f.repo, 'docs', 'legacy');
  const legacy = acceptance.create(dir, { projectRoot: f.repo, deliveryActions: ['commit'], demands: [{ id: '300', title: '旧需求', repositories: [{ key: 'ui', root: f.repo, files: ['actions.js'] }] }] });
  assert.equal(legacy.schema, 'demand-acceptance-session/v1'); assert.equal(acceptance.load(dir).schema, legacy.schema);
  legacy.demands[0].decision.status = 'passed'; legacy.demands[0].delivery.commit.status = 'inherited';
  assert.equal(acceptance.completed(legacy, legacy.demands[0]), false);
});

test('mapped logs reject worktree sources and deduplicate real commits without merging child targets', async t => {
  const f = fixture(t), hash = f.commit(), other = path.join(f.root, 'other-worktree');
  f.git('worktree', 'add', '--detach', other, hash);
  const select = [{ repo: f.repo, ref: 'refs/heads/dev', hash }, { repo: other, ref: 'refs/heads/dev', hash }];
  assert.throws(() => log.selectInput({ bindings: [{ requirementCode: '100', codeOwnerRequirementCode: '100', select }] }), /worktree/);
  select[1] = { ...select[0] };
  const records = log.selectInput({ bindings: ['100','101'].map(requirementCode => ({ requirementCode, codeOwnerRequirementCode: '100', select })) });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(item => item.logBinding.requirementCode), ['100','101']);
  assert.throws(() => log.selectInput({ bindings: [{ requirementCode: 9007199254740992, codeOwnerRequirementCode: '100', select }] }), /目标需求号/);
  assert.throws(() => log.selectInput({ bindings: [{ requirementCode: '101', codeOwnerRequirementCode: '100', select: [{ repo: f.repo, hash: hash.slice(0, 7) }] }] }), /完整提交hash/);
});
test('child CLI plan shows the parent route without a new commit plan or Git mutation', t => {
  const f = fixture(t), draft = entry.prepare(f.spec, f.root, f.repo);
  entry.bind(draft, 'p', '100', '主需求'); entry.bind(draft, 'c1', '101', '子需求1');
  const file = path.join(f.root, 'draft.json'); fs.writeFileSync(file, JSON.stringify(draft));
  const before = f.git('status', '--porcelain'), head = f.git('rev-parse', 'HEAD');
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../../plugins/bos-plugin/scripts/demand-entry.js'), 'plan', '--draft', file, '--item', 'c1', '--project-root', f.repo], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  const route = JSON.parse(r.stdout); assert.equal(route.status, 'references-parent'); assert.equal(route.canCommit, false); assert.equal(route.planPath, undefined);
  assert.equal(f.git('rev-parse', 'HEAD'), head); assert.equal(f.git('status', '--porcelain'), before);
});
test('an unaccepted group leaves unrelated demands eligible and scope cannot silently become no-code', t => {
  const f = fixture(t), s = session(f, [{ id: '200', title: '独立需求', codeBinding: { kind: 'own' }, repositories: [{ key: 'ui', root: f.repo, remote: 'origin', ref: 'refs/heads/dev', files: ['separate.js'] }] }]);
  s.authorize(); s.passed('100'); s.passed('101'); s.passed('200');
  s.act('decide', { id: '102', actor: 'user', quote: '102暂缓', status: 'deferred' });
  assert.throws(() => s.own('100'), /All related child/);
  assert.equal(acceptance.readyForClaim(s.load(), s.item('200')), true);
  s.own('200'); assert.equal(s.item('200').publication.owner, 'worker');
  const changed = s.load(); changed.demands[0].codeBinding = { kind: 'none', reason: 'claimed change' };
  fs.writeFileSync(path.join(s.directory, 'session.json'), JSON.stringify(changed));
  assert.throws(() => s.load(), /主需求必须自身|scope changed/);
});

test('official parent commit, individual mock BOS requests and a single local push complete the whole group', async t => {
  const f = fixture(t), s = session(f);
  for (const [key, value] of [['user.name','Synthetic'], ['user.email','synthetic@example.invalid'], ['core.hooksPath',path.join(f.root,'hooks')], ['commit.gpgSign','false']]) f.git('config', key, value);
  s.authorize(); for (const id of ['100','101','102','103']) s.passed(id); s.own('100');
  const cli = path.resolve(__dirname, '../../plugins/demand-delivery-plugin/scripts/commit-demand.js');
  function run(args) {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: f.repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(f.root,'empty-config') } });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  }
  const plan = run(['plan','--project-root',f.repo,'--kind','project','--demand','100','--type','fix','--subject','操作图标','--title','主需求',
    '--file',path.join(f.repo,'actions.js'),'--modification','使用公共图标配置替代主题分支，使操作一致并保留原有事件','--output',path.join(f.root,'official-plan.json')]);
  const committed = run(['apply','--plan',plan.planPath,'--confirm-commit','--verify']);
  s.record('100','commit','succeeded',committed);
  const hash = committed.repositories[0].execution.commit;
  const configFile = path.join(f.root,'private.json');
  fs.writeFileSync(configFile,JSON.stringify({ 'bos-code-update-log': { url:'https://example.invalid/code-log', token:randomBytes(24).toString('hex'), linkProject:'synthetic' } }));
  const requests = [];
  const options = { env: { BOS_MCP_CONFIG:configFile }, fetchImpl: async (_url, request) => { requests.push(JSON.parse(request.body)); return { ok:true, status:200, json:async()=>({ResultCode:'000'}) }; } };
  for (const id of ['100','101','102','103']) {
    if (id !== '100') { s.own(id); s.act('inherit',{id,owner:'worker'}); }
    const select = acceptance.selection(s.item(id));
    const input = JSON.stringify({bindings:[{requirementCode:id,codeOwnerRequirementCode:'100',select}]});
    const preview = await log.main(['plan',input],options);
    assert.equal(preview.summary[0].requirementCode,id);
    s.record(id,'bos','running',{...s.bos(id),submitted:false});
    const logged = await log.main(['submit',input,'--confirm'],options);
    s.record(id,'bos','succeeded',{...s.bos(id),submitted:logged.submitted,resultCodes:logged.resultCodes});
  }
  assert.equal(requests.length,4); assert.deepEqual(requests.map(items=>items[0].RequirementCode),['100','101','102','103']);
  for (const payload of requests) assert.equal(payload[0].Repository[0].CodeRepositoryVersion,hash);
  const bare = path.join(f.root,'remote.git'); f.git('init','--bare',bare); f.git('remote','add','origin',bare);
  s.record('100','push','running');
  f.git('push','origin','HEAD:refs/heads/dev');
  const remoteHash = f.git('--git-dir='+bare,'rev-parse','refs/heads/dev'); assert.equal(remoteHash,hash);
  s.record('100','push','succeeded',{repositories:[{key:'ui',commit:hash,remote:'origin',ref:'refs/heads/dev',verified:true,remoteHash}]});
  assert.equal(acceptance.summarize(s.load(),'delivered').csv,'100,101,102,103');
  assert.equal(s.item('101').delivery.commit.status,'inherited'); assert.equal(s.item('101').delivery.push.status,'inherited');
  assert.equal(f.git('rev-list','--count','HEAD'), '2');
});

test('runtime entry points expose hierarchy, no-code and mapped receipt contracts', () => {
  const root = path.resolve(__dirname,'../..');
  const read = file => fs.readFileSync(path.join(root,file),'utf8');
  for (const file of ['plugins/bos-plugin/skills/bos-demand-entry/SKILL.md','plugins/bos-plugin/skills/bos-code-update-log/SKILL.md','plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md']) assert.match(read(file), /demand-code-ownership\.md/);
  assert.match(read('plugins/bos-plugin/references/standard-demand-entry.md'), /iris-standard-demand\/v4/);
  assert.match(read('plugins/bos-plugin/references/code-update-log.md'), /codeOwnerRequirementCode/);
  assert.match(read('plugins/demand-delivery-plugin/references/acceptance-session.md'), /demand-acceptance-session\/v2/);
  assert.match(read('.github/workflows/standard-demand-entry.yml'), /demand-hierarchy\.tests\.js/);
  assert.match(read('.github/workflows/bos-demand.yml'), /demand-code-binding\.js/);
});

test('non-BOS commit-only groups inherit the main receipt without credential or push requirements', t => {
  const f = fixture(t), directory = path.join(f.repo,'docs','commit-only');
  acceptance.create(directory,{projectRoot:f.repo,deliveryActions:['commit'],demands:[
    {id:'100',title:'主需求',codeBinding:{kind:'own'},repositories:[{key:'ui',root:f.repo,files:['actions.js']}]},
    {id:'101',title:'子需求',parentId:'100',codeBinding:{kind:'parent'}}
  ]});
  const act = (command,input) => acceptance.mutate(directory,state=>acceptance.apply(state,command,input));
  for (const id of ['100','101']) act('decide',{id,actor:'user',quote:id+'通过',status:'passed'});
  act('authorize',{actor:'user',quote:'通过后只本地提交',actions:['commit']});
  act('claim',{id:'100',owner:'worker'}); act('publish',{id:'100',owner:'worker'});
  assert.throws(()=>act('claim',{id:'101',owner:'child'}),/verified parent commit/);
  const hash = f.commit();
  act('record',{id:'100',owner:'worker',phase:'commit',status:'succeeded',receipt:{status:'verified',demand:'100',repositories:[{root:f.repo,files:['actions.js'],message:'fix(100):操作图标\n修改说明:统一图标',execution:{status:'verified',commit:hash}}]}});
  act('claim',{id:'101',owner:'child'}); act('publish',{id:'101',owner:'child'}); act('inherit',{id:'101',owner:'child'});
  const state = acceptance.load(directory);
  assert.equal(acceptance.summarize(state,'delivered').count,2);
  assert.equal(state.demands[1].delivery.bos.status,'not-applicable'); assert.equal(state.demands[1].delivery.push.status,'not-applicable');
});
