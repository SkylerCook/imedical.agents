#!/usr/bin/env node
'use strict';

/*
 * collect-commits.js — 医生站信创产品迭代周报 · 确定性采集脚本
 *
 * 遍历 src/ 下全部子仓库（19 后端 + 1 前端），按时间窗 + 人员白名单过滤并排除
 * merge 提交，输出结构化 JSON（UTF-8 无 BOM）。
 *
 * 用法：
 *   node collect-commits.js [--months N | --since DATETIME [--until DATETIME]]
 *
 * 配置：.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getJsonEnv, maintenanceHint } = require('./config-env');

const execFileAsync = promisify(execFile);

const SEP = '\u001f'; // git pretty 格式字段分隔符（避免与 message 中的字符冲突）

const USAGE = `用法: node collect-commits.js [--months N | --since YYYY-MM-DD [--until YYYY-MM-DD]]
  --months N   汇总最近 N 个完整自然月（默认取配置 window.value）
  --since      自定义起始时间 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM（--until 缺省为现在）
  --until      自定义结束时间 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM（不含，缺省为现在）
输出: <outputDir>/<YYYY-MM>/raw-commits-<YYYY-MM>.json（UTF-8 无 BOM）+ 控制台摘要
配置 ref: config 的 "ref" 字段（如 "origin/master"）指定采集源分支，缺省 HEAD`;

// ---------- 时间窗 ----------

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toLocalYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toLocalISO(d) {
  return `${toLocalYMD(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 最近 N 个完整自然月：[N 个月前月初, 本月月初)
function monthWindow(monthsBack, now = new Date()) {
  let y = now.getFullYear();
  let m = now.getMonth() - monthsBack;
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  return {
    since: toLocalYMD(new Date(y, m, 1)),
    until: toLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1)),
    label: `${y}-${pad2(m + 1)}`
  };
}

// 精确时间窗过滤：[since, until)（含起点、不含终点）。
// git 的 --since/--until 是遍历近似而非精确过滤，真实窗口边界必须由此函数按作者日期裁决。
// c.date 为 iso-strict 格式（含显式时区偏移），Date.parse 归一为 epoch 后比较。
// since/until 支持 YYYY-MM-DD（按当日 00:00 解析）或 YYYY-MM-DDTHH:MM（精确到分钟）。
function parseTimestamp(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + 'T00:00:00');
  return Date.parse(s);
}

function filterWindow(commits, since, until) {
  const lo = parseTimestamp(since);
  const hi = parseTimestamp(until);
  return commits.filter((c) => {
    const t = Date.parse(c.date);
    return t >= lo && t < hi;
  });
}

// ---------- 身份匹配（大小写不敏感：name ∈ aliases 或 email ∈ emails） ----------

function buildAuthorIndex(reporters) {
  const index = new Map();
  for (const r of reporters) {
    for (const alias of r.aliases || []) index.set(String(alias).toLowerCase(), r.name);
    for (const email of r.emails || []) index.set(String(email).toLowerCase(), r.name);
  }
  return index;
}

// 提交人邮箱属个人信息，不入库；从环境变量 COMMIT_REPORT_REPORTER_EMAILS（JSON: 姓名 -> 邮箱数组）补充
function mergeReporterEmails(reporters) {
  const map = getJsonEnv('COMMIT_REPORT_REPORTER_EMAILS');
  if (!map) {
    console.error('[提示] 未配置 COMMIT_REPORT_REPORTER_EMAILS，提交人仅按姓名/别名匹配（邮箱匹配已禁用）。');
    console.error(maintenanceHint('COMMIT_REPORT_REPORTER_EMAILS', '提交人邮箱映射'));
    return reporters;
  }
  return reporters.map((r) => {
    const extra = map[r.name];
    if (!extra) return r;
    const list = Array.isArray(extra) ? extra : String(extra).split(',');
    const merged = new Set([...(r.emails || []), ...list.map((s) => String(s).trim()).filter(Boolean)]);
    return { ...r, emails: [...merged] };
  });
}

function matchReporter(index, name, email) {
  if (name) {
    const hit = index.get(String(name).toLowerCase());
    if (hit) return hit;
  }
  if (email) {
    const hit = index.get(String(email).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

// ---------- git log 输出解析 ----------

const HASH_RE = /^[0-9a-f]{7,40}$/;
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

function parseGitLog(stdout) {
  const commits = [];
  let current = null;
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) continue;
    const fields = line.split(SEP);
    if (fields.length >= 5 && HASH_RE.test(fields[0])) {
      current = {
        hash: fields[0],
        authorName: fields[1],
        authorEmail: fields[2],
        date: fields[3],
        subject: fields.slice(4).join(SEP),
        files: []
      };
      commits.push(current);
    } else if (current && NUMSTAT_RE.test(line)) {
      const m = line.match(NUMSTAT_RE);
      current.files.push({
        path: m[3],
        additions: m[1] === '-' ? null : Number(m[1]),
        deletions: m[2] === '-' ? null : Number(m[2])
      });
    }
  }
  return commits;
}

// ---------- 命令行参数 ----------

function parseArgs(argv) {
  const opts = { months: null, since: null, until: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--months') {
      const v = argv[++i];
      opts.months = Number(v);
      if (!Number.isInteger(opts.months) || opts.months < 1) {
        throw new Error(`--months 需为正整数，收到: ${v}`);
      }
    } else if (arg === '--since' || arg === '--until') {
      const v = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v)) {
        throw new Error(`${arg} 需为 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM 格式，收到: ${v}`);
      }
      opts[arg === '--since' ? 'since' : 'until'] = v;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return opts;
}

// ---------- 仓库发现（src/backend 递归 + src/frontend/hisfront） ----------

function discoverRepos(repoRoot) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, '.git'))) {
        found.push(full);
        continue;
      }
      if (depth < 2) walk(full, depth + 1);
    }
  };
  walk(path.join(repoRoot, 'src', 'backend'), 0);
  const frontend = path.join(repoRoot, 'src', 'frontend', 'hisfront');
  if (fs.existsSync(path.join(frontend, '.git'))) found.push(frontend);
  return found.map((p) => path.relative(repoRoot, p).replace(/\\/g, '/')).sort();
}

// ---------- 单仓库采集 ----------

async function collectRepo(repoRel, repoRoot, since, until, ref) {
  // 遍历起点放宽 45 天（远低于真实窗口起点），且不传 --until：
  // 让 git 遍历终止的近似误差发生在真实窗口之外，窗口边界由 filterWindow 按作者日期精确裁决。
  // 遍历 ref 默认 HEAD（本地 checkout）；配置 ref 后从 origin/master 等远程跟踪分支采集，
  // 不依赖本地分支同步进度，也不触碰工作区。
  const walkSince = toLocalYMD(new Date(parseTimestamp(since) - 45 * 86400000));
  const format = `%H${SEP}%an${SEP}%ae${SEP}%ad${SEP}%s`;
  const args = [
    'log', '--no-merges',
    ...(ref && ref !== 'HEAD' ? [ref] : []),
    `--since=${walkSince}`,
    '--date=iso-strict',
    `--pretty=format:${format}`,
    '--numstat'
  ];
  const { stdout } = await execFileAsync('git', args, {
    cwd: path.join(repoRoot, repoRel),
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8'
  });
  return filterWindow(parseGitLog(stdout), since, until);
}

function loadConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.agents', 'plugins', 'imedicalxc-doctor-commit-report', 'config', 'commit-report.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`配置不存在: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// ---------- 主流程 ----------

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const config = loadConfig(repoRoot);

  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  let win;
  if (opts.since || opts.until) {
    const since = opts.since;
    const until = opts.until || toLocalISO(new Date());
    if (parseTimestamp(since) >= parseTimestamp(until)) {
      throw new Error(`--since (${since}) 必须早于 --until (${until})`);
    }
    win = { since, until, label: since.slice(0, 7) };
  } else {
    const months = opts.months ?? (config.window && config.window.value) ?? 1;
    win = monthWindow(months);
  }

  const reporters = mergeReporterEmails(config.reporters || []);
  const authorIndex = buildAuthorIndex(reporters);
  const repos = discoverRepos(repoRoot);
  const ref = config.ref || 'HEAD';

  const commits = [];
  const errors = [];
  let reposWithCommits = 0;
  for (const repo of repos) {
    try {
      const raw = await collectRepo(repo, repoRoot, win.since, win.until, ref);
      const matched = [];
      for (const c of raw) {
        const author = matchReporter(authorIndex, c.authorName, c.authorEmail);
        if (!author) continue;
        const additions = c.files.reduce((s, f) => s + (f.additions || 0), 0);
        const deletions = c.files.reduce((s, f) => s + (f.deletions || 0), 0);
        matched.push({
          repo,
          hash: c.hash,
          author,
          authorRaw: { name: c.authorName, email: c.authorEmail },
          date: c.date,
          subject: c.subject,
          files: c.files,
          fileCount: c.files.length,
          additions,
          deletions
        });
      }
      if (matched.length > 0) {
        reposWithCommits += 1;
        commits.push(...matched);
      }
    } catch (err) {
      errors.push({ repo, error: String((err && err.message) || err) });
    }
  }

  commits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const byPerson = {};
  const byRepo = {};
  for (const c of commits) {
    byPerson[c.author] = (byPerson[c.author] || 0) + 1;
    byRepo[c.repo] = (byRepo[c.repo] || 0) + 1;
  }

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      window: { since: win.since, until: win.until, label: win.label },
      reposScanned: repos.length,
      reposWithCommits,
      totalCommits: commits.length,
      sourceRef: ref,
      byPerson,
      byRepo,
      excludeMerges: config.excludeMerges !== false
    },
    commits,
    errors
  };

  const outDirAbs = path.join(repoRoot, config.outputDir || 'docs/commit-reports', win.label);
  fs.mkdirSync(outDirAbs, { recursive: true });
  const outFile = path.join(outDirAbs, `raw-commits-${win.label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`时间窗: ${win.since} ~ ${win.until}`);
  console.log(`扫描仓库: ${repos.length} 个（有名单内提交: ${reposWithCommits}）`);
  console.log(`提交总数: ${commits.length}（已排除 merge，仅限名单内 ${reporters.length} 人）`);
  for (const [person, count] of Object.entries(byPerson)) {
    console.log(`  ${person}: ${count}`);
  }
  if (errors.length > 0) {
    console.log(`采集错误: ${errors.length} 个仓库`);
    for (const e of errors) console.log(`  ${e.repo}: ${e.error}`);
  }
  console.log(`原始数据: ${outFile}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[collect-commits] 失败: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { pad2, toLocalYMD, toLocalISO, parseTimestamp, monthWindow, filterWindow, buildAuthorIndex, matchReporter, parseGitLog, parseArgs, discoverRepos };
