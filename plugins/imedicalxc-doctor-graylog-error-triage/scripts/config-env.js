'use strict';
// 巡检脚本公共配置与连接解析。连接信息单一事实源 = IDE mcp.json，只读取不复制不落盘不回显。
// 通用逻辑在 graylog-toolkit/lib/config；此处只注入本插件与工程路径，导出旧接口。

const path = require('node:path');
const base = require('../../graylog-toolkit/lib/config');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PLUGIN_ROOT, 'config', 'graylog-triage.json');
const SETTINGS_PATH = path.join(REPO_ROOT, '.qoder', 'settings.local.json');
const ctx = base.createContext({ repoRoot: REPO_ROOT, settingsPath: SETTINGS_PATH });

function getEnv(name) { return base.getEnv(ctx, name); }
function requireEnv(name, label) { return base.requireEnv(ctx, name, label); }
function maintenanceHint(name) { return base.maintenanceHint(ctx, name); }

function loadConfig() {
  try {
    return base.loadConfigFile(CONFIG_PATH);
  } catch (err) {
    if (err.message.startsWith('主配置不存在')) {
      throw new Error(`${err.message}（请先落盘插件骨架与 config/graylog-triage.json）`);
    }
    throw err;
  }
}

function resolvePath(cfg, rel) { return base.resolvePath(ctx, rel); }

function pluginPath(rel) {
  return path.isAbsolute(rel) ? rel : path.join(PLUGIN_ROOT, rel);
}

function resolveMcpConfigPath(cfg, explicit) { return base.resolveMcpConfigPath(ctx, cfg, explicit); }
function readMcpServer(cfg, envId, explicit) { return base.readMcpServer(ctx, cfg, envId, explicit); }
function resolveConnection(cfg, envId, opts = {}) { return base.resolveConnection(ctx, cfg, envId, opts); }

module.exports = {
  REPO_ROOT, PLUGIN_ROOT, CONFIG_PATH, SETTINGS_PATH,
  getEnv, requireEnv, maintenanceHint, loadConfig, resolvePath, pluginPath,
  resolveMcpConfigPath, readMcpServer, resolveConnection,
  describeConnection: base.describeConnection,
};
