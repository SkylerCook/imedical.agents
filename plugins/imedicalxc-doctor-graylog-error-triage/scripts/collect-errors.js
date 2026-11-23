'use strict';
// Graylog 报错增量采集器（计划任务通道，直连 Views API）
// 采集范围：ERROR 报错 + 请求耗时 >= query.slowThresholdMs 的慢请求 WARN（两路并集，各自独立选择器）
// 水位线窗口 + ASC 分页 + 消息 id 去重 + traceId 邻域增强 + 原始 JSON 落盘
// 退出码: 0 成功（含 0 条新增）/ 1 取数或落盘失败 / 2 配置或连接不可用

const fs = require('node:fs');
const path = require('node:path');
const {
  loadConfig, resolvePath, pluginPath, resolveConnection, describeConnection,
} = require('./config-env');
const { normalizeMessage } = require('./lib/log-parse');
const { fetchWindow, enrichTracePeers, computeWindow } = require('../../graylog-toolkit/lib/graylog-client');
const { buildItem, pruneDedupe, pruneRawFiles } = require('../../graylog-toolkit/lib/items');

const BOOLEAN_FLAGS = new Set(['check', 'dry-run', 'help']);

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

function numArg(value, fallback) {
  if (value === true || value === undefined || value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function localParts(d) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hm: `${pad(d.getHours())}${pad(d.getMinutes())}`,
    hms: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    stamp: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
  };
}

function stateFile(cfg, envId) {
  const rel = (cfg.state || {}).file || 'config/graylog-triage-state.json';
  // 多个环境各注册一个计划任务时会同时触发，共用一个文件会互相覆盖水位线与去重表；
  // 配置里用 {env} 占位即可一环境一文件
  const name = rel.includes('{env}') ? rel.replace(/\{env\}/g, String(envId)) : rel;
  return pluginPath(name);
}

function loadState(cfg, envId) {
  const file = stateFile(cfg, envId);
  if (!fs.existsSync(file)) return { version: 1, envs: {}, dedupe: {} };
  try {
    // PowerShell 的 -Encoding UTF8 会写入 BOM，JSON.parse 遇 \uFEFF 会直接失败
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return { version: raw.version || 1, envs: raw.envs || {}, dedupe: raw.dedupe || {} };
  } catch (err) {
    // 读不到水位线就没有可信起点；按空状态跑会把水位线凭空推到 now，中间数据永久丢失
    console.error(`[FAIL] 状态文件无法解析，为避免误推水位线本轮中止: ${err.message}`);
    console.error(`       文件: ${file}`);
    console.error('       处理方式：删掉文件首行的 BOM 后重试；直接删除文件会退化为首轮，可能重复统计');
    process.exit(2);
  }
}

function saveState(cfg, state, envId) {
  const file = stateFile(cfg, envId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  if (args.env === true) {
    console.error('[ERROR] --env 缺少取值，示例：--env 87 或 --env=87');
    process.exit(2);
  }
  const envId = String(args.env || cfg.defaultEnv || '87');
  const envCfg = (cfg.environments || {})[envId];

  if (!envCfg) {
    console.error(`[ERROR] 未配置环境 ${envId}（见 config/graylog-triage.json 的 environments）`);
    process.exit(2);
  }
  if (envCfg.enabled === false) {
    console.log(`[SKIP] 环境 ${envId} 已禁用（environments.${envId}.enabled=false）`);
    process.exit(0);
  }

  const conn = resolveConnection(cfg, envId, { mcpConfig: args['mcp-config'] });

  if (args.check) {
    console.log(JSON.stringify({ env: envId, ...describeConnection(conn) }, null, 2));
    process.exit(conn.status === 'ready' ? 0 : 2);
  }
  if (conn.status !== 'ready') {
    console.error(`[ERROR] 连接不可用（${conn.status}）：${conn.detail}`);
    console.error('        先完成 IDE mcp.json 的 graylog-<env> 注册，或设置 GRAYLOG_<env>_URL / _TOKEN 环境变量');
    process.exit(2);
  }

  const now = Date.now();
  const state = loadState(cfg, envId);
  const envState = state.envs[envId] || {};
  const win = computeWindow(envCfg, envState, now);
  const runAt = new Date(now);
  const parts = localParts(runAt);
  const runId = `${envId}-${parts.stamp}`;

  console.log(`[INFO] 环境 ${envId} 窗口 ${win.from.toISOString()} → ${win.to.toISOString()}（${win.initial ? '首轮' : '增量'}，重叠 ${envCfg.overlapSeconds}s）`);

  let result;
  try {
    result = await fetchWindow(conn, envCfg, cfg, win, numArg(args.limit, 0));
  } catch (err) {
    console.error(`[FAIL] 取数失败，水位线保持不变: ${err.message}`);
    state.envs[envId] = { ...envState, lastRunAt: runAt.toISOString(), lastRunId: runId, lastError: err.message };
    if (!args['dry-run']) saveState(cfg, state, envId);
    process.exit(1);
  }

  const slow = result.slow || { messages: [], thresholdMs: 15000 };
  const slowRaw = Array.isArray(slow.messages) ? slow.messages : [];
  const peerMap = await enrichTracePeers(
    conn, envCfg, cfg, result.messages.concat(slowRaw).map((m) => normalizeMessage(m)), win,
  );

  if (result.truncated) {
    const missed = Math.max(0, (result.total || 0) - result.messages.length);
    console.warn(`[WARN] 本轮触达采集上限（${result.truncateReason}）：窗口内命中 ${result.total} 条，仅取回 ${result.messages.length} 条，缺口 ${missed} 条顺延下一轮`);
  }
  if (slow.truncated) {
    console.warn(`[WARN] 慢请求触达采集上限（${slow.truncateReason}）：命中 ${slow.total} 条，仅取回 ${slow.fetched} 条，水位线按已取位置推进`);
  }
  if (slow.error) console.warn(`[WARN] 本轮慢请求缺失（ERROR 采集不受影响）: ${slow.error}`);

  const items = [];
  let duplicateCount = 0;
  let noiseCount = 0;
  const ignoreRaw = ((cfg.filters || {}).ignoreMessageIncludes) || [];
  const ignoreList = (Array.isArray(ignoreRaw) ? ignoreRaw : [ignoreRaw]).map(String).filter(Boolean);
  const pushItem = (raw, kind) => {
    if (ignoreList.length > 0) {
      const msg = normalizeMessage(raw);
      const text = `${msg.message || ''}\n${msg.fullMessage || ''}`;
      if (ignoreList.some((s) => text.includes(s))) { noiseCount += 1; return; }
    }
    const item = buildItem(raw, cfg, { kind });
    if (item.traceId && peerMap.has(item.traceId)) item.tracePeers = peerMap.get(item.traceId);
    if (item.id && state.dedupe[item.id]) { duplicateCount += 1; return; }
    items.push(item);
    if (item.id) state.dedupe[item.id] = now;
  };
  for (const raw of result.messages) pushItem(raw, 'error');
  for (const raw of slowRaw) pushItem(raw, 'slow');

  const pruned = pruneDedupe(
    state,
    { hours: (cfg.state || {}).dedupeTtlHours, days: (cfg.state || {}).dedupeTtlDays },
    (cfg.state || {}).dedupeMaxEntries,
  );
  const hashCount = new Map();
  for (const it of items) {
    if (it.kind === 'slow') continue;
    hashCount.set(it.errorHash, (hashCount.get(it.errorHash) || 0) + 1);
  }
  const exceptionTop = [...hashCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([key, count]) => ({ errorHash: key, count }));

  const slowAgg = new Map();
  for (const it of items) {
    if (it.kind !== 'slow') continue;
    const cur = slowAgg.get(it.errorHash) || {
      errorHash: it.errorHash, interfaceName: it.interfaceName, count: 0, maxMs: 0,
    };
    cur.count += 1;
    cur.maxMs = Math.max(cur.maxMs, Number(it.durationMs) || 0);
    slowAgg.set(it.errorHash, cur);
  }
  const slowTop = [...slowAgg.values()].sort((a, b) => b.maxMs - a.maxMs).slice(0, 10);
  const slowNewCount = items.filter((it) => it.kind === 'slow').length;

  const payload = {
    runId, env: envId, generatedAt: runAt.toISOString(),
    window: { from: win.from.toISOString(), to: win.to.toISOString(), initial: win.initial },
    queryUsed: result.queryUsed,
    slowQueryUsed: slow.queryUsed || '',
    slow: {
      thresholdMs: slow.thresholdMs,
      total: slow.total || 0,
      fetched: slow.fetched || 0,
      kept: slow.kept || 0,
      newCount: slowNewCount,
      truncated: Boolean(slow.truncated),
      truncateReason: slow.truncateReason || '',
      disabled: Boolean(slow.disabled),
      error: slow.error || '',
    },
    total: result.total, fetched: result.messages.length, cap: result.cap,
    newCount: items.length, duplicateCount, noiseFiltered: noiseCount,
    truncated: result.truncated, truncateReason: result.truncateReason,
    dedupePruned: pruned, dedupeSize: Object.keys(state.dedupe).length,
    exceptionTop, slowTop, items,
  };

  const truncNote = result.truncated ? `（截断:${result.truncateReason}）` : '';
  console.log(`[INFO] 报错命中 ${result.total} 条，取回 ${result.messages.length} 条${truncNote}`);
  if (slow.disabled) {
    console.log('[INFO] 慢请求采集未启用（query.slowSelector 为空）');
  } else {
    console.log(`[INFO] 慢请求（>=${Math.round((slow.thresholdMs || 15000) / 1000)}s）命中 ${slow.total || 0} 条，取回 ${slow.fetched || 0} 条，达标 ${slow.kept || 0} 条`);
  }
  console.log(`[INFO] 本轮新增 ${items.length} 条（报错 ${items.length - slowNewCount} / 慢请求 ${slowNewCount}），重叠重复 ${duplicateCount} 条`);
  if (noiseCount > 0) console.log(`[INFO] 噪音过滤 ${noiseCount} 条（命中 filters.ignoreMessageIncludes，不落盘、不进入巡检结果）`);

  const outDir = resolvePath(cfg, path.join((cfg.output || {}).dir || 'docs/agent-reports/graylog-triage', envId, parts.date));
  const outFile = path.join(outDir, `raw-errors-${parts.hm}.json`);

  if (args['dry-run']) {
    console.log(`[DRY-RUN] 不落盘、不推进水位线；原本将写入 ${outFile}`);
    console.log(JSON.stringify({ ...payload, items: payload.items.slice(0, 3) }, null, 2));
    process.exit(0);
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
    if (fs.existsSync(outFile) && (cfg.output || {}).preserveExisting !== false) {
      console.warn(`[WARN] 本轮文件已存在，覆盖写入（同为 ${parts.hm} 分的时间窗）: ${outFile}`);
    }
    fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`[FAIL] 落盘失败，水位线保持不变: ${err.message}`);
    state.envs[envId] = { ...envState, lastRunAt: runAt.toISOString(), lastRunId: runId, lastError: `write: ${err.message}` };
    saveState(cfg, state, envId);
    process.exit(1);
  }

  let nextCursor = win.to.toISOString();
  let cursorNote = '推进到窗口结束';
  const truncLastTs = [];
  if (result.truncated && result.messages.length > 0) {
    truncLastTs.push(result.messages[result.messages.length - 1].timestamp);
  }
  if (slow.truncated && slow.lastTs) truncLastTs.push(slow.lastTs);
  if (truncLastTs.length > 0) {
    // 两路取更早的那个：只按一路推进会把另一路没取完的数据甩在水位线之后，永久丢失
    const lastMs = Date.parse(truncLastTs.filter(Boolean).sort()[0]);
    if (Number.isFinite(lastMs)) {
      nextCursor = new Date(lastMs + 1).toISOString();
      cursorNote = '截断，推进到两路中更早的已取最后一条 +1ms';
    }
  }

  const nextMs = Date.parse(nextCursor);
  const lagSeconds = Number.isFinite(nextMs) ? Math.max(0, Math.round((now - nextMs) / 1000)) : 0;

  state.envs[envId] = {
    ...envState,
    cursor: nextCursor,
    lastRunAt: runAt.toISOString(),
    lastRunId: runId,
    lastRawFile: outFile,
    lastError: '',
    lagSeconds,
    dedupeSize: Object.keys(state.dedupe).length,
  };
  saveState(cfg, state, envId);

  const rawRoot = resolvePath(cfg, (cfg.output || {}).dir || 'docs/agent-reports/graylog-triage');
  const rawPruned = pruneRawFiles(rawRoot, (cfg.output || {}).rawKeepDays);

  console.log(`[OK] 原始数据: ${outFile}`);
  console.log(`[OK] 水位线: ${nextCursor}（${cursorNote}）`);
  if (lagSeconds >= 60) {
    console.warn(`[WARN] 水位线落后实时约 ${Math.round(lagSeconds / 60)} 分钟；持续落后说明单轮采集能力不足，需提高 environments.${envId}.maxMessagesPerRun 或缩短采集间隔`);
  }
  if (rawPruned > 0) console.log(`[INFO] 清理过期原始数据 ${rawPruned} 个（output.rawKeepDays=${(cfg.output || {}).rawKeepDays}）`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[FAIL] 采集异常: ${err.message}`);
  process.exit(1);
});