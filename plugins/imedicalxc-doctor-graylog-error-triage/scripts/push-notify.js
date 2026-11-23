'use strict';
// QQ 群通知：读 classified-<HHmm>.json → 摘要文本 + md 文件上传
// 协议：OneBot / NapCat；鉴权头 Authorization: <token>（无 Bearer）
// 退出码: 0 成功（含主动跳过）/ 1 推送失败 / 2 配置不完整

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolvePath, pluginPath } = require('./config-env');

const BOOLEAN_FLAGS = new Set(['check', 'dry-run', 'skip-upload', 'help']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(body) && next !== undefined && !next.startsWith('--')) {
      args[body] = next;
      i += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function pad(n) { return String(n).padStart(2, '0'); }

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('[WARN] ' + path.basename(file) + ' 解析失败，按默认值处理: ' + err.message);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function latestClassified(cfg, envId) {
  const root = resolvePath(cfg, path.join((cfg.output || {}).dir || 'docs/agent-reports/graylog-triage', envId));
  if (!fs.existsSync(root)) return '';
  const days = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  for (const day of days) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, day)); } catch { continue; }
    const hits = files.filter((f) => /^classified-\d{4}\.json$/.test(f)).sort().reverse();
    if (hits.length > 0) return path.join(root, day, hits[0]);
  }
  return '';
}

function shortTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 慢请求没有异常类，群消息里必须落到接口名，否则整屏都是「未知异常」
function clusterLabel(c) {
  if (c.kind === 'slow') return '慢请求 ' + (c.interfaceName || '未知接口');
  return c.exceptionClass || '未知异常';
}

function sevTag(c) {
  return c.severity ? '[' + c.severity + '] ' : '';
}

function shortDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '';
  return n >= 60000 ? (n / 60000).toFixed(1) + 'min' : (n / 1000).toFixed(1) + 's';
}

function loadPushConfig(cfg) {
  const rel = (cfg.notify || {}).pushConfigFile || 'config/graylog-triage-push.json';
  const file = pluginPath(rel);
  const data = readJson(file, null);
  return { rel, file, data };
}

function resolvePushState(cfg) {
  const rel = (cfg.notify || {}).pushStateFile || 'config/push-state.json';
  return pluginPath(rel);
}

function loadState(file) {
  const raw = readJson(file, { version: 1, sent: {}, lastPushAt: '' });
  return {
    version: raw.version || 1,
    sent: raw.sent && typeof raw.sent === 'object' ? raw.sent : {},
    lastPushAt: raw.lastPushAt || '',
  };
}

function pruneSent(state, keepDays) {
  const cutoff = Date.now() - (Number(keepDays) || 30) * 86400000;
  let removed = 0;
  for (const [hash, ts] of Object.entries(state.sent)) {
    if (typeof ts !== 'number' || ts < cutoff) {
      delete state.sent[hash];
      removed += 1;
    }
  }
  return removed;
}

function selectCandidates(payload, state, dedupeHours) {
  const groups = payload.groups || {};
  const cutoff = Date.now() - (Number(dedupeHours) || 0) * 3600000;
  const picked = [];
  const suppressed = [];
  const consider = (clusters, kind) => {
    for (const c of Array.isArray(clusters) ? clusters : []) {
      const lastSent = state.sent[c.errorHash];
      if (typeof lastSent === 'number' && lastSent >= cutoff) {
        suppressed.push({ errorHash: c.errorHash, ownerKind: kind, lastSentAt: new Date(lastSent).toISOString() });
        continue;
      }
      picked.push({ ...c, ownerKind: c.ownerKind || kind });
    }
  };
  consider((groups.self || {}).clusters, 'self');
  for (const bucket of groups.external || []) {
    for (const c of Array.isArray(bucket.clusters) ? bucket.clusters : []) {
      const lastSent = state.sent[c.errorHash];
      if (typeof lastSent === 'number' && lastSent >= cutoff) {
        suppressed.push({ errorHash: c.errorHash, ownerKind: 'external', group: bucket.group, lastSentAt: new Date(lastSent).toISOString() });
        continue;
      }
      picked.push({ ...c, ownerKind: 'external', ownerGroup: c.ownerGroup || bucket.group });
    }
  }
  return { picked, suppressed };
}

function buildMessage(payload, picked, cfg) {
  const n = cfg.notify || {};
  const maxClusters = Number(n.maxClustersPerMessage) || 8;
  const lines = [];
  lines.push('【Graylog 巡检 · ' + payload.env + '】' + shortTime(payload.generatedAt));
  if (payload.window) {
    lines.push('窗口 ' + shortTime(payload.window.from) + ' → ' + shortTime(payload.window.to) + (payload.window.initial ? '（首轮）' : ''));
  }
  const stats = payload.stats || {};
  const totalCount = picked.reduce((s, c) => s + (c.count || 0), 0);
  lines.push('新簇 ' + picked.length + ' 个 / 命中 ' + totalCount + ' 条（窗口内共 ' + (stats.items || 0) + ' 条：报错 ' + (stats.errorItems || 0) + ' / 慢请求 ' + (stats.slowItems || 0) + '）');
  if (typeof stats.p0 === 'number' || typeof stats.p1 === 'number') {
    lines.push('严重度初判（窗口内全部簇）：P0 ' + (stats.p0 || 0) + ' / P1 ' + (stats.p1 || 0) + '；P0 需出方案');
  }

  const self = picked.filter((c) => c.ownerKind === 'self');
  if (self.length > 0) {
    lines.push('');
    lines.push('▍本组 ' + self.length + ' 簇');
    self.slice(0, maxClusters).forEach((c, i) => {
      const dur = c.kind === 'slow' ? ' 最大' + shortDuration(c.durationMaxMs) : '';
      lines.push((i + 1) + '. ' + sevTag(c) + clusterLabel(c) + ' ×' + c.count + dur + ' @' + (c.ownerModule || '-'));
      if (c.kind !== 'slow' && c.innermostFrame) lines.push('    ' + c.innermostFrame);
    });
    if (self.length > maxClusters) lines.push('… 其余 ' + (self.length - maxClusters) + ' 簇见群文件');
  }

  const byGroup = new Map();
  for (const c of picked.filter((x) => x.ownerKind === 'external')) {
    const g = c.ownerGroup || '未分组';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(c);
  }
  if (byGroup.size > 0) {
    lines.push('');
    lines.push('▍他组 ' + byGroup.size + ' 组');
    for (const [group, list] of byGroup) {
      lines.push('· ' + group + '（' + list.length + ' 簇）');
      list.slice(0, 3).forEach((c) => {
        const dur = c.kind === 'slow' ? ' 最大' + shortDuration(c.durationMaxMs) : '';
        lines.push('   ' + sevTag(c) + clusterLabel(c) + ' ×' + c.count + dur + (c.kind !== 'slow' && c.urls && c.urls[0] ? ' → ' + c.urls[0] : ''));
      });
    }
  }

  const infraCount = ((payload.groups || {}).infra || {}).clusters;
  if (Array.isArray(infraCount) && infraCount.length > 0) {
    lines.push('');
    lines.push('▍基础设施 ' + infraCount.length + ' 簇（按配置仅落盘，不单独推送）');
  }
  const unknownCount = (((payload.groups || {}).unknown || {}).clusters || []).length;
  if (unknownCount > 0) {
    lines.push('▍待定 ' + unknownCount + ' 簇（无法确认归属，见报告附录）');
  }
  const unrelatedCount = (((payload.groups || {}).unrelated || {}).clusters || []).length;
  if (unrelatedCount > 0) {
    lines.push('▍无关 ' + unrelatedCount + ' 簇（他组应用自身故障，本组未参与，不推送）');
  }
  lines.push('');
  lines.push('详见群文件：本组报告与他组通知文档');

  let text = lines.join('\n');
  const maxChars = Number(n.maxTextChars) || 1500;
  if (text.length > maxChars) text = text.slice(0, maxChars - 12) + '\n…（已截断）';
  return text;
}

function collectUploadFiles(classifiedFile, payload) {
  const dir = path.dirname(classifiedFile);
  const hmMatch = path.basename(classifiedFile).match(/^classified-(\d{4})\.json$/);
  const hm = hmMatch ? hmMatch[1] : '';
  if (!hm) return [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const wanted = files.filter((f) => {
    if (!f.endsWith('-' + hm + '.md')) return false;
    // 中文名为当前产物；英文名兼容历史轮次
    return f.startsWith('本组问题-') || f.startsWith('他组通知-') || f.startsWith('巡检总览-')
      || f.startsWith('report-self-') || f.startsWith('notify-') || f.startsWith('report-summary-');
  });
  return wanted.sort().map((f) => path.join(dir, f));
}

async function callApi(apiBaseUrl, endpoint, payloadObj, token, retry, delayMs) {
  const url = String(apiBaseUrl).replace(/\/+$/, '') + endpoint;
  let lastError = '';
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: String(token) },
        body: JSON.stringify(payloadObj),
      });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = null; }
      const ok = res.ok && body && Number(body.retcode) === 0;
      if (ok) return { ok: true, status: res.status, body };
      lastError = 'HTTP ' + res.status + ' retcode=' + (body ? body.retcode : 'n/a') + ' body=' + String(text).slice(0, 200);
    } catch (err) {
      lastError = err.message;
    }
  }
  return { ok: false, error: lastError };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const envId = String(args.env || cfg.defaultEnv || '87');
  if (!(cfg.environments || {})[envId]) {
    console.error('[ERROR] 未配置环境 ' + envId);
    process.exit(2);
  }
  const n = cfg.notify || {};

  const push = loadPushConfig(cfg);
  const tokenEnv = n.tokenEnv || 'GRAYLOG_TRIAGE_QQBOT_TOKEN';
  const token = process.env[tokenEnv] || '';
  const qq = (push.data && push.data.qqbot) || {};
  const apiBaseUrl = qq.apiBaseUrl || '';
  const groupId = qq.groupId || '';

  if (args.check) {
    const status = {
      notifyEnabled: n.enabled !== false,
      pushConfigFile: push.rel,
      pushConfigExists: Boolean(push.data),
      channel: (push.data && push.data.channel) || '',
      hasApiBaseUrl: Boolean(apiBaseUrl),
      hasGroupId: Boolean(groupId),
      tokenEnv,
      hasToken: Boolean(token),
      dedupeHours: n.dedupeHours,
      minNewErrors: n.minNewErrors,
      uploadMd: n.uploadMd !== false,
    };
    console.log(JSON.stringify(status, null, 2));
    const ready = status.pushConfigExists && status.hasApiBaseUrl && status.hasGroupId && status.hasToken;
    process.exit(ready ? 0 : 2);
  }

  if (n.enabled === false) {
    console.log('[SKIP] notify.enabled=false，跳过推送');
    process.exit(0);
  }
  if (!push.data) {
    console.error('[ERROR] 缺少推送配置 ' + push.rel);
    console.error('        复制 config/graylog-triage-push.template.json 为该文件并填写 apiBaseUrl / groupId');
    process.exit(2);
  }
  if (!apiBaseUrl || !groupId) {
    console.error('[ERROR] 推送配置缺少 apiBaseUrl 或 groupId');
    process.exit(2);
  }
  if (!token) {
    console.error('[ERROR] 缺少令牌环境变量 ' + tokenEnv);
    process.exit(2);
  }

  let classifiedFile = '';
  if (typeof args.classified === 'string') classifiedFile = path.resolve(args.classified);
  else classifiedFile = latestClassified(cfg, envId);
  if (!classifiedFile || !fs.existsSync(classifiedFile)) {
    console.error('[ERROR] 找不到分类结果，请先运行 render-report.js 之前的 classify-owner.js');
    process.exit(1);
  }

  const payload = readJson(classifiedFile, null);
  if (!payload || !payload.groups) {
    console.error('[ERROR] 分类结果结构非法');
    process.exit(1);
  }

  const stateFile = resolvePushState(cfg);
  const state = loadState(stateFile);
  const { picked, suppressed } = selectCandidates(payload, state, n.dedupeHours);

  const minNew = Number(n.minNewErrors) || 1;
  const pickedCount = picked.reduce((s, c) => s + (c.count || 0), 0);
  if (picked.length === 0 || pickedCount < minNew) {
    console.log('[SKIP] 无可推送内容（候选簇 ' + picked.length + '，条数 ' + pickedCount + '，阈值 ' + minNew + '；' +
      '去重抑制 ' + suppressed.length + ' 簇 / ' + (n.dedupeHours || 0) + 'h）');
    process.exit(0);
  }

  const message = buildMessage(payload, picked, cfg);
  const uploadFiles = (n.uploadMd !== false && !args['skip-upload']) ? collectUploadFiles(classifiedFile, payload) : [];
  const dryRun = Boolean(args['dry-run']);

  if (dryRun) {
    console.log('[DRY-RUN] 分组 ' + groupId + '（' + apiBaseUrl.replace(/\/+$/, '') + '）');
    console.log('[DRY-RUN] 待推簇 ' + picked.length + ' 个 / ' + pickedCount + ' 条，抑制 ' + suppressed.length + ' 个');
    console.log('[DRY-RUN] 待传文件 ' + uploadFiles.length + ' 个：');
    for (const f of uploadFiles) console.log('           - ' + path.basename(f) + '（' + (fs.statSync(f).size / 1024).toFixed(1) + 'KB）');
    console.log('');
    console.log('---------- 消息正文 ----------');
    console.log(message);
    console.log('------------------------------');
    process.exit(0);
  }

  const retry = Number((push.data || {}).retry !== undefined ? push.data.retry : n.retry) || 0;
  const delayMs = Number(n.retryDelayMs) || 2000;

  const sendResult = await callApi(apiBaseUrl, '/send_group_msg', { group_id: groupId, message }, token, retry, delayMs);
  if (!sendResult.ok) {
    console.error('[FAIL] 发送群消息失败: ' + (sendResult.error || '未知原因'));
    process.exit(1);
  }
  console.log('[OK] 群消息已发送（' + picked.length + ' 簇 / ' + pickedCount + ' 条）');

  let uploaded = 0;
  const uploadFailed = [];
  for (const file of uploadFiles) {
    const name = path.basename(file);
    const b64 = fs.readFileSync(file).toString('base64');
    const r = await callApi(apiBaseUrl, '/upload_group_file', {
      group_id: groupId,
      file: 'base64://' + b64,
      name,
    }, token, retry, delayMs);
    if (r.ok) {
      uploaded += 1;
      console.log('[OK] 已上传 ' + name);
    } else {
      uploadFailed.push(name + '（' + (r.error || '未知原因') + '）');
    }
  }
  if (uploadFailed.length > 0) {
    console.error('[WARN] 部分文件上传失败: ' + uploadFailed.join('；'));
  }

  const now = Date.now();
  for (const c of picked) state.sent[c.errorHash] = now;
  state.lastPushAt = new Date(now).toISOString();
  const pruned = pruneSent(state, 30);
  writeJson(stateFile, state);

  console.log('[OK] 推送状态已更新（抑制表 ' + Object.keys(state.sent).length + ' 项，清理过期 ' + pruned + ' 项）');
  process.exit(uploadFailed.length > 0 ? 1 : 0);
}

main();