'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Resolve lazily: deploy-guard also uses this parser for its upload gate.
const stop = (reason, details) => require('./deploy-guard').stop(reason, details);

// Storage is XML inside a UDL member. Braces in XML values, comments and CDATA
// are data, not member delimiters. Unknown/truncated forms stop before backfill.
function xmlEnd(source, start) {
  const stack = [];
  let i = start;
  while (i < source.length) {
    if (!stack.length && source[i] === '}') return i + 1;
    if (source.startsWith('<!--', i) || source.startsWith('<![CDATA[', i)) {
      const comment = source.startsWith('<!--', i), end = source.indexOf(comment ? '-->' : ']]>', i);
      if (end < 0) break;
      i = end + 3;
    } else if (source[i] === '<') {
      const startTag = i++;
      let quote = null;
      for (; i < source.length; i++) {
        const c = source[i];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      if (i === source.length) break;
      const tag = source.slice(startTag, ++i);
      const match = /^<(\/?)([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?\s*(\/?)>$/.exec(tag);
      if (!match) break;
      if (match[1]) { if (match[3] || stack.pop() !== match[2]) break; }
      else if (!/\/>$/.test(tag)) stack.push(match[2]);
    } else {
      if (!stack.length && !/\s/.test(source[i])) break;
      i++;
    }
  }
  stop('storage-format-unknown');
}

function inspect(source) {
  const blocks = [];
  let depth = 0, blockComment = false, quote = false, close = -1;
  const fragment = /^\s*Storage\b/i.test(source);
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (c === '"') { if (next === '"') i++; else quote = false; } continue; }
    if (c === '"') { quote = true; continue; }
    if ((c === '/' && next === '/') || c === ';' && depth > 1) { const end = source.indexOf('\n', i); if (end < 0) break; i = end; continue; }
    if (c === '/' && next === '*') { blockComment = true; i++; continue; }
    if ((depth === 1 || fragment && depth === 0) && /[SX]/i.test(c) &&
        /^[ \t\uFEFF]*$/.test(source.slice(source.lastIndexOf('\n', i - 1) + 1, i))) {
      const member = /^(Storage|XData)\s+([%\w.]+)\s*(?:\[[^\]\r\n]*\]\s*)?\{/i.exec(source.slice(i));
      if (member) {
        const end = xmlEnd(source, i + member[0].length);
        if (member[1].toLowerCase() === 'storage') blocks.push({name: member[2], start: i, end, content: source.slice(i, end)});
        i = end - 1;
        continue;
      }
      if (/^Storage\b/i.test(source.slice(i))) stop('storage-format-unknown');
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) close = i; if (depth < 0) stop('storage-format-unknown'); }
  }
  if (depth || quote || blockComment || new Set(blocks.map(b => b.name)).size !== blocks.length) stop('storage-format-unknown');
  return {blocks, close};
}

function storage(source) {
  if (!/^[ \t]*Storage\b/im.test(source || '')) return '';
  return inspect(source || '').blocks.map(b => b.content).join('\n');
}

function body(source, parsed) {
  for (const b of [...parsed.blocks].reverse()) source = source.slice(0, b.start) + source.slice(b.end);
  // The compiler may add blank separators before its trailing Storage members.
  // Only that class-tail whitespace is ignored; methods/comments stay exact.
  return source.replace(/(?:\n[ \t]*)+(?=\}[ \t]*(?:\n)?$)/, '\n');
}

function backfill(source, compiled) {
  const local = inspect(source), remote = inspect(compiled);
  if (local.close < 0 || remote.close < 0) stop('storage-format-unknown');
  const byName = new Map(remote.blocks.map(b => [b.name, b.content]));
  if (local.blocks.some(b => !byName.has(b.name))) stop('post-compile-storage-removed');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const render = s => s.replace(/\r\n/g, '\n').replace(/\n/g, newline);
  const extra = remote.blocks.filter(b => !local.blocks.some(l => l.name === b.name));
  if (JSON.stringify([...local.blocks, ...extra].map(b => b.name)) !== JSON.stringify(remote.blocks.map(b => b.name))) stop('post-compile-storage-reordered');
  if (extra.length) {
    const prefix = source.slice(0, local.close);
    source = prefix + (prefix.endsWith('\n') ? '' : newline) + extra.map(b => render(b.content)).join(newline + newline) + newline + source.slice(local.close);
  }
  for (const b of [...local.blocks].reverse()) source = source.slice(0, b.start) + render(byName.get(b.name)) + source.slice(b.end);
  return Buffer.from(source);
}

async function reconcile(files, adapter, {onFile = () => {}, beforeWrite = () => {}, onSynced = () => {}} = {}) {
  const guard = require('./deploy-guard'), plans = [];
  // Read/check the whole batch before changing any local file.
  for (const file of files) {
    onFile(file);
    const compiledBytes = await adapter.read(file), compiled = guard.text(compiledBytes);
    if (compiled === null) stop('post-compile-source-missing', {file: file.remotePath});
    const plan = {file, compiled, compiledBytes, bytes: file.source, synced: false};
    if (!/\.(cls|mac|inc)$/i.test(file.remotePath) && guard.hash(compiledBytes) !== guard.hash(file.bytes)) stop('post-compile-source-changed', {file: file.remotePath});
    if (/\.cls$/i.test(file.remotePath)) {
      if (file.content === compiled && storage(guard.text(file.source)) === storage(compiled)) { plans.push(plan); continue; }
      const uploaded = inspect(file.content), remote = inspect(compiled);
      if (body(file.content, uploaded) !== body(compiled, remote)) stop('post-compile-source-changed', {file: file.remotePath});
      if (uploaded.blocks.some(b => !remote.blocks.some(r => r.name === b.name))) stop('post-compile-storage-removed', {file: file.remotePath});
      const knownNames = new Set(uploaded.blocks.map(b => b.name));
      if (JSON.stringify(remote.blocks.filter(b => knownNames.has(b.name)).map(b => b.name)) !== JSON.stringify(uploaded.blocks.map(b => b.name))) stop('post-compile-storage-reordered', {file: file.remotePath});
      if (storage(guard.text(file.source)) !== storage(compiled)) {
        plan.bytes = backfill(file.source.toString('utf8'), compiled);
        plan.synced = !plan.bytes.equals(file.source);
        if (plan.synced && file.immutablePath) stop('frozen-storage-sync-requires-source-review', {file: file.remotePath, sourcePath: file.localPath, snapshotReadOnly: true, storageBackfillRequired: true});
      }
    } else if (compiled !== file.content) stop('post-compile-source-changed', {file: file.remotePath});
    plans.push(plan);
  }
  for (const plan of plans.filter(p => p.synced)) {
    onFile(plan.file);
    if (guard.text(await adapter.read(plan.file)) !== plan.compiled) stop('post-compile-source-changed', {file: plan.file.remotePath});
  }
  for (const plan of plans) {
    onFile(plan.file);
    if (!guard.readSource(plan.file).equals(plan.file.source)) stop('local-changed-during-deploy', {file: plan.file.remotePath});
  }
  beforeWrite(plans);
  for (const plan of plans) {
    const file = plan.file;
    onFile(file);
    if (!plan.synced) continue;
    const temporary = path.join(path.dirname(file.localPath), '.' + path.basename(file.localPath) + '.' + crypto.randomUUID() + '.tmp');
    let created = false;
    try {
      const descriptor = fs.openSync(temporary, 'wx', fs.statSync(file.localPath).mode & 0o777);
      created = true;
      try { fs.writeFileSync(descriptor, plan.bytes); } finally { fs.closeSync(descriptor); }
      // Last comparison immediately before replacement; no asynchronous work here.
      if (!fs.readFileSync(file.localPath).equals(file.source)) stop('local-changed-during-deploy', {file: file.remotePath});
      fs.renameSync(temporary, file.localPath);
      if (!fs.readFileSync(file.localPath).equals(plan.bytes)) stop('storage-sync-readback-mismatch', {file: file.remotePath});
      onSynced(plan);
    } catch (error) {
      if (error.reason) throw error;
      stop('local-storage-sync-failed', {file: file.remotePath, code: error.code || 'local-write-failed'});
    } finally {
      if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return plans;
}

module.exports = {storage, inspect, body, backfill, reconcile};
