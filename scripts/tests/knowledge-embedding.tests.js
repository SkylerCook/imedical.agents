'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { resolveEmbedding, embed, loadSettings, initializeConfiguration } = require('../lib/knowledge-embedding');
const rag = require('../lib/knowledge-retrieval');

function company() {
    return { type: 'gateway', baseUrl: 'https://gateway.example.invalid', appId: randomUUID(), appKey: 'fixture-secret',
        method: 'fixture.embeddings', model: 'bge-m3', dimensions: 1024 };
}
function settings(profile = company()) {
    return { schema: 'knowledge-rag-config/v1', defaultProvider: 'company', providers: { company: profile } };
}
function vectors(length, dimensions) {
    return { data: Array.from({ length }, (_, index) => ({ index, embedding: Array.from({ length: dimensions }, (_, i) => i === index ? 1 : 0) })), usage: { total_tokens: 5 } };
}
function gateway(calls, failures = []) {
    return async (url, options) => {
        calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
        assert.equal(options.redirect, 'error');
        if (url.includes('/token/')) return { ok: true, json: async () => ({ access_token: 'fixture-token', remain_time: 0 }) };
        const failure = failures.shift();
        return { ok: true, json: async () => failure || ({ code: '10000', data: vectors(JSON.parse(options.body).biz_content.body.input.length, 1024) }) };
    };
}

test('company is default, selection overrides JSON and gateway routes have distinct identities', () => {
    assert.equal(resolveEmbedding({ env: {} }).provider, 'company');
    const config = settings();
    assert.equal(resolveEmbedding({ settings: config, provider: 'openai' }).model, 'text-embedding-3-small');
    const first = resolveEmbedding({ settings: config });
    config.providers.company.method = 'another.route';
    assert.notEqual(resolveEmbedding({ settings: config }).identity, first.identity);
});

test('JSON initialization is private, BOM compatible, exclusive and rejects repository paths', t => {
    const parent = path.join(os.tmpdir(), 'Codex');
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'knowledge-config-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'private/config.json');
    initializeConfiguration(file);
    assert.equal(loadSettings({ KNOWLEDGE_RAG_CONFIG: file }).defaultProvider, 'company');
    const bytes = fs.readFileSync(file);
    assert.throws(() => initializeConfiguration(file), /already exists/);
    assert.deepEqual(fs.readFileSync(file), bytes);
    fs.writeFileSync(file, '\uFEFF' + bytes.toString('utf8'));
    assert.equal(loadSettings({ KNOWLEDGE_RAG_CONFIG: file }).schema, 'knowledge-rag-config/v1');
    fs.mkdirSync(path.join(root, 'repo/.git'), { recursive: true });
    assert.throws(() => initializeConfiguration(path.join(root, 'repo/config.json')), /outside Git/);
    fs.writeFileSync(file, '{"secret":broken');
    assert.throws(() => loadSettings({ KNOWLEDGE_RAG_CONFIG: file }), /^Error: embedding-config-unreadable$/);
});

test('gateway batches texts, caches token and refreshes once on token expiry', async () => {
    const config = settings(), calls = [];
    const options = { settings: config, fetch: gateway(calls) };
    assert.equal((await embed(['中文', 'text'], options)).vectors.length, 2);
    await embed(['next'], options);
    assert.equal(calls.filter(call => call.url.includes('/token/')).length, 1);
    assert.deepEqual(calls[1].body.biz_content.body, { model: 'bge-m3', input: ['中文', 'text'] });
    const expiredCalls = [];
    await embed(['refresh'], { settings: config, fetch: gateway(expiredCalls, [{ code: '50001' }]) });
    assert.equal(expiredCalls.filter(call => call.url.includes('/token/')).length, 1);
    assert.equal(expiredCalls.filter(call => call.body).length, 2);
});

test('gateway failures are sanitized and never call a different provider', async () => {
    const calls = [];
    await assert.rejects(embed(['text'], { settings: settings(), fetch: gateway(calls, [{ code: '20003', msg: 'fixture-secret' }]) }), /^Error: embedding-gateway-20003$/);
    assert.ok(calls.every(call => call.url.startsWith('https://gateway.example.invalid/')));
    await assert.rejects(embed(['text'], { settings: settings({ ...company(), signType: 'MD5' }), fetch: gateway([]) }), /crypto-unsupported/);
    await assert.rejects(embed(['text'], { settings: settings(), fetch: gateway([], [{ code: '10000', data: vectors(1, 1536) }]) }), /response-invalid/);
});

test('company and OpenAI caches coexist, missing configuration and invalid JSON still return local results', async t => {
    const parent = path.join(os.tmpdir(), 'Codex');
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'knowledge-providers-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const context = { capabilityRoot: root, contextRoot: root };
    fs.mkdirSync(path.join(root, 'plugins/imedical-ui/references'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins/imedical-ui/references/test.md'), '# 标签对齐\n\n输入框标签对齐条件。');
    fs.mkdirSync(path.join(root, '.knowledge-cache'));
    fs.writeFileSync(rag.policyPath(context), JSON.stringify({ schema: 'knowledge-policy/v1', allowedDirectories: ['plugins/imedical-ui/references'], allowQuery: true }));
    const companySettings = settings(), calls = [];
    const companyOptions = { settings: companySettings, fetch: gateway(calls) };
    const openaiOptions = { provider: 'openai', settings: {}, apiKey: 'fixture', fetch: async () => ({ ok: true, json: async () => vectors(1, 1536) }) };
    for (const options of [openaiOptions, companyOptions]) {
        const built = await rag.build(context, { ...options, approve: rag.preview(context, undefined, options).snapshot });
        assert.equal(built.complete, true);
        rag.exportBundle(context, options);
    }
    assert.equal((await rag.search(context, '标签', { ...openaiOptions, queryPublic: true })).mode, 'hybrid');
    assert.equal((await rag.search(context, '标签', { ...companyOptions, queryPublic: true })).mode, 'hybrid');
    const missing = await rag.search(context, '标签', { env: {}, queryPublic: true });
    assert.equal(missing.mode, 'lexical');
    assert.ok(missing.matches.length);
    const invalid = await rag.search(context, '标签', { env: { KNOWLEDGE_RAG_CONFIG: path.join(root, 'missing') }, queryPublic: true });
    assert.equal(invalid.mode, 'lexical');
    assert.ok(invalid.warnings.includes('embedding-config-unreadable'));
    assert.ok(invalid.matches.length);
    const failed = await rag.search(context, '标签', { settings: companySettings, queryPublic: true, fetch: gateway([], [{ code: '20003' }]) });
    assert.equal(failed.mode, 'lexical');
    assert.deepEqual(failed.warnings, ['embedding-gateway-20003']);
});
