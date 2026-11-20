'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

test('settings drafts are session-bound, omit credentials, and retain unreadable state until an explicit clear', {
  skip: process.platform !== 'win32',
}, async t => {
  const temp = createTempDirectory('workbench-settings-drafts-');
  const root = path.join(temp, '工程');
  const userProfile = path.join(temp, 'isolated-profile');
  const config = path.join(temp, 'private-config.json');
  const replacement = path.join(temp, 'other-private-config.json');
  const secret = randomBytes(20).toString('hex');
  const account = 'fixture-company-account-never-in-draft';
  const initial = {
    schema: 'knowledge-rag-config/v1', defaultProvider: 'openai',
    providers: { openai: { model: 'original-model', apiKey: secret }, company: { appId: account, appKey: secret } },
  };
  const bytes = JSON.stringify(initial);
  const capabilityRoot = path.join(root, '.agents');
  fs.mkdirSync(capabilityRoot, { recursive: true });
  fs.mkdirSync(userProfile);
  fs.writeFileSync(config, bytes);
  fs.writeFileSync(replacement, bytes);
  const processes = [];
  t.after(async () => {
    for (const { server, exited } of processes) {
      if (server.exitCode === null && server.signalCode === null) server.kill();
      await exited;
    }
    assert.ok(ownsTempDirectory(temp));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  });

  async function open(file, workspace = root, domain = 'knowledge') {
    const route = '/framework/settings/draft/' + domain;
    const server = fork(path.join(__dirname, '../prototype/serve.js'), ['--project', workspace], {
      env: { ...process.env, USERPROFILE: userProfile, KNOWLEDGE_RAG_CONFIG: domain === 'knowledge' ? file : '',
        BOS_MCP_CONFIG: domain === 'bos' ? file : '', PORT: '0', GIT_ALLOW_PROTOCOL: '' },
      silent: true,
    });
    const exited = once(server, 'exit');
    processes.push({ server, exited });
    const [hello] = await Promise.race([once(server, 'message'), exited.then(() => { throw Error('Workbench exited'); })]);
    const origin = new URL(hello.address).origin;
    const headers = { 'x-workbench-request': '1' };
    function post(body, credentials = {}, url = route) {
      return fetch(origin + url, {
        method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json', ...credentials },
        body: JSON.stringify(body), signal: AbortSignal.timeout(6000),
      });
    }
    const session = await post({ token: hello.bootstrap }, {}, '/framework/session');
    assert.equal(session.status, 200);
    const auth = { cookie: session.headers.get('set-cookie').split(';')[0], 'x-workbench-csrf': (await session.json()).csrf };
    const settings = async () => {
      const response = await fetch(origin + '/settings/' + domain, { headers, signal: AbortSignal.timeout(6000) });
      assert.equal(response.status, 200);
      return response.json();
    };
    return { post, auth, settings };
  }

  const current = await open(config);
  const read = async () => {
    const response = await current.post({ action: 'read' }, current.auth);
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await current.post({ action: 'read' })).status, 403);
  assert.equal((await current.post({ action: 'read' }, { cookie: current.auth.cookie })).status, 403);
  assert.deepEqual(await read(), { status: 'missing', tag: null });
  assert.deepEqual(fs.readdirSync(userProfile), []);

  const { revision, fields } = await current.settings();
  const providerAccount = fields.find(field => field.id === 'providers.company.appId');
  assert.equal(providerAccount.value, account);
  assert.equal(providerAccount.draftable, false);
  const bosConfig = path.join(temp, 'private-bos.json');
  const url = 'https://example.invalid/query?key=fixture-only';
  fs.writeFileSync(bosConfig, JSON.stringify({ 'bos-demand-query': { url } }));
  const bos = await open(bosConfig, root, 'bos');
  const bosSettings = await bos.settings();
  const urlField = bosSettings.fields.find(field => field.id === 'bos-demand-query.url');
  assert.ok(urlField?.secret && urlField.draftable === false && urlField.value === undefined);
  const forbiddenUrlDraft = await bos.post({ action: 'save', revision: bosSettings.revision, tag: null,
    values: {}, secretActions: { [urlField.id]: 'replace' } }, bos.auth);
  assert.equal(forbiddenUrlDraft.status, 400);
  assert.ok(!(await forbiddenUrlDraft.text()).includes(url));
  const intent = { 'providers.openai.apiKey': 'replace' };
  const candidate = {
    action: 'save', revision, tag: null,
    values: { 'providers.openai.model': 'candidate-model' }, secretActions: intent,
  };
  for (const malformed of [
    { ...candidate, values: { 'providers.openai.apiKey': secret } },
    { ...candidate, values: { 'providers.company.appId': account } },
    { ...candidate, secretActions: { 'providers.openai.apiKey': { action: 'replace', value: secret } } },
  ]) {
    const rejected = await current.post(malformed, current.auth);
    assert.equal(rejected.status, 400);
    const error = await rejected.text();
    assert.ok(!error.includes(secret) && !error.includes(account));
  }
  assert.deepEqual(fs.readdirSync(userProfile), []);

  const saved = await current.post(candidate, current.auth);
  assert.equal(saved.status, 200);
  const stored = await saved.json();
  assert.equal(stored.status, 'ready');
  assert.equal(typeof stored.tag, 'string');
  assert.deepEqual(stored.draft.values, candidate.values);
  assert.deepEqual(stored.draft.secretActions, intent);
  assert.equal(stored.draft.fields.find(field => field.id === 'providers.openai.model').value, 'original-model');
  assert.equal(fs.readFileSync(config, 'utf8'), bytes);
  const [entry, ...extra] = fs.readdirSync(userProfile, { recursive: true, withFileTypes: true }).filter(item => item.isFile());
  assert.ok(entry);
  assert.equal(extra.length, 0);
  const draftFile = path.join(entry.parentPath, entry.name);
  const draftBytes = fs.readFileSync(draftFile, 'utf8');
  for (const hidden of [secret, account, revision, JSON.stringify(config).slice(1, -1)]) assert.ok(!draftBytes.includes(hidden));

  const otherSource = await open(replacement);
  const changedSource = await otherSource.post({ action: 'read' }, otherSource.auth);
  assert.equal(changedSource.status, 200);
  const changed = await changedSource.json();
  assert.equal(changed.status, 'source-changed');
  assert.equal(changed.draft, undefined);
  assert.equal(fs.readFileSync(draftFile, 'utf8'), draftBytes);
  assert.equal((await current.post({ action: 'clear', tag: null }, current.auth)).status, 409);
  assert.equal((await read()).status, 'ready');

  const peer = await open(config);
  const race = await Promise.all([current, peer].map(({ post, auth }, index) => post({
    ...candidate, tag: stored.tag, values: { 'providers.openai.model': `window-${index}` },
  }, auth)));
  assert.deepEqual(race.map(response => response.status).sort(), [200, 409]);
  const winningWindow = race.findIndex(response => response.ok);
  assert.equal((await read()).draft.values['providers.openai.model'], `window-${winningWindow}`);
  assert.equal(fs.readFileSync(config, 'utf8'), bytes);

  const overlayRoot = path.join(temp, '成员', path.basename(root));
  fs.mkdirSync(path.join(overlayRoot, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(overlayRoot, '.agents', 'capability.json'), JSON.stringify({
    schemaVersion: 1, mode: 'workspace-overlay', workspace: 'member', contextRoot: '.agents', capabilityRoot,
    sharedDirectories: [], localDirectories: [], sourceRoots: [{ name: 'workspace', path: '.', target: overlayRoot, gitRoot: overlayRoot }],
  }));
  const member = await open(config, overlayRoot);
  assert.deepEqual(await (await member.post({ action: 'read' }, member.auth)).json(), { status: 'missing', tag: null });
  const memberSaved = await member.post({ ...candidate, values: { 'providers.openai.model': 'overlay-only' } }, member.auth);
  assert.equal(memberSaved.status, 200);
  const memberRecord = await memberSaved.json();
  assert.equal(memberRecord.status, 'ready');
  assert.equal((await read()).draft.values['providers.openai.model'], `window-${winningWindow}`);
  assert.equal((await member.post({ action: 'clear', tag: memberRecord.tag }, member.auth)).status, 200);

  const unrecognized = '{"schema":"agents-workbench-config-draft/v999","contents":"retained"}\n';
  fs.writeFileSync(draftFile, unrecognized);
  const problem = await read();
  assert.equal(problem.status, 'unreadable');
  assert.equal(problem.draft, undefined);
  assert.equal(typeof problem.tag, 'string');
  assert.equal((await current.settings()).fields.find(field => field.id === 'providers.openai.model').value, 'original-model');
  assert.equal(fs.readFileSync(draftFile, 'utf8'), unrecognized);
  const cleared = await current.post({ action: 'clear', tag: problem.tag }, current.auth);
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { status: 'missing', tag: null });
  assert.equal(fs.existsSync(draftFile), false);
  assert.equal(fs.readFileSync(config, 'utf8'), bytes);
  assert.equal(fs.readFileSync(replacement, 'utf8'), bytes);
});
