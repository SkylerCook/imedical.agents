'use strict';
// 前端链路索引与后端端点索引的构建编排器
// 只调用 codegraph 插件的既有脚本，不重复实现索引逻辑
// 低频任务：默认只检查状态，--build 才构建（js_scan 约 3 分钟）
// 退出码: 0 正常 / 1 构建失败 / 2 环境或配置不可用 / 3 索引缺失（--check 专用）

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REPO_ROOT, loadConfig, resolvePath } = require('./config-env');

const BOOLEAN_FLAGS = new Set([
  'build', 'check', 'dry-run', 'graphml',
  'endpoints-only', 'front-only', 'with-menu', 'with-config-injection', 'help',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(body) && next !== undefined && !next.startsWith('--')) {
      args[body] = next;
      i += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function toRel(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

function resolveLayout(cfg) {
  const f = cfg.frontend || {};
  const queryScript = resolvePath(cfg, f.queryScript || '.agents/plugins/imedicalxc-doctor-codegraph/scripts/query_front_back_chain.py');
  const codegraphScripts = path.dirname(queryScript);
  const chainDb = resolvePath(cfg, f.chainDb || 'docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json');
  const endpoints = resolvePath(cfg, f.endpoints || 'docs/agents/imedicalxc-doctor-codegraph/controller_endpoints.json');
  const frontOutDir = path.dirname(chainDb);
  return {
    codegraphScripts,
    frontScripts: path.join(codegraphScripts, 'front'),
    endpointScript: path.join(codegraphScripts, 'scan_controller_endpoints.py'),
    frontRoot: path.join(REPO_ROOT, 'src', 'frontend', 'hisfront', 'static'),
    endpoints,
    chainDb,
    frontOutDir,
    frontOutputs: {
      pages: path.join(frontOutDir, 'front_pages.jsonl'),
      elements: path.join(frontOutDir, 'front_elements.jsonl'),
      jsIndex: path.join(frontOutDir, 'front_js_index.jsonl'),
      chains: path.join(frontOutDir, 'front_chains.jsonl'),
      stats: path.join(frontOutDir, 'front_scan_stats.json'),
    },
  };
}

function fileInfo(file) {
  const rel = toRel(file);
  if (!fs.existsSync(file)) return { file: rel, exists: false };
  const st = fs.statSync(file);
  return {
    file: rel,
    exists: true,
    sizeMB: Number((st.size / 1048576).toFixed(2)),
    mtime: st.mtime.toISOString(),
    ageDays: Number(((Date.now() - st.mtimeMs) / 86400000).toFixed(1)),
  };
}

function detectPython(explicit) {
  const candidates = [];
  if (explicit) candidates.push({ cmd: explicit, prefix: [] });
  candidates.push({ cmd: 'python', prefix: [] }, { cmd: 'py', prefix: ['-3'] }, { cmd: 'python3', prefix: [] });
  for (const c of candidates) {
    const r = spawnSync(c.cmd, [...c.prefix, '-c', 'import sys;print(sys.version.split()[0])'], { encoding: 'utf8' });
    if (r.status === 0) {
      const version = String(r.stdout || '').trim();
      if (/^\d+\.\d+/.test(version)) return { ...c, version };
    }
  }
  return null;
}

function runStep(py, script, stepArgs, cwd, dryRun) {
  const label = path.basename(script);
  console.log('');
  console.log('[STEP] ' + label + (stepArgs.length ? ' ' + stepArgs.join(' ') : '') + '  (cwd=' + toRel(cwd) + ')');
  if (dryRun) {
    console.log('[DRY-RUN] 跳过执行');
    return { ok: true, ms: 0, skipped: true };
  }
  const started = Date.now();
  const r = spawnSync(py.cmd, [...py.prefix, script, ...stepArgs], { cwd, stdio: 'inherit' });
  const ms = Date.now() - started;
  if (r.error) {
    console.error('[FAIL] ' + label + ' 启动失败: ' + r.error.message);
    return { ok: false, ms };
  }
  if (r.status !== 0) {
    console.error('[FAIL] ' + label + ' 退出码 ' + r.status);
    return { ok: false, ms };
  }
  console.log('[OK] ' + label + ' ' + (ms / 1000).toFixed(1) + 's');
  return { ok: true, ms };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const layout = resolveLayout(cfg);

  const missingDeps = [];
  if (!fs.existsSync(layout.frontRoot)) missingDeps.push(toRel(layout.frontRoot) + '（前端源码根）');
  if (!fs.existsSync(layout.endpointScript)) missingDeps.push(toRel(layout.endpointScript));
  for (const name of ['html_scan.py', 'js_scan.py', 'build_front_chain_db.py']) {
    const p = path.join(layout.frontScripts, name);
    if (!fs.existsSync(p)) missingDeps.push(toRel(p));
  }
  if (missingDeps.length > 0) {
    console.error('[ERROR] 依赖缺失，无法构建：');
    for (const m of missingDeps) console.error('        - ' + m);
    console.error('        codegraph 插件未安装或版本过旧，先确认 .agents/plugins/imedicalxc-doctor-codegraph 完整');
    process.exit(2);
  }

  const status = {
    endpoints: fileInfo(layout.endpoints),
    chainDb: fileInfo(layout.chainDb),
    frontOutputs: Object.fromEntries(Object.entries(layout.frontOutputs).map(([k, v]) => [k, fileInfo(v)])),
  };
  const coreOk = status.endpoints.exists && status.chainDb.exists;

  if (!args.build) {
    console.log(JSON.stringify({
      ready: coreOk,
      hint: coreOk
        ? '索引已存在；若源码有较大变更，用 --build 重建'
        : '索引缺失，前端穿透将降级为启发式匹配；用 --build 构建（约 6 分钟）',
      status,
    }, null, 2));
    process.exit(coreOk ? 0 : 3);
  }

  const py = detectPython(typeof args.python === 'string' ? args.python : '');
  if (!py) {
    console.error('[ERROR] 未找到可用的 Python（试过 python / py -3 / python3）');
    console.error('        用 --python <path> 指定解释器，例如 --python C:\\Python311\\python.exe');
    process.exit(2);
  }
  console.log('[INFO] Python ' + py.version + '（' + py.cmd + ' ' + py.prefix.join(' ') + '）');

  const dryRun = Boolean(args['dry-run']);
  const doFront = !args['endpoints-only'];
  const doEndpoints = !args['front-only'];
  const steps = [];

  if (doEndpoints) {
    steps.push({ script: layout.endpointScript, stepArgs: [], cwd: layout.codegraphScripts, label: '后端端点索引' });
  }
  if (doFront) {
    steps.push({ script: path.join(layout.frontScripts, 'html_scan.py'), stepArgs: [], cwd: layout.frontScripts, label: '前端页面与元素' });
    steps.push({ script: path.join(layout.frontScripts, 'js_scan.py'), stepArgs: [], cwd: layout.frontScripts, label: 'JS 词法索引' });
    if (args['with-menu']) {
      steps.push({ script: path.join(layout.frontScripts, 'import_menu_snapshot.py'), stepArgs: ['--from-db'], cwd: layout.frontScripts, label: '菜单快照（需 Kingbase）' });
    }
    if (args['with-config-injection']) {
      steps.push({ script: path.join(layout.frontScripts, 'explore_config_injection.py'), stepArgs: ['--from-db'], cwd: layout.frontScripts, label: '配置注入快照（需 Kingbase）' });
    }
    steps.push({ script: path.join(layout.frontScripts, 'build_front_chain_db.py'), stepArgs: args.graphml ? ['--graphml'] : [], cwd: layout.frontScripts, label: '前端链路库' });
  }

  console.log('[INFO] 计划执行 ' + steps.length + ' 步：' + steps.map((s) => s.label).join(' → '));
  const startedAll = Date.now();
  for (const step of steps) {
    const r = runStep(py, step.script, step.stepArgs, step.cwd, dryRun);
    if (!r.ok) {
      console.error('[FAIL] 构建中止于「' + step.label + '」；已生成的中间产物保留，修复后可重跑');
      process.exit(1);
    }
  }
  const totalSec = ((Date.now() - startedAll) / 1000).toFixed(1);
  console.log('');
  console.log('[OK] 构建完成，总耗时 ' + totalSec + 's' + (dryRun ? '（DRY-RUN）' : ''));

  if (dryRun) process.exit(0);

  const after = {
    endpoints: fileInfo(layout.endpoints),
    chainDb: fileInfo(layout.chainDb),
    frontOutputs: Object.fromEntries(Object.entries(layout.frontOutputs).map(([k, v]) => [k, fileInfo(v)])),
  };
  const problems = [];
  if (!after.endpoints.exists) problems.push('controller_endpoints.json 未生成');
  if (!after.chainDb.exists) problems.push('front_chain_db.json 未生成');
  if (after.chainDb.exists && after.chainDb.sizeMB < 1) problems.push('front_chain_db.json 体积异常偏小（' + after.chainDb.sizeMB + 'MB）');

  console.log(JSON.stringify({ built: problems.length === 0, totalSeconds: Number(totalSec), status: after, problems }, null, 2));
  if (problems.length > 0) {
    console.error('[FAIL] 产物校验未通过：' + problems.join('；'));
    process.exit(1);
  }
  process.exit(0);
}

main();