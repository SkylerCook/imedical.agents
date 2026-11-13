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
    for(const relative of ['scripts/plugin-deploy.js','scripts/refresh-agents-sparse.js','scripts/lib/plugin-deployment.js','scripts/lib/workspace-context.js']) {
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
    const bytes=fs.readFileSync(path.join(f.root,'config/plugin_profile.md'));
    ensure(f.context,['feature-ui']);
    assert.deepEqual(fs.readFileSync(path.join(f.root,'config/plugin_profile.md')),bytes);
});
test('explicit disabled, dirty checkout and active lock preserve deployment',t=>{
    const f=fixture(t);ensure(f.context,['feature-ui']);
    fs.writeFileSync(path.join(f.root,'config/plugin_profile.md'),'| feature-ui | disabled | - | - | user |\n');
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
        assert.match(missing.stderr,/discovery entries/);
        const generated=run('generate-plugin-thin-index.ps1',['-PluginPath',path.join(f.root,'plugins/feature-ui'),'-ProjectRoot',f.project,'-Mode','Write']);
        assert.equal(generated.status,0,generated.stdout+generated.stderr);
        const dependency=run('update-plugin-profile.ps1',['-ProjectRoot',f.project,'-Plugin','feature-core','-Status','enabled']);
        assert.equal(dependency.status,0,dependency.stdout+dependency.stderr);
        const active=run('update-plugin-profile.ps1',args);
        assert.equal(active.status,0,active.stdout+active.stderr);
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
