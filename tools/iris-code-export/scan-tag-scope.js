'use strict';

// Maintainer-only, local source inspection. Never runs code from the tag.
const fs = require('node:fs');
const path = require('node:path');
const {SaxesParser} = require('../../vendor/xml-parser/saxes/saxes');
const {normalizeDocument} = require('../../plugins/coding-iris-plugin/scripts/iris-tools/xml-package-core');
const {parseScopeList} = require('../../plugins/coding-iris-plugin/scripts/iris-tools/scope-list');
const areas = ['cls', 'table', 'rountines', 'int', 'csp', 'js', 'css', 'library', 'scripts_lib'];
const excluded = /^(?:\.svn|\.git|node_modules|CUSTOM|backup|bak|demo|demos|example|examples|test|tests|doc|docs)$/i;
const webExtension = /\.(?:csp|csr|js|css|html|htm)$/i;
function scan(root) {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('linked-tag-root');
  const found = new Map(), deferred = [], references = new Set(), report = {files: 0, xmlFiles: 0, xmlObjects: 0, legacyDecoded: 0, applications: {}, unresolved: [], excluded: [], caseVariants: []};
  function add(document, source, evidence) {
    try {
      const n = normalizeDocument(document);
      const normalized = (n.type === 'CSP' ? '/' : '') + n.document;
      parseScopeList(normalized);
      if (!found.has(normalized)) found.set(normalized, []);
      found.get(normalized).push({source, evidence});
    } catch (e) { report.unresolved.push({source, document, reason: e.message}); }
  }
  function read(file) {
    const bytes = fs.readFileSync(file);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', {fatal: true}).decode(bytes);
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
    catch { report.legacyDecoded++; return new TextDecoder('gb18030', {fatal: true}).decode(bytes); }
  }
  function walk(dir, area) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a,b) => a.name < b.name ? -1 : 1)) {
      const file = path.join(dir, entry.name), source = path.relative(root, file).replace(/\\/g, '/');
      if (entry.isSymbolicLink() || (entry.isDirectory() && excluded.test(entry.name))) { report.excluded.push(source); continue; }
      if (entry.isDirectory()) { walk(file, area); continue; }
      if (!entry.isFile()) continue;
      if (/备份|弃用|副本|参考|更新前|(?:^|[._-])bak(?:[._-]|$)/i.test(source)) { report.excluded.push(source); continue; }
      const base = entry.name.replace(/\.txt$/i, ''), ext = path.extname(base).toLowerCase();
      if (!/\.(?:xml|txt|cls|mac|inc|int|csp|csr|js|css|html|htm)$/i.test(entry.name)) continue;
      if (/^(?:demo|example|test)(?:[.\-_]|$)/i.test(base)) { report.excluded.push(source); continue; }
      report.files++;
      let text;
      try { text = read(file); } catch(e) { report.unresolved.push({source, reason:'encoding-unreadable'}); continue; }
      for (const match of text.matchAll(/(?:\.\.\/|\/(?:imedical|dthealth)\/web\/)((?:csp|scripts|css|library|scripts_lib)\/[A-Za-z0-9_./@()-]+\.(?:csp|csr|js|css|html|htm))(?=[?"'\s<>]|$)/gi)) references.add('/imedical/web/' + match[1]);
      if (/^\s*(?:<\?xml[^>]*>\s*)?<Export\b/.test(text)) {
        report.xmlFiles++;
        const nodes = []; let depth = 0;
        const parser = new SaxesParser();
        parser.on('error', e => { throw e; });
        parser.on('doctype', () => { throw Error('DTD-forbidden'); });
        parser.on('opentag', n => { depth++; if (depth === 2 && ['Class','Routine','CSP','CSPBase64'].includes(n.name)) nodes.push({tag:n.name,...n.attributes}); });
        parser.on('closetag', () => depth--);
        try { parser.write(text).close(); }
        catch(e) { report.unresolved.push({source,reason:'invalid-source-xml'}); continue; }
        for (const n of nodes) {
          report.xmlObjects++;
          if (n.tag === 'Class') add(n.name + '.cls', source, 'xml-declaration');
          else if (n.tag === 'Routine') {
            if (!/^(MAC|INC|INT)$/i.test(n.type || '')) report.unresolved.push({source,reason:'routine-type-unknown'});
            else add(n.name + '.' + n.type.toLowerCase(), source, 'xml-declaration');
          } else if (webExtension.test(n.name || '')) {
            const app = n.application || ''; report.applications[app] = (report.applications[app] || 0) + 1;
            // Canonical tool scope uses /imedical/web; keep the original application in the audit.
            if (!['/dthealth/web/', '/imedical/web/', ''].includes(app)) { report.unresolved.push({source,reason:'web-application-unmapped',application:app}); continue; }
            const name = n.name.replace(/^\//, '').replace(/^(?:imedical|dthealth)\/web\//, '');
            add('/imedical/web/' + name, source, 'xml-web-name');
          }
        }
        continue;
      }
      const cls = text.match(/^\s*Class\s+([%\w.]+)\b/m);
      if (['cls','table'].includes(area) && cls) { add(cls[1] + '.cls', source, 'class-declaration'); continue; }
      if (['int','rountines'].includes(area)) {
        const header = text.match(/^\s*ROUTINE\s+([%\w.]+)(?:\s+\[([^\]]*)\])?/im);
        const comment = /^[%A-Za-z][%A-Za-z0-9]*$/.test(base) ? text.slice(0,1200).match(new RegExp('\\b' + base + '\\.(mac|inc|int)\\b', 'i')) : null;
        const typedFile = ['.mac','.inc','.int'].includes(ext);
        const type = typedFile ? ext : header?.[2]?.match(/Type\s*=\s*(MAC|INC|INT)/i)?.[1]?.toLowerCase() || comment?.[1]?.toLowerCase();
        const name = header?.[1] || (typedFile ? base.slice(0,-4) : comment ? base : null);
        if (name && type) add(name + (type.startsWith('.') ? type : '.' + type), source, header ? 'routine-declaration' : typedFile ? 'typed-routine-filename' : 'routine-header-identity');
        else report.unresolved.push({source,reason:'routine-name-or-type-unknown'});
        continue;
      }
      if (['csp','js','css','library','scripts_lib'].includes(area) && webExtension.test(base)) {
        const relative = path.relative(path.join(root,area),file).replace(/\\/g,'/').replace(/\.txt$/i,'');
        if (/[^\x20-\x7e]/.test(relative)) deferred.push({source, base, area, relative});
        else add('/imedical/web/' + (area === 'js' ? 'scripts' : area) + '/' + relative, source, 'web-directory-layout');
      } else if (['cls','table'].includes(area)) report.unresolved.push({source,reason:'no-source-declaration'});
    }
  }
  for (const area of areas) { const dir = path.join(root, area); if (fs.existsSync(dir)) { if(fs.lstatSync(dir).isSymbolicLink()) throw Error('linked-tag-area'); walk(dir, area); } }
  for (const item of deferred) {
    const candidates = [...new Set([...found.keys(), ...references])].filter(d => d.startsWith('/') && path.posix.basename(d).toLowerCase() === item.base.toLowerCase());
    if (new Set(candidates.map(d=>d.toLowerCase())).size === 1) add(candidates[0], item.source, 'web-declaration-or-static-reference');
    else report.unresolved.push({source:item.source,reason:'organizational-folder-not-a-web-path',candidates});
  }
  return {found, report};
}
module.exports = {scan};
