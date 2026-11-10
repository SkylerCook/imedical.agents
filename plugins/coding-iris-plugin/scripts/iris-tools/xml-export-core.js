'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const objectscript = require('./xml-package-objectscript');
const SCHEMA = 'iris-xml-export/v1';
const PROTOCOL = 'iris-xml-dispatch/v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function stop(code, details = {}) { throw Object.assign(Error(code), {code, details}); }
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function within(root, file) { const relative = path.relative(root, file); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function noLinks(file) {
    let current = path.parse(path.resolve(file)).root;
    for (const part of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) stop('xml-local-path-linked');
    }
}
function regular(file) { noLinks(file); if (!fs.statSync(file).isFile()) stop('xml-local-file-invalid'); return fs.readFileSync(file); }
function acquireLock(plan) {
    const file=path.join(path.dirname(plan.planPath),'operation.lock'); noLinks(file);
    const recovery=file+'.recovery';if(fs.existsSync(recovery))stop('xml-local-recovery-busy');
    const owner={pid:process.pid,machine:hash(os.hostname()),token:crypto.randomUUID()};
    if(fs.existsSync(file)){
        stop('xml-local-task-busy-or-unresolved');
    }
    try{fs.writeFileSync(file,JSON.stringify(owner),{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')stop('xml-local-task-busy');throw error;}
    if(fs.existsSync(recovery)){fs.unlinkSync(file);stop('xml-local-recovery-busy');}
    return ()=>{const held=JSON.parse(regular(file));if(held.token!==owner.token)stop('xml-local-task-lock-changed');fs.unlinkSync(file);};
}
function recoverLock(file,options={}) {
    if(options.confirmRecovery!==true || !/^[a-f0-9-]{36}$/.test(options.lockToken || ''))stop('xml-local-recovery-confirmation-required');
    const plan=load(file), lock=path.join(path.dirname(plan.planPath),'operation.lock'), guard=lock+'.recovery';
    noLinks(guard);let owned=false;
    try{
        fs.writeFileSync(guard,JSON.stringify({pid:process.pid,token:crypto.randomUUID()}),{flag:'wx',mode:0o600});owned=true;
        const previous=regular(lock),held=JSON.parse(previous);
        if(held.machine!==hash(os.hostname()) || held.token!==options.lockToken || !Number.isInteger(held.pid) || held.pid<1)stop('xml-local-task-lock-changed');
        try{process.kill(held.pid,0);stop('xml-local-owner-alive');}catch(error){if(error.code!=='ESRCH')throw error;}
        if(!regular(lock).equals(previous))stop('xml-local-task-lock-changed');fs.unlinkSync(lock);
        return {...summary(plan),localLockRecovered:true};
    }finally{if(owned)fs.unlinkSync(guard);}
}
function writeJson(file, value) {
    noLinks(file); fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
    const part = file + '.' + crypto.randomUUID() + '.part';
    try { fs.writeFileSync(part, JSON.stringify(value, null, 2) + '\n', {flag:'wx', mode:0o600}); fs.renameSync(part, file); }
    finally { if (fs.existsSync(part)) fs.unlinkSync(part); }
}
function save(plan) { plan.updatedAt = new Date().toISOString(); const {integrity:_, ...state} = plan; plan.integrity = hash(canonical(state)); writeJson(plan.planPath, plan); }
function load(file) {
    const plan = JSON.parse(regular(path.resolve(file)).toString('utf8'));
    const {integrity, ...state} = plan;
    if (plan.schema !== SCHEMA || integrity !== hash(canonical(state)) || path.resolve(file) !== plan.planPath) stop('xml-plan-integrity-invalid');
    return plan;
}
function contextFor(projectRoot) {
    const workspace = require('../../../../scripts/lib/workspace-context');
    const context = workspace.resolveWorkspaceContext(path.resolve(projectRoot || process.cwd()));
    if (workspace.workspaceContextBlockers(context).length) stop('invalid-workspace-context');
    return context;
}
function assertPrivate(context, directory) {
    for (const root of [...new Set([...(context.gitRoots || []), context.capabilityRoot])].filter(Boolean)) {
        if (!within(root, directory)) continue;
        const git = require('./source-sync-core').git;
        const relative = path.relative(root, directory).replace(/\\/g, '/') + '/.privacy-check';
        if (git(root, ['check-ignore', '--no-index', '-q', '--', relative], {optional:true}) === null ||
            git(root, ['ls-files', '--', path.relative(root, directory).replace(/\\/g, '/')], {optional:true})?.length) stop('xml-private-state-must-be-ignored');
    }
}
function normalizeItems(items) {
    if (!Array.isArray(items) || !items.length || items.length > 10000) stop('xml-document-list-invalid');
    const normalize = require('./xml-package-core').normalizeDocument;
    const normalized = items.map(item => {
        if (!item || typeof item !== 'object' || !item.name || !item.type) stop('xml-typed-document-required');
        const value = normalize(item);
        if (/[,*?'\x00-\x1f\x7f]/.test(value.document) || value.document.split('/').some(p => !p || p === '..' || p === '.')) stop('xml-document-invalid');
        return value;
    });
    if (new Set(normalized.map(item => item.identity.toLowerCase())).size !== normalized.length) stop('xml-duplicate-document');
    return normalized;
}
function outputNames(items, {split,layout,webApplication,name}) {
    if(!['flat','tree'].includes(layout))stop('xml-layout-invalid');
    let merged=String(name || 'export.xml');if(!merged.toLowerCase().endsWith('.xml'))merged+='.xml';
    if(/[<>:"/\\|?*\x00-\x1f]/.test(merged) || /[. ]$/.test(merged) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(merged))stop('xml-package-name-invalid');
    const names=split?items.map(item=>{
        if(layout==='flat')return path.posix.basename(item.document)+'.xml';
        if(item.type==='CSP')return 'web/'+item.document.slice(webApplication.length)+'.xml';
        return (item.type==='CLS'?'cls/':'routines/')+item.document+'.xml';
    }):[merged];
    if(names.some(value=>value.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"\\|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part))) || new Set(names.map(value=>value.toLowerCase())).size!==names.length)stop('xml-output-name-conflict');
    return names;
}
function createPlan(options, deps = {}) {
    const context = deps.context || contextFor(options.projectRoot);
    const manifest = options.items ? {items:options.items} : JSON.parse(regular(path.resolve(options.manifest)).toString('utf8').replace(/^\uFEFF/, ''));
    const items = normalizeItems(manifest.items || manifest.documents);
    if (!['class','execute'].includes(options.channel)) stop('xml-explicit-channel-required');
    if (typeof options.namespace !== 'string' || !/^[A-Za-z%][A-Za-z0-9_%.-]*$/.test(options.namespace)) stop('xml-explicit-namespace-required');
    const serverRoot = String(options.serverRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!serverRoot || serverRoot.includes('..') || /[\x00-\x1f\x7f]/.test(serverRoot) || !/^(?:\/[\s\S]+|[A-Za-z]:\/[\s\S]+)/.test(serverRoot)) stop('xml-explicit-server-root-required');
    const format = options.format || 'iris';
    if (!['iris','cache'].includes(format)) stop('xml-format-invalid');
    const webApplication = String(options.webApplication || '').replace(/\/$/, '');
    if (webApplication && (!webApplication.startsWith('/') || webApplication.includes('\\') || webApplication.split('/').slice(1).some(p=>!p||p==='..'||p==='.') || /[%?#\x00-\x20]/.test(webApplication))) stop('xml-web-application-invalid');
    if (items.some(item => item.type === 'CSP' && (!webApplication || !item.document.startsWith(webApplication.slice(1) + '/')))) stop('xml-web-application-required');
    const layout=options.layout || 'flat';
    const names=outputNames(items,{split:!!options.split,layout,webApplication,name:options.name});
    const runId = crypto.randomUUID();
    const directory = path.join(context.contextRoot, 'work', 'iris-xml-export', runId);
    if (!deps.skipPrivacyCheck) assertPrivate(context, directory);
    noLinks(directory);
    const output = path.resolve(options.out || path.join(context.workspaceRoot, 'docs', 'delivery', 'iris-xml', runId));
    noLinks(output);
    if (within(context.capabilityRoot, output)) stop('xml-output-in-capability-root');
    const plan = {schema:SCHEMA, runId, token:crypto.randomBytes(32).toString('hex'), projectRoot:context.workspaceRoot,
        contextRoot:context.contextRoot, capabilityRoot:context.capabilityRoot, planPath:path.join(directory, 'plan.json'), output,
        channel:options.channel, executor:options.executor || (options.channel==='execute'?'terminal':'mcp'), namespace:options.namespace, serverRoot,
        webApplication, format, merge:!options.split, layout, outputNames:names, items, scopeHash:hash(canonical(items)), state:'planned', files:[],
        createdAt:new Date().toISOString(), cleanupVerified:false};
    if (!['mcp','terminal'].includes(plan.executor)) stop('xml-executor-invalid');
    objectscript.encode(requestFor(plan,'export'));
    if(plan.channel==='execute' && plan.executor==='terminal')objectscript.terminalCode(requestFor(plan,'export'));
    save(plan); return summary(plan);
}
function summary(plan) {
    return {schema:SCHEMA, runId:plan.runId, planPath:plan.planPath, state:plan.state, channel:plan.channel,executor:plan.executor,
        internalRetriesPossible:plan.channel==='execute' && plan.executor==='mcp',
        namespace:plan.namespace, total:plan.items.length, output:plan.output, layout:plan.layout, outputNames:plan.outputNames, cleanupVerified:plan.cleanupVerified,
        files:plan.files.map(({id,bytes,sha256,localPath,verified,validation,items}) => ({id,bytes,sha256,localPath,verified,validation,items})),
        ...(plan.outcomes ? {outcomes:plan.outcomes,exportOutcome:plan.exportOutcome} : {}),
        ...(plan.failure ? {failure:plan.failure} : {}), ...(plan.exit ? {exit:plan.exit} : {})};
}
function requestFor(plan, operation, extra = {}) {
    return {operation, namespace:plan.namespace, webApplication:plan.webApplication, runId:plan.runId, token:plan.token,
        root:plan.serverRoot, scopeHash:plan.scopeHash,
        ...(operation==='export'?{documents:plan.items.map(item=>item.document),format:plan.format,merge:plan.merge}:{}), ...extra};
}
function assertReply(plan, operation, reply) {
    if (!reply || reply.schema !== 'iris-xml-remote/v1' || reply.namespace !== plan.namespace || reply.operation !== operation ||
        (plan.webApplication && (reply.webApplication !== plan.webApplication || reply.webMappingVerified !== 1 && reply.webMappingVerified !== true)) ||
        !['info','project'].includes(operation) && (reply.runId !== plan.runId || reply.scopeHash !== plan.scopeHash)) stop('xml-remote-identity-mismatch');
    if (reply.code !== 0) stop(/^[a-z0-9-]+$/.test(reply.reason || '') ? reply.reason : 'xml-remote-operation-failed');
    return reply;
}
function decodeChunk(reply, expected) {
    if (reply.fileId !== expected.id || reply.offset !== expected.offset || reply.total !== expected.total ||
        !Number.isInteger(reply.bytes) || reply.bytes < 1 || reply.bytes > expected.length || reply.offset + reply.bytes > reply.total ||
        ![true,false,0,1].includes(reply.eof) ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(reply.base64 || '')) stop('xml-chunk-envelope-invalid');
    const bytes = Buffer.from(reply.base64, 'base64');
    if (bytes.toString('base64') !== reply.base64 || bytes.length !== reply.bytes || hash(bytes) !== reply.sha256 ||
        Boolean(reply.eof) !== (reply.offset + bytes.length === reply.total)) stop('xml-chunk-digest-invalid');
    return bytes;
}
function remoteFiles(plan, reply) {
    const count = plan.merge ? 1 : plan.items.length;
    if (!Array.isArray(reply.files) || reply.files.length !== count) stop('xml-remote-files-incomplete');
    return reply.files.map((file,index) => {
        if (file.id !== index || file.name !== `package-${index}.xml` || ![true,1].includes(file.present) || !Number.isInteger(file.bytes) || file.bytes < 1 ||
            file.bytes > 128 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256)) stop('xml-remote-file-invalid');
        const prior = plan.files.find(value => value.id === index);
        if (prior && (prior.sha256 !== file.sha256 || prior.bytes !== file.bytes)) stop('xml-remote-artifact-changed');
        return {...file, ...(prior || {}), id:index};
    });
}
function createTransport(plan, context, deps = {}) {
    require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(context);
    const source = require('./source-sync-core');
    const configuration = deps.configuration || source.projectConfiguration(context);
    const connection = deps.connection || require('./compile-csp').connection(configuration.config, configuration.mcp);
    const targetHash = hash(canonical({protocol:connection.protocol,host:connection.hostname,port:connection.port,namespace:plan.namespace}));
    const configurationHash = hash(canonical(configuration));
    const configuredNamespace = configuration.mcp.mcpServers?.[configuration.config.mcp?.serverName || 'iris-agentic-dev']?.env?.IRIS_NAMESPACE;
    if (configuredNamespace !== plan.namespace) stop('xml-configured-namespace-mismatch');
    if (plan.binding && (plan.binding.targetHash !== targetHash || plan.binding.configurationHash !== configurationHash)) stop('xml-configuration-drift');
    if(deps.skipQualification && !deps.client && !deps.sessionFactory && !deps.execute)stop('xml-mock-qualification-skip-invalid');
    const policy=deps.skipQualification?undefined:require('../../../../scripts/lib/iris-remote-operations').loadRemotePolicy(context,{connection,policy:deps.policy});
    if(!deps.skipQualification && policy.enabled!==true)stop('xml-base-qualification-required');
    if(plan.channel==='execute' && plan.executor==='mcp' && !deps.skipQualification && policy.qualification?.channels?.mcp?.acceptInternalRetries!==true)stop('xml-http-internal-retry-qualification-required');
    plan.binding = {targetHash,configurationHash}; save(plan);
    if (plan.channel === 'class') {
        const client = deps.client || require('../../../../scripts/lib/atelier-client').createAtelierClient({connection,context,policy});
        return {async call(operation, extra) {
            const response = await client.request('POST','action/query',{query:objectscript.classQuery(requestFor(plan,operation,extra)),parameters:[]},{},
                {effects:['info','project','inspect','read'].includes(operation)?'read-only':'write'});
            const rows=response?.result?.content;
            if (!Array.isArray(rows) || rows.length!==1 || rows[0].value===undefined) stop('xml-query-response-invalid');
            return typeof rows[0].value==='string'?JSON.parse(rows[0].value):rows[0].value;
        }, close:()=>client.close()};
    }
    if(deps.execute && !deps.closeExecute)stop('xml-controlled-executor-exit-required');
    let session,wsToken,closing,wsAttempted=false,terminalUnknown=false,exit={cleanupVerified:true,processExited:true,licenseReleaseVerified:false};
    return {async call(operation, extra) {
        if(closing)stop('xml-transport-closed');
        const code=(plan.executor==='terminal'?objectscript.terminalCode:objectscript.executeCode)(requestFor(plan,operation,extra));
        if (deps.execute) return objectscript.parseExecuteOutput(await deps.execute({code,namespace:plan.namespace,operation}));
        exit={cleanupVerified:false,processExited:false,licenseReleaseVerified:false};
        if(!session)session=await (deps.sessionFactory || require('../../../../scripts/iris-mcp').createManagedMcpSession)({
            projectRoot:context.workspaceRoot,context,serverName:configuration.config.mcp?.serverName,expectedNamespace:plan.namespace});
        if(plan.executor==='terminal'){
            if(!wsToken){
                wsAttempted=true;
                const opened=await session.call('iris_ws_open',{namespace:plan.namespace},{allowWrite:true});
                if(typeof opened?.session!=='string' || !opened.session.startsWith('ws:') || opened.namespace!==plan.namespace){
                    terminalUnknown=true;session.markUnknown?.('xml-terminal-open-unverified');stop('xml-terminal-open-unverified');}
                wsToken=opened.session;
            }
            const response=await session.call('iris_ws_exec',{session:wsToken,code},{allowWrite:true});
            if(response?.session!==wsToken){terminalUnknown=true;session.markUnknown?.('xml-terminal-session-mismatch');stop('xml-terminal-session-mismatch');}
            try{return objectscript.parseExecuteOutput(response);}
            catch(error){terminalUnknown=true;session.markUnknown?.('xml-terminal-output-unverified');throw error;}
        }
        return objectscript.parseExecuteOutput(await session.call('iris_execute',{code,namespace:plan.namespace},{allowWrite:true}));
    },async close(){
        if(closing)return closing;
        closing=(async()=>{
        if(deps.closeExecute)return deps.closeExecute();
        if(!session)return exit;
        let terminalCloseVerified=!wsAttempted;
        try{
            if(wsToken){const closed=await session.call('iris_ws_close',{session:wsToken},{allowWrite:true});terminalCloseVerified=closed?.closed===true;}
        }catch{terminalCloseVerified=false;}
        if(plan.executor==='terminal' && (!terminalCloseVerified || terminalUnknown))session.markUnknown?.('xml-terminal-close-unverified');
        const closed=await session.close();
        return plan.executor==='terminal'?{...closed,terminalCloseVerified,cleanupVerified:closed.cleanupVerified===true && terminalCloseVerified && !terminalUnknown,licenseReleaseVerified:false}:closed;
        })();return closing;
    }};
}
async function withPlan(file, deps, callback) {
    let plan = load(file);const context = deps.context || contextFor(plan.projectRoot);
    if (context.workspaceRoot!==plan.projectRoot || context.contextRoot!==plan.contextRoot || context.capabilityRoot!==plan.capabilityRoot) stop('xml-workspace-drift');
    const release=acquireLock(plan);plan=load(file);let transport;
    try {
        transport=deps.transport || createTransport(plan,context,deps);
        return await callback(plan, async (operation,extra)=>assertReply(plan,operation,await transport.call(operation,extra)));
    } catch(error) {
        plan.failure=/^[a-z0-9-]+$/.test(error.code || error.message)?(error.code || error.message):'xml-operation-failed-or-unknown';
        if (plan.state==='exporting') plan.state='export-outcome-unknown';
        save(plan); throw error;
    } finally {
        try { if(transport){ plan.exit=await transport.close(); save(plan); if(plan.exit?.cleanupVerified!==true) stop('xml-remote-session-exit-unverified'); } }
        finally { release(); }
    }
}
async function preflight(file,deps={}) {
    return withPlan(file,deps,async(plan,call)=>{const info=await call('info');if(info.protocol!==PROTOCOL)stop('xml-protocol-incompatible');
        plan.preflight={protocol:info.protocol,at:new Date().toISOString()};save(plan);return summary(plan);});
}
async function exportPlan(file, options={}, deps={}) {
    if(options.confirmExport!==true)stop('xml-export-confirmation-required');
    return withPlan(file,deps,async(plan,call)=>{
        if(plan.state!=='planned')stop('xml-export-already-submitted-inspect-first');
        const info=await call('info');if(info.protocol!==PROTOCOL)stop('xml-protocol-incompatible');
        plan.state='exporting';delete plan.failure;save(plan);
        const reply=await call('export');plan.outcomes=reply.outcomes || [];plan.exportOutcome=reply.exportOutcome || 'unknown';
        if(plan.outcomes.some(item=>item.exportOk!==true && item.exportOk!==1)){plan.state='export-failed';save(plan);stop('xml-native-export-failed');}
        plan.files=remoteFiles(plan,reply);plan.state='exported';save(plan);return summary(plan);
    });
}
async function inspect(file,deps={}) {
    return withPlan(file,deps,async(plan,call)=>{if(!['exporting','export-outcome-unknown','export-failed','exported','downloaded','verified','cleanup-unknown'].includes(plan.state))stop('xml-inspect-not-submitted');
        const reply=await call('inspect');plan.outcomes=reply.outcomes || [];plan.exportOutcome=reply.exportOutcome || 'unknown';
        if(plan.outcomes.some(item=>item.exportOk!==true && item.exportOk!==1)){plan.state='export-failed';plan.failure='xml-native-export-failed';save(plan);return summary(plan);}
        plan.files=remoteFiles(plan,reply);if(['exporting','export-outcome-unknown'].includes(plan.state))plan.state='exported';
        delete plan.failure;save(plan);return summary(plan);});
}
async function download(file,deps={}) {
    return withPlan(file,deps,async(plan,call)=>{
        if(!['exported','downloaded','verified'].includes(plan.state))stop('xml-download-needs-inspect');
        plan.files=remoteFiles(plan,await call('inspect'));save(plan);
        const chunkSize=deps.chunkSize || 32768;
        if(!Number.isInteger(chunkSize)||chunkSize<1||chunkSize>32768)stop('xml-chunk-size-invalid');
        for(const file of plan.files){
            const localPath=path.join(path.dirname(plan.planPath),`package-${file.id}.xml`), part=localPath+'.download';
            if(fs.existsSync(localPath)){if(hash(regular(localPath))!==file.sha256)stop('xml-local-artifact-drift');file.localPath=localPath;continue;}
            noLinks(part);let offset=0;
            if(fs.existsSync(part)){
                const bytes=regular(part);offset=bytes.length;
                if(offset>file.bytes)stop('xml-download-size-invalid');
                // Verify persisted bytes against the server before skipping them.
                for(let at=0;at<offset;at+=chunkSize){const length=Math.min(chunkSize,offset-at);
                    const expected={id:file.id,offset:at,total:file.bytes,length};
                    const current=decodeChunk(await call('read',{fileId:file.id,offset:at,length}),expected);
                    if(!current.equals(bytes.subarray(at,at+length)))stop('xml-download-partial-drift');}
            }
            const fd=fs.openSync(part,fs.existsSync(part)?'a':'wx',0o600);
            try{while(offset<file.bytes){const length=Math.min(chunkSize,file.bytes-offset);
                const bytes=decodeChunk(await call('read',{fileId:file.id,offset,length}),{id:file.id,offset,total:file.bytes,length});
                fs.writeSync(fd,bytes);fs.fsyncSync(fd);offset+=bytes.length;}}
            finally{fs.closeSync(fd);}
            if(hash(regular(part))!==file.sha256)stop('xml-package-digest-mismatch');
            fs.renameSync(part,localPath);file.localPath=localPath;save(plan);
        }
        plan.state='downloaded';save(plan);return summary(plan);
    });
}
function verify(file,deps={}) {
    let plan=load(file);
    const release=acquireLock(plan);
    try{
    plan=load(file);
    if(!['downloaded','verified','cleaned','cleanup-unknown'].includes(plan.state))stop('xml-verify-needs-download');
    const validate=deps.validatePackage || require('./xml-package-core').validatePackage;
    const packages=[];
    for(const output of plan.files){
        const bytes=regular(output.localPath);if(hash(bytes)!==output.sha256)stop('xml-local-artifact-drift');
        const expected=plan.merge?plan.items:[plan.items[output.id]];
        let result;
        try{result=validate(bytes,expected);}
        catch(error){output.validation={status:'failed',reason:error.code || 'xml-package-invalid',
            ...(Array.isArray(error.missing)?{missing:error.missing}:{}),...(Array.isArray(error.extra)?{extra:error.extra}:{})};save(plan);throw error;}
        output.items=(result.items || result.package?.items || []).map(({identity,sha256,payloadBytes})=>({identity,sha256,bytes:Buffer.isBuffer(payloadBytes)?payloadBytes.length:undefined}));
        output.validation={status:'verified'};
        const name=plan.outputNames[output.id];
        packages.push({name,bytes,output});
    }
    if(!packages.length)stop('xml-package-incomplete');
    noLinks(plan.output);
    if(fs.existsSync(plan.output)){
        if(!fs.statSync(plan.output).isDirectory())stop('xml-delivery-conflict');
        for(const {name,output} of packages)if(!fs.existsSync(path.join(plan.output,name)) || hash(regular(path.join(plan.output,name)))!==output.sha256)stop('xml-delivery-conflict');
    }else{
        plan.deliveryStage=plan.output+'.'+plan.runId+'.part';save(plan);noLinks(plan.deliveryStage);
        fs.mkdirSync(path.dirname(plan.output),{recursive:true});fs.mkdirSync(plan.deliveryStage,{recursive:true});
        const plannedPaths=new Set(packages.map(item=>path.resolve(plan.deliveryStage,item.name)));
        const walk=directory=>{for(const name of fs.readdirSync(directory)){const candidate=path.join(directory,name);noLinks(candidate);
            if(fs.statSync(candidate).isDirectory())walk(candidate);else if(!plannedPaths.has(candidate))stop('xml-delivery-stage-conflict');}};
        walk(plan.deliveryStage);
        for(const {name,bytes,output} of packages){const destination=path.join(plan.deliveryStage,name);
            noLinks(destination);fs.mkdirSync(path.dirname(destination),{recursive:true});
            if(fs.existsSync(destination)){if(hash(regular(destination))!==output.sha256)stop('xml-delivery-stage-conflict');}
            else fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});}
        noLinks(plan.output);fs.renameSync(plan.deliveryStage,plan.output);delete plan.deliveryStage;
    }
    for(const {name,output} of packages){output.deliveryPath=path.join(plan.output,name);output.verified=true;}
    if(plan.state!=='cleaned')plan.state='verified';delete plan.failure;save(plan);return summary(plan);
    } finally{release();}
}
async function cleanup(file,options={},deps={}) {
    return withPlan(file,deps,async(plan,call)=>{
        if(!['verified','cleaned','cleanup-unknown'].includes(plan.state) && options.confirmDiscard!==true)stop('xml-cleanup-unverified-package');
        if(plan.state==='cleaned')return summary(plan);
        plan.state='cleanup-unknown';save(plan);
        const reply=await call('cleanup');if(reply.cleanupVerified!==true && reply.cleanupVerified!==1)stop('xml-cleanup-unverified');
        plan.state='cleaned';plan.cleanupVerified=true;delete plan.failure;save(plan);return summary(plan);
    });
}
function status(file){const plan=load(file),lock=path.join(path.dirname(plan.planPath),'operation.lock');
    return {...summary(plan),...(fs.existsSync(lock)?{localLock:JSON.parse(regular(lock))}:{})};}
module.exports={SCHEMA,PROTOCOL,hash,canonical,createPlan,load,save,summary,normalizeItems,outputNames,requestFor,assertReply,decodeChunk,
    remoteFiles,createTransport,preflight,exportPlan,inspect,download,verify,cleanup,status,withPlan,recoverLock};
