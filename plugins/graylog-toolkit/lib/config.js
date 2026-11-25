'use strict';
// 通用连接与配置解析：不绑定任何插件目录。
// 调用方通过 createContext({ repoRoot, settingsPath, settingsKey }) 注入自己的工程根与设置文件。
// 连接信息单一事实源 = IDE mcp.json 或进程环境变量，只读取不复制不落盘不回显。

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_SETTINGS_KEY = 'graylogTriage';
const DEFAULT_MCP_RELATIVE = path.join('.qoder-cn', 'shared_client', 'mcp.json');

function createContext(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  return {
    repoRoot,
    settingsPath: path.resolve(opts.settingsPath || path.join(repoRoot, '.qoder', 'settings.local.json')),
    settingsKey: opts.settingsKey || DEFAULT_SETTINGS_KEY,
    settingsEnv: null,
  };
}

function loadSettingsEnv(ctx) {
  if (ctx.settingsEnv) return ctx.settingsEnv;
  ctx.settingsEnv = {};
  try {
    if (fs.existsSync(ctx.settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'));
      const env = raw && raw[ctx.settingsKey] && raw[ctx.settingsKey].env;
      if (env && typeof env === 'object') ctx.settingsEnv = env;
    }
  } catch (err) {
    console.warn(`[WARN] 读取 ${ctx.settingsPath} 失败，忽略其中环境变量: ${err.message}`);
  }
  return ctx.settingsEnv;
}

function getEnv(ctx, name) {
  const fromProcess = process.env[name];
  if (fromProcess && String(fromProcess).trim()) return String(fromProcess).trim();
  const fromSettings = loadSettingsEnv(ctx)[name];
  return fromSettings && String(fromSettings).trim() ? String(fromSettings).trim() : '';
}

function maintenanceHint(ctx, name) {
  const rel = path.relative(ctx.repoRoot, ctx.settingsPath).replace(/\\/g, '/');
  return `维护位置：shell 环境变量，或 ${rel} 的 ${ctx.settingsKey}.env.${name}；Graylog 连接也可写在 IDE mcp.json 的 mcpServers["graylog-<env>"].env`;
}

function requireEnv(ctx, name, label) {
  const value = getEnv(ctx, name);
  if (!value) {
    console.error(`[ERROR] 缺少${label || name}：环境变量 ${name} 未配置`);
    console.error(`        ${maintenanceHint(ctx, name)}`);
    process.exit(2);
  }
  return value;
}

function loadConfigFile(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    throw new Error(`主配置不存在: ${abs}`);
  }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`主配置解析失败（${abs}）: ${err.message}`);
  }
}

function resolvePath(ctx, rel) {
  if (!rel) return ctx.repoRoot;
  return path.isAbsolute(rel) ? rel : path.join(ctx.repoRoot, rel);
}

function resolveMcpConfigPath(ctx, cfg, explicit) {
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.join(ctx.repoRoot, explicit);
  const mc = (cfg && cfg.mcpConfig) || {};
  const fromEnv = getEnv(ctx, mc.envVar || 'QODER_MCP_CONFIG');
  if (fromEnv) return path.isAbsolute(fromEnv) ? fromEnv : path.join(ctx.repoRoot, fromEnv);
  const base = mc.base === 'workspace' ? ctx.repoRoot : os.homedir();
  return path.join(base, mc.defaultRelative || DEFAULT_MCP_RELATIVE);
}

function readMcpServer(ctx, cfg, envId, explicit) {
  const envCfg = (cfg.environments || {})[envId] || {};
  const mc = cfg.mcpConfig || {};
  const file = resolveMcpConfigPath(ctx, cfg, explicit);
  const key = envCfg.mcpServer || String(mc.serverKeyTemplate || 'graylog-{env}').replace('{env}', envId);
  const out = { file, key, exists: false, serverFound: false, env: null, parseError: '' };
  if (!file || !fs.existsSync(file)) return out;
  out.exists = true;
  try {
    // PowerShell -Encoding UTF8 会写入 BOM，JSON.parse 遇 \uFEFF 直接失败
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
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

function resolveConnection(ctx, cfg, envId, opts = {}) {
  const envCfg = (cfg.environments || {})[envId];
  const base = {
    status: 'missing-config', source: '', url: '', token: '', cookie: '', tokenType: 'none',
    mcpConfigPath: '', mcpConfigExists: false, mcpServerKey: '', mcpServerFound: false, detail: '',
  };
  if (!envCfg) return { ...base, detail: `未配置环境 ${envId}` };

  const mcp = readMcpServer(ctx, cfg, envId, opts.mcpConfig);
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
  const procUrl = getEnv(ctx, envCfg.urlEnv || `GRAYLOG_${envId}_URL`);
  const procToken = getEnv(ctx, envCfg.tokenEnv || `GRAYLOG_${envId}_TOKEN`);
  const procCookie = getEnv(ctx, envCfg.cookieEnv || `GRAYLOG_${envId}_COOKIE`);
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
  DEFAULT_SETTINGS_KEY, DEFAULT_MCP_RELATIVE,
  createContext, getEnv, requireEnv, maintenanceHint, loadConfigFile, resolvePath,
  resolveMcpConfigPath, readMcpServer, resolveConnection, describeConnection,
};
