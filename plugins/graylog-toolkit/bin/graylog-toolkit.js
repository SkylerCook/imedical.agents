#!/usr/bin/env node
'use strict';
// graylog-toolkit 薄 CLI：给没有 Node 代码的智能体插件/脚本用的 JSON 输入输出封装。
// 子命令：validate-config / collect / classify / locate
// 退出码：0 成功 / 1 运行或落盘失败 / 2 配置或连接不可用

const fs = require('node:fs');
const path = require('node:path');
const {
  createContext, loadConfigFile, resolveConnection, describeConnection,
} = require('../lib/config');
const { fetchWindow, computeWindow } = require('../lib/graylog-client');
const { normalizeMessage } = require('../lib/log-parse');
const { buildItem } = require('../lib/items');
const { buildIndex } = require('../lib/owner-index');
const {
  buildClusters, groupClusters, ignoreIncludes, isIgnoredItem,
} = require('../lib/classify');
const { locateLogSites } = require('../lib/log-site-locate');

const BOOLEAN_FLAGS = new Set(['help', 'quiet']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) { args[body.slice(0, eq)] = body.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(body) && next !== undefined && !next.startsWith('--')) {
      args[body] = next; i += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function usage() {
  console.log(`graylog-toolkit <command> [options]

命令:
  validate-config  --config <file> [--repo-root <dir>]
  collect          --config <file> --env <id> [--from ISO] [--to ISO] [--limit N]
                   [--out <file>] [--mcp-config <file>] [--repo-root <dir>] [--quiet]
  classify         --config <file> --raw <raw.json> [--out <file>] [--repo-root <dir>] [--quiet]
  locate           --config <file> --classified <classified.json> [--raw <raw.json>]
                   [--out <file>] [--repo-root <dir>] [--quiet]

说明:
  collect 不维护水位线，--from/--to 缺省时从 config.environments.<env>.initialLookbackMinutes 回看；
  水位线、去重、报告渲染属于消费方职责，不在本 CLI 内。
  连接信息只从 IDE mcp.json 或 GRAYLOG_<ENV>_URL/_TOKEN/_COOKIE 环境变量读取，不落盘。`);
}

function fail(msg, code = 1) {
  console.error(`[FAIL] ${msg}`);
  process.exit(code);
}

function ctxOf(cfg, args) {
  const repoRoot = typeof args['repo-root'] === 'string'
    ? path.resolve(args['repo-root'])
    : (cfg.repoRoot ? path.resolve(cfg.repoRoot) : process.cwd());
  const settingsPath = typeof args.settings === 'string'
    ? path.resolve(args.settings)
    : (cfg.settingsPath ? path.resolve(cfg.settingsPath) : undefined);
  return createContext({ repoRoot, settingsPath, settingsKey: cfg.settingsKey });
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`${label}读取失败 ${file}: ${err.message}`);
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (err) {
    fail(`落盘失败 ${file}: ${err.message}`);
  }
}

function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  const envs = cfg.environments || {};
  if (Object.keys(envs).length === 0) errors.push('environments 为空：至少配置一个环境');
  for (const [id, e] of Object.entries(envs)) {
    if (e.enabled === false) continue;
    if (!e.urlEnv && !e.mcpServer) warnings.push(`environments.${id} 未配置 urlEnv/mcpServer，将按 GRAYLOG_${id}_URL 约定读取`);
  }
  const q = cfg.query || {};
  if (!q.errorSelector) errors.push('query.errorSelector 缺失：无法构造 ERROR 查询');
  if (!q.slowSelector) warnings.push('query.slowSelector 为空：慢请求一路将被禁用');
  if (q.slowThresholdMs && Number(q.slowThresholdMs) <= 0) errors.push('query.slowThresholdMs 必须为正数');
  const og = cfg.ownerGroups || {};
  if (!og.self || !Array.isArray(og.self.repos)) errors.push('ownerGroups.self.repos 缺失：归属判定无法扫描本组仓库');
  for (const g of ['self', 'infra']) {
    const mods = og[g] && og[g].modules;
    if (mods !== undefined && !Array.isArray(mods)) errors.push(`ownerGroups.${g}.modules 必须是数组`);
  }
  if (og.external && typeof og.external !== 'object') errors.push('ownerGroups.external 必须是对象');
  const d = cfg.disposition || {};
  for (const k of ['businessExceptionClasses', 'runtimeExceptionClasses', 'externalCallClasses', 'escalationKeywords']) {
    if (d[k] !== undefined && !Array.isArray(d[k])) errors.push(`disposition.${k} 必须是数组`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

async function cmdCollect(cfg, args, ctx) {
  const envId = String(args.env || cfg.defaultEnv || '');
  const envCfg = (cfg.environments || {})[envId];
  if (!envCfg) fail(`未配置环境 ${envId}（config.environments 中不存在）`, 2);
  if (envCfg.enabled === false) fail(`环境 ${envId} 已禁用（enabled=false）`, 2);

  const conn = resolveConnection(ctx, cfg, envId, { mcpConfig: args['mcp-config'] });
  if (conn.status !== 'ready') {
    console.error(JSON.stringify({ env: envId, ...describeConnection(conn) }, null, 2));
    fail(`连接不可用（${conn.status}）：${conn.detail}`, 2);
  }

  const now = Date.now();
  let win;
  if (typeof args.from === 'string' && typeof args.to === 'string') {
    win = { from: new Date(args.from), to: new Date(args.to), initial: false };
  } else {
    win = computeWindow(envCfg, {}, now);
  }
  if (!(win.from instanceof Date) || Number.isNaN(win.from.getTime())
    || !(win.to instanceof Date) || Number.isNaN(win.to.getTime())) {
    fail('--from/--to 不是合法时间，示例：2026-11-22T00:00:00Z', 2);
  }

  const limit = Number(args.limit) > 0 ? Number(args.limit) : undefined;
  const result = await fetchWindow(conn, envCfg, cfg, win, limit);
  const slowRaw = Array.isArray((result.slow || {}).messages) ? result.slow.messages : [];
  const includes = ignoreIncludes(cfg);
  const seen = new Set();
  const items = [];
  let duplicateCount = 0;
  let noiseCount = 0;
  const push = (raw, kind) => {
    const msg = normalizeMessage(raw);
    if (includes.length > 0 && includes.some((s) => `${msg.message}\n${msg.fullMessage}`.includes(s))) {
      noiseCount += 1;
      return;
    }
    const item = buildItem(raw, cfg, { kind });
    if (item.id && seen.has(item.id)) { duplicateCount += 1; return; }
    if (item.id) seen.add(item.id);
    items.push(item);
  };
  for (const raw of result.messages) push(raw, 'error');
  for (const raw of slowRaw) push(raw, 'slow');

  const payload = {
    env: envId,
    generatedAt: new Date(now).toISOString(),
    window: { from: win.from.toISOString(), to: win.to.toISOString(), initial: Boolean(win.initial) },
    queryUsed: result.queryUsed,
    truncated: result.truncated,
    truncateReason: result.truncateReason,
    slow: {
      thresholdMs: (result.slow || {}).thresholdMs,
      kept: (result.slow || {}).kept || 0,
      disabled: Boolean((result.slow || {}).disabled),
      error: (result.slow || {}).error || '',
    },
    fetched: result.messages.length + slowRaw.length,
    newCount: items.length,
    duplicateCount,
    noiseFiltered: noiseCount,
    items,
  };

  if (typeof args.out === 'string') {
    writeJson(path.resolve(args.out), payload);
    if (!args.quiet) console.log(`[OK] 已写入 ${args.out}（${items.length} 条）`);
  } else if (!args.quiet) {
    console.log(JSON.stringify({ ...payload, items: items.slice(0, 3) }, null, 2));
  }
  return payload;
}

function cmdClassify(cfg, args, ctx) {
  if (typeof args.raw !== 'string') fail('缺少 --raw <raw.json>', 2);
  const rawFile = path.resolve(args.raw);
  const payload = readJson(rawFile, '原始采集文件');
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const includes = ignoreIncludes(cfg);
  const items = rawItems.filter((it) => !isIgnoredItem(it, includes));
  const index = buildIndex(cfg, { repoRoot: ctx.repoRoot });
  const clusters = buildClusters(items, index, cfg);
  const groups = groupClusters(clusters, cfg);
  const out = {
    env: payload.env || '',
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(rawFile),
    window: payload.window || null,
    stats: {
      items: items.length,
      filteredNoise: rawItems.length - items.length,
      clusters: clusters.length,
      p0: clusters.filter((c) => c.severity === 'P0').length,
      p1: clusters.filter((c) => c.severity === 'P1').length,
      self: groups.self.clusters.length,
      infra: groups.infra.clusters.length,
      externalGroups: groups.external.length,
      externalClusters: groups.external.reduce((s, g) => s + g.clusters.length, 0),
      unrelated: groups.unrelated.clusters.length,
      unknown: groups.unknown.clusters.length,
    },
    groups,
  };
  const outFile = typeof args.out === 'string'
    ? path.resolve(args.out)
    : path.join(path.dirname(rawFile), `classified-${path.basename(rawFile).replace(/^raw-errors-/, '').replace(/\.json$/, '')}.json`);
  writeJson(outFile, out);
  if (!args.quiet) {
    const s = out.stats;
    console.log(`[OK] 簇 ${s.clusters} 个 → 本组 ${s.self} / 基础设施 ${s.infra} / 他组 ${s.externalGroups} 组共 ${s.externalClusters} / 无关 ${s.unrelated} / 待定 ${s.unknown}；P0 ${s.p0} / P1 ${s.p1}`);
    console.log(`[OK] 已写入 ${outFile}`);
  }
  return out;
}

function cmdLocate(cfg, args, ctx) {
  if (typeof args.classified !== 'string') fail('缺少 --classified <classified.json>', 2);
  const classified = readJson(path.resolve(args.classified), '分类结果');
  const rawIndex = new Map();
  if (typeof args.raw === 'string') {
    const raw = readJson(path.resolve(args.raw), '原始采集文件');
    for (const it of raw.items || []) rawIndex.set(it.id, it);
  }
  const selfClusters = (((classified.groups || {}).self || {}).clusters) || [];
  const targets = selfClusters
    .filter((c) => c.kind !== 'slow' && !c.source && c.evidenceLevel !== 'module-frame')
    .map((c) => {
      let loggerName = '';
      for (const s of (c.samples || []).slice(0, 4)) {
        const rawItem = rawIndex.get(s.id);
        if (rawItem && rawItem.loggerName) { loggerName = String(rawItem.loggerName); break; }
      }
      return { ...c, loggerName };
    });
  const hits = locateLogSites(cfg, targets, { repoRoot: ctx.repoRoot });
  const out = {};
  for (const [hash, hit] of hits) {
    out[hash] = {
      file: hit.best.file, line: hit.best.line, level: hit.best.level, scope: hit.best.scope,
      loggerScoped: Boolean(hit.loggerScoped),
      ambiguous: Boolean(hit.ambiguous),
      alternatives: hit.alternatives || [],
    };
  }
  if (typeof args.out === 'string') {
    writeJson(path.resolve(args.out), out);
    if (!args.quiet) console.log(`[OK] 定位 ${hits.size}/${targets.length} 簇，已写入 ${args.out}`);
  } else if (!args.quiet) {
    console.log(JSON.stringify(out, null, 2));
  }
  return out;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') { usage(); process.exit(0); }
  const args = parseArgs(rest);
  if (typeof args.config !== 'string') fail('缺少 --config <file>（见 config/example.config.json）', 2);

  let cfg;
  try {
    cfg = loadConfigFile(args.config);
  } catch (err) {
    fail(err.message, 2);
  }
  const ctx = ctxOf(cfg, args);

  if (command === 'validate-config') {
    const res = validateConfig(cfg);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 2);
  }
  if (command === 'collect') { await cmdCollect(cfg, args, ctx); return; }
  if (command === 'classify') { cmdClassify(cfg, args, ctx); return; }
  if (command === 'locate') { cmdLocate(cfg, args, ctx); return; }
  console.error(`[ERROR] 未知命令: ${command}`);
  usage();
  process.exit(2);
}

main().catch((err) => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(1);
});
