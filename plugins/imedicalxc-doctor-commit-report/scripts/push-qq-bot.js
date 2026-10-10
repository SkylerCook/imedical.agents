'use strict';
// QQ 机器人推送适配器（NapCat / OneBot HTTP API）
// 用法: node push-qq-bot.js <report-md-path>
// 读取 .agents/plugins/imedicalxc-doctor-commit-report/config/commit-report-push.json 中的 qqbot 配置

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

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
  return cfg.qqbot;
}

function loadReporters() {
  if (!fs.existsSync(reporterConfigPath)) return [];
  const cfg = JSON.parse(fs.readFileSync(reporterConfigPath, 'utf8'));
  return (cfg.reporters || []).map((r) => r.name);
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
    cacheConfigs: c.cacheConfigs || 0,
    cacheFirstUse: c.cacheFirstUse || 0
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
  lines.push(`  新增代码表缓存配置：${counts.cacheConfigs} 项（PO 首用 ${counts.cacheFirstUse}）`);
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
    details.push({ text: `  · 配置 ${it.stCode || it.stCodeRaw} / ${it.itemCode}`, author: it.author });
  }
  for (const cc of db.cacheConfigs || []) {
    if (cc.firstUse) {
      details.push({ text: `  · 缓存首用 ${cc.poClass}（${cc.method}）`, author: cc.author });
    }
  }
  lines.push('—— 明细 ——');
  const DETAIL_CAP = 15;
  lines.push(...details.slice(0, DETAIL_CAP).map((d) => d.text));
  if (details.length > DETAIL_CAP) lines.push(`  … 其余 ${details.length - DETAIL_CAP} 条详见报告`);
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
  if (!dateRange) return '信创提交分析报告.md';
  const since = dateRange.since;
  const until = dateRange.until;
  const sinceParts = since.split('-');
  const untilParts = until.split('-');
  const sinceMonth = parseInt(sinceParts[1], 10);
  const sinceDay = parseInt(sinceParts[2], 10);
  const untilMonth = parseInt(untilParts[1], 10);
  const untilDay = parseInt(untilParts[2], 10);
  return `${sinceMonth}月${sinceDay}日-${untilMonth}月${untilDay}日信创提交分析报告.md`;
}

function formatOpening(dateRange, totalCommits) {
  const range = dateRange ? `${dateRange.since} ~ ${dateRange.until}` : '';
  const count = totalCommits != null ? `，共采集 ${totalCommits} 条提交` : '';
  return `📋 ${range} 信创迭代分析报告已生成${count}，以下是摘要：`;
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

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('用法: node push-qq-bot.js <report-md-path>');
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
  const reporterNames = loadReporters();

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

  console.log(`推送目标: 群 ${cfg.groupId} @ ${cfg.apiBaseUrl}`);
  console.log('获取群成员列表...');
  const members = await getGroupMembers(cfg);
  console.log(`群成员 ${members.length} 人`);
  const { nameToMember, admins } = buildMemberMap(members, reporterNames);

  let allOk = true;

  // 步骤 1：开场消息
  console.log('\n--- 步骤1: 发送开场消息 ---');
  const opening = formatOpening(dateRange, totalCommits);
  if (!await sendText(cfg, opening)) allOk = false;

  // 步骤 2：提交人分布
  if (dist) {
    console.log('\n--- 步骤2: 发送【按提交人分布】---');
    const msg = formatAuthorDist(dateRange, dist);
    if (!await sendText(cfg, msg)) allOk = false;
  } else {
    console.log('[WARN] 未找到【按提交人分布】段落，跳过');
  }

  // 步骤 2.5：数据库脚本执行提醒
  if (db) {
    console.log('\n--- 步骤2.5: 发送【数据库脚本执行提醒】---');
    if (!await sendText(cfg, formatDbReminder(db, dateRange, nameToMember, admins))) allOk = false;
  } else {
    console.log('[WARN] 未找到 db-changes JSON，跳过数据库脚本执行提醒');
  }

  // 步骤 3-4：预警 + 逐条问题（1-2★ 优先，3★ 补充）
  if (itemsToSend.length > 0) {
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

  // 步骤 5：收尾 @全体
  console.log('\n--- 步骤5: 发送收尾消息（@全体）---');
  if (!await sendText(cfg, formatClosing())) allOk = false;

  // 步骤 6：上传报告文件
  console.log('\n--- 步骤6: 上传报告文件 ---');
  const fileName = formatDateRangeFileName(dateRange);
  if (!await uploadFile(cfg, reportPath, fileName)) allOk = false;

  console.log('\n推送完成:', allOk ? '全部成功' : '部分失败，请检查日志');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('推送异常:', err);
  process.exit(1);
});
