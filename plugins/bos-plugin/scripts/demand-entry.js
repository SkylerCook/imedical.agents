'use strict';

// Standard demand preparation is local and read-only with respect to Git.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { checkAvailability } = require('../../../scripts/check-plugin-availability');
const { resolveWorkspaceContext } = require('../../../scripts/lib/workspace-context');
const directories = require('../../../scripts/lib/project-directories');
function submissionTools(projectRoot = process.cwd()) {
  const context = resolveWorkspaceContext(projectRoot);
  if (context.mode === 'invalid') throw new Error('Invalid workspace context');
  const result = checkAvailability({ capabilityRoot: path.resolve(__dirname, '../../..'),
    contextRoot: context.contextRoot,
    plugin: 'bos-plugin', stage: 'standard-demand-entry' });
  if (!result.ok) throw new Error('BOS 补录依赖不可用: ' + JSON.stringify(result.checks));
  return require('../../demand-delivery-plugin/scripts/commit-demand');
}
const { buildWorkbook } = require('./demand-entry-xlsx');
const SCHEMA = 'iris-standard-demand/v2';
const NON_CODE_SCHEMA = 'iris-standard-demand/v3';
const HIERARCHY_SCHEMA = 'iris-standard-demand/v4';
const { hasBindings, normalizeBindings } = require('../../../scripts/lib/demand-code-binding');
const FACTS = 'iris-standard-demand-facts/v1';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function git(repo, args) {
  const result = spawnSync('git', ['--literal-pathspecs', '-C', repo, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) throw new Error(`Git 取证失败: ${result.error?.message || result.stderr}`);
  return result.stdout;
}

function exactFiles(repo, files) {
  if (!Array.isArray(files) || !files.length) throw new Error('必须提供本条需求的精确文件范围');
  return [...new Set(files.map((file) => {
    if (typeof file !== 'string' || !file || /[\r\n\0]/.test(file)) throw new Error('无效文件路径');
    const absolute = path.resolve(repo, file);
    const relative = path.relative(repo, absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件越过指定仓库');
    let current = repo;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('取证范围不能经过符号链接或 Junction');
    }
    if (fs.existsSync(absolute) && !fs.statSync(absolute).isFile()) throw new Error('必须指定文件，不能指定目录或子模块');
    return relative.split(path.sep).join('/');
  }))].sort();
}

function collect({ repo, files, commits = [], range }) {
  if (!repo) throw new Error('需要 --repo，不能猜测目标仓库');
  repo = fs.realpathSync(path.resolve(repo));
  const root = fs.realpathSync(git(repo, ['rev-parse', '--show-toplevel']).trim());
  if (!samePath(root, repo)) throw new Error('--repo 必须是目标 GitRoot');
  if (range && commits.length) throw new Error('--range 与 --commit 互斥');
  if (range) {
    if (range.startsWith('-')) throw new Error('无效提交范围');
    commits = git(repo, ['rev-list', '--reverse', range, '--']).trim().split(/\r?\n/).filter(Boolean);
    if (!commits.length) throw new Error('提交范围为空');
  }
  commits = [...new Set(commits.map((ref) => git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim()))];
  const mode = commits.length ? 'history' : 'worktree';
  if (mode === 'history' && (!files || !files.length)) {
    files = commits.flatMap((commit) => git(repo, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--no-renames', '-z', commit]).split('\0').filter(Boolean));
  }
  files = exactFiles(repo, files);
  const evidence = { schema: FACTS, repo, mode, files, commits, head: git(repo, ['rev-parse', 'HEAD']).trim() };
  if (mode === 'history') {
    evidence.history = commits.map((commit) => {
      const parents = git(repo, ['show', '-s', '--format=%P', commit]).trim().split(' ').filter(Boolean);
      if (parents.length > 1) throw new Error('合并提交需要明确拆分来源，不能猜测主线');
      return {
        commit, metadata: git(repo, ['show', '-s', '--format=fuller', commit]),
        patch: git(repo, ['show', '--format=', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', commit, '--', ...files]),
      };
    });
    if (!evidence.history.some((entry) => entry.patch)) throw new Error('指定提交与文件范围没有改动');
  } else {
    evidence.status = git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...files]);
    evidence.staged = git(repo, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--', ...files]);
    evidence.unstaged = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--', ...files]);
    const untracked = new Set(git(repo, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...files]).split('\0').filter(Boolean));
    evidence.workingFiles = files.map((file) => {
      const absolute = path.join(repo, file);
      if (!fs.existsSync(absolute)) return { file, deleted: true };
      const bytes = fs.readFileSync(absolute);
      return { file, sha256: hash(bytes), ...(untracked.has(file) ? { untracked: true, content: bytes.includes(0) ? null : bytes.toString('utf8'), binary: bytes.includes(0) } : {}) };
    });
    if (!evidence.status) throw new Error('指定范围没有待提交改动；历史提交请使用 --commit 或 --range');
  }
  evidence.fingerprint = hash(JSON.stringify(evidence));
  return evidence;
}

function verifyEvidence(evidence) {
  if (evidence.schema !== FACTS) throw new Error('不支持的取证格式');
  const unsigned = { ...evidence };
  delete unsigned.fingerprint;
  if (hash(JSON.stringify(unsigned)) !== evidence.fingerprint) throw new Error('取证文件被修改，请重新 collect');
  const fresh = collect({ repo: evidence.repo, files: evidence.files, commits: evidence.commits });
  // Immutable history remains useful even when the branch has moved.
  if (evidence.mode === 'history') {
    fresh.head = evidence.head;
    delete fresh.fingerprint;
    fresh.fingerprint = hash(JSON.stringify(fresh));
  }
  if (fresh.fingerprint !== evidence.fingerprint) throw new Error('代码范围或 HEAD 已漂移，请重新取证并复核需求草稿');
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('\n\n');
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('文案必须为字符串或段落数组');
  return value.trim();
}

function oneLine(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) throw new Error(`${name} 必须为非空单行文字`);
  return value.trim();
}

function normalizeDescription(raw, name, source = 'code') {
  const work = source === 'work';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !(work ? ['work'] : ['bug', 'change']).includes(raw.format)) {
    throw new Error('description.format 必须与来源匹配：代码或主题提需为 bug/change，工作记录为 work');
  }
  name = oneLine(name, 'name');
  if (source !== 'request' && !/^\{[^{}\r\n]+\}(?:\[标版\])? \S/.test(name)) throw new Error('需求名称须使用已确认的 {产品标识} 前缀，可紧接 [标版]，再以空格分隔标题');
  if (work) {
    for (const key of Object.keys(raw)) if (!['format', 'goal', 'activities', 'outcome'].includes(key)) throw new Error(`未知工作描述字段: ${key}`);
    const goal = text(raw.goal);
    if (!goal || !Array.isArray(raw.activities) || !raw.activities.length) throw new Error('工作目标和工作内容不能为空');
    const activities = raw.activities.map(value => oneLine(value, '工作内容'));
    let outcome;
    if (raw.outcome !== undefined) {
      if (!raw.outcome || !['expected', 'result'].includes(raw.outcome.kind) || !text(raw.outcome.text)) throw new Error('工作成果须明确 expected/result 及内容，未知时省略');
      outcome = { kind: raw.outcome.kind, text: text(raw.outcome.text) };
    }
    return { format: 'work', goal, activities, ...(outcome ? { outcome } : {}) };
  }
  const detail = raw.format === 'bug' ? 'actual' : 'summary';
  const allowed = ['format', 'steps', 'expected', detail];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new Error(`description.${key} 不适用于 ${raw.format} 模板`);
  }
  if (!Array.isArray(raw.steps) || !raw.steps.length) throw new Error('description.steps 必须为非空操作步骤数组');
  const steps = raw.steps.map((step) => {
    if (typeof step !== 'string' || !step.trim()) throw new Error('操作步骤必须为非空文字');
    return step.trim();
  });
  const expected = text(raw.expected), body = text(raw[detail]);
  if (!expected || !body) throw new Error(`description.expected 和 description.${detail} 不能为空`);
  return { format: raw.format, steps, expected, [detail]: body };
}

function normalizeNonCodeItem(raw, source = 'work') {
  if (['changes', 'type', 'subject'].some(key => Object.hasOwn(raw, key))) throw new Error('非代码需求不能包含 Git 取证或提交字段；混合来源请分批');
  if (!Array.isArray(raw.sources) || !raw.sources.length) throw new Error('非代码需求必须提供事实来源');
  const kinds = source === 'request' ? ['user', 'note', 'meeting', 'report', 'document', 'image', 'attachment'] : ['user', 'note', 'meeting', 'report'];
  const sources = raw.sources.map(source => {
    if (!source || !kinds.includes(source.kind)) throw new Error('无效事实来源');
    return { kind: source.kind, locator: oneLine(source.locator, '来源位置或用户说明标识'), summary: oneLine(source.summary, '必要事实摘要') };
  });
  if (!raw.progress || !['planned', 'in-progress', 'completed', 'unknown'].includes(raw.progress.status)) throw new Error('需求进度必须为 planned/in-progress/completed/unknown');
  const progress = { status: raw.progress.status, summary: oneLine(raw.progress.summary, '当前进度依据') };
  if (source !== 'request' && Object.hasOwn(raw, 'recipientGroup')) throw new Error('recipientGroup 仅适用于主题提需');
  const recipient = Object.hasOwn(raw, 'recipientGroup') ? { recipientGroup: oneLine(raw.recipientGroup, '接收组') } : {};
  return { sources, progress, ...recipient, description: normalizeDescription(raw.description, raw.name, source) };
}

function isNonCodeDraft(draft) {
  if (draft.kind !== 'standard') throw new Error('不支持的需求草稿');
  if ([SCHEMA, HIERARCHY_SCHEMA].includes(draft.schema) && (draft.source === undefined || draft.source === 'code')) return false;
  if (draft.schema === NON_CODE_SCHEMA && ['work', 'request'].includes(draft.source)) return true;
  throw new Error('不支持的需求草稿或来源');
}

function validateNonCodeDraft(draft) {
  if (!isNonCodeDraft(draft)) return;
  if (!Array.isArray(draft.requirements) || !draft.requirements.length) throw new Error('非代码草稿不能为空');
  const keys = new Set();
  for (const item of draft.requirements) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(item.key) || keys.has(item.key)) throw new Error('非代码需求 key 无效或重复');
    keys.add(item.key);
    normalizeNonCodeItem(item, draft.source);
  }
}

function renderText(item, withName = true) {
  if (item.description?.format === 'work') {
    const { description, progress } = normalizeNonCodeItem(item);
    const labels = { planned: '计划', 'in-progress': '进行中', completed: '已完成', unknown: '待核实' };
    const sections = [['工作目标', description.goal], ['工作内容', description.activities.map((value, i) => `${i + 1}. ${value}`).join('\n')]];
    if (description.outcome) sections.push([description.outcome.kind === 'expected' ? '预期成果' : '工作结果', description.outcome.text]);
    sections.push(['当前进度', `${labels[progress.status]}：${progress.summary}`]);
    if (text(item.remarks)) sections.push(['备注', text(item.remarks)]);
    const body = sections.map(([label, value]) => `【${label}】\n${value}`).join('\n\n');
    return withName ? `需求名称：\n\n${item.name}\n\n需求描述：\n\n${body}` : body;
  }
  const description = normalizeDescription(item.description, item.name, item.sources ? 'request' : 'code');
  const steps = description.steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
  const sections = description.format === 'bug'
    ? [['操作步骤', steps], ['预期结果', description.expected], ['实际结果', description.actual]]
    : [['需求说明', description.summary], ['操作步骤', steps], ['预期结果', description.expected]];
  const remarks = text(item.remarks);
  if (remarks) sections.push(['备注', remarks]);
  const body = sections.map(([label, value]) => `【${label}】\n${value}`).join('\n\n');
  return withName ? `需求名称：\n\n${item.name}\n\n需求描述：\n\n${body}` : body;
}

function prepare(spec, baseDirectory, projectRoot) {
  if (spec.kind !== 'standard') throw new Error('此入口仅支持 kind=standard');
  const source = spec.source === undefined ? 'code' : spec.source;
  if (!['code', 'work', 'request'].includes(source)) throw new Error('source 必须为 code、work 或 request，混合来源请分批');
  const nonCode = source !== 'code';
  const hierarchical = hasBindings(spec.requirements);
  if (nonCode && hierarchical) throw new Error('主子代码归属仅用于代码来源，主题及工作记录保持原协议');
  const relations = hierarchical ? normalizeBindings(spec.requirements) : null;
  const needsCode = !nonCode && (!relations || [...relations.values()].some(item => item.codeBinding.kind === 'own'));
  const validateModification = needsCode ? submissionTools(projectRoot).validateModification : null;
  if (!Array.isArray(spec.requirements) || !spec.requirements.length) throw new Error('requirements 不能为空');
  const keys = new Set();
  const assigned = new Set();
  const requirements = spec.requirements.map((raw) => {
    const key = oneLine(raw.key, 'key');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key) || keys.has(key)) throw new Error('key 必须唯一且只含字母数字下划线短横线');
    keys.add(key);
    const item = {
      key, name: oneLine(raw.name, 'name'), title: oneLine(raw.title || raw.name.replace(/^\{[^}]+\}\s*/, ''), 'title'),
      description: normalizeDescription(raw.description, raw.name, source), remarks: text(raw.remarks),
      fields: raw.fields || {},
      verification: text(raw.verification), imported: raw.imported === true,
    };
    if (nonCode) return { ...item, ...normalizeNonCodeItem(raw, source) };
    if (['sources', 'progress', 'recipientGroup'].some(key => Object.hasOwn(raw, key))) throw new Error('代码来源不能混入非代码需求字段');
    if (relations) {
      const relation = relations.get(key);
      item.parentKey = relation.parent;
      item.codeBinding = relation.codeBinding;
      if (item.codeBinding.kind !== 'own') {
        if (['changes', 'type', 'subject'].some(field => Object.hasOwn(raw, field))) throw new Error('复用主需求或无代码条目不能重复分配代码证据及提交字段');
        return item;
      }
    }
    item.type = raw.type;
    item.subject = oneLine(raw.subject, 'subject');
    if (!['feat', 'fix', 'refactor', 'docs', 'chore'].includes(item.type)) throw new Error('无效提交 type');
    if (!Array.isArray(raw.changes) || !raw.changes.length) throw new Error('每条需求必须关联取证文件');
    const repos = new Set();
    item.changes = raw.changes.map((change) => {
      const evidence = readJson(path.resolve(baseDirectory, change.evidence));
      verifyEvidence(evidence);
      const repoKey = process.platform === 'win32' ? evidence.repo.toLowerCase() : evidence.repo;
      if (repos.has(repoKey)) throw new Error('同一需求同一仓库应合并为一份取证');
      repos.add(repoKey);
      for (const file of evidence.files) {
        const scopes = evidence.mode === 'history' ? evidence.commits : ['worktree'];
        for (const scope of scopes) {
          const identity = `${repoKey}\0${scope}\0${file}`;
          if (assigned.has(identity)) throw new Error('多个需求共用文件范围，必须先拆分代码范围，不能按整文件自动提交');
          assigned.add(identity);
        }
      }
      return { evidence, modification: validateModification(change.modification) };
    });
    return item;
  });
  return { schema: nonCode ? NON_CODE_SCHEMA : hierarchical ? HIERARCHY_SCHEMA : SCHEMA, ...(nonCode ? { source } : {}), kind: 'standard', createdAt: new Date().toISOString(), common: spec.common || {}, requirements };
}

function validateHierarchy(draft) {
  if (draft.schema !== HIERARCHY_SCHEMA) {
    if (hasBindings(draft.requirements)) throw new Error('主子需求必须使用v4草稿，旧草稿不自动升级');
    return;
  }
  const relations = normalizeBindings(draft.requirements), assigned = new Set(), demands = new Set();
  for (const item of draft.requirements) {
    const relation = relations.get(item.key);
    if (item.boss) {
      if (!/^\d+$/.test(item.boss.demand) || demands.has(item.boss.demand)) throw new Error('需求编号无效或重复');
      demands.add(item.boss.demand);
    }
    if (relation.codeBinding.kind !== 'own') {
      if (['changes', 'type', 'subject'].some(field => Object.hasOwn(item, field))) throw new Error('子需求或无代码条目不能重复拥有提交字段');
      continue;
    }
    if (!Array.isArray(item.changes) || !item.changes.length) throw new Error('代码归属条目必须有真实取证');
    for (const change of item.changes) {
      const evidence = change.evidence;
      for (const file of evidence.files) for (const scope of evidence.mode === 'history' ? evidence.commits : ['worktree']) {
        const identity = [process.platform === 'win32' ? evidence.repo.toLowerCase() : evidence.repo, scope, file].join('\0');
        if (assigned.has(identity)) throw new Error('无关需求共用文件范围，必须复核代码归属');
        assigned.add(identity);
      }
    }
  }
}
function commitRoute(draft, key, projectRoot) {
  const item = getItem(draft, key);
  if (draft.schema !== HIERARCHY_SCHEMA || item.codeBinding.kind === 'own') return null;
  if (item.codeBinding.kind === 'none') return { status: 'not-applicable', item: key, reason: item.codeBinding.reason, canCommit: false };
  const parent = getItem(draft, item.parentKey);
  return { status: 'references-parent', item: key, parentKey: parent.key, parentDemand: parent.boss?.demand || null,
    canCommit: false, messages: parent.boss ? messages(draft, parent.key, projectRoot) : [],
    instruction: '代码归属主需求；请选择主需求生成正式计划，保留该主需求全部子项的验收及授权边界' };
}
function relationText(draft) {
  validateHierarchy(draft);
  const rows = draft.requirements.map(item => [item.key, item.parentKey || '-', item.codeBinding.kind,
    item.boss?.demand || '待回填', item.codeBinding.reason || (item.codeBinding.kind === 'parent' ? '复用主需求代码，独立验收' : '唯一代码归属')].join(' | '));
  return '# 主子需求及代码归属\n\n| key | 主需求key | 代码归属 | BOS编号 | 说明 |\n|---|---|---|---|---|\n' + rows.map(row => '| ' + row + ' |').join('\n') + '\n\n代码仅挂own条目；parent条目复用主提交。全部子项通过后按已有授权正式交付；none须保留无代码依据。BOS父子关系由用户录入，导入表保持原29列。\n';
}
function getItem(draft, key) {
  isNonCodeDraft(draft);
  validateHierarchy(draft);
  validateNonCodeDraft(draft);
  const item = draft.requirements.find((entry) => entry.key === key);
  if (!item) throw new Error('找不到需求 key');
  return item;
}

function bind(draft, key, demand, title) {
  const item = getItem(draft, key);
  if (!/^\d+$/.test(demand || '')) throw new Error('BOSS 需求号必须为单个数字编号');
  title = oneLine(title, 'BOSS 最终标题');
  if (item.boss && (item.boss.demand !== demand || item.boss.title !== title)) throw new Error('已绑定不同需求；请复核后在新草稿明确更正，不能静默覆盖');
  if (draft.requirements.some((entry) => entry.key !== key && entry.boss?.demand === demand)) throw new Error('独立需求不能绑定同一需求号');
  item.boss = { demand, title };
  item.imported = true;
  return draft;
}

function messages(draft, key, projectRoot) {
  const item = getItem(draft, key);
  if (isNonCodeDraft(draft)) throw new Error('非代码需求无代码提交对象，不生成 commit message');
  const route = commitRoute(draft, key, projectRoot);
  if (route) return route;
  const { buildMessage, validateModification } = submissionTools(projectRoot);
  if (!item.boss) throw new Error('请先回填 BOSS 需求号和最终标题');
  if (!/^\d+$/.test(item.boss.demand)) throw new Error('无效 BOSS 需求号');
  oneLine(item.boss.title, 'BOSS 最终标题');
  oneLine(item.subject, 'subject');
  if (!['feat', 'fix', 'refactor', 'docs', 'chore'].includes(item.type)) throw new Error('无效提交 type');
  return item.changes.map((change) => {
    verifyEvidence(change.evidence);
    return { repo: change.evidence.repo, mode: change.evidence.mode, files: change.evidence.files,
      message: buildMessage({ kind: 'standard', demand: item.boss.demand, title: item.boss.title, subject: item.subject, type: item.type }, validateModification(change.modification)) };
  });
}

function planArguments(draft, key, projectRoot) {
  getItem(draft, key);
  if (isNonCodeDraft(draft)) throw new Error('非代码需求无代码提交对象，不生成 Git 提交计划');
  const route = commitRoute(draft, key, projectRoot);
  if (route) throw new Error(route.instruction || ('无代码提交对象: ' + route.reason));
  if (!projectRoot) throw new Error('需要 --project-root 以校验实际工程边界');
  const context = resolveWorkspaceContext(projectRoot);
  if (context.mode === 'invalid') throw new Error('Invalid workspace context');
  const availability = checkAvailability({ ...context, capabilityRoot: path.resolve(__dirname, '../../..'), plugin: 'bos-plugin', stage: 'demand-commit' });
  if (!availability.ok) throw new Error('BOS 提交依赖不可用: ' + JSON.stringify(availability.checks));
  const item = getItem(draft, key);
  messages(draft, key, projectRoot);
  if (item.changes.some((change) => change.evidence.mode !== 'worktree')) throw new Error('历史提交只能生成消息；本入口不 amend、rebase 或创建空提交');
  const args = ['plan', '--project-root', path.resolve(projectRoot), '--kind', 'standard', '--demand', item.boss.demand,
    '--subject', item.subject, '--title', item.boss.title, '--type', item.type];
  for (const change of item.changes) {
    for (const file of change.evidence.files) args.push('--file', path.join(change.evidence.repo, file));
    args.push('--modification', `${change.evidence.repo}::${change.modification}`);
  }
  return args;
}

function safeOutputPath(file) {
  const resolved = path.resolve(file);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonical = path.resolve(fs.realpathSync.native(ancestor), path.relative(ancestor, resolved));
  const capabilityRoot = fs.realpathSync.native(path.resolve(__dirname, '..', '..', '..'));
  const insideCapability = (candidate) => {
    const relative = path.relative(capabilityRoot, candidate);
    return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  if ([resolved, canonical].some((candidate) => candidate.split(path.sep).some((part) => part.toLowerCase() === '.agents')) || insideCapability(canonical)) {
    throw new Error('需求产物不能写入 .agents 或能力包源码；请使用工程临时目录或目标工程 docs/work/standard-demand/');
  }
  return resolved;
}

function governedDemandRoots(projectRoot = process.cwd()) {
  const context = resolveWorkspaceContext(path.resolve(projectRoot));
  if (context.mode === 'invalid') throw new Error('Invalid workspace context');
  // Legacy callers without an installed context continue to use their explicit output.
  if (!fs.existsSync(path.join(context.contextRoot, 'config/documentation-layout.json'))) return null;
  const verified = directories.contextFor(context.workspaceRoot), config = directories.configFor(verified);
  if (!config.enabled) return null;
  return {
    context: verified,
    delivery: directories.resolveDirectory(verified.workspaceRoot, 'bos-plugin', 'demand-delivery', 'docs/work/standard-demand'),
    drafts: directories.resolveDirectory(verified.workspaceRoot, 'bos-plugin', 'demand-drafts', 'docs/work/standard-demand'),
  };
}

function draftOutput(file, projectRoot) {
  const resolved = path.resolve(file), roots = governedDemandRoots(projectRoot);
  if (roots && directories.within(resolved, roots.drafts) && !directories.same(resolved, roots.drafts)) {
    const relative = path.relative(roots.context.contextRoot, resolved).split(path.sep).join('/');
    const ignoreRelative = path.relative(roots.context.contextRoot, path.join(roots.drafts, '.gitignore')).split(path.sep).join('/');
    const ignore = directories.safePath(roots.context.contextRoot, ignoreRelative);
    if (fs.existsSync(ignore) && !fs.readFileSync(ignore, 'utf8').split(/\r?\n/).includes('*')) throw new Error('私有草稿目录的 .gitignore 必须忽略全部产物');
    return { file: directories.safePath(roots.context.contextRoot, relative), privateRoot: roots.drafts };
  }
  return { file: safeOutputPath(resolved) };
}

function writeDraft(file, draft, projectRoot) {
  const target = draftOutput(file, projectRoot);
  if (target.privateRoot) {
    fs.mkdirSync(target.privateRoot, { recursive: true });
    const ignore = path.join(target.privateRoot, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', { flag: 'wx' });
    else if (!fs.readFileSync(ignore, 'utf8').split(/\r?\n/).includes('*')) throw new Error('私有草稿目录的 .gitignore 必须忽略全部产物');
  }
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, JSON.stringify(draft, null, 2) + '\n', { flag: 'wx' });
  return target.file;
}

function writeNew(file, value) {
  file = safeOutputPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { flag: 'wx' });
}

function parseArgs(argv) {
  const args = { command: argv[0], files: [], commits: [] };
  const values = { '--repo': 'repo', '--range': 'range', '--output': 'output', '--draft-output': 'draftOutput', '--spec': 'spec', '--draft': 'draft', '--item': 'item', '--demand': 'demand', '--title': 'title', '--project-root': 'projectRoot' };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--excel' || flag === '--Excel') { args.excel = true; continue; }
    if (!(flag in values) && flag !== '--file' && flag !== '--commit') throw new Error(`未知参数: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少值`);
    if (flag === '--file') args.files.push(value);
    else if (flag === '--commit') args.commits.push(value);
    else args[values[flag]] = value;
  }
  const allowed = {
    collect: ['repo', 'range', 'output', 'files', 'commits'],
    prepare: ['spec', 'output', 'draftOutput', 'excel', 'projectRoot'], bind: ['draft', 'item', 'demand', 'title', 'output', 'projectRoot'],
    render: ['draft', 'output', 'draftOutput', 'excel', 'projectRoot'], message: ['draft', 'item', 'projectRoot'], plan: ['draft', 'item', 'projectRoot'],
  }[args.command];
  if (!allowed) throw new Error('用法: demand-entry.js collect|prepare|bind|render|message|plan');
  for (const key of Object.keys(args)) {
    if (key === 'command' || (Array.isArray(args[key]) && !args[key].length)) continue;
    if (!allowed.includes(key)) throw new Error(`${args.command} 不接受参数 ${key}`);
  }
  return args;
}

function deliver(draft, directory, excel, options = {}) {
  isNonCodeDraft(draft);
  validateHierarchy(draft);
  validateNonCodeDraft(draft);
  if (!directory) throw new Error('需要 --output，指定新的交付目录');
  directory = safeOutputPath(directory);
  if (fs.existsSync(directory)) throw new Error('交付目录已存在，请指定新目录以保留已有产物');
  const roots = governedDemandRoots(options.projectRoot);
  let privateFile = options.draftOutput;
  if (!privateFile && roots && directories.within(directory, roots.delivery)) {
    privateFile = path.join(roots.drafts, path.relative(roots.delivery, directory), 'draft.json');
  }
  if (privateFile) {
    privateFile = draftOutput(privateFile, options.projectRoot).file;
    if (directories.within(privateFile, directory)) throw new Error('--draft-output 必须位于可读交付目录之外');
    if (fs.existsSync(privateFile)) throw new Error('私有草稿已存在，请指定新路径以保留恢复资料');
  }
  const active = draft.requirements.filter((item) => !item.imported && !item.boss);
  if (!active.length) throw new Error('没有未录入 BOSS 的条目，不重复导出');
  const texts = active.map((item) => renderText(item));
  const workbook = excel ? buildWorkbook(active, draft.common, renderText) : null;
  fs.mkdirSync(directory, { recursive: true });
  const draftFile = privateFile ? writeDraft(privateFile, draft, options.projectRoot) : path.join(directory, 'draft.json');
  if (!privateFile) writeNew(draftFile, JSON.stringify(draft, null, 2) + '\n');
  for (const [index, item] of active.entries()) writeNew(path.join(directory, `${item.key}.txt`), `${texts[index]}\n`);
  if (draft.schema === HIERARCHY_SCHEMA) writeNew(path.join(directory, 'relations.md'), relationText(draft));
  if (workbook) writeNew(path.join(directory, 'requirements.xlsx'), workbook);
  return { directory, ...(privateFile ? { draft: draftFile } : {}), items: active.map((item) => item.key), excel: !!workbook };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  let result;
  if (args.command === 'collect') {
    result = collect(args);
    if (!args.output) throw new Error('需要 --output 保存取证');
    writeNew(args.output, `${JSON.stringify(result, null, 2)}\n`);
    result = { evidence: path.resolve(args.output), mode: result.mode, files: result.files };
  } else if (args.command === 'prepare') {
    const draft = prepare(readJson(args.spec), path.dirname(path.resolve(args.spec)), args.projectRoot);
    result = deliver(draft, args.output, args.excel, { projectRoot: args.projectRoot, draftOutput: args.draftOutput });
  } else {
    const draft = readJson(args.draft);
    if (args.command === 'bind') {
      result = bind(draft, args.item, args.demand, args.title);
      if (!args.output) throw new Error('需要 --output 保存回填后的新草稿');
      writeDraft(args.output, result, args.projectRoot);
      result = { draft: path.resolve(args.output), item: args.item, demand: args.demand };
    } else if (args.command === 'message') result = messages(draft, args.item, args.projectRoot);
    else if (args.command === 'render') {
      for (const item of draft.requirements) {
        getItem(draft, item.key);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(item.key)) throw new Error('无效 key');
        if (!isNonCodeDraft(draft)) for (const change of item.changes || []) verifyEvidence(change.evidence);
      }
      result = deliver(draft, args.output, args.excel, { projectRoot: args.projectRoot, draftOutput: args.draftOutput });
    } else if (args.command === 'plan') {
      const route = commitRoute(draft, args.item, args.projectRoot);
      if (route) { console.log(JSON.stringify(route, null, 2)); return; }
      const child = spawnSync(process.execPath, [path.resolve(__dirname, '../../demand-delivery-plugin/scripts/commit-demand.js'), ...planArguments(draft, args.item, args.projectRoot)], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
      if (child.error || child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
      process.stdout.write(child.stdout);
      return;
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`[停止] ${error.message}`); process.exitCode = 1; }
}
module.exports = { collect, verifyEvidence, prepare, bind, messages, planArguments, renderText, parseArgs, deliver, commitRoute, relationText, validateHierarchy, main };
