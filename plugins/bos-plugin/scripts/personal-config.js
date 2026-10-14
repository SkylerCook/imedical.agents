'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const QUERY_SKILL = 'bos-demand-query', LOG_SKILL = 'bos-code-update-log';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function readPrivate(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('无法读取 BOS 私有 JSON 配置，原文件保留'); }
}
function companyUrl(key = 'url') {
  const value = JSON.parse(fs.readFileSync(path.join(__dirname, '../references/company-defaults.json'), 'utf8'))[key];
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('公司默认地址必须为不含鉴权参数的 HTTPS 地址');
  return url.href;
}
function windowsBinding(values) {
  const code = values ? "$v=$env:BOS_BINDING_INPUT | ConvertFrom-Json; foreach($p in $v.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value,'User')}; @{BOS_MCP_CONFIG=[Environment]::GetEnvironmentVariable('BOS_MCP_CONFIG','User')} | ConvertTo-Json -Compress" : "@{BOS_MCP_CONFIG=[Environment]::GetEnvironmentVariable('BOS_MCP_CONFIG','User')} | ConvertTo-Json -Compress";
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
function readSkillConfig(env, skill) {
  const file = env.BOS_MCP_CONFIG;
  if (typeof file !== 'string' || !file.trim() || !path.isAbsolute(file)) throw new Error('BOS_MCP_CONFIG 必须为仓外私有配置文件的绝对路径');
  const root = readPrivate(file);
  if (!isObject(root)) throw new Error('BOS 私有配置必须为按 skill 分段的对象');
  if (!Object.hasOwn(root, skill)) throw new Error(`缺少 ${skill} 配置段；旧平铺格式不再支持，请显式运行 migrate-config`);
  const selected = root[skill];
  if (!isObject(selected)) throw new Error(`${skill} 配置段必须为对象`);
  if (selected.enabled === false) throw new Error(`${skill} 已禁用`);
  return selected;
}
function queryPlaceholder() {
  return { connection: 'company', access_key: 'TODO', headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': 'TODO' }, cuser: 'TODO', cgroup: 'TODO' };
}
function logPlaceholder() { return { connection: 'company', token: 'TODO', linkProject: 'TODO', timeout: 30000 }; }
function completeSections(root) {
  if (!isObject(root) || (!Object.hasOwn(root, QUERY_SKILL) && !Object.hasOwn(root, LOG_SKILL))) throw new Error('已有配置不是按 skill 分段的格式；请显式运行 migrate-config，原文件保留');
  for (const name of [QUERY_SKILL, LOG_SKILL]) {
    if (Object.hasOwn(root, name) && !isObject(root[name])) throw new Error(`${name} 配置段必须为对象，原文件保留`);
  }
  return { ...root, [QUERY_SKILL]: root[QUERY_SKILL] || queryPlaceholder(), [LOG_SKILL]: root[LOG_SKILL] || logPlaceholder() };
}
// Replacement is guarded by the original bytes; temporary credentials stay beside
// the private file, never in the framework or a repository, and are always removed.
function writePrivate(target, value, expected = null) {
  assertHostConfigPath(target); outsideRepo(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertHostConfigPath(target); outsideRepo(target);
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`);
  let owned = false;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: expected ? fs.statSync(target).mode & 0o777 : 0o600 });
    owned = true;
    // MSIX can redirect a newly created file even when the existing target was
    // read from the host filesystem. Verify the actual temporary file before use.
    assertHostConfigPath(temp); outsideRepo(temp);
    if (expected === null) {
      // Exclusive creation also guards the race between existence check and write.
      fs.copyFileSync(temp, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o600);
    } else {
      if (!fs.readFileSync(target).equals(expected)) throw new Error('个人配置发生并发修改，停止替换');
      fs.renameSync(temp, target);
      owned = false;
    }
    if (!fs.readFileSync(target).equals(bytes)) throw new Error('个人配置写后回读不一致，请检查文件状态');
  } finally { if (owned) fs.unlinkSync(temp); }
}
function initialize(filePath, { env = process.env, platform = process.platform, binding = windowsBinding } = {}) {
  if (platform !== 'win32') throw new Error('自动配置仅支持 Windows；其它平台显式配置 BOS_MCP_CONFIG，初始化未写入');
  const saved = binding();
  const target = filePath || env.BOS_MCP_CONFIG || saved.BOS_MCP_CONFIG || standardPath(env);
  if (!path.isAbsolute(target)) throw new Error('BOS_MCP_CONFIG 必须是绝对路径');
  assertHostConfigPath(target);
  const existed = fs.existsSync(target);
  outsideRepo(target);
  const expected = existed ? fs.readFileSync(target) : null;
  const original = existed ? readPrivate(target) : null;
  const value = existed ? completeSections(original) : { [QUERY_SKILL]: queryPlaceholder(), [LOG_SKILL]: logPlaceholder() };
  const changed = !existed || JSON.stringify(original) !== JSON.stringify(value);
  if (changed) writePrivate(target, value, expected);
  const values = { BOS_MCP_CONFIG: target };
  const result = binding(values);
  for (const [key, value] of Object.entries(values)) {
    if (result[key] !== value) throw new Error('用户环境变量回读不一致；文件保留，请重试');
    env[key] = value;
  }
  const fill = [];
  for (const [skill, section] of Object.entries(value)) {
    if (skill === QUERY_SKILL) for (const field of ['access_key', 'cuser', 'cgroup']) if (section[field] === 'TODO') fill.push(`${skill}.${field}`);
    if (skill === QUERY_SKILL && section.headers?.['X-Gateway-Upstream-BOS-MCP-TOKEN'] === 'TODO') fill.push(`${skill}.headers.X-Gateway-Upstream-BOS-MCP-TOKEN`);
    if (skill === LOG_SKILL) for (const field of ['token', 'linkProject']) if (section[field] === 'TODO') fill.push(`${skill}.${field}`);
  }
  return { created: !existed, updated: changed && existed, configPath: target, bindingVerified: true, fill, restartClient: true };
}
function migrate(filePath, { platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('自动迁移仅支持 Windows；其它平台请显式整理按 skill 分段的私有配置，未写入');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('migrate-config 需要原私有文件绝对路径');
  assertHostConfigPath(filePath); outsideRepo(filePath);
  const expected = fs.readFileSync(filePath);
  const root = readPrivate(filePath);
  let next;
  if (isObject(root) && (Object.hasOwn(root, QUERY_SKILL) || Object.hasOwn(root, LOG_SKILL))) next = completeSections(root);
  else {
    const allowed = ['connection', 'access_key', 'url', 'headers', 'cuser', 'cgroup', 'enabled'];
    if (!isObject(root) || Object.keys(root).some(key => !allowed.includes(key)) || (!root.connection && !root.url)) throw new Error('原配置不是可迁移的平铺查询配置；原文件保留，请按迁移说明人工核对');
    next = { [QUERY_SKILL]: root, [LOG_SKILL]: logPlaceholder() };
  }
  const changed = JSON.stringify(root) !== JSON.stringify(next);
  if (changed) writePrivate(filePath, next, expected);
  return { migrated: changed, configPath: filePath, queryPreserved: true, logConfigured: !/^TODO$/i.test(String(next[LOG_SKILL].token || 'TODO')) && !/^TODO$/i.test(String(next[LOG_SKILL].linkProject || 'TODO')) };
}
module.exports = { initialize, migrate, readSkillConfig, standardPath, companyUrl, windowsBinding };
