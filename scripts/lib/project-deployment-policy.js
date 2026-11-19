'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const io = require('./configuration-file-io');

function files(root) {
    const directory = path.join(root, 'config');
    const main = path.join(directory, 'project.jsonc');
    const legacy = path.join(directory, 'plugin-deployment.json');
    for (const item of [root, directory, main, legacy]) {
        const st = fs.lstatSync(item,{throwIfNoEntry:false});
        if (st && (st.isSymbolicLink() || (item === main || item === legacy ? !st.isFile() || st.nlink !== 1 : !st.isDirectory()))) throw Error('Linked project configuration: ' + path.basename(item));
    }
    return {directory, main, legacy};
}
function check(value) {
    if (value?.schema !== 'plugin-deployment/v1' || !['full','on-demand'].includes(value.mode) ||
        typeof value.autoInstall !== 'boolean') throw Error('Invalid project deployment policy');
    return value;
}
function read(root) {
    const {main,legacy} = files(root);
    const document = fs.existsSync(main) ? io.readText(main) : '{}\n';
    const data = io.parse(document);
    const hasOld = fs.existsSync(legacy);
    if (Object.hasOwn(data,'deployment') && hasOld) throw Error('Conflicting deployment sources: config/project.jsonc and config/plugin-deployment.json');
    const defaults = {schema:'plugin-deployment/v1',mode:'full',autoInstall:false};
    const value = Object.hasOwn(data,'deployment') ? data.deployment : hasOld ? io.parse(io.readText(legacy)) : defaults;
    return {document,value:check(value),hasOld,configured:Object.hasOwn(data,'deployment')};
}

// Callers hold the capability deployment lock, including across Overlay members.
function save(root, value) {
    const {directory,main,legacy} = files(root);
    const before = read(root);
    check(value);
    const changes = before.configured
        ? Object.entries(value).filter(([key,v]) => !isDeepStrictEqual(v,before.value[key])).map(([key,v]) => ({path:['deployment',key],value:v}))
        : [{path:['deployment'],value}];
    if (!changes.length) return;
    const text = io.edit(before.document, changes);
    const expected = JSON.parse(JSON.stringify(value));
    const matches = text => isDeepStrictEqual(JSON.parse(JSON.stringify(check(io.parse(text).deployment))),expected);
    if (!matches(text)) throw Error('Invalid deployment edit');
    fs.mkdirSync(directory,{recursive:true});
    const staged = main + '.' + crypto.randomUUID() + '.tmp';
    const existed = fs.existsSync(main);
    let installed = false;
    try {
        fs.writeFileSync(staged,text,{flag:'wx',mode:0o600});
        fs.renameSync(staged,main);
        installed = true;
        if (!matches(io.readText(main))) throw Error('Deployment readback failed');
        if (before.hasOld) fs.unlinkSync(legacy);
    } catch (error) {
        if (installed) {
            if (existed) {
                fs.writeFileSync(staged,before.document,{flag:'wx',mode:0o600});
                fs.renameSync(staged,main);
            } else fs.unlinkSync(main);
        }
        throw error;
    } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
}
// Restore the strict JSON representation before returning to a legacy consumer.
function rollback(root) {
    const state = read(root);
    if (!state.configured) return state.value;
    const {main,legacy} = files(root);
    const text = io.edit(state.document,[{path:['deployment'],value:undefined}]);
    const staged = main + '.' + crypto.randomUUID() + '.tmp';
    let created = false;
    try {
        fs.writeFileSync(staged,text,{flag:'wx',mode:0o600});
        fs.writeFileSync(legacy,JSON.stringify(state.value,null,2)+'\n',{flag:'wx',mode:0o600});
        created = true;
        check(JSON.parse(io.readText(legacy)));
        fs.renameSync(staged,main);
    } catch (error) {
        if (created) fs.unlinkSync(legacy);
        throw error;
    } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
    return read(root).value;
}
module.exports = {read,save,rollback};
