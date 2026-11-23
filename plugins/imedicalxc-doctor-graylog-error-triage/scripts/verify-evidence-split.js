// 证据等级分区自检：classified-*.json ↔ 本组问题-*.md ↔ 巡检总览-*.md 三方对账
// 用法: node verify-evidence-split.js --env <env> --day <yyyy-MM-dd> [--hm <HHmm>]
// 退出码: 0 全部通过 / 1 存在失败项 / 2 输入缺失
// 用 Node 而非 PowerShell：PS 5.1 读 UTF-8 无 BOM 文件按 GBK 解码，中文断言会出现假阴性

const fs = require('node:fs');
const path = require('node:path');

const OUT_ROOT = path.join('docs', 'agent-reports', 'graylog-triage');
const LV_ROW = /^\|\s*证据等级\s*\|/;
const LV_EMPTY = /^\|\s*证据等级\s*\|\s*-\s*\|\s*$/;
const CLUSTER_ROW = /^##\s+\d+\.\s/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const body = t.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) { args[body.slice(0, eq)] = body.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args[body] = next; i += 1; }
    else args[body] = true;
  }
  return args;
}

function fail(msg) {
  console.error('[ERROR] ' + msg);
  process.exit(2);
}

function latestClassified(env, day) {
  const dir = path.join(OUT_ROOT, env, day);
  if (!fs.existsSync(dir)) return '';
  const hits = fs.readdirSync(dir)
    .filter((f) => /^classified-\d{4}\.json$/.test(f))
    .sort()
    .reverse();
  return hits.length ? path.join(dir, hits[0]) : '';
}

// summary 表格取数：| 本组（有本组堆栈帧） | 0 | ... |
function cellNumber(lines, label) {
  const re = new RegExp('^\\|\\s*' + label + '\\s*\\|\\s*(\\d+)\\s*\\|');
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = String(args.env || '');
  const day = String(args.day || '');
  if (!env || !day) fail('需要 --env 与 --day，例如 --env wengyuan-prod --day 2026-11-20');

  const classified = typeof args.classified === 'string'
    ? path.resolve(args.classified)
    : latestClassified(env, day);
  if (!classified || !fs.existsSync(classified)) fail('找不到 classified 文件: ' + classified);

  const hm = (path.basename(classified).match(/^classified-(\d{4})\.json$/) || [])[1];
  if (!hm) fail('classified 文件名不含 HHmm: ' + classified);

  const dir = path.dirname(classified);
  // 中文名为当前产物；英文名兼容历史轮次
  const pickReport = (prefixes) => {
    for (const p of prefixes) {
      const f = path.join(dir, p + hm + '.md');
      if (fs.existsSync(f)) return f;
    }
    return path.join(dir, prefixes[0] + hm + '.md');
  };
  const selfFile = pickReport(['本组问题-', 'report-self-']);
  const sumFile = pickReport(['巡检总览-', 'report-summary-']);
  for (const f of [selfFile, sumFile]) {
    if (!fs.existsSync(f)) fail('缺少报告: ' + f + '（先跑 render-report.js）');
  }

  const st = JSON.parse(fs.readFileSync(classified, 'utf8')).stats || {};
  const selfLines = fs.readFileSync(selfFile, 'utf8').split(/\r?\n/);
  const sumLines = fs.readFileSync(sumFile, 'utf8').split(/\r?\n/);

  const lvRows = selfLines.filter((l) => LV_ROW.test(l));
  const mfRows = lvRows.filter((l) => l.includes('module-frame'));
  const aoRows = lvRows.filter((l) => l.includes('app-only'));
  const ifRows = lvRows.filter((l) => l.includes('interface-fqcn'));
  const naRows = lvRows.filter((l) => LV_EMPTY.test(l));
  const clusterRows = selfLines.filter((l) => CLUSTER_ROW.test(l));

  const head = /本组簇数：(\d+)（[^）]*?有本组堆栈帧 (\d+) \/ 仅应用名推断 (\d+)/.exec(selfLines.join('\n'));
  const sumMf = cellNumber(sumLines, '本组（有本组堆栈帧）');
  const sumAo = cellNumber(sumLines, '本组（仅应用名推断）');

  const cases = [
    ['mf 行数 == stats.selfModuleFrame', mfRows.length, st.selfModuleFrame],
    ['ao 行数 == stats.selfAppOnly', aoRows.length, st.selfAppOnly],
    ['空等级行数 == stats.unknown', naRows.length, st.unknown],
    ['证据等级行四类相加', mfRows.length + aoRows.length + ifRows.length + naRows.length, lvRows.length],
    ['证据等级行总数 == 簇标题总数', lvRows.length, clusterRows.length],
    ['三档相加 == stats.self', (st.selfModuleFrame || 0) + (st.selfAppOnly || 0) + (st.selfSlow || 0), st.self],
    ['五桶相加 == stats.clusters', (st.self || 0) + (st.infra || 0) + (st.externalClusters || 0) + (st.unrelated || 0) + (st.unknown || 0), st.clusters],
    ['report-self 头部三数 == stats', head ? Number(head[2]) : null, st.selfModuleFrame],
    ['summary 有本组堆栈帧行 == stats', sumMf, st.selfModuleFrame],
    ['summary 仅应用名行 == stats', sumAo, st.selfAppOnly],
  ];

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) failed += 1;
    console.log((ok ? '[PASS] ' : '[FAIL] ') + name + '（实际 ' + actual + ' / 期望 ' + expected + '）');
  }

  console.log('');
  console.log('对账文件:');
  console.log('  classified: ' + classified);
  console.log('  report-self: ' + selfFile);
  console.log('  巡检总览   : ' + sumFile);
  console.log(failed === 0 ? '[OK] 全部通过' : '[FAIL] ' + failed + ' 项未通过');
  process.exit(failed === 0 ? 0 : 1);
}

main();