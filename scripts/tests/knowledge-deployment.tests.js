'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
const {refresh,selectKnowledgeIndex} = require('../refresh-agents-sparse');
const {digest} = require('../lib/knowledge-sources');

test('fresh sparse project and fast-forward update use distributed vectors without rebuilding', async t => {
    const parent = path.join(os.tmpdir(),'Codex');
    fs.mkdirSync(parent,{recursive:true});
    const temporary = fs.mkdtempSync(path.join(parent,'knowledge-deploy-'));
    t.after(() => { assert.equal(path.dirname(temporary),parent); fs.rmSync(temporary,{recursive:true,force:true}); });
    const repo = path.resolve(__dirname,'../..');
    const origin = path.join(temporary,'origin');
    fs.mkdirSync(origin);
    for (const relative of ['vendor/knowledge-index','vendor/imedical-knowledge','plugins/imedical-ui/references',
        'plugins/iris-ui/references','plugins/coding-iris-plugin/references','scripts/knowledge-query.js',
        'scripts/refresh-agents-sparse.js','scripts/lib/knowledge-embedding.js','scripts/lib/knowledge-retrieval.js','scripts/lib/knowledge-sources.js','scripts/lib/workspace-context.js']) {
        const destination=path.join(origin,relative);
        fs.mkdirSync(path.dirname(destination),{recursive:true});
        fs.cpSync(path.join(repo,relative),destination,{recursive:true});
    }
    function git(cwd,args) {
        const result=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',timeout:120000});
        assert.equal(result.status,0,result.stderr);
        return result.stdout;
    }
    git(origin,['init','-q']);git(origin,['config','user.name','Fixture']);git(origin,['config','user.email','fixture@example.invalid']);
    git(origin,['config','uploadpack.allowFilter','true']);
    git(origin,['add','.']);git(origin,['commit','-qm','knowledge bundle fixture']);
    const project=path.join(temporary,'project');fs.mkdirSync(project);
    const capability=path.join(project,'.agents');
    git(project,['clone','--filter=blob:none','--no-checkout',require('node:url').pathToFileURL(origin).href,capability]);
    const patterns=['/plugins/**','/vendor/**','/scripts/*.js','/scripts/lib/**'];
    refresh(capability,patterns,true);
    assert.ok(!fs.existsSync(path.join(capability,'vendor/knowledge-index/company.sqlite')));
    const blob = git(origin,['rev-parse','HEAD:vendor/knowledge-index/company.sqlite']).trim();
    assert.ok(git(capability,['rev-list','--objects','--all','--missing=print']).includes('?'+blob));
    const freshCli=spawnSync(process.execPath,[path.join(capability,'scripts/knowledge-query.js'),'--project-root',project,'--query','PURE 标签对齐','--query-public'],{encoding:'utf8',env:{...process.env,KNOWLEDGE_RAG_CONFIG:''}});
    assert.equal(freshCli.status,0,freshCli.stderr);
    assert.equal(JSON.parse(freshCli.stdout).mode,'lexical');
    assert.ok(JSON.parse(freshCli.stdout).matches.length);
    selectKnowledgeIndex(capability,'company',true);
    const index=path.join(capability,'vendor/knowledge-index/company.sqlite');
    const before=digest(fs.readFileSync(index));
    const metadata=new DatabaseSync(index,{readOnly:true});
    const identity=metadata.prepare('SELECT value FROM state WHERE key=?').get('identity').value;
    metadata.close();
    const embedding={provider:'company',type:'gateway',model:'bge-m3',dimensions:1024,identity,baseUrl:'https://fixture.invalid',appId:'fixture',appKey:'fixture',method:'fixture'};
    const calls=[];
    const installed=require(path.join(capability,'scripts/lib/knowledge-retrieval.js'));
    const context=require(path.join(capability,'scripts/knowledge-query.js')).resolveContext(project);
    const mock=async (url,options) => {
        if(url.includes('/token/'))return {ok:true,json:async()=>({access_token:'fixture',remain_time:0})};
        calls.push(JSON.parse(options.body).biz_content.body);
        return {ok:true,json:async()=>({code:'10000',data:{data:[{index:0,embedding:Array.from({length:1024},(_,i)=>i===0?1:0)}],usage:{total_tokens:4}}})};
    };
    const result=await installed.search(context,'PURE 标签对齐',{domain:'ui',queryPublic:true,embedding,fetch:mock});
    assert.equal(result.mode,'hybrid');assert.deepEqual(result.vectorSources,['bundle']);
    assert.deepEqual(calls.map(call=>call.input),[['PURE 标签对齐']]);
    assert.equal(digest(fs.readFileSync(index)),before);
    assert.ok(!fs.existsSync(path.join(capability,'.knowledge-cache')));
    const cli=spawnSync(process.execPath,[path.join(capability,'scripts/knowledge-query.js'),'--project-root',project,
        '--query','PURE 标签对齐','--domain','ui','--query-public'],{encoding:'utf8',timeout:45000,
        env:{...process.env,KNOWLEDGE_RAG_CONFIG:process.env.KNOWLEDGE_LIVE_SMOKE==='1'?process.env.KNOWLEDGE_RAG_CONFIG:''}});
    assert.equal(cli.status,0,cli.stderr);
    const response=JSON.parse(cli.stdout);
    assert.equal(response.mode,process.env.KNOWLEDGE_LIVE_SMOKE==='1'?'hybrid':'lexical');
    assert.ok(response.matches.length);
    t.diagnostic(JSON.stringify({installedCliMode:response.mode,vectorSources:response.vectorSources,embeddingTokens:response.embeddingTokens}));
    const next=new DatabaseSync(path.join(origin,'vendor/knowledge-index/company.sqlite'));
    next.prepare('INSERT INTO state VALUES (?,?)').run('fixture-release','2');next.close();
    git(origin,['add','vendor/knowledge-index/company.sqlite']);git(origin,['commit','-qm','update fixture index']);
    git(capability,['fetch','origin']);git(capability,['merge','--ff-only','FETCH_HEAD']);refresh(capability,patterns);
    assert.notEqual(digest(fs.readFileSync(index)),before);
    const after=await installed.search(context,'PURE 标签对齐',{domain:'ui',queryPublic:true,embedding,fetch:mock});
    assert.equal(after.mode,'hybrid');assert.ok(!fs.existsSync(path.join(capability,'.knowledge-cache')));
    selectKnowledgeIndex(capability,'company',false);
    assert.ok(!fs.existsSync(index));
    refresh(capability,patterns);
    assert.ok(!fs.existsSync(index));
    const offline=await installed.search(context,'标签对齐',{env:{},queryPublic:true});
    assert.equal(offline.mode,'lexical');assert.ok(offline.matches.length);
});
