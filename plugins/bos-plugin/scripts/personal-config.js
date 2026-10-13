'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
function readPrivate(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('无法读取 BOS 私有 JSON 配置，原文件保留'); }
}
function companyUrl() {
  const value = JSON.parse(fs.readFileSync(path.join(__dirname, '../references/company-defaults.json'), 'utf8')).url;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('公司默认地址必须为不含鉴权参数的 HTTPS 地址');
  return url.href;
}
function windowsBinding(values) {
  const code = values ? "$v=$env:BOS_BINDING_INPUT | ConvertFrom-Json; foreach($p in $v.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value,'User')}; $r=@{}; foreach($k in @('BOS_MCP_CONFIG','BOS_MCP_URL','BOS_MANAGED_MCP_URL')){$r[$k]=[Environment]::GetEnvironmentVariable($k,'User')}; $r | ConvertTo-Json -Compress" : "$r=@{}; foreach($k in @('BOS_MCP_CONFIG','BOS_MCP_URL','BOS_MANAGED_MCP_URL')){$r[$k]=[Environment]::GetEnvironmentVariable($k,'User')}; $r | ConvertTo-Json -Compress";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, encoding: 'utf8', env: { ...process.env, BOS_BINDING_INPUT: JSON.stringify(values || {}) }, timeout: 30000 });
  if (r.status !== 0) throw new Error('无法读写 Windows 用户环境变量；文件保留，修复权限后重试 bos-init');
  return JSON.parse(r.stdout.replace(/^\uFEFF/, ''));
}
function standardPath(env = process.env) {
  if (!env.LOCALAPPDATA || !path.isAbsolute(env.LOCALAPPDATA)) throw new Error('Windows LOCALAPPDATA 不可用；需要明确的仓外配置路径');
  return path.join(env.LOCALAPPDATA, 'imedical-agents', 'bos', 'config.json');
}
function assertHostConfigPath(target) {
  // Package-local paths can appear writable while remaining invisible to desktop apps.
  const isPackageLocal = value => /\/appdata\/local\/packages\/[^/]+\/(?:ac|localcache\/local)(?:\/|$)/i.test(String(value).replace(/\\/g, '/'));
  let existing = path.resolve(target);
  if (isPackageLocal(existing)) throw new Error('BOS 配置路径位于 Windows 应用隔离目录；请在普通宿主 PowerShell 中运行 bos-init，当前环境不能确认桌面可访问');
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('配置父目录不可用');
    existing = parent;
  }
  if (isPackageLocal(fs.realpathSync.native(existing))) throw new Error('BOS 配置路径被重定向到 Windows 应用隔离目录；请在普通宿主 PowerShell 中运行 bos-init，当前环境不能确认桌面可访问');
}
function outsideRepo(target) {
  let parent = path.dirname(target);
  while (!fs.existsSync(parent)) { const next = path.dirname(parent); if (next === parent) throw new Error('配置父目录不可用'); parent = next; }
  for (let current = fs.realpathSync(parent);; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) throw new Error('新个人配置必须放在 Git 仓库之外');
    if (current === path.dirname(current)) break;
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('配置文件不能为链接');
}
function initialize(filePath, { env = process.env, platform = process.platform, binding = windowsBinding, migrateFrom } = {}) {
  if (platform !== 'win32') throw new Error('自动配置仅支持 Windows；其它平台显式配置 BOS_MCP_CONFIG，初始化未写入');
  const saved = binding();
  const target = filePath || (migrateFrom ? standardPath(env) : env.BOS_MCP_CONFIG || saved.BOS_MCP_CONFIG || standardPath(env));
  if (!path.isAbsolute(target)) throw new Error('BOS_MCP_CONFIG 必须是绝对路径');
  assertHostConfigPath(target);
  const existed = fs.existsSync(target);
  if (!existed) outsideRepo(target);
  else if (fs.lstatSync(target).isSymbolicLink()) throw new Error('配置文件不能为链接');
  if (migrateFrom && existed) throw new Error('迁移目标已存在，停止覆盖');
  let value;
  if (migrateFrom) {
    const source = readPrivate(migrateFrom);
    const old = source.mcpServers ? source.mcpServers[env.BOS_MCP_SERVER || 'bos-demand-query'] : source;
    if (!old || old.enabled === false) throw new Error('原配置不可用');
    const url = new URL(old.url);
    const access = url.searchParams.get('access_key'); url.searchParams.delete('access_key');
    if (url.href !== companyUrl() || !access || !old.headers?.['X-Gateway-Upstream-BOS-MCP-TOKEN']) throw new Error('原连接与公司默认不一致，停止自动迁移');
    value = { connection: 'company', access_key: access, headers: old.headers, cuser: old.cuser || 'TODO', cgroup: old.cgroup || 'TODO' };
  } else if (existed) {
    const existing = readPrivate(target);
    const selected = existing.mcpServers ? existing.mcpServers[env.BOS_MCP_SERVER || 'bos-demand-query'] : existing;
    if (!selected || typeof selected !== 'object' || Array.isArray(selected) || selected.enabled === false || (!selected.connection && !selected.url)) throw new Error('已有配置无效，保留文件并停止绑定');
  } else value = { connection: 'company', access_key: 'TODO', headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': 'TODO' }, cuser: 'TODO', cgroup: 'TODO' };
  if (!existed) {
    fs.mkdirSync(path.dirname(target), { recursive: true }); assertHostConfigPath(target); outsideRepo(target);
    fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const current = env.BOS_MCP_URL || saved.BOS_MCP_URL;
  const managed = env.BOS_MANAGED_MCP_URL || saved.BOS_MANAGED_MCP_URL;
  const values = { BOS_MCP_CONFIG: target };
  if (!current || current === managed) Object.assign(values, { BOS_MCP_URL: companyUrl(), BOS_MANAGED_MCP_URL: companyUrl() });
  const result = binding(values);
  for (const [key, value] of Object.entries(values)) {
    if (result[key] !== value) throw new Error('用户环境变量回读不一致；文件保留，请重试');
    env[key] = value;
  }
  return { created: !existed, migrated: !!migrateFrom, configPath: target, bindingVerified: true, companyUrlManaged: !!values.BOS_MANAGED_MCP_URL, fill: value && !migrateFrom ? ['access_key', 'headers.X-Gateway-Upstream-BOS-MCP-TOKEN', 'cuser', 'cgroup'] : [], restartClient: true };
}
module.exports = { initialize, standardPath, companyUrl, windowsBinding };
