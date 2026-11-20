'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { resolveWorkspaceContext } = require('../../../scripts/lib/workspace-context');
const { directoryIdentity } = require('./overlay-members');

const maxBytes = 128 * 1024;
const maxText = 8192;
const domains = new Set(['project', 'bos', 'knowledge']);
const excluded = new Set([
    'sftp.username', 'irisConnections.useCurrentCredentials', 'bos-demand-query.cuser', 'providers.company.appId'
]);
const unavailable = { status: 'unreadable', tag: null };
const missing = { status: 'missing', tag: null };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stat = file => fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
const tagOf = info => digest([info.dev, info.ino, info.mtimeNs, info.ctimeNs, info.size].map(String));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = value => Object.keys(value).sort().join(',');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const secretAction = value => value === 'replace' || value === 'clear';
const safeText = value => typeof value === 'string' && value.length <= maxText;
const safeScalar = value => value === null || safeText(value) || typeof value === 'boolean' || Number.isFinite(value);
const fieldSource = field => digest(field.source ?? null);

function annotateDraftFields(model) {
    return { ...model, fields: model.fields.map(field => excluded.has(field.id) ? { ...field, draftable: false } : field) };
}

function fail(code) {
    const messages = {
        'invalid-draft': '草稿字段或操作无效。',
        'draft-changed': '草稿已由其他窗口修改，请重新读取。',
        'draft-busy': '另一个窗口正在保存或清理同一草稿，请稍后重试。',
        'stale-observation': '配置已变化，请重新读取后再保存草稿。',
        'draft-unavailable': '本机草稿无法安全保存或清理，请检查草稿状态。'
    };
    throw Object.assign(new Error(messages[code]), { name: 'DraftError', code });
}

function privateDirectory(home, create) {
    if (!path.isAbsolute(home) || /^[\\/]{2}/u.test(home)) throw Error('non-local home');
    let cursor = fs.realpathSync.native(home);
    if (/^[\\/]{2}/u.test(cursor)) throw Error('non-local home');
    const parts = ['.imedical', 'agents-workbench', 'drafts'];
    for (let ancestor = cursor; ; ancestor = path.dirname(ancestor)) {
        if (stat(path.join(ancestor, '.git'))) throw Error('Git directory');
        if (ancestor === path.dirname(ancestor)) break;
    }
    for (const part of parts) {
        cursor = path.join(cursor, part);
        if (!stat(cursor)) {
            if (!create) return null;
            try { fs.mkdirSync(cursor, { mode: 0o700 }); }
            catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        if (!stat(cursor)?.isDirectory() || stat(path.join(cursor, '.git'))) throw Error('unsafe draft directory');
    }
    return cursor;
}

async function withDraftLock(key, edit) {
    const name = `imedical-workbench-draft-${key}`;
    const address = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : process.platform === 'linux' ? `\0${name}` : null;
    if (!address) return edit();
    // Local pipe ownership ends with the process, including an interrupted write.
    const server = net.createServer(socket => socket.destroy());
    try {
        const ready = once(server, 'listening');
        server.listen(address);
        try { await ready; }
        catch (error) { if (error.code === 'EADDRINUSE') fail('draft-busy'); throw error; }
        return edit();
    } finally {
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
}

function getDisk(file) {
    if (!file) return missing;
    const info = stat(file);
    if (!info) return missing;
    if (!info.isFile() || info.nlink !== 1n) return unavailable;
    const tag = tagOf(info);
    if (info.size > BigInt(maxBytes)) return { status: 'unreadable', tag };
    let handle;
    try {
        handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        const current = fs.fstatSync(handle, { bigint: true });
        if (!current.isFile() || current.nlink !== 1n || tagOf(current) !== tag) return unavailable;
        const bytes = Buffer.alloc(Number(current.size) + 1);
        let count = 0;
        while (count < bytes.length) {
            const read = fs.readSync(handle, bytes, count, bytes.length - count, null);
            if (!read) break;
            count += read;
        }
        if (BigInt(count) !== current.size || tagOf(fs.fstatSync(handle, { bigint: true })) !== tag) return unavailable;
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)));
        const valid = object(data) && keys(data) === 'fields,schema,secretActions,source,values' && data.schema === 1 &&
            validHash(data.source) && object(data.fields) && object(data.values) && object(data.secretActions) &&
            Object.keys(data.fields).length === Object.keys(data.values).length &&
            (Object.keys(data.values).length || Object.keys(data.secretActions).length) &&
            Object.entries(data.fields).every(([, field]) => object(field) && keys(field) === 'base,source,type' &&
                safeScalar(field.base) && validHash(field.source) && ['string', 'number', 'boolean'].includes(field.type) &&
                (field.base === null || typeof field.base === field.type)) &&
            Object.keys(data.fields).every(id => Object.hasOwn(data.values, id)) &&
            Object.values(data.values).every(safeText) && Object.values(data.secretActions).every(secretAction);
        return valid ? { status: 'ready', tag, data } : { status: 'unreadable', tag };
    } catch { return { status: 'unreadable', tag }; }
    finally { if (handle !== undefined) fs.closeSync(handle); }
}

function changeFields(model) {
    return new Map(model.fields.filter(field => !field.readOnly && field.draftable !== false && !excluded.has(field.id) &&
        (field.secret || ['string', 'number', 'boolean'].includes(field.type))).map(field => [field.id, field]));
}

function response(disk, source, model) {
    if (disk.status !== 'ready') return { status: disk.status, tag: disk.tag };
    const { data, tag } = disk;
    if (!source || data.source !== source) return { status: 'source-changed', tag };
    if (!model) return { status: 'unreadable', tag };
    const current = changeFields(model);
    const fields = [];
    for (const [id, saved] of Object.entries(data.fields)) {
        const field = current.get(id);
        if (!field || field.secret || field.type !== saved.type || fieldSource(field) !== saved.source)
            return { status: 'source-changed', tag };
        fields.push({ ...field, value: saved.base });
    }
    for (const id of Object.keys(data.secretActions)) {
        const field = current.get(id);
        if (!field?.secret) return { status: 'source-changed', tag };
        const { value, ...safe } = field;
        fields.push(safe);
    }
    return { status: 'ready', tag, draft: { fields, values: data.values, secretActions: data.secretActions } };
}

function draftSource(root, binding, id, sourcePath) {
    const rootDirectory = directoryIdentity(root);
    if (JSON.stringify(rootDirectory) !== binding) throw Error('changed project');
    const declaration = stat(path.join(root, '.agents', 'capability.json'));
    if (declaration && (!declaration.isFile() || declaration.nlink !== 1n)) throw Error('unsafe declaration');
    const context = resolveWorkspaceContext(root);
    if (!['standard', 'workspace-overlay'].includes(context.mode)) throw Error('invalid context');
    const physical = stat(context.contextRoot) ? directoryIdentity(context.contextRoot) : [context.contextRoot, 'missing'];
    const relative = path.relative(rootDirectory[0], physical[0]);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('foreign context');
    const personalSource = id === 'project' ? null : sourcePath(id);
    return digest([binding, physical, context.mode, context.capabilityRoot, personalSource]);
}

function createDraftStore({ root, binding, inspect, sourcePath, home = os.homedir() }) {
    function fileFor(id, create) {
        const directory = privateDirectory(home, create);
        return directory && path.join(directory, `${digest(binding)}-${id}.json`);
    }

    function read(id, file) {
        const disk = getDisk(file);
        if (disk.status !== 'ready') return response(disk);
        let source, model;
        try { source = draftSource(root, binding, id, sourcePath); } catch { /* Report change without exposing paths. */ }
        if (source === disk.data.source) {
            try { model = inspect(id); } catch { /* Original configuration remains independent. */ }
        }
        return response(disk, source, model);
    }

    function assertTag(file, tag) {
        const info = file && stat(file);
        if (info && (!info.isFile() || info.nlink !== 1n)) fail('draft-unavailable');
        if ((info ? tagOf(info) : null) !== tag) fail('draft-changed');
    }

    function save(id, file, request) {
        const disk = getDisk(file);
        if (disk.tag !== request.tag) fail('draft-changed');
        if (disk.status === 'unreadable') return response(disk);
        let source;
        try { source = draftSource(root, binding, id, sourcePath); }
        catch { return { status: 'source-changed', tag: disk.tag }; }
        if (disk.status === 'ready' && source !== disk.data.source) return { status: 'source-changed', tag: disk.tag };
        const model = inspect(id);
        if (request.revision !== model.revision) fail('stale-observation');
        const previous = response(disk, source, model);
        if (previous.status === 'source-changed') return previous;
        const editable = changeFields(model);
        const values = Object.entries(request.values);
        const actions = Object.entries(request.secretActions);
        if (!values.length && !actions.length) fail('invalid-draft');
        const fields = Object.fromEntries(values.map(([key, value]) => {
            const field = editable.get(key);
            if (!field || field.secret || !safeText(value) || !safeScalar(field.value ?? null) ||
                (field.value != null && typeof field.value !== field.type)) fail('invalid-draft');
            return [key, { base: field.value ?? null, source: fieldSource(field), type: field.type }];
        }));
        if (actions.some(([key, action]) => !editable.get(key)?.secret || !secretAction(action))) fail('invalid-draft');
        const data = { schema: 1, source, fields, values: request.values, secretActions: request.secretActions };
        const bytes = Buffer.from(JSON.stringify(data) + '\n', 'utf8');
        if (bytes.length > maxBytes) fail('invalid-draft');
        const target = fileFor(id, true);
        const directory = digest(directoryIdentity(path.dirname(target)));
        const temp = `${target}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
            if (fileFor(id, false) !== target || digest(directoryIdentity(path.dirname(target))) !== directory)
                fail('draft-unavailable');
            if (draftSource(root, binding, id, sourcePath) !== source) fail('draft-changed');
            assertTag(target, request.tag);
            fs.renameSync(temp, target);
        } finally { if (stat(temp)?.isFile()) fs.unlinkSync(temp); }
        return read(id, target);
    }

    async function handle(id, request) {
        const { action, tag } = request;
        const fields = { read: 'action', save: 'action,revision,secretActions,tag,values', clear: 'action,tag' };
        if (!domains.has(id) || typeof action !== 'string' || !Object.hasOwn(fields, action) || keys(request) !== fields[action] ||
            (action !== 'read' && tag !== null && !validHash(tag)) ||
            (action === 'save' && (!validHash(request.revision) || !object(request.values) || !object(request.secretActions)))) fail('invalid-draft');
        try {
            if (action === 'read') return read(id, fileFor(id, false));
            const realHome = fs.realpathSync.native(home);
            const lockKey = digest([process.platform === 'win32' ? realHome.toLowerCase() : realHome, binding, id]);
            return await withDraftLock(lockKey, () => {
                const file = fileFor(id, false);
                if (action === 'save') return save(id, file, request);
                assertTag(file, tag);
                if (tag !== null) fs.unlinkSync(file);
                return missing;
            });
        } catch (error) {
            if (error.name === 'DraftError') throw error;
            if (action === 'read') return unavailable;
            fail('draft-unavailable');
        }
    }

    return { handle };
}

module.exports = { annotateDraftFields, createDraftStore };
