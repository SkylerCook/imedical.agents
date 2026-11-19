// Local workbench: fixed read sources and explicit personal-configuration writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../../..');
const manuals = new Map(
  fs.readdirSync(path.join(repo, 'docs/guides'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => [entry.name, 'docs/guides/' + entry.name]),
);
manuals.set('update-agents.md', 'docs/update-agents.md');
manuals.set('workspace-overlay.md', 'docs/workspace-overlay.md');
const manualIndex = JSON.stringify([...manuals].map(([file, source]) => ({
  file,
  source,
  title: fs.readFileSync(path.join(repo, source), 'utf8').match(/^#\s+(.+)$/m)?.[1] || file,
})));
const reactDist = path.resolve(__dirname, '../react/dist');
const reactEntry = path.join(reactDist, 'index.html');
const entryPaths = new Set(['/', '/index.html', '/actual.html', '/react', '/react/']);

function reactAsset(pathname) {
 if (entryPaths.has(pathname)) return reactEntry;
 if (pathname === '/react/workbench-mark.svg' || pathname === '/favicon.ico') return path.join(reactDist, 'workbench-mark.svg');
 if (pathname === '/react/workbench-overview.webp') return path.join(reactDist, 'workbench-overview.webp');
 if (/^\/react\/assets\/[\w-]+\.(js|css|woff2)$/.test(pathname)) return path.join(reactDist, pathname.slice('/react/'.length));
 return null;
}
const {generate}=require(path.join(repo,'scripts/generate-plugin-catalog.js'));
const projectArg=process.argv.indexOf('--project');
const projectRoot=projectArg>=0?path.resolve(process.argv[projectArg+1]):null;
const inspect=require('./inspect-project.js');
const framework = require('../src/framework-service.js').createFrameworkService(projectRoot);
const settings=require('./personal-settings.js').createSettings();
const projectSettings=require('./project-settings.js').createProjectSettings(projectRoot);
const knowledgeSearch = require('../src/knowledge-search.js').createKnowledgeSearch(projectRoot);
const projectPlans=new Set();
let port=Number(process.env.PORT||4179);

function isWorkbenchRequest(req) {
 const origin = `http://127.0.0.1:${port}`;
 return req.headers.host === `127.0.0.1:${port}` && req.headers['x-workbench-request'] === '1' &&
  (!req.headers.origin || req.headers.origin === origin) && !['cross-site', 'none'].includes(req.headers['sec-fetch-site']);
}

async function handleKnowledgeQuery(req, res) {
 const reply = (status, data) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
 };
 if (!isWorkbenchRequest(req)) return reply(403, {error:'请求来源不受信任'});
 if (!projectRoot) return reply(403, {error:'需要先绑定工程'});
 if (req.method !== 'POST' || req.headers.origin !== `http://127.0.0.1:${port}` || req.headers['content-type'] !== 'application/json') {
  return reply(403, {error:'不允许的请求'});
 }
 try {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
   length += chunk.length;
   if (length > 4096) return reply(413, {error:'搜索请求过大'});
   chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return reply(400, {error:'搜索请求格式无效'}); }
  return reply(200, await knowledgeSearch.query(body));
 } catch (error) {
  if (error.name === 'KnowledgeSearchError') return reply(400, {error:error.message});
  return reply(409, {error:'无法检索本地知识，请检查工程的知识资料后重试。'});
 }
}

const server = http.createServer(async(req,res)=>{const u=new URL(req.url,'http://127.0.0.1');const name=u.pathname.slice(1);let file;
if (name === 'framework.json' || name.startsWith('framework/')) return framework.handle(req,res,name,'http://127.0.0.1:' + port).catch(() => res.destroy());
if (u.pathname === '/knowledge/query') return handleKnowledgeQuery(req, res).catch(() => res.destroy());
if(u.pathname.startsWith('/settings/')){
 const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
 if(!isWorkbenchRequest(req))return reply(403,{error:'请求来源不受信任'});
 if(!projectRoot)return reply(403,{error:'需要先绑定工程'});
 try{if(req.method==='GET'){return reply(200,u.pathname==='/settings/project'?projectSettings.inspect():settings.inspect(u.pathname.split('/')[2]))}if(req.method!=='POST'||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json')return reply(403,{error:'不允许的请求'});let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>32768)return reply(413,{error:'请求过大'})}const data=JSON.parse(body);if(u.pathname==='/settings/apply'){const isProject=projectPlans.delete(data.planId);return reply(200,isProject?await projectSettings.apply(data.planId):settings.apply(data.planId));}if(u.pathname==='/settings/plan/project'){const p=projectSettings.plan(data);projectPlans.add(p.planId);return reply(200,p);}if(u.pathname.startsWith('/settings/plan/'))return reply(200,settings.plan(u.pathname.split('/')[3],data));return reply(404,{error:'未知操作'})}catch(e){return reply(409,{error:e.name==='SettingsError'?e.message:'配置读取或保存失败；原始诊断未回显以保护凭据'})}
}
if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}
if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end()}
if(name==='project.json'){
 let summary;
 try {summary=projectRoot?inspect(projectRoot):{error:'启动时尚未绑定工程'};}
 catch {res.writeHead(409,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({error:'工程配置读取失败，请检查 project.jsonc 和旧插件状态来源是否冲突。'}));}
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify(summary));
}
if(name==='manuals.json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(req.method==='HEAD' ? undefined : manualIndex)}
if(name==='catalog.json'){try{const c=generate(repo);const out={basePlugins:c.basePlugins,groups:c.groups,plugins:c.plugins.map(({directory,manifest:m})=>({directory,name:m.name,version:m.version,displayName:m.displayName,description:m.description,dependencies:m.dependencies||[],dependencyVersions:m.dependencyVersions||{},initSkill:m.initSkill||null})),unavailable:fs.readdirSync(path.join(repo,'plugins'),{withFileTypes:true}).filter(d=>d.isDirectory()&&!c.plugins.some(p=>p.directory===d.name)).map(d=>d.name)};res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(out))}catch(e){res.writeHead(503);return res.end(JSON.stringify({error:'catalog-unavailable'}))}}
file = reactAsset(u.pathname);
if (!file && name.startsWith('manual/')) {
 let requested;
 try { requested = decodeURIComponent(name.slice(7)); } catch { requested = ''; }
 const source = manuals.get(requested);
 if (source) file = path.join(repo, source);
}
if (!file) {res.writeHead(404);return res.end('Not found')}
fs.readFile(file,(err,data)=>{
 if (err) {
  res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
  return res.end(file === reactEntry ? '工作台尚未构建。请在 tools/agents-workbench/react 执行 npm run build。' : 'Not found');
 }
 const mime = {'.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.md':'text/plain', '.svg':'image/svg+xml', '.webp':'image/webp'};
 const font = path.extname(file) === '.woff2';
 res.writeHead(200,{
  'Content-Type': font ? 'font/woff2' : (mime[path.extname(file)] || 'text/html') + '; charset=utf-8',
  'Cache-Control': font ? 'public, max-age=31536000, immutable' : 'no-store',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
 });
 const demo = u.pathname === '/index.html' || (!projectRoot && u.pathname !== '/actual.html');
 const payload = file === reactEntry && demo
  ? data.toString('utf8').replace('<meta name="workbench-mode" content="project">', '<meta name="workbench-mode" content="demo">')
  : data;
 res.end(req.method==='HEAD'?undefined:payload);
});
}).listen(port, '127.0.0.1', () => {
 port = server.address().port;
 const address = `http://127.0.0.1:${port}/${projectRoot ? '#home' : '#/clinic/home'}`;
 if (process.send) process.send({address,bootstrap:framework.bootstrap});
 console.log(`Workbench: ${address}`);
 if (process.platform !== 'win32' || !process.argv.includes('--open')) return;
 require('../src/release-launcher').openBrowser(projectRoot ? address.split('#')[0] + '#bootstrap=' + framework.bootstrap : address);
});
if (process.env.WORKBENCH_STARTUP_PARENT === '1' && process.connected) process.once('disconnect', () => process.exit(0));
server.on('error', error => {
 if (error.code !== 'EADDRINUSE') throw error;
 console.error(`Workbench port ${port} is in use. Free that port or restart with PORT=0.`);
 process.exitCode = 1;
});
