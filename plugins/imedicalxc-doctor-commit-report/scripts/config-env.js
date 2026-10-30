'use strict';
// 运行期敏感配置解析：优先进程环境变量，其次 <仓库根>/.qoder/settings.local.json 的 commitReport.env
// 敏感值（令牌、个人邮箱）不写入入库的 config，只在本机环境提供。

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SETTINGS_PATH = path.join(REPO_ROOT, '.qoder', 'settings.local.json');

function loadSettingsEnv() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const env = raw && raw.commitReport && raw.commitReport.env;
    return env && typeof env === 'object' ? env : {};
  } catch {
    return {};
  }
}

const SETTINGS_ENV = loadSettingsEnv();

function getEnv(name) {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  const s = SETTINGS_ENV[name];
  return s !== undefined && s !== '' ? String(s) : '';
}

function maintenanceHint(name, purpose) {
  return [
    `缺少环境变量 ${name}${purpose ? `（${purpose}）` : ''}。`,
    '请在以下任一位置配置后重试：',
    '  1) shell 环境变量（cron / CI 场景推荐）',
    `  2) ${SETTINGS_PATH} 增加 "commitReport": { "env": { "${name}": "<值>" } }`,
    '配置说明见 skills/imedicalxc-doctor-commit-report/SKILL.md「环境变量」小节。',
  ].join('\n');
}

function requireEnv(name, purpose) {
  const v = getEnv(name);
  if (!v) {
    console.error(maintenanceHint(name, purpose));
    process.exit(1);
  }
  return v;
}

// 解析 JSON 形式的环境变量（失败返回 null，不抛错）
function getJsonEnv(name) {
  const raw = getEnv(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`环境变量 ${name} 不是合法 JSON: ${e.message}`);
    return null;
  }
}

module.exports = { getEnv, requireEnv, getJsonEnv, maintenanceHint, SETTINGS_PATH };
