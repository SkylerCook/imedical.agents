'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const io = require('./configuration-file-io');

const columns = ['plugin','status','initSkill','dependsOn','notes'];
const description = 'This file records plugin enablement for the target project. A plugin directory means available only, not enabled.';

function parseTable(text, strict = true) {
    const entries = Object.create(null);
    let fields = columns;
    for (const source of text.replace(/^\uFEFF/,'').split(/\r\n|\r|\n/)) {
        const line = source.trim();
        if (!line || line === '# Plugin Profile' || line === description) continue;
        if (!line.startsWith('|')) {
            if (strict) throw Error('Custom plugin profile prose requires review before migration');
            continue;
        }
        const cells = line.replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
        if (cells.every(cell=>/^:?-+:?$/.test(cell))) continue;
        if (cells[0].toLowerCase() === 'plugin') {
            fields = cells;
            if (fields[1] !== 'status' || fields.some(k=>!k) || new Set(fields).size !== fields.length) throw Error('Ambiguous plugin profile columns');
            continue;
        }
        const id = cells[0].replace(/^`([\w-]+)`$/,'$1').toLowerCase();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || cells.length > fields.length || Object.hasOwn(entries,id)) throw Error('Invalid or duplicate plugin profile row: ' + id);
        const row = Object.fromEntries(cells.slice(1).map((value,i)=>[fields[i+1],value]));
        const status = row.status?.toLowerCase();
        row.status = status === 'initialized' ? 'enabled' : status === 'indexed' ? 'available' : status;
        entries[id] = row;
    }
    return validate(entries);
}
function validate(entries) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw Error('Expected project.jsonc plugins object');
    for (const [id,row] of Object.entries(entries)) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !['available','enabled','disabled'].includes(row?.status)) throw Error('Invalid plugin status for ' + id);
    }
    return entries;
}
function locations(root) {
    const dir = path.join(root,'config');
    const main = path.join(dir,'project.jsonc'), legacy = path.join(dir,'plugin_profile.md');
    for (const item of [root,dir,main,legacy]) {
        const st = fs.lstatSync(item,{throwIfNoEntry:false});
        if (st && (st.isSymbolicLink() || (item === main || item === legacy ? !st.isFile() || st.nlink !== 1 : !st.isDirectory()))) throw Error('Linked or special plugin profile path: ' + item);
    }
    return {dir,main,legacy};
}
function read(root) {
    const {main,legacy} = locations(root);
    const text = fs.existsSync(main) ? io.readText(main) : '{}\n';
    const data = io.parse(text);
    const hasOld = fs.existsSync(legacy);
    if (Object.hasOwn(data,'plugins')) {
        if (hasOld) throw Error('Conflicting plugin states: project.jsonc plugins and plugin_profile.md');
        return {text,entries:validate(data.plugins),canonical:true,exists:true};
    }
    return {text,entries:hasOld ? parseTable(io.readText(legacy),false) : Object.create(null),canonical:false,exists:hasOld};
}
function save(root, updates, aliases = {}) {
    const state = read(root);
    const {dir,main,legacy} = locations(root);
    let changes = [];
    validate(updates);
    const retired = Object.keys(aliases).filter(id=>id!==aliases[id] && Object.hasOwn(state.entries,id) && Object.hasOwn(updates,aliases[id]));
    for (const id of retired) {
        const target = aliases[id];
        if (state.entries[target] && state.entries[target].status !== state.entries[id].status) throw Error('Conflicting plugin aliases: '+id);
        updates[target] = {...state.entries[id],...state.entries[target],...updates[target]};
    }
    if (!state.canonical) {
        if (state.exists) parseTable(io.readText(legacy));
        const entries = {...state.entries};
        for (const id of retired) delete entries[id];
        for (const [id,row] of Object.entries(updates)) entries[id] = {...entries[id],...row};
        changes = [{path:['plugins'],value:entries}];
    } else {
        for (const id of retired) changes.push({path:['plugins',id],value:undefined});
        for (const [id,row] of Object.entries(updates)) {
            if (!Object.hasOwn(state.entries,id)) changes.push({path:['plugins',id],value:row});
            else for (const [key,value] of Object.entries(row)) {
                if (state.entries[id][key] !== value) changes.push({path:['plugins',id,key],value});
            }
        }
    }
    if (!changes.length) return;
    const text = io.edit(state.text,changes);
    validate(io.parse(text).plugins);
    fs.mkdirSync(dir,{recursive:true});
    const tmp = main + '.' + randomUUID() + '.tmp';
    const existed = fs.existsSync(main);
    let installed = false;
    try {
        fs.writeFileSync(tmp,text,{flag:'wx',mode:0o600});
        fs.renameSync(tmp,main);
        installed = true;
        if (io.readText(main) !== text) throw Error('Plugin state readback failed');
        if (!state.canonical && state.exists) fs.unlinkSync(legacy);
    } catch (error) {
        if (installed) {
            if (existed) { fs.writeFileSync(tmp,state.text,{flag:'wx',mode:0o600}); fs.renameSync(tmp,main); }
            else fs.unlinkSync(main);
        }
        throw error;
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function table(entries, all = false) {
    const fields = all ? [...new Set([...columns,...Object.values(entries).flatMap(Object.keys)])] : columns;
    const lines = ['# Plugin Profile','','| '+fields.join(' | ')+' |','|'+fields.map(()=> '---').join('|')+'|'];
    for (const [id,row] of Object.entries(entries)) {
        const values = fields.map(k=>k==='plugin'?id:row[k]??'');
        if (values.some(v=>typeof v !== 'string' || /[|\r\n]/.test(v))) throw Error('Plugin profile cannot be represented in Markdown: '+id);
        lines.push('| '+values.join(' | ')+' |');
    }
    return lines.join('\n')+'\n';
}
function rollback(root) {
    const state = read(root);
    if (!state.canonical) return;
    const {main,legacy} = locations(root);
    const markdown = table(state.entries,true);
    const projected = parseTable(markdown);
    for (const [id,row] of Object.entries(state.entries)) {
        for (const [key,value] of Object.entries(row)) {
            if (projected[id][key] !== value) throw Error('Cannot roll back plugin field '+id+'.'+key);
        }
    }
    const tmp = main+'.'+randomUUID()+'.tmp';
    let created = false;
    try {
        fs.writeFileSync(tmp,io.edit(state.text,[{path:['plugins'],value:undefined}]),{flag:'wx',mode:0o600});
        fs.writeFileSync(legacy,markdown,{flag:'wx',mode:0o600});
        created = true;
        if (io.readText(legacy)!==markdown) throw Error('Rollback readback failed');
        fs.renameSync(tmp,main);
    } catch (error) {
        if (created) fs.unlinkSync(legacy);
        throw error;
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
module.exports = {read,save,parseTable,table,locations,rollback};

if (require.main === module) {
    const [action,root] = process.argv.slice(2);
    try {
        if (!root || !path.isAbsolute(root)) throw Error('Absolute ContextRoot required');
        if (action === 'read') {
            const state = read(root);
            const rows = Object.entries(state.entries).map(([plugin,entry])=>({plugin,...Object.fromEntries(columns.slice(1).map(k=>[k,entry[k]??'']))}));
            process.stdout.write(Buffer.from(JSON.stringify({exists:state.exists,rows}),'utf8').toString('base64'));
        } else if (action === 'save') {
            const text = Buffer.from(fs.readFileSync(0,'utf8').trim(),'base64').toString('utf8');
            const {rows,aliases} = JSON.parse(text);
            save(root,rows,aliases);
        } else throw Error('Unknown profile action');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
