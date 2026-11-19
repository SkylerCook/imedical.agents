'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const deployment = require('../lib/plugin-deployment');
const cli = require('../plugin-deploy');
const {refresh,selectKnowledgeIndex} = require('../refresh-agents-sparse');
const {generate} = require('../generate-plugin-catalog');

function fixture(t, onDemand = true) {
    const parent = path.join(os.tmpdir(),'Codex');
    fs.mkdirSync(parent,{recursive:true});
    const temporary = fs.mkdtempSync(path.join(parent,'plugin-deployment-'));
    t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
    const origin = path.join(temporary,'origin'), project = path.join(temporary,'project'), root = path.join(project,'.agents');
    fs.mkdirSync(origin,{recursive:true}); fs.mkdirSync(project);
    const repo = path.resolve(__dirname,'../..');
    fs.cpSync(path.join(repo,'vendor/jsonc-parser'),path.join(origin,'vendor/jsonc-parser'),{recursive:true});
    for(const relative of ['scripts/lib/project-plugin-profile.js','scripts/lib/configuration-file-io.js','scripts/lib/project-deployment-policy.js','scripts/plugin-deploy.js','scripts/refresh-agents-sparse.js','scripts/lib/plugin-deployment.js','scripts/lib/workspace-context.js']) {
        fs.mkdirSync(path.dirname(path.join(origin,relative)),{recursive:true});
        fs.copyFileSync(path.join(repo,relative),path.join(origin,relative));
    }
    const definitions = [
        {name:'agent-context-kit'}, {name:'agent-framework-evolution'},
        {name:'feature-ui',dependencies:['feature-core'],runtimeResources:['vendor/ui-runtime'],initSkill:'setup-ui',skillDependencies:{optional:[{capability:'fixture.review',provider:'optional-runtime',name:'review'}]}},
        {name:'feature-core'}, {name:'feature-xc'}
    ];
    for(const item of definitions) {
        const directory = path.join(origin,'plugins',item.name,'.agents-plugin');
        fs.mkdirSync(directory,{recursive:true});
        fs.writeFileSync(path.join(directory,'plugin.json'),JSON.stringify({version:'1.0.0',...item}));
        fs.writeFileSync(path.join(directory,'../AGENTS.md'),item.name);
        if(item.initSkill){fs.mkdirSync(path.join(directory,'../skills',item.initSkill),{recursive:true});fs.writeFileSync(path.join(directory,'../skills',item.initSkill,'SKILL.md'),'# Initialize');}
    }
    fs.mkdirSync(path.join(origin,'vendor/ui-runtime'),{recursive:true});
    fs.writeFileSync(path.join(origin,'vendor/ui-runtime/asset.txt'),'fixture runtime');
    fs.mkdirSync(path.join(origin,'vendor/optional-runtime/skills/review'),{recursive:true});
    fs.writeFileSync(path.join(origin,'vendor/optional-runtime/skills/review/SKILL.md'),'# Optional review');
    fs.writeFileSync(path.join(origin,'scripts/lib/plugin-groups.json'),JSON.stringify({groups:[
        {id:'general',plugins:['agent-context-kit','agent-framework-evolution']},
        {id:'ui',plugins:['feature-ui','feature-core']},{id:'xc',plugins:['feature-xc']}
    ]}));
    fs.writeFileSync(path.join(origin,'scripts/lib/plugin-catalog.json'),JSON.stringify(generate(origin)));
    const git = (where,args) => deployment.git(where,args);
    git(origin,['init','-q']);git(origin,['config','user.name','Fixture']);git(origin,['config','user.email','fixture@example.invalid']);
    git(origin,['config','uploadpack.allowFilter','true']);git(origin,['add','.']);git(origin,['commit','-qm','fixture']);
    git(project,['clone','--filter=blob:none','--no-checkout',pathToFileURL(origin).href,root]);
    if(onDemand)cli.initialize(root,root,false);
    refresh(root,cli.runtimePatterns,true);
    return {root,origin,project,context:cli.resolveContext(project),git};
}
function enabled(root,names){
    require('../lib/project-plugin-profile').rollback(root);
    fs.mkdirSync(path.join(root,'config'),{recursive:true});
    fs.writeFileSync(path.join(root,'config/plugin_profile.md'),names.map(name=>`| ${name} | enabled | - | - | fixture |`).join('\n')+'\n');
}
function ensure(context,plugins){return cli.apply(context,{action:'ensure',plugins,members:[],explicit:true});}

test('catalog matches all manifests and group inverse selection expands dependencies',()=>{
    const root=path.resolve(__dirname,'../..');
    const value=generate(root);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'scripts/lib/plugin-catalog.json'),'utf8')),value);
    const selected=deployment.expandSelection(value,{all:true,excludeGroups:['xc']});
    assert.ok(selected.includes('coding-iris-plugin'));
    assert.ok(selected.every(name=>!name.startsWith('imedicalxc-')));
    assert.throws(()=>deployment.expandSelection(value,{all:true,excludeGroups:['general']}),error=>{
        assert.equal(error.conflicts[0].code,'excluded-base-capability');return true;
    });
});
test('catalog CLI accepts CRLF checkouts, detects stale metadata and regenerates the full catalog',t=>{
    const parent=path.join(os.tmpdir(),'Codex');fs.mkdirSync(parent,{recursive:true});
    const temporary=fs.mkdtempSync(path.join(parent,'plugin-catalog-'));
    t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
    const sourceRoot=path.resolve(__dirname,'../..');
    const value=generate(sourceRoot);
    const relatives=['scripts/generate-plugin-catalog.js','scripts/lib/plugin-groups.json','scripts/lib/plugin-catalog.json',
        ...value.plugins.map(item=>'plugins/'+item.directory+'/.agents-plugin/plugin.json')];
    for(const relative of relatives){
        const target=path.join(temporary,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.copyFileSync(path.join(sourceRoot,relative),target);
    }
    const file=path.join(temporary,'scripts/lib/plugin-catalog.json');
    const run=(...args)=>spawnSync(process.execPath,[path.join(temporary,'scripts/generate-plugin-catalog.js'),...args],{encoding:'utf8',windowsHide:true});
    assert.equal(run('--check').status,0);
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\r?\n/g,'\r\n'));
    assert.equal(run('--check').status,0,'Git CRLF conversion must not report a stale catalog');
    const stale=JSON.parse(fs.readFileSync(file,'utf8'));
    stale.plugins.find(item=>item.manifest.name==='iris-cure-form-dev').manifest.dependencyVersions['coding-iris-plugin'].maxVersionExclusive='0.1.0';
    fs.writeFileSync(file,JSON.stringify(stale,null,2)+'\n');
    assert.equal(run('--check').status,1);
    assert.equal(run().status,0);
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),value);
    assert.equal(run('--check').status,0);
    assert.equal(fs.readFileSync(file,'utf8').includes('\r'),false);
});
test('current cure form catalog materializes real manifests and leaves repeated ensure and fast-forward update clean',t=>{
    const f=fixture(t), sourceRoot=path.resolve(__dirname,'../..');
    const catalogFile=path.join(sourceRoot,'scripts/lib/plugin-catalog.json');
    const value=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
    const selected=deployment.closure(value,[...value.basePlugins,'iris-cure-form-dev']);
    for(const item of selected){
        const relatives=['.agents-plugin/plugin.json',item.manifest.entry];
        if(item.manifest.initSkill)relatives.push('skills/'+item.manifest.initSkill+'/SKILL.md');
        for(const relative of relatives){
            const target=path.join(f.origin,'plugins',item.directory,relative);
            fs.mkdirSync(path.dirname(target),{recursive:true});
            fs.copyFileSync(path.join(sourceRoot,'plugins',item.directory,relative),target);
        }
    }
    // Exercise the real metadata and sparse selection without copying vendor binaries.
    const resources=new Set(selected.flatMap(item=>[
        ...(item.manifest.runtimeResources||[]),
        ...(item.manifest.skillDependencies?.required||[]).map(skill=>'vendor/'+skill.provider)
    ]));
    for(const resource of resources){
        fs.mkdirSync(path.join(f.origin,resource),{recursive:true});
        fs.writeFileSync(path.join(f.origin,resource,'fixture-resource.txt'),'fixture resource');
    }
    fs.copyFileSync(catalogFile,path.join(f.origin,'scripts/lib/plugin-catalog.json'));
    f.git(f.origin,['add','.']);f.git(f.origin,['commit','-qm','current cure form metadata']);
    f.git(f.root,['pull','--ff-only']);
    for(let attempt=0;attempt<2;attempt++){
        const result=ensure(f.context,['iris-cure-form-dev']);
        for(const item of selected)assert.ok(result.installed.includes(item.manifest.name));
        assert.deepEqual(result.selected,['extract-doc','coding-iris-plugin','iris-cure-form-dev']);
        for(const item of result.initialization)assert.ok(fs.statSync(path.join(f.root,item.source)).isFile(),item.source);
        for(const resource of resources)assert.ok(fs.existsSync(path.join(f.root,resource,'fixture-resource.txt')),resource);
        assert.equal(deployment.profile(f.root).get('iris-cure-form-dev'),'available');
        assert.equal(deployment.loadState(f.root).phase,'ready');
        assert.equal(f.git(f.root,['status','--porcelain']),'');
    }
    fs.writeFileSync(path.join(f.origin,'scripts/catalog-update-probe.js'),"'use strict';\n");
    f.git(f.origin,['add','.']);f.git(f.origin,['commit','-qm','next framework update']);
    f.git(f.root,['pull','--ff-only']);
    assert.equal(f.git(f.root,['rev-parse','HEAD']),f.git(f.origin,['rev-parse','HEAD']));
    assert.equal(f.git(f.root,['status','--porcelain']),'');
});
test('excluded transitive dependencies report chain, version contract and declaration',()=>{
    const value={groups:[{id:'xc',plugins:['c']}],plugins:[
        {directory:'a',manifest:{name:'a',version:'1.0.0',dependencies:['b']}},
        {directory:'b',manifest:{name:'b',version:'1.0.0',dependencies:['c'],dependencyVersions:{c:{minVersion:'1.0.0',maxVersionExclusive:'2.0.0'}}}},
        {directory:'c',manifest:{name:'c',version:'1.0.0'}}
    ]};
    assert.throws(()=>deployment.expandSelection(value,{plugins:['a'],excludeGroups:['xc']}),error=>{
        assert.deepEqual(error.conflicts[0].chain,['a','b','c']);
        assert.equal(error.conflicts[0].edges[1].requiredVersion.minVersion,'1.0.0');
        assert.equal(error.conflicts[0].edges[1].declaration,'plugins/b/.agents-plugin/plugin.json');return true;
    });
});
test('fresh base install discovers absent plugins without downloading their blobs; ensure is resumable',t=>{
    const f=fixture(t);
    assert.ok(fs.existsSync(path.join(f.root,'plugins/agent-context-kit/AGENTS.md')));
    assert.ok(!fs.existsSync(path.join(f.root,'plugins/feature-ui')));
    const blob=f.git(f.origin,['rev-parse','HEAD:plugins/feature-ui/AGENTS.md']);
    assert.ok(f.git(f.root,['rev-list','--objects','--all','--missing=print']).includes('?'+blob));
    assert.ok(cli.main(['list','--project-root',f.project]).some(item=>item.name==='feature-ui'&&!item.installed));
    assert.throws(()=>cli.apply(f.context,{action:'ensure',plugins:['feature-ui'],members:[]}),/not authorized/);
    cli.main(['configure','--project-root',f.project,'--auto-install','true']);
    const result=cli.apply(f.context,{action:'ensure',plugins:['feature-ui'],members:[]});
    assert.deepEqual(result.selected,['feature-core','feature-ui']);
    assert.ok(fs.existsSync(path.join(f.root,'vendor/ui-runtime/asset.txt')));
    assert.equal(deployment.profile(f.root).get('feature-ui'),'available');
    const bytes=fs.readFileSync(path.join(f.root,'config/project.jsonc'));
    ensure(f.context,['feature-ui']);
    assert.deepEqual(fs.readFileSync(path.join(f.root,'config/project.jsonc')),bytes);
});
test('explicit disabled, dirty checkout and active lock preserve deployment',t=>{
    const f=fixture(t);ensure(f.context,['feature-ui']);
    require('../lib/project-plugin-profile').save(f.root,{'feature-ui':{status:'disabled',notes:'user'}});
    assert.throws(()=>ensure(f.context,['feature-ui']),/disabled/);
    fs.writeFileSync(path.join(f.root,'plugins/feature-core/AGENTS.md'),'user change');
    assert.throws(()=>ensure(f.context,['feature-xc']),/local changes/);
    const token=deployment.acquireLock(f.root,process.pid).token;
    try {assert.throws(()=>deployment.withLock(f.root,()=>{}),/busy/);}finally{deployment.releaseLock(f.root,token);}
});
test('full projects retain full checkout until explicit migration and prune retains enabled dependencies',t=>{
    const f=fixture(t,false);
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-xc')));
    // Legacy project-local config is ignored by the established installer.
    fs.appendFileSync(path.join(f.root,'.git/info/exclude'),'\n/config/\n');
    enabled(f.root,['feature-ui']);
    refresh(f.root,cli.runtimePatterns);
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-xc')));
    const result=cli.apply(f.context,{action:'migrate',plugins:[],members:[],execute:true});
    assert.ok(result.remove.includes('feature-xc'));
    assert.ok(!fs.existsSync(path.join(f.root,'plugins/feature-xc')));
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-core/AGENTS.md')));
    assert.equal(deployment.profile(f.root).get('feature-ui'),'enabled');
});
test('version constraints and dependency cycles fail before mutation',()=>{
    assert.equal(deployment.versionMatches('1.2.0',{minVersion:'1.0.0',maxVersionExclusive:'2.0.0'}),true);
    const value={plugins:[{directory:'a',manifest:{name:'a',version:'1.0.0',dependencies:['a']}}]};
    assert.throws(()=>deployment.closure(value,['a']),/cycle/);
});

for (const shell of process.platform === 'win32' ? ['powershell.exe','pwsh.exe'] : []) {
    test(shell + ': actual installer defaults to base-only deployment',t=>{
        const f=fixture(t);
        const directory=path.join(path.dirname(f.project),'fresh-'+shell);
        fs.mkdirSync(directory);
        const installer=path.join(path.dirname(f.project),'install-'+shell+'.ps1');
        const source=fs.readFileSync(path.resolve(__dirname,'../install-agents.ps1'),'utf8')
            .replace(/\$repo = "[^"]+"/, '$repo = "'+pathToFileURL(f.origin).href+'"');
        fs.writeFileSync(installer,'\uFEFF'+source.replace(/^\uFEFF/,''));
        const result=spawnSync(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',installer],{cwd:directory,encoding:'utf8',timeout:60000});
        assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
        assert.ok(fs.existsSync(path.join(directory,'.agents/plugins/agent-context-kit')));
        assert.ok(!fs.existsSync(path.join(directory,'.agents/plugins/feature-ui')));
        assert.equal(deployment.policy(path.join(directory,'.agents')).mode,'on-demand');
    });
    test(shell + ': initialization verifies discovery and disable preserves custom entries',t=>{
        const f=fixture(t);ensure(f.context,['feature-ui']);
        const repo=path.resolve(__dirname,'../..');
        const run=(script,args)=>spawnSync(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repo,'scripts',script),...args],{encoding:'utf8',timeout:60000});
        const args=['-ProjectRoot',f.project,'-Plugin','feature-ui','-Status','enabled'];
        const missing=run('update-plugin-profile.ps1',args);
        assert.notEqual(missing.status,0);
        assert.match(missing.stderr,/Initialize required dependency/);
        assert.ok(!fs.existsSync(path.join(f.root,'skills/setup-ui/SKILL.md')));
        const dependency=run('update-plugin-profile.ps1',['-ProjectRoot',f.project,'-Plugin','feature-core','-Status','enabled']);
        assert.equal(dependency.status,0,dependency.stdout+dependency.stderr);
        const active=run('update-plugin-profile.ps1',args);
        assert.equal(active.status,0,active.stdout+active.stderr);
        const profileBefore=fs.readFileSync(path.join(f.root,'config/project.jsonc'));
        for (const status of ['disabled','available']) {
            const blocked=run('update-plugin-profile.ps1',['-ProjectRoot',f.project,'-Plugin','feature-core','-Status',status]);
            assert.notEqual(blocked.status,0);
            assert.match(blocked.stderr,/feature-ui -> feature-core/);
            assert.deepEqual(fs.readFileSync(path.join(f.root,'config/project.jsonc')),profileBefore);
        }
        const entry=path.join(f.root,'skills/setup-ui/SKILL.md');
        const bytes=fs.readFileSync(entry);
        fs.appendFileSync(entry,'\nUser customization\n');
        const disabledArgs=['-ProjectRoot',f.project,'-Plugin','feature-ui','-Status','disabled'];
        const conflict=run('update-plugin-profile.ps1',disabledArgs);
        assert.notEqual(conflict.status,0);
        assert.equal(deployment.profile(f.root).get('feature-ui'),'enabled');
        assert.match(fs.readFileSync(entry,'utf8'),/User customization/);
        fs.writeFileSync(entry,bytes);
        const stopped=run('update-plugin-profile.ps1',disabledArgs);
        assert.equal(stopped.status,0,stopped.stdout+stopped.stderr);
        assert.equal(deployment.profile(f.root).get('feature-ui'),'disabled');
        assert.ok(!fs.existsSync(entry));
        assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-ui')));
    });
}

test('shared members retain their resources and unavailable members prevent pruning',t=>{
    const f=fixture(t);ensure(f.context,['feature-ui','feature-xc']);
    const other=path.join(path.dirname(f.project),'other-context');fs.mkdirSync(other);
    enabled(other,['feature-xc']);
    const state=deployment.loadState(f.root);
    state.members.push({contextRoot:other,lastRequired:['feature-xc']});
    deployment.atomicJson(deployment.statePath(f.root),state);
    enabled(f.root,['feature-ui']);
    cli.apply(f.context,{action:'prune',plugins:[],members:[],execute:true});
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-xc')));
    // Simulate an unavailable external member without deleting its recoverable state.
    fs.renameSync(other,other+'-offline');
    assert.throws(()=>cli.apply(f.context,{action:'prune',plugins:[],members:[],execute:true}),/unavailable/);
    refresh(f.root,cli.runtimePatterns);
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-xc')));
});

test('failed materialization leaves a retryable checkpoint and stale lock recovery checks owner',t=>{
    const f=fixture(t);
    const state=deployment.loadState(f.root);
    state.phase='interrupted';state.installed=['feature-ui','feature-core'];
    deployment.atomicJson(deployment.statePath(f.root),state);
    ensure(f.context,['feature-ui']);
    assert.equal(deployment.loadState(f.root).phase,'ready');
    const token=deployment.acquireLock(f.root,process.pid).token;
    assert.throws(()=>deployment.recoverLock(f.root),/still alive/);
    deployment.releaseLock(f.root,token);
    assert.deepEqual(deployment.recoverLock(f.root),{recovered:false});
});

test('ordinary refresh adds a new required dependency from the updated catalog',t=>{
    const f=fixture(t);ensure(f.context,['feature-ui']);
    const file=path.join(f.origin,'plugins/feature-ui/.agents-plugin/plugin.json');
    const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
    manifest.dependencies.push('feature-xc');manifest.version='1.0.1';
    fs.writeFileSync(file,JSON.stringify(manifest));
    fs.writeFileSync(path.join(f.origin,'scripts/lib/plugin-catalog.json'),JSON.stringify(generate(f.origin)));
    f.git(f.origin,['add','.']);f.git(f.origin,['commit','-qm','new dependency']);
    f.git(f.root,['fetch','origin']);f.git(f.root,['merge','--ff-only','FETCH_HEAD']);
    refresh(f.root,cli.runtimePatterns);
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-xc/AGENTS.md')));
});

test('offline missing blobs preserve base capability and resume after connection restoration',t=>{
    const f=fixture(t);
    f.git(f.root,['remote','set-url','origin',pathToFileURL(path.join(f.project,'unavailable')).href]);
    assert.throws(()=>ensure(f.context,['feature-ui']),/git/i);
    assert.equal(deployment.loadState(f.root).phase,'interrupted');
    assert.ok(fs.existsSync(path.join(f.root,'plugins/agent-context-kit/AGENTS.md')));
    assert.notEqual(deployment.profile(f.root).get('feature-ui'),'enabled');
    f.git(f.root,['remote','set-url','origin',pathToFileURL(f.origin).href]);
    ensure(f.context,['feature-ui']);
    assert.equal(deployment.loadState(f.root).phase,'ready');
});

test('an already deployed full Overlay registers on refresh and keeps its full capability checkout',t=>{
    const f=fixture(t,false);
    const workspace=path.join(path.dirname(f.project),'共享 模块'),contextRoot=path.join(workspace,'.agents');
    fs.mkdirSync(contextRoot,{recursive:true});
    enabled(contextRoot,['feature-ui']);
    fs.symlinkSync(f.origin,path.join(workspace,'backend'),process.platform==='win32'?'junction':'dir');
    const manifest=path.join(contextRoot,'capability.json');
    fs.writeFileSync(manifest,JSON.stringify({schemaVersion:1,mode:'workspace-overlay',workspace:'full-member',
        contextRoot:'.agents',capabilityRoot:f.root,sharedDirectories:[],localDirectories:['config'],
        sourceRoots:[{name:'backend',path:'backend',target:f.origin,gitRoot:f.origin}]}));
    const configuration=path.join(contextRoot,'config/plugin_profile.md');
    const sparse=path.join(f.root,'.git/info/sparse-checkout');
    const registry=deployment.statePath(f.root);
    const before=[manifest,configuration,sparse].map(file=>fs.readFileSync(file));
    assert.equal(fs.existsSync(registry),false);
    assert.equal(cli.main(['register','--project-root',f.project]).registered,false);
    assert.equal(fs.existsSync(registry),false);
    assert.equal(cli.main(['register','--project-root',workspace]).registered,true);
    const state=deployment.loadState(f.root);
    assert.equal(state.mode,'full');
    assert.equal(state.members.length,1);
    assert.equal(state.members[0].workspaceRoot,workspace);
    assert.equal(state.members[0].contextRoot,contextRoot);
    assert.ok(state.members[0].lastRequired.includes('feature-ui'));
    assert.ok(state.members[0].lastRequired.includes('feature-core'));
    assert.deepEqual([manifest,configuration,sparse].map(file=>fs.readFileSync(file)),before);
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-xc')));
    assert.equal(deployment.policy(contextRoot).mode,'full');
    const stored=fs.readFileSync(registry);
    cli.main(['register','--project-root',workspace]);
    assert.deepEqual(fs.readFileSync(registry),stored);
    fs.writeFileSync(configuration,'| removed-plugin | enabled | - | - | unavailable historical entry |\n');
    cli.main(['register','--project-root',workspace]);
    assert.deepEqual(fs.readFileSync(registry),stored);
});

test('Overlay migration registers associated workspaces and preserves their union',t=>{
    const f=fixture(t,false);
    function overlay(name,selected){
        const project=path.join(path.dirname(f.project),name),contextRoot=path.join(project,'.agents');
        fs.mkdirSync(contextRoot,{recursive:true});enabled(contextRoot,selected);
        fs.symlinkSync(f.origin,path.join(project,'backend'),process.platform==='win32'?'junction':'dir');
        fs.writeFileSync(path.join(contextRoot,'capability.json'),JSON.stringify({schemaVersion:1,mode:'workspace-overlay',workspace:name,
            contextRoot:'.agents',capabilityRoot:f.root,sharedDirectories:[],localDirectories:['config'],sourceRoots:[{name:'backend',path:'backend',target:f.origin,gitRoot:f.origin}]}));
        return {project,context:cli.resolveContext(project)};
    }
    const first=overlay('overlay-a',['feature-ui']),second=overlay('overlay-b',['feature-xc']);
    assert.throws(()=>cli.apply(first.context,{action:'migrate',plugins:[],members:[second.project]}),/members-complete/);
    cli.apply(first.context,{action:'migrate',plugins:[],members:[second.project],membersComplete:true});
    assert.equal(deployment.loadState(f.root).members.length,2);
    assert.equal(deployment.policy(second.context.contextRoot).mode,'on-demand');
    enabled(first.context.contextRoot,[]);
    cli.apply(first.context,{action:'prune',plugins:[],members:[]});
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-ui')));
    require('../lib/project-plugin-profile').rollback(first.context.contextRoot);
    fs.writeFileSync(path.join(first.context.contextRoot,'config/plugin_profile.md'),
        '| feature-ui | available | - | - | explicit release |\n| feature-core | available | - | - | explicit release |\n');
    cli.apply(first.context,{action:'prune',plugins:[],members:[]});
    assert.ok(!fs.existsSync(path.join(f.root,'plugins/feature-ui')));
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-xc')));
    const third=overlay('overlay-c',['feature-ui']);
    cli.main(['register','--project-root',third.project]);
    assert.equal(deployment.loadState(f.root).members.length,3);
    assert.ok(fs.existsSync(path.join(f.root,'plugins/feature-ui')));
});

test('knowledge vector selection survives plugin refresh and pruning independently',t=>{
    const f=fixture(t);
    const directory=path.join(f.origin,'vendor/knowledge-index');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'company.sqlite'),Buffer.from([0,1,2,3]));
    fs.writeFileSync(path.join(directory,'.gitattributes'),'*.sqlite binary\n');
    f.git(f.origin,['add','.']);f.git(f.origin,['commit','-qm','optional vector fixture']);
    f.git(f.root,['fetch','origin']);f.git(f.root,['merge','--ff-only','FETCH_HEAD']);
    refresh(f.root,cli.runtimePatterns);
    assert.ok(!fs.existsSync(path.join(f.root,'vendor/knowledge-index/company.sqlite')));
    selectKnowledgeIndex(f.root,'company',true);
    ensure(f.context,['feature-ui']);
    cli.apply(f.context,{action:'prune',plugins:[],members:[]});
    assert.ok(fs.existsSync(path.join(f.root,'vendor/knowledge-index/company.sqlite')));
    assert.ok(!fs.existsSync(path.join(f.root,'vendor/ui-runtime')));
});

test('legacy profile casing, BOM and mixed newlines retain initialized choices',t=>{
    const f=fixture(t);
    fs.writeFileSync(path.join(f.root,'config/plugin_profile.md'),'\uFEFF# Profile\r\n| FEATURE-UI | Initialized | - | - | kept |\n');
    assert.equal(deployment.profile(f.root).get('feature-ui'),'enabled');
    const planned=deployment.plan(f.context,[],'prune');
    assert.ok(planned.keep.includes('feature-ui'));
    assert.ok(planned.keep.includes('feature-core'));
});


test('optional vendor skills require task selection and follow acquisition policy',t=>{
    const f=fixture(t);ensure(f.context,['feature-ui']);
    const file=path.join(f.root,'vendor/optional-runtime/skills/review/SKILL.md');
    assert.ok(!fs.existsSync(file));
    const options={action:'ensure',plugins:['feature-ui'],members:[],optionalSkills:['fixture.review']};
    assert.throws(()=>cli.apply(f.context,options),/not authorized/);
    const result=cli.apply(f.context,{...options,explicit:true});
    assert.ok(result.resources.includes('vendor/optional-runtime'));
    assert.ok(fs.existsSync(file));
});

 test('deactivation checks transitive catalog dependencies and ignores optional edges', t => {
    const f = fixture(t);
    const { checkDeactivation } = require('../check-plugin-deactivation');
    const catalogFile = path.join(f.root, 'scripts/lib/plugin-catalog.json');
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    catalog.plugins.push({ directory: 'top', manifest: { name: 'top', dependencies: ['feature-ui'] } });
    catalog.plugins.push({ directory: 'optional', manifest: { name: 'optional', availableDependencies: ['feature-core'] } });
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    fs.writeFileSync(path.join(f.root, 'config/plugin_profile.md'), '| top | enabled | - | - | test |\n');
    assert.throws(() => checkDeactivation(f.root, f.root, 'feature-core'), /top -> feature-ui -> feature-core/);
    fs.writeFileSync(path.join(f.root, 'config/plugin_profile.md'), '| top | disabled | - | - | test |\n| optional | enabled | - | - | test |\n');
    assert.doesNotThrow(() => checkDeactivation(f.root, f.root, 'feature-core'));
});
