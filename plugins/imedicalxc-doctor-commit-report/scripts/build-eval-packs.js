#!/usr/bin/env node
'use strict';

/*
 * build-eval-packs.js — 周报评估包构建（确定性）
 *
 * 把采集/分类/取证产物切成适合子 Agent 批读的小包：
 *   --kind eval            只为【流程修改 / 业务调整】提交建包，含证据摘要（entrypoints / 界面证据 /
 *                          兄弟证据 / 常量反查 / diffstat）与关键 diff 摘录，每包 8~10 条、≤40KB。
 *   --kind classification  为窗口内全部提交建包（30 条/包），含提交摘要与文件改动，供分类子 Agent 判读。
 *
 * 主 Agent 只读本脚本的控制台摘要与 index.json，不把 code-impact / front-chains 大文件读进上下文。
 *
 * 用法：见 USAGE。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const lib = require('./eval-pack-lib');

const USAGE = `用法: node build-eval-packs.js --label LABEL [--kind eval|classification] [--dir <输出目录>]
  --label            期号（与 raw-commits-<label>.json 等产物同名）
  --kind             eval（默认，流程修改/业务调整）| classification（全部提交）
  --dir              产物目录，默认 <config.outputDir>/<label>
  --packs-dir        包输出目录，默认 <dir>/eval-packs 或 <dir>/classify-packs
  --raw-commits      覆盖采集产物路径
  --classification   覆盖分类检查点路径（--kind eval 需要）
  --code-impact      覆盖后端取证产物路径（可选）
  --front-chains     覆盖前端界面证据产物路径（可选）
  --pack-size        每包提交数，默认 eval=config.batching.evalSize(9)、classification=classificationSize(30)
  --req-types        逗号分隔的评估范围，默认取 config.batching.evaluationReqTypes
  --max-diff-lines   每条提交 diff 摘录上限，默认 config.batching.maxDiffLines(40)
  --max-pack-bytes   单包字节上限，默认 config.batching.maxPackBytes(40960)
  --no-diff          不生成 diff 摘录（只读 git 的替代方案）
输出: <packs-dir>/batch-NN.json + index.json（UTF-8 无 BOM）+ 控制台摘要`;

const DEFAULTS = {
  classificationSize: 30,
  evalSize: 9,
  evaluationReqTypes: ['流程修改', '业务调整'],
  maxDiffLines: 40,
  maxPackBytes: 40960
};

function batchingConfig(config) {
  return { ...DEFAULTS, ...((config && config.batching) || {}) };
}

function batchName(index) {
  return `batch-${String(index).padStart(2, '0')}`;
}

function filesDigest(commit, cap) {
  const files = Array.isArray(commit.files) ? commit.files : [];
  const rows = files.slice(0, cap).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions }));
  const out = { files: rows, fileCount: commit.fileCount != null ? commit.fileCount : files.length };
  if (files.length > cap) out.moreFiles = files.length - cap;
  return out;
}

function diffExcerpt(commit, maxLines) {
  if (!maxLines) return null;
  const repoAbs = path.join(lib.REPO_ROOT, commit.repo || '');
  if (!commit.repo || !fs.existsSync(repoAbs)) return { error: 'repo-unavailable' };
  let out;
  try {
    out = execFileSync('git', ['-C', repoAbs, 'show', '--no-color', '--format=', '--unified=1', commit.hash], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
  } catch (e) {
    return { error: 'show-failed' };
  }
  const kept = [];
  let sliced = false;
  for (const line of out.split(/\r?\n/)) {
    const isHeader = /^diff --git /.test(line) || /^@@/.test(line) || /^new file mode/.test(line) || /^deleted file mode/.test(line) || /^Binary files /.test(line);
    const isChange = /^[+-](?![+-])/.test(line);
    if (!isHeader && !isChange) continue;
    const clipped = line.length > 200 ? `${line.slice(0, 200)}…` : line;
    if (clipped !== line) sliced = true;
    kept.push(clipped);
    if (kept.length >= maxLines + 1) break;
  }
  const truncated = kept.length > maxLines || sliced;
  return { lines: kept.slice(0, maxLines), truncated };
}

function uiEntryDigest(entry) {
  const element = entry.element && typeof entry.element === 'object'
    ? { id: entry.element.id || '', label: entry.element.label || '', event: entry.element.event || '' }
    : { id: '', label: String(entry.element || ''), event: '' };
  const access = entry.access || {};
  const menus = (access.menus || []).slice(0, 1).map((m) => ({ name: m.name || '', parentPath: m.parentPath || '', mode: m.mode || '' }));
  const parents = (access.parents || []).slice(0, 1).map((p) => ({ page: p.page || '', type: p.type || '', element: p.element || '', elementLabel: p.elementLabel || '' }));
  const req = entry.request || {};
  const backend = entry.backend || {};
  return {
    page: entry.page || '',
    pageTitle: entry.pageTitle || '',
    source: entry.source || '',
    attribution: entry.attribution || '',
    element,
    request: { method: req.method || '', paths: (req.paths || []).slice(0, 2) },
    access: { confidence: access.confidence || 'none', menus, parents },
    backend: { controller: backend.controllerShort || '', method: backend.method || '', http: backend.http || '' }
  };
}

// 每页取一条最佳证据：调用链越短越贴近按钮（jsPath 步数），同深度优先落库类方法；
// 页面按「菜单置信度 → 直接入口方法数（jsPath ≤3）→ 全部入口方法数」排序，
// 避免名额被同源页面按字母顺序或共享函数的长链噪声占满。
const WRITE_VERB = /(save|insert|update|delete|del|submit|send|create)/i;

function selectTopUi(entries, limit) {
  const confRank = { menu: 0, parent: 1, none: 2 };
  const attrRank = { direct: 0, load: 1, indirect: 2, heuristic: 3 };
  const sourceRank = (source) => (String(source).startsWith('page_load') ? 1 : 0);
  const pathLen = (entry) => {
    const steps = entry.jsPath || [];
    return steps.length ? steps.length : 99;
  };
  const entryRank = (entry, index) => {
    const backend = entry.backend || {};
    const paths = (entry.request && entry.request.paths) || [];
    const writeLike = WRITE_VERB.test(`${backend.method || ''} ${paths.join(' ')}`) ? 0 : 1;
    return [
      confRank[(entry.access && entry.access.confidence) || 'none'] ?? 2,
      sourceRank(entry.source),
      attrRank[entry.attribution] ?? 2,
      pathLen(entry),
      writeLike,
      index
    ];
  };
  const rankLess = (a, b) => {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  };
  const pageStats = new Map();
  const bestOf = new Map();
  (entries || []).forEach((entry, index) => {
    const page = entry.page || '';
    if (!page) return;
    const ep = entry.entrypoint || entry.backend || {};
    const epKey = [ep.controller || '', ep.method || ''].join('.');
    if (!pageStats.has(page)) pageStats.set(page, { eps: new Set(), directEps: new Set(), best: null });
    const stat = pageStats.get(page);
    if (epKey !== '.') {
      stat.eps.add(epKey);
      if (pathLen(entry) <= 3) stat.directEps.add(epKey);
    }
    const rank = entryRank(entry, index);
    if (!stat.best || rankLess(rank, stat.best)) stat.best = rank;
    const prev = bestOf.get(page);
    if (!prev || rankLess(rank, prev.rank)) bestOf.set(page, { entry, rank });
  });
  const pages = [...pageStats.keys()].sort((a, b) => {
    const sa = pageStats.get(a);
    const sb = pageStats.get(b);
    return sa.best[0] - sb.best[0]
      || sb.directEps.size - sa.directEps.size
      || sb.eps.size - sa.eps.size
      || sa.best[1] - sb.best[1]
      || a.localeCompare(b);
  });
  return pages.slice(0, limit).map((page) => uiEntryDigest(bestOf.get(page).entry));
}

function entrypointDigest(entry) {
  return {
    kind: entry.kind || '',
    service: entry.service || '',
    controller: entry.controller || '',
    http: entry.http || '',
    heuristic: !!entry.heuristic,
    indirect: !!entry.indirect,
    reverse: entry.reverse || ''
  };
}

function contractDigest(contract) {
  if (!contract) return null;
  const typeFiles = (contract.typeFiles || []).map(String);
  return {
    feignInterfaces: (contract.feignInterfaces || []).filter(Boolean).length,
    typeFiles: typeFiles.length,
    poTypeFiles: typeFiles.filter((f) => /(?:^|\/)[^/]*PO\.java$/.test(f)).slice(0, 4),
    typeFeignMatches: (contract.typeFeignMatches || []).length,
    typeFeignCallers: (contract.typeFeignCallers || []).length,
    typeControllerMatches: (contract.typeControllerMatches || []).length,
    typeUsageEntrypoints: (contract.typeUsageEntrypoints || []).length
  };
}

// 高风险二类 / 三类的机械触发条件（与 SKILL 步骤 ④ 判定表同口径）；一类只给候选，需语义确认
const CLASS1_ENTRY_RE = /saveOeOrdItem|stopOrd|stopOrder|register|appointment|accept|advisor|diagnose|presc/i;

function riskFlags(impact, thresholds) {
  if (!impact) return null;
  const t = { methods: 5, entrypoints: 10, crossServiceCallers: 5, externalCallers: 5, ...thresholds };
  const contract = impact.contract || {};
  const crossService = (impact.workspaceCallers || []).filter((w) => w && w.sameService === false).length;
  const class2 = [];
  if ((contract.feignInterfaces || []).filter(Boolean).length) class2.push('feign-contract');
  if (crossService > 0) class2.push('cross-service-workspace-caller');
  if ((impact.externalCallers || []).length) class2.push('external-caller');
  if (((contract.typeFiles || []).map(String)).some((f) => /(?:^|\/)[^/]*PO\.java$/.test(f))) class2.push('po-type');
  const class3 = [];
  const methods = (impact.methods || []).length;
  const entrypoints = (impact.entrypoints || []).length;
  const external = (impact.externalCallers || []).length;
  if (methods >= t.methods) class3.push(`methods>=${t.methods}`);
  if (entrypoints >= t.entrypoints) class3.push(`entrypoints>=${t.entrypoints}`);
  if (crossService >= t.crossServiceCallers) class3.push(`crossServiceCallers>=${t.crossServiceCallers}`);
  if (external >= t.externalCallers) class3.push(`externalCallers>=${t.externalCallers}`);
  if ((impact.truncatedMethods || []).length) class3.push('truncated-methods');
  const class1Candidates = [];
  for (const ep of (impact.entrypoints || []).slice(0, 10)) {
    const text = `${ep.controller || ''} ${ep.feign || ''} ${ep.http || ''}`;
    if (CLASS1_ENTRY_RE.test(text)) {
      const name = ep.controller || ep.feign || ep.http;
      if (name && !class1Candidates.includes(name)) class1Candidates.push(name);
    }
  }
  return {
    class1Candidates: class1Candidates.slice(0, 4),
    class2,
    class3,
    thresholds: t
  };
}

function reverseProbeDigest(probe) {
  if (!probe) return null;
  // 取证脚本写的是计数（reverseProbe.entrypoints = 补入口个数），入口明细已并入顶层 entrypoints
  const arr = (value) => (Array.isArray(value) ? value : []);
  const count = (value) => (Array.isArray(value) ? value.length : (Number(value) || 0));
  return {
    constants: arr(probe.constants).map((c) => ({
      class: c.class || '',
      stCode: c.stCode || '',
      fields: arr(c.fields).slice(0, 6),
      items: c.items || {}
    })),
    consumers: arr(probe.consumers).slice(0, 6).map((c) => ({ method: c.method || '', line: c.line || 0, inGraph: !!c.inGraph })),
    analyzedMethods: count(probe.analyzedMethods),
    entrypointCount: count(probe.entrypoints),
    entrypoints: arr(probe.entrypoints).slice(0, 6).map(entrypointDigest),
    unmatchedConsumers: count(probe.unmatchedConsumers)
  };
}

function unitIndex(rawCommits, frontMap) {
  const map = new Map();
  for (const c of rawCommits) {
    const unit = lib.unitIdOf(c);
    if (!unit) continue;
    const front = frontMap.get(c.hash) || {};
    if (!map.has(unit)) map.set(unit, []);
    map.get(unit).push({ hash: c.hash, subject: c.subject || '', pages: lib.uiPages(front), uiEntries: front.uiEntries || [] });
  }
  return map;
}

function siblingEvidence(commit, unit, unitMap) {
  if (!unit) return null;
  const members = unitMap.get(unit) || [];
  const others = members.filter((m) => m.hash !== commit.hash && m.pages.length > 0);
  if (!others.length) return null;
  const rows = [];
  for (const m of others.slice(0, 2)) {
    for (const entry of m.uiEntries.slice(0, 3)) {
      const access = entry.access || {};
      rows.push({
        hash: m.hash,
        page: entry.page || '',
        pageTitle: entry.pageTitle || '',
        element: entry.element || null,
        confidence: access.confidence || 'none',
        attribution: entry.attribution || '',
        menus: (access.menus || []).slice(0, 1).map((x) => ({ name: x.name || '', parentPath: x.parentPath || '' })),
        parentPages: (access.parents || []).slice(0, 1).map((x) => x.page || '')
      });
    }
  }
  return { unitId: unit, sourceHashes: others.slice(0, 2).map((m) => m.hash), entries: rows.slice(0, 5) };
}

function buildDigest(commit, options) {
  const { impact, front, coverage, unitMap, riskThresholds } = options;
  const unit = lib.unitIdOf(commit);
  const counts = lib.evidenceCounts(impact);
  const ui = lib.uiCounts(front);
  const fresh = lib.commitFrontFresh(coverage, commit.date);
  const sibling = siblingEvidence(commit, unit, unitMap);
  const pages = lib.uiPages(front);
  let gapReason = front.uiGapReason || '';
  if (!gapReason && (!front.uiEntries || !front.uiEntries.length)) {
    if (fresh === false) gapReason = 'index-stale';
    else if (sibling) gapReason = 'sibling-only';
  }
  const codegraph = {};
  if (impact) {
    codegraph.confidence = impact.confidence || '';
    codegraph.indexFresh = impact.indexFresh;
    codegraph.methods = (impact.methods || []).slice(0, 3).map((m) => ({ classMethod: m.classMethod || '', file: m.file || '', changedLines: m.changedLines || 0 }));
    codegraph.counts = counts;
    codegraph.entrypoints = (impact.entrypoints || []).slice(0, 6).map(entrypointDigest);
    codegraph.workspaceCallers = (impact.workspaceCallers || []).slice(0, 2).map((w) => ({ service: w.service || '', module: w.module || '', caller: w.caller || '', sameService: !!w.sameService }));
    codegraph.externalCallers = (impact.externalCallers || []).slice(0, 2).map((w) => ({ service: w.service || '', module: w.module || '', caller: w.caller || '', controller: w.controller || '', path: w.path || '' }));
    codegraph.downstreamFeigns = (impact.downstreamFeigns || []).slice(0, 2).map((f) => ({ feign: f.feign || '', method: f.method || '', caller: f.caller || '' }));
    if (impact.skippedFiles && impact.skippedFiles.length) {
      const reasons = {};
      for (const s of impact.skippedFiles) reasons[s.reason || 'unknown'] = (reasons[s.reason || 'unknown'] || 0) + 1;
      codegraph.skipped = reasons;
    }
    if (impact.coverage) {
      codegraph.coverage = {
        methodsInGraph: impact.coverage.methodsInGraph,
        skippedReasons: impact.coverage.skippedReasons,
        skippedReasonLabels: impact.coverage.skippedReasonLabels,
        reverseProbeUsed: impact.coverage.reverseProbeUsed
      };
    }
    const probe = reverseProbeDigest(impact.reverseProbe);
    if (probe) codegraph.reverseProbe = probe;
    const contract = contractDigest(impact.contract);
    if (contract) codegraph.contract = contract;
    const flags = riskFlags(impact, riskThresholds);
    if (flags) codegraph.riskFlags = flags;
  }
  const uiDigest = {
    coverage: {
      builtAt: coverage && coverage.builtAt,
      coveredUntil: coverage && coverage.coveredUntil,
      checkoutStale: coverage && coverage.checkoutStale
    },
    frontIndexFresh: fresh,
    uiGapReason: gapReason,
    counts: ui,
    pageCount: pages.length,
    pages: pages.slice(0, 8),
    pageTitles: lib.uiPageTitles(front).slice(0, 6),
    uiEntriesTop5: selectTopUi(front.uiEntries, 4),
    unmatchedEntrypoints: (front.unmatchedEntrypoints || []).slice(0, 2).map((u) => ({ controller: u.controller || '', http: u.http || '', reason: u.reason || '' }))
  };
  if (sibling) uiDigest.siblingEvidence = sibling;
  return { codegraph, ui: uiDigest };
}

function classifyDraft(cls) {
  if (!cls) return null;
  return {
    workstation: cls.workstation || '',
    reqType: cls.reqType || '',
    priority: cls.priority || '',
    summary: cls.summary || '',
    funcPoint: cls.funcPoint || ''
  };
}

// 与 lib.writeJson 同序列化（1 空格缩进 + 换行），按落盘字节计
function packBytes(pack) {
  return Buffer.byteLength(`${JSON.stringify(pack, null, 1)}\n`, 'utf8');
}

function shrinkToFit(pack, maxBytes) {
  const size = () => packBytes(pack);
  if (size() <= maxBytes) return pack;
  const steps = [
    () => pack.commits.forEach((c) => { if (c.diffExcerpt && c.diffExcerpt.lines) c.diffExcerpt.lines = c.diffExcerpt.lines.slice(0, 20); }),
    () => pack.commits.forEach((c) => { if (c.diffExcerpt && c.diffExcerpt.lines) c.diffExcerpt.lines = c.diffExcerpt.lines.slice(0, 10); }),
    () => pack.commits.forEach((c) => { if (c.diffExcerpt) c.diffExcerpt = { lines: [], truncated: true }; }),
    () => pack.commits.forEach((c) => {
      const ui = c.evidenceDigest && c.evidenceDigest.ui;
      if (ui && ui.uiEntriesTop5) ui.uiEntriesTop5 = ui.uiEntriesTop5.slice(0, 3);
    }),
    () => pack.commits.forEach((c) => {
      const ui = c.evidenceDigest && c.evidenceDigest.ui;
      if (ui && ui.pageTitles) ui.pageTitles = ui.pageTitles.slice(0, 4);
      if (ui && ui.pages) ui.pages = ui.pages.slice(0, 4);
    }),
    () => pack.commits.forEach((c) => {
      const cg = c.evidenceDigest && c.evidenceDigest.codegraph;
      if (cg && cg.entrypoints) cg.entrypoints = cg.entrypoints.slice(0, 3);
      if (cg && cg.methods) cg.methods = cg.methods.slice(0, 2);
    }),
    () => pack.commits.forEach((c) => {
      const ui = c.evidenceDigest && c.evidenceDigest.ui;
      if (ui && ui.uiEntriesTop5) ui.uiEntriesTop5 = ui.uiEntriesTop5.slice(0, 2);
      if (ui && ui.unmatchedEntrypoints) ui.unmatchedEntrypoints = [];
    }),
    () => pack.commits.forEach((c) => {
      const ui = c.evidenceDigest && c.evidenceDigest.ui;
      if (ui) { delete ui.pageTitles; delete ui.pages; }
      if (c.diffstat && c.diffstat.files) c.diffstat.files = c.diffstat.files.slice(0, 4);
    }),
    () => pack.commits.forEach((c) => {
      const cg = c.evidenceDigest && c.evidenceDigest.codegraph;
      if (cg) { delete cg.methods; delete cg.workspaceCallers; delete cg.externalCallers; delete cg.downstreamFeigns; }
    })
  ];
  for (const step of steps) {
    step();
    if (size() <= maxBytes) {
      pack.trimmedForSize = true;
      return pack;
    }
  }
  pack.trimmedForSize = true;
  return pack;
}

function buildEvalPacks({ label, selected, clsMap, impactMap, frontMap, coverage, unitMap, options }) {
  const { packSize, maxDiffLines, maxPackBytes, window, noDiff, riskThresholds } = options;
  const makePack = (chunk) => ({
    schemaVersion: 'eval-pack/v1',
    label,
    batch: 0,
    batches: 0,
    window: window || null,
    commitCount: chunk.length,
    commits: chunk.map((c) => ({
      hash: c.hash,
      shortHash: lib.shortHash(c.hash),
      repo: c.repo,
      author: c.author,
      date: c.date,
      subject: c.subject,
      unitId: lib.unitIdOf(c),
      classification: classifyDraft(clsMap.get(c.hash)),
      diffstat: filesDigest(c, 8),
      evidenceDigest: buildDigest(c, { impact: impactMap.get(c.hash), front: frontMap.get(c.hash) || {}, coverage, unitMap, riskThresholds }),
      diffExcerpt: noDiff ? null : diffExcerpt(c, maxDiffLines)
    }))
  });
  // 裁剪阶梯用尽仍超限时对半拆分，保底不超过字节上限（单条提交超限只能保留并告警）
  const fitChunk = (chunk) => {
    const pack = shrinkToFit(makePack(chunk), maxPackBytes);
    if (packBytes(pack) <= maxPackBytes || chunk.length === 1) return [pack];
    const mid = Math.ceil(chunk.length / 2);
    return [...fitChunk(chunk.slice(0, mid)), ...fitChunk(chunk.slice(mid))];
  };
  const packs = [];
  for (let start = 0; start < selected.length; start += packSize) {
    packs.push(...fitChunk(selected.slice(start, start + packSize)));
  }
  packs.forEach((pack, i) => {
    pack.batch = i + 1;
    pack.batches = packs.length;
  });
  return packs;
}

function buildClassificationPacks({ label, commits, options }) {
  const { packSize, maxPackBytes, window } = options;
  const packs = [];
  for (let start = 0; start < commits.length; start += packSize) {
    const chunk = commits.slice(start, start + packSize);
    const pack = {
      schemaVersion: 'classification-pack/v1',
      label,
      batch: packs.length + 1,
      batches: Math.ceil(commits.length / packSize),
      window: window || null,
      commitCount: chunk.length,
      commits: chunk.map((c) => ({
        hash: c.hash,
        shortHash: lib.shortHash(c.hash),
        repo: c.repo,
        author: c.author,
        date: c.date,
        subject: c.subject,
        unitId: lib.unitIdOf(c),
        ...filesDigest(c, 20)
      }))
    };
    packs.push(shrinkToFit(pack, maxPackBytes));
  }
  return packs;
}

function main() {
  const opts = lib.parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (!opts.label) throw new Error('--label 必填');
  const label = String(opts.label);
  const kind = opts.kind === 'classification' ? 'classification' : 'eval';
  const config = lib.loadConfig();
  const conf = batchingConfig(config);
  const dir = lib.resolveOutputDir(opts, config, label);
  const packsDir = opts['packs-dir'] ? path.resolve(opts['packs-dir']) : path.join(dir, kind === 'eval' ? 'eval-packs' : 'classify-packs');

  const rawPath = opts['raw-commits'] ? path.resolve(opts['raw-commits']) : path.join(dir, `raw-commits-${label}.json`);
  const raw = lib.readJson(rawPath, '采集结果');
  const rawCommits = lib.normalizeList(raw, 'commits');
  const window = (raw.meta && raw.meta.window) || null;
  const packSize = Number(opts['pack-size'] || (kind === 'eval' ? conf.evalSize : conf.classificationSize));
  const maxPackBytes = Number(opts['max-pack-bytes'] || conf.maxPackBytes);
  const maxDiffLines = Number(opts['max-diff-lines'] || conf.maxDiffLines);
  const noDiff = !!opts['no-diff'];

  if (packSize <= 0 || maxPackBytes <= 0) throw new Error('--pack-size / --max-pack-bytes 必须为正数');
  fs.mkdirSync(packsDir, { recursive: true });

  let packs;
  const source = { rawCommits: rawPath };
  if (kind === 'classification') {
    packs = buildClassificationPacks({ label, commits: rawCommits, options: { packSize, maxPackBytes, window } });
  } else {
    const clsPath = opts.classification ? path.resolve(opts.classification) : path.join(dir, `classification-${label}.json`);
    const clsData = lib.readJson(clsPath, '分类检查点');
    const clsCommits = lib.normalizeList(clsData, 'commits');
    const clsMap = lib.byHash(clsCommits);
    source.classification = clsPath;
    const reqTypes = String(opts['req-types'] || conf.evaluationReqTypes.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const impactPath = opts['code-impact'] ? path.resolve(opts['code-impact']) : path.join(dir, `code-impact-${label}.json`);
    const frontPath = opts['front-chains'] ? path.resolve(opts['front-chains']) : path.join(dir, `front-chains-${label}.json`);
    const impactData = lib.readJsonIfExists(impactPath, '后端取证产物');
    const frontData = lib.readJsonIfExists(frontPath, '前端界面证据');
    if (!impactData) console.error(`[警告] 缺少后端取证产物，评估包不含调用图证据：${impactPath}`);
    if (!frontData) console.error(`[警告] 缺少前端界面证据，评估包不含界面证据：${frontPath}`);
    const impactMap = lib.byHash(impactData ? lib.normalizeList(impactData, 'commits') : []);
    const frontMap = lib.byHash(frontData ? lib.normalizeList(frontData, 'commits') : []);
    const coverage = lib.frontCoverage(frontData);
    if (frontData && !coverage.coveredUntil) {
      console.error('[警告] 前端链路库无源指纹（旧版构建产物），frontIndexFresh 记为不可判定');
    }
    const unitMap = unitIndex(rawCommits, frontMap);
    const selected = rawCommits.filter((c) => {
      const cls = clsMap.get(c.hash);
      return cls && reqTypes.includes(cls.reqType);
    });
    const unclassified = rawCommits.length - rawCommits.filter((c) => clsMap.has(c.hash)).length;
    if (unclassified > 0) console.error(`[警告] ${unclassified} 条提交不在分类检查点内，不进入评估包`);
    if (!selected.length) {
      console.log(`[评估包] 0 条提交命中评估范围（${reqTypes.join(' / ')}），无包输出`);
      lib.writeJson(path.join(packsDir, 'index.json'), {
        schemaVersion: 'eval-pack-index/v1', label, kind, packSize, maxPackBytes, commitCount: 0, source, batches: []
      });
      return;
    }
    source.codeImpact = impactData ? impactPath : null;
    source.frontChains = frontData ? frontPath : null;
    packs = buildEvalPacks({
      label,
      selected,
      clsMap,
      impactMap,
      frontMap,
      coverage,
      unitMap,
      options: {
        packSize,
        maxDiffLines,
        maxPackBytes,
        window,
        noDiff,
        riskThresholds: (config.codegraph && config.codegraph.riskThresholds) || {}
      }
    });
  }

  const indexBatches = [];
  for (const pack of packs) {
    const file = `${batchName(pack.batch)}.json`;
    lib.writeJson(path.join(packsDir, file), pack);
    const bytes = packBytes(pack);
    indexBatches.push({
      batch: pack.batch,
      file,
      commitCount: pack.commitCount,
      bytes,
      trimmedForSize: !!pack.trimmedForSize,
      hashes: pack.commits.map((c) => c.hash)
    });
  }
  const index = {
    schemaVersion: kind === 'eval' ? 'eval-pack-index/v1' : 'classification-pack-index/v1',
    label,
    kind,
    packSize,
    maxPackBytes,
    commitCount: packs.reduce((n, p) => n + p.commitCount, 0),
    source,
    batches: indexBatches
  };
  lib.writeJson(path.join(packsDir, 'index.json'), index);

  const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
  console.log(`[${kind === 'eval' ? '评估包' : '分类包'}] 提交 ${index.commitCount} 条 → ${packs.length} 个包（每包 ≤${packSize} 条 / ≤${kb(maxPackBytes)}）`);
  for (const b of indexBatches) {
    console.log(`  ${batchName(b.batch)}: ${b.commitCount} 条 ${kb(b.bytes)}${b.trimmedForSize ? '（超限已裁剪）' : ''}`);
    if (b.bytes > maxPackBytes) console.error(`[警告] ${batchName(b.batch)} 单条提交仍超过上限 ${kb(maxPackBytes)}：${kb(b.bytes)}`);
  }
  console.log(`输出: ${path.join(packsDir, 'index.json')}`);
}

try {
  main();
} catch (e) {
  console.error(`[错误] ${e.message}`);
  process.exit(1);
}
