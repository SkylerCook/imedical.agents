#!/usr/bin/env node
'use strict';

/*
 * validate-evals.js — 周报子 Agent 片段的确定性校验与合并
 *
 * 子 Agent 只产出语义判读片段；本脚本负责：
 *   - 覆盖对账：片段 hash 必须与评估包 hash 完全一致（不缺、不多、不重复）
 *   - 结构校验：必填字段、枚举、星级、四段测试建议、低星必带具体问题、应急系统 2★ 上限
 *   - 防编造：测试建议 / 影响范围里出现的 .html 页面必须来自评估包证据；有页面证据却写「无页面入口证据」直接拒绝
 *   - 证据注入：impactEvidence（调用图计数）与 ui（界面计数）由脚本按 code-impact / front-chains 现算，子 Agent 不手抄
 *   - 合并落盘：evaluations-<label>.json（mergedBy=validate-evals）或 classification-<label>.json
 *
 * 用法：见 USAGE。退出码：0 全部通过（或 --allow-degraded 已留档），1 存在校验失败。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./eval-pack-lib');

const USAGE = `用法: node validate-evals.js --label LABEL [--kind eval|classification] [--dir <产物目录>]
  --label            期号
  --kind             eval（默认）| classification
  --dir              产物目录，默认 <config.outputDir>/<label>
  --packs-dir        包目录，默认 <dir>/eval-packs 或 <dir>/classify-packs
  --fragments-dir    片段目录，默认同 packs-dir
  --stage            evaluations 评级时点 preliminary（默认）| final
  --allow-degraded   校验失败的批次留档跳过（退出码仍为 0，但会告警；缺评估提交会导致 render-report 校验失败）
  --no-page-check    关闭页面防编造检查（不推荐，仅调试用）
片段命名: <packs-dir>/batch-NN.evals.json / batch-NN.classification.json
输出: evaluations-<label>.json / classification-<label>.json + <kind>-validation-<label>.json`;

const REQ_TYPES = ['BUG修复', '新功能提交', '流程修改', '业务调整', '其他'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const COMPLIANCE = ['符合', '部分符合', '不符合'];
const SEGMENTS = ['【必测】', '【回归】', '【联调】', '【边界】'];
const DENY_PAGE_RE = /无(?:直接)?(?:页面|界面)入口证据|无界面证据|未发现(?:任何)?(?:页面|界面)/;
const EVIDENCE_IN_SUMMARY_RE = /未发现活动调用方|无方法级调用证据|工作区内未发现|无页面入口证据|无界面证据/;
const CODE_IDENT_RE = /\b[A-Z][A-Za-z0-9]*(?:Controller|ServiceImpl|Abstract|Client|Feign[A-Za-z]*)\b|\b[a-z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\s*\(/;

function batchName(index) {
  return `batch-${String(index).padStart(2, '0')}`;
}

function formatIssue(code, message, hash) {
  return { code, message, ...(hash ? { hash } : {}) };
}

function loadPacks(packsDir) {
  const indexPath = path.join(packsDir, 'index.json');
  const index = lib.readJson(indexPath, '评估包索引');
  const packs = (index.batches || []).map((b) => ({
    meta: b,
    data: lib.readJson(path.join(packsDir, b.file), `评估包 ${b.file}`)
  }));
  return { index, packs };
}

function textOf(value) {
  return String(value == null ? '' : value);
}

function pageEvidenceOf(commit) {
  const ui = (commit.evidenceDigest && commit.evidenceDigest.ui) || {};
  const pages = new Set();
  const titles = new Set();
  for (const p of ui.pages || []) pages.add(lib.normalizePath(p));
  if (ui.pageTitles) for (const t of ui.pageTitles) titles.add(String(t).trim());
  for (const e of ui.uiEntriesTop5 || []) {
    if (e.page) pages.add(lib.normalizePath(e.page));
    if (e.pageTitle) titles.add(String(e.pageTitle).trim());
    for (const parent of (e.access && e.access.parents) || []) {
      if (parent.page) pages.add(lib.normalizePath(parent.page));
    }
  }
  const sibling = ui.siblingEvidence;
  if (sibling) {
    for (const e of sibling.entries || []) {
      if (e.page) pages.add(lib.normalizePath(e.page));
      if (e.pageTitle) titles.add(String(e.pageTitle).trim());
      for (const p of e.parentPages || []) pages.add(lib.normalizePath(p));
    }
  }
  pages.delete('');
  titles.delete('');
  return { pages: [...pages], titles: [...titles], gapReason: ui.uiGapReason || '', frontIndexFresh: ui.frontIndexFresh };
}

function pageChecks(entry, evidence) {
  const issues = [];
  const warnings = [];
  const text = `${textOf(entry.impactScope)} ${textOf(entry.testSuggestion)}`;
  const allowed = evidence.pages;
  const allowedBasenames = new Set(allowed.map((p) => path.posix.basename(p)));
  const refs = (text.match(/[A-Za-z0-9_\-./\\]+\.html/gi) || []).map((r) => lib.normalizePath(r));
  for (const ref of refs) {
    const base = path.posix.basename(ref);
    const ok = allowed.some((p) => p === ref || p.endsWith(`/${ref}`)) || allowedBasenames.has(base);
    if (!ok) {
      issues.push(formatIssue('page-not-in-pack', `测试建议引用了评估包之外的页面：${ref}（允许页面：${allowed.slice(0, 6).join('、') || '无'}）`, entry.hash));
    }
  }
  const mentionsTitle = evidence.titles.some((t) => text.includes(t));
  const mentionsPage = refs.length > 0;
  if (allowed.length > 0 && !mentionsTitle && !mentionsPage) {
    warnings.push(formatIssue('no-page-reference', `评估包有 ${allowed.length} 个界面证据页面，但测试建议未引用任何页面（示例：${evidence.titles.slice(0, 3).join('、') || allowed.slice(0, 3).join('、')}）`, entry.hash));
  }
  if (allowed.length > 0 && DENY_PAGE_RE.test(text)) {
    const segments = String(entry.testSuggestion || '').split(/(?=【(?:必测|回归|联调|边界)】)/);
    const mustTest = segments.find((seg) => seg.startsWith('【必测】')) || '';
    const target = DENY_PAGE_RE.test(mustTest) ? issues : warnings;
    target.push(formatIssue(
      `denies-page-evidence${target === warnings ? '-outside-must' : ''}`,
      `评估包已有 ${allowed.length} 个界面证据页面，${target === issues ? '【必测】不得' : '其他段落不宜'}写成「无页面入口证据」`,
      entry.hash
    ));
  }
  return { issues, warnings };
}

function semanticIssues(entry, workstation) {
  const issues = [];
  const warnings = [];
  const required = ['funcPoint', 'impactRatingReason', 'impactScope', 'compliance', 'complianceReason', 'changeSummary', 'evaluation', 'testSuggestion'];
  for (const key of required) {
    if (!textOf(entry[key]).trim()) issues.push(formatIssue('field-missing', `缺少 ${key}`, entry.hash));
  }
  if (!(Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5)) {
    issues.push(formatIssue('rating-invalid', `质量星级非法：${entry.rating}（应为 1-5 整数）`, entry.hash));
  }
  if (!(Number.isInteger(entry.impactRating) && entry.impactRating >= 1 && entry.impactRating <= 5)) {
    issues.push(formatIssue('impact-rating-invalid', `影响范围评级非法：${entry.impactRating}（应为 1-5 整数）`, entry.hash));
  }
  if (entry.compliance && !COMPLIANCE.includes(entry.compliance)) {
    issues.push(formatIssue('compliance-invalid', `合规性取值非法：${entry.compliance}（应为 ${COMPLIANCE.join(' / ')}）`, entry.hash));
  }
  const ts = textOf(entry.testSuggestion);
  for (const seg of SEGMENTS) {
    if (!ts.includes(seg)) issues.push(formatIssue('test-segment-missing', `测试方式建议缺少 ${seg}`, entry.hash));
  }
  if (Number(entry.rating) <= 2 && !textOf(entry.specificIssue).trim() && !(Array.isArray(entry.issueItems) && entry.issueItems.length)) {
    issues.push(formatIssue('low-star-issue-missing', '1-2★ 提交缺少 specificIssue / issueItems', entry.hash));
  }
  if (Array.isArray(entry.issueItems)) {
    if (entry.issueItems.some((it) => !textOf(it).trim())) {
      issues.push(formatIssue('issue-items-empty', 'issueItems 存在空条目', entry.hash));
    }
  }
  if (workstation === '门急诊应急医师工作站' && Number(entry.impactRating) > 2) {
    issues.push(formatIssue('emergency-rating-cap', `门急诊应急医师工作站影响评级超过 2★ 上限：${entry.impactRating}★（按规则应降级）`, entry.hash));
  }
  if (EVIDENCE_IN_SUMMARY_RE.test(textOf(entry.changeSummary))) {
    issues.push(formatIssue('change-summary-evidence', '改造方案（changeSummary）只写变更内容，不得写「无调用方 / 无方法级证据 / 无页面入口」等取证结论', entry.hash));
  }
  if (CODE_IDENT_RE.test(ts)) {
    warnings.push(formatIssue('test-code-identifier', '测试方式建议疑似出现类名 / 方法名 / Feign 名（正文应为业务语言）', entry.hash));
  }
  return { issues, warnings };
}

function checkFragmentShape(fragment, pack) {
  const issues = [];
  if (!fragment || !Array.isArray(fragment.commits)) {
    issues.push(formatIssue('fragment-shape', '片段结构错误：应为 { commits: [] }'));
    return issues;
  }
  const packHashes = pack.commits.map((c) => c.hash);
  const gotHashes = fragment.commits.map((c) => c && c.hash);
  const gotSet = new Set(gotHashes);
  if (gotSet.size !== gotHashes.length) issues.push(formatIssue('fragment-duplicate', '片段存在重复 hash'));
  for (const h of packHashes) {
    if (!gotSet.has(h)) issues.push(formatIssue('fragment-missing', `片段缺少提交 ${lib.shortHash(h)}`, h));
  }
  for (const h of gotSet) {
    if (!packHashes.includes(h)) issues.push(formatIssue('fragment-extra', `片段含评估包之外的提交 ${lib.shortHash(h)}`, h));
  }
  return issues;
}

function mergeEvalBatch(pack, fragment, ctx) {
  const issues = [];
  const warnings = [];
  issues.push(...checkFragmentShape(fragment, pack));
  if (issues.length) return { issues, warnings, entries: [] };
  const fragByHash = lib.byHash(fragment.commits);
  const entries = [];
  for (const packCommit of pack.commits) {
    const frag = fragByHash.get(packCommit.hash) || {};
    const raw = ctx.rawMap.get(packCommit.hash) || {};
    const cls = ctx.clsMap.get(packCommit.hash) || packCommit.classification || {};
    const impact = ctx.impactMap.get(packCommit.hash);
    const front = ctx.frontMap.get(packCommit.hash);
    const workstation = cls.workstation || frag.workstation || '';
    const entry = {
      hash: packCommit.hash,
      shortHash: lib.shortHash(packCommit.hash),
      subject: raw.subject || packCommit.subject,
      author: raw.author || packCommit.author,
      date: raw.date || packCommit.date,
      repo: raw.repo || packCommit.repo,
      unitId: lib.unitIdOf(raw) || packCommit.unitId || null,
      reqType: cls.reqType || '',
      workstation,
      priority: cls.priority || '',
      funcPoint: textOf(frag.funcPoint).trim() || textOf(cls.funcPoint).trim(),
      rating: frag.rating,
      impactRating: frag.impactRating,
      impactRatingReason: frag.impactRatingReason,
      impactScope: frag.impactScope,
      compliance: frag.compliance,
      complianceReason: frag.complianceReason,
      changeSummary: frag.changeSummary,
      evaluation: frag.evaluation,
      testSuggestion: frag.testSuggestion,
      highRiskCategory: textOf(frag.highRiskCategory).trim() || '无'
    };
    const flags = (packCommit.evidenceDigest && packCommit.evidenceDigest.codegraph && packCommit.evidenceDigest.codegraph.riskFlags) || null;
    if (frag.highRiskAuto) entry.highRiskAuto = frag.highRiskAuto;
    else if (flags) {
      const auto = [
        ...(flags.class2 || []).map((x) => `二类:${x}`),
        ...(flags.class3 || []).map((x) => `三类:${x}`)
      ];
      if (auto.length) entry.highRiskAuto = auto.join('、');
    }
    if (frag.specificIssue) entry.specificIssue = frag.specificIssue;
    if (Array.isArray(frag.issueItems)) entry.issueItems = frag.issueItems;
    if (frag.impactRatingInitial != null) entry.impactRatingInitial = frag.impactRatingInitial;
    if (frag.impactDowngrade) entry.impactDowngrade = frag.impactDowngrade;

    entry.impactEvidence = buildImpactEvidence(impact, front);
    if (frag.impactEvidence) {
      const provided = frag.impactEvidence;
      for (const key of ['methods', 'entrypoints', 'workspaceCallers', 'externalCallers', 'downstreamFeigns', 'confidence']) {
        if (provided[key] != null && provided[key] !== entry.impactEvidence[key]) {
          warnings.push(formatIssue('evidence-overridden', `片段 evidence.${key}=${provided[key]} 与取证产物 ${entry.impactEvidence[key]} 不一致，已按产物覆盖`, entry.hash));
        }
      }
    }

    const sem = semanticIssues(entry, workstation);
    issues.push(...sem.issues);
    warnings.push(...sem.warnings);
    if (flags && ((flags.class2 || []).length || (flags.class3 || []).length)
      && (!textOf(entry.highRiskCategory).trim() || entry.highRiskCategory === '无')) {
      warnings.push(formatIssue('highrisk-not-recorded', `证据机械触发高风险（${entry.highRiskAuto}），但 highRiskCategory 为「无」，需复核是否应深度评估`, entry.hash));
    }
    if (!entry.reqType) issues.push(formatIssue('reqtype-missing', '分类检查点缺少需求类型', entry.hash));
    if (!entry.priority) issues.push(formatIssue('priority-missing', '分类检查点缺少优先级', entry.hash));
    if (!ctx.noPageCheck) {
      const pages = pageChecks(entry, pageEvidenceOf(packCommit));
      issues.push(...pages.issues);
      warnings.push(...pages.warnings);
    }
    entries.push(entry);
  }
  return { issues, warnings, entries };
}

function buildImpactEvidence(impact, front) {
  const base = impact
    ? {
        methods: (impact.methods || []).length,
        entrypoints: (impact.entrypoints || []).length,
        workspaceCallers: (impact.workspaceCallers || []).length,
        externalCallers: (impact.externalCallers || []).length,
        downstreamFeigns: (impact.downstreamFeigns || []).length,
        confidence: impact.confidence,
        feignContracts: (impact.contract && impact.contract.feignInterfaces || []).length,
        typeFiles: (impact.contract && impact.contract.typeFiles || []).length,
        typeFeignMatches: (impact.contract && impact.contract.typeFeignMatches || []).length,
        typeFeignCallers: (impact.contract && impact.contract.typeFeignCallers || []).length,
        typeControllerMatches: (impact.contract && impact.contract.typeControllerMatches || []).length,
        truncated: (impact.truncatedMethods || []).length,
        coverage: impact.coverage || null,
        downstream: (impact.downstream && impact.downstream.services) || []
      }
    : { methods: 0, entrypoints: 0, workspaceCallers: 0, externalCallers: 0, downstreamFeigns: 0, confidence: 'none', feignContracts: 0, typeFiles: 0, typeFeignMatches: 0, typeFeignCallers: 0, typeControllerMatches: 0, truncated: 0, coverage: null, downstream: [] };
  const ui = lib.uiCounts(front);
  if (ui) base.ui = ui;
  return base;
}

function mergeClassificationBatch(pack, fragment, ctx) {
  const issues = [];
  const warnings = [];
  issues.push(...checkFragmentShape(fragment, pack));
  if (issues.length) return { issues, warnings, commits: [] };
  const fragByHash = lib.byHash(fragment.commits);
  const commits = [];
  for (const packCommit of pack.commits) {
    const frag = fragByHash.get(packCommit.hash) || {};
    const raw = ctx.rawMap.get(packCommit.hash) || {};
    const commit = {
      hash: packCommit.hash,
      repo: raw.repo || packCommit.repo,
      author: raw.author || packCommit.author,
      date: raw.date || packCommit.date,
      subject: raw.subject || packCommit.subject,
      workstation: frag.workstation,
      reqType: frag.reqType,
      priority: frag.priority,
      summary: frag.summary,
      funcPoint: frag.funcPoint || ''
    };
    if (!commit.workstation) issues.push(formatIssue('workstation-missing', '缺少岗位工作站', commit.hash));
    else if (Array.isArray(ctx.workstations) && ctx.workstations.length && !ctx.workstations.includes(commit.workstation)) {
      issues.push(formatIssue('workstation-not-allowed', `工作站不在 config 清单：${commit.workstation}`, commit.hash));
    }
    if (!REQ_TYPES.includes(commit.reqType)) issues.push(formatIssue('reqtype-invalid', `需求类型非法：${commit.reqType}`, commit.hash));
    if (!PRIORITIES.includes(commit.priority)) issues.push(formatIssue('priority-invalid', `优先级非法：${commit.priority}`, commit.hash));
    if (!textOf(commit.summary).trim()) issues.push(formatIssue('summary-missing', '缺少改造内容总结', commit.hash));
    if (!textOf(commit.funcPoint).trim()) warnings.push(formatIssue('funcpoint-missing', '缺少涉及功能范围 funcPoint（建议补齐）', commit.hash));
    commits.push(commit);
  }
  return { issues, warnings, commits };
}

function writeReport(file, report) {
  lib.writeJson(file, report);
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
  const dir = lib.resolveOutputDir(opts, config, label);
  const packsDir = opts['packs-dir'] ? path.resolve(opts['packs-dir']) : path.join(dir, kind === 'eval' ? 'eval-packs' : 'classify-packs');
  const fragmentsDir = opts['fragments-dir'] ? path.resolve(opts['fragments-dir']) : packsDir;
  const stage = opts.stage === 'final' ? 'final' : 'preliminary';
  const allowDegraded = !!opts['allow-degraded'];
  const noPageCheck = !!opts['no-page-check'];

  const { index, packs } = loadPacks(packsDir);
  if (!packs.length) {
    throw new Error(`评估包索引为空：${path.join(packsDir, 'index.json')}`);
  }
  const rawPath = index.source && index.source.rawCommits ? index.source.rawCommits : path.join(dir, `raw-commits-${label}.json`);
  const raw = lib.readJson(rawPath, '采集结果');
  const ctx = {
    rawMap: lib.byHash(lib.normalizeList(raw, 'commits')),
    clsMap: new Map(),
    impactMap: new Map(),
    frontMap: new Map(),
    workstations: Array.isArray(config.workstations) ? config.workstations : [],
    noPageCheck
  };
  if (kind === 'eval') {
    const clsPath = index.source && index.source.classification ? index.source.classification : path.join(dir, `classification-${label}.json`);
    const impactPath = index.source && index.source.codeImpact ? index.source.codeImpact : path.join(dir, `code-impact-${label}.json`);
    const frontPath = index.source && index.source.frontChains ? index.source.frontChains : path.join(dir, `front-chains-${label}.json`);
    ctx.clsMap = lib.byHash(lib.normalizeList(lib.readJson(clsPath, '分类检查点'), 'commits'));
    const impactData = lib.readJsonIfExists(impactPath, '后端取证产物');
    const frontData = lib.readJsonIfExists(frontPath, '前端界面证据');
    ctx.impactMap = lib.byHash(impactData ? lib.normalizeList(impactData, 'commits') : []);
    ctx.frontMap = lib.byHash(frontData ? lib.normalizeList(frontData, 'commits') : []);
  }

  const suffix = kind === 'eval' ? '.evals.json' : '.classification.json';
  const report = {
    schemaVersion: 'eval-validation/v1',
    label,
    kind,
    stage: kind === 'eval' ? stage : null,
    packs: packs.length,
    batches: [],
    summary: { passed: 0, failed: 0, degraded: 0, commits: 0 }
  };
  const merged = [];
  const degradedBatches = [];
  const totalCommits = packs.reduce((n, p) => n + p.data.commitCount, 0);

  for (const { meta, data } of packs) {
    const base = meta.file.replace(/\.json$/, '');
    const fragPath = path.join(fragmentsDir, `${base}${suffix}`);
    const batch = { batch: data.batch, file: meta.file, fragment: path.basename(fragPath), status: 'pass', issues: [], warnings: [] };
    if (!fs.existsSync(fragPath)) {
      batch.status = 'missing';
      batch.issues.push(formatIssue('fragment-missing-file', `缺少片段文件：${fragPath}`));
    } else {
      let fragment;
      try {
        fragment = lib.readJson(fragPath, '子 Agent 片段');
        if (fragment.schemaVersion && kind === 'eval' && fragment.schemaVersion !== 'eval-fragment/v1') {
          batch.warnings.push(formatIssue('fragment-schema', `片段 schemaVersion=${fragment.schemaVersion}，期望 eval-fragment/v1`));
        }
      } catch (e) {
        batch.status = 'missing';
        batch.issues.push(formatIssue('fragment-invalid', e.message));
        fragment = null;
      }
      if (fragment) {
        const result = kind === 'eval' ? mergeEvalBatch(data, fragment, ctx) : mergeClassificationBatch(data, fragment, ctx);
        batch.issues = result.issues;
        batch.warnings = result.warnings;
        if (result.issues.length) batch.status = 'fail';
        else merged.push(...(kind === 'eval' ? result.entries : result.commits));
      }
    }
    if (batch.status === 'pass') report.summary.passed += 1;
    else {
      report.summary.failed += 1;
      if (batch.status === 'fail' && allowDegraded) {
        batch.status = 'degraded';
        report.summary.degraded += 1;
        degradedBatches.push(batch.batch);
      }
    }
    report.batches.push(batch);
    console.log(`  ${base}: ${batch.status}${batch.issues.length ? `（${batch.issues.length} 个问题）` : ''}`);
  }
  report.summary.commits = totalCommits;

  const reportPath = path.join(dir, kind === 'eval' ? `eval-validation-${label}.json` : `classification-validation-${label}.json`);
  writeReport(reportPath, report);

  const blocking = report.batches.filter((b) => b.status === 'fail' || b.status === 'missing');
  if (blocking.length && !allowDegraded) {
    console.error(`[校验失败] ${blocking.length} 个批次未通过（共 ${packs.length} 批）；报告：${reportPath}`);
    for (const b of blocking.slice(0, 5)) {
      for (const issue of b.issues.slice(0, 5)) console.error(`  - ${b.fragment}: ${issue.code} ${issue.message}`);
    }
    console.error('修复片段后重跑（同一批次最多退回一次）；不要手写缺字段或编造页面。');
    process.exit(1);
  }
  if (blocking.length && allowDegraded) {
    console.warn(`[降级] ${blocking.length} 个批次跳过并留档：${blocking.map((b) => b.fragment).join('、')}`);
    console.warn('[降级] 缺失的提交没有评估，render-report 会因「流程修改/业务调整未评估」报错；必须向用户报告后暂停渲染，不得伪造评级。');
  }

  if (kind === 'eval') {
    const outPath = path.join(dir, `evaluations-${label}.json`);
    lib.writeJson(outPath, {
      impactRatingStage: stage,
      mergedBy: 'validate-evals',
      schemaVersion: 'evaluations/v1',
      label,
      batches: {
        total: packs.length,
        passed: report.summary.passed,
        degraded: degradedBatches
      },
      evaluations: merged
    });
    console.log(`[合并] ${merged.length} 条评估 → ${outPath}`);
  } else {
    const outPath = path.join(dir, `classification-${label}.json`);
    lib.writeJson(outPath, {
      mergedBy: 'validate-evals',
      schemaVersion: 'classification/v1',
      label,
      batches: {
        total: packs.length,
        passed: report.summary.passed,
        degraded: degradedBatches
      },
      commits: merged
    });
    console.log(`[合并] ${merged.length} 条分类 → ${outPath}`);
  }
  console.log(`校验报告: ${reportPath}`);
}

try {
  main();
} catch (e) {
  console.error(`[错误] ${e.message}`);
  process.exit(1);
}
