'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {plan, connection, compile, validateResponse} = require('../compile-csp');
const good = {status: {errors: [], summary: ''}, result: {content: []}, console: ['Compilation finished successfully.']};

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => {instance.closeAllConnections(); instance.close();});
  return {protocol:'http:', hostname:'127.0.0.1', port:instance.address().port, path:'/api/atelier/v1/TEST/action/compile?flags=cuk&source=0', auth:'test:fake'};
}

test('single batch compiles exactly requested CSPs with elapsed time', async t => {
  let calls = 0;
  const options = await server(t, (req,res) => {
    calls++;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/atelier/v1/TEST/action/compile?flags=cuk&source=0');
    let body=''; req.on('data',d => body+=d); req.on('end', () => {
      assert.deepEqual(JSON.parse(body), ['web/csp/a.show.csp','web/csp/sub/b.csp']);
      res.end(JSON.stringify(good));
    });
  });
  const result = await compile(options, plan(['/web/csp/a.show.csp','web/csp/sub/b.csp','web/csp/a.show.csp'],'web/csp'));
  assert.equal(result.status,'compiled'); assert.equal(calls,1); assert.ok(result.elapsedMs>=0);
});

test('server and document-level failures are not success', () => {
  assert.equal(validateResponse({...good,status:{errors:['failed']}}).status,'compile-failed');
  assert.equal(validateResponse({...good,result:{content:[{name:'a.csp',status:'ERROR #5001'}]}}).status,'compile-failed');
  assert.throws(() => validateResponse({}));
});

test('timeout makes one request and does not retry', async t => {
  let calls=0;
  const options=await server(t,()=>calls++);
  await assert.rejects(compile(options,plan(['web/csp/a.csp'],'web/csp'),100),/deadline/);
  assert.equal(calls,1);
});

test('redirects and malformed responses fail without following or retrying', async t => {
  for (const [status,body] of [[302,''],[200,'not-json'],[500,'error']]) {
    let calls=0;
    const options=await server(t,(_,res)=>{calls++;res.statusCode=status;res.setHeader('Location','http://127.0.0.1/elsewhere');res.end(body);});
    await assert.rejects(compile(options,plan(['web/csp/a.csp'],'web/csp')));
    assert.equal(calls,1);
  }
});

test('rejects physical paths, traversal, encoded paths and non-CSP targets', () => {
  for (const target of ['/physical/csp/a.csp','web/csp/../a.csp','web/csp/%2e/a.csp','web/csp/a.js','web\\csp\\a.csp']) {
    assert.throws(()=>plan([target],'web/csp'));
  }
  assert.throws(()=>plan([],'web/csp'));
});

test('connection uses MCP facts and explicit TLS setting, rejects namespace conflict', () => {
  const config={iris:{namespace:'TEST'},mcp:{serverName:'iris'}};
  const mcp={mcpServers:{iris:{env:{IRIS_HOST:'example.invalid',IRIS_SCHEME:'https',IRIS_WEB_PORT:'443',IRIS_USERNAME:'test',IRIS_PASSWORD:'fake',IRIS_NAMESPACE:'TEST',IRIS_TLS_VERIFY:'false'}}}};
  assert.equal(connection(config,mcp).rejectUnauthorized,false);
  delete mcp.mcpServers.iris.env.IRIS_TLS_VERIFY;
  assert.equal(connection(config,mcp).rejectUnauthorized,true);
  config.iris.namespace='OTHER'; assert.throws(()=>connection(config,mcp),/Namespace/);
});

test('CLI defaults to local plan without MCP config or remote connection', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'csp-plan-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.agents/config'),{recursive:true});
  fs.writeFileSync(path.join(root,'.agents/config/project-env.json'),JSON.stringify({web:{cspBasePath:'web/csp'}}));
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../compile-csp.js'),'--project-root',root,'--documents','web/csp/a.show.csp'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).status,'planned');
  assert.equal(fs.existsSync(path.join(root,'.mcp.json')),false);
});
