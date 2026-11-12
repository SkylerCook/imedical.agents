#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const encoding = require('./frontend-encoding');
const {resolveWorkspaceContext, workspaceContextBlockers} = require('../../../../scripts/lib/workspace-context');

async function main(argv) {
    const command = argv.shift();
    if (!command || command === '--help') {
        console.log('frontend-encoding-cli.js probe --project-root <root> --files <workspace-relative-frontend-files...>\nfrontend-encoding-cli.js confirm --project-root <root> --source <encoding> --target <encoding> --confirm\nconfirm records an already obtained developer decision once for this target.');
        console.log('frontend-encoding-cli.js check --project-root <root> --files <files...>\nfrontend-encoding-cli.js inspect --files <raw-files...>\nfrontend-encoding-cli.js convert --file <source> --source utf8|gbk|gb2312|gb18030 --target <encoding> --output <new-file>\ncheck requires confirmed server configuration before editing; inspect only reports byte-compatible candidates. convert never overwrites a file.');
        return;
    }
    const options = {files: [], projectRoot: process.cwd()};
    const names = {'--project-root':'projectRoot','--file':'file','--source':'source','--target':'target','--output':'output'};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--confirm') options.confirm = true;
        else if (argv[i] === '--files') { while (argv[i+1] && !argv[i+1].startsWith('--')) options.files.push(argv[++i]); }
        else if (names[argv[i]] && argv[i+1] && !argv[i+1].startsWith('--')) options[names[argv[i]]] = argv[++i];
        else throw new Error('unsupported-encoding-option');
    }
    if (command === 'probe') {
        if (!options.files.length) throw new Error('encoding-files-required');
        const context = resolveWorkspaceContext(options.projectRoot);
        if (workspaceContextBlockers(context).length) throw new Error('invalid-workspace-context');
        require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(context);
        const sync = require('./source-sync-core');
        const files = options.files.map(file=>sync.classifyFrontend(context,{
            path:path.relative(context.workspaceRoot,path.resolve(context.workspaceRoot,file)).split(path.sep).join('/'),
            sourcePath:require('../../../../scripts/lib/workspace-context').resolveSourceFilePath(context,file)
        }));
        if (files.some(file=>file.kind!=='frontend')) throw new Error('frontend-files-required');
        const {config,mcp} = sync.projectConfiguration(context);
        const client = require('../../../../scripts/lib/atelier-client').createAtelierClient({context,connection:require('./compile-csp').connection(config,mcp)});
        const results=[];
        try {
            for (const file of files) {
                const value=await client.readDocument(file.document,{binary:true});
                results.push(value===null ? {file:file.path,status:'missing'} : value.enc ?
                    {file:file.path,status:'observed',representation:'atelier-binary',...encoding.inspect(value.bytes)} :
                    {file:file.path,status:'raw-read-unavailable',representation:'atelier-text',confirmed:false});
            }
            console.log(JSON.stringify({targetSha256:encoding.targetIdentity(context),files:results,confirmed:false}));
        } finally { await client.close(); }
        return;
    }
    if (command === 'confirm') {
        if (!options.confirm || !options.source || !options.target) throw new Error('developer-encoding-confirmation-required');
        const context = resolveWorkspaceContext(options.projectRoot);
        if (workspaceContextBlockers(context).length) throw new Error('invalid-workspace-context');
        const filename = path.join(context.contextRoot,'config','iris_project_profile.md');
        const original = fs.readFileSync(filename,'utf8');
        const crlfCount = (original.match(/\r\n/g) || []).length;
        const lfCount = (original.match(/(?<!\r)\n/g) || []).length;
        const newline = lfCount > crlfCount ? '\n' : '\r\n';
        const bom = original.startsWith('\ufeff') ? '\ufeff' : '';
        let text = original.replace(/^\ufeff/, '').replace(/\r\n|\r/g, '\n');
        const fields = {'前端源码编码':encoding.normalize(options.source),'前端服务器编码':encoding.normalize(options.target),
            '前端服务器编码确认':'confirmed','前端服务器编码确认环境':encoding.targetIdentity(context)};
        for (const [name,value] of Object.entries(fields)) {
            const pattern = new RegExp('^[ \\t]*-[ \\t]*'+name+'[ \\t]*[：:][^\\r\\n]*','m');
            text = pattern.test(text) ? text.replace(pattern,'- '+name+'：'+value) : text.trimEnd()+'\n- '+name+'：'+value+'\n';
        }
        text = bom + text.replace(/\n/g, newline);
        if (fs.readFileSync(filename,'utf8') !== original) throw new Error('frontend-profile-concurrent-change');
        const temporary = filename+'.'+require('node:crypto').randomUUID()+'.tmp';
        try { fs.writeFileSync(temporary,text,{flag:'wx'}); fs.renameSync(temporary,filename); }
        finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        console.log(JSON.stringify({status:'confirmed',sourceEncoding:fields['前端源码编码'],serverEncoding:fields['前端服务器编码']}));
        return;
    }
    if (command === 'convert') {
        if (!options.file || !options.output || !options.source || !options.target) throw new Error('encoding-conversion-options-required');
        const source = fs.readFileSync(options.file);
        const bytes = encoding.encode(encoding.decode(source, options.source, options.file), options.target, options.file);
        fs.writeFileSync(options.output, bytes, {flag:'wx'});
        console.log(JSON.stringify({source:options.file,output:options.output,sourceEncoding:options.source,serverEncoding:options.target,sha256:encoding.digest(bytes)}));
        return;
    }
    if (!['check','inspect'].includes(command) || !options.files.length) throw new Error('encoding-files-required');
    const context = command === 'check' ? resolveWorkspaceContext(options.projectRoot) : null;
    if (context && workspaceContextBlockers(context).length) throw new Error('invalid-workspace-context');
    const results = options.files.map(file => {
        const filename = path.resolve(options.projectRoot,file);
        if (!context) return {file,...encoding.inspect(fs.readFileSync(filename))};
        const policy = encoding.resolve(context,filename);
        if (fs.existsSync(filename)) encoding.decode(fs.readFileSync(filename),policy.sourceEncoding,file);
        return {file,status:'ready-to-edit',...policy};
    });
    console.log(JSON.stringify(results));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({status:'blocked',reason:error.code||error.message,details:error.details||{}})); process.exitCode=1;
});
module.exports = {main};
