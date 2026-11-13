'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const defaults = {
    company: { type: 'gateway', model: 'bge-m3', dimensions: 1024 },
    openai: { type: 'openai', model: 'text-embedding-3-small', dimensions: 1536 }
};
const tokens = new Map();

function initializeConfiguration(file) {
    if (!file || !path.isAbsolute(file)) throw new Error('Specify an absolute private JSON path outside Git');
    for (let current = path.dirname(file);; current = path.dirname(current)) {
        if (fs.existsSync(path.join(current, '.git'))) throw new Error('Private configuration must be outside Git');
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Private configuration parent cannot be a link');
        if (current === path.dirname(current)) break;
    }
    if (fs.existsSync(file)) throw new Error('Private configuration already exists; existing content preserved');
    const value = { schema: 'knowledge-rag-config/v1', defaultProvider: 'company', providers: {
        company: { ...defaults.company, baseUrl: 'TODO', method: 'TODO', appId: 'TODO', appKey: 'TODO' },
        openai: { ...defaults.openai, apiKey: 'TODO' }
    } };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = JSON.stringify(value, null, 2) + '\n';
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error('Private configuration readback failed');
    return { configPath: file, environmentVariable: 'KNOWLEDGE_RAG_CONFIG', defaultProvider: 'company' };
}

function loadSettings(env = process.env) {
    const file = env.KNOWLEDGE_RAG_CONFIG;
    if (!file) return {};
    if (!path.isAbsolute(file)) throw new Error('embedding-config-path-invalid');
    let settings;
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('embedding-config-unreadable'); }
    if (settings?.schema !== 'knowledge-rag-config/v1' || !settings.providers ||
        typeof settings.providers !== 'object' || Array.isArray(settings.providers)) {
        throw new Error('embedding-config-invalid');
    }
    return settings;
}

function resolveEmbedding(options = {}) {
    if (options.embedding) return options.embedding;
    const settings = options.settings || loadSettings(options.env);
    const provider = options.provider || settings.defaultProvider || 'company';
    if (typeof provider !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(provider)) {
        throw new Error('embedding-provider-invalid');
    }
    const configured = settings.providers?.[provider] || {};
    const profile = { ...defaults[provider], ...configured, provider };
    if (!['gateway', 'openai'].includes(profile.type) || typeof profile.model !== 'string' || !profile.model ||
        !Number.isInteger(profile.dimensions) || profile.dimensions < 1 || profile.dimensions > 65536) {
        throw new Error('embedding-provider-invalid');
    }
    // Preserve existing OpenAI vectors. Gateway routes get separate vector identities.
    profile.identity = profile.type === 'openai' && provider === 'openai' ? '' :
        createHash('sha256').update(JSON.stringify([provider, profile.type, profile.method || ''])).digest('hex');
    return profile;
}

function validVector(vector, profile) {
    return Array.isArray(vector) && vector.length === profile.dimensions &&
        vector.every(Number.isFinite) && vector.some(value => value !== 0);
}

function requireText(value, name) {
    if (typeof value !== 'string' || !value.trim() || value === 'TODO') throw new Error('embedding-' + name + '-missing');
    return value.trim();
}

function baseUrl(profile) {
    let url;
    try { url = new URL(requireText(profile.baseUrl, 'base-url')); }
    catch { throw new Error('embedding-base-url-invalid'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('embedding-base-url-invalid');
    }
    return url.origin;
}

async function request(url, init, options) {
    const response = await (options.fetch || fetch)(url, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('embedding-http-' + response.status);
    try { return await response.json(); }
    catch { throw new Error('embedding-response-invalid'); }
}

function gatewayCode(value) {
    return /^\d{4,6}$/.test(String(value)) ? String(value) : 'invalid';
}

async function gatewayEmbedding(texts, profile, options) {
    const base = baseUrl(profile);
    const appId = requireText(profile.appId, 'app-id');
    const appKey = requireText(profile.appKey, 'app-key');
    const method = requireText(profile.method, 'method');
    if (profile.signType || profile.encryptType) throw new Error('embedding-gateway-crypto-unsupported');
    const authorization = Buffer.from(appId + ':' + appKey).toString('base64');
    const cacheKey = createHash('sha256').update(base + '\0' + authorization).digest('hex');
    async function token() {
        const cached = tokens.get(cacheKey);
        if (cached && cached.expires > Date.now()) return cached.promise;
        const entry = { expires: Infinity };
        entry.promise = request(base + '/dhccam/token/generate?grant_type=api_credentials', {
            method: 'GET', headers: { Authorization: authorization }
        }, options).then(result => {
            if (typeof result.access_token !== 'string' || !result.access_token ||
                !Number.isFinite(result.remain_time) || result.remain_time < 0) {
                throw new Error('embedding-token-' + gatewayCode(result.code));
            }
            entry.expires = result.remain_time === 0 ? Infinity : Date.now() + Math.max(0, result.remain_time - 30) * 1000;
            return result.access_token;
        }).catch(error => { if (tokens.get(cacheKey) === entry) tokens.delete(cacheKey); throw error; });
        tokens.set(cacheKey, entry);
        return entry.promise;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = await request(base + '/dhccam/gateway/index', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, token: await token(), token_type: 'api_credentials', method,
                version: profile.version || 'v1.0', biz_content: { body: { model: profile.model, input: texts } } })
        }, options);
        if (String(result.code) === '50001' && attempt === 0) { tokens.delete(cacheKey); continue; }
        if (String(result.code) !== '10000') throw new Error('embedding-gateway-' + gatewayCode(result.code));
        if (typeof result.data !== 'string') return result.data;
        try { return JSON.parse(result.data); }
        catch { throw new Error('embedding-response-invalid'); }
    }
}

async function embed(texts, options = {}) {
    const profile = resolveEmbedding(options);
    let result;
    if (profile.type === 'gateway') result = await gatewayEmbedding(texts, profile, options);
    else {
        const apiKey = requireText(options.apiKey || profile.apiKey, 'key');
        result = await request('https://api.openai.com/v1/embeddings', {
            method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: profile.model, input: texts, encoding_format: 'float' })
        }, options);
    }
    if (!Array.isArray(result?.data) || result.data.length !== texts.length) throw new Error('embedding-response-invalid');
    const vectors = new Array(texts.length);
    for (const row of result.data) {
        if (!Number.isInteger(row.index) || row.index < 0 || row.index >= texts.length || vectors[row.index] ||
            !validVector(row.embedding, profile)) throw new Error('embedding-response-invalid');
        vectors[row.index] = row.embedding;
    }
    return { vectors, tokens: result.usage?.total_tokens || 0 };
}

module.exports = { loadSettings, resolveEmbedding, embed, validVector, initializeConfiguration };
