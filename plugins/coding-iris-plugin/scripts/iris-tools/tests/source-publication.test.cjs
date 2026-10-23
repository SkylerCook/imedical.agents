'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const publication = require('../source-publication');
const guard = require('../deploy-guard');
const direct = require('../deploy-direct');

function fixture(t, {environmentType = 'production', content = 'Class Demo\n{\n}\n', kind = 'backend'} = {}) {
  const parent = process.platform === 'win32' ? 'D:\\tmp\\Codex' : os.tmpdir();
  fs.mkdirSync(parent, {recursive: true});
  const root = fs.mkdtempSync(path.join(parent, 'iris-publication-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (...args) => { const result = spawnSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true}); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
  const name = kind === 'backend' ? 'Demo.cls' : 'scripts/a.js', localPath = path.join(root, name);
  fs.mkdirSync(path.dirname(localPath), {recursive: true}); fs.writeFileSync(localPath, content);
  git('add', '.'); git('commit', '-m', 'fixture');
  const context = {workspaceRoot: root, contextRoot: path.join(root, '.agents')};
  const file = {localPath, remotePath: kind === 'backend' ? 'Demo.cls' : 'web/scripts/a.js'};
  const input = {gitRoot: root, head: git('rev-parse', 'HEAD'), environmentAlias: 'fixture', environmentType,
    configurationFingerprint: 'a'.repeat(64), files: [{path: name, sourcePath: localPath, document: file.remotePath, kind,
      localSha256: guard.hash(Buffer.from(content)), remoteSha256: null, remoteTs: null}]};
  const frozen = publication.freeze(input);
  const plan = {schema: 'iris-source-sync/v1', state: 'ready-to-publish', projectRoot: root, contextRoot: context.contextRoot, publication: frozen};
  return {root, git, file, input, frozen, plan, context, kind, ready: extra => publication.assertReady({plan, context, files: [file], configurationFingerprint: input.configurationFingerprint, ...extra})};
}
test('publication binds exact commit, local bytes, upload representation and baseline', t => {
  const f = fixture(t, {content: '\uFEFFClass Demo\r\n{\r\n}\r\n'});
  assert.notEqual(f.frozen.files[0].localSha256, f.frozen.files[0].artifactSha256);
  assert.equal(f.frozen.files[0].artifactSha256, guard.hash(Buffer.from('Class Demo\n{\n}\n')));
  assert.equal(publication.validate(f.frozen), f.frozen);
  assert.throws(() => f.ready(), error => error.reason === 'production-approval-required' && error.details.token === f.frozen.sha256);
  for (const action of ['overwrite', 'resume', 'merge']) assert.throws(() => f.ready({decision: {schema: 'iris-deploy-decision/v1', action, token: f.frozen.sha256}}), /production-approval-required/);
  const approved = f.ready({decision: {schema: 'iris-publication-decision/v1', action: 'publish', token: f.frozen.sha256}});
  assert.equal(approved.files[0].publicationArtifactSha256, f.frozen.files[0].artifactSha256);
  assert.throws(() => publication.validate({...f.frozen, environmentType: 'test'}), /publication-binding-changed/);
});
test('review, target configuration, file set and source drift invalidate publication', t => {
  const f = fixture(t, {environmentType: 'test'});
  assert.equal(f.ready().publication.sha256, f.frozen.sha256);
  f.plan.state = 'review-pending'; assert.throws(() => f.ready(), /source-plan-review-required/); f.plan.state = 'ready-to-publish';
  assert.throws(() => f.ready({configurationFingerprint: 'b'.repeat(64)}), /publication-environment-changed/);
  assert.throws(() => f.ready({environmentAlias: 'another'}), /publication-environment-changed/);
  assert.throws(() => f.ready({files: []}), /publication-file-set-changed/);
  fs.appendFileSync(f.file.localPath, '// concurrent\n');
  assert.throws(() => f.ready(), /publication-local-source-changed/);
  fs.writeFileSync(f.file.localPath, 'Class Demo\n{\n}\n');
  f.git('commit', '--allow-empty', '-m', 'another commit');
  assert.throws(() => f.ready(), /publication-head-changed/);
});
test('remote drift stops before upload; approved artifacts cannot be replaced by merges', async t => {
  const f = fixture(t, {environmentType: 'test'}), files = f.ready().files;
  let writes = 0;
  const adapter = publication.bindAdapter({read: async () => Buffer.from('someone else'), put: async () => { writes++; }, compile: async () => ({status: 'compiled'})}, f.frozen);
  const drift = await direct.run({files, adapter, kind: 'backend'});
  assert.equal(drift.reason, 'publication-remote-baseline-changed'); assert.equal(writes, 0);
  const bound = publication.bindAdapter({read: async () => null, put: async () => { writes++; }, compile: async () => ({status: 'compiled'})}, f.frozen);
  await bound.read(f.file);
  await assert.rejects(() => bound.put({...f.file, bytes: Buffer.from('unreviewed')}), /publication-artifact-changed/);
  assert.equal(writes, 0);
});
test('foreign staging and configuration changes stop the next write without restoring other work', async t => {
  const f = fixture(t, {environmentType: 'test'});
  fs.writeFileSync(path.join(f.root, 'parallel.txt'), 'another task\n'); f.git('add', 'parallel.txt');
  assert.throws(() => f.ready(), /publication-index-changed/);
  assert.equal(fs.readFileSync(path.join(f.root, 'parallel.txt'), 'utf8'), 'another task\n');
  // Build another reviewed binding that includes the known foreign index.
  fs.mkdirSync(path.join(f.context.contextRoot, 'config'), {recursive: true});
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/project-env.json'), '{}'); fs.writeFileSync(path.join(f.root, '.mcp.json'), '{}');
  const approved = publication.freeze({...f.input, configurationFingerprint: publication.fingerprint({config: {}, mcp: {}})});
  let writes = 0;
  const adapter = publication.bindAdapter({read: async () => null, put: async () => {writes++;}}, approved, {context: f.context});
  await adapter.read(f.file);
  fs.writeFileSync(path.join(f.root, '.mcp.json'), '{"changed":true}');
  await assert.rejects(() => adapter.put({...f.file, bytes: fs.readFileSync(f.file.localPath)}), /publication-environment-changed/);
  assert.equal(writes, 0); assert.match(f.git('status', '--porcelain', '--', 'parallel.txt'), /^A/);
});
test('index flags are part of the reviewed publication identity', t => {
  const f = fixture(t, {environmentType: 'test'});
  f.git('update-index', '--assume-unchanged', 'Demo.cls');
  assert.throws(() => f.ready(), /publication-index-changed/);
});
test('compiled Storage is recorded separately and frontend final batch drift never verifies', async t => {
  const f = fixture(t, {environmentType: 'test'});
  let remote = null;
  const baseAdapter = {read: async () => remote, put: async file => {remote = file.bytes;}, compile: async () => {
    remote = Buffer.from('Class Demo\n{\nStorage Default\n{\n<Type>%Storage.Persistent</Type>\n}\n}\n'); return {status: 'compiled'};
  }};
  const result = await direct.run({files: f.ready().files, adapter: publication.bindAdapter(baseAdapter, f.frozen), kind: 'backend'});
  assert.equal(result.status, 'verified'); assert.equal(result.files[0].storageSynced, true);
  assert.notEqual(result.files[0].uploadSha256, result.files[0].postCompileSha256);
  const frontend = fixture(t, {environmentType: 'test', kind: 'frontend', content: '// approved\n'});
  let web = null;
  const changed = await direct.run({files: frontend.ready().files, adapter: publication.bindAdapter({read: async () => web, put: async file => {web = file.bytes;}, compile: async () => {web = Buffer.from('// compiler or external writer\n'); return {status: 'compiled'};}}, frontend.frozen), kind: 'frontend'});
  assert.equal(changed.reason, 'post-compile-source-changed'); assert.notEqual(changed.status, 'verified');
});
test('on-demand direct and guarded CLIs require source plan before any transport is created', async t => {
  const f = fixture(t, {environmentType: 'test'});
  fs.mkdirSync(path.join(f.context.contextRoot, 'config'), {recursive: true}); fs.mkdirSync(path.join(f.context.contextRoot, '.git'));
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/project_context_profile.md'), '- contextMode：`intent-first-on-demand-export`\n');
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/iris_project_profile.md'), '- 默认需求交付类型：project\n');
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/project-env.json'), '{}'); fs.writeFileSync(path.join(f.root, '.mcp.json'), '{}');
  let clients = 0; t.mock.method(require('../../../../../scripts/lib/atelier-client'), 'createAtelierClient', () => {clients++; throw Error('transport must not start');});
  const logs = []; t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
  const previous = process.exitCode;
  try {
    for (const mode of ['direct', 'guarded']) await require('../deploy-protected').main('backend', ['--project-root', f.root, '--files', 'Demo.cls', '--mode', mode, '--demand', '123', '--execute']);
    assert.equal(clients, 0); assert.ok(logs.every(result => result.reason === 'source-plan-required'));
  } finally {process.exitCode = previous;}
});
test('standard and project are explicit branches independent of on-demand context mode', async t => {
  const f = fixture(t, {environmentType: 'test'}), profile = path.join(f.context.contextRoot, 'config/iris_project_profile.md');
  fs.mkdirSync(path.join(f.context.contextRoot, 'config'), {recursive: true}); fs.mkdirSync(path.join(f.context.contextRoot, '.git'));
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/project_context_profile.md'), '- contextMode: intent-first-on-demand-export\n');
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/project-env.json'), '{}'); fs.writeFileSync(path.join(f.root, '.mcp.json'), '{}');
  assert.throws(() => publication.required(f.context), /explicit-demand-kind-required/);
  fs.writeFileSync(profile, '- 默认需求交付类型：project\n');
  assert.equal(publication.required(f.context), true); assert.equal(publication.required(f.context, {}, {kind: 'standard'}), false);
  fs.writeFileSync(profile, '- 默认需求交付类型：standard\n');
  assert.equal(publication.required(f.context), false); assert.equal(publication.required(f.context, {}, {kind: 'project'}), true);
  fs.unlinkSync(profile);
  let clients = 0; t.mock.method(require('../compile-csp'), 'connection', () => ({protocol: 'https:', hostname: 'fixture.invalid', port: 443, path: '/api/atelier/v1/FIXTURE/'}));
  t.mock.method(require('../../../../../scripts/lib/atelier-client'), 'createAtelierClient', () => {clients++; throw Object.assign(Error('fixture stop'), {code: 'synthetic-transport-stop'});});
  const logs = []; t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
  const previous = process.exitCode, common = ['--project-root', f.root, '--files', 'Demo.cls', '--execute'];
  try {
    await require('../deploy-protected').main('backend', common); assert.equal(logs.at(-1).reason, 'explicit-demand-kind-required'); assert.equal(clients, 0);
    await require('../deploy-protected').main('backend', [...common, '--kind', 'project']); assert.equal(logs.at(-1).reason, 'source-plan-required'); assert.equal(clients, 0);
    await require('../deploy-protected').main('backend', [...common, '--kind', 'standard']); assert.equal(logs.at(-1).reason, 'synthetic-transport-stop'); assert.equal(clients, 1);
  } finally {process.exitCode = previous;}
});
test('publication Question uses a dedicated receipt and old guard decisions cannot publish', () => {
  const q = require('../deploy-question');
  const result = q.needsInput('production-approval-required', {token: 'a'.repeat(64)});
  assert.deepEqual(result.details.options, ['pause', 'inspect', 'publish']);
  assert.equal(result.question.decisionSchema, 'iris-publication-decision/v1');
  assert.equal(q.decisionError({action: 'publish', token: 'a'.repeat(64)}), 'publication-decision-requires-publication-gate');
});
test('approved CLI publication persists verified evidence and cannot replay a consumed plan', async t => {
  const f = fixture(t), core = require('../source-sync-core');
  fs.writeFileSync(path.join(f.root, '.gitignore'), '.agents/\n.mcp.json\n'); f.git('add', '.gitignore'); f.git('commit', '-m', 'fixture privacy');
  fs.mkdirSync(path.join(f.context.contextRoot, 'config'), {recursive: true});
  const nested = spawnSync('git', ['-C', f.context.contextRoot, 'init'], {encoding: 'utf8', windowsHide: true}); assert.equal(nested.status, 0, nested.stderr);
  fs.writeFileSync(path.join(f.context.contextRoot, '.git/info/exclude'), 'work/\nconfig/\n');
  const config = {}, mcp = {};
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/project_context_profile.md'), '- contextMode：`intent-first-on-demand-export`\n');
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/iris_project_profile.md'), '- 默认需求交付类型：project\n');
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/project-env.json'), JSON.stringify(config)); fs.writeFileSync(path.join(f.root, '.mcp.json'), JSON.stringify(mcp));
  // No real connection or credential enters this fixture. The transport factory
  // is replaced so the test exercises the CLI and persistence gates only.
  t.mock.method(require('../compile-csp'), 'connection', () => ({protocol: 'https:', hostname: 'fixture.invalid', port: 443, path: '/api/atelier/v1/FIXTURE/'}));
  const plan = core.createPlan({projectRoot: f.root, environmentAlias: 'fixture', environmentType: 'production', phase: 'pre-deploy', demand: '123', files: ['Demo.cls']});
  plan.publication = publication.freeze({...f.input, head: f.git('rev-parse', 'HEAD'), configurationFingerprint: publication.fingerprint({config, mcp})});
  plan.state = 'ready-to-publish'; core.save(plan);
  let clients = 0, writes = 0, compiles = 0, closes = 0, remote = null;
  t.mock.method(require('../../../../../scripts/lib/atelier-client'), 'createAtelierClient', () => {
    clients++;
    return {readDocument: async () => remote === null ? null : {bytes: remote, ts: '2026-01-01 00:00:00.000', enc: false},
      writeDocument: async (_name, bytes) => {writes++; remote = bytes;}, compile: async () => {compiles++; return {status: {errors: []}, result: {content: []}, console: []};},
      close: async () => {closes++; return {cleanupVerified: true, licenseReleaseVerified: false};}};
  });
  const output = []; t.mock.method(console, 'log', value => output.push(JSON.parse(value)));
  const argv = ['--project-root', f.root, '--files', 'Demo.cls', '--source-plan', plan.planPath, '--execute'];
  const previous = process.exitCode;
  try {
    await require('../deploy-protected').main('backend', argv);
    assert.equal(output.at(-1).reason, 'production-approval-required'); assert.equal(clients, 0);
    assert.equal(fs.existsSync(path.join(f.root, '.git/iris-source-sync.lock')), false);
    const receipt = path.join(f.context.contextRoot, 'config/publish.json');
    fs.writeFileSync(receipt, JSON.stringify({schema: 'iris-publication-decision/v1', action: 'publish', token: plan.publication.sha256}));
    process.exitCode = previous;
    await require('../deploy-protected').main('backend', [...argv, '--publication-decision', receipt]);
    assert.equal(output.at(-1).status, 'verified', JSON.stringify(output.at(-1)));
    assert.equal(clients, 1); assert.equal(writes, 1); assert.equal(compiles, 1); assert.ok(closes >= 1);
    const persisted = core.load(plan.planPath).plan;
    assert.equal(persisted.state, 'verified'); assert.equal(persisted.deployment.publicationSha256, plan.publication.sha256);
    assert.equal(persisted.deployment.files[0].postCompileSha256, guard.hash(remote));
    await require('../deploy-protected').main('backend', [...argv, '--publication-decision', receipt]);
    assert.equal(output.at(-1).reason, 'source-plan-review-required'); assert.equal(clients, 1);
    assert.equal(fs.existsSync(path.join(f.root, '.git/iris-source-sync.lock')), false);
  } finally {process.exitCode = previous;}
});
test('mixed publication completes both kinds and rechecks earlier groups after the final compile', async t => {
  for (const drift of [false, true]) await t.test(drift ? 'earlier group drift' : 'all groups verified', async t => {
    const f = fixture(t), core = require('../source-sync-core'), script = path.join(f.root, 'scripts/a.js');
    fs.mkdirSync(path.dirname(script), {recursive: true}); fs.writeFileSync(script, '// approved frontend\n');
    fs.writeFileSync(path.join(f.root, '.gitignore'), '.agents/\n.mcp.json\n'); f.git('add', '.'); f.git('commit', '-m', 'fixture frontend');
    fs.mkdirSync(path.join(f.context.contextRoot, 'config'), {recursive: true});
    assert.equal(spawnSync('git', ['-C', f.context.contextRoot, 'init'], {windowsHide: true}).status, 0);
    fs.writeFileSync(path.join(f.context.contextRoot, '.git/info/exclude'), 'work/\nconfig/\n');
    const config = {web: {basePath: 'web', cspBasePath: 'web/csp', frontendTransport: 'atelier'}}, mcp = {};
    fs.writeFileSync(path.join(f.context.contextRoot, 'config/project-env.json'), JSON.stringify(config)); fs.writeFileSync(path.join(f.root, '.mcp.json'), '{}');
    fs.writeFileSync(path.join(f.context.contextRoot, 'config/project_context_profile.md'), '- contextMode: intent-first-on-demand-export\n');
    fs.writeFileSync(path.join(f.context.contextRoot, 'config/iris_project_profile.md'), '- 默认需求交付类型：project\n');
    t.mock.method(require('../compile-csp'), 'connection', () => ({protocol: 'https:', hostname: 'fixture.invalid', port: 443, path: '/api/atelier/v1/FIXTURE/'}));
    const plan = core.createPlan({projectRoot: f.root, environmentAlias: 'fixture', environmentType: 'production', phase: 'pre-deploy', demand: '123', files: ['Demo.cls', 'scripts/a.js']});
    plan.publication = publication.freeze({...f.input, head: f.git('rev-parse', 'HEAD'), configurationFingerprint: publication.fingerprint({config, mcp}), files: [
      f.input.files[0], {path: 'scripts/a.js', sourcePath: script, document: 'web/scripts/a.js', kind: 'frontend', localSha256: guard.hash(fs.readFileSync(script)), remoteSha256: null}
    ]}); plan.state = 'ready-to-publish'; core.save(plan);
    const receipt = path.join(f.context.contextRoot, 'config/publish.json'); fs.writeFileSync(receipt, JSON.stringify({schema: 'iris-publication-decision/v1', action: 'publish', token: plan.publication.sha256}));
    const remote = new Map(); let clients = 0, compiles = 0, unknown = 0;
    t.mock.method(require('../../../../../scripts/lib/atelier-client'), 'createAtelierClient', () => {
      clients++; return {readDocument: async name => remote.has(name) ? {bytes: remote.get(name), ts: '2026-01-01 00:00:00.000', enc: false} : null,
        writeDocument: async (name, bytes) => remote.set(name, bytes), compile: async () => {compiles++; return {status: {errors: []}, result: {content: []}, console: []};},
        markUnknown: () => {unknown++;}, close: async () => ({cleanupVerified: true})};
    });
    const output = []; t.mock.method(console, 'log', value => output.push(JSON.parse(value)));
    const common = ['--project-root', f.root, '--source-plan', plan.planPath, '--publication-decision', receipt, '--execute'];
    const previous = process.exitCode;
    try {
      await require('../deploy-protected').main('backend', [...common, '--files', 'Demo.cls']);
      assert.equal(output.at(-1).status, 'group-verified', JSON.stringify(output.at(-1)));
      assert.deepEqual(output.at(-1).pendingPublicationGroups, ['frontend']); assert.equal(core.load(plan.planPath).plan.state, 'ready-to-publish');
      await require('../deploy-protected').main('backend', [...common, '--files', 'Demo.cls']);
      assert.equal(output.at(-1).reason, 'publication-group-already-verified'); assert.equal(clients, 1);
      if (drift) remote.set('Demo.cls', Buffer.from('Class External\n{\n}\n'));
      process.exitCode = previous;
      await require('../deploy-protected').main('frontend', [...common, '--source-root', f.root, '--files', 'scripts/a.js']);
      const persisted = core.load(plan.planPath).plan;
      if (drift) {
        assert.equal(output.at(-1).reason, 'publication-final-readback-mismatch'); assert.equal(persisted.state, 'failed-or-unknown'); assert.equal(unknown, 1);
      } else {
        assert.equal(output.at(-1).status, 'verified', JSON.stringify(output.at(-1))); assert.equal(persisted.state, 'verified');
        assert.equal(persisted.deployment.files.length, 2); assert.equal(persisted.deployment.finalPublicationReadback, 'verified');
        const webReceipt = persisted.deployment.files.find(file => file.document === 'web/scripts/a.js');
        assert.equal(webReceipt.localSha256, guard.hash(fs.readFileSync(script)));
      }
      assert.equal(clients, 2); assert.equal(compiles, 1); // JS requires no CSP compilation.
    } finally {process.exitCode = previous;}
  });
});
