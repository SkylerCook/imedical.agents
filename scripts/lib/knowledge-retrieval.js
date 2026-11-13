'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { digest, chunks, loadDocuments } = require('./knowledge-sources');
const { resolveEmbedding, embed, validVector } = require('./knowledge-embedding');

const VERSION = 'knowledge-chunks/v1';
const TERMS_VERSION = 'knowledge-terms/v2';
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

function terms(text) {
    const normalized = text.normalize('NFKC').toLowerCase();
    const words = [...segmenter.segment(normalized)].filter(part => part.isWordLike).map(part => part.segment);
    for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) {
        const characters = [...match[0]];
        for (let index = 0; index < characters.length - 1; index++) words.push(characters[index] + characters[index + 1]);
    }
    words.push(...(normalized.match(/[a-z_$][a-z0-9_$]*(?:[.:-][a-z0-9_$-]+)+/g) || []));
    return words;
}

function lexicalSearch(items, query, cachedTerms = new Map()) {
    const queryTerms = [...new Set(terms(query))];
    const rows = items.map(item => {
        const words = cachedTerms.get(item.id) || terms((item.sourcePath || '') + '\n' + item.heading + '\n' + item.text);
        const counts = new Map();
        for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
        return { item, counts, length: words.length };
    });
    const average = rows.reduce((sum, row) => sum + row.length, 0) / Math.max(1, rows.length) || 1;
    const frequency = new Map(queryTerms.map(word => [word, rows.filter(row => row.counts.has(word)).length]));
    return rows.map(row => {
        let score = 0;
        for (const word of queryTerms) {
            const count = row.counts.get(word) || 0;
            const idf = Math.log(1 + (rows.length - frequency.get(word) + 0.5) / (frequency.get(word) + 0.5));
            score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * row.length / average));
        }
        return { item: row.item, score };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
}

function policyPath(context) { return path.join(context.contextRoot, '.knowledge-cache', 'policy.json'); }
function readPolicy(context) {
    assertCachePath(context.contextRoot);
    const file = policyPath(context);
    if (!fs.existsSync(file)) return { schema: 'knowledge-policy/v1', allowedDirectories: [], allowQuery: true };
    const policy = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (policy.schema !== 'knowledge-policy/v1' || !Array.isArray(policy.allowedDirectories) ||
        typeof policy.allowQuery !== 'boolean') throw new Error('Invalid knowledge policy');
    for (const directory of policy.allowedDirectories) {
        if (typeof directory !== 'string' || !directory || directory.includes('\\') || directory.startsWith('/') ||
            directory.split('/').some(part => !part || part === '.' || part === '..') || directory.includes(':')) {
            throw new Error('Policy requires explicit capability-relative directories');
        }
    }
    return policy;
}
function allowed(item, policy) {
    return item.scope === 'shared' && policy.allowedDirectories.some(directory => item.path.startsWith(directory + '/'));
}

function embeddingEligible(item, policy) {
    return allowed(item, policy) && Buffer.byteLength(item.heading + '\n' + item.text, 'utf8') <= 8000;
}

function assertCachePath(root) {
    const cache = path.join(root, '.knowledge-cache');
    if (fs.existsSync(cache) && fs.lstatSync(cache).isSymbolicLink()) throw new Error('Knowledge cache cannot be a link');
    for (const name of fs.existsSync(cache) ? fs.readdirSync(cache) : []) {
        const file = path.join(cache, name);
        if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Knowledge cache file cannot be a link');
    }
}

function indexName(profile) { return profile.provider === 'openai' ? 'index.sqlite' : profile.provider + '.sqlite'; }
function databasePath(context, profile = resolveEmbedding()) { return path.join(context.capabilityRoot, '.knowledge-cache', indexName(profile)); }
function bundlePath(context, profile = resolveEmbedding()) { return path.join(context.capabilityRoot, 'vendor', 'knowledge-index', indexName(profile)); }

function openBundle(context, profile) {
    const file = bundlePath(context, profile);
    if (!fs.existsSync(file)) return null;
    const { safeFile } = require('./knowledge-sources');
    safeFile(context.capabilityRoot, 'vendor/knowledge-index/' + indexName(profile));
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(file, {readOnly:true});
    try {
        const format = database.prepare('SELECT value FROM state WHERE key=?').get('bundle-format')?.value;
        if (format !== 'knowledge-bundle/v1' || database.prepare('SELECT value FROM state WHERE key=?').get('model')?.value !== profile.model ||
            database.prepare('SELECT value FROM state WHERE key=?').get('dimensions')?.value !== String(profile.dimensions) ||
            (database.prepare('SELECT value FROM state WHERE key=?').get('identity')?.value || '') !== profile.identity ||
            database.prepare('SELECT value FROM state WHERE key=?').get('chunk-version')?.value !== VERSION) {
            throw new Error('embedding-bundle-incompatible');
        }
        return database;
    } catch (error) { database.close(); throw error; }
}

function decodeVector(row, profile) {
    if (!row) return null;
    if (typeof row.data === 'string') return JSON.parse(row.data);
    const bytes = Buffer.from(row.data);
    if (bytes.length !== profile.dimensions * 4) return null;
    return Array.from({length:profile.dimensions}, (_, index) => bytes.readFloatLE(index * 4));
}

function exportBundle(context, options = {}) {
    const profile = resolveEmbedding(options);
    assertCachePath(context.capabilityRoot);
    const { DatabaseSync } = require('node:sqlite');
    const source = new DatabaseSync(databasePath(context, profile), {readOnly:true});
    const items = prepare(context);
    const destination = bundlePath(context, profile);
    const directory = path.dirname(destination);
    fs.mkdirSync(directory, {recursive:true});
    const { safeFile } = require('./knowledge-sources');
    safeFile(context.capabilityRoot, 'vendor/knowledge-index');
    if (fs.existsSync(destination)) safeFile(context.capabilityRoot, 'vendor/knowledge-index/' + indexName(profile));
    // Keep the replacement on the same volume for atomic publication.
    const temporary = path.join(directory, '.index-' + require('node:crypto').randomUUID() + '.sqlite');
    let output;
    try {
        output = new DatabaseSync(temporary);
        output.exec('CREATE TABLE chunks (generation TEXT,id TEXT PRIMARY KEY,data TEXT,terms TEXT); CREATE TABLE vectors (key TEXT PRIMARY KEY,data BLOB,dimensions INTEGER); CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT); BEGIN IMMEDIATE');
        const generation = digest(JSON.stringify(items.map(item => [item.id,item.hash,item.heading])) + VERSION);
        const keys = new Set();
        for (const item of items) {
            const key = vectorKey(item, profile);
            const vector = decodeVector(source.prepare('SELECT data FROM vectors WHERE key=?').get(key), profile);
            if (!validVector(vector, profile)) throw new Error('Complete current source embeddings before export: ' + item.path);
            output.prepare('INSERT INTO chunks VALUES (?,?,?,?)').run(generation,item.id,JSON.stringify(item),JSON.stringify(terms((item.sourcePath || '')+'\n'+item.heading+'\n'+item.text)));
            if (keys.has(key)) continue;
            keys.add(key);
            const bytes = Buffer.alloc(profile.dimensions * 4);
            vector.forEach((value,index) => bytes.writeFloatLE(value,index*4));
            output.prepare('INSERT INTO vectors VALUES (?,?,?)').run(key,bytes,profile.dimensions);
        }
        for (const [key,value] of Object.entries({'bundle-format':'knowledge-bundle/v1',provider:profile.provider,identity:profile.identity,model:profile.model,dimensions:String(profile.dimensions),
            'chunk-version':VERSION,'terms-version':TERMS_VERSION,generation})) output.prepare('INSERT INTO state VALUES (?,?)').run(key,value);
        output.exec('COMMIT; VACUUM');
        output.close(); output = null;
        const verification = new DatabaseSync(temporary, {readOnly:true});
        try {
            if (verification.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
                verification.prepare('SELECT COUNT(*) AS count FROM vectors').get().count !== keys.size) throw new Error('Bundle verification failed');
        } finally { verification.close(); }
        fs.renameSync(temporary,destination);
        return {path:destination,chunks:items.length,vectors:keys.size,bytes:fs.statSync(destination).size,provider:profile.provider,model:profile.model,generation};
    } finally {
        output?.close(); source.close();
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
function openDatabase(file) {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(file);
    database.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS chunks (generation TEXT, id TEXT, data TEXT, terms TEXT, PRIMARY KEY(generation,id));
        CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, data TEXT, dimensions INTEGER);
        CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY, tokens INTEGER, created TEXT);`);
    return database;
}
function vectorKey(item, profile) {
    const prefix = profile.identity ? profile.identity + '\0' : '';
    return digest(prefix + profile.model + '\0' + profile.dimensions + '\0' + VERSION + '\0' + item.heading + '\n' + item.text);
}

function prepare(context, domain = 'all') {
    return loadDocuments(context, domain).flatMap(chunks);
}

function readCachedTerms(context, items, profile) {
    const cached = new Map();
    const localFile = databasePath(context, profile);
    const file = fs.existsSync(localFile) ? localFile : bundlePath(context, profile);
    if (!fs.existsSync(file)) return cached;
    let database;
    try {
        assertCachePath(context.capabilityRoot);
        const { DatabaseSync } = require('node:sqlite');
        database = file === localFile ? new DatabaseSync(file, {readOnly:true}) : openBundle(context, profile);
        if (database.prepare('SELECT value FROM state WHERE key=?').get('terms-version')?.value !== TERMS_VERSION) return cached;
        const active = database.prepare('SELECT value FROM state WHERE key=?').get('generation');
        if (!active) return cached;
        const current = new Map(items.map(item => [item.id, item]));
        for (const row of database.prepare('SELECT id,data,terms FROM chunks WHERE generation=?').all(active.value)) {
            const item = current.get(row.id);
            const stored = JSON.parse(row.data);
            if (!item || stored.hash !== item.hash || stored.heading !== item.heading) continue;
            const words = JSON.parse(row.terms);
            if (Array.isArray(words) && words.every(word => typeof word === 'string')) cached.set(row.id, words);
        }
    } catch { cached.clear(); }
    finally { database?.close(); }
    return cached;
}

function preview(context, items = prepare(context), options = {}) {
    const profile = resolveEmbedding(options);
    const policy = readPolicy(context);
    const eligible = items.filter(item => embeddingEligible(item, policy));
    // UTF-8 byte count is a conservative token bound, not a tokenizer measurement.
    const tokenUpperBound = eligible.reduce((sum, item) => sum + Buffer.byteLength(item.heading + '\n' + item.text, 'utf8'), 0);
    const snapshot = digest(JSON.stringify(items.map(item => [item.id, item.hash, item.heading])) + JSON.stringify(policy) + VERSION + profile.identity + profile.model + profile.dimensions);
    return { snapshot, chunks: items.length, eligibleChunks: eligible.length, localOnlyChunks: items.length - eligible.length,
        oversizedChunks: items.filter(item => allowed(item, policy) && !embeddingEligible(item, policy)).length,
        directories: [...new Set(items.map(item => path.posix.dirname(item.path)))], provider: profile.provider, model: profile.model, dimensions: profile.dimensions,
        tokenUpperBound, estimatedMaximumUsd: profile.type === 'openai' && profile.model === 'text-embedding-3-small' ? tokenUpperBound * 0.02 / 1000000 : null, priceDate: profile.type === 'openai' ? '2026-11-13' : null,
        policyFile: policyPath(context), queryEnabled: policy.allowQuery };
}

async function build(context, options = {}) {
    const profile = resolveEmbedding(options);
    options = { ...options, embedding: profile };
    const items = prepare(context);
    const plan = preview(context, items, options);
    const policy = readPolicy(context);
    assertCachePath(context.capabilityRoot);
    const file = databasePath(context, profile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(file), '.gitignore'), '*\n');
    const lock = file + '.lock';
    let handle;
    try { handle = fs.openSync(lock, 'wx'); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Dead owners can be recovered. Live/unknown owners remain authoritative.
        let owner;
        try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { throw new Error('knowledge-build-busy'); }
        if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('knowledge-build-busy');
        try { process.kill(owner.pid, 0); throw new Error('knowledge-build-busy'); }
        catch (probe) { if (probe.code !== 'ESRCH') throw new Error('knowledge-build-busy'); }
        // Atomic rename claims recovery so another recovery attempt cannot remove a new lock.
        const recovery = lock + '.recovery';
        let recoveryHandle;
        try { recoveryHandle = fs.openSync(recovery, 'wx'); } catch { throw new Error('knowledge-build-busy'); }
        try {
            const latest = JSON.parse(fs.readFileSync(lock, 'utf8'));
            if (latest.pid !== owner.pid || latest.created !== owner.created) throw new Error('knowledge-build-busy');
            fs.unlinkSync(lock);
            handle = fs.openSync(lock, 'wx');
        } finally { fs.closeSync(recoveryHandle); fs.unlinkSync(recovery); }
    }
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, created: new Date().toISOString() }));
    let database;
    let tokens = 0;
    const warnings = [];
    try {
        database = openDatabase(file);
        const policyHash = digest(JSON.stringify(policy));
        const approved = database.prepare('SELECT value FROM state WHERE key=?').get('approved-policy-' + digest(context.contextRoot));
        if (plan.eligibleChunks && options.approve !== plan.snapshot && approved?.value !== policyHash) {
            throw new Error('Review preview and pass --approve <snapshot>');
        }
        const insert = database.prepare('INSERT OR REPLACE INTO chunks VALUES (?,?,?,?)');
        for (let offset = 0; offset < items.length; offset += 32) {
            database.exec('BEGIN IMMEDIATE');
            try {
                for (const item of items.slice(offset, offset + 32)) insert.run(plan.snapshot, item.id, JSON.stringify(item), JSON.stringify(terms((item.sourcePath || '') + '\n' + item.heading + '\n' + item.text)));
                database.exec('COMMIT');
            } catch (error) { database.exec('ROLLBACK'); throw error; }
        }
        const count = database.prepare('SELECT COUNT(*) AS count FROM chunks WHERE generation=?').get(plan.snapshot).count;
        if (count !== items.length) throw new Error('knowledge-readback-failed');
        const eligible = [...new Map(items.filter(item => embeddingEligible(item, policy)).map(item => [vectorKey(item, profile), item])).values()];
        const pending = eligible.filter(item => !database.prepare('SELECT key FROM vectors WHERE key=?').get(vectorKey(item, profile)));
        for (let offset = 0; offset < pending.length && offset / 16 < (options.maxBatches ?? Infinity); offset += 16) {
            const batch = pending.slice(offset, offset + 16);
            try {
                const result = await embed(batch.map(item => item.heading + '\n' + item.text), options);
                database.exec('BEGIN IMMEDIATE');
                try {
                    for (let index = 0; index < batch.length; index++) database.prepare('INSERT OR REPLACE INTO vectors VALUES (?,?,?)')
                        .run(vectorKey(batch[index], profile), JSON.stringify(result.vectors[index]), profile.dimensions);
                    database.prepare('INSERT INTO usage(tokens,created) VALUES (?,?)').run(result.tokens, new Date().toISOString());
                    database.exec('COMMIT');
                } catch (error) { database.exec('ROLLBACK'); throw error; }
                for (const item of batch) {
                    const saved = database.prepare('SELECT data FROM vectors WHERE key=?').get(vectorKey(item, profile));
                    if (!validVector(JSON.parse(saved.data), profile)) throw new Error('embedding-readback-failed');
                }
                tokens += result.tokens;
                options.onProgress?.({ saved: Math.min(offset + 16, pending.length), pending: pending.length, embeddingTokens: tokens });
            } catch (error) { warnings.push(safeFailure(error)); break; }
        }
        const remainingVectors = eligible.filter(item => !database.prepare('SELECT key FROM vectors WHERE key=?').get(vectorKey(item, profile))).length;
        const complete = remainingVectors === 0 && warnings.length === 0;
        database.exec('BEGIN IMMEDIATE');
        if (complete) {
            database.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run('generation', plan.snapshot);
            database.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run('terms-version', TERMS_VERSION);
            const currentKeys = new Set(items.map(item => vectorKey(item, profile)));
            for (const row of database.prepare('SELECT key FROM vectors').all()) {
                if (!currentKeys.has(row.key)) database.prepare('DELETE FROM vectors WHERE key=?').run(row.key);
            }
            database.prepare('DELETE FROM chunks WHERE generation<>?').run(plan.snapshot);
        }
        database.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run('approved-policy-' + digest(context.contextRoot), policyHash);
        database.exec('COMMIT');
        return { ...plan, indexed: count, complete, remainingVectors, embeddingTokens: tokens, warnings };
    } finally {
        database?.close();
        fs.closeSync(handle);
        fs.unlinkSync(lock);
    }
}

function safeFailure(error) {
    // Transport errors can contain request details. Return only known categories.
    const transportCode = error.cause?.code;
    if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(transportCode)) {
        return 'embedding-transport-' + transportCode.toLowerCase().replaceAll('_', '-');
    }
    return /^embedding-[a-z0-9-]+$/.test(error.message) ? error.message : 'embedding-unavailable';
}
function cosine(left, right) {
    let dot = 0, a = 0, b = 0;
    for (let index = 0; index < left.length; index++) { dot += left[index] * right[index]; a += left[index] ** 2; b += right[index] ** 2; }
    return dot / Math.sqrt(a * b);
}

async function search(context, query, options = {}) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('A nonempty query is required');
    const limit = options.limit ?? 6;
    const maxChars = options.maxChars ?? 12000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxChars) || maxChars < 1000) throw new Error('Invalid result budget');
    if (options.theme && !['pure', 'ihos', 'common'].includes(options.theme)) throw new Error('Invalid theme');
    let items = prepare(context, options.domain || 'all');
    items.push(...(options.projectDocuments || []).flatMap(chunks));
    const hasSources = items.length > 0;
    if (options.theme) items = items.filter(item => item.themes.includes(options.theme) || item.themes.includes('common'));
    const policy = readPolicy(context);
    let profile;
    let configurationError;
    try { profile = resolveEmbedding({ ...options, provider: options.provider || policy.defaultProvider }); }
    catch (error) { configurationError = safeFailure(error); }
    const cachedTerms = profile ? readCachedTerms(context, items, profile) : new Map();
    const lexical = lexicalSearch(items, query, cachedTerms).slice(0, 30);
    let semantic = [];
    let embeddingTokens = 0;
    const warnings = [];
    if (configurationError) warnings.push(configurationError);
    if (!hasSources) warnings.push('knowledge-sources-not-installed');
    const vectorSources = new Set();
    if (profile && options.queryPublic && policy.allowQuery && !options.sourceId && !options.localOnly) {
        let database;
        let bundle;
        try {
            assertCachePath(context.capabilityRoot);
            const { DatabaseSync } = require('node:sqlite');
            if (fs.existsSync(databasePath(context, profile))) {
                try {
                    database = new DatabaseSync(databasePath(context, profile), {readOnly:true});
                    database.prepare('SELECT key FROM vectors LIMIT 1').get();
                } catch { database?.close(); database = null; warnings.push('embedding-local-index-unavailable'); }
            }
            try { bundle = openBundle(context, profile); }
            catch { warnings.push('embedding-bundle-unavailable'); }
            if (!database && !bundle) throw new Error('embedding-index-missing');
            const candidates = items.filter(item => item.scope === 'shared').flatMap(item => {
                const key = vectorKey(item, profile);
                const localRow = database && embeddingEligible(item,policy) ? database.prepare('SELECT data FROM vectors WHERE key=?').get(key) : null;
                const bundleRow = bundle?.prepare('SELECT data FROM vectors WHERE key=?').get(key);
                const vector = decodeVector(localRow || bundleRow, profile);
                if (validVector(vector, profile)) vectorSources.add(localRow ? 'local' : 'bundle');
                return validVector(vector, profile) ? [{ item, vector }] : [];
            });
            if (candidates.length) {
                const result = await embed([query], { ...options, embedding: profile });
                embeddingTokens = result.tokens;
                semantic = candidates.map(row => ({ item: row.item, score: cosine(result.vectors[0], row.vector) }))
                    .sort((a, b) => b.score - a.score).slice(0, 30);
            } else warnings.push('embedding-index-empty');
        } catch (error) { warnings.push(safeFailure(error)); }
        finally { database?.close(); bundle?.close(); }
    }
    const merged = new Map();
    for (const ranking of [lexical, semantic]) ranking.forEach((row, index) => {
        const previous = merged.get(row.item.id) || { item: row.item, score: 0 };
        previous.score += 1 / (60 + index + 1);
        merged.set(row.item.id, previous);
    });
    const identifiers = query.match(/[A-Za-z_$][\w$]*(?:[.:-][\w$-]+)+/g) || [];
    const exact = item => identifiers.some(identifier => (item.heading + '\n' + item.text).includes(identifier)) ? 1 : 0;
    // Preserve the two strongest lexical witnesses when semantic overview chunks dominate RRF.
    const lexicalAnchors = new Set(lexical.slice(0, 2).map(row => row.item.id));
    const anchorPriority = item => semantic.length && lexicalAnchors.has(item.id) ? 1 : 0;
    const projectPriority = item => item.scope === 'project' ? 1 : 0;
    const rows = [...merged.values()].sort((a, b) => projectPriority(b.item) - projectPriority(a.item) ||
        exact(b.item) - exact(a.item) || anchorPriority(b.item) - anchorPriority(a.item) ||
        b.score - a.score || a.item.id.localeCompare(b.item.id));
    const result = { schema: 'knowledge-results/v1', mode: semantic.length ? 'hybrid' : 'lexical', matches: [],
        limit, maxChars, truncated: false, provider: profile?.provider || null, model: profile?.model || null, embeddingTokens, vectorSources: [...vectorSources], warnings };
    const seen = new Set();
    for (const row of rows) {
        const key = row.item.scope + '\0' + row.item.path + '\0' + row.item.text;
        if (seen.has(key)) continue;
        seen.add(key);
        if (result.matches.length >= limit) { result.truncated = true; break; }
        result.matches.push(row.item);
        if (JSON.stringify(result).length > maxChars) { result.matches.pop(); result.truncated = true; }
    }
    return result;
}

module.exports = { terms, lexicalSearch, readPolicy, allowed, prepare, preview, build, search, embed, databasePath, policyPath, bundlePath, exportBundle };
