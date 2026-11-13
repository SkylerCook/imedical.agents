'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chunks, digest, loadDocuments } = require('../lib/knowledge-sources');
const rag = require('../lib/knowledge-retrieval');
const { resolveContext } = require('../knowledge-query');

function fixture(t) {
    const temporaryRoot = path.join(os.tmpdir(), 'Codex');
    fs.mkdirSync(temporaryRoot, {recursive:true});
    const root = fs.mkdtempSync(path.join(temporaryRoot, 'knowledge-rag-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const context = { capabilityRoot: path.join(root, 'shared'), contextRoot: path.join(root, 'project/.agents') };
    const directory = path.join(context.capabilityRoot, 'plugins/imedical-ui/references');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'forms.md'), '# 表单\n\n适用共性，业务条件需核对。\n\n## 标签对齐\n\nPURE 标签与输入框对齐，10px 间距只在兼容两主题时适用。\n\n## 下拉选择\n\ncombobox.getValue 返回标识。\n');
    return context;
}
function policy(context, changes = {}) {
    fs.mkdirSync(path.dirname(rag.policyPath(context)), { recursive: true });
    fs.writeFileSync(rag.policyPath(context), JSON.stringify({schema:'knowledge-policy/v1',allowedDirectories:['plugins/imedical-ui/references'],allowQuery:true,...changes}));
}
function mockApi(counter, status = 200) {
    return async (url, options) => {
        counter.push(JSON.parse(options.body));
        return { ok:status===200, status, json:async () => ({data:counter.at(-1).input.map((text,index) => ({index,embedding:Array.from({length:1536},(_,i)=>i===0?1:0)})),usage:{total_tokens:12}}) };
    };
}
test('chunks preserve headings, fences, table headers, conditions and source lines', () => {
    const content = '# 文档\r\n\r\n共同条件\r\n\r\n## PURE\r\n\r\n| 参数 | 条件 |\r\n|---|---|\r\n| 10px | 两主题 |\r\n\r\n```js\r\n# not heading\r\n```';
    const result = chunks({path:'test.md',content,scope:'shared'});
    assert.equal(result.length,2);
    assert.equal(result[1].heading,'文档 > PURE');
    assert.ok(result[1].text.includes('| 参数 | 条件 |'));
    assert.ok(result[1].text.includes('# not heading'));
    assert.equal(result[1].line,5);
    assert.match(result[1].documentContext,/共同条件/);
});
test('Chinese terms and exact identifiers remain searchable', () => {
    assert.ok(rag.terms('输入框 combobox.getValue').includes('入框'));
    assert.ok(rag.terms('combobox.getValue').includes('combobox.getvalue'));
});
test('no policy means local-only preview and no outbound query',async t=>{
    const context=fixture(t), calls=[];
    assert.equal(rag.preview(context,undefined,{provider:'openai',settings:{}}).eligibleChunks,0);
    const result=await rag.search(context,'标签对齐',{queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(result.mode,'lexical');assert.equal(calls.length,0);assert.ok(result.matches.length);
});
test('approved incremental build persists vectors, skips unchanged content and gates new policy',async t=>{
    const context=fixture(t),calls=[];policy(context);
    await assert.rejects(rag.build(context,{provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)}),/preview/);
    await rag.build(context,{approve:rag.preview(context,undefined,{provider:'openai',settings:{}}).snapshot,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    const count=calls.length;
    await rag.build(context,{provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(calls.length,count);
    const result=await rag.search(context,'如何排列字段',{queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(result.mode,'hybrid');assert.equal(result.embeddingTokens,12);
    policy(context,{allowedDirectories:['plugins/imedical-ui/references','vendor/imedical-knowledge/sources']});
    await assert.rejects(rag.build(context,{provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)}),/preview/);
});
test('query permission, project source and revoked scope prevent external calls',async t=>{
    const context=fixture(t),calls=[];policy(context);
    await rag.build(context,{approve:rag.preview(context,undefined,{provider:'openai',settings:{}}).snapshot,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    calls.length=0;
    await rag.search(context,'私有查询',{provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    await rag.search(context,'私有查询',{sourceId:'hospital',queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    policy(context,{allowedDirectories:[]});
    await rag.search(context,'标签',{queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(calls.length,0);
});
test('API failure degrades locally and build resumes',async t=>{
    const context=fixture(t),calls=[];policy(context);
    const first=await rag.build(context,{approve:rag.preview(context,undefined,{provider:'openai',settings:{}}).snapshot,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls,429)});
    assert.deepEqual(first.warnings,['embedding-http-429']);
    await rag.build(context,{provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    const result=await rag.search(context,'标签',{queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls,500)});
    assert.equal(result.mode,'lexical');assert.ok(result.matches.length);assert.deepEqual(result.warnings,['embedding-http-500']);
});
test('stale source vectors excluded and complete serialized result fits budget',async t=>{
    const context=fixture(t),calls=[];policy(context);
    await rag.build(context,{approve:rag.preview(context,undefined,{provider:'openai',settings:{}}).snapshot,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    fs.writeFileSync(path.join(context.capabilityRoot,'plugins/imedical-ui/references/forms.md'),'# 新文档\n\n标签采用新的要求。');
    calls.length=0;
    const result=await rag.search(context,'标签',{queryPublic:true,maxChars:1000,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(calls.length,0);assert.ok(JSON.stringify(result).length<=1000);
    assert.ok(result.matches.every(item=>item.text.includes('新')));
});
test('live build lock blocks concurrent writer without deleting the lock',async t=>{
    const context=fixture(t);const file=rag.databasePath(context,{provider:'openai'});
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file+'.lock',JSON.stringify({pid:process.pid,created:'now'}));
    await assert.rejects(rag.build(context,{provider:'openai',settings:{}}),/busy/);assert.ok(fs.existsSync(file+'.lock'));
});
test('malformed vectors rejected without exposing credentials or response body',async()=>{
    await assert.rejects(rag.embed(['text'],{provider:'openai',settings:{},apiKey:'secret',fetch:async()=>({ok:true,json:async()=>({data:[{index:0,embedding:[1]}]})})}),/embedding-response-invalid/);
});
test('manifest integrity remains enforced',t=>{
    const context=fixture(t),root=path.join(context.capabilityRoot,'vendor/imedical-knowledge');
    fs.mkdirSync(path.join(root,'sources'),{recursive:true});fs.writeFileSync(path.join(root,'sources/a.md'),'changed');
    fs.writeFileSync(path.join(root,'sources.json'),JSON.stringify({schema:'imedical-knowledge-source/v1',files:[{path:'sources/a.md',sha256:digest('before')}]}));
    assert.throws(()=>loadDocuments(context),/integrity/);
});
test('standard project resolves cache ownership',t=>{
    const context=fixture(t);const actual=resolveContext(path.dirname(context.contextRoot));
    assert.equal(actual.contextRoot.replaceAll('\\','/'),context.contextRoot.replaceAll('\\','/'));
});
test('large tables repeat headers while preserving row source positions',()=>{
    const content='# 表格\n\n| 名称 | 限制 |\n| --- | --- |\n'+Array.from({length:100},(_,i)=>`| 行${i} | ${'业务条件'.repeat(12)} |`).join('\n');
    const result=chunks({path:'table.md',content,scope:'shared'});
    assert.ok(result.length>1);
    for(const item of result)assert.match(item.text,/\| 名称 \| 限制 \|/);
});
test('multi-batch interrupted build resumes only unfinished embeddings',async t=>{
    const context=fixture(t);policy(context);
    fs.writeFileSync(path.join(context.capabilityRoot,'plugins/imedical-ui/references/forms.md'),
        '# 表单\n'+Array.from({length:40},(_,i)=>`\n## 字段${i}\n\n字段${i}单独说明。\n`).join(''));
    const calls=[];
    const flaky=async(url,options)=>calls.length===0?mockApi(calls)(url,options):mockApi(calls,429)(url,options);
    const first=await rag.build(context,{approve:rag.preview(context,undefined,{provider:'openai',settings:{}}).snapshot,provider:'openai',settings:{},apiKey:'test',fetch:flaky});
    assert.equal(first.warnings[0],'embedding-http-429');
    const completed=JSON.stringify(calls[0].input);
    calls.length=0;
    const resumed=await rag.build(context,{provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(resumed.warnings.length,0);
    assert.ok(calls.every(call=>JSON.stringify(call.input)!==completed));
});
test('project documents stay scoped and win matching shared references',async t=>{
    const context=fixture(t);
    const result=await rag.search(context,'标签',{projectDocuments:[{path:'work/menu-sync/a/group-a.md',content:'# 标签\n\n当前项目标签入口',scope:'project',sourceId:'a'}]});
    assert.equal(result.matches[0].scope,'project');
    assert.ok(!fs.existsSync(rag.databasePath(context,{provider:'openai'})));
});
test('repository deployment whitelist covers root runtime scripts and excludes tests',()=>{
    const root=path.resolve(__dirname,'../..');
    for(const name of ['install-agents.ps1','update-agents.ps1']){
        const text=fs.readFileSync(path.join(root,'scripts',name),'utf8');
        assert.match(text,/scripts\/\*\.js/);assert.match(text,/scripts\/lib\/\*\*/);
    }
});
test('wiki frontmatter title is included in the retrievable heading',()=>{
    const result=chunks({path:'wiki.md',content:'---\nname: 多院区配置\n---\n\n## 读取方式\n\n使用配置工具。'});
    assert.equal(result[0].heading,'多院区配置 > 读取方式');
});
test('exported bundle serves fresh projects without a local policy or document uploads',async t=>{
    const context=fixture(t),calls=[];policy(context);
    await rag.build(context,{approve:rag.preview(context,undefined,{provider:'openai',settings:{}}).snapshot,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    const exported=rag.exportBundle(context,{provider:'openai',settings:{}});
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(exported.path,{readOnly:true});
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name),['chunks','state','vectors']);
    assert.ok(db.prepare('SELECT key FROM state').all().every(row=>!row.key.includes('approved')));
    assert.equal(db.prepare('SELECT typeof(data) AS type FROM vectors LIMIT 1').get().type,'blob');
    db.close();
    fs.rmSync(path.dirname(rag.databasePath(context,{provider:'openai'})),{recursive:true});
    fs.rmSync(path.dirname(rag.policyPath(context)),{recursive:true});
    calls.length=0;
    const before=digest(fs.readFileSync(exported.path));
    const result=await rag.search(context,'标签',{queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(result.mode,'hybrid');assert.deepEqual(result.vectorSources,['bundle']);
    assert.deepEqual(calls.map(call=>call.input),[['标签']]);
    assert.equal(digest(fs.readFileSync(exported.path)),before);
    assert.ok(!fs.existsSync(path.dirname(rag.databasePath(context,{provider:'openai'}))));
    const offline=await rag.search(context,'标签',{localOnly:true});assert.equal(offline.mode,'lexical');
    policy(context,{allowQuery:false});calls.length=0;
    await rag.search(context,'标签',{queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});assert.equal(calls.length,0);
});
test('failed export preserves prior bundle and source drift excludes stale bundled vectors',async t=>{
    const context=fixture(t),calls=[];policy(context);
    await rag.build(context,{approve:rag.preview(context,undefined,{provider:'openai',settings:{}}).snapshot,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    const exported=rag.exportBundle(context,{provider:'openai',settings:{}}),before=digest(fs.readFileSync(exported.path));
    fs.writeFileSync(path.join(context.capabilityRoot,'plugins/imedical-ui/references/forms.md'),'# 全新内容\n\n变更后的标签资料');
    assert.throws(()=>rag.exportBundle(context,{provider:'openai',settings:{}}),/Complete current/);
    assert.equal(digest(fs.readFileSync(exported.path)),before);
    calls.length=0;
    const result=await rag.search(context,'标签',{queryPublic:true,provider:'openai',settings:{},apiKey:'test',fetch:mockApi(calls)});
    assert.equal(calls.length,0);assert.equal(result.mode,'lexical');
    assert.deepEqual(fs.readdirSync(path.dirname(exported.path)),['index.sqlite']);
});
test('fixed thirty-question corpus retains top-six recall and expected conditions',async()=>{
    const root=path.resolve(__dirname,'../..');
    const context={capabilityRoot:root,contextRoot:root};
    const questions=require('./fixtures/knowledge-questions.json');
    let hits=0, conditions=0;
    for(const question of questions){
        const result=await rag.search(context,question.query,{localOnly:true,domain:question.group==='business'?'business':'ui'});
        const expected=result.matches.filter(item=>item.path.endsWith(question.expected));
        if(expected.length)hits++;
        if(expected.some(item=>(item.heading+'\n'+item.documentContext+'\n'+item.text).toLowerCase().includes(question.condition.toLowerCase())))conditions++;
    }
    assert.ok(hits>=27,`Top-six hits: ${hits}/30`);
    assert.equal(conditions,30);
});
