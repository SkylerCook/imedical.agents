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
        // Validate supplied local source text before changing the encoding contract.
        // Byte-compatible server candidates alone cannot describe a proposed transcode.
        for (const file of options.files) {
            const bytes = fs.readFileSync(path.resolve(context.workspaceRoot,file));
            encoding.encode(encoding.decode(bytes,options.source,file),options.target,file);
        }
        const fields={'前端源码编码':encoding.normalize(options.source),'前端服务器编码':encoding.normalize(options.target)};
        require('../../../../scripts/lib/project-plugin-settings').apply(context,'coding-iris-plugin','Write',{
            sourceEncoding:fields['前端源码编码'], serverEncoding:fields['前端服务器编码'],
            serverEncodingConfirmation:'confirmed', serverEncodingTarget:encoding.targetIdentity(context)
        });
        console.log(JSON.stringify({status:'confirmed',sourceEncoding:fields['前端源码编码'],serverEncoding:fields['前端服务器编码'],
            validatedFiles:options.files, ...(options.files.length ? {} : {guidance:'Use confirm --files <local-source-files...> to validate target representability before upload; GB18030-only content may not fit GBK.'})}));
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
