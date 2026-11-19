'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const io = require('./configuration-file-io');

function inspect(root) {
    const dir = path.join(root,'config');
    const main = path.join(dir,'project.jsonc');
    const legacy = path.join(dir,'iris-development.json');
    for (const file of [root,dir,main,legacy]) {
        const st = fs.lstatSync(file,{throwIfNoEntry:false});
        if (st && (st.isSymbolicLink() || ([main,legacy].includes(file) && (!st.isFile() || st.nlink !== 1)))) throw Error('unsafe-development-config');
    }
    const before = fs.existsSync(main) ? io.readText(main) : null;
    const data = io.parse(before ?? '{}');
    const old = fs.existsSync(legacy) ? io.readText(legacy) : null;
    const canonical = Object.hasOwn(data,'irisDevelopment');
    if (canonical && old !== null) throw Error('conflicting-development-config');
    let value;
    try { value = canonical ? data.irisDevelopment : old === null ? null : JSON.parse(old.replace(/^\uFEFF/,'')); } catch { throw Error('invalid-development-config'); }
    if ((canonical || old !== null) && (!value || typeof value !== 'object' || Array.isArray(value) ||
        (Object.hasOwn(value,'developmentMode') && !['connected','offline'].includes(value.developmentMode)))) throw Error('invalid-development-config');
    return {main,legacy,before,old,value,canonical};
}
function validate(fields) {
    if (Object.keys(fields).some(key => !['developmentMode','environmentAlias','environmentType'].includes(key))) throw Error('unknown-development-field');
    if (Object.hasOwn(fields,'developmentMode') && !['connected','offline'].includes(fields.developmentMode)) throw Error('invalid-development-mode');
    if (Object.hasOwn(fields,'environmentAlias') && (typeof fields.environmentAlias !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fields.environmentAlias))) throw Error('invalid-environment-alias');
    if (Object.hasOwn(fields,'environmentType') && !['test','development','production'].includes(fields.environmentType)) throw Error('invalid-environment-type');
}
function save(context, fields) {
    validate(fields);
    const write = () => {
        const state = inspect(context.contextRoot);
        if (state.old !== null) validate(state.value);
        const value = {...state.value,...fields};
        if (Object.hasOwn(value,'developmentMode') && !['offline','connected'].includes(value.developmentMode)) throw Error('invalid-development-config');
        const edits = state.canonical ? Object.entries(fields).filter(([key,v])=>state.value[key]!==v)
            .map(([key,v])=>({path:['irisDevelopment',key],value:v})) : [{path:['irisDevelopment'],value}];
        if (!edits.length) return;
        const text = io.edit(state.before ?? '{}\n',edits);
        const temp = state.main+'.'+crypto.randomUUID()+'.tmp';
        fs.mkdirSync(path.dirname(state.main),{recursive:true});
        let replaced = false;
        try {
            fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});
            fs.renameSync(temp,state.main);
            replaced = true;
            if (io.readText(state.main)!==text) throw Error('development-config-readback-failed');
            if (state.old!==null) {
                if (io.readText(state.legacy)!==state.old) throw Error('development-config-changed');
                fs.unlinkSync(state.legacy);
            }
        } catch (error) {
            if (replaced && state.before===null) fs.unlinkSync(state.main);
            else if (replaced) { fs.writeFileSync(temp,state.before,{flag:'wx',mode:0o600}); fs.renameSync(temp,state.main); }
            throw error;
        } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    };
    return fs.existsSync(path.join(context.capabilityRoot,'.git')) ? require('./plugin-deployment').withLock(context.capabilityRoot,write) : write();
}
function rollback(root) {
    const state=inspect(root);
    if (!state.canonical) return false;
    const tmp=state.main+'.'+crypto.randomUUID()+'.tmp';
    let created=false;
    try {
        fs.writeFileSync(tmp,io.edit(state.before,[{path:['irisDevelopment'],value:undefined}]),{flag:'wx',mode:0o600});
        fs.writeFileSync(state.legacy,JSON.stringify(state.value,null,2)+'\n',{flag:'wx',mode:0o600});
        created=true;
        if (JSON.stringify(JSON.parse(io.readText(state.legacy)))!==JSON.stringify(state.value)) throw Error('development-config-readback-failed');
        fs.renameSync(tmp,state.main);
        return true;
    } catch (e) {
        if (created) fs.unlinkSync(state.legacy);
        throw e;
    } finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
module.exports = {inspect,save,validate,rollback};
