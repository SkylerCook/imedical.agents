'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveWorkspaceContext } = require('../../../../scripts/lib/workspace-context');

const SCHEMA = 'iris-demand-commit-plan/v1';
const TYPES = new Set(['feat', 'fix', 'refactor', 'docs', 'chore']);
const KINDS = new Set(['standard', 'project']);
const PROCESS_BUDGET_MS = 120000;
const processStartedAt = Date.now();

function parseArgs(argv) {
  const args = { command: argv[2] || '', files: [], modifications: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--confirm-commit') args.confirmCommit = true;
    else if (token === '--verify') args.verify = true;
    else if (token === '--file') args.files.push(requiredValue(argv, ++index, token));
    else if (token === '--modification') args.modifications.push(requiredValue(argv, ++index, token));
    else if (token.startsWith('--')) args[toCamel(token.slice(2))] = requiredValue(argv, ++index, token);
    else throw new Error(`未知参数: ${token}`);
  }
  return args;
}

function requiredValue(argv, index, option) {
  if (index >= argv.length || argv[index].startsWith('--')) throw new Error(`${option} 缺少值`);
  return argv[index];
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function runGit(root, args, options = {}) {
  const remainingBudget = PROCESS_BUDGET_MS - (Date.now() - processStartedAt);
  if (remainingBudget <= 0) throw new Error('提交工具本轮执行已达到 2 分钟上限，请检查当前 Git 卡点后重试');
  if (process.env.IRIS_DEMAND_COMMIT_DEBUG === '1') process.stderr.write(`[git:start] ${root} :: ${args.join(' ')}\n`);
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: options.encoding || 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    timeout: Math.min(options.timeout || 60000, remainingBudget),
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
  });
  if (process.env.IRIS_DEMAND_COMMIT_DEBUG === '1') process.stderr.write(`[git:end] status=${result.status} ${args[0]}\n`);
  if (result.error) throw new Error(`git -C ${root} ${args.join(' ')} 执行异常: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    const message = String(result.stderr || result.stdout || '').trim();
    throw new Error(`git -C ${root} ${args.join(' ')} 失败${message ? `: ${message}` : ''}`);
  }
  return result;
}

function gitText(root, args, options = {}) {
  return String(runGit(root, args, options).stdout || '').trim();
}

function comparable(value) {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(candidate, root) {
  const child = comparable(candidate);
  const parent = comparable(root);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function existingAncestor(filePath) {
  let current = path.resolve(filePath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`无法为文件定位现有父目录: ${filePath}`);
    current = parent;
  }
  return fs.statSync(current).isDirectory() ? current : path.dirname(current);
}

function findGitRoot(filePath) {
  const start = existingAncestor(filePath);
  let current = start;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const root = gitText(start, ['rev-parse', '--show-toplevel']);
  if (!root) throw new Error(`文件不属于 Git 仓库: ${filePath}`);
  return path.resolve(root);
}

function assertAllowedRepo(context, repoRoot) {
  if (context.mode === 'workspace-overlay') {
    if (!context.gitRoots.some((root) => comparable(root) === comparable(repoRoot))) {
      throw new Error(`仓库不在 workspace-overlay 声明的 GitRoot 中: ${repoRoot}`);
    }
    return;
  }
  if (!isWithin(repoRoot, context.workspaceRoot)) throw new Error(`仓库超出 WorkspaceRoot: ${repoRoot}`);
}

function relativeGitPath(repoRoot, filePath) {
  const relative = path.relative(repoRoot, path.resolve(filePath)).replace(/\\/g, '/');
  if (!relative || relative === '..' || relative.startsWith('../')) throw new Error(`文件超出仓库边界: ${filePath}`);
  return relative;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function legacyFileState(repoRoot, files) {
  const states = [];
  for (const file of files) {
    const status = gitText(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', file], { allowFailure: false });
    if (!status) throw new Error(`计划文件没有 Git 变更: ${path.join(repoRoot, file)}`);
    const staged = runGit(repoRoot, ['diff', '--cached', '--binary', '--', file]).stdout || '';
    const unstaged = runGit(repoRoot, ['diff', '--binary', '--', file]).stdout || '';
    const absolute = path.join(repoRoot, file);
    let untracked = '';
    if (/^\?\?/.test(status) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      untracked = hash(fs.readFileSync(absolute));
    }
    states.push({ file, status, stagedHash: hash(staged), unstagedHash: hash(unstaged), untrackedHash: untracked });
  }
  return states;
}

function legacyStateFingerprint(states) {
  return hash(JSON.stringify(states));
}

function parseStatusSnapshot(output, root, files) {
  const records = String(output || '').split('\0').filter(Boolean);
  const headers = new Map();
  const statusByFile = new Map();
  for (const record of records) {
    if (record.startsWith('# ')) {
      const separator = record.indexOf(' ', 2);
      if (separator > 2) headers.set(record.slice(2, separator), record.slice(separator + 1));
      continue;
    }
    if (record.startsWith('u ')) throw new Error(`计划文件存在未合并状态: ${root}`);
    if (record.startsWith('2 ')) throw new Error(`计划文件存在重命名状态，请使用重命名后的明确路径重新 plan: ${root}`);
    if (record.startsWith('? ')) {
      statusByFile.set(record.slice(2).replace(/\\/g, '/'), { status: record, indexHash: '(untracked)' });
      continue;
    }
    const ordinary = /^1 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/.exec(record);
    if (ordinary) {
      statusByFile.set(ordinary[8].replace(/\\/g, '/'), { status: record, indexHash: ordinary[7] });
    }
  }
  const head = headers.get('branch.oid') || '';
  const branch = headers.get('branch.head') || '';
  const upstream = headers.get('branch.upstream') || '';
  if (!head || head === '(initial)') throw new Error(`仓库缺少可提交的 HEAD: ${root}`);
  if (!branch || branch === '(detached)') throw new Error(`仓库处于 detached HEAD，禁止自动提交: ${root}`);
  const states = files.map((file) => {
    const item = statusByFile.get(file);
    if (!item) throw new Error(`计划文件没有 Git 变更: ${path.join(root, file)}`);
    const absolute = path.join(root, file);
    const worktreeHash = fs.existsSync(absolute) && fs.statSync(absolute).isFile()
      ? hash(fs.readFileSync(absolute))
      : '(missing)';
    return { file, status: item.status, indexHash: item.indexHash, worktreeHash };
  });
  return { head, branch, upstream, states, fingerprint: hash(JSON.stringify(states)) };
}

function repositoryInfo(root, files) {
  const status = runGit(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--no-renames', '--', ...files]);
  const parsed = parseStatusSnapshot(status.stdout, root, files);
  return {
    root,
    branch: parsed.branch,
    head: parsed.head,
    upstream: parsed.upstream,
    files,
    states: parsed.states,
    stateVersion: 2,
    fingerprint: parsed.fingerprint,
  };
}

function validateModification(value) {
  const text = String(value || '').trim();
  if (/\r|\n/.test(text)) throw new Error('修改说明不能包含换行');
  if (text.length < 18) throw new Error(`修改说明过于简略: ${text || '(empty)'}`);
  if (/^(优化|修复|调整|修改|完善)(功能|问题|代码|逻辑|样式|页面)?[。.]?$/.test(text)) {
    throw new Error(`修改说明过于泛化: ${text}`);
  }
  const solution = /(使用|采用|通过|改为|替代|增加|新增|移除|拆分|限制|保持|聚焦|禁用|校验|同步|回填|兼容)/.test(text);
  const outcome = /(避免|确保|使|从而|提示|聚焦|显示|保存|返回|阻止|保留|支持|解决|关闭|生效)/.test(text);
  if (!solution || !outcome) throw new Error(`修改说明必须同时体现具体方案和行为结果: ${text}`);
  return text;
}

function modificationMap(values, repositories) {
  if (repositories.length === 1 && values.length === 1 && !values[0].includes('::')) {
    return new Map([[comparable(repositories[0].root), validateModification(values[0])]]);
  }
  const mapped = new Map();
  for (const value of values) {
    const separator = value.indexOf('::');
    if (separator <= 0) throw new Error('多仓库修改说明必须使用 <repo-root>::<说明>');
    mapped.set(comparable(value.slice(0, separator)), validateModification(value.slice(separator + 2)));
  }
  for (const repo of repositories) {
    if (!mapped.has(comparable(repo.root))) throw new Error(`仓库缺少独立修改说明: ${repo.root}`);
  }
  return mapped;
}

function buildMessage(args, modification) {
  const summary = String(args.subject || args.title).trim();
  const subject = `${args.type}(${args.demand}):${summary}`;
  const lines = [subject, `修改说明:${modification}`];
  if (args.kind === 'standard') lines.push(`需求描述:${args.demand} ${args.title.trim()}`);
  return `${lines.join('\n')}\n`;
}

function defaultPlanPath(projectRoot, demand) {
  const identity = hash(path.resolve(projectRoot)).slice(0, 16);
  return path.join(os.tmpdir(), 'codex-iris-demand-commit', identity, `${demand}.json`);
}

function writeJson(filePath, value) {
  if (value && value.schema === SCHEMA) {
    const unsigned = { ...value };
    delete unsigned.integrity;
    value.integrity = hash(JSON.stringify(unsigned));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function planCommand(args) {
  const projectRoot = path.resolve(args.projectRoot || process.cwd());
  if (!KINDS.has(args.kind)) throw new Error('--kind 必须是 standard 或 project；TODO 必须先由用户补全');
  if (!/^\d+$/.test(args.demand || '')) throw new Error('--demand 必须是单个数字需求号');
  if (!TYPES.has(args.type)) throw new Error('--type 必须是 feat/fix/refactor/docs/chore');
  if (!String(args.title || '').trim()) throw new Error('--title 不能为空');
  if (/\r|\n/.test(args.title)) throw new Error('--title 不能包含换行');
  if (args.subject !== undefined && !String(args.subject).trim()) throw new Error('--subject 不能为空');
  if (/\r|\n/.test(args.subject || '')) throw new Error('--subject 不能包含换行');
  if (!args.files.length) throw new Error('至少需要一个 --file');

  const context = resolveWorkspaceContext(projectRoot);
  if (!['standard', 'workspace-overlay'].includes(context.mode)) throw new Error(`无效 workspace context: ${context.mode}`);
  const grouped = new Map();
  for (const supplied of args.files) {
    const absolute = path.resolve(projectRoot, supplied);
    const repoRoot = findGitRoot(absolute);
    assertAllowedRepo(context, repoRoot);
    const key = comparable(repoRoot);
    if (!grouped.has(key)) grouped.set(key, { root: repoRoot, files: [] });
    const relative = relativeGitPath(repoRoot, absolute);
    if (!grouped.get(key).files.includes(relative)) grouped.get(key).files.push(relative);
  }
  const repositories = [...grouped.values()].sort((left, right) => left.root.localeCompare(right.root));
  for (const repo of repositories) repo.files.sort();
  const modifications = modificationMap(args.modifications, repositories);
  const planned = repositories.map((repo) => {
    const info = repositoryInfo(repo.root, repo.files);
    info.modification = modifications.get(comparable(repo.root));
    info.message = buildMessage(args, info.modification);
    info.execution = { status: 'planned', pull: 'pending', commit: '' };
    return info;
  });
  const output = path.resolve(args.output || defaultPlanPath(projectRoot, args.demand));
  if (!isWithin(output, os.tmpdir())) throw new Error('--output 必须位于系统临时目录');
  const plan = {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    projectRoot,
    kind: args.kind,
    demand: args.demand,
    subject: String(args.subject || args.title).trim(),
    title: args.title.trim(),
    type: args.type,
    repositories: planned,
    status: 'planned',
    planPath: output,
  };
  writeJson(output, plan);
  console.log(JSON.stringify(plan, null, 2));
}

function readPlan(planPath) {
  if (!planPath) throw new Error('--plan 不能为空');
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf8').replace(/^\uFEFF/, ''));
  if (plan.schema !== SCHEMA) throw new Error(`不支持的计划 schema: ${plan.schema || '(missing)'}`);
  const unsigned = { ...plan };
  const integrity = unsigned.integrity;
  delete unsigned.integrity;
  if (!integrity || integrity !== hash(JSON.stringify(unsigned))) throw new Error('计划内容已被修改，请重新 plan');
  return plan;
}

function assertRepoUnchanged(repo) {
  if (repo.stateVersion !== 2) {
    const currentHead = gitText(repo.root, ['rev-parse', 'HEAD']);
    if (currentHead !== repo.head) throw new Error(`仓库 HEAD 已变化，请重新 plan: ${repo.root}`);
    const currentBranch = gitText(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
    if (currentBranch !== repo.branch) throw new Error(`仓库分支已变化，请重新 plan: ${repo.root}`);
    const upstreamResult = runGit(repo.root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true });
    const currentUpstream = upstreamResult.status === 0 ? String(upstreamResult.stdout || '').trim() : '';
    if (currentUpstream !== repo.upstream) throw new Error(`仓库 upstream 已变化，请重新 plan: ${repo.root}`);
    const current = legacyFileState(repo.root, repo.files);
    if (legacyStateFingerprint(current) !== repo.fingerprint) throw new Error(`计划文件状态已变化，请重新 plan: ${repo.root}`);
    return { head: currentHead, branch: currentBranch, upstream: currentUpstream };
  }
  const current = repositoryInfo(repo.root, repo.files);
  assertSnapshotMatches(repo, current);
  return current;
}

function assertSnapshotMatches(repo, current) {
  if (current.head !== repo.head) throw new Error(`仓库 HEAD 已变化，请重新 plan: ${repo.root}`);
  if (current.branch !== repo.branch) throw new Error(`仓库分支已变化，请重新 plan: ${repo.root}`);
  if (current.upstream !== repo.upstream) throw new Error(`仓库 upstream 已变化，请重新 plan: ${repo.root}`);
  if (current.fingerprint !== repo.fingerprint) throw new Error(`计划文件状态已变化，请重新 plan: ${repo.root}`);
}

function applyCommand(args) {
  if (!args.confirmCommit) throw new Error('缺少 --confirm-commit；没有用户明确授权时禁止提交');
  const plan = readPlan(args.plan);
  const checked = new Map();
  for (const repo of plan.repositories) {
    checked.set(comparable(repo.root), assertRepoUnchanged(repo));
    if (plan.kind === 'standard' && !repo.upstream) throw new Error(`标版仓库缺少 upstream: ${repo.root}`);
  }

  let refreshed = false;
  for (const repo of plan.repositories) {
    if (!repo.upstream) {
      repo.execution.pull = 'local-only';
      continue;
    }
    const before = checked.get(comparable(repo.root)).head;
    runGit(repo.root, ['pull', '--ff-only']);
    const after = repo.stateVersion === 2
      ? repositoryInfo(repo.root, repo.files)
      : { head: gitText(repo.root, ['rev-parse', 'HEAD']) };
    checked.set(comparable(repo.root), after);
    repo.execution.pull = before === after.head ? 'up-to-date' : 'fast-forwarded';
    if (before !== after.head) refreshed = true;
  }
  if (refreshed) {
    plan.status = 'refresh-required';
    writeJson(plan.planPath, plan);
    console.log(JSON.stringify(plan, null, 2));
    process.exitCode = 3;
    return;
  }

  for (const repo of plan.repositories) {
    if (repo.stateVersion === 2) assertSnapshotMatches(repo, checked.get(comparable(repo.root)));
    else assertRepoUnchanged(repo);
  }
  plan.status = 'committing';
  writeJson(plan.planPath, plan);
  for (const repo of plan.repositories) {
    runGit(repo.root, ['add', '--all', '--', ...repo.files]);
    const messageFile = path.join(path.dirname(plan.planPath), `${hash(repo.root).slice(0, 12)}.message.txt`);
    fs.writeFileSync(messageFile, repo.message, 'utf8');
    runGit(repo.root, ['commit', '--only', '-F', messageFile, '--', ...repo.files]);
    repo.execution.commit = gitText(repo.root, ['rev-parse', 'HEAD']);
    repo.execution.status = 'committed';
    writeJson(plan.planPath, plan);
  }
  plan.status = 'committed';
  writeJson(plan.planPath, plan);
  if (args.verify) verifyPlan(plan);
  console.log(JSON.stringify(plan, null, 2));
}

function verifyPlan(plan) {
  if (plan.status !== 'committed') throw new Error(`计划尚未全部提交: ${plan.status}`);
  for (const repo of plan.repositories) {
    const commit = repo.execution && repo.execution.commit;
    if (!commit) throw new Error(`仓库缺少提交记录: ${repo.root}`);
    const actualMessage = `${gitText(repo.root, ['show', '-s', '--format=%B', commit])}\n`;
    if (actualMessage !== repo.message) throw new Error(`提交信息不一致: ${repo.root}`);
    const changed = gitText(repo.root, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).split(/\r?\n/).filter(Boolean);
    const missing = repo.files.filter((file) => !changed.includes(file));
    if (missing.length) throw new Error(`提交缺少计划文件: ${repo.root}: ${missing.join(', ')}`);
    repo.execution.status = 'verified';
    repo.execution.remainingStatus = gitText(repo.root, ['status', '--short']);
  }
  plan.status = 'verified';
  writeJson(plan.planPath, plan);
}

function verifyCommand(args) {
  const plan = readPlan(args.plan);
  verifyPlan(plan);
  console.log(JSON.stringify(plan, null, 2));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'plan') planCommand(args);
  else if (args.command === 'apply') applyCommand(args);
  else if (args.command === 'verify') verifyCommand(args);
  else throw new Error('用法: commit-demand.js <plan|apply|verify> ...');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[停止] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildMessage, validateModification, planCommand, applyCommand, verifyCommand };
