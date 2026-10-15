#!/usr/bin/env node
'use strict';

/*
 * build-issue-rows.js — 医生站信创产品迭代周报 · 低星问题登记行数据生成（确定性）
 *
 * 读取某期 evaluations.json，筛出 1-2★（rating ≤ 2）条目；条目含 issueItems（多个
 * 独立问题的逐项明细）时按问题拆为多行，其余条目一行，渲染为《信创版产品迭代
 * 每周问题登记》目标表 9 列标准行值，输出结构化 JSON（UTF-8 无 BOM），供 Agent
 * 经 tencent_docs MCP 读表去重后批量写入。
 *
 * 用法：
 *   node build-issue-rows.js <evaluations.json> [--date YYYY-MM-DD]
 *
 * 配置：.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report.json
 *      （issueRegistration: fileId / sheetId / sheetUrl）
 */

const fs = require('node:fs');
const path = require('node:path');

const USAGE = `用法: node build-issue-rows.js <evaluations.json> [--date YYYY-MM-DD]
  <evaluations.json>  某期评估产物，如 docs/commit-reports/2026-10/evaluations.json
  --date YYYY-MM-DD   登记日期（默认取当天）
输出: <同目录>/issue-rows-<label>.json（UTF-8 无 BOM）+ 控制台摘要`;

const HEADER = ['来源:产品迭代周报名称', '登记日期', '星级', '提交', '具体问题', '负责人', '完成状态', '完成日期', '备注'];
const SOURCE_PREFIX = '医生站信创产品迭代周报';
const STATUS_TODO = '未完成';
const RATING_MAX = 2;
const SHORT_HASH_RE = /^[0-9a-f]{8}$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayYMD(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function parseArgs(argv) {
  const opts = { input: null, date: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--date') {
      const v = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) {
        throw new Error(`--date 需为 YYYY-MM-DD 格式，收到: ${v}`);
      }
      opts.date = v;
    } else if (arg.startsWith('--')) {
      throw new Error(`未知参数: ${arg}`);
    } else if (!opts.input) {
      opts.input = arg;
    } else {
      throw new Error(`多余参数: ${arg}`);
    }
  }
  return opts;
}

function loadConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.agents', 'plugins', 'imedicalxc-doctor-commit-report', 'config', 'commit-report.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`配置不存在: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// 兼容两种结构：裸数组 [...] 或包裹对象 { "evaluations": [...] }
function normalizeEvaluations(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.evaluations)) return parsed.evaluations;
  return null;
}

function shortHashOf(e) {
  return SHORT_HASH_RE.test(e.shortHash || '') ? e.shortHash : String(e.hash || '').slice(0, 8);
}

// 「提交」列：短哈希 + [仓库短名] + 提交标题；首 token 为短哈希（去重解析锚点）
function formatCommit(e) {
  return `${shortHashOf(e)} [${path.basename(String(e.repo || ''))}] ${e.subject || ''}`;
}

// 「具体问题」列：specificIssue 为空或「无」时兜底 evaluation；均空填 —
function formatIssueText(e) {
  const issue = String(e.specificIssue || '').trim();
  if (issue && issue !== '无') return issue;
  return String(e.evaluation || '').trim() || '—';
}

// 条目拆行：issueItems（多个独立问题的逐项明细，由评估环节产出）优先，逐项一行；否则整条一个问题
function issueTexts(e) {
  if (Array.isArray(e.issueItems)) {
    const items = e.issueItems.map((s) => String(s || '').trim()).filter(Boolean);
    if (items.length > 0) return items;
  }
  return [formatIssueText(e)];
}

function toRow(e, { label, date, issueText }) {
  return {
    shortHash: shortHashOf(e),
    hash: e.hash || '',
    values: [
      `${SOURCE_PREFIX}-${label}`,
      date,
      `${e.rating}★`,
      formatCommit(e),
      issueText,
      e.author || '',
      STATUS_TODO,
      '',
      ''
    ]
  };
}

function buildRows(evaluations, { label, date }) {
  return evaluations
    .filter((e) => Number(e.rating) <= RATING_MAX)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hash < b.hash ? -1 : 1))
    .flatMap((e) => issueTexts(e).map((issueText) => toRow(e, { label, date, issueText })));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (!opts.input) {
    console.log(USAGE);
    throw new Error('缺少输入文件参数');
  }
  const inputPath = path.resolve(opts.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`输入文件不存在: ${inputPath}`);
  }
  const evaluations = normalizeEvaluations(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  if (!evaluations) {
    throw new Error(`输入文件应为评估条目数组或 { evaluations: [...] } 结构: ${inputPath}`);
  }

  const label = path.basename(path.dirname(inputPath));
  const date = opts.date || todayYMD();

  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const config = loadConfig(repoRoot);
  const reg = config.issueRegistration;
  if (!reg || !reg.fileId || !reg.sheetId) {
    throw new Error('config/commit-report.json 缺少 issueRegistration.fileId / sheetId，请先在配置中补全');
  }

  const rows = buildRows(evaluations, { label, date });
  const commitCount = new Set(rows.map((r) => r.shortHash)).size;
  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceEvaluations: path.basename(inputPath),
      label,
      registrationDate: date,
      threshold: `rating <= ${RATING_MAX}`,
      count: rows.length,
      commitCount
    },
    target: {
      fileId: reg.fileId,
      sheetId: reg.sheetId,
      sheetUrl: reg.sheetUrl || '',
      header: HEADER
    },
    rows
  };

  const outPath = path.join(path.dirname(inputPath), `issue-rows-${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`来源: ${inputPath}`);
  console.log(`期号: ${label} · 登记日期: ${date} · 阈值: rating <= ${RATING_MAX}`);
  console.log(`低星提交: ${commitCount} 条 · 登记行: ${rows.length} 行`);
  for (const r of rows) {
    console.log(`  ${r.shortHash} · ${r.values[5]} · ${r.values[2]} · ${r.values[3].slice(0, 60)}`);
  }
  console.log(`行数据: ${outPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[build-issue-rows] 失败: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { HEADER, parseArgs, loadConfig, normalizeEvaluations, shortHashOf, formatCommit, formatIssueText, issueTexts, toRow, buildRows, todayYMD };
