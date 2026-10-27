#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUBJECT = '信创版数据变更通知-医生站';
const DDL_URL = 'https://docs.qq.com/sheet/DSnJ5V0tYRG9jT1VL?tab=ipn52r';
const DDL_DOC_NAME = '【腾讯文档】信创版HIS数据库升级脚本汇总表格';
const STD_ENV_URL = 'http://82.156.104.202:32678/imedical/his/hos/login';
const STD_ENV_NAME = '信创标准环境';

// ========== 影响表映射逻辑（从 build-impact-table.js 复用） ==========
const REPO_TO_SYSTEM = {
  'src/backend/care/opcare-mediway-boot': '门诊诊疗信息系统',
  'src/backend/care/ipcare-mediway-boot': '住院诊疗信息系统',
  'src/backend/care/comoe-mediway': '门诊诊疗信息系统',
  'src/backend/care/cfoe-mediway': '门诊诊疗信息系统',
  'src/backend/care/commr-mediway': '门诊诊疗信息系统',
  'src/backend/care/cfmr-mediway': '门诊诊疗信息系统',
  'src/backend/care/aggcare-mediway-boot': '门诊诊疗信息系统',
  'src/backend/public/his-mediway-boot': '公共模块',
  'src/backend/public/hisbase-mediway': '公共模块',
  'src/backend/public/hiscore-mediway-boot': '公共模块',
  'src/backend/public/cf/hiscf-mediway-boot': '门诊诊疗信息系统',
  'src/backend/public/cf/hiscfsv-mediway': '门诊诊疗信息系统',
  'src/backend/public/ct/hisct-mediway-boot': '门诊诊疗信息系统',
  'src/backend/public/ct/hisctsv-mediway': '门诊诊疗信息系统',
  'src/backend/opreg-mediway-boot': '门诊服务信息系统（注册挂号）',
  'src/backend/hispa-mediway-boot': '门诊服务信息系统（注册挂号）',
  'src/backend/opalloc-mediway-boot': '门诊分诊系统',
  'src/backend/ma-mediway-boot': '医务管理',
  'src/backend/curc-mediway-boot': '康复治疗系统',
  'src/frontend/hisfront': '前端'
};

const SYSTEM_TO_WORKSTATION = {
  '门诊诊疗信息系统': '门诊诊疗医师工作站',
  '住院诊疗信息系统': '住院诊疗医师工作站',
  '门诊服务信息系统（注册挂号）': '注册挂号工作站',
  '门诊分诊系统': '门诊分诊工作站',
  '康复治疗系统': '康复治疗科室工作站',
  '临床试验管理系统': '临床试验工作站',
  '临床化疗系统': '临床化疗工作站',
  '公共模块': '诊疗配置工作站',
  '医务管理': '诊疗配置工作站',
  '前端': '（前端通用）'
};

function determineWorkstation(repo, system) {
  if (system && SYSTEM_TO_WORKSTATION[system]) return SYSTEM_TO_WORKSTATION[system];
  if (repo.includes('opcare') || repo.includes('opreg') || repo.includes('opalloc')) return '门诊诊疗医师工作站';
  if (repo.includes('ipcare')) return '住院诊疗医师工作站';
  if (repo.includes('curc')) return '康复治疗科室工作站';
  if (repo.includes('cf/') || repo.includes('ct/')) return '诊疗配置工作站';
  return '（未分类）';
}

function determineModule(ev, mapping) {
  const text = `${ev.impactScope || ''} ${ev.summary || ''}`;
  if (text.includes('医嘱')) return '医嘱录入';
  if (text.includes('诊断')) return '诊断录入';
  if (text.includes('检验') || text.includes('检查')) return '检验检查申请';
  if (text.includes('病历')) return '病历文书';
  if (text.includes('配置')) return '常用维护';
  if (text.includes('排班') || text.includes('挂号')) return '门诊挂号';
  return '（待确认）';
}

function buildImpactRows(evaluations, rawCommits, mapping) {
  if (!evaluations || evaluations.length === 0) return [];
  const filesByHash = {};
  if (rawCommits) {
    for (const c of rawCommits) {
      if (c.hash && c.files) filesByHash[c.hash] = c.files;
    }
  }
  return evaluations.map((ev) => {
    const system = REPO_TO_SYSTEM[ev.repo] || '（未分类）';
    const workstation = determineWorkstation(ev.repo, system);
    const funcModule = determineModule(ev, mapping);
    const funcPoint = ev.impactScope || ev.summary || '（待分析）';
    return {
      workstation,
      funcModule,
      funcPoint,
      reqType: ev.reqType || '代码变更',
      author: ev.author || '—',
      repo: ev.repo || '—',
      changePoint: ev.summary || '—'
    };
  });
}
// ========== 影响表逻辑结束 ==========

function buildRows(db) {
  const rows = [];
  for (const p of db.poChanges || []) {
    const fields = [
      ...(p.addedFields || []).map((f) => `+${f.name}`),
      ...(p.removedFields || []).map((f) => `-${f.name}`)
    ];
    const table = p.tableName || '（表名未知）';
    let content;
    if (fields.length > 0) {
      content = `${p.isNewFile ? '新建表' : '表'} ${table}：${fields.join('、')}`;
    } else {
      content = p.isNewFile ? `新建表 ${table}` : `表 ${table}：结构变更`;
    }
    rows.push(['数据结构修改', content, p.author]);
  }
  for (const s of db.newStCodes || []) {
    rows.push(['新增系统标准配置', `${s.stCode}（新增配置大类）`, s.author]);
  }
  for (const it of db.configItems || []) {
    const desc = it.description ? `（${it.description}）` : '';
    rows.push(['新增系统标准配置', `${it.stCode || it.stCodeRaw} / ${it.itemCode}${desc}`, it.author]);
  }
  const reminderGroups = new Map();
  for (const r of db.reminders || []) {
    const unresolved = !r.resolvedCode;
    const code = r.resolvedCode || `${r.expr}+${r.codeSuffix}`;
    const key = `${code}|${r.message || ''}|${r.author}|${unresolved}`;
    const g = reminderGroups.get(key) || { code, message: r.message, author: r.author, unresolved, count: 0 };
    g.count += 1;
    reminderGroups.set(key, g);
  }
  for (const g of reminderGroups.values()) {
    let content = g.message ? `${g.code}（${g.message}）` : g.code;
    if (g.count > 1) content += ` ×${g.count} 处`;
    if (g.unresolved) content += '（提醒码前缀常量未能自动解析，完整前缀见周报第五章该提交明细）';
    rows.push(['新增系统标准提醒', content, g.author]);
  }
  for (const cc of db.cacheConfigs || []) {
    rows.push(['新增代码表缓存配置', `${cc.poClass}.${cc.method}${cc.tableName ? `（表 ${cc.tableName}）` : ''}`, cc.author]);
  }
  return rows;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cstNow() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+8)';
}

function buildEmailMd(db, opts = {}) {
  const w = (db.meta && db.meta.window) || {};
  const range = w.since && w.until ? `${w.since} ~ ${w.until}` : (w.label || '');
  const rows = buildRows(db);
  const impactRows = opts.impactRows || [];
  const lines = [];
  lines.push(`# ${SUBJECT}${opts.suffix || ''}`);
  lines.push('');
  if (range) {
    lines.push(`> 检测时间窗：${range}`);
    lines.push('');
  }
  if (opts.note) {
    lines.push(`> **更正说明**：${opts.note}`);
    lines.push('');
  }
  lines.push('说明：当前为试用运行阶段，更新阶段出现疑问可联系变更负责人咨询。');
  lines.push('');
  lines.push('## 一、变更明细');
  lines.push('');
  if (rows.length === 0) {
    lines.push('本期无数据变更。');
  } else {
    lines.push('| 变更类型 | 变更内容 | 变更负责人 |');
    lines.push('|----------|----------|------------|');
    for (const [type, content, author] of rows) {
      lines.push(`| ${type} | ${content} | ${author || '—'} |`);
    }
  }
  lines.push('');
  lines.push('## 二、变更的操作说明');
  lines.push('');
  lines.push('### 1. 数据库 DDL 脚本');
  lines.push('');
  lines.push(`建议参考${DDL_DOC_NAME} ${DDL_URL} 的描述进行执行。`);
  lines.push('');
  lines.push('### 2. 新增系统标准提醒');
  lines.push('');
  lines.push(`[信创标准环境](${STD_ENV_URL}) → 使用demo账户登录 → 打开菜单【系统提示信息】，参照代码信息进行数据维护。`);
  lines.push('');
  lines.push('### 3. 新增系统标准配置');
  lines.push('');
  lines.push(`[信创标准环境](${STD_ENV_URL}) → 使用demo账户登录 → 打开【系统标准配置】菜单，筛选指定配置项导出文件，导入项目现场。`);
  lines.push('请勿直接维护，请使用导入功能，防止出现维护错误。');
  lines.push('');
  lines.push('### 4. 新增代码表缓存配置');
  lines.push('');
  lines.push(`[信创标准环境](${STD_ENV_URL}) → 使用demo账户登录 → 打开【代码表缓存管理】，参照代码信息进行数据维护。`);
  lines.push('');
  if (impactRows.length > 0) {
    lines.push('## 三、功能变更影响表');
    lines.push('');
    lines.push('本期开发提交涉及以下功能变更，请相关岗位工作站负责人组织测试验证。');
    lines.push('');
    lines.push('| 岗位工作站 | 功能模组 | 功能模块 | 需求类型 | 提交人 | 仓库 | 改造功能点 |');
    lines.push('|-----------|---------|---------|---------|-------|------|-----------|');
    for (const r of impactRows) {
      lines.push(`| ${r.workstation} | ${r.funcModule} | ${r.funcPoint} | ${r.reqType} | ${r.author} | ${r.repo} | ${r.changePoint} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildEmailHtml(db, opts = {}) {
  const subject = `${SUBJECT}${opts.suffix || ''}`;
  const w = (db.meta && db.meta.window) || {};
  const range = w.since && w.until ? `${w.since} ~ ${w.until}` : (w.label || '');
  const rows = buildRows(db);
  const impactRows = opts.impactRows || [];

  const wrapStyle = 'max-width: 780px; margin: 0 auto; padding: 28px 32px 20px;'
    + " font-family: 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', Arial, sans-serif;"
    + ' font-size: 14px; color: #333333; line-height: 1.75; background: #ffffff;';
  const metaStyle = 'margin: 4px 0; font-size: 13px; color: #595959;';
  const h3Style = 'margin: 26px 0 12px; padding-left: 10px; font-size: 16px; color: #1f4e79;'
    + ' border-left: 4px solid #1f4e79; line-height: 1.4;';
  const h4Style = 'margin: 18px 0 6px; font-size: 14px; color: #333333;';
  const thStyle = 'border: 1px solid #d9d9d9; background: #f2f6fa; padding: 8px 10px;'
    + ' text-align: left; font-weight: bold; color: #1f4e79; white-space: nowrap;';
  const tdStyle = 'border: 1px solid #d9d9d9; padding: 8px 10px; vertical-align: top; word-break: break-all;';
  const impactThStyle = 'border: 1px solid #d9d9d9; background: #f2f6fa; padding: 6px 8px;'
    + ' text-align: left; font-weight: bold; color: #1f4e79; white-space: nowrap; font-size: 12px;';
  const impactTdStyle = 'border: 1px solid #d9d9d9; padding: 6px 8px; vertical-align: top; word-break: break-all; font-size: 12px;';

  let tableBlock;
  if (rows.length === 0) {
    tableBlock = '<p style="margin: 0 0 16px; color: #595959;">本期无数据变更。</p>';
  } else {
    const trs = rows
      .map(
        ([type, content, author]) =>
          `      <tr>\n`
          + `        <td style="${tdStyle}">${escapeHtml(type)}</td>\n`
          + `        <td style="${tdStyle}">${escapeHtml(content)}</td>\n`
          + `        <td style="${tdStyle}">${escapeHtml(author || '—')}</td>\n`
          + `      </tr>`
      )
      .join('\n');
    tableBlock = [
      `<table style="border-collapse: collapse; width: 100%; margin: 0 0 20px; font-size: 13px;">`,
      '    <thead>',
      '      <tr>',
      `        <th style="${thStyle}">变更类型</th>`,
      `        <th style="${thStyle}">变更内容</th>`,
      `        <th style="${thStyle}">变更负责人</th>`,
      '      </tr>',
      '    </thead>',
      '    <tbody>',
      trs,
      '    </tbody>',
      '  </table>'
    ].join('\n');
  }

  const lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="zh-CN">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push(`  <title>${escapeHtml(subject)}</title>`);
  lines.push('</head>');
  lines.push('<body style="margin: 0; padding: 0; background: #f5f6f8;">');
  lines.push(`  <div style="${wrapStyle}">`);
  lines.push(`    <h2 style="margin: 0 0 10px; padding-bottom: 10px; font-size: 20px; color: #1f4e79; border-bottom: 2px solid #1f4e79;">${escapeHtml(subject)}</h2>`);
  if (range) {
    lines.push(`    <p style="${metaStyle}">检测时间窗：${escapeHtml(range)}</p>`);
  }
  lines.push(`    <p style="${metaStyle}">生成时间：${cstNow()}</p>`);
  if (opts.note) {
    lines.push('    <p style="margin: 14px 0 0; padding: 10px 14px; background: #fff7e6; border-left: 4px solid #d48806; color: #613400;">'
      + `<strong>更正说明：</strong>${escapeHtml(opts.note)}</p>`);
  }
  lines.push('    <p style="margin: 14px 0 18px;">本期医生站开发提交中检测到以下数据库相关变更，请相关负责人参照第二章操作说明进行处理。</p>');
  lines.push('    <p style="margin: 0 0 18px;"><strong>说明：</strong>当前为试用运行阶段，更新阶段出现疑问可联系变更负责人咨询。</p>');
  lines.push('');
  lines.push(`    <h3 style="${h3Style}">一、变更明细</h3>`);
  lines.push(`  ${tableBlock}`);
  lines.push('');
  lines.push(`    <h3 style="${h3Style}">二、变更的操作说明</h3>`);
  lines.push(`    <h4 style="${h4Style}">1. 数据库 DDL 脚本</h4>`);
  lines.push(`    <p style="margin: 0 0 10px;">建议参考 <a href="${DDL_URL}" style="color: #1f4e79;">${escapeHtml(DDL_DOC_NAME)}</a> 的描述进行执行。</p>`);
  lines.push(`    <h4 style="${h4Style}">2. 新增系统标准提醒</h4>`);
  lines.push(`    <p style="margin: 0 0 10px;"><a href="${STD_ENV_URL}" style="color: #1f4e79;">信创标准环境</a> → 使用demo账户登录 → 打开菜单【系统提示信息】，参照代码信息进行数据维护。</p>`);
  lines.push(`    <h4 style="${h4Style}">3. 新增系统标准配置</h4>`);
  lines.push(`    <p style="margin: 0 0 10px;"><a href="${STD_ENV_URL}" style="color: #1f4e79;">信创标准环境</a> → 使用demo账户登录 → 打开【系统标准配置】菜单，筛选指定配置项导出文件，导入项目现场。<br>请勿直接维护，请使用导入功能，防止出现维护错误。</p>`);
  lines.push(`    <h4 style="${h4Style}">4. 新增代码表缓存配置</h4>`);
  lines.push(`    <p style="margin: 0 0 10px;"><a href="${STD_ENV_URL}" style="color: #1f4e79;">信创标准环境</a> → 使用demo账户登录 → 打开【代码表缓存管理】，参照代码信息进行数据维护。</p>`);
  lines.push('');
  if (impactRows.length > 0) {
    lines.push(`    <h3 style="${h3Style}">三、功能变更影响表</h3>`);
    lines.push(`    <p style="margin: 0 0 12px;">本期开发提交涉及以下功能变更，请相关岗位工作站负责人组织测试验证。</p>`);
    const impactTrs = impactRows
      .map((r) => `      <tr>
        <td style="${impactTdStyle}">${escapeHtml(r.workstation)}</td>
        <td style="${impactTdStyle}">${escapeHtml(r.funcModule)}</td>
        <td style="${impactTdStyle}">${escapeHtml(r.funcPoint)}</td>
        <td style="${impactTdStyle}">${escapeHtml(r.reqType)}</td>
        <td style="${impactTdStyle}">${escapeHtml(r.author)}</td>
        <td style="${impactTdStyle}">${escapeHtml(r.repo)}</td>
        <td style="${impactTdStyle}">${escapeHtml(r.changePoint)}</td>
      </tr>`)
      .join('\n');
    lines.push(`    <div style="overflow-x: auto;">`);
    lines.push(`    <table style="border-collapse: collapse; width: 100%; font-size: 12px;">`);
    lines.push('      <thead>');
    lines.push('        <tr>');
    lines.push(`          <th style="${impactThStyle}">岗位工作站</th>`);
    lines.push(`          <th style="${impactThStyle}">功能模组</th>`);
    lines.push(`          <th style="${impactThStyle}">功能模块</th>`);
    lines.push(`          <th style="${impactThStyle}">需求类型</th>`);
    lines.push(`          <th style="${impactThStyle}">提交人</th>`);
    lines.push(`          <th style="${impactThStyle}">仓库</th>`);
    lines.push(`          <th style="${impactThStyle}">改造功能点</th>`);
    lines.push('        </tr>');
    lines.push('      </thead>');
    lines.push('      <tbody>');
    lines.push(impactTrs);
    lines.push('      </tbody>');
    lines.push('    </table>');
    lines.push('    </div>');
    lines.push(`    <p style="margin: 8px 0 0; font-size: 11px; color: #999;">功能模块列基于静态映射，具体测试范围请结合实际变更确认。</p>`);
    lines.push('');
  }
  lines.push('    <p style="margin: 26px 0 0; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999999;">本邮件由医生站信创产品迭代周报流程自动生成，请勿直接回复。</p>');
  lines.push('  </div>');
  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const input = argv.find((a) => !a.startsWith('--'));
  if (!input) {
    console.error('Usage: node build-db-email.js <db-changes-<label>.json> [--note=<更正说明>] [--subject-suffix=<标题后缀>] [--evaluations=<evaluations-<label>.json>] [--raw-commits=<raw-commits-<label>.json>]');
    process.exit(1);
  }
  const opt = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length).trim() : '';
  };
  const opts = { note: opt('note'), suffix: opt('subject-suffix') };
  const db = JSON.parse(fs.readFileSync(input, 'utf8'));
  
  // 加载影响表数据
  const evalPath = opt('evaluations');
  const rawCommitsPath = opt('raw-commits');
  let impactRows = [];
  if (evalPath && fs.existsSync(evalPath)) {
    const evalsRaw = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
    const evalList = Array.isArray(evalsRaw) ? evalsRaw : (evalsRaw.commits || evalsRaw.evaluations || []);
    let rawCommits = null;
    if (rawCommitsPath && fs.existsSync(rawCommitsPath)) {
      const rawRaw = JSON.parse(fs.readFileSync(rawCommitsPath, 'utf8'));
      rawCommits = rawRaw.commits || (Array.isArray(rawRaw) ? rawRaw : []);
    }
    impactRows = buildImpactRows(evalList, rawCommits, {});
    opts.impactRows = impactRows;
  }
  
  const base = path.join(
    path.dirname(input),
    path.basename(input).replace(/^db-changes-/, 'db-change-email-').replace(/\.json$/, '')
  );
  fs.writeFileSync(`${base}.md`, buildEmailMd(db, opts), 'utf8');
  fs.writeFileSync(`${base}.html`, buildEmailHtml(db, opts), 'utf8');
  console.log(`邮件标题: ${SUBJECT}${opts.suffix}`);
  console.log(`正文文件(MD): ${base}.md`);
  console.log(`正文文件(HTML): ${base}.html`);
  console.log(`变更行数: ${buildRows(db).length}`);
  if (impactRows.length > 0) {
    console.log(`影响表行数: ${impactRows.length}`);
  }
}

main();
