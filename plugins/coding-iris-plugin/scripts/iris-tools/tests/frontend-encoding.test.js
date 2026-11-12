'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const encoding = require('../frontend-encoding');
const {createTempDirectory} = require('../../../../../scripts/tests/fixtures/temp-directory');

test('strict codecs preserve Chinese, BOM and line endings without replacement', () => {
    for (const name of ['utf8','gb2312','gbk','gb18030']) {
        const text = 'var text = "中文";\r\n';
        assert.equal(encoding.decode(encoding.encode(text,name),name),text);
    }
    assert.equal(encoding.encode('中文','gb2312').toString('hex'),'d6d0cec4');
    assert.throws(()=>encoding.encode('丂','gb2312'),/unrepresentable/);
    assert.equal(encoding.encode('丂','gbk').toString('hex'),'8140');
    assert.throws(()=>encoding.encode('😀','gbk'),/unrepresentable/);
    assert.equal(encoding.encode('😀','gb18030').toString('hex'),'9439fc36');
    assert.equal(encoding.decode(encoding.encode('\uFEFF中文\r\n','utf8'),'utf8'),'\uFEFF中文\r\n');
    assert.throws(()=>encoding.decode(Buffer.from([0x81]),'gbk'),/invalid/);
    assert.throws(()=>encoding.encode('x\n😀','gb2312'),error=>error.details.characters[0].line===2 && error.details.characters[0].column===1);
});

test('ASCII and shared Chinese bytes report candidates without automatic confirmation', () => {
    assert.equal(encoding.inspect(Buffer.from('ascii')).confirmed,false);
    assert.deepEqual(encoding.inspect(encoding.encode('中文','gbk')).candidates,['gb2312','gbk','gb18030']);
});

test('on-demand source editing and deployment require one persistent server confirmation', t => {
    const root=createTempDirectory('frontend-encoding-');
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const context={workspaceRoot:root,contextRoot:path.join(root,'.agents')};
    const config=path.join(context.contextRoot,'config');fs.mkdirSync(config,{recursive:true});
    const profile=path.join(config,'iris_project_profile.md');
    fs.writeFileSync(path.join(config,'project_context_profile.md'),'- contextMode：intent-first-on-demand-export\n');
    fs.writeFileSync(profile,'- 前端编码模式：utf8\n');
    const file=path.join(root,'src/page.js');
    assert.throws(()=>encoding.resolve(context,file),/confirmation-required/);
    assert.equal(encoding.resolve(context,file,{requireConfirmed:false}).serverEncoding,null);
    fs.writeFileSync(profile,'- 前端源码编码：utf8\n- 前端服务器编码：gbk\n- 前端服务器编码确认：confirmed\n');
    fs.appendFileSync(profile,'- 前端服务器编码确认环境：'+encoding.targetIdentity(context)+'\n');
    const policy=encoding.resolve(context,file),source=Buffer.from('中文');
    assert.deepEqual(encoding.resolve(context,file),policy);
    assert.equal(encoding.artifact(source,policy,file).toString('hex'),'d6d0cec4');
    assert.equal(source.toString(),'中文');
    fs.appendFileSync(profile,'\n| `src/special.js` | utf8 | gb18030 | confirmed |\n');
    assert.equal(encoding.resolve(context,path.join(root,'src/special.js')).serverEncoding,'gb18030');
    assert.equal(encoding.resolve(context,file).configurationSha256,policy.configurationSha256);
    fs.writeFileSync(path.join(config,'project-env.json'),JSON.stringify({web:{basePath:'different'}}));
    assert.throws(()=>encoding.resolve(context,file),/confirmation-required/);
    fs.writeFileSync(profile,'- 默认需求交付类型：standard\n- 前端源码编码：utf8\n- 前端服务器编码：pending\n');
    assert.equal(encoding.resolve(context,file).serverEncoding,'utf8');
    assert.throws(()=>encoding.resolve(context,file,{projectTask:true}),/confirmation-required/);
});

test('UTF-8 BOM is an encoding marker when producing GBK, while source stays intact',()=>{
    const source=Buffer.from('\uFEFF中文\r\n');
    const output=encoding.artifact(source,{sourceEncoding:'utf8',serverEncoding:'gbk',confirmed:true},'page.csp');
    assert.equal(output.toString('hex'),'d6d0cec40d0a');
    assert.equal(source.subarray(0,3).toString('hex'),'efbbbf');
});

test('CLI records confirmation once and rejects edits before confirmation or after target drift',t=>{
    const root=createTempDirectory('frontend-encoding-cli-');
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    fs.mkdirSync(path.join(root,'.agents/config'),{recursive:true});fs.mkdirSync(path.join(root,'.agents/.git'));
    fs.writeFileSync(path.join(root,'.agents/config/project_context_profile.md'),'- contextMode: intent-first-on-demand-export\n');
    fs.writeFileSync(path.join(root,'.agents/config/iris_project_profile.md'),'- 前端源码编码：utf8\n- 前端服务器编码：pending\n');
    const run=(...args)=>require('node:child_process').spawnSync(process.execPath,[path.resolve(__dirname,'../frontend-encoding-cli.js'),...args,'--project-root',root],{encoding:'utf8'});
    assert.equal(run('check','--files','new.js').status,1);
    assert.equal(run('confirm','--source','utf8','--target','gbk').status,1);
    const confirmed=run('confirm','--source','utf8','--target','gbk','--confirm');
    assert.equal(confirmed.status,0,confirmed.stderr);
    for(let i=0;i<2;i++)assert.equal(run('check','--files','new.js').status,0);
    assert.equal(fs.existsSync(path.join(root,'new.js')),false);
    const profile = path.join(root,'.agents/config/iris_project_profile.md');
    for (const separator of ['\r\n', '\n', '\r']) {
        fs.writeFileSync(profile, '\ufeff' + ['- 前端源码编码：utf8','- 前端服务器编码：gbk','- 前端服务器编码确认：confirmed','- 前端服务器编码确认环境：old'].join(separator));
        const changed = run('confirm','--source','utf8','--target','gb18030','--confirm');
        assert.equal(changed.status,0,changed.stderr);
        const bytes = fs.readFileSync(profile,'utf8');
        assert.equal(bytes.charCodeAt(0),0xfeff);
        assert.doesNotMatch(bytes,/\r(?!\n)/);
        assert.match(bytes,/- 前端服务器编码：gb18030/);
        assert.equal((bytes.match(/前端源码编码/g) || []).length,1);
        assert.equal(run('check','--files','new.js').status,0);
        assert.equal(run('confirm','--source','utf8','--target','gb18030','--confirm').status,0);
        assert.equal(fs.readFileSync(profile,'utf8'),bytes);
    }

    fs.writeFileSync(path.join(root,'.agents/config/project-env.json'),JSON.stringify({iris:{namespace:'CHANGED'}}));
    const drift=run('check','--files','new.js');
    assert.equal(drift.status,1);assert.match(drift.stderr,/confirmation-required/);
});

test('equivalent connection port representations preserve confirmation identity',t=>{
 const root=createTempDirectory('encoding-port-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const context={workspaceRoot:root,contextRoot:path.join(root,'.agents')};fs.mkdirSync(path.join(context.contextRoot,'config'),{recursive:true});
 fs.writeFileSync(path.join(context.contextRoot,'config/project-env.json'),JSON.stringify({iris:{port:443}}));
 const before=encoding.targetIdentity(context);
 fs.writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{env:{IRIS_WEB_PORT:'443'}}}}));
 assert.equal(encoding.targetIdentity(context),before);
});
