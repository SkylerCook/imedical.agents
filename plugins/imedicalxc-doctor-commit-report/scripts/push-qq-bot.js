'use strict';
// QQ 机器人推送适配器（NapCat / OneBot HTTP API）
// 用法: node push-qq-bot.js <report-md-path> [--only=opening,distribution,db,issues,pending,closing,upload] [--dry-run]
//   --only    仅发送指定段落（逗号分隔；默认全部）
//   --dry-run 仅打印消息不实际发送（试运行演练/发送前核验用）
// 读取 .agents/plugins/imedicalxc-doctor-commit-report/config/commit-report-push.json 中的 qqbot 配置
// 访问令牌不落 config，从环境变量 COMMIT_REPORT_QQBOT_TOKEN 读取（缺失时提示维护位置）

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { requireEnv } = require('./config-env');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const pushConfigPath = path.join(repoRoot, '.agents', 'plugins', 'imedicalxc-doctor-commit-report', 'config', 'commit-report-push.json');
const reporterConfigPath = path.join(repoRoot, '.agents', 'plugins', 'imedicalxc-doctor-commit-report', 'config', 'commit-report.json');

function loadPushConfig() {
  if (!fs.existsSync(pushConfigPath)) {
    console.error('推送配置文件不存在:', pushConfigPath);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(pushConfigPath, 'utf8'));
  if (!cfg.enabled) {
    console.log('推送未启用（enabled=false），跳过');
    process.exit(0);
  }
  if (cfg.channel !== 'qqbot' || !cfg.qqbot) {
    console.error('当前仅支持 qqbot 通道，配置 channel:', cfg.channel);
    process.exit(1);
  }
  const apiToken = requireEnv('COMMIT_REPORT_QQBOT_TOKEN', 'QQ 机器人访问令牌');
  return { ...cfg.qqbot, apiToken };
}

function loadReporterConfig() {
  if (!fs.existsSync(reporterConfigPath)) return {};
  return JSON.parse(fs.readFileSync(reporterConfigPath, 'utf8'));
}

const PUSH_SECTIONS = ['opening', 'distribution', 'db', 'issues', 'pending', 'closing', 'upload'];
let DRY_RUN = false;

function parseArgs(argv) {
  const args = { reportPath: '', only: null, dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a.startsWith('--only=')) {
      const names = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = names.filter((n) => !PUSH_SECTIONS.includes(n));
      if (unknown.length > 0) {
        console.error(`--only 含未知段落: ${unknown.join(', ')}（可选: ${PUSH_SECTIONS.join(',')}）`);
        process.exit(1);
      }
      args.only = new Set(names);
    } else if (!a.startsWith('--') && !args.reportPath) {
      args.reportPath = a;
    }
  }
  return args;
}

function requestJson(baseUrl, endpoint, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const data = body ? JSON.stringify(body) : null;
    const mod = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: data ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      timeout: 20000,
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = mod.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function sendText(cfg, message) {
  if (DRY_RUN) {
    console.log(`[DRY-RUN] 将发送文本消息（群 ${cfg.groupId}）:\n----\n${message}\n----`);
    return true;
  }
  const res = await requestJson(cfg.apiBaseUrl, '/send_group_msg', cfg.apiToken, {
    group_id: cfg.groupId,
    message,
  });
  if (res.status === 200 && res.body && res.body.retcode === 0) {
    console.log('[OK] 文本消息发送成功');
    return true;
  }
  console.error('[FAIL] 文本消息发送失败:', JSON.stringify(res));
  return false;
}

async function uploadFile(cfg, filePath, displayName) {
  if (DRY_RUN) {
    console.log(`[DRY-RUN] 将上传群文件: ${displayName || path.basename(filePath)}`);
    return true;
  }
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const res = await requestJson(cfg.apiBaseUrl, '/upload_group_file', cfg.apiToken, {
    group_id: cfg.groupId,
    file: `base64://${b64}`,
    name: displayName || path.basename(filePath),
  });
  if (res.status === 200 && res.body && res.body.retcode === 0) {
    console.log('[OK] 群文件上传成功');
    return true;
  }
  console.error('[FAIL] 群文件上传失败:', JSON.stringify(res));
  return false;
}

async function getGroupMembers(cfg) {
  const res = await requestJson(cfg.apiBaseUrl, '/get_group_member_list', cfg.apiToken, {
    group_id: cfg.groupId,
  });
  if (res.status === 200 && res.body && res.body.retcode === 0 && Array.isArray(res.body.data)) {
    return res.body.data;
  }
  console.error('[WARN] 获取群成员列表失败:', JSON.stringify(res));
  return [];
}

function buildMemberMap(members, reporterNames) {
  const nameToMember = new Map();
  const admins = members.filter((m) => m.role === 'owner' || m.role === 'admin');
  for (const name of reporterNames) {
    const match = members.find((m) => {
      const card = (m.card || '').trim();
      const nick = (m.nickname || '').trim();
      return card === name || nick === name || card.includes(name) || nick.includes(name);
    });
    if (match) {
      nameToMember.set(name, match);
      console.log(`  匹配: ${name} → ${match.card || match.nickname} (QQ:${match.user_id})`);
    } else {
      console.log(`  未匹配: ${name}`);
    }
  }
  return { nameToMember, admins };
}

function extractDateRange(md) {
  const m = md.match(/时间窗[：:]\s*(\S+)\s*~\s*(\S+)/);
  if (m) return { since: m[1], until: m[2], label: `${m[1]} ~ ${m[2]}` };
  return null;
}

function extractAuthorDist(md) {
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => /^###\s+按提交人分布/.test(l));
  if (startIdx < 0) return null;
  const section = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^###?\s+/.test(lines[i])) break;
    section.push(lines[i]);
  }
  const tableLines = section.filter((l) => /^\|/.test(l) && !/^\|[-\s|]+\|$/.test(l) && !/^\|\s*提交人/.test(l));
  if (tableLines.length === 0) return null;
  const rows = tableLines.map((l) => {
    const cells = l.split('|').filter((c) => c.trim()).map((c) => c.trim());
    return { name: cells[0], count: cells[1] };
  });
  const total = rows.reduce((s, r) => s + parseInt(r.count, 10), 0);
  return { rows, total };
}

function buildHashAuthorMap(md) {
  const map = new Map();
  const re = /^### ([0-9a-f]{8,})\s+.+—\s*(\S+)\s*·/;
  for (const line of md.split('\n')) {
    const m = line.match(re);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function extractLowStars(md) {
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s+四、低星问题清单/.test(l));
  if (startIdx < 0) return [];
  const section = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    section.push(lines[i]);
  }
  const headerLine = section.find((l) => /^\|/.test(l) && /提交/.test(l));
  const hasAuthorCol = headerLine && /提交人/.test(headerLine);
  const tableLines = section.filter((l) => /^\|/.test(l) && !/^\|[-\s|]+\|$/.test(l) && !/^\|\s*提交/.test(l));
  return tableLines.map((l) => {
    const cells = l.split('|').filter((c) => c.trim()).map((c) => c.trim());
    if (hasAuthorCol && cells.length >= 4) {
      return { commit: cells[0] || '', author: cells[1] || '', stars: cells[2] || '', issue: cells[3] || '' };
    }
    return { commit: cells[0] || '', author: '', stars: cells[1] || '', issue: cells[2] || '' };
  });
}

function extractThreeStars(md) {
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s+三、评估详情/.test(l));
  if (startIdx < 0) return [];
  const section = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    section.push(lines[i]);
  }
  const items = [];
  const headingRe = /^### ([0-9a-f]{8,})\s+(.+?)\s*—\s*(\S+)\s*·/;
  const ratingRe = /^- \*\*评级\*\*[：:]\s*(\d+)★\s*——\s*评价[：:]\s*(.*)/;
  let current = null;
  for (const line of section) {
    const hm = line.match(headingRe);
    if (hm) {
      current = { hash: hm[1], subject: hm[2], author: hm[3], stars: '', comment: '' };
      continue;
    }
    if (current) {
      const rm = line.match(ratingRe);
      if (rm) {
        current.stars = `${rm[1]}★`;
        current.comment = rm[2];
        if (rm[1] === '3') items.push({ ...current });
        current = null;
      }
    }
  }
  return items;
}

function loadDbChanges(reportPath) {
  const dbPath = path.join(
    path.dirname(reportPath),
    path.basename(reportPath).replace(/^commit-report-/, 'db-changes-').replace(/\.md$/, '.json')
  );
  if (!fs.existsSync(dbPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return null;
  }
}

function formatDbReminder(db, dateRange, memberMap, admins) {
  const c = (db.meta && db.meta.counts) || {};
  const counts = {
    poChanges: c.poChanges || 0,
    newStCodes: c.newStCodes || 0,
    configItems: c.configItems || 0,
    reminders: c.reminders || 0,
    cacheConfigs: c.cacheConfigs || 0
  };
  const total = counts.poChanges + counts.newStCodes + counts.configItems + counts.reminders + counts.cacheConfigs;
  const range = dateRange ? `（${dateRange.label}）` : '';
  if (total === 0) {
    return `🗄️ 数据库脚本执行提醒${range}\n  本期无数据库脚本执行提醒`;
  }
  const lines = [`🗄️ 数据库脚本执行提醒${range}`];
  lines.push(`  数据结构修改（PO）：${counts.poChanges} 处`);
  lines.push(`  新增系统标准配置：${counts.newStCodes + counts.configItems} 项（新增 ST_CODE ${counts.newStCodes} / 配置项 ${counts.configItems}）`);
  lines.push(`  新增系统标准提醒：${counts.reminders} 条`);
  lines.push(`  新增代码表缓存配置：${counts.cacheConfigs} 项`);
  const details = [];
  for (const r of db.reminders || []) {
    const code = r.resolvedCode || `${r.expr}+${r.codeSuffix}`;
    details.push({ text: `  · 提醒 ${code}${r.message ? `「${r.message}」` : ''}`, author: r.author });
  }
  for (const s of db.newStCodes || []) {
    details.push({ text: `  · 新 ST_CODE：${s.stCode}`, author: s.author });
  }
  for (const p of db.poChanges || []) {
    const fields = [
      ...(p.addedFields || []).map((f) => `+${f.name}`),
      ...(p.removedFields || []).map((f) => `-${f.name}`)
    ];
    const what = fields.length > 0 ? fields.join('、') : (p.isNewFile ? '新建' : '结构变更');
    details.push({ text: `  · PO ${p.tableName || '（表名未知）'}：${what}`, author: p.author });
  }
  for (const it of db.configItems || []) {
    const desc = it.description ? `（${it.description}）` : '';
    details.push({ text: `  · 配置 ${it.stCode || it.stCodeRaw} / ${it.itemCode}${desc}`, author: it.author });
  }
  for (const cc of db.cacheConfigs || []) {
    details.push({ text: `  · 缓存 ${cc.poClass}.${cc.method}${cc.tableName ? `（表 ${cc.tableName}）` : ''}`, author: cc.author });
  }
  lines.push('—— 明细 ——');
  const DETAIL_CAP = 15;
  lines.push(...details.slice(0, DETAIL_CAP).map((d) => d.text));
  if (details.length > DETAIL_CAP) lines.push(`  … 其余 ${details.length - DETAIL_CAP} 条详见报告`);
  lines.push('—— 执行方案推荐 ——');
  if (counts.poChanges > 0) {
    lines.push('  · 数据结构修改：通过【腾讯文档】his 版本升级脚本汇总表格登记 DDL 执行 https://docs.qq.com/sheet/DSnJ5V0tYRG9jT1VL?tab=BB08J2');
  }
  if (counts.newStCodes + counts.configItems > 0) {
    lines.push('  · 新增系统标准配置：信创标准环境 → 使用demo账户登录 → 系统标准配置菜单，筛选指定配置项导出文件，导入项目现场。\n  请勿直接维护，请使用导入功能，防止出现维护错误。');
  }
  if (counts.reminders > 0) {
    lines.push('  · 新增系统标准提醒：信创标准环境 → 使用demo账户登录 → 系统提示信息，参照代码信息进行数据维护');
  }
  if (counts.cacheConfigs > 0) {
    lines.push('  · 新增代码表缓存配置：信创标准环境 → 使用demo账户登录 → 代码表缓存管理，参照代码信息进行数据维护');
  }
  lines.push('说明：当前为试用运行阶段，更新阶段出现疑问可联系变更负责人咨询。');
  const atParts = [];
  const atSeen = new Set();
  const pushAt = (qq) => {
    if (!atSeen.has(qq)) {
      atSeen.add(qq);
      atParts.push(`[CQ:at,qq=${qq}]`);
    }
  };
  for (const author of [...new Set(details.map((d) => d.author))]) {
    const member = author && memberMap.get(author);
    if (member) {
      pushAt(member.user_id);
    } else if (author && admins.length > 0) {
      pushAt(admins[0].user_id);
    }
  }
  if (atParts.length > 0) lines.push('涉及提交人：' + atParts.join(' '));
  return lines.join('\n');
}

function formatAuthorDist(dateRange, dist) {
  const header = dateRange
    ? `📊 提交人分布（${dateRange.label}，共 ${dist.total} 条）`
    : `📊 提交人分布（共 ${dist.total} 条）`;
  const lines = [header];
  for (const r of dist.rows) {
    const pct = ((parseInt(r.count, 10) / dist.total) * 100).toFixed(1);
    lines.push(`  ${r.name}：${r.count} 条（${pct}%）`);
  }
  return lines.join('\n');
}

function extractTotalCommits(md) {
  const m = md.match(/提交总数[：:]\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function formatDateRangeFileName(dateRange) {
  if (!dateRange) return '医生站信创产品迭代周报.md';
  const since = dateRange.since;
  const until = dateRange.until;
  const sinceParts = since.split('-');
  const untilParts = until.split('-');
  const sinceMonth = parseInt(sinceParts[1], 10);
  const sinceDay = parseInt(sinceParts[2], 10);
  const untilMonth = parseInt(untilParts[1], 10);
  const untilDay = parseInt(untilParts[2], 10);
  return `${sinceMonth}月${sinceDay}日-${untilMonth}月${untilDay}日医生站信创产品迭代周报.md`;
}

function formatOpening(dateRange, totalCommits) {
  const range = dateRange ? `${dateRange.since} ~ ${dateRange.until}` : '';
  const count = totalCommits != null ? `，共采集 ${totalCommits} 条提交` : '';
  return `📋 ${range} 医生站信创产品迭代周报已生成${count}，以下是摘要：`;
}

function formatClosing() {
  return '📎 详细报告见附件，请查阅。[CQ:at,qq=all]';
}

function formatLowStar(item, author, memberMap, admins) {
  const parts = [`⚠️ ${item.stars}`];
  const member = memberMap.get(author);
  if (member) {
    parts.push(`[CQ:at,qq=${member.user_id}]`);
  } else if (author) {
    parts.push(`未找到「${author}」群成员`);
    if (admins.length > 0) {
      parts.push(`[CQ:at,qq=${admins[0].user_id}]`);
    }
  }
  parts.push(item.commit);
  const msg = parts.join(' ') + '\n' + item.issue;
  return msg;
}

function formatThreeStar(item, memberMap, admins) {
  const parts = [`📝 ${item.stars}`];
  const member = memberMap.get(item.author);
  if (member) {
    parts.push(`[CQ:at,qq=${member.user_id}]`);
  } else if (item.author) {
    parts.push(`未找到「${item.author}」群成员`);
    if (admins.length > 0) {
      parts.push(`[CQ:at,qq=${admins[0].user_id}]`);
    }
  }
  parts.push(`${item.hash.slice(0, 8)} ${item.subject}`);
  return parts.join(' ') + '\n' + item.comment;
}

// ---------- 问题登记表（步骤 4.5：未标识处理结果提醒） ----------
// 读取《信创版产品迭代每周问题登记》：复用本机 tencent-docs MCP 代理（settings.json 指向的
// proxy.js 同目录 mcp-http-client.js，HTTP↔MCP 桥），配置与凭据运行时读取，不落盘。

const ISSUE_SOURCE_PREFIX = '医生站信创产品迭代周报';
const STATUS_TODO = '未完成';
const USER_SETTINGS_PATH = path.join(os.homedir(), '.qoder', 'settings.json');

function loadTdMcpConfig() {
  let url = process.env.TD_MCP_URL;
  let token = process.env.TD_TOKEN;
  let proxyPath = process.env.TD_PROXY_PATH;
  if (!url || !token || !proxyPath) {
    try {
      const settings = JSON.parse(fs.readFileSync(USER_SETTINGS_PATH, 'utf8'));
      const td = (settings.mcpServers || {})['tencent-docs'] || {};
      const env = td.env || {};
      url = url || env.TD_MCP_URL;
      token = token || env.TD_TOKEN;
      if (!proxyPath && Array.isArray(td.args)) {
        proxyPath = td.args.find((a) => typeof a === 'string' && a.endsWith('.js'));
      }
    } catch (err) {
      console.error(`[WARN] 读取 ${USER_SETTINGS_PATH} 失败:`, err.message);
    }
  }
  if (!url || !token) return null;
  return {
    url,
    token,
    clientPath: proxyPath ? path.join(path.dirname(proxyPath), 'mcp-http-client.js') : '',
  };
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms / 1000}s）`)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function parseToolResult(result) {
  const text = ((result || {}).content || []).map((c) => c.text || '').join('');
  if (!text) throw new Error('MCP 工具返回为空');
  const obj = JSON.parse(text);
  if (obj.error) throw new Error(String(obj.error));
  return obj;
}

function cellText(c) {
  if (!c) return '';
  if (c.value_type === 'NUMBER') {
    return c.number_value === undefined || c.number_value === null ? '' : String(c.number_value);
  }
  return String(c.string_value || '').trim();
}

async function fetchSheetRows(reg) {
  const mcp = loadTdMcpConfig();
  if (!mcp) {
    throw new Error(`缺少腾讯文档 MCP 配置（环境变量 TD_MCP_URL/TD_TOKEN 或 ${USER_SETTINGS_PATH} 的 mcpServers['tencent-docs']）`);
  }
  if (!mcp.clientPath || !fs.existsSync(mcp.clientPath)) {
    throw new Error(`未找到腾讯文档 MCP 客户端模块: ${mcp.clientPath || '(未从 settings.json 的 tencent-docs.args 推导出路径)'}`);
  }
  const { MCPClient } = await import(pathToFileURL(mcp.clientPath).href);
  const client = new MCPClient(mcp.url, mcp.token);
  await withTimeout(client.initialize(), 30000, '腾讯文档 MCP 连接');
  const info = parseToolResult(await withTimeout(
    client.callTool('sheet.get_sheet_info', { file_id: reg.fileId }), 30000, '读取子表信息'));
  const sheet = (info.sheets || []).find((s) => s.sheet_id === reg.sheetId);
  if (!sheet) {
    throw new Error(`子表未找到（sheetId=${reg.sheetId}）`);
  }
  const rowCount = Number(sheet.row_count) || 200;
  const data = parseToolResult(await withTimeout(
    client.callTool('sheet.get_cell_data', {
      file_id: reg.fileId,
      sheet_id: reg.sheetId,
      start_row: 0,
      end_row: rowCount - 1,
      start_col: 0,
      end_col: 8,
      return_csv: false,
    }),
    60000, '读取登记表数据'));
  const grid = [];
  for (const c of data.cells || []) {
    const r = Number(c.row);
    const col = Number(c.col);
    if (!Number.isInteger(r) || !Number.isInteger(col)) continue;
    if (!grid[r]) grid[r] = [];
    grid[r][col] = cellText(c);
  }
  return grid;
}

// 已标识处理结果：完成状态被改为「未完成」以外的值，或完成日期/备注任一被填写
function isIssueIdentified(row) {
  const status = (row[6] || '').trim();
  if (status && status !== STATUS_TODO) return true;
  return Boolean((row[7] || '').trim() || (row[8] || '').trim());
}

function collectPendingIssues(rows) {
  const counts = new Map();
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!(row[0] || '').trim().startsWith(ISSUE_SOURCE_PREFIX)) continue;
    if (isIssueIdentified(row)) continue;
    total += 1;
    const owner = (row[5] || '').trim();
    if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  return { total, counts };
}

function formatPendingReminder(pending, nameToMember, admins, sheetUrl) {
  const lines = [
    '📌 问题处理提醒',
    `《信创版产品迭代每周问题登记》有 ${pending.total} 条问题未标识处理结果，请相关同事点击链接查看并更新：`,
    sheetUrl,
  ];
  const byMember = new Map();
  const unmatched = [];
  const entries = [...pending.counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
  for (const [name, count] of entries) {
    const member = nameToMember.get(name);
    if (member) {
      byMember.set(member.user_id, (byMember.get(member.user_id) || 0) + count);
    } else {
      unmatched.push(name);
    }
  }
  const tail = [];
  const ats = [...byMember.entries()].map(([qq, count]) => `[CQ:at,qq=${qq}]（${count} 条）`);
  if (ats.length > 0) tail.push(ats.join(' '));
  if (unmatched.length > 0) {
    let text = `未找到「${unmatched.join('」「')}」群成员`;
    if (admins.length > 0) text += ` [CQ:at,qq=${admins[0].user_id}]`;
    tail.push(text);
  }
  if (tail.length > 0) lines.push(tail.join(' '));
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = args.reportPath;
  const want = (name) => !args.only || args.only.has(name);
  DRY_RUN = args.dryRun;
  if (!reportPath) {
    console.error('用法: node push-qq-bot.js <report-md-path> [--only=opening,distribution,db,issues,pending,closing,upload] [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(reportPath)) {
    console.error('报告文件不存在:', reportPath);
    process.exit(1);
  }

  const cfg = loadPushConfig();
  const md = fs.readFileSync(reportPath, 'utf8');

  const dateRange = extractDateRange(md);
  const totalCommits = extractTotalCommits(md);
  const dist = extractAuthorDist(md);
  const db = loadDbChanges(reportPath);
  const lowStars = extractLowStars(md);
  const threeStars = extractThreeStars(md);
  const hashAuthorMap = buildHashAuthorMap(md);
  const reporterCfg = loadReporterConfig();
  const reporterNames = (reporterCfg.reporters || []).map((r) => r.name);

  const issueReg = reporterCfg.issueRegistration;
  let pending = null;
  if (!want('pending')) {
    console.log('未包含 pending 段落，跳过问题处理提醒');
  } else if (issueReg && issueReg.enabled) {
    console.log('读取问题登记表待处理问题...');
    try {
      pending = collectPendingIssues(await fetchSheetRows(issueReg));
      console.log(`未标识处理结果: ${pending.total} 条（涉及 ${pending.counts.size} 人）`);
    } catch (err) {
      console.error('[WARN] 问题登记表读取失败，跳过问题处理提醒:', err.message);
    }
  } else {
    console.log('问题登记未启用，跳过问题处理提醒');
  }

  // 构建发送列表：1-2★ 优先，不足 5 条则用 3★ 补充
  const SUPPLEMENT_TARGET = 5;
  const itemsToSend = [...lowStars.map((item) => ({ ...item, type: 'low' }))];
  if (itemsToSend.length < SUPPLEMENT_TARGET && threeStars.length > 0) {
    const need = SUPPLEMENT_TARGET - itemsToSend.length;
    for (const item of threeStars.slice(0, need)) {
      itemsToSend.push({ ...item, type: 'three' });
    }
  }
  const lowCount = lowStars.length;
  const threeCount = itemsToSend.length - lowCount;

  console.log(`推送目标: 群 ${cfg.groupId} @ ${cfg.apiBaseUrl}` +
    (args.only ? ` · 仅发送: ${[...args.only].join(',')}` : '') + (DRY_RUN ? ' · DRY-RUN' : ''));
  console.log('获取群成员列表...');
  const members = await getGroupMembers(cfg);
  console.log(`群成员 ${members.length} 人`);
  const matchNames = [...new Set([...reporterNames, ...(pending ? [...pending.counts.keys()] : [])])];
  const { nameToMember, admins } = buildMemberMap(members, matchNames);

  let allOk = true;

  // 步骤 1：开场消息
  if (want('opening')) {
    console.log('\n--- 步骤1: 发送开场消息 ---');
    const opening = formatOpening(dateRange, totalCommits);
    if (!await sendText(cfg, opening)) allOk = false;
  } else {
    console.log('\n--- 步骤1: 跳过（未在 --only 内）---');
  }

  // 步骤 2：提交人分布
  if (want('distribution')) {
    if (dist) {
      console.log('\n--- 步骤2: 发送【按提交人分布】---');
      const msg = formatAuthorDist(dateRange, dist);
      if (!await sendText(cfg, msg)) allOk = false;
    } else {
      console.log('[WARN] 未找到【按提交人分布】段落，跳过');
    }
  } else {
    console.log('\n--- 步骤2: 跳过（未在 --only 内）---');
  }

  // 步骤 2.5：数据库脚本执行提醒
  if (want('db')) {
    if (db) {
      console.log('\n--- 步骤2.5: 发送【数据库脚本执行提醒】---');
      if (!await sendText(cfg, formatDbReminder(db, dateRange, nameToMember, admins))) allOk = false;
    } else {
      console.log('[WARN] 未找到 db-changes JSON，跳过数据库脚本执行提醒');
    }
  } else {
    console.log('\n--- 步骤2.5: 跳过（未在 --only 内）---');
  }

  // 步骤 3-4：预警 + 逐条问题（1-2★ 优先，3★ 补充）
  if (!want('issues')) {
    console.log('\n--- 步骤3-4: 跳过（未在 --only 内）---');
  } else if (itemsToSend.length > 0) {
    console.log(`\n--- 步骤3: 发送预警消息（${lowCount} 条 1-2★` +
      (threeCount > 0 ? ` + ${threeCount} 条 3★ 补充` : '') + '）---');
    const warningText = lowCount > 0
      ? `⚠️ 以下 ${lowCount} 条提交评价低于 3 星，请相关开发人员核实：`
      : `⚠️ 以下 ${threeCount} 条提交评价为 3 星，请相关开发人员关注：`;
    if (!await sendText(cfg, warningText)) allOk = false;

    console.log(`\n--- 步骤4: 发送问题清单 ${itemsToSend.length} 条 ---`);
    for (const item of itemsToSend) {
      let msg;
      if (item.type === 'low') {
        const hashPrefix = item.commit.split(/\s/)[0];
        const author = item.author || hashAuthorMap.get(hashPrefix) || '';
        msg = formatLowStar(item, author, nameToMember, admins);
      } else {
        msg = formatThreeStar(item, nameToMember, admins);
      }
      if (!await sendText(cfg, msg)) allOk = false;
    }
  } else {
    console.log('\n本期无需关注的问题，跳过步骤3-4');
  }

  // 步骤 4.5：问题处理提醒（登记表地址 + @未标识处理结果人员）
  if (!want('pending')) {
    console.log('\n--- 步骤4.5: 跳过（未在 --only 内）---');
  } else if (pending && pending.total > 0) {
    console.log('\n--- 步骤4.5: 发送【问题处理提醒】---');
    const reminder = formatPendingReminder(pending, nameToMember, admins, issueReg.sheetUrl || '');
    if (!await sendText(cfg, reminder)) allOk = false;
  } else if (pending) {
    console.log('无未标识处理结果的问题，跳过');
  } else {
    console.log('[WARN] 未取到问题登记表数据，跳过');
  }

  // 步骤 5：收尾 @全体
  if (want('closing')) {
    console.log('\n--- 步骤5: 发送收尾消息（@全体）---');
    if (!await sendText(cfg, formatClosing())) allOk = false;
  } else {
    console.log('\n--- 步骤5: 跳过（未在 --only 内）---');
  }

  // 步骤 6：上传报告文件
  if (want('upload')) {
    console.log('\n--- 步骤6: 上传报告文件 ---');
    const fileName = formatDateRangeFileName(dateRange);
    if (!await uploadFile(cfg, reportPath, fileName)) allOk = false;
  } else {
    console.log('\n--- 步骤6: 跳过（未在 --only 内）---');
  }

  console.log('\n推送完成:', allOk ? '全部成功' : '部分失败，请检查日志');
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('推送异常:', err);
    process.exit(1);
  });
}

module.exports = { cellText, isIssueIdentified, collectPendingIssues, formatPendingReminder, fetchSheetRows };
