'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const runner = require('../../plugins/coding-iris-plugin/scripts/iris-tools/refresh-menu');
const publisher = require('../../plugins/coding-iris-plugin/scripts/iris-tools/sync-menu');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(t, count = 2) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'menu-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, '.agents/work/menu-sync/demo'), config = path.join(dir, '.agents/config/menu-sync');
  fs.mkdirSync(config, { recursive: true });
  const env = { IRIS_HOST: 'fixture', IRIS_WEB_PORT: '1', IRIS_NAMESPACE: 'fixture' };
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'iris-agentic-dev': { env } } }));
  const profile = { schema: 'iris-menu-refresh/v1', sourceId: 'demo', groupFilter: 'active', allowMenuRead: true, maxRemovalRatio: 0.1,
    targetFingerprint: hash(Object.values(env)), methodSourceHash: runner.sourceHash('reviewed fixture') };
  fs.writeFileSync(path.join(config, 'demo.json'), JSON.stringify(profile));
  const groups = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: 'Group ' + (i + 1), active: 'Y' }));
  const settings = groups.map(g => ({ id: g.id, groupId: g.id, mainMenu: 1 }));
  const catalog = [{ id: 1, text: 'Menu', code: 'demo', url: 'demo.csp', parentId: '' }];
  let calls = 0, failBatch = 0;
  const api = { fingerprint: profile.targetFingerprint,
    async schema() { return [['iris_query', ['query', 'parameters']], ['iris_execute', ['code']], ['iris_doc', ['mode', 'name']]].map(([name, keys]) => ({ name, inputSchema: { properties: Object.fromEntries(keys.map(k => [k, {}])) } })); },
    async call(name, args) {
      if (name === 'iris_doc') return { success: true, content: 'reviewed fixture' };
      if (name === 'iris_execute') {
        calls++; if (calls === failBatch) throw Error('simulated outage');
        const ids = [...args.code.matchAll(/getGroupData\((\d+)\)/g)].map(m => m[1]);
        return { success: true, output: ids.map(() => JSON.stringify([{ id: '1', text: 'Menu', code: 'demo', lintUrl: 'demo.csp', children: [] }])).join('\n') };
      }
      let rows;
      if (args.query.startsWith('SELECT COLUMN_NAME')) {
        const fields = { SS_Group: ['SSGRP_RowId', 'SSGRP_Desc', 'SSGRP_ActiveFlag'], Menu: ['ID', 'Caption', 'Name', 'LinkUrl', 'SubMenuOf'], GroupSettings: ['ID', 'GroupDR', 'MainMenuDR'] };
        rows = fields[args.parameters[1]].map(COLUMN_NAME => ({ COLUMN_NAME }));
      } else {
        const data = args.query.includes('SQLUser.SS_Group') ? groups : args.query.includes('epr.GroupSettings') ? settings : catalog;
        rows = args.query.includes('COUNT(*)') ? [{ total: data.length }] : data.filter(r => r.id > Number(args.parameters[0] || 0)).slice(0, 500);
      }
      return { success: true, rows, count: rows.length };
    }
  };
  return { dir, root, profile, api, groups, settings, catalog, setFail: n => { failBatch = n; }, calls: () => calls,
    run: opts => runner.refresh({ workspace: dir, sourceId: 'demo', api, execute: true, ...opts }) };
}
test('physical output chunks, escaped quotes and multiple arrays retain JSON data; errors and truncation stop', () => {
  const data = JSON.stringify([{ text: 'quote " and newline\n', children: [] }]);
  assert.deepEqual(runner.parseArrays(data.slice(0, 13) + '\n' + data.slice(13) + '\n[]', 2), [JSON.parse(data), []]);
  for (const bad of ['[]ERROR: failed', '[{"id":', '[]', '{}[]']) assert.throws(() => runner.parseArrays(bad, 2));
});
test('virtual identical links retain all occurrences and stable IDs; duplicate server IDs are rejected', () => {
  const virtual = { text: 'same', lintUrl: 'demo.csp', children: [] };
  const groups = [{ id: '1', name: 'G', menus: [virtual, virtual, { ...virtual, text: 'other' }] }];
  const a = runner.normalizeData([{ id: '1', text: '' }], groups, new Date().toISOString(), 'demo');
  assert.equal(a.input.groups[0].menus.length, 3);
  assert.equal(new Set(a.input.groups[0].menus.map(n => n.id)).size, 3);
  assert.deepEqual(a.input.groups[0].menus, runner.normalizeData([], groups, a.input.capturedAt, 'demo').input.groups[0].menus);
  assert.throws(() => runner.normalizeData([], [{ id: '1', name: 'G', menus: [{ id: '2', text: 'A' }, { id: '2', text: 'B' }] }], a.input.capturedAt, 'demo'), /Duplicate/);
});
test('unattended refresh publishes evidence atomically, supports dynamic active groups and cleans successful runs', async t => {
  const f = fixture(t); const first = await f.run();
  assert.equal(first.status, 'refreshed');
  assert.equal(publisher.current(f.root).snapshot.groups.length, 2);
  assert.equal(fs.existsSync(path.join(f.root, 'runs', first.runId)), false);
  const second = await f.run(); assert.equal(second.status, 'no-menu-changes');
  f.groups.push({ id: 3, name: 'New group', active: 'Y' }); f.settings.push({ id: 3, groupId: 3, mainMenu: 1 });
  const next = await f.run(); assert.equal(next.changes.added, 2);
  assert.equal(publisher.current(f.root).snapshot.groups.length, 3);
  assert.ok(fs.existsSync(path.join(f.root, next.generation, 'acquisition.json')));
});
test('partial acquisition has durable verified checkpoints and resumes only missing batches', async t => {
  const f = fixture(t, 9), runId = crypto.randomUUID(); f.setFail(2);
  await assert.rejects(f.run({ runId }), /outage/);
  assert.equal(publisher.current(f.root).snapshot, null);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(f.root, 'runs', runId, 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.state.groups.length, 8);
  const result = await f.run({ runId, resume: true });
  assert.equal(f.calls(), 3); assert.equal(result.groups, 9);
});
test('tampered checkpoints cannot publish and existing snapshots survive method, environment and schema drift', async t => {
  const f = fixture(t, 9); const first = await f.run(), revision = first.revision, runId = crypto.randomUUID();
  f.setFail(f.calls() + 2); await assert.rejects(f.run({ runId }), /outage/);
  const file = path.join(f.root, 'runs', runId, 'checkpoint.json'); const ck = JSON.parse(fs.readFileSync(file, 'utf8'));
  ck.state.groups[0].name = 'tampered'; fs.writeFileSync(file, JSON.stringify(ck));
  await assert.rejects(f.run({ runId, resume: true }), /integrity/);
  assert.equal(publisher.current(f.root).revision, revision);
  f.api.fingerprint = 'different'; await assert.rejects(f.run(), /environment/);
  f.api.fingerprint = f.profile.targetFingerprint; const original = f.api.call;
  f.api.call = async (n, a) => n === 'iris_doc' ? { success: true, content: 'changed class' } : original(n, a);
  await assert.rejects(f.run(), /class changed/);
  assert.equal(publisher.current(f.root).revision, revision);
});
test('large removals, newly empty groups and missing settings preserve the current pointer', async t => {
  const f = fixture(t, 2), first = await f.run();
  f.groups.pop(); f.settings.pop(); await assert.rejects(f.run(), /reduction/);
  assert.equal(publisher.current(f.root).revision, first.revision);
  f.groups.push({ id: 2, name: 'Group 2', active: 'Y' });
  await assert.rejects(f.run(), /settings missing/);
  assert.equal(publisher.current(f.root).revision, first.revision);
  const snapshot = publisher.current(f.root).snapshot;
  const next = structuredClone(snapshot); next.groups[0].menus = [];
  assert.throws(() => runner.guard(snapshot, next, { removed: [] }, f.profile), /became empty/);
});
test('concurrent refresh lock and metadata write failures cannot replace the old snapshot', async t => {
  const f = fixture(t), first = await f.run();
  fs.mkdirSync(path.join(f.root, '.refresh-lock')); await assert.rejects(f.run(), /EEXIST/);
  fs.rmdirSync(path.join(f.root, '.refresh-lock'));
  const input = { ...publisher.current(f.root).snapshot, scope: 'all', complete: true, capturedAt: new Date(Date.now() + 1000).toISOString() };
  const plan = publisher.sync({ root: f.root, input }), original = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => { if (path.basename(file) === 'acquisition.json') throw Error('metadata failure'); return original(file, ...args); };
  try { assert.throws(() => publisher.sync({ root: f.root, input, write: true, acquisition: {}, expectHash: plan.revision, expectInput: plan.inputHash }), /metadata failure/); }
  finally { fs.writeFileSync = original; }
  assert.equal(publisher.current(f.root).revision, first.revision);
});
test('plan mode acquires and reviews without switching the snapshot', async t => {
  const f = fixture(t); const result = await f.run({ execute: false });
  assert.equal(result.status, 'planned'); assert.equal(publisher.current(f.root).snapshot, null);
  assert.ok(fs.existsSync(path.join(f.root, 'runs', result.runId, 'input.json')));
});
test('tool schemas and end-of-scan group metadata are verified before publication', async t => {
  const f = fixture(t), first = await f.run(), schema = f.api.schema;
  f.api.schema = async () => []; await assert.rejects(f.run(), /schema changed/);
  f.api.schema = schema; const original = f.api.call;
  f.api.call = async (n, a) => { const result = await original(n, a); if (n === 'iris_execute') f.groups[0].name = 'changed during scan'; return result; };
  await assert.rejects(f.run(), /Source changed/);
  assert.equal(publisher.current(f.root).revision, first.revision);
});
test('catalog pagination crosses 500-row boundaries and preserves unnamed rows', async t => {
  const f = fixture(t); f.catalog.splice(0, 1, ...Array.from({ length: 503 }, (_, i) => ({ id: i + 1, text: i === 502 ? '' : 'Menu ' + i, code: '', url: '', parentId: '' })));
  const result = await f.run(); assert.equal(result.catalog, 503);
  assert.match(publisher.current(f.root).snapshot.catalog.find(n => n.id === '503').text, /未命名/);
});
test('monthly gate uses the selected timezone and skips MCP after a successful full snapshot', async t => {
  const f = fixture(t); await f.run();
  f.api.schema = async () => { throw Error('must not contact MCP'); };
  const result = await f.run({ oncePerMonth: true, timeZone: 'Asia/Shanghai' });
  assert.equal(result.status, 'already-current-month');
  assert.notEqual(runner.monthKey('2026-10-31T16:00:00Z', 'Asia/Shanghai'), runner.monthKey('2026-10-31T16:00:00Z', 'UTC'));
  assert.notEqual(runner.monthKey('2026-01-01T00:00:00Z', 'UTC'), runner.monthKey('2027-01-01T00:00:00Z', 'UTC'));
  await assert.rejects(f.run({ oncePerMonth: true, now: new Date('2099-01-01') }), /must not contact MCP/);
});
