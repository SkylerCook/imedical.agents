'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const core=require('../xml-export-core');
const parser=require('../xml-package-core');
const fixtures=[];
test.after(()=>{for(const directory of fixtures){const base=path.join(os.tmpdir(),'Codex');const resolved=path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(base)+path.sep));assert.equal(fs.lstatSync(resolved).isSymbolicLink(),false);fs.rmSync(resolved,{recursive:true});assert.equal(fs.existsSync(resolved),false);}});
const classXml='<Class name="Demo.A"><Description><![CDATA[with <!DOCTYPE html> in code]]></Description></Class>';
const cspXml='<CSPBase64 application="/web/" name="img/a.png">AAECA//+</CSPBase64>';
const mixed=Buffer.from('<?xml version="1.0"?><Export generator="IRIS" version="26">'+classXml+cspXml+'</Export>');
function fixture(options={}){
    const directory=path.join(os.tmpdir(),'Codex','xml-export-'+crypto.randomUUID());fs.mkdirSync(directory,{recursive:true});fixtures.push(directory);
    const context={workspaceRoot:directory,contextRoot:path.join(directory,'.agents'),capabilityRoot:path.join(directory,'.agents'),gitRoots:[]};
    const result=core.createPlan({projectRoot:directory,namespace:'TEST',serverRoot:'/private/exports',channel:'class',webApplication:'/web',
        items:[{name:'Demo.A',type:'CLS'},{name:'web/img/a.png',type:'CSP'}],...options},{context,skipPrivacyCheck:true});
    const state={exportCalls:0,readCalls:0,cleanupCalls:0,files:new Map(),options};
    const transport={async call(operation,extra={}){
        const plan=core.load(result.planPath);
        const reply={schema:'iris-xml-remote/v1',code:0,namespace:'TEST',operation,runId:plan.runId,scopeHash:plan.scopeHash,
            webApplication:plan.webApplication,...(plan.webApplication?{webMappingVerified:1}:{})};
        if(operation==='info')return {...reply,protocol:core.PROTOCOL};
        if(operation==='export'){
            state.exportCalls++;
            if(plan.merge)state.files.set(0,mixed);
            else{state.files.set(0,Buffer.from('<Export>'+classXml+'</Export>'));state.files.set(1,Buffer.from('<Export>'+cspXml+'</Export>'));}
            if(state.loseExportResponse){state.loseExportResponse=false;throw Error('xml-response-lost');}
        }
        if(operation==='export'||operation==='inspect')return {...reply,files:[...state.files].map(([id,bytes])=>({id,name:`package-${id}.xml`,present:true,bytes:bytes.length,sha256:core.hash(bytes)}))};
        if(operation==='read'){
            state.readCalls++;
            if(state.failRead===state.readCalls)throw Error('xml-read-interrupted');
            const data=state.files.get(extra.fileId),bytes=data.subarray(extra.offset,extra.offset+extra.length);
            assert.ok(extra.offset>=0 && extra.offset<data.length,'no zero-byte read at or past EOF');
            const value={...reply,fileId:extra.fileId,offset:extra.offset,total:data.length,bytes:bytes.length,base64:bytes.toString('base64'),sha256:core.hash(bytes),eof:extra.offset+bytes.length===data.length};
            return state.badChunk?{...value,offset:value.offset+1}:value;
        }
        if(operation==='cleanup'){
            state.cleanupCalls++;
            if(state.cleanupFail){state.cleanupFail=false;throw Error('xml-cleanup-interrupted');}
            state.files.clear();return {...reply,cleanupVerified:1};
        }
        throw Error('unexpected-operation');
    },async close(){return {cleanupVerified:true,licenseReleaseVerified:false};}};
    return {...result,context,state,transport,deps:{context,transport}};
}
test('help is independent of project configuration and server availability',()=>{
    const result=spawnSync(process.execPath,[path.resolve(__dirname,'../xml-export.js'),'export','--help','--plan','not-present'],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0);assert.match(result.stdout,/no QTZ dependency/);assert.equal(result.stderr,'');
});
test('offline plan freezes typed items and rejects ambiguous or unsafe scope',()=>{
    const f=fixture();const plan=core.load(f.planPath);
    assert.equal(plan.state,'planned');assert.equal(plan.items[0].document,'Demo.A.cls');assert.equal(f.state.exportCalls,0);
    assert.throws(()=>fixture({items:[{name:'Demo.*',type:'CLS'}]}),/unsafe-document/);
    assert.throws(()=>fixture({items:[{name:'Demo.A',type:'CLS'},{name:'demo.a',type:'CLS'}]}),/duplicate/);
    assert.throws(()=>fixture({serverRoot:'relative'}),/server-root/);
    assert.throws(()=>fixture({items:[{name:'other/a.js',type:'CSP'}]}),/web-application/);
});
test('flat conflicts are blocked before exporting; tree retains safe source hierarchy',()=>{
    const items=core.normalizeItems([{name:'web/a/same.js',type:'CSP'},{name:'web/b/same.js',type:'CSP'}]);
    assert.throws(()=>core.outputNames(items,{split:true,layout:'flat',webApplication:'/web'}),/name-conflict/);
    assert.deepEqual(core.outputNames(items,{split:true,layout:'tree',webApplication:'/web'}),['web/a/same.js.xml','web/b/same.js.xml']);
    assert.throws(()=>core.outputNames(items,{layout:'flat',name:'../bad'}),/name-invalid/);
});
for(const channel of ['class','execute'])test(`${channel}: complete stream-only package lifecycle preserves binary bytes`,async()=>{
    const f=fixture({channel});
    await core.preflight(f.planPath,f.deps);await core.exportPlan(f.planPath,{confirmExport:true},f.deps);
    await core.download(f.planPath,{...f.deps,chunkSize:11});core.verify(f.planPath);
    const plan=core.load(f.planPath);assert.equal(plan.state,'verified');
    assert.deepEqual(parser.parseExportXml(fs.readFileSync(path.join(plan.output,'export.xml'))).items[1].payloadBytes,Buffer.from([0,1,2,3,255,254]));
    await core.cleanup(f.planPath,{},f.deps);assert.equal(core.status(f.planPath).state,'cleaned');assert.equal(f.state.exportCalls,1);
    assert.equal(core.status(f.planPath).cleanupVerified,true);assert.ok(f.state.readCalls>1);
});
test('lost Export response is inspected without replay; unknown task retains its token',async()=>{
    const f=fixture();f.state.loseExportResponse=true;const token=core.load(f.planPath).token;
    await assert.rejects(core.exportPlan(f.planPath,{confirmExport:true},f.deps),/response-lost/);
    assert.equal(core.status(f.planPath).state,'export-outcome-unknown');assert.equal(core.load(f.planPath).token,token);
    await assert.rejects(core.exportPlan(f.planPath,{confirmExport:true},f.deps),/inspect-first/);
    await core.inspect(f.planPath,f.deps);await core.download(f.planPath,f.deps);core.verify(f.planPath);
    assert.equal(f.state.exportCalls,1);
});
test('interrupted download validates saved bytes before a new process resumes',async()=>{
    const f=fixture();await core.exportPlan(f.planPath,{confirmExport:true},f.deps);f.state.failRead=3;
    await assert.rejects(core.download(f.planPath,{...f.deps,chunkSize:9}),/interrupted/);
    const part=path.join(path.dirname(f.planPath),'package-0.xml.download');assert.equal(fs.statSync(part).size,18);
    f.state.failRead=0;await core.download(f.planPath,{...f.deps,chunkSize:9});core.verify(f.planPath);assert.equal(f.state.exportCalls,1);
});
test('saved partial bytes or same-size local artifact changes cannot be silently reused',async()=>{
    const f=fixture();await core.exportPlan(f.planPath,{confirmExport:true},f.deps);f.state.failRead=2;
    await assert.rejects(core.download(f.planPath,{...f.deps,chunkSize:10}),/interrupted/);
    const part=path.join(path.dirname(f.planPath),'package-0.xml.download');fs.writeFileSync(part,Buffer.alloc(10));f.state.failRead=0;
    await assert.rejects(core.download(f.planPath,{...f.deps,chunkSize:10}),/partial-drift/);
});
test('chunk envelope corruption stops before advancing the persisted offset',async()=>{
    const f=fixture();await core.exportPlan(f.planPath,{confirmExport:true},f.deps);f.state.badChunk=true;
    await assert.rejects(core.download(f.planPath,f.deps),/chunk-envelope/);
    assert.equal(fs.statSync(path.join(path.dirname(f.planPath),'package-0.xml.download')).size,0);
});
test('the last byte is an exact EOF chunk; empty EOF and string flags are not accepted',()=>{
    const bytes=Buffer.from([255]), expected={id:0,offset:3,total:4,length:1};
    const reply={fileId:0,offset:3,total:4,bytes:1,base64:bytes.toString('base64'),sha256:core.hash(bytes),eof:1};
    assert.deepEqual(core.decodeChunk(reply,expected),bytes);
    assert.throws(()=>core.decodeChunk({...reply,eof:'false'},expected),/chunk-envelope/);
    assert.throws(()=>core.decodeChunk({...reply,offset:4,bytes:0,base64:'',sha256:core.hash(Buffer.alloc(0))},{id:0,offset:4,total:4,length:1}),/chunk-envelope/);
});
test('a wrong actual namespace or Web mapping cannot pass a successful HTTP envelope',async()=>{
    const f=fixture();const call=f.transport.call;f.transport.call=async(op,extra)=>({...await call(op,extra),namespace:'OTHER'});
    await assert.rejects(core.preflight(f.planPath,f.deps),/identity-mismatch/);assert.equal(f.state.exportCalls,0);
});
test('split package verification finishes all objects before publishing any delivery',async()=>{
    const f=fixture({split:true,layout:'tree'});await core.exportPlan(f.planPath,{confirmExport:true},f.deps);
    f.state.files.set(1,Buffer.from('<Export><Class name="Unexpected"/></Export>'));
    // New observation is not permitted to hide a changed package after registration.
    await assert.rejects(core.download(f.planPath,f.deps),/artifact-changed/);
    assert.equal(fs.existsSync(core.load(f.planPath).output),false);
});
test('scope mismatch in the last split file records exact omissions before any delivery appears',async()=>{
    const f=fixture({split:true,layout:'tree'}),call=f.transport.call;
    f.transport.call=async(op,extra)=>{if(op==='export'){
        await call(op,extra);f.state.files.set(1,Buffer.from('<Export><Class name="Unexpected"/></Export>'));return call('inspect');
    }return call(op,extra);};
    // Keep the operation identity even when the fixture obtains its generated metadata by inspection.
    const changed=f.transport.call;f.transport.call=async(op,extra)=>({...await changed(op,extra),operation:op});
    await core.exportPlan(f.planPath,{confirmExport:true},f.deps);await core.download(f.planPath,f.deps);
    assert.throws(()=>core.verify(f.planPath),/scope-mismatch/);
    const plan=core.load(f.planPath);assert.equal(fs.existsSync(plan.output),false);
    assert.deepEqual(plan.files[1].validation.missing,['CSP:web/img/a.png']);
    assert.deepEqual(plan.files[1].validation.extra,['CLS:Unexpected.cls']);
});
test('cleanup interruptions are retryable and never downgrade unknown to success',async()=>{
    const f=fixture();await core.exportPlan(f.planPath,{confirmExport:true},f.deps);
    await assert.rejects(core.cleanup(f.planPath,{},f.deps),/unverified-package/);
    await core.download(f.planPath,f.deps);core.verify(f.planPath);f.state.cleanupFail=true;
    await assert.rejects(core.cleanup(f.planPath,{},f.deps),/interrupted/);assert.equal(core.status(f.planPath).state,'cleanup-unknown');
    await core.cleanup(f.planPath,{},f.deps);assert.equal(core.status(f.planPath).cleanupVerified,true);
});
test('scope and state tampering fail before any remote access',()=>{
    const f=fixture();const plan=core.load(f.planPath);plan.namespace='OTHER';fs.writeFileSync(f.planPath,JSON.stringify(plan));
    assert.throws(()=>core.status(f.planPath),/integrity/);assert.equal(f.state.exportCalls,0);
});
test('class transport uses the projected SQL procedure and public owner effects, without a fallback',async()=>{
    const f=fixture(),plan=core.load(f.planPath),calls=[];
    const client={async request(method,suffix,body,headers,options){calls.push({method,suffix,body,options});
        const request=JSON.parse(Buffer.from(body.query.match(/\('([A-Za-z0-9+/=]+)'\)/)[1],'base64').toString('utf8'));
        return {result:{content:[{value:JSON.stringify({schema:'iris-xml-remote/v1',code:0,namespace:request.namespace,operation:request.operation})}]}};},
    async close(){return {cleanupVerified:true};}};
    const transport=core.createTransport(plan,f.context,{client,skipQualification:true,configuration:{config:{},mcp:{mcpServers:{'iris-agentic-dev':{env:{IRIS_NAMESPACE:'TEST'}}}}},
        connection:{protocol:'https:',hostname:'example.invalid',port:443}});
    await transport.call('info');await transport.call('export');await transport.close();
    assert.equal(calls[0].suffix,'action/query');assert.equal(calls[0].options.effects,'read-only');assert.equal(calls[1].options.effects,'write');
    assert.match(calls[1].body.query,/DHCDoc_Util\.XmlPackage_Dispatch/);
});
test('execute transport reuses one managed MCP session for all chunks and reports its actual exit',async()=>{
    const f=fixture({channel:'execute',executor:'mcp'}),plan=core.load(f.planPath);let starts=0,calls=0,closed=0;
    const transport=core.createTransport(plan,f.context,{skipQualification:true,
        configuration:{config:{},mcp:{mcpServers:{'iris-agentic-dev':{env:{IRIS_NAMESPACE:'TEST'}}}}},
        connection:{protocol:'https:',hostname:'example.invalid',port:443},
        async sessionFactory(options){starts++;assert.equal(options.expectedNamespace,'TEST');return {
            async call(tool,args,flags){calls++;assert.equal(tool,'iris_execute');assert.equal(flags.allowWrite,true);assert.equal(args.namespace,'TEST');
                assert.doesNotMatch(args.code,/##class\(DHCDoc\.Util\.XmlPackage\)/);return {output:'IRIS_XML_RESULT:{"code":0}\n'};},
            async close(){closed++;return {cleanupVerified:true,processExited:true,licenseReleaseVerified:false};}};}});
    await transport.call('info');await transport.call('read',{fileId:0,offset:0,length:20});await transport.call('read',{fileId:0,offset:20,length:20});
    assert.equal((await transport.close()).processExited,true);assert.equal(starts,1);assert.equal(calls,3);assert.equal(closed,1);
});
test('terminal is the default and opens, executes and closes in one managed MCP process without HTTP execution',async()=>{
    const f=fixture({channel:'execute'}),plan=core.load(f.planPath);assert.equal(plan.executor,'terminal');
    const calls=[],token='ws:mock:TEST:'+crypto.randomUUID();let started=0,closed=0;
    const transport=core.createTransport(plan,f.context,{skipQualification:true,
        configuration:{config:{},mcp:{mcpServers:{'iris-agentic-dev':{env:{IRIS_NAMESPACE:'TEST'}}}}},
        connection:{protocol:'https:',hostname:'example.invalid',port:443},
        async sessionFactory(){started++;return {async call(tool,args,flags){calls.push(tool);assert.equal(flags.allowWrite,true);
            if(tool==='iris_ws_open'){assert.equal(args.namespace,'TEST');return {session:token,namespace:'TEST',server:'mock'};}
            assert.equal(args.session,token);
            if(tool==='iris_ws_exec'){assert.equal(args.code.split('\n').length,3);assert.match(args.code.split('\n')[1],/^xecute /);return {session:token,output:'IRIS_XML_RESULT:{"code":0}\n'};}
            if(tool==='iris_ws_close')return {closed:true};throw Error('unexpected-tool');},
        markUnknown(){assert.fail('successful WS must not become unknown');},async close(){closed++;return {cleanupVerified:true,processExited:true};}};}});
    await transport.call('info');await transport.call('read',{fileId:0,offset:0,length:20});
    assert.equal((await transport.close()).terminalCloseVerified,true);assert.equal((await transport.close()).cleanupVerified,true);
    assert.deepEqual(calls,['iris_ws_open','iris_ws_exec','iris_ws_exec','iris_ws_close']);assert.equal(started,1);assert.equal(closed,1);
    await assert.rejects(transport.call('info'),/transport-closed/);
});
test('a failed WS close marks the public owner unknown even when the MCP process exits',async()=>{
    const f=fixture({channel:'execute'}),plan=core.load(f.planPath),token='ws:mock:TEST:'+crypto.randomUUID(),unknown=[];
    const transport=core.createTransport(plan,f.context,{skipQualification:true,
        configuration:{config:{},mcp:{mcpServers:{'iris-agentic-dev':{env:{IRIS_NAMESPACE:'TEST'}}}}},
        connection:{protocol:'https:',hostname:'example.invalid',port:443},
        async sessionFactory(){return {async call(tool){if(tool==='iris_ws_open')return {session:token,namespace:'TEST'};
            if(tool==='iris_ws_close')return {closed:false};return {session:token,output:'IRIS_XML_RESULT:{"code":0}\n'};},
        markUnknown(reason){unknown.push(reason);},async close(){return {cleanupVerified:true,processExited:true};}};}});
    await transport.call('info');const exit=await transport.close();assert.equal(exit.cleanupVerified,false);assert.equal(exit.licenseReleaseVerified,false);
    assert.deepEqual(unknown,['xml-terminal-close-unverified']);
});
test('HTTP generator retry acceptance is an explicit qualification and never a WS fallback',()=>{
    const f=fixture({channel:'execute',executor:'mcp'}),plan=core.load(f.planPath);fs.writeFileSync(path.join(f.context.workspaceRoot,'qualification.json'),'{}');
    const policy={schema:'iris-remote-policy/v1',enabled:true,poolKey:'xml-test',coordinationRoot:path.join(f.context.workspaceRoot,'coordination'),
        qualification:{status:'verified',reference:'qualification.json',channels:{mcp:{processExitVerified:true}}}};
    const deps={policy,configuration:{config:{},mcp:{mcpServers:{'iris-agentic-dev':{env:{IRIS_NAMESPACE:'TEST'}}}}},
        connection:{protocol:'https:',hostname:'example.invalid',port:443},sessionFactory(){assert.fail('qualification must fail before opening');}};
    assert.throws(()=>core.createTransport(plan,f.context,deps),/internal-retry-qualification/);
    policy.qualification.channels.mcp.acceptInternalRetries=true;assert.equal(typeof core.createTransport(plan,f.context,deps).call,'function');
});
test('blocked public owners are not bypassed by XML inspect or local recovery',async()=>{
    const f=fixture();f.state.loseExportResponse=true;await assert.rejects(core.exportPlan(f.planPath,{confirmExport:true},f.deps),/response-lost/);
    const call=f.transport.call;f.transport.call=async(op,args)=>{if(op==='inspect')throw Object.assign(Error('remote-pool-reconciliation-required'),{code:'remote-pool-reconciliation-required'});return call(op,args);};
    await assert.rejects(core.inspect(f.planPath,f.deps),/remote-pool-reconciliation-required/);
    assert.equal(core.status(f.planPath).state,'export-outcome-unknown');assert.equal(f.state.exportCalls,1);
});
test('new XML channels require verified base qualification before opening a connection',()=>{
    const f=fixture();let requested=false;
    assert.throws(()=>core.createTransport(core.load(f.planPath),f.context,{client:{request(){requested=true;}},
        configuration:{config:{},mcp:{mcpServers:{'iris-agentic-dev':{env:{IRIS_NAMESPACE:'TEST'}}}}},
        connection:{protocol:'https:',hostname:'example.invalid',port:443}}),/base-qualification/);
    assert.equal(requested,false);
});
test('confirmed dead local locks require the exact recovery token; live owners are preserved',async()=>{
    const f=fixture(),lock=path.join(path.dirname(f.planPath),'operation.lock');
    const owned={pid:process.pid,machine:core.hash(os.hostname()),token:crypto.randomUUID()};fs.writeFileSync(lock,JSON.stringify(owned));
    assert.throws(()=>core.recoverLock(f.planPath,{confirmRecovery:true,lockToken:owned.token}),/owner-alive/);
    await assert.rejects(core.preflight(f.planPath,f.deps),/busy-or-unresolved/);
    const exited=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(exited.status,0);
    fs.writeFileSync(lock,JSON.stringify({...owned,pid:exited.pid}));
    assert.equal(core.recoverLock(f.planPath,{confirmRecovery:true,lockToken:owned.token}).localLockRecovered,true);
    assert.equal(fs.existsSync(lock),false);await core.preflight(f.planPath,f.deps);
});
test('known native export failures preserve every outcome and block package delivery',async()=>{
    const f=fixture(),call=f.transport.call;f.transport.call=async(op,extra)=>{
        const reply=await call(op,extra);return ['export','inspect'].includes(op)?{...reply,outcomes:[{id:0,exportOk:0}],exportOutcome:'recorded'}:reply;};
    await assert.rejects(core.exportPlan(f.planPath,{confirmExport:true},f.deps),/native-export-failed/);
    assert.equal(core.status(f.planPath).state,'export-failed');assert.equal(core.status(f.planPath).outcomes[0].exportOk,0);
    await assert.rejects(core.download(f.planPath,f.deps),/needs-inspect/);assert.equal(fs.existsSync(core.load(f.planPath).output),false);
});
