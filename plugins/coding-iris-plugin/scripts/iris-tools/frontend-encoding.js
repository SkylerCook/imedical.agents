'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const codec = require('../../../../vendor/frontend-encoding');
const supported = ['utf8', 'gb2312', 'gbk', 'gb18030'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(code, details = {}) {
    const error = new Error(code); error.code = code; error.reason = code; error.details = details; throw error;
}
function normalize(value) {
    value = String(value || '').trim().toLowerCase();
    if (value === 'project-utf8') return 'utf8';
    if (value === 'standard-gb2312') return 'gbk';
    if (!supported.includes(value)) fail('frontend-encoding-unsupported', {encoding: value});
    return value;
}
function decode(bytes, encoding, file) {
    if (bytes === null) return null;
    encoding = normalize(encoding);
    let text;
    try { text = codec.decode(bytes, encoding); } catch { fail('frontend-source-encoding-invalid', {file, encoding}); }
    if (text.includes('\uFFFD') || text.includes('\0')) fail('frontend-source-encoding-invalid', {file, encoding});
    return text;
}
function encode(text, encoding, file) {
    encoding = normalize(encoding);
    const bytes = codec.encode(text, encoding);
    if (codec.decode(bytes, encoding) !== text || text.includes('\uFFFD')) {
        const characters = []; let line = 1, column = 1;
        for (const character of text) {
            if (character === '\uFFFD' || codec.decode(codec.encode(character, encoding), encoding) !== character) characters.push({line, column, character, codePoint: 'U+' + character.codePointAt(0).toString(16).toUpperCase()});
            if (character === '\n') { line++; column = 1; } else column++;
        }
        fail('frontend-character-unrepresentable', {file, encoding, characters});
    }
    return bytes;
}
function profile(context) {
    const filename = path.join(context.contextRoot || path.join(context.workspaceRoot, '.agents'), 'config', 'iris_project_profile.md');
    return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
}
function targetIdentity(context) {
    const configRoot = path.join(context.contextRoot || path.join(context.workspaceRoot, '.agents'), 'config');
    const read = filename => fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,'')) : {};
    const project = require('./project-env').readProjectEnv({...context,contextRoot:path.dirname(configRoot)}, {optional:true}).config;
    const mcp = read(path.join(context.workspaceRoot,'.mcp.json'));
    const env = mcp.mcpServers?.[project.mcp?.serverName || 'iris-agentic-dev']?.env || {};
    return digest(JSON.stringify({scheme:env.IRIS_SCHEME||project.iris?.scheme,host:env.IRIS_HOST||project.iris?.host,
        port:Number(env.IRIS_WEB_PORT||project.iris?.port||0),namespace:env.IRIS_NAMESPACE||project.iris?.namespace,
        basePath:project.web?.basePath,cspBasePath:project.web?.cspBasePath,pathPrefix:project.iris?.pathPrefix||env.IRIS_PATH_PREFIX}));
}
function resolve(context, filename, {requireConfirmed = true, projectTask = false} = {}) {
    const text = profile(context);
    const field = name => {
        const pattern = new RegExp('^[ \\t]*-[ \\t]*' + name + '[ \\t]*[：:][ \\t]*`?([^`\\r\\n]+)`?[ \\t]*$', 'gm');
        const values = [...text.matchAll(pattern)].map(match=>match[1].trim().toLowerCase());
        if (new Set(values).size > 1) fail('frontend-encoding-config-conflict',{field:name});
        return values[0];
    };
    const legacy = field('前端编码模式');
    let sourceEncoding = field('前端源码编码') || (legacy?.startsWith('TODO') ? 'utf8' : legacy) || 'utf8';
    let serverEncoding = field('前端服务器编码');
    let confirmed = field('前端服务器编码确认')?.toLowerCase() === 'confirmed';
    const sourceRoot = context.sourceRoots?.filter(root => {
        if (!root.target || !root.path) return false;
        const relative = path.relative(root.target,filename);
        return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..'+path.sep);
    }).sort((a,b)=>b.target.length-a.target.length)[0];
    const logicalFile = sourceRoot ? path.join(sourceRoot.path,path.relative(sourceRoot.target,filename)) : filename;
    const relative = path.relative(context.workspaceRoot, logicalFile).split(path.sep).join('/');
    let legacyScopeLength = -1;
    for(const match of text.matchAll(/^\s*\|\s*`?([^|`]+?)`?\s*\|\s*(utf8|standard-gb2312|project-utf8)\s*\|\s*$/gmi)){
        const scope=match[1].trim().replace(/\\/g,'/');
        if((relative===scope||relative.startsWith(scope+'/')) && scope.length>legacyScopeLength) {
            sourceEncoding=match[2]; legacyScopeLength=scope.length;
        }
    }
    const overrides = [...text.matchAll(/^\s*\|\s*`?([^|`]+?)`?\s*\|\s*([a-z0-9-]+)\s*\|\s*([a-z0-9-]+)\s*\|\s*(confirmed|pending)\s*\|\s*$/gmi)]
        .map(match => ({scope: match[1].trim().replace(/\\/g, '/').replace(/\/$/, ''), source: match[2], server: match[3].toLowerCase(), confirmed: match[4].toLowerCase() === 'confirmed'}))
        .filter(item => relative === item.scope || relative.startsWith(item.scope + '/')).sort((a, b) => b.scope.length - a.scope.length);
    if (overrides.length > 1 && overrides[0].scope === overrides[1].scope && JSON.stringify(overrides[0]) !== JSON.stringify(overrides[1])) fail('frontend-encoding-scope-conflict',{file:relative});
    if (overrides.length) { sourceEncoding = overrides[0].source; serverEncoding = overrides[0].server; confirmed = overrides[0].confirmed; }
    sourceEncoding = normalize(sourceEncoding);
    const contextFile = path.join(context.contextRoot || path.join(context.workspaceRoot, '.agents'), 'config', 'project_context_profile.md');
    const onDemand = fs.existsSync(contextFile) && fs.readFileSync(contextFile, 'utf8').includes('intent-first-on-demand-export');
    const standard = !projectTask && field('默认需求交付类型') === 'standard';
    if ((onDemand || projectTask) && !standard && field('前端服务器编码确认环境') !== targetIdentity(context)) confirmed = false;
    if (standard && sourceEncoding === 'utf8' && (!serverEncoding || serverEncoding === 'pending')) { serverEncoding = 'utf8'; confirmed = true; }
    // Existing standard UTF-8 projects retain their established contract.
    if (!serverEncoding && !onDemand && !projectTask && legacy && sourceEncoding === 'utf8') { serverEncoding = 'utf8'; confirmed = true; }
    if (serverEncoding && serverEncoding !== 'pending') serverEncoding = normalize(serverEncoding);
    else serverEncoding = null;
    if (requireConfirmed && (!confirmed || !serverEncoding)) fail('frontend-server-encoding-confirmation-required', {file: relative, sourceEncoding, serverEncoding});
    return {sourceEncoding, serverEncoding, confirmed, projectTask, configurationSha256: digest(JSON.stringify({sourceEncoding,serverEncoding,confirmed})), targetSha256:targetIdentity(context)};
}
function artifact(bytes, policy, file) {
    if (!policy.confirmed || !policy.serverEncoding) fail('frontend-server-encoding-confirmation-required', {file});
    const text = decode(bytes, policy.sourceEncoding, file);
    return policy.sourceEncoding === policy.serverEncoding ? Buffer.from(bytes) : uploadText(text, policy, file);
}
function uploadText(text, policy, file) {
    if (policy.sourceEncoding === 'utf8' && policy.serverEncoding !== 'utf8') text = text.replace(/^\uFEFF/,'');
    return encode(text,policy.serverEncoding,file);
}
function validateUpload(context, file) {
    try {
        const current = resolve(context,file.localPath,{projectTask:file.encodingPolicy.projectTask});
        if (JSON.stringify(current) !== JSON.stringify(file.encodingPolicy)) fail('frontend-encoding-configuration-changed');
        const expected = decode(uploadText(file.content,current,file.remotePath),current.serverEncoding,file.remotePath);
        if (decode(file.bytes,current.serverEncoding,file.remotePath) !== expected) fail('frontend-upload-encoding-mismatch');
    } catch(error) { error.beforeSend=true; throw error; }
}
function inspect(bytes) {
    const candidates = supported.filter(encoding => { try { decode(bytes, encoding); return true; } catch { return false; } });
    return {ascii: bytes.every(byte => byte < 128), candidates, confirmed: false, sha256: digest(bytes), bytes: bytes.length};
}
function uploadArtifacts(context, planPath) {
    const parent = planPath ? path.dirname(path.resolve(planPath)) : path.join(context.contextRoot || path.join(context.workspaceRoot,'.agents'),'work','iris-deploy');
    const directory = path.join(parent,'upload-'+crypto.randomUUID());
    let created = false;
    return {
        write(file) {
            fs.mkdirSync(directory,{recursive:true}); created=true;
            const filename=path.join(directory,digest(file.remotePath)+path.extname(file.remotePath));
            fs.writeFileSync(filename,file.bytes);
            if (!fs.readFileSync(filename).equals(file.bytes)) fail('frontend-artifact-readback-mismatch');
            return filename;
        },
        finish(result) {
            if (!created) return;
            if (['verified','group-verified'].includes(result.status)) { fs.rmSync(directory,{recursive:true,force:true}); created=false; }
            else result.uploadArtifacts=directory;
        }
    };
}
module.exports = {resolve, profile, targetIdentity, normalize, encode, decode, artifact, uploadText, validateUpload, inspect, digest, uploadArtifacts};
