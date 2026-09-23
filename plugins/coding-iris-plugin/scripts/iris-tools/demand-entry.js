'use strict';

// Standard demand preparation is local and read-only with respect to Git.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildMessage, validateModification } = require('./commit-demand');
const { buildWorkbook } = require('./demand-entry-xlsx');
const SCHEMA = 'iris-standard-demand/v1';
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

function renderText(item, withName = true) {
  const parts = withName ? [`名称：\n\n${item.name}`] : [];
  for (const [label, value] of [['标题', item.title], ['需求背景', item.background], ['需求内容', item.content], ['备注', item.remarks]]) {
    const body = text(value);
    if (body) parts.push(`${label}：\n\n${body.split('\n').map((line) => line ? `    ${line}` : '').join('\n')}`);
  }
  return parts.join('\n\n');
}

function prepare(spec, baseDirectory) {
  if (spec.kind !== 'standard') throw new Error('此入口仅支持 kind=standard');
  if (!Array.isArray(spec.requirements) || !spec.requirements.length) throw new Error('requirements 不能为空');
  const keys = new Set();
  const assigned = new Set();
  const requirements = spec.requirements.map((raw) => {
    const key = oneLine(raw.key, 'key');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key) || keys.has(key)) throw new Error('key 必须唯一且只含字母数字下划线短横线');
    keys.add(key);
    const item = {
      key, name: oneLine(raw.name, 'name'), title: oneLine(raw.title || raw.name.replace(/^\{[^}]+\}\s*/, ''), 'title'),
      background: text(raw.background), content: text(raw.content), remarks: text(raw.remarks),
      type: raw.type, subject: oneLine(raw.subject, 'subject'), fields: raw.fields || {},
      verification: text(raw.verification), imported: raw.imported === true,
    };
    if (!['feat', 'fix', 'refactor', 'docs', 'chore'].includes(item.type)) throw new Error('无效提交 type');
    if (!item.background || !item.content) throw new Error('需求背景和内容不能为空；未知业务事实应明确待确认');
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
  return { schema: SCHEMA, kind: 'standard', createdAt: new Date().toISOString(), common: spec.common || {}, requirements };
}

function getItem(draft, key) {
  if (draft.schema !== SCHEMA || draft.kind !== 'standard') throw new Error('不支持的需求草稿');
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

function messages(draft, key) {
  const item = getItem(draft, key);
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
  const item = getItem(draft, key);
  messages(draft, key);
  if (item.changes.some((change) => change.evidence.mode !== 'worktree')) throw new Error('历史提交只能生成消息；本入口不 amend、rebase 或创建空提交');
  if (!projectRoot) throw new Error('需要 --project-root 以校验实际工程边界');
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
  const capabilityRoot = fs.realpathSync.native(path.resolve(__dirname, '..', '..', '..', '..'));
  const insideCapability = (candidate) => {
    const relative = path.relative(capabilityRoot, candidate);
    return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  if ([resolved, canonical].some((candidate) => candidate.split(path.sep).some((part) => part.toLowerCase() === '.agents')) || insideCapability(canonical)) {
    throw new Error('需求产物不能写入 .agents 或能力包源码；请使用工程临时目录或目标工程 docs/work/standard-demand/');
  }
  return resolved;
}

function writeNew(file, value) {
  file = safeOutputPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { flag: 'wx' });
}

function parseArgs(argv) {
  const args = { command: argv[0], files: [], commits: [] };
  const values = { '--repo': 'repo', '--range': 'range', '--output': 'output', '--spec': 'spec', '--draft': 'draft', '--item': 'item', '--demand': 'demand', '--title': 'title', '--project-root': 'projectRoot' };
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
    prepare: ['spec', 'output', 'excel'], bind: ['draft', 'item', 'demand', 'title', 'output'],
    render: ['draft', 'output', 'excel'], message: ['draft', 'item'], plan: ['draft', 'item', 'projectRoot'],
  }[args.command];
  if (!allowed) throw new Error('用法: demand-entry.js collect|prepare|bind|render|message|plan');
  for (const key of Object.keys(args)) {
    if (key === 'command' || (Array.isArray(args[key]) && !args[key].length)) continue;
    if (!allowed.includes(key)) throw new Error(`${args.command} 不接受参数 ${key}`);
  }
  return args;
}

function deliver(draft, directory, excel) {
  if (!directory) throw new Error('需要 --output，指定新的交付目录');
  directory = safeOutputPath(directory);
  if (fs.existsSync(directory)) throw new Error('交付目录已存在，请指定新目录以保留已有产物');
  const active = draft.requirements.filter((item) => !item.imported && !item.boss);
  if (!active.length) throw new Error('没有未录入 BOSS 的条目，不重复导出');
  const workbook = excel ? buildWorkbook(active, draft.common, renderText) : null;
  fs.mkdirSync(directory, { recursive: true });
  writeNew(path.join(directory, 'draft.json'), `${JSON.stringify(draft, null, 2)}\n`);
  for (const item of active) writeNew(path.join(directory, `${item.key}.txt`), `${renderText(item)}\n`);
  if (workbook) writeNew(path.join(directory, 'requirements.xlsx'), workbook);
  return { directory, items: active.map((item) => item.key), excel: !!workbook };
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
    const draft = prepare(readJson(args.spec), path.dirname(path.resolve(args.spec)));
    result = deliver(draft, args.output, args.excel);
  } else {
    const draft = readJson(args.draft);
    if (args.command === 'bind') {
      result = bind(draft, args.item, args.demand, args.title);
      if (!args.output) throw new Error('需要 --output 保存回填后的新草稿');
      writeNew(args.output, `${JSON.stringify(result, null, 2)}\n`);
      result = { draft: path.resolve(args.output), item: args.item, demand: args.demand };
    } else if (args.command === 'message') result = messages(draft, args.item);
    else if (args.command === 'render') {
      for (const item of draft.requirements) {
        getItem(draft, item.key);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(item.key)) throw new Error('无效 key');
        for (const change of item.changes) verifyEvidence(change.evidence);
      }
      result = deliver(draft, args.output, args.excel);
    } else if (args.command === 'plan') {
      const child = spawnSync(process.execPath, [path.join(__dirname, 'commit-demand.js'), ...planArguments(draft, args.item, args.projectRoot)], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
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
module.exports = { collect, verifyEvidence, prepare, bind, messages, planArguments, renderText, parseArgs, deliver, main };
