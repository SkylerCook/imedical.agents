'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TYPES = new Set(['feat', 'fix', 'refactor', 'docs', 'chore']);
const HOOK = 'imedical-standard-message';
const EVENT = 'commit-msg';
const COMMAND_KEY = `hook.${HOOK}.command`;
const EVENT_KEY = `hook.${HOOK}.event`;
const shellQuote = value => `'${value.replace(/'/g, "'\\''")}'`;
const gitShellPath = value => shellQuote(value.split(path.sep).join('/'));
const hookCommand = `${gitShellPath(process.execPath)} ${gitShellPath(__filename)} hook-run`;
const ownCommand = value => value.endsWith("/plugins/demand-delivery-plugin/scripts/commit-message-policy.js' hook-run");

function runGit(repo, args, input) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', repo, ...args], {
    encoding: 'utf8', input, windowsHide: true, timeout: 30000,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error(`Git 执行中断: ${args[0]}`);
  return result;
}

function gitOutput(repo, args, input) {
  const result = runGit(repo, args, input);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Git 执行失败: ${args[0]}`);
  return result.stdout;
}

function standardMessageError(message, demand) {
  const normalized = message.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const lines = normalized.split('\n');
  const subject = /^([a-z]+)\((\d+)\):(.+)$/.exec(lines[0]);
  if (!subject || !TYPES.has(subject[1]) || !subject[3].trim()) {
    return '首行须为 feat/fix/refactor/docs/chore(数字需求号):菜单或功能摘要';
  }
  if (!/^修改说明:\s*\S.*$/.test(lines[1] || '')) return '第二行缺少非空的 修改说明:';
  const description = /^需求描述:(\d+) (.+)$/.exec(lines[2] || '');
  if (!description || !description[2].trim()) return '第三行须为 需求描述:数字需求号 完整需求标题';
  if (lines.length !== 3) return '标版提交须有三行，请将正文归入 修改说明: 或 需求描述:';
  if (description[1] !== subject[2] || (demand !== undefined && subject[2] !== demand)) {
    return demand === undefined ? '首行和需求描述的需求号须一致' : `首行和需求描述的需求号须为 ${demand}`;
  }
  return '';
}

function verifyStandardCommitMessage(repo, commit, demand) {
  if (!/^[a-f0-9]{40}$/i.test(commit || '')) throw new Error('需要完整的 40 位 Git commit SHA');
  if (!/^\d+$/.test(demand || '')) throw new Error('需要明确的数字需求号');
  const root = worktreeRoot(repo);
  const output = gitOutput(root, ['show', '-s', '--no-notes', '--no-show-signature', '--format=%H%x00%B', commit, '--']);
  const separator = output.indexOf('\0');
  if (separator < 0 || output.slice(0, separator) !== commit.toLowerCase()) throw new Error(`未读到指定 Git commit: ${commit}`);
  const error = standardMessageError(output.slice(separator + 1), demand);
  if (error) throw new Error(`standard-commit-message-invalid [${path.basename(repo)} ${commit.slice(0, 12)}]: ${error}。按 demand-commit 复核待推送提交；已推送历史沿原回执恢复。`);
}

function configuration(repo, key, local) {
  const result = runGit(repo, ['config', ...(local ? ['--local'] : []), '--null', '--get-all', key]);
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error(result.stderr.trim() || `读取 Git 配置失败: ${key}`);
  return result.stdout.split('\0').slice(0, -1);
}

function worktreeRoot(repo) {
  const root = fs.realpathSync.native(gitOutput(repo, ['rev-parse', '--show-toplevel']).trim());
  if (root !== fs.realpathSync.native(repo)) throw new Error('--repo 必须指向 Git 工作树根目录');
  return root;
}

function gitForHook(repo) {
  const root = worktreeRoot(repo);
  const gitDir = fs.realpathSync.native(gitOutput(root, ['rev-parse', '--absolute-git-dir']).trim());
  const common = fs.realpathSync.native(path.resolve(root, gitOutput(root, ['rev-parse', '--git-common-dir']).trim()));
  return { root, linked: gitDir !== common };
}

function namedHooksSupported(repo) {
  const version = /^git version (\d+)\.(\d+)/.exec(gitOutput(repo, ['--version']));
  return Boolean(version && (+version[1] > 2 || (+version[1] === 2 && +version[2] >= 54)));
}

function listedHook(repo) {
  const result = runGit(repo, ['hook', 'list', '--show-scope', EVENT]);
  if ((result.status !== 0 && result.status !== 1) || (result.status === 1 && result.stdout)) {
    throw new Error(result.stderr.trim() || `无法读取 ${EVENT} hook 列表`);
  }
  return result.stdout.split(/\r?\n/).some(line => line.trim().split(/\s+/).at(-1) === HOOK);
}

function hookStatus(repo) {
  const commands = configuration(repo, COMMAND_KEY, true);
  const events = configuration(repo, EVENT_KEY, true);
  const ownsConfiguration = commands.length === 1 && ownCommand(commands[0]);
  const complete = ownsConfiguration && commands[0] === hookCommand && events.length === 1 && events[0] === EVENT;
  const supported = namedHooksSupported(repo);
  const active = supported && listedHook(repo);
  const effectiveCommand = configuration(repo, COMMAND_KEY, false).at(-1);
  return { supported, complete: complete && effectiveCommand === hookCommand, active, commands, events, ownsConfiguration };
}

function configureHook(repo, action) {
  const { root, linked } = gitForHook(repo);
  const before = hookStatus(root);
  if (action === 'status') {
    return { repo: root, hook: HOOK, status: before.complete && before.active ? 'enabled' : !before.supported ? 'unsupported' : before.active || before.commands.length || before.events.length ? 'inactive-or-external' : 'disabled' };
  }
  if (linked) throw new Error('请在主工作树配置此 hook。Git 仓库的本地 hook 配置由全部关联工作树共用。');
  if (action === 'enable') {
    if (!before.supported) throw new Error('命名 Git hook 需要 Git 2.54 或更新版本。仍可在框架推送前核验。');
    if (before.complete && before.active) return configureHook(root, 'status');
    const effectiveCommands = configuration(root, COMMAND_KEY, false);
    const effectiveEvents = configuration(root, EVENT_KEY, false);
    if (effectiveCommands.length > before.commands.length || effectiveEvents.length > before.events.length ||
      effectiveCommands.some(command => !ownCommand(command)) || effectiveEvents.some(event => event !== EVENT) ||
      (before.events.length && !before.ownsConfiguration)) throw new Error(`存在同名 ${HOOK} 配置，请检查配置来源`);
    gitOutput(root, ['config', '--local', '--replace-all', COMMAND_KEY, hookCommand]);
    try {
      gitOutput(root, ['config', '--local', '--replace-all', EVENT_KEY, EVENT]);
      const result = configureHook(root, 'status');
      if (result.status !== 'enabled') throw new Error(`Git 未确认 ${HOOK} 生效，请检查仓库配置`);
      return result;
    } catch (error) {
      if (!before.events.length) runGit(root, ['config', '--local', '--fixed-value', '--unset-all', EVENT_KEY, EVENT]);
      if (!before.commands.length) runGit(root, ['config', '--local', '--fixed-value', '--unset-all', COMMAND_KEY, hookCommand]);
      else if (before.commands[0] !== hookCommand) runGit(root, ['config', '--local', '--fixed-value', '--replace-all', COMMAND_KEY, before.commands[0], hookCommand]);
      throw error;
    }
  }
  if (before.commands.length || before.events.length) {
    if (!before.ownsConfiguration || before.events.some(event => event !== EVENT)) throw new Error(`本地 ${HOOK} 配置归属不明，请检查配置来源`);
    if (before.events.length) gitOutput(root, ['config', '--local', '--fixed-value', '--unset-all', EVENT_KEY, EVENT]);
    gitOutput(root, ['config', '--local', '--fixed-value', '--unset-all', COMMAND_KEY, before.commands[0]]);
  }
  return configureHook(root, 'status');
}

function runCommitHook(repo, messagePath) {
  const markers = gitOutput(repo, ['rev-parse', '--git-path', 'MERGE_HEAD', '--git-path', 'REVERT_HEAD', '--git-path', 'CHERRY_PICK_HEAD']);
  if (markers.split(/\r?\n/).some(marker => marker && fs.existsSync(path.resolve(repo, marker)))) return;
  const proposed = fs.readFileSync(messagePath, 'utf8').replace(/^\uFEFF/, '');
  const cleanup = configuration(repo, 'commit.cleanup', false).at(-1) || 'default';
  // Match Git's default: remove comments from edited messages, retain them in -m/-F messages.
  const stripComments = cleanup === 'strip' || (cleanup === 'default' && process.env.GIT_EDITOR !== ':');
  const message = stripComments ? gitOutput(repo, ['stripspace', '--strip-comments'], proposed) : proposed;
  const error = standardMessageError(message);
  if (error) throw new Error(`standard-commit-message-invalid: ${error}。按 demand-commit 生成本仓标版提交。`);
}

if (require.main === module) {
  try {
    const [command, messagePath] = process.argv.slice(2);
    if (command !== 'hook-run' || !messagePath) throw new Error('此入口由 Git commit-msg 调用');
    runCommitHook(process.cwd(), messagePath);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { TYPES, configureHook, standardMessageError, verifyStandardCommitMessage };
