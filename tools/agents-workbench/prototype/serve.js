// Local workbench: fixed read sources and explicit personal-configuration writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const manuals=path.resolve(__dirname,'../../../docs/guides');
const allowed=new Set(fs.readdirSync(manuals,{withFileTypes:true}).filter(d=>d.isFile()&&d.name.endsWith('.md')).map(d=>d.name));
const assets=new Set(['index.html','style.css','app.js','mock.js','scope.js','config-page.js','refinement.css','actual.html','actual.js','workbench.css','workbench.js']);
const repo=path.resolve(__dirname,'../../..');
const {generate}=require(path.join(repo,'scripts/generate-plugin-catalog.js'));
const projectArg=process.argv.indexOf('--project');
const projectRoot=projectArg>=0?path.resolve(process.argv[projectArg+1]):null;
const inspect=require('./inspect-project.js');
const settings=require('./personal-settings.js').createSettings();
const projectSettings=require('./project-settings.js').createProjectSettings(projectRoot);
const projectPlans=new Set();
const port=Number(process.env.PORT||4179);
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://127.0.0.1');let name=u.pathname==='/'?(projectRoot?'actual.html':'index.html'):u.pathname.slice(1),file;
if(u.pathname.startsWith('/settings/')){
 const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
 if(req.headers.host!==`127.0.0.1:${port}`||req.headers['x-workbench-request']!=='1'||(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)||['cross-site','none'].includes(req.headers['sec-fetch-site']))return reply(403,{error:'请求来源不受信任'});
 if(!projectRoot)return reply(403,{error:'需要先绑定工程'});
 try{if(req.method==='GET'){return reply(200,u.pathname==='/settings/project'?projectSettings.inspect():settings.inspect(u.pathname.split('/')[2]))}if(req.method!=='POST'||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json')return reply(403,{error:'不允许的请求'});let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>32768)return reply(413,{error:'请求过大'})}const data=JSON.parse(body);if(u.pathname==='/settings/apply'){const isProject=projectPlans.delete(data.planId);return reply(200,isProject?await projectSettings.apply(data.planId):settings.apply(data.planId));}if(u.pathname==='/settings/plan/project'){const p=projectSettings.plan(data);projectPlans.add(p.planId);return reply(200,p);}if(u.pathname.startsWith('/settings/plan/'))return reply(200,settings.plan(u.pathname.split('/')[3],data));return reply(404,{error:'未知操作'})}catch(e){return reply(409,{error:e.name==='SettingsError'?e.message:'配置读取或保存失败；原始诊断未回显以保护凭据'})}
}
if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}
if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end()}
if(name==='project.json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify(projectRoot?inspect(projectRoot):{error:'启动时尚未绑定工程'}))}
if(name==='manuals.json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify([...allowed].map(file=>({file,title:fs.readFileSync(path.join(manuals,file),'utf8').match(/^#\s+(.+)$/m)?.[1]||file}))))}
if(name==='catalog.json'){try{const c=generate(repo);const out={basePlugins:c.basePlugins,groups:c.groups,plugins:c.plugins.map(({directory,manifest:m})=>({directory,name:m.name,version:m.version,displayName:m.displayName,description:m.description,dependencies:m.dependencies||[],dependencyVersions:m.dependencyVersions||{},initSkill:m.initSkill||null})),unavailable:fs.readdirSync(path.join(repo,'plugins'),{withFileTypes:true}).filter(d=>d.isDirectory()&&!c.plugins.some(p=>p.directory===d.name)).map(d=>d.name)};res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(out))}catch(e){res.writeHead(503);return res.end(JSON.stringify({error:'catalog-unavailable'}))}}
if(name.startsWith('manual/')&&allowed.has(name.slice(7)))file=path.join(manuals,name.slice(7));else if(assets.has(name))file=path.join(__dirname,name);else{res.writeHead(404);return res.end('Not found')}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.md')?'text/plain; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:data)})}).listen(port,'127.0.0.1',()=>console.log(`Prototype: http://127.0.0.1:${port}/actual.html#home`));
