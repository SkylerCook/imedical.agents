#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { resolveWorkspaceContext } = require('./lib/workspace-context');

const route = '- 能力包使用、操作指南或连接配置排查：先读取 [.agents 文档入口](.agents/docs/README.md)，再按问题进入对应指南。';
const overlayRoute = '- 能力包使用、操作指南或连接配置排查：先按 `.agents/capability.json` 解析 `CapabilityRoot`，读取其 `docs/README.md`，再按问题进入对应指南。';

// Only count live prose, never a commented route or a fenced example.
function activeText(text) {
  let fence = null;
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/).filter(line => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
      return false;
    }
    return !fence;
  }).join('\n');
}

const feedback = '- 项目 `.agents/` 中由上游框架维护的文件，非必要请勿修改。使用问题可请 agent-framework-feedback 整理后反馈给上游，也可直接发邮件至 xingkaile@imedway.com。';

function sync(projectRoot, mode = 'DryRun') {
  if (!['DryRun', 'Check', 'Write'].includes(mode)) throw Error('Invalid mode');
  const context = resolveWorkspaceContext(projectRoot);
  if (!['standard', 'workspace-overlay'].includes(context.mode)) throw Error('Invalid workspace context');
  const file = path.join(context.workspaceRoot, 'AGENTS.md');
  const result = status => ({ status, target: file });
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return result('docs-entry-no-agents');
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw Error('Linked or non-regular AGENTS.md preserved; maintain manually');
  const doc = path.join(context.workspaceRoot, '.agents/docs/README.md');
  const canonicalDoc = path.join(context.capabilityRoot, 'docs/README.md');
  if (!fs.existsSync(canonicalDoc) || !fs.statSync(canonicalDoc).isFile()) throw Error('CapabilityRoot docs/README.md missing; update capability package first');
  const mapped = fs.existsSync(doc) && fs.realpathSync(doc) === fs.realpathSync(canonicalDoc);
  const useOverlayRoute = context.mode === 'workspace-overlay' && !mapped;
  const before = fs.readFileSync(file);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before);
  const active = activeText(text);
  const hasOverlay = active.includes(overlayRoute) && context.mode === 'workspace-overlay';
  const hasDirect = /(?:^|[\s`(<])(?:\.\/)?\.agents[\\/]docs[\\/]README\.md(?=$|[\s`)#>])/.test(active);
  if (hasDirect && !hasOverlay && !mapped) throw Error('Existing documentation route is unreachable; preserve and repair manually');
  const missing = [];
  if (!hasOverlay && !hasDirect) missing.push(useOverlayRoute ? overlayRoute : route);
  const hasFeedback = /非必要.{0,12}(?:勿|不|避免).{0,8}(?:修改|改动)/.test(active)
    && active.includes('.agents/') && active.includes('上游') && active.includes('xingkaile@imedway.com')
    && active.includes('agent-framework-feedback');
  if (!hasFeedback) missing.push(feedback);
  if (!missing.length) return result('docs-entry-ok');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const addition = missing.join(newline);
  if (!missing.every(line => activeText(text + '\n\n' + addition).includes(line))) throw Error('Unclosed Markdown comment or code fence; preserve and repair manually');
  if (mode !== 'Write') return { ...result('docs-entry-missing'), missing };
  const output = Buffer.from(text + (text.endsWith('\n') ? newline : newline + newline) + addition + newline);
  const temp = path.join(path.dirname(file), '.agents-doc-entry-' + randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temp, output, { flag: 'wx', mode: stat.mode });
    const current = fs.lstatSync(file);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.ino !== stat.ino || !fs.readFileSync(file).equals(before)) throw Error('AGENTS.md changed concurrently; retry after review');
    fs.renameSync(temp, file);
    if (!fs.readFileSync(file).equals(output)) throw Error('AGENTS.md read-back mismatch');
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return result('docs-entry-added');
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--project-root' || args[2] !== '--mode') throw Error('Usage: sync-documentation-entry.js --project-root <path> --mode DryRun|Check|Write');
    const result = sync(args[1], args[3]);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (args[3] === 'Check' && result.status === 'docs-entry-missing') process.exitCode = 1;
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { sync, route, overlayRoute, activeText, feedback };
