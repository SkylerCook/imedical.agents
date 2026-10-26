#!/usr/bin/env node
'use strict';

// BOS 代码更新日志：把 git 提交记录补录到 BOS 的 CodeUpdateLog 接口。
// 只使用 Node 内置模块与全局 fetch，无 npm 依赖。凭据只读取共享私有配置中本技能的配置段，不回显。
// git 进程数刻意压到最低：仓库名直接读 .git/config，同一仓库的多个提交合并成一次 git show。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const personal = require('./personal-config');
const { verifyRealCommits } = require('../../../scripts/lib/real-repository-commit');
const DEFAULT_TIMEOUT = 30000;
const MAX_BUFFER = 64 * 1024 * 1024;
const REQUIREMENT_PREFIX = /^\w+\((\d+)\):/;
const REQUIREMENT_STRIP = /^\w+\(\d+\):/;
const MODIFY_MARKER = '修改说明:';
const CONTENT_MARKER = '需求描述:';
const HASH_PATTERN = /^[0-9a-fA-F]{7,40}$/;
const NUMSTAT_PATTERN = /^(\d+|-)\s+(\d+|-)\s+(.+)$/;
const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

function git(repoPath, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: repoPath,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER
  });
  if (result.error) throw new Error(`无法执行 git：${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args[0]} 执行失败：${(result.stderr || '').trim() || `退出码 ${result.status}`}`);
  return result.stdout || '';
}

function gitOr(repoPath, args, fallback = '') {
  try {
    return git(repoPath, args);
  } catch {
    return fallback;
  }
}

// 提交信息格式：<type>(<需求号>):<菜单名称> + 修改说明: + 需求描述:
// 需求描述行只作为切分标记，正文不进入 payload；菜单名称取自首行前缀之后的文本。
function parseCommitMessage(message) {
  const empty = { requirementCode: '', menuNames: '', modifyDesc: '', error: '' };
  const text = String(message || '');
  const matched = text.match(REQUIREMENT_PREFIX);
  if (!matched) return { ...empty, error: '需求号为空！' };
  const parts = text.replace(REQUIREMENT_STRIP, '').split(/(?=修改说明:|需求描述:)/);
  let menuNames = '';
  let modifyDesc = '';
  for (const part of parts) {
    if (part.startsWith(MODIFY_MARKER)) modifyDesc = part.slice(MODIFY_MARKER.length).trim();
    else if (part.startsWith(CONTENT_MARKER)) continue;
    else if (part.trim()) menuNames = part.trim();
  }
  if (!menuNames) return { ...empty, requirementCode: matched[1], error: '菜单名称为空！' };
  if (!modifyDesc) return { ...empty, requirementCode: matched[1], error: '修改说明为空！' };
  return { requirementCode: matched[1], menuNames, modifyDesc, error: '' };
}

// 仓库项目名取 remote 地址路径的最后一段（去掉 .git），兼容 https 与 scp 形式的 SSH 地址。
function resolveProjectName(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  if (!value) return '';
  const tail = value.replace(/\.git$/i, '').split(/[\\/]/).filter(Boolean).pop() || '';
  return tail;
}

function parseNumstat(stdout) {
  const files = [];
  for (const line of String(stdout || '').split('\n')) {
    const matched = line.match(NUMSTAT_PATTERN);
    if (!matched) continue;
    files.push({
      path: matched[3].trim(),
      addLines: matched[1] === '-' ? 0 : Number(matched[1]),
      delLines: matched[2] === '-' ? 0 : Number(matched[2])
    });
  }
  return files;
}

function gitDirOf(repoPath) {
  const dotGit = path.join(repoPath, '.git');
  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return '';
  }
  if (stat.isDirectory()) return dotGit;
  const matched = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/im);
  if (!matched) return '';
  const dir = path.resolve(repoPath, matched[1].trim());
  try {
    const common = fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim();
    if (common) return path.resolve(dir, common);
  } catch {
    // 普通 submodule 没有 commondir
  }
  return dir;
}

// 直接读 .git/config，避免每个仓库都启动一次 git 进程。
function readOriginUrl(repoPath) {
  const dir = gitDirOf(repoPath);
  if (!dir) return '';
  let config;
  try {
    config = fs.readFileSync(path.join(dir, 'config'), 'utf8');
  } catch {
    return '';
  }
  let inOrigin = false;
  for (const line of config.split('\n')) {
    const section = line.match(/^\s*\[(.+?)\]\s*$/);
    if (section) {
      inOrigin = /^remote\s+"origin"$/i.test(section[1].trim());
      continue;
    }
    if (!inOrigin) continue;
    const entry = line.match(/^\s*url\s*=\s*(.+?)\s*$/i);
    if (entry) return entry[1];
  }
  return '';
}

function repoName(repoPath) {
  return resolveProjectName(readOriginUrl(repoPath)) || path.basename(path.resolve(repoPath));
}

function loadConfig(env = process.env) {
  const selected = personal.readSkillConfig(env, 'bos-code-update-log');
  if (selected.connection !== undefined && selected.connection !== 'company') throw new Error('bos-code-update-log connection 无效');
  if (selected.connection === 'company' && Object.hasOwn(selected, 'url')) throw new Error('公司连接配置不能同时设置 url');
  const url = selected.connection === 'company' ? personal.companyUrl('codeUpdateLogUrl') : selected.url;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('代码更新日志接口地址不是有效 URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('代码更新日志接口地址必须为不含鉴权参数的 HTTPS 地址');
  const required = (key) => {
    const value = selected[key];
    if (typeof value !== 'string' || !value.trim() || /^(TODO|xxxxx)$/i.test(value.trim())) throw new Error('请补全 bos-code-update-log.' + key + '，凭据和关联项目不能为 TODO');
    return value.trim();
  };
  const token = required('token'), linkProject = required('linkProject');
  const timeout = selected.timeout === undefined ? DEFAULT_TIMEOUT : selected.timeout;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('bos-code-update-log.timeout 必须为有效的正整数毫秒数');
  return { url: parsed.href, token, linkProject, timeout, configSource: 'private-file:bos-code-update-log' };
}

function assertHash(hash) {
  const value = String(hash || '').trim();
  if (!HASH_PATTERN.test(value)) throw new Error('提交 hash 格式无效');
  return value;
}

function listRepos(workspaceRoot, maxDepth = 3) {
  const root = path.resolve(workspaceRoot);
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some(entry => entry.name === '.git')) found.push(dir);
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return found.map(repoPath => ({ path: repoPath, name: repoName(repoPath) }));
}

function listCommits(repoPath, limit = 30, ref) {
  const count = Number(limit);
  if (!Number.isInteger(count) || count <= 0) throw new Error('--limit 必须为正整数');
  const target = verifyRealCommits(repoPath, ref, []);
  const stdout = git(target.repo, ['log', `-${count}`, '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ad', '--date=format:%Y-%m-%d %H:%M', target.ref]);
  return stdout
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [hash = '', shortHash = '', message = '', author = '', date = ''] = line.split(FIELD_SEPARATOR);
      return { hash: hash.trim(), shortHash: shortHash.trim(), message: message.trim(), author: author.trim(), date: date.trim() };
    });
}

function parseCommitBlock(block) {
  const first = block.indexOf(FIELD_SEPARATOR);
  const second = block.indexOf(FIELD_SEPARATOR, first + 1);
  if (first < 0 || second < 0) throw new Error('无法解析 git show 输出');
  const lines = block.slice(second + 1).split('\n');
  const cut = lines.findIndex(line => NUMSTAT_PATTERN.test(line));
  const boundary = cut < 0 ? lines.length : cut;
  return {
    hash: block.slice(0, first).trim(),
    shortHash: block.slice(first + 1, second).trim(),
    message: lines.slice(0, boundary).join('\n').trim(),
    files: parseNumstat(lines.slice(boundary).join('\n'))
  };
}

// 同一仓库的多个提交合并为一次 git show，减少进程启动次数。
function commitRecords(repoPath, hashes) {
  if (hashes.length === 0) return [];
  const targets = hashes.map(assertHash);
  const stdout = git(repoPath, [
    'show',
    `--pretty=format:${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%B`,
    '--numstat',
    ...targets
  ]);
  const blocks = stdout.split(RECORD_SEPARATOR).slice(1);
  if (blocks.length !== targets.length) throw new Error(`git show 返回 ${blocks.length} 条记录，与请求的 ${targets.length} 条不一致`);
  const project = repoName(repoPath);
  return blocks.map(block => ({ repo: path.resolve(repoPath), project, ...parseCommitBlock(block) }));
}

function selectRecords(select) {
  if (!Array.isArray(select) || select.length === 0) throw new Error('请至少提供一条提交记录');
  const byRepo = new Map();
  const order = [];
  for (const item of select) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('提交记录必须是含 repo 与 hash 的对象');
    if (!item.repo) throw new Error('提交记录缺少 repo');
    if (typeof item.repo !== 'string') throw new Error('repo 必须为仓库路径字符串');
    const repo = fs.realpathSync(path.resolve(item.repo));
    if (!byRepo.has(repo)) byRepo.set(repo, { ref: item.ref, hashes: [] });
    if (byRepo.get(repo).ref !== item.ref) throw new Error('同一实仓不能在一次日志选择中声明不同目标分支');
    const hash = assertHash(item.hash);
    if (!byRepo.get(repo).hashes.includes(hash)) byRepo.get(repo).hashes.push(hash);
    order.push({ repo, hash });
  }
  const records = [];
  // Validate every repository before collecting any log or loading credentials.
  for (const [repo, target] of byRepo) verifyRealCommits(repo, target.ref, target.hashes);
  for (const [repo, target] of byRepo) records.push(...commitRecords(repo, target.hashes).map(record => ({ ...record, ref: target.ref })));
  const seen = new Set();
  return order.map(item => {
    const record = records.find(record => record.repo === item.repo && record.hash.toLowerCase().startsWith(item.hash.toLowerCase()));
    if (!record) throw new Error('提交记录无法与选择项对应');
    const key = record.repo + ':' + record.hash;
    if (seen.has(key)) return null;
    seen.add(key);
    return record;
  }).filter(Boolean);
}

// Explicit target/owner bindings reuse immutable commits without rewriting their messages.
function selectInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('日志输入必须为对象');
  if (Object.hasOwn(input, 'select') && Object.hasOwn(input, 'bindings')) throw new Error('select 与 bindings 互斥');
  if (!Object.hasOwn(input, 'bindings')) return selectRecords(input.select);
  if (!Array.isArray(input.bindings) || !input.bindings.length) throw new Error('bindings 不能为空；明确无代码的条目在流程中记录不适用');
  const owners = new Map(), selections = [];
  for (const binding of input.bindings) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) ||
        typeof binding.requirementCode !== 'string' || typeof binding.codeOwnerRequirementCode !== 'string' ||
        !/^\d+$/.test(binding.requirementCode) || !/^\d+$/.test(binding.codeOwnerRequirementCode)) throw new Error('日志映射须明确目标需求号与代码所属主需求号');
    const requirementCode = String(binding.requirementCode), owner = String(binding.codeOwnerRequirementCode);
    if (owners.has(requirementCode) && owners.get(requirementCode) !== owner) throw new Error('同一目标需求不能映射不同代码归属');
    owners.set(requirementCode, owner);
    if (!Array.isArray(binding.select) || !binding.select.length || binding.select.some(item => !/^[0-9a-f]{40}$/i.test(item?.hash || ''))) throw new Error('日志映射须提供明确仓库和完整提交hash');
    selections.push({ binding: { requirementCode, codeOwnerRequirementCode: owner }, select: binding.select });
  }
  const records = selectRecords(selections.flatMap(item => item.select)), result = [], seen = new Set();
  for (const { binding, select } of selections) for (const selected of select) {
    const repo = fs.realpathSync(path.resolve(selected.repo));
    const record = records.find(item => item.repo === repo && item.hash.toLowerCase() === selected.hash.toLowerCase());
    const parsed = parseCommitMessage(record.message);
    if (parsed.error || parsed.requirementCode !== binding.codeOwnerRequirementCode) throw new Error('真实提交需求号与声明的代码所属主需求不一致');
    const gitRoot = fs.realpathSync(gitDirOf(repo));
    const identity = [binding.requirementCode, process.platform === 'win32' ? gitRoot.toLowerCase() : gitRoot, record.hash].join('\0');
    if (!seen.has(identity)) { seen.add(identity); result.push({ ...record, logBinding: binding }); }
  }
  return result;
}
// 按需求号聚合：同一需求号的多个仓库合并进同一个 Repository 数组，与 BOS 接口契约一致。
function buildPayload(records, { linkProject, userCode }) {
  const groups = new Map();
  for (const record of records) {
    const parsed = parseCommitMessage(record.message);
    if (parsed.error) throw new Error(`${record.shortHash}: ${parsed.error}`);
    const repository = {
      Project: record.project,
      CodeRepositoryVersion: record.hash,
      ModifyFiles: record.files.map(file => file.path).join('\n'),
      AddLines: record.files.reduce((sum, file) => sum + file.addLines, 0),
      DelLines: record.files.reduce((sum, file) => sum + file.delLines, 0)
    };
    const binding = record.logBinding;
    if (binding) {
      if (parsed.requirementCode !== binding.codeOwnerRequirementCode) throw new Error('提交与主需求归属不一致');
      parsed.requirementCode = binding.requirementCode;
      if (binding.requirementCode !== binding.codeOwnerRequirementCode) parsed.modifyDesc += `\n复用主需求 ${binding.codeOwnerRequirementCode} 的提交 ${record.hash}。`;
    }
    const group = groups.get(parsed.requirementCode);
    if (group) {
      group.Repository.push(repository);
      if (!group.menus.includes(parsed.menuNames)) group.menus.push(parsed.menuNames);
      if (!group.notes.includes(parsed.modifyDesc)) group.notes.push(parsed.modifyDesc);
    }
    else groups.set(parsed.requirementCode, {
      TradeCode: '1000',
      UserCode: userCode,
      RequirementCode: parsed.requirementCode,
      MenuNames: parsed.menuNames,
      ModifyDesc: parsed.modifyDesc,
      Repository: [repository],
      LinkProject: linkProject,
      menus: [parsed.menuNames],
      notes: [parsed.modifyDesc]
    });
  }
  return [...groups.values()].map(({ menus, notes, ...group }) => ({ ...group, MenuNames: menus.join('\n'), ModifyDesc: notes.join('\n') }));
}

function resultCodes(data) {
  const items = Array.isArray(data) ? data : [data];
  return items.map(item => (item && typeof item === 'object' ? String(item.ResultCode ?? '') : ''));
}

// 鉴权失败等非 2xx 响应不带 ResultCode，只带 Message 或 ResultMsg。
function serverMessage(data) {
  const items = Array.isArray(data) ? data : [data];
  return items
    .map(item => (item && typeof item === 'object' ? String(item.Message || item.ResultMsg || '').trim() : ''))
    .filter(Boolean)
    .join('；');
}

async function submit(input, config, fetchImpl = fetch, userCode = '') {
  // The public write boundary accepts selections, never an unbound payload.
  // Re-read real commits immediately before generating the request.
  const records = selectInput(input);
  const payload = buildPayload(records, { linkProject: config.linkProject, userCode: resolveUserCode(records, userCode) });
  if (!config.token || /^(TODO|xxxxx)$/i.test(config.token.trim())) throw new Error('代码更新日志 token 尚未配置');
  const redact = value => {
    let text = String(value);
    for (const secret of [config.token, JSON.stringify(config.token).slice(1, -1), encodeURIComponent(config.token)]) text = text.split(secret).join('[REDACTED]');
    return text;
  };
  const headers = { 'Content-Type': 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  let response;
  try {
    response = await fetchImpl(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeout)
    });
  } catch (error) {
    throw new Error(`提交请求失败：${error.name === 'TimeoutError' ? '请求超时，结果未知，请核对后再决定' : redact(error.message)}`);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = redact(serverMessage(data));
    throw new Error(`提交失败：HTTP ${response.status}${detail ? `，${detail}` : ''}`);
  }
  if (data === null) throw new Error('提交失败：响应不是有效 JSON');
  const codes = resultCodes(data);
  const messages = redact((Array.isArray(data) ? data : [data])
    .map(item => (item && typeof item === 'object' ? `${item.ResultCode ?? ''} ${item.ResultMsg ?? ''}`.trim() : ''))
    .filter(Boolean)
    .join('；'));
  if (codes.length === 0 || codes.includes('')) {
    throw new Error(`提交失败：响应缺少 ResultCode${messages ? `（${messages}）` : ''}`);
  }
  if (codes.some(code => code !== '000')) {
    throw new Error(`提交失败：${messages || `ResultCode ${codes.join('、')}`}`);
  }
  return { ok: true, resultCodes: codes, resultMessages: messages ? [messages] : [], summary: describe(records, payload) };
}

function describe(records, payload) {
  const summary = summarize(payload);
  if (records.some(record => record.logBinding)) for (const item of summary) item.codeOwnerRequirementCode = records.find(record => record.logBinding?.requirementCode === item.requirementCode).logBinding.codeOwnerRequirementCode;
  return summary;
}

function resolveUserCode(records, explicit = '') {
  const given = String(explicit || '').trim();
  if (given) return given;
  const name = gitOr(records[0].repo, ['config', 'user.name']).trim();
  if (!name) throw new Error('无法获取 Git 用户；请设置仓库 user.name 或显式传 --user');
  return name;
}

function summarize(payload) {
  return payload.map(group => ({
    requirementCode: group.RequirementCode,
    menuNames: group.MenuNames,
    modifyDesc: group.ModifyDesc,
    userCode: group.UserCode,
    linkProject: group.LinkProject,
    repositories: group.Repository.map(repository => ({
      project: repository.Project,
      version: repository.CodeRepositoryVersion,
      fileCount: repository.ModifyFiles ? repository.ModifyFiles.split('\n').filter(Boolean).length : 0,
      addLines: repository.AddLines,
      delLines: repository.DelLines,
      files: repository.ModifyFiles ? repository.ModifyFiles.split('\n').filter(Boolean) : []
    }))
  }));
}

function parseJsonArgument(value, usage) {
  if (!value) throw new Error(`缺少 JSON 参数。用法：${usage}`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`JSON 参数无法解析。用法：${usage}`);
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
}

const USAGE = [
  'bos-code-update-log plan|submit 接受 select 或 bindings（含requirementCode、codeOwnerRequirementCode、select），二者互斥',
  'bos-code-update-log defaults',
  'bos-code-update-log repos [--workspace <目录>] [--depth <层数>]',
  'bos-code-update-log commits --repo <实仓路径> --ref refs/heads/<目标分支> [--limit <条数>]',
  'bos-code-update-log plan \'{"select":[{"repo":"<实仓路径>","ref":"refs/heads/<目标分支>","hash":"<完整实仓提交>"}]}\' [--user <Git用户>]',
  'bos-code-update-log submit \'{"select":[{"repo":"<实仓路径>","ref":"refs/heads/<目标分支>","hash":"<完整实仓提交>"}]}\' --confirm [--user <Git用户>]'
].join('\n');

async function main(argv, { env = process.env, fetchImpl = fetch } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) throw new Error('需要 Node.js >=22.5.0（Agent 工具链运行时）');
  const command = argv[0] || '';
  if (command === '--help') return { usage: USAGE };
  if (command === 'defaults') { const config = loadConfig(env); return { ok: true, configSource: config.configSource, tokenConfigured: true, linkProject: config.linkProject, timeout: config.timeout }; }
  if (command === 'repos') {
    const workspace = option(argv, '--workspace') || process.cwd();
    const depth = Number(option(argv, '--depth') || '3');
    if (!Number.isInteger(depth) || depth < 0) throw new Error('--depth 必须为非负整数');
    return { ok: true, repos: listRepos(workspace, depth) };
  }
  if (command === 'commits') {
    const repo = option(argv, '--repo');
    if (!repo) throw new Error('commits 需要 --repo <仓库路径>');
    return { ok: true, repo: path.resolve(repo), ref: option(argv, '--ref'), commits: listCommits(repo, option(argv, '--limit') || 30, option(argv, '--ref')) };
  }
  if (command === 'plan' || command === 'submit') {
    const input = parseJsonArgument(argv[1], USAGE);
    const records = selectInput(input);
    const settings = loadConfig(env);
    const payload = buildPayload(records, { linkProject: settings.linkProject, userCode: resolveUserCode(records, option(argv, '--user')) });
    const summary = describe(records, payload);
    if (command === 'plan') return { ok: true, submitted: false, url: settings.url, configSource: settings.configSource, tokenConfigured: Boolean(settings.token), payload, summary };
    if (!argv.includes('--confirm')) {
      return { ok: false, submitted: false, error: '提交为写操作，需要显式传 --confirm', url: settings.url, configSource: settings.configSource, summary };
    }
    const result = await submit(input, settings, fetchImpl, option(argv, '--user'));
    return { ok: true, submitted: true, url: settings.url, configSource: settings.configSource, resultCodes: result.resultCodes, resultMessages: result.resultMessages, summary: result.summary };
  }
  throw new Error(`未知命令。用法：\n${USAGE}`);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(result => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result && result.ok === false) process.exitCode = 1;
    })
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseCommitMessage,
  resolveProjectName,
  parseNumstat,
  parseCommitBlock,
  readOriginUrl,
  repoName,
  loadConfig,
  listRepos,
  listCommits,
  commitRecords,
  selectRecords,
  selectInput,
  buildPayload,
  summarize,
  submit,
  resolveUserCode,
  main
};
