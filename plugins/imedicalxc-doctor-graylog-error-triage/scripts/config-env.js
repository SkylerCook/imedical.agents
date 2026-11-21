'use strict';
// 巡检脚本公共配置与连接解析。连接信息单一事实源 = IDE mcp.json，只读取不复制不落盘不回显。

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PLUGIN_ROOT, 'config', 'graylog-triage.json');
const SETTINGS_PATH = path.join(REPO_ROOT, '.qoder', 'settings.local.json');

let settingsEnvCache = null;

function loadSettingsEnv() {
  if (settingsEnvCache) return settingsEnvCache;
  settingsEnvCache = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      const env = raw && raw.graylogTriage && raw.graylogTriage.env;
      if (env && typeof env === 'object') settingsEnvCache = env;
    }
  } catch (err) {
    console.warn(`[WARN] 读取 ${SETTINGS_PATH} 失败，忽略其中环境变量: ${err.message}`);
  }
  return settingsEnvCache;
}

function getEnv(name) {
  const fromProcess = process.env[name];
  if (fromProcess && String(fromProcess).trim()) return String(fromProcess).trim();
  const fromSettings = loadSettingsEnv()[name];
  return fromSettings && String(fromSettings).trim() ? String(fromSettings).trim() : '';
}

function maintenanceHint(name) {
  const rel = path.relative(REPO_ROOT, SETTINGS_PATH).replace(/\\/g, '/');
  return `维护位置：shell 环境变量，或 ${rel} 的 graylogTriage.env.${name}；Graylog 连接也可写在 IDE mcp.json 的 mcpServers["graylog-<env>"].env`;
}

function requireEnv(name, label) {
  const value = getEnv(name);
  if (!value) {
    console.error(`[ERROR] 缺少${label || name}：环境变量 ${name} 未配置`);
    console.error(`        ${maintenanceHint(name)}`);
    process.exit(2);
  }
  return value;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`主配置不存在: ${CONFIG_PATH}（请先落盘插件骨架与 config/graylog-triage.json）`);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`主配置解析失败（${CONFIG_PATH}）: ${err.message}`);
  }
}

function resolvePath(cfg, rel) {
  if (!rel) return REPO_ROOT;
  return path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
}

function pluginPath(rel) {
  return path.isAbsolute(rel) ? rel : path.join(PLUGIN_ROOT, rel);
}

function resolveMcpConfigPath(cfg, explicit) {
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.join(REPO_ROOT, explicit);
  const mc = (cfg && cfg.mcpConfig) || {};
  const fromEnv = getEnv(mc.envVar || 'QODER_MCP_CONFIG');
  if (fromEnv) return path.isAbsolute(fromEnv) ? fromEnv : path.join(REPO_ROOT, fromEnv);
  const base = mc.base === 'workspace' ? REPO_ROOT : os.homedir();
  return path.join(base, mc.defaultRelative || path.join('.qoder-cn', 'shared_client', 'mcp.json'));
}

function readMcpServer(cfg, envId, explicit) {
  const envCfg = (cfg.environments || {})[envId] || {};
  const mc = cfg.mcpConfig || {};
  const file = resolveMcpConfigPath(cfg, explicit);
  const key = envCfg.mcpServer || String(mc.serverKeyTemplate || 'graylog-{env}').replace('{env}', envId);
  const out = { file, key, exists: false, serverFound: false, env: null, parseError: '' };
  if (!file || !fs.existsSync(file)) return out;
  out.exists = true;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const server = (raw.mcpServers || {})[key];
    if (server) {
      out.serverFound = true;
      out.env = server.env || {};
    }
  } catch (err) {
    out.parseError = err.message;
  }
  return out;
}

function resolveConnection(cfg, envId, opts = {}) {
  const envCfg = (cfg.environments || {})[envId];
  const base = {
    status: 'missing-config', source: '', url: '', token: '', cookie: '', tokenType: 'none',
    mcpConfigPath: '', mcpConfigExists: false, mcpServerKey: '', mcpServerFound: false, detail: '',
  };
  if (!envCfg) return { ...base, detail: `未配置环境 ${envId}` };

  const mcp = readMcpServer(cfg, envId, opts.mcpConfig);
  base.mcpConfigPath = mcp.file;
  base.mcpConfigExists = mcp.exists;
  base.mcpServerKey = mcp.key;
  base.mcpServerFound = mcp.serverFound;

  const candidates = [];
  if (mcp.env) {
    const url = String(mcp.env.GRAYLOG_URL || '').trim();
    const token = String(mcp.env.GRAYLOG_TOKEN || '').trim();
    const cookie = String(mcp.env.GRAYLOG_COOKIE || '').trim();
    if (url || token || cookie) candidates.push({ source: `mcp:${mcp.key}`, url, token, cookie });
  }
  const procUrl = getEnv(envCfg.urlEnv || `GRAYLOG_${envId}_URL`);
  const procToken = getEnv(envCfg.tokenEnv || `GRAYLOG_${envId}_TOKEN`);
  const procCookie = getEnv(envCfg.cookieEnv || `GRAYLOG_${envId}_COOKIE`);
  if (procUrl || procToken || procCookie) {
    candidates.push({ source: 'process-env', url: procUrl, token: procToken, cookie: procCookie });
  }

  if (mcp.parseError) {
    return { ...base, status: 'missing-config', detail: `IDE mcp.json 解析失败: ${mcp.parseError}` };
  }
  if (candidates.length === 0) {
    const status = mcp.exists && mcp.serverFound ? 'missing-credentials' : 'missing-config';
    const detail = status === 'missing-credentials'
      ? `mcp.json 已注册 ${mcp.key}，但 env 中缺少 GRAYLOG_URL / GRAYLOG_TOKEN`
      : `未找到连接配置：${mcp.file} 中无 mcpServers["${mcp.key}"]，且进程环境变量未提供`;
    return { ...base, status, detail };
  }
  if (candidates.length === 2) {
    const [a, b] = candidates;
    if ((a.url && b.url && a.url !== b.url) || (a.token && b.token && a.token !== b.token)) {
      return {
        ...base, status: 'ambiguous',
        detail: 'IDE mcp.json 与进程环境变量同时提供且不一致，请用 --mcp-config 或清空一方后重试',
      };
    }
  }
  const picked = candidates[0];
  if (!picked.url || !(picked.token || picked.cookie)) {
    return {
      ...base, status: 'missing-credentials', source: picked.source,
      url: picked.url, token: picked.token, cookie: picked.cookie,
      detail: '连接地址或凭据不完整（需 GRAYLOG_URL 且 GRAYLOG_TOKEN 或 GRAYLOG_COOKIE 之一）',
    };
  }
  return {
    ...base, status: 'ready', source: picked.source,
    url: picked.url.replace(/\/+$/, ''), token: picked.token, cookie: picked.cookie,
    tokenType: picked.token ? 'token' : 'cookie',
    detail: `连接就绪（来源 ${picked.source}）`,
  };
}

function describeConnection(conn) {
  return {
    status: conn.status,
    source: conn.source || '',
    hasUrl: Boolean(conn.url),
    hasToken: Boolean(conn.token),
    hasCookie: Boolean(conn.cookie),
    tokenType: conn.tokenType,
    mcpConfigExists: conn.mcpConfigExists,
    mcpServerKey: conn.mcpServerKey,
    mcpServerFound: conn.mcpServerFound,
    detail: conn.detail,
  };
}

module.exports = {
  REPO_ROOT, PLUGIN_ROOT, CONFIG_PATH, SETTINGS_PATH,
  getEnv, requireEnv, maintenanceHint, loadConfig, resolvePath, pluginPath,
  resolveMcpConfigPath, readMcpServer, resolveConnection, describeConnection,
};