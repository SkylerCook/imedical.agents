#!/usr/bin/env node
'use strict';

/**
 * 确定性报告渲染器：把分类检查点 + 评估 + 数据库检测 + 调用图证据渲染为
 * commit-report-<label>.md。只做排版与校验，不改写任何评价性文字。
 */

const fs = require('fs');
const path = require('path');

const RATING_STANDARD = `### 影响范围评级标准

影响范围评级（\`impactRating\`）独立于质量星级，按「假设该功能一定发生严重故障」时的业务波及面判定，用于邮件与功能变更影响表的标题前缀 \`[N★]\` 及整体排序（从大到小）。

| 影响范围评级 | 判定 |
|---|---|
| 5★ | 核心业务阻断并形成大批量积压：患者无法完成「挂号→就诊→开方→收费→取药/检查」中的任一必经环节，且无其他系统入口或人工流程可立即替代，形成可见队列积压且短期不会自行缓解 |
| 4★ | 核心业务严重受阻：正常路径被切断或严重劣化，只能靠手工单据、备用入口或降级流程维持；积压持续累积，但尚未达到大批量阻断 |
| 3★ | 核心模块受控中断：影响收缩到单一核心模块或单一业务线，其他核心链路正常运行，或绕行方案可承载当前业务量 |
| 2★ | 非核心业务受影响：辅助系统、边缘模块或特定科室的非关键功能异常，核心链路用户仍能完成主流程 |
| 1★ | 几乎无业务感知：仅界面呈现、日志记录、非关键配置或行为等价的重构，无需培训、绕行或通知业务科室 |

> 5★ 必须同时满足「阻断」与「大批量」；仅调用方数量多、但业务可通过其他入口或人工流程完成时，最高评为 4★。`;

const EXEC_PLAN = {
  po: '- **数据结构修改（PO）**：建议通过【腾讯文档】his 版本升级脚本汇总表格 https://docs.qq.com/sheet/DSnJ5V0tYRG9jT1VL?tab=BB08J2 的登记 DDL 进行执行。',
  config:
    '- **新增系统标准配置**：建议打开[信创标准环境](http://82.156.104.202:32678/imedical/his/hos/login)，使用demo账户登录后，打开系统标准配置菜单，筛选出指定的配置项导出文件，并导入到项目现场。\n  请勿直接维护，请使用导入功能，防止出现维护错误。',
  reminder:
    '- **新增系统标准提醒**：建议打开[信创标准环境](http://82.156.104.202:32678/imedical/his/hos/login)，使用demo账户登录后，打开系统提示信息，参照代码信息进行数据维护。',
  cache:
    '- **新增代码表缓存配置**：建议打开[信创标准环境](http://82.156.104.202:32678/imedical/his/hos/login)，使用demo账户登录后，打开代码表缓存管理，参照代码信息进行数据维护。'
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`无法识别的参数：${a}`);
    const key = a.slice(2);
    const eq = key.indexOf('=');
    if (eq >= 0) out[key.slice(0, eq)] = key.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`缺少${label}：${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${label} 不是合法 JSON：${file}\n${e.message}`);
  }
}

function normalizeEvaluations(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.evaluations)) return data.evaluations;
  throw new Error('evaluations 文件结构错误：应为数组或 { evaluations: [] }');
}

function normalizeClassification(data) {
  if (data && Array.isArray(data.commits)) return data.commits;
  if (Array.isArray(data)) return data;
  throw new Error('classification 文件结构错误：应为 { commits: [] } 或数组');
}

function cell(v) {
  return String(v == null ? '' : v)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function table(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${r.map(cell).join(' | ')} |`);
  return lines.join('\n');
}

function repoShort(repo) {
  return String(repo || '').replace(/^src\/backend\//, '').replace(/^src\/frontend\//, '');
}

function shortHash(hash) {
  return String(hash || '').slice(0, 8);
}

function dateOnly(d) {
  return String(d || '').slice(0, 10);
}

function formatLocalMinute(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
  return parts;
}

function distribution(items, keyFn) {
  const counts = new Map();
  for (const it of items) {
    const k = keyFn(it) || '其他';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
}

function distTable(headers, entries) {
  return table(headers, entries.map(([name, count]) => [name, count]));
}

function evidenceCounts(impactCommit) {
  if (!impactCommit) return null;
  return {
    methods: (impactCommit.methods || []).length,
    entrypoints: (impactCommit.entrypoints || []).length,
    workspaceCallers: (impactCommit.workspaceCallers || []).length,
    externalCallers: (impactCommit.externalCallers || []).length,
    downstreamFeigns: (impactCommit.downstreamFeigns || []).length,
    confidence: impactCommit.confidence
  };
}

function validate({ raws, classification, evaluations, impactMap, config, errors, warnings }) {
  const rawByHash = new Map(raws.map((c) => [c.hash, c]));
  const clsByHash = new Map();
  const allowedWs = config && Array.isArray(config.workstations) ? config.workstations : null;
  const reqTypes = ['BUG修复', '新功能提交', '流程修改', '业务调整', '其他'];
  const priorities = ['P0', 'P1', 'P2', 'P3'];

  for (const c of classification) {
    if (!c.hash) errors.push('classification 存在缺少 hash 的条目');
    else if (clsByHash.has(c.hash)) errors.push(`classification 重复 hash：${shortHash(c.hash)}`);
    else clsByHash.set(c.hash, c);
    if (!rawByHash.has(c.hash)) errors.push(`classification 含 raw-commits 之外的提交：${shortHash(c.hash)}`);
    if (!c.workstation) errors.push(`classification 缺少工作站：${shortHash(c.hash)}`);
    else if (allowedWs && !allowedWs.includes(c.workstation)) {
      errors.push(`classification 工作站不在 config 清单：${shortHash(c.hash)} → ${c.workstation}`);
    }
    if (!reqTypes.includes(c.reqType)) errors.push(`classification 需求类型非法：${shortHash(c.hash)} → ${c.reqType}`);
    if (!priorities.includes(c.priority)) errors.push(`classification 优先级非法：${shortHash(c.hash)} → ${c.priority}`);
    if (!c.summary) errors.push(`classification 缺少改造内容总结：${shortHash(c.hash)}`);
  }
  for (const r of raws) {
    if (!clsByHash.has(r.hash)) errors.push(`classification 缺少提交：${shortHash(r.hash)} ${String(r.subject).slice(0, 40)}`);
  }

  const evalHashes = new Set();
  for (const e of evaluations) {
    if (!e.hash) {
      errors.push('evaluations 存在缺少 hash 的条目');
      continue;
    }
    if (evalHashes.has(e.hash)) errors.push(`evaluations 重复 hash：${shortHash(e.hash)}`);
    evalHashes.add(e.hash);
    if (!rawByHash.has(e.hash)) errors.push(`evaluations 含 raw-commits 之外的提交：${shortHash(e.hash)}`);
    const cls = clsByHash.get(e.hash);
    if (!cls) continue;
    if (cls.reqType !== e.reqType) {
      errors.push(`需求类型不一致：${shortHash(e.hash)} classification=${cls.reqType} evaluations=${e.reqType}`);
    }
    if (cls.workstation !== e.workstation) {
      warnings.push(`工作站不一致：${shortHash(e.hash)} classification=${cls.workstation} evaluations=${e.workstation}`);
    }
    if (!(Number(e.rating) >= 1 && Number(e.rating) <= 5)) errors.push(`质量星级非法：${shortHash(e.hash)} → ${e.rating}`);
    if (!(Number(e.impactRating) >= 1 && Number(e.impactRating) <= 5)) {
      errors.push(`影响范围评级非法：${shortHash(e.hash)} → ${e.impactRating}`);
    }
    if (!e.impactRatingReason) errors.push(`缺少 impactRatingReason：${shortHash(e.hash)}`);
    if (!e.impactScope) errors.push(`缺少 impactScope：${shortHash(e.hash)}`);
    if (!e.compliance) errors.push(`缺少 compliance：${shortHash(e.hash)}`);
    if (!e.evaluation) errors.push(`缺少 evaluation：${shortHash(e.hash)}`);
    if (!e.changeSummary) errors.push(`缺少 changeSummary：${shortHash(e.hash)}`);
    if (!e.impactEvidence) errors.push(`缺少 impactEvidence：${shortHash(e.hash)}`);
    const ts = String(e.testSuggestion || '');
    for (const seg of ['【必测】', '【回归】', '【联调】', '【边界】']) {
      if (!ts.includes(seg)) errors.push(`测试方式建议缺少 ${seg}：${shortHash(e.hash)}`);
    }
    if (Number(e.rating) <= 2 && !e.specificIssue && !(Array.isArray(e.issueItems) && e.issueItems.length)) {
      errors.push(`低星提交缺少具体问题：${shortHash(e.hash)}`);
    }
    if (e.workstation === '门急诊应急医师工作站' && Number(e.impactRating) > 2) {
      warnings.push(`门急诊应急工作站影响评级超过 2★ 上限：${shortHash(e.hash)} → ${e.impactRating}★（按规则应降级）`);
    }
    const exp = evidenceCounts(impactMap.get(e.hash));
    if (exp) {
      const got = e.impactEvidence;
      for (const k of ['methods', 'entrypoints', 'workspaceCallers', 'externalCallers', 'downstreamFeigns']) {
        if (got[k] !== exp[k]) {
          warnings.push(`证据计数与 code-impact 不一致：${shortHash(e.hash)} ${k} evaluations=${got[k]} code-impact=${exp[k]}`);
        }
      }
      if (got.confidence !== exp.confidence) {
        warnings.push(`可信度与 code-impact 不一致：${shortHash(e.hash)} evaluations=${got.confidence} code-impact=${exp.confidence}`);
      }
    }
  }

  for (const c of classification) {
    if (c.reqType === '流程修改' || c.reqType === '业务调整') {
      if (!evalHashes.has(c.hash)) {
        errors.push(`流程修改/业务调整未评估：${shortHash(c.hash)} ${String(c.subject).slice(0, 40)}`);
      }
    }
  }
  for (const h of evalHashes) {
    const cls = clsByHash.get(h);
    if (cls && cls.reqType !== '流程修改' && cls.reqType !== '业务调整') {
      warnings.push(`非流程/业务调整提交被评估：${shortHash(h)}（${cls.reqType}）`);
    }
  }
}

function render({ label, raws, meta, classification, evaluations, db, impactMap, generatedAt }) {
  const evalByHash = new Map(evaluations.map((e) => [e.hash, e]));
  const lines = [];

  lines.push(`# 医生站信创产品迭代周报 — ${label}`);
  lines.push('');
  const since = (meta.window && meta.window.since) || '';
  const until = (meta.window && meta.window.until) || '';
  lines.push(
    `> 时间窗：${since} ~ ${until} · 生成时间：${formatLocalMinute(generatedAt)} · 扫描仓库：${meta.reposScanned != null ? meta.reposScanned : '—'} 个（有提交：${meta.reposWithCommits != null ? meta.reposWithCommits : '—'}）· 提交总数：${classification.length}`
  );
  lines.push('');

  // 一、概览
  lines.push('## 一、概览');
  lines.push('');
  lines.push('### 按提交人分布');
  lines.push('');
  lines.push(distTable(['提交人', '提交数'], distribution(classification, (c) => c.author)));
  lines.push('');
  lines.push('### 按工作站分布');
  lines.push('');
  lines.push(distTable(['工作站', '提交数'], distribution(classification, (c) => c.workstation)));
  lines.push('');
  lines.push('### 按需求类型分布');
  lines.push('');
  lines.push(distTable(['需求类型', '提交数'], distribution(classification, (c) => c.reqType)));
  lines.push('');
  lines.push('### 按优先级分布');
  lines.push('');
  const prioCounts = new Map();
  for (const c of classification) prioCounts.set(c.priority, (prioCounts.get(c.priority) || 0) + 1);
  lines.push(
    distTable(
      ['优先级', '提交数'],
      ['P0', 'P1', 'P2', 'P3'].filter((p) => prioCounts.has(p)).map((p) => [p, prioCounts.get(p)])
    )
  );
  lines.push('');
  lines.push(RATING_STANDARD);
  lines.push('');

  // 二、提交明细
  lines.push('## 二、提交明细');
  lines.push('');
  const detailRows = classification.map((c, i) => {
    const e = evalByHash.get(c.hash);
    return [
      i + 1,
      c.workstation,
      c.reqType,
      c.priority,
      c.author,
      dateOnly(c.date),
      repoShort(c.repo),
      c.summary,
      e ? `${e.rating}★` : '—'
    ];
  });
  lines.push(table(['#', '工作站', '需求类型', '优先级', '提交人', '日期', '仓库', '改造内容总结', '质量评级'], detailRows));
  lines.push('');
  lines.push('> 「质量评级」为业务设计符合性星级；影响范围评级见第三章各条目标题前缀 `[N★]`。');
  lines.push('');

  // 三、评估详情
  lines.push('## 三、评估详情（流程修改 / 业务调整）');
  lines.push('');
  const sorted = [...evaluations].sort((a, b) => Number(b.impactRating) - Number(a.impactRating) || Number(b.rating) - Number(a.rating));
  if (sorted.length === 0) {
    lines.push('本期无需评估的流程修改 / 业务调整提交。');
    lines.push('');
  }
  for (const e of sorted) {
    const ie = e.impactEvidence || {};
    lines.push(`### ${shortHash(e.hash)} [${e.impactRating}★] ${e.subject} — ${e.author} · ${dateOnly(e.date)} · ${repoShort(e.repo)}`);
    lines.push('');
    lines.push(`- **命中高风险类别**：${e.highRiskCategory || '无'}`);
    if (e.impactDowngrade) lines.push(`- **影响范围降级**：${e.impactDowngrade}`);
    lines.push(`- **影响范围评级**：${e.impactRating}★ —— ${e.impactRatingReason}`);
    lines.push(
      `- **调用图证据**：入口 ${ie.entrypoints || 0} · 工作区调用方 ${ie.workspaceCallers || 0} · 外部 Maven 调用方 ${ie.externalCallers || 0} · 跨出 Feign ${ie.downstreamFeigns || 0} · 可信度 ${ie.confidence || 'none'}（方法 ${ie.methods || 0}，契约 Feign ${ie.feignContracts || 0}，契约文件 ${ie.typeFiles || 0}，截断 ${ie.truncated || 0}）`
    );
    lines.push(`- **影响范围**：${e.impactScope}`);
    lines.push(`- **业务设计流程符合性**：${e.compliance} —— ${e.complianceReason}`);
    lines.push(`- **评级**：${e.rating}★ —— 评价：${e.evaluation}`);
    lines.push('');
  }

  // 四、低星问题清单
  lines.push('## 四、低星问题清单（1-2★）');
  lines.push('');
  lines.push(
    '> 仅列代码 / 设计层面的问题。「需完成系统标准配置登记 / 标准提醒维护 / 代码表缓存配置维护 / PO 表结构（DDL）执行」类数据维护提醒统一由第五章承载，不在本章与步骤 ⑥ 登记中出现。'
  );
  lines.push('');
  const low = sorted.filter((e) => Number(e.rating) <= 2);
  if (low.length === 0) {
    lines.push('本期无 1-2★ 低星问题。');
  } else {
    lines.push(
      table(
        ['提交', '星级', '具体问题（文件:行号 / diff 片段）'],
        low.map((e) => [
          `${shortHash(e.hash)} ${e.subject}`,
          `${e.rating}★`,
          e.specificIssue || (Array.isArray(e.issueItems) ? e.issueItems.join('；') : '') || '—'
        ])
      )
    );
  }
  lines.push('');

  // 五、数据库脚本执行提醒
  lines.push('## 五、数据库脚本执行提醒');
  lines.push('');
  const poChanges = db.poChanges || [];
  const newStCodes = db.newStCodes || [];
  const configItems = db.configItems || [];
  const reminders = db.reminders || [];
  const cacheConfigs = db.cacheConfigs || [];
  const allEmpty = poChanges.length + newStCodes.length + configItems.length + reminders.length + cacheConfigs.length === 0;
  if (allEmpty) {
    lines.push('本期无数据库脚本执行提醒');
    lines.push('');
  } else {
    lines.push(
      `> 本期检测：数据结构修改 ${poChanges.length} 处 · 新增系统标准配置 ${configItems.length} 项 · 新增系统标准提醒 ${reminders.length} 条 · 新增代码表缓存配置 ${cacheConfigs.length} 项`
    );
    lines.push('');

    lines.push('### 5.1 数据结构修改（PO）');
    lines.push('');
    if (poChanges.length === 0) {
      lines.push('本期无数据结构修改。');
    } else {
      lines.push(
        table(
          ['提交', '提交人', '表名', '文件', '字段变更'],
          poChanges.map((r) => {
            const changes = [];
            if (r.isNewFile) changes.push('新建');
            for (const f of r.addedFields || []) changes.push(`新增 ${f.name}(${f.type}, ${f.column})`);
            for (const f of r.removedFields || []) changes.push(`删除 ${f.name}(${f.type}, ${f.column})`);
            return [shortHash(r.hash), r.author, r.tableName || '—', r.file, changes.join('；') || '—'];
          })
        )
      );
    }
    lines.push('');

    lines.push('### 5.2 新增系统标准配置');
    lines.push('');
    if (newStCodes.length + configItems.length === 0) {
      lines.push('本期无新增系统标准配置。');
    } else {
      const rows = [];
      for (const r of newStCodes) {
        rows.push([shortHash(r.hash), r.author, r.stCode || '—', '—', '—', '—', '新增 ST_CODE 常量']);
      }
      for (const r of configItems) {
        const desc = String(r.description || '—');
        rows.push([
          shortHash(r.hash),
          r.author,
          r.stCode || '—',
          r.constantName || '—',
          r.itemCode || '—',
          desc.length > 80 ? `${desc.slice(0, 80)}…` : desc,
          r.scope === 'docconfig' ? 'docconfig 新增配置读取' : '行内 ST_CODE 字面量'
        ]);
      }
      lines.push(table(['提交', '提交人', '配置大类（ST_CODE）', '常量名', '配置项', '配置说明', '检测依据'], rows));
    }
    lines.push('');

    lines.push('### 5.3 新增系统标准提醒');
    lines.push('');
    if (reminders.length === 0) {
      lines.push('本期无新增系统标准提醒。');
    } else {
      lines.push(
        table(
          ['提交', '提交人', '提醒码', '提醒内容', '文件:行号'],
          reminders.map((r) => [
            shortHash(r.hash),
            r.author,
            r.resolvedCode || `${r.expr || ''}${r.codeSuffix || ''}`,
            r.message || '（动态）',
            `${r.file}${r.lineNo != null ? `:${r.lineNo}` : ''}`
          ])
        )
      );
    }
    lines.push('');

    lines.push('### 5.4 新增代码表缓存配置');
    lines.push('');
    if (cacheConfigs.length === 0) {
      lines.push('本期无新增代码表缓存配置。');
    } else {
      lines.push(
        table(
          ['提交', '提交人', 'PO 类', '表名', '方法', '文件:行号'],
          cacheConfigs.map((r) => [
            shortHash(r.hash),
            r.author,
            r.poClass || '—',
            r.tableName || '—',
            r.method || '—',
            `${r.file}${r.lineNo != null ? `:${r.lineNo}` : ''}`
          ])
        )
      );
    }
    lines.push('');

    lines.push('### 5.5 执行方案推荐');
    lines.push('');
    if (poChanges.length) lines.push(EXEC_PLAN.po);
    if (configItems.length) lines.push(EXEC_PLAN.config);
    if (reminders.length) lines.push(EXEC_PLAN.reminder);
    if (cacheConfigs.length) lines.push(EXEC_PLAN.cache);
    lines.push('');
  }

  // 六、附录
  lines.push('## 六、附录：深度评估摘要');
  lines.push('');
  const deep = sorted.filter((e) => e.highRiskCategory && e.highRiskCategory !== '无' && !e.impactDowngrade);
  if (deep.length === 0) {
    lines.push('本期无深度评估提交。');
    lines.push('');
  }
  for (const e of deep) {
    const ic = impactMap.get(e.hash);
    const eps = [];
    const seen = new Set();
    for (const ep of (ic && ic.entrypoints) || []) {
      const name = ep.controller || ep.feign || ep.http;
      if (name && !seen.has(name)) {
        seen.add(name);
        eps.push(name);
      }
    }
    const epsText = eps.length ? `${eps.slice(0, 6).join('、')}${eps.length > 6 ? ` 等 ${eps.length} 项` : ''}` : '无';
    const feigns = ((ic && ic.contract && ic.contract.feignInterfaces) || []).filter(Boolean);
    const downstreams = ((ic && ic.downstreamFeigns) || [])
      .map((f) => (f.feign ? `${f.feign}${f.method ? `#${f.method}` : ''}` : ''))
      .filter(Boolean);
    lines.push(`### ${shortHash(e.hash)} [${e.impactRating}★] ${e.subject}（命中：${e.highRiskCategory}）`);
    lines.push('');
    lines.push(`- 调用链要点：关键入口 ${epsText}；契约 Feign ${feigns.length ? feigns.join('、') : '无'}；下游 Feign ${downstreams.length ? downstreams.join('、') : '无'}。`);
    let conclusion = `- 结论：${e.evaluation}`;
    if (Number(e.rating) <= 2 && e.specificIssue) conclusion += ` 具体问题：${e.specificIssue}`;
    lines.push(conclusion);
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const label = args.label;
  if (!label || label === true) throw new Error('缺少 --label <期号>');
  const outputDir = args['output-dir'] || 'docs/agents/commit-reports';
  const dir = path.join(outputDir, label);
  const configPath = args.config || path.join(__dirname, '..', 'config', 'commit-report.json');

  const rawData = readJson(path.join(dir, `raw-commits-${label}.json`), '采集结果');
  const clsData = readJson(path.join(dir, `classification-${label}.json`), '分类检查点');
  const evalData = readJson(path.join(dir, `evaluations-${label}.json`), '评估结果');
  const db = readJson(path.join(dir, `db-changes-${label}.json`), '数据库变更检测结果');

  let config = null;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      throw new Error(`插件配置不是合法 JSON：${configPath}\n${e.message}`);
    }
  }

  const raws = rawData.commits || [];
  const meta = rawData.meta || {};
  const classification = normalizeClassification(clsData);
  const evaluations = normalizeEvaluations(evalData);

  const impactPath = path.join(dir, `code-impact-${label}.json`);
  const impactMap = new Map();
  if (fs.existsSync(impactPath)) {
    const impact = JSON.parse(fs.readFileSync(impactPath, 'utf8'));
    for (const c of impact.commits || []) impactMap.set(c.hash, c);
  }

  const errors = [];
  const warnings = [];
  validate({ raws, classification, evaluations, impactMap, config, errors, warnings });

  if (warnings.length) {
    console.warn(`[WARN] ${warnings.length} 条校验告警：`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
  if (errors.length) {
    console.error(`[ERROR] ${errors.length} 条校验错误，未生成报告：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const generatedAt = args['generated-at'] || new Date().toISOString();
  let md = render({ label, raws, meta, classification, evaluations, db, impactMap, generatedAt });
  const outPath = path.join(dir, `commit-report-${label}.md`);
  // 「七、低星问题登记」由步骤 ⑥ 追加；重渲染时原样保留，避免覆盖登记结果
  if (!args['no-preserve-registration'] && fs.existsSync(outPath)) {
    const prev = fs.readFileSync(outPath, 'utf8');
    const idx = prev.search(/^## 七、/m);
    if (idx >= 0) md = `${md.replace(/\n+$/, '')}\n\n${prev.slice(idx).replace(/\n+$/, '')}\n`;
  }
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`已生成报告：${outPath}`);
  console.log(
    `提交 ${classification.length} 条 · 评估 ${evaluations.length} 条（低星 ${evaluations.filter((e) => Number(e.rating) <= 2).length}）· 数据库提醒 ${(db.poChanges || []).length + (db.configItems || []).length + (db.reminders || []).length + (db.cacheConfigs || []).length} 项`
  );
}

try {
  main();
} catch (e) {
  console.error(`[ERROR] ${e.message}`);
  process.exit(1);
}
