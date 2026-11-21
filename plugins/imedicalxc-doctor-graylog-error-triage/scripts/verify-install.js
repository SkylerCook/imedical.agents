
'use strict';
// Graylog 报错巡检 · 安装与注册静态自检
// 用法: node verify-install.js [--strict] [--capability-root=<path>]
// 退出码: 0 无 FAIL（WARN 可接受）/ 1 存在 FAIL / 2 自检自身无法执行
// --strict 把 WARN 升级为 FAIL
// 定位：既是最终验收闸门，也是分批落盘时的「还缺什么」进度板。

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { REPO_ROOT, PLUGIN_ROOT, loadConfig } = require('./config-env');

const PLUGIN_NAME = 'imedicalxc-doctor-graylog-error-triage';
const SKILL_NAME = PLUGIN_NAME;

const REQUIRED_FILES = [
  // 批 1：骨架 + 配置 + 公共库
  [1, '.agents-plugin/plugin.json'],
  [1, 'AGENTS.md'],
  [1, 'README.md'],
  [1, 'config/graylog-triage.json'],
  [1, 'config/graylog-triage-push.template.json'],
  [1, 'config/.gitignore'],
  [1, '.gitignore'],
  [1, 'scripts/config-env.js'],
  [1, 'scripts/lib/log-parse.js'],
  [1, `skills/${PLUGIN_NAME}-init/SKILL.md`],
  // 批 2：采集 + MCP
  [2, 'scripts/collect-errors.js'],
  // 批 3：分类 + 渲染
  [3, 'scripts/lib/owner-index.js'],
  [3, 'scripts/classify-owner.js'],
  [3, 'scripts/render-report.js'],
  // 批 4：穿透 + 通知 + 调度 + 文档
  [4, 'scripts/penetrate-frontend.js'],
  [4, 'scripts/build-front-chains.js'],
  [4, 'scripts/push-notify.js'],
  [4, 'scripts/run-triage.ps1'],
  [4, 'scripts/install-schedule.ps1'],
  [4, `skills/${SKILL_NAME}/SKILL.md`],
  [4, `skills/${SKILL_NAME}/references/owner-classification.md`],
  [4, `skills/${SKILL_NAME}/references/report-templates.md`],
  [4, `skills/${SKILL_NAME}/references/frontend-penetration.md`],
  [4, `skills/${SKILL_NAME}/references/notification-and-schedule.md`],
  [4, `skills/${SKILL_NAME}/references/acceptance-checklist.md`],
];

const results = [];
function record(level, item, detail) { results.push({ level, item, detail }); }
function pass(item, detail) { record('PASS', item, detail || ''); }
function warn(item, detail) { record('WARN', item, detail || ''); }
function fail(item, detail) { record('FAIL', item, detail || ''); }
function rel(p) { return path.relative(REPO_ROOT, p).replace(/\\/g, '/'); }

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) args[body.slice(0, eq)] = body.slice(eq + 1);
    else args[body] = true;
  }
  return args;
}

function checkFiles() {
  const missing = REQUIRED_FILES.filter(([, f]) => !fs.existsSync(path.join(PLUGIN_ROOT, f)));
  if (missing.length === 0) {
    pass('插件文件完整性', `${REQUIRED_FILES.length} 个必需文件齐全`);
    return;
  }
  const byBatch = new Map();
  for (const [batch, f] of missing) {
    if (!byBatch.has(batch)) byBatch.set(batch, []);
    byBatch.get(batch).push(f);
  }
  const summary = [...byBatch.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, files]) => `批 ${b} 缺 ${files.length} 个: ${files.join(', ')}`)
      .join(' | ');
  fail('插件文件完整性', `${missing.length}/${REQUIRED_FILES.length} 缺失 → ${summary}`);
}

function checkManifest() {
  const file = path.join(PLUGIN_ROOT, '.agents-plugin/plugin.json');
  if (!fs.existsSync(file)) { fail('plugin manifest', '文件不存在'); return; }
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { fail('plugin manifest', `JSON 解析失败: ${err.message}`); return; }
  if (m.name !== PLUGIN_NAME) fail('manifest.name', `应为 ${PLUGIN_NAME}，实际 ${m.name}`);
  else pass('manifest.name', m.name);
  if (!m.initSkill) warn('manifest.initSkill', '未声明，profile 的 initSkill 列将为 -');
  else pass('manifest.initSkill', m.initSkill);
  const excl = (m.thinIndex && m.thinIndex.excludeSkills) || [];
  if (!excl.includes(`${PLUGIN_NAME}-init`)) warn('thinIndex.excludeSkills', 'init skill 未排除，会在 .agents/skills/ 生成多余薄索引');
  else pass('thinIndex.excludeSkills', excl.join(', '));
  if (m.dependencies) warn('manifest.dependencies', '声明了硬依赖，启用时可能被要求先启用依赖插件；本插件应只用 availableDependencies');
}

function checkAvailability(capabilityRoot) {
  const script = path.join(capabilityRoot, 'scripts/check-plugin-availability.js');
  if (!fs.existsSync(script)) { warn('canonical 可用性校验', `校验器不存在: ${rel(script)}`); return; }
  try {
    const out = execFileSync(process.execPath, [script, '--project-root', REPO_ROOT, '--plugin', PLUGIN_NAME], { encoding: 'utf8' });
    const res = JSON.parse(out);
    if (res.ok) pass('availableDependencies 校验', `${(res.checks || []).length} 项依赖声明全部可用`);
    else {
      for (const c of res.checks || []) {
        if (c.available) pass(`依赖 ${c.plugin}/${c.stage}`, '可用');
        else warn(`依赖 ${c.plugin}/${c.stage}`, `不可用: ${(c.problems || []).join(', ')}（advisory，不阻塞；执行该阶段前需补齐）`);
      }
    }
  } catch (err) {
    const msg = (err.stdout || err.message || '').toString().trim();
    fail('availableDependencies 校验', `canonical 校验器拒绝声明: ${msg}`);
  }
}

function checkConfig() {
  let cfg;
  try { cfg = loadConfig(); } catch (err) { fail('主配置解析', err.message); return; }
  pass('主配置解析', 'graylog-triage.json 可解析');
  const sections = ['environments', 'query', 'classify', 'ownerGroups', 'frontend', 'output', 'analysis', 'notify', 'schedule', 'state'];
  const absent = sections.filter((k) => !cfg[k]);
  if (absent.length) fail('配置段完整性', `缺失: ${absent.join(', ')}`);
  else pass('配置段完整性', `${sections.length} 个必需段齐全`);

  const envId = cfg.defaultEnv;
  const env = (cfg.environments || {})[envId];
  if (!env) fail('默认环境', `defaultEnv=${envId} 未在 environments 中定义`);
  else {
    pass('默认环境', `${envId}（interval=${env.intervalMinutes}min, retention=${env.retentionDays}d, transport=${env.transport}）`);
    if (env.transport !== 'http') warn('取数通道', `transport=${env.transport}；计划任务需 http`);
    if ((env.intervalMinutes || 30) !== (cfg.schedule.intervalMinutes || 30)) {
      warn('间隔一致性', `environments.${envId}.intervalMinutes=${env.intervalMinutes} 与 schedule.intervalMinutes=${cfg.schedule.intervalMinutes} 不一致`);
    }
  }
  if ((cfg.schedule.executionTimeLimitMinutes || 20) >= (cfg.schedule.intervalMinutes || 30)) {
    warn('超时与间隔', '执行超时上限 >= 触发间隔，可能长期占用');
  }
  const self = (cfg.ownerGroups || {}).self || {};
  const infra = (cfg.ownerGroups || {}).infra || {};
  const overlap = (self.modules || []).filter((m) => (infra.modules || []).includes(m));
  if (overlap.length) fail('归属分组', `self 与 infra 同名模块: ${overlap.join(', ')}`);
  else pass('归属分组', `self ${(self.modules || []).length} 模块 / infra ${(infra.modules || []).length} 模块，无重名`);
  if (infra.notify === true) warn('基础设施推送', 'infra.notify=true 与「基础设施只汇总提示」的决策不符');
  else pass('基础设施推送', 'infra.notify=false，仅汇总提示');
  if (!(cfg.ownerGroups || {}).external || !((cfg.ownerGroups.external || {}).appGroups)) {
    fail('他组映射', 'ownerGroups.external.appGroups 缺失');
  }
}

function checkSecrets() {
  const configDir = path.join(PLUGIN_ROOT, 'config');
  const patterns = [
    { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/, label: 'IP 地址' },
    { re: /Basic\s+[A-Za-z0-9+/=]{16,}/, label: 'Basic 认证串' },
    { re: /(?:TOKEN|token)"?\s*[:=]\s*"[A-Za-z0-9_\-+/=]{12,}"/, label: '令牌字面值' },
    { re: /(?:token|密码)\s*(?:信息)?\s*(?:为|是)?\s*[：:]\s*[A-Za-z0-9_\-+/=.]{16,}/, label: 'token 明文' },
  ];
  let gitOk = true;
  try { execFileSync('git', ['--version'], { encoding: 'utf8' }); } catch { gitOk = false; }
  // 只扫会被 git 收走的配置。state/queue/push-state 已 gitignore，
  // 它们本来就存日志原文与服务地址，扫描必然命中，属于假阳性
  const RUNNING = new Set([
    'pending-queue.json',
    'graylog-triage-state.json',
    'push-state.json',
    'graylog-triage-push.json',
    'dedupe.json',
  ]);
  const tracked = (f) => {
    if (RUNNING.has(f)) return false;
    if (!gitOk) return true;
    try {
      execFileSync('git', ['check-ignore', '-q', `config/${f}`], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
      return false;
    } catch { return true; }
  };
  const hits = [];
  const skipped = [];
  if (fs.existsSync(configDir)) {
    for (const f of fs.readdirSync(configDir)) {
      if (!f.endsWith('.json') || f.endsWith('.template.json')) continue;
      if (!tracked(f)) { skipped.push(f); continue; }
      const text = fs.readFileSync(path.join(configDir, f), 'utf8');
      for (const p of patterns) if (p.re.test(text)) hits.push(`${f}:${p.label}`);
    }
  }
  const tail = skipped.length ? `；跳过运行态 ${skipped.length} 个` : '';
  if (hits.length === 0) pass('配置凭据扫描', `入库配置未含 IP/认证串/令牌字面值${tail}`);
  else fail('配置凭据扫描', hits.join(', ') + tail);
}

function checkGitIgnore() {
  let cfg = {};
  try { cfg = loadConfig(); } catch { /* 配置解析失败已由 checkConfig 报告 */ }
  // 按配置探测实际使用的状态文件名（state.file 可能含 {env} 占位），
  // 否则改了命名方案后这里仍在检查旧名字，得到假通过
  const stateTemplate = (cfg.state || {}).file || 'config/graylog-triage-state.json';
  const stateProbe = stateTemplate.includes('{env}')
    ? stateTemplate.replace(/\{env\}/g, String(cfg.defaultEnv || '87'))
    : stateTemplate;
  const runtimeFiles = [
    'config/graylog-triage-push.json',
    'config/graylog-triage-state.json',
    stateProbe,
    'config/push-state.json',
    'config/pending-queue.json',
    'config/dedupe.json',
    'config/.run.lock',
  ].filter((f, i, arr) => arr.indexOf(f) === i);

  let gitOk = true;
  try { execFileSync('git', ['--version'], { encoding: 'utf8' }); } catch { gitOk = false; }
  if (!gitOk) warn('运行态忽略校验', 'git 不可用，改为静态检查 config/.gitignore');

  const ignoreFile = path.join(PLUGIN_ROOT, 'config/.gitignore');
  const ignoreLines = fs.existsSync(ignoreFile)
      ? fs.readFileSync(ignoreFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : [];
  for (const f of runtimeFiles) {
    const base = path.basename(f);
    if (gitOk) {
      try {
        execFileSync('git', ['check-ignore', '-q', f], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
        pass(`忽略 ${base}`, 'git check-ignore 命中');
        continue;
      } catch { /* 未命中，落到静态判断 */ }
    }
    if (ignoreLines.includes(base)) warn(`忽略 ${base}`, 'git 未命中但 .gitignore 已列（可能尚未 git add 或存在上层否定规则）');
    else fail(`忽略 ${base}`, '运行态文件未被忽略，存在凭据/状态入库风险');
  }

  const wsIgnore = path.join(REPO_ROOT, 'docs/agents/.gitignore');
  if (!fs.existsSync(wsIgnore)) warn('索引产物忽略', `缺失 ${rel(wsIgnore)}，大索引可能入库`);
  else if (!/front_chain_db\.json/.test(fs.readFileSync(wsIgnore, 'utf8'))) warn('索引产物忽略', '未排除 front_chain_db.json');
  else pass('索引产物忽略', 'docs/agents/.gitignore 已排除前端大索引');

  const rootIgnore = path.join(PLUGIN_ROOT, '.gitignore');
  const rootLines = fs.existsSync(rootIgnore)
      ? fs.readFileSync(rootIgnore, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : [];
  if (rootLines.some((l) => l.replace(/\/$/, '') === 'logs')) pass('忽略 logs/', '插件根 .gitignore 已排除运行日志');
  else fail('忽略 logs/', '插件根 .gitignore 未排除 logs/，巡检日志会被父仓库收走');
}

function checkRegistration(capabilityRoot, contextRoot) {
  const thin = path.join(contextRoot, 'skills', SKILL_NAME, 'SKILL.md');
  if (!fs.existsSync(thin)) warn('skill thin-index', `未生成 ${rel(thin)}（需 generate-plugin-thin-index.ps1 -Mode Write）`);
  else {
    const text = fs.readFileSync(thin, 'utf8');
    if (!/^thin-index:\s*true$/m.test(text)) fail('skill thin-index', '缺少 thin-index: true 标记');
    else if (!text.includes(`plugins/${PLUGIN_NAME}/skills/${SKILL_NAME}/SKILL.md`)) fail('skill thin-index', 'source 未指向插件内真实 SKILL.md');
    else pass('skill thin-index', rel(thin));
  }
  const initThin = path.join(contextRoot, 'skills', `${PLUGIN_NAME}-init`, 'SKILL.md');
  if (fs.existsSync(initThin)) warn('init skill thin-index', 'init skill 不应生成根薄索引，检查 thinIndex.excludeSkills');
  else pass('init skill thin-index', '已按约定排除');

  const profile = path.join(contextRoot, 'config/plugin_profile.md');
  if (!fs.existsSync(profile)) { fail('plugin_profile', '文件不存在'); return; }
  const line = fs.readFileSync(profile, 'utf8').split(/\r?\n/)
      .find((l) => new RegExp(`^\\|\\s*` + PLUGIN_NAME + `\\s*\\|`).test(l));
  if (!line) fail('plugin_profile 登记', '未找到本插件行，需执行 update-plugin-profile.ps1');
  else {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    pass('plugin_profile 登记', `status=${cells[1]} initSkill=${cells[2]} dependsOn=${cells[3]}`);
    if (cells[1] !== 'enabled') warn('插件启用状态', `当前 ${cells[1]}，巡检 skill 不会被默认路由；确认后置 enabled`);
  }
}

function checkWorkspaceEntries() {
  const agents = path.join(REPO_ROOT, 'AGENTS.md');
  if (!fs.existsSync(agents)) { fail('父仓库 AGENTS.md', '不存在'); return; }
  const text = fs.readFileSync(agents, 'utf8');
  if (!text.includes(PLUGIN_NAME)) warn('入口路由', '父仓库 AGENTS.md 未提及本插件，任务无法被路由到巡检 skill');
  else pass('入口路由', '父仓库 AGENTS.md 已含本插件路由');

  const mcp = path.join(REPO_ROOT, 'mcp-graylog/index.js');
  if (!fs.existsSync(mcp)) fail('MCP 服务', 'mcp-graylog/index.js 不存在');
  else {
    const src = fs.readFileSync(mcp, 'utf8');
    const need = ['graylog_search_absolute', 'graylog_trace', 'offset'];
    const miss = need.filter((n) => !src.includes(n));
    if (miss.length) fail('MCP 能力补齐', `index.js 缺少 ${miss.join(', ')}（批 2 未应用）`);
    else pass('MCP 能力补齐', 'absolute / trace / offset 均已实现');
  }
}

function checkFrontendIndex(cfg) {
  const fe = cfg.frontend || {};
  const chainDb = path.resolve(REPO_ROOT, fe.chainDb || 'docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json');
  const catalog = path.resolve(REPO_ROOT, fe.pageCatalog || 'src/frontend/README.md');

  if (!fs.existsSync(catalog)) fail('前端页面目录', `缺失 ${rel(catalog)}，启发式穿透无候选来源`);
  else pass('前端页面目录', rel(catalog));

  if (fs.existsSync(chainDb)) {
    const mb = (fs.statSync(chainDb).size / 1048576).toFixed(1);
    pass('前端链路索引', `${rel(chainDb)}（${mb}MB）`);
  } else {
    warn('前端链路索引', '未构建 front_chain_db.json；穿透降级为候选页面级（命中数见报告「前端穿透」行）');
  }

  const needle = ['-c', 'print(1)'];
  let py = '';
  for (const c of ['python', 'python3']) {
    try {
      execFileSync(c, needle, { encoding: 'utf8' });
      py = c;
      break;
    } catch { /* 试下一个 */ }
  }
  if (py) pass('Python 可用性', `${py} 可执行`);
  else warn('Python 可用性', '未找到 python/python3；build-front-chains.js 无法构建索引（不影响采集/分类/渲染/推送）');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const capabilityRoot = args['capability-root']
      ? path.resolve(String(args['capability-root']))
      : path.join(REPO_ROOT, '.agents');
  const contextRoot = capabilityRoot;

  checkFiles();
  checkManifest();
  checkAvailability(capabilityRoot);
  checkConfig();
  checkSecrets();
  checkGitIgnore();
  try { checkFrontendIndex(loadConfig()); } catch (err) { warn('前端索引检查', '跳过: ' + err.message); }
  checkRegistration(capabilityRoot, contextRoot);
  checkWorkspaceEntries();

  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) counts[r.level] += 1;

  console.log('=== Graylog 巡检插件安装自检 ===');
  for (const r of results) console.log(`[${r.level}] ${r.item}${r.detail ? ` — ${r.detail}` : ''}`);
  console.log(`\n合计: PASS ${counts.PASS} · WARN ${counts.WARN} · FAIL ${counts.FAIL}`);

  const strict = Boolean(args.strict);
  const bad = counts.FAIL + (strict ? counts.WARN : 0);
  if (bad > 0) {
    console.log(strict ? '自检未通过（--strict：WARN 视为失败）' : '自检未通过，请先修复 FAIL 项');
    process.exit(1);
  }
  console.log('自检通过');
  process.exit(0);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('[ERROR] 自检异常:', err.message); process.exit(2); }
}