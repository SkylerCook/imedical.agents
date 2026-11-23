#!/usr/bin/env node
'use strict';

/*
 * eval-pack-lib.js — 周报评估包流水线公共工具
 *
 * 供 build-eval-packs.js / validate-evals.js 共用：参数解析、配置与目录解析、
 * 需求号归并、证据计数（与 render-report.js 的 evidenceCounts / uiCounts 同口径）。
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PLUGIN_DIR = path.join(REPO_ROOT, '.agents', 'plugins', 'imedicalxc-doctor-commit-report');

const UNIT_PATTERNS = [
  { kind: 'BOS', re: /\bBOS\s*(\d{6,})/i },
  { kind: 'REQ', re: /【\s*需求\s*[:：]?\s*(\d{6,})\s*】/ },
  { kind: 'REQ', re: /需求\s*[:：]\s*(\d{6,})/ }
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`无法识别的参数：${arg}`);
    const key = arg.slice(2);
    const eq = key.indexOf('=');
    if (eq >= 0) out[key.slice(0, eq)] = key.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`缺少${label}：${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${label} 不是合法 JSON：${file}\n${e.message}`);
  }
}

function readJsonIfExists(file, label) {
  if (!fs.existsSync(file)) return null;
  return readJson(file, label);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
}

function loadConfig(repoRoot = REPO_ROOT) {
  return readJson(path.join(repoRoot, '.agents', 'plugins', 'imedicalxc-doctor-commit-report', 'config', 'commit-report.json'), '配置');
}

function resolveOutputDir(opts, config, label) {
  if (opts.dir) return path.resolve(opts.dir);
  const base = path.join(REPO_ROOT, config.outputDir || 'docs/agents/commit-reports', label);
  return base;
}

function extractUnitId(subject) {
  for (const { kind, re } of UNIT_PATTERNS) {
    const m = re.exec(subject || '');
    if (m) return `${kind}${m[1]}`;
  }
  return null;
}

function unitIdOf(commit) {
  return commit.unitId || extractUnitId(commit.subject || '') || null;
}

function shortHash(hash) {
  return String(hash || '').slice(0, 8);
}

function normalizeList(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  throw new Error(`输入结构错误：应为数组或 { ${key}: [] }`);
}

function byHash(list) {
  const map = new Map();
  for (const item of list || []) {
    if (item && item.hash) map.set(item.hash, item);
  }
  return map;
}

// 与 render-report.js 的 evidenceCounts 同口径
function evidenceCounts(impactCommit) {
  if (!impactCommit) return null;
  return {
    methods: (impactCommit.methods || []).length,
    entrypoints: (impactCommit.entrypoints || []).length,
    workspaceCallers: (impactCommit.workspaceCallers || []).length,
    externalCallers: (impactCommit.externalCallers || []).length,
    downstreamFeigns: (impactCommit.downstreamFeigns || []).length,
    confidence: impactCommit.confidence
  };
}

// 与 render-report.js 的 uiCounts 同口径（同一页面取最高访问层级）
function uiCounts(frontCommit) {
  if (!frontCommit) return null;
  const entries = frontCommit.uiEntries || [];
  const conf = new Map();
  const attr = { direct: 0, load: 0, indirect: 0, heuristic: 0 };
  for (const item of entries) {
    const page = item.page || '';
    const level = (item.access && item.access.confidence) || 'none';
    const rank = { menu: 0, parent: 1, none: 2 };
    if (!conf.has(page) || rank[level] < rank[conf.get(page)]) conf.set(page, level);
    const grade = item.attribution || 'unknown';
    attr[grade] = (attr[grade] || 0) + 1;
  }
  const count = (level) => [...conf.values()].filter((v) => v === level).length;
  return {
    uiEntries: entries.length,
    pages: conf.size,
    withMenu: count('menu'),
    withParentMenu: count('parent'),
    noMenu: count('none'),
    attribution: attr,
    unmatchedEntrypoints: (frontCommit.unmatchedEntrypoints || []).length
  };
}

function uiPageTitles(frontCommit) {
  if (!frontCommit) return [];
  const titles = new Set();
  for (const item of frontCommit.uiEntries || []) {
    const title = String(item.pageTitle || '').trim();
    if (title && title !== 'Document') titles.add(title);
  }
  return [...titles];
}

function uiPages(frontCommit) {
  if (!frontCommit) return [];
  return [...new Set((frontCommit.uiEntries || []).map((item) => String(item.page || '').trim()).filter(Boolean))];
}

function siblingPages(frontCommit) {
  const out = [];
  for (const item of (frontCommit && frontCommit.siblingUi) || []) {
    const page = String(item.page || '').trim();
    if (page) out.push({ hash: item.hash || '', page, pageTitle: item.pageTitle || '', element: item.element || null, menus: item.menus || [] });
  }
  return out;
}

// 前端链路库覆盖信息：优先 meta.frontChainIndex，回退 meta.source / frontChainDb（旧产物不可判定）
function frontCoverage(frontData) {
  const meta = (frontData && frontData.meta) || {};
  if (meta.frontChainIndex) return meta.frontChainIndex;
  return { builtAt: null, coveredUntil: null, checkoutStale: null, source: null };
}

function commitFrontFresh(coverage, dateIso) {
  if (!coverage || !coverage.coveredUntil || !dateIso) return null;
  const covered = Date.parse(coverage.coveredUntil);
  const at = Date.parse(dateIso);
  if (Number.isNaN(covered) || Number.isNaN(at)) return null;
  return at <= covered;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

module.exports = {
  REPO_ROOT,
  PLUGIN_DIR,
  parseArgs,
  readJson,
  readJsonIfExists,
  writeJson,
  loadConfig,
  resolveOutputDir,
  extractUnitId,
  unitIdOf,
  shortHash,
  normalizeList,
  byHash,
  evidenceCounts,
  uiCounts,
  uiPageTitles,
  uiPages,
  siblingPages,
  frontCoverage,
  commitFrontFresh,
  normalizePath
};
