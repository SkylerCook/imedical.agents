'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {resolveProject,current,noLinks,id,render} = require('./sync-menu');
function search({context,query,sourceId,limit=20}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('A nonempty literal query is required');
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('limit must be 1..100');
  const matches=[], warnings=[], needle=query.toLocaleLowerCase();
  const add = (content,meta) => content.split(/\r?\n/).forEach((line,index) => {
    if (matches.length<limit && line.toLocaleLowerCase().includes(needle)) {
      const offset=line.toLocaleLowerCase().indexOf(needle);
      matches.push({...meta,line:index+1,text:line.slice(Math.max(0,offset-100),offset+400)});
    }
  });
  // A requested project's current menu wins search order, but is not mixed silently with another environment.
  if(sourceId) {
    id(sourceId); const root=path.join(context.contextRoot,'work','menu-sync',sourceId), state=current(root);
    if(!state.snapshot) warnings.push({code:'project-menu-missing',sourceId,message:'No current project menu snapshot; searching shared upstream references only.'});
    else for(const [file,text] of Object.entries(render(state.snapshot))) add(text,{kind:'project-menu',sourceId,
      path:path.join(root,state.generation,file),revision:state.revision});
  }
  const root=path.join(context.capabilityRoot,'vendor','imedical-knowledge');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'sources.json'),'utf8'));
  if(manifest.schema!=='imedical-knowledge-source/v1') throw new Error('Unsupported knowledge source');
  for(const item of manifest.files) {
    if(matches.length>=limit) break;
    if(!item.path.startsWith('sources/') || item.path.split(/[\\/]/).includes('..') || path.isAbsolute(item.path)) throw new Error('Invalid reference path');
    const file=path.join(root,item.path); // CapabilityRoot can itself be a shared checkout.
    noLinks(file);
    const bytes=fs.readFileSync(file);
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256) throw new Error('Reference integrity mismatch; update or review the knowledge import');
    add(bytes.toString('utf8'),{kind:'upstream-reference',path:file,sourcePath:item.sourcePath,commit:manifest.commit,status:manifest.status});
  }
  return {matches,limit,reachedLimit:matches.length===limit,...(warnings.length?{warnings}:{})};
}
async function hybridSearch({context,query,sourceId,...options}) {
  const retrieval = require('../../../../scripts/lib/knowledge-retrieval');
  const projectDocuments = [];
  const warnings = [];
  if (sourceId) {
    id(sourceId);
    const root = path.join(context.contextRoot,'work','menu-sync',sourceId);
    const state = current(root);
    if (!state.snapshot) warnings.push({code:'project-menu-missing',sourceId});
    else for (const [file,content] of Object.entries(render(state.snapshot))) {
      projectDocuments.push({path:['work/menu-sync',sourceId,state.generation,file].join('/'),content,
        hash:state.revision,revision:state.revision,scope:'project',sourceId,kind:'project-menu',domain:'business',evidence:'project-snapshot'});
    }
  }
  const result = await retrieval.search(context,query,{...options,sourceId,projectDocuments});
  result.warnings.push(...warnings);
  while(result.matches.length && JSON.stringify(result).length>result.maxChars){result.matches.pop();result.truncated=true;}
  return result;
}
async function main(argv) {
  if(argv.includes('--help')){console.log('query-knowledge.js --project-root <workspace> --query <text> [--source-id <project-menu-source>] [--limit 20] [--mode literal|hybrid] [--domain business|ui|all] [--theme pure|ihos|common] [--max-chars 12000] [--query-public] [--provider company|openai]; hybrid defaults to limit 6');return;}
  const opts={}; while(argv.length){const key=argv.shift();if(key==='--query-public'&&!opts[key]){opts[key]=true;continue;}if(!['--project-root','--query','--source-id','--limit','--mode','--domain','--theme','--max-chars','--provider'].includes(key)||!argv.length||opts[key])throw new Error('Invalid arguments');opts[key]=argv.shift();}
  if(!opts['--project-root'])throw new Error('Explicit project root required');
  if(opts['--mode'] && !['literal','hybrid'].includes(opts['--mode']))throw new Error('Invalid mode');
  if(opts['--mode']==='hybrid') {
    console.log(JSON.stringify(await hybridSearch({context:resolveProject(opts['--project-root']),query:opts['--query'],sourceId:opts['--source-id'],
      provider:opts['--provider'],domain:opts['--domain']||'business',theme:opts['--theme'],queryPublic:!!opts['--query-public'],
      limit:opts['--limit']===undefined?undefined:Number(opts['--limit']),maxChars:opts['--max-chars']===undefined?undefined:Number(opts['--max-chars'])})));
    return;
  }
  console.log(JSON.stringify(search({context:resolveProject(opts['--project-root']),query:opts['--query'],sourceId:opts['--source-id'],limit:opts['--limit']?Number(opts['--limit']):20}),null,2));
}
module.exports={search,hybridSearch,main};
if(require.main===module){main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});}
