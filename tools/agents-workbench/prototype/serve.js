// Local workbench: fixed read sources and explicit personal-configuration writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../../..');
const {safeFile} = require(path.join(repo, 'scripts/lib/knowledge-sources.js'));
const manualSources = [];
try {
  for (const entry of fs.readdirSync(safeFile(repo, 'docs/guides'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) manualSources.push(`docs/guides/${entry.name}`);
  }
} catch { /* Workbench can still open with missing or invalid guides. */ }
manualSources.push('docs/update-agents.md', 'docs/workspace-overlay.md');
const manuals = new Map();
for (const source of manualSources) {
  try {
    const filePath = safeFile(repo, source);
    if (!fs.lstatSync(filePath).isFile()) continue;
    const body = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const file = path.basename(source);
    const title = /^#[ \t]+([^\r\n]+)/m.exec(body)?.[1] || file;
    manuals.set(file, { file, source, title, body });
  } catch { /* Reject invalid or linked sources. */ }
}
const manualIndex = JSON.stringify([...manuals.values()].map(({ file, source, title }) => ({ file, source, title })));
const searchManuals = require('../src/manual-search').createManualSearch(manuals);
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
const {directoryIdentity}=require('../src/overlay-members');
const settings=require('./personal-settings.js').createSettings();
const projectSettings=require('./project-settings.js').createProjectSettings(projectRoot);
const knowledgeSearch = require('../src/knowledge-search.js').createKnowledgeSearch(projectRoot);
const {annotateDraftFields,createDraftStore}=require('../src/settings-drafts');
const projectPlans=new Set();
const settingsBinding=projectRoot && projectIdentity();
const drafts = settingsBinding && createDraftStore({root:projectRoot, binding:settingsBinding,
 inspect:id=>id==='project'?projectSettings.inspect():settings.inspect(id), sourcePath:settings.sourcePath});
const framework = require('../src/framework-service.js').createFrameworkService(projectRoot,{writeSettings,
 manualSource: file => manuals.get(file)?.source,
 pluginEntry: id => generate(repo).plugins.find(({manifest}) => manifest.name === id), watchPage});
let port=Number(process.env.PORT||4179);

function isWorkbenchRequest(req) {
 const origin = `http://127.0.0.1:${port}`;
 return req.headers.host === `127.0.0.1:${port}` && req.headers['x-workbench-request'] === '1' &&
  (!req.headers.origin || req.headers.origin === origin) && !['cross-site', 'none'].includes(req.headers['sec-fetch-site']);
}

function projectIdentity() {
 try { return JSON.stringify(directoryIdentity(projectRoot)); }
 catch { return null; }
}

async function writeSettings(operation, data, reply) {
 if (!projectRoot) return reply(403,{error:'需要先绑定工程'});
 if (!settingsBinding || projectIdentity() !== settingsBinding) {
  return reply(409,{code:'binding-changed',error:'工程目录身份已改变，请从启动器重新绑定。'});
 }
 const plan = /^plan\/(project|bos|knowledge)$/u.exec(operation);
 const draft = /^draft\/(project|bos|knowledge)$/u.exec(operation);
 if (!plan && !draft && operation !== 'apply') return reply(404,{error:'未知操作'});
 const keys = Object.keys(data).sort().join(',');
 try {
  if (draft) return reply(200,await drafts.handle(draft[1],data));
  if (operation === 'apply') {
   if (keys !== 'planId' || typeof data.planId !== 'string') return reply(400,{error:'配置确认请求无效'});
   const isProject = projectPlans.delete(data.planId);
   return reply(200,isProject ? await projectSettings.apply(data.planId) : settings.apply(data.planId));
  }
  if (keys !== 'changes,revision' || typeof data.revision !== 'string' || !data.changes ||
      typeof data.changes !== 'object' || Array.isArray(data.changes)) return reply(400,{error:'配置预览请求无效'});
  if (plan[1] !== 'project') return reply(200,settings.plan(plan[1],data));
  const preview = projectSettings.plan(data);
  projectPlans.add(preview.planId);
  return reply(200,preview);
 } catch (error) {
  if (error.name === 'DraftError') return reply(error.code === 'invalid-draft' ? 400 : 409,{code:error.code,error:error.message});
  if (error.code === 'project-recovery-required') return reply(409,{code:error.code,error:'请先处理上次保存的回执。'});
  return reply(409,{error:error.name==='SettingsError' ? error.message : '配置读取或保存失败；原始诊断未回显以保护凭据'});
 }
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

const requests = new Map();
const pages = new Set();
let closing = false;
let idle;

function exitWhenIdle(delay) {
 clearTimeout(idle);
 idle = setTimeout(() => { if (!pages.size) shutdown(); }, delay);
}

function watchPage(response) {
 if (closing || response.destroyed) return response.end();
 clearTimeout(idle);
 pages.add(response);
 response.once('close', () => {
  if (pages.delete(response) && !pages.size && !closing) exitWhenIdle(5000);
 });
 response.writeHead(200, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 response.write('connected\n');
}

async function handleRequest(req,res) {
const u=new URL(req.url,'http://127.0.0.1');const name=u.pathname.slice(1);let file;
if (name === 'framework.json' || name.startsWith('framework/')) return framework.handle(req,res,name,'http://127.0.0.1:' + port);
if (u.pathname === '/knowledge/query') return handleKnowledgeQuery(req, res).catch(() => res.destroy());
if (u.pathname === '/manuals/search') {
 const reply = (code, data) => {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
 };
 if (!isWorkbenchRequest(req)) return reply(403, {error:'请求来源不受信任'});
 if (!['GET','HEAD'].includes(req.method)) return reply(405, {error:'不允许的请求'});
 const queries = u.searchParams.getAll('q');
 if (queries.length > 1 || [...u.searchParams.keys()].some(key => key !== 'q')) return reply(400, {error:'手册搜索格式无效'});
 try { return reply(200, searchManuals(queries[0] ?? '')); }
 catch { return reply(400, {error:'请输入 120 字符以内的单行手册搜索词'}); }
}
if(u.pathname.startsWith('/settings/')){
 const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
 if(!isWorkbenchRequest(req))return reply(403,{error:'请求来源不受信任'});
 if(!projectRoot)return reply(403,{error:'需要先绑定工程'});
 if(req.method!=='GET')return reply(405,{error:'不允许的请求'});
 try {
  if (u.pathname === '/settings/project') return reply(200,annotateDraftFields(projectSettings.inspect()));
  if (u.pathname === '/settings/bos' || u.pathname === '/settings/knowledge')
   return reply(200,annotateDraftFields(settings.inspect(name.slice('settings/'.length))));
  return reply(404,{error:'未知操作'});
 }
 catch (error) {
  return reply(409,{error:error.name==='SettingsError' ? error.message : '配置读取或保存失败；原始诊断未回显以保护凭据'});
 }
}
if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}
if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end()}
if(name==='project.json'){
 let summary;
 try {summary=projectRoot?inspect(projectRoot,framework.signRecovery):{error:'启动时尚未绑定工程'};}
 catch {res.writeHead(409,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({error:'工程配置读取失败，请检查 project.jsonc 和旧插件状态来源是否冲突。'}));}
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify(summary));
}
if(name==='manuals.json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(req.method==='HEAD' ? undefined : manualIndex)}
if(name==='catalog.json'){try{const c=generate(repo);const out={basePlugins:c.basePlugins,groups:c.groups,plugins:c.plugins.map(({directory,manifest:m})=>({directory,name:m.name,version:m.version,displayName:m.displayName,description:m.description,dependencies:m.dependencies||[],dependencyVersions:m.dependencyVersions||{},initSkill:m.initSkill||null})),unavailable:fs.readdirSync(path.join(repo,'plugins'),{withFileTypes:true}).filter(d=>d.isDirectory()&&!c.plugins.some(p=>p.directory===d.name)).map(d=>d.name)};res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(out))}catch(e){res.writeHead(503);return res.end(JSON.stringify({error:'catalog-unavailable'}))}}
file = reactAsset(u.pathname);
if (!file && name.startsWith('manual/')) {
 let requested;
 try { requested = decodeURIComponent(name.slice(7)); } catch { requested = ''; }
 const manual = manuals.get(requested);
 if (manual) {
  res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  return res.end(req.method === 'HEAD' ? undefined : manual.body);
 }
}
if (!file) {res.writeHead(404);return res.end('Not found')}
return fs.promises.readFile(file).then(data=>{
 const mime = {'.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.md':'text/plain', '.svg':'image/svg+xml', '.webp':'image/webp'};
 const font = path.extname(file) === '.woff2';
 res.writeHead(200,{
  'Content-Type': font ? 'font/woff2' : (mime[path.extname(file)] || 'text/html') + '; charset=utf-8',
  'Cache-Control': font ? 'public, max-age=31536000, immutable' : 'no-store',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'"
 });
 const demo = u.pathname === '/index.html' || (!projectRoot && u.pathname !== '/actual.html');
 const payload = file === reactEntry && demo
  ? data.toString('utf8').replace('<meta name="workbench-mode" content="project">', '<meta name="workbench-mode" content="demo">')
  : data;
 res.end(req.method==='HEAD'?undefined:payload);
}, () => {
 res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
 res.end(file === reactEntry ? '工作台尚未构建。请在 tools/agents-workbench/react 执行 npm run build。' : 'Not found');
});
}

const server = http.createServer((req,res) => {
 if (closing) {
  res.writeHead(503,{Connection:'close','Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({error:'workbench-shutting-down'}));
  return;
 }
 const pending = handleRequest(req,res).catch(() => res.destroy());
 requests.set(req,pending);
 void pending.finally(() => requests.delete(req));
}).listen(port, '127.0.0.1', () => {
 port = server.address().port;
 const address = `http://127.0.0.1:${port}/${projectRoot ? '#home' : '#/clinic/home'}`;
 if (process.env.WORKBENCH_BACKGROUND === '1') exitWhenIdle(60000);
 if (process.send) process.send({address,bootstrap:framework.bootstrap});
 console.log(`Workbench: ${address}`);
 if (process.platform !== 'win32' || !process.argv.includes('--open')) return;
 require('../src/release-launcher').openBrowser(address.split('#')[0] + '#bootstrap=' + framework.bootstrap);
});

function shutdown() {
 if (closing) return;
 closing = true;
 clearTimeout(idle);
 for (const page of pages) page.end();
 console.log('正在退出工作台，等待当前任务到达安全点。');
 const stopped = framework.shutdown();
 const closed = new Promise(resolve => server.close(resolve));
 for (const req of requests.keys()) if (!req.complete) req.destroy();
 // A browser may disconnect before its admitted owner command finishes.
 void Promise.allSettled([stopped,closed,...requests.values()]).then(() => {
  if (process.connected) process.disconnect();
 });
}

for (const signal of ['SIGINT','SIGTERM',...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) process.on(signal,shutdown);
if (process.env.WORKBENCH_STARTUP_PARENT === '1' && process.connected) process.once('disconnect',shutdown);
server.on('error', error => {
 if (error.code !== 'EADDRINUSE') throw error;
 const message = `Workbench port ${port} is in use. Free that port or restart with PORT=0.`;
 if (process.connected) process.send({startupError:message});
 console.error(message);
 process.exitCode = 1;
});
