'use strict';
// Maintainer-only importer. Documents are data, never executable skill definitions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const roots = ['.qoder/repowiki', '.agents/data', '.agents/docs'];
function sanitize(source, {menuData = false} = {}) {
  let changes = 0;
  const replace = (pattern, value) => { source = source.replace(pattern, (...args) => {const next = typeof value === 'function' ? value(...args) : value; if(next!==args[0])changes++; return next;}); };
  replace(/https?:\/\/[^\s<>"'`\)\]]+/gi, value => {
    try {
      const u = new URL(value);
      if (/^(?:docs\.)?(?:intersystems\.com|qoder\.com|qoder\.cn)$|^(?:www\.)?(?:github\.com|gitee\.com|developer\.mozilla\.org|jquery\.com|jeasyui\.com|w3\.org)$/i.test(u.hostname) && !u.username && !u.password && !u.search) return value;
    } catch {}
    return '<external-url>';
  });
  replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<host>');
  replace(/\b[A-Za-z]:[\\/][^\s"'`<>\)\]]+/g, '<local-path>');
  replace(/\/(?:dthealth|home|Users|opt|srv|var\/www|usr\/iris)[^\s"'`<>\)\]]*/g, '<remote-path>');
  replace(/\bDHC-APP\b/g, '<namespace>');
  replace(/\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b/g, '<personal-id>');
  replace(/([?&](?:token|MWToken|CSPCHD|password|secret|api_key)=)[^&\s"'|<>\)]+/gi, (match, prefix) => `${prefix}<credential>`);
  source = source.split('\n').map(line => {
    // Redact credential-bearing examples, including Markdown table rows, without recording the value.
    if (!menuData && (/(?:password|passwd|secret|api[_-]?key|access[_-]?token|token|authorization|cookie|username|iris_user|iris_host|密码|登录账号|登录帐号|测试账号|测试帐号|用户名|namespace|命名空间)\s*["'`]*\s*[:=：|]/i.test(line) || /--(?:password|passwd|token|username|namespace)\s+[^\s]/i.test(line))) {
      changes++; return '[REDACTED: environment-specific example]';
    }
    return line;
  }).join('\n');
  return {text:source,changes};
}
function walk(root) {
  return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item => {
    const file = path.join(root,item.name);
    if (item.isSymbolicLink()) throw new Error('Source links are not accepted');
    return item.isDirectory() ? walk(file) : [file];
  });
}
function run(sourceRoot, target) {
  if (fs.existsSync(target)) throw new Error('Import target already exists; review an update in a separate staging directory');
  const commit = execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const records=[], omitted=[];
  const files = roots.flatMap(root => walk(path.join(sourceRoot,root)));
  const mapping = new Map(files.filter(file => /\.(md|yaml|yml)$/i.test(file)).map(file => {
    const relative = path.relative(sourceRoot,file).split(path.sep).join('/');
    const category = relative.startsWith('.qoder/') ? 'wiki' : relative.startsWith('.agents/data/') ? 'menus' : 'docs';
    return [relative,`sources/${category}/${sha(relative).slice(0,16)}${path.extname(file)}`];
  }));
  for (const file of files) {
    const relative = path.relative(sourceRoot,file).split(path.sep).join('/');
    const raw = fs.readFileSync(file);
    if (!/\.(md|yaml|yml)$/i.test(file)) {omitted.push({path:relative,sha256:sha(raw),reason:'generator cache or non-document metadata'});continue;}
    const original = new TextDecoder('utf-8',{fatal:true}).decode(raw);
    const menuData = relative.startsWith('.agents/data/');
    const result = sanitize(original, {menuData});
    const destination=mapping.get(relative);let rewrittenLinks=0;
    result.text=result.text.replace(/\]\((<?)([^\n)]+?)(>?)\)/g,(whole,left,href) => {
      if(/^[a-z]+:/i.test(href)||href.startsWith('#'))return whole;
      const [link,fragment]=href.split('#');let decoded;try{decoded=decodeURIComponent(link);}catch{return whole;}
      const original=path.posix.normalize(path.posix.join(path.posix.dirname(relative),decoded));
      if(!mapping.has(original))return whole;
      rewrittenLinks++;const next=path.posix.relative(path.posix.dirname(destination),mapping.get(original));
      return `](<${next}${fragment?'#'+fragment:''}>)`;
    });
    const out = path.join(target,destination); fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,result.text);
    const sourceRows=menuData?original.split('\n').filter(line=>line.startsWith('|')).length:undefined;
    if(menuData && sourceRows!==result.text.split('\n').filter(line=>line.startsWith('|')).length)throw new Error('Menu row loss during sanitization');
    records.push({path:destination,sourcePath:relative,sourceSha256:sha(raw),sha256:sha(result.text),redactions:result.changes,rewrittenLinks,...(menuData?{sourceRows}:{})});
  }
  const manifest={schema:'imedical-knowledge-source/v1',repository:'https://gitee.com/wangqingyongyl/iris-imedical',commit,
    importedAt:new Date().toISOString(),license:'No LICENSE file found in the inspected source tree; no new license is granted by this import.',
    status:'reference-only-unverified',files:records,omitted};
  fs.writeFileSync(path.join(target,'sources.json'),JSON.stringify(manifest,null,2)+'\n');
  fs.writeFileSync(path.join(target,'.gitattributes'),'sources/** -text whitespace=cr-at-eol,-blank-at-eol,-blank-at-eof,-space-before-tab\n');
  fs.writeFileSync(path.join(target,'index.md'),'# iMedical reference index\n\n资料仅供检索，内容可能过时；具体项目规则和当前源码优先。\n\n'+records.map(r=>`- [${r.sourcePath}](<${r.path}>)`).join('\n')+'\n');
  return {files:records.length,omitted:omitted.length,commit};
}
module.exports={sanitize,run};
if(require.main===module){try{if(process.argv.length!==4)throw new Error('Usage: import-imedical-knowledge.js <source-checkout> <new-target>');console.log(JSON.stringify(run(path.resolve(process.argv[2]),path.resolve(process.argv[3]))));}catch(e){console.error(e.message);process.exitCode=1;}}
