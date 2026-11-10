#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUBJECT = '信创版功能及数据变更通知';
const DDL_URL = 'https://docs.qq.com/sheet/DSnJ5V0tYRG9jT1VL?tab=ipn52r';
const DDL_DOC_NAME = '【腾讯文档】信创版HIS数据库升级脚本汇总表格';
const STD_ENV_URL = 'http://82.156.104.202:32678/imedical/his/hos/login';
const STD_ENV_NAME = '信创标准环境';

const BACKGROUND_TEXT = '为尽量减少发版可能引发的业务中断等系统问题，医生站结合本阶段代码提交，对可能受影响的业务场景进行推演，推演结果见本邮件。受各组仓库隔离、业务复杂等因素限制，推演覆盖范围无法涵盖全部实际影响范围，仅作为项目组已有测试用例的补充，不能替代项目组设计的正式测试场景。';
const GOAL_TEXT = '请协调对应负责人在版本部署到正式库前，务必完成相关业务场景测试。医生站测试用例库与推演邮件将持续完善，感谢各位的理解与配合。';
const READING_GUIDE = '本期邮件分为功能变更影响与数据变更两部分：功能变更请按第一章各条目的测试方式建议组织验证；数据变更请按第二章 2.2 操作说明维护。当前为试用运行阶段，更新阶段如有疑问可联系变更负责人。';

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

const EMERGENCY_WORKSTATION = '门急诊应急医师工作站';

function determineWorkstation(repo, system, ev) {
  const subject = (ev && ev.subject) || '';
  if (subject.includes('[信创门急诊应急系统]')) return EMERGENCY_WORKSTATION;
  if (ev && ev.workstation === EMERGENCY_WORKSTATION) return EMERGENCY_WORKSTATION;
  if (system && SYSTEM_TO_WORKSTATION[system]) return SYSTEM_TO_WORKSTATION[system];
  if (repo.includes('opcare') || repo.includes('opreg') || repo.includes('opalloc')) return '门诊诊疗医师工作站';
  if (repo.includes('ipcare')) return '住院诊疗医师工作站';
  if (repo.includes('curc')) return '康复治疗科室工作站';
  if (repo.includes('cf/') || repo.includes('ct/')) return '诊疗配置工作站';
  return '（未分类）';
}

function impactPrefix(r) {
  return r && r.impactRating ? `[${r.impactRating}★] ` : '';
}

function buildRatingSummary(rows) {
  const counts = {};
  for (const r of rows) counts[r.impactRating] = (counts[r.impactRating] || 0) + 1;
  return [5, 4, 3, 2, 1]
    .filter((k) => counts[k])
    .map((k) => `${k}★ ${counts[k]} 项`)
    .join('、');
}

function determineModule(ev, mapping) {
  const text = `${ev.funcPoint || ''} ${ev.impactScope || ''} ${ev.summary || ''}`;
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
  const rows = evaluations.map((ev) => {
    const system = REPO_TO_SYSTEM[ev.repo] || '（未分类）';
    const workstation = determineWorkstation(ev.repo, system, ev);
    const funcModule = determineModule(ev, mapping);
    const funcPoint = ev.funcPoint || ev.impactScope || ev.subject || '（待分析）';
    return {
      workstation,
      funcModule,
      funcPoint,
      impactRating: Number(ev.impactRating) || 0,
      impactRatingReason: ev.impactRatingReason || '',
      reqType: ev.reqType || '代码变更',
      author: ev.author || '—',
      repo: ev.repo || '—',
      changePoint: ev.changeSummary || ev.evaluation || ev.impactScope || '—',
      testSuggestion: ev.testSuggestion || '（待评估环节补充）'
    };
  });
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.impactRating - a.r.impactRating || a.i - b.i)
    .map(({ r }) => r);
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
    if (g.unresolved) content += '（提醒码前缀常量未能自动解析，完整前缀见同批次周报该提交明细）';
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

const TIP_LABELS = ['【必测】', '【回归】', '【联调】', '【边界】'];

function emphasizeTipMd(text) {
  let s = String(text == null ? '' : text);
  for (const label of TIP_LABELS) s = s.split(label).join(`**${label}**`);
  return s;
}

function emphasizeTipHtml(text) {
  let s = escapeHtml(text);
  for (const label of TIP_LABELS) {
    s = s.split(label).join(`<strong style="color: #1f4e79;">${label}</strong>`);
  }
  return s;
}

function cstNow() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+8)';
}

function splitSuggestions(s) {
  if (!s) return [];
  const text = String(s).replace(/\r\n?/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  const parts = text.split(/(【必测】|【回归】|【联调】|【边界】)/).filter((x) => x && x.trim());
  const out = [];
  for (const part of parts) {
    if (TIP_LABELS.includes(part)) out.push(part);
    else if (out.length > 0 && TIP_LABELS.includes(out[out.length - 1])) out[out.length - 1] += part;
    else out.push(part);
  }
  return out.map((x) => normalizeTip(x)).filter(Boolean);
}

function normalizeTip(tip) {
  const lines = String(tip).split('\n').map((x) => x.trim().replace(/[；;]+$/, '')).filter(Boolean);
  return lines.join('\n');
}

function tipLayout(tip) {
  const chunks = String(tip).split(/[\n；]/).map((x) => x.trim()).filter(Boolean);
  const tag = TIP_LABELS.find((label) => chunks[0] && chunks[0].startsWith(label));
  if (!tag) return { tag: '', items: chunks };
  const rest = chunks[0].slice(tag.length).trim();
  return { tag, items: rest ? [rest, ...chunks.slice(1)] : chunks.slice(1) };
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
  lines.push('## 背景与目标');
  lines.push('');
  lines.push(`**背景：**${BACKGROUND_TEXT}`);
  lines.push('');
  lines.push(`**目标：**${GOAL_TEXT}`);
  lines.push('');
  lines.push(`**阅读说明：**${READING_GUIDE}`);
  lines.push('');
  if (impactRows.length > 0) {
    lines.push('## 一、功能变更影响');
    lines.push('');
    lines.push(`本期共 ${impactRows.length} 项功能变更，按影响范围从大到小排列（${buildRatingSummary(impactRows)}）。`);
    lines.push('');
    lines.push('影响范围评级说明（假设该功能发生严重故障时的业务波及面）：[5★] 核心业务阻断并形成大批量积压；[4★] 核心业务严重受阻、需靠手工或备用入口绕行；[3★] 单一核心模块受控中断；[2★] 非核心业务受影响；[1★] 几乎无业务感知。');
    lines.push('');
    impactRows.forEach((r, i) => {
      lines.push(`### ${i + 1}. ${impactPrefix(r)}${r.funcPoint}`);
      lines.push('');
      lines.push(`- **岗位工作站：** ${r.workstation}`);
      if (r.funcModule && r.funcModule !== '（待确认）') {
        lines.push(`- **功能模组：** ${r.funcModule}`);
      }
      lines.push(`- **需求类型：** ${r.reqType}`);
      lines.push(`- **提交人：** ${r.author}`);
      lines.push(`- **仓库：** ${r.repo}`);
      lines.push('');
      lines.push('**改造方案：**');
      lines.push('');
      lines.push(r.changePoint);
      lines.push('');
      const tips = splitSuggestions(r.testSuggestion);
      lines.push('**测试方式建议：**');
      lines.push('');
      if (tips.length > 0) {
        tips.forEach((t, idx) => {
          const { tag, items } = tipLayout(t);
          const tail = idx < tips.length - 1 ? '  ' : '';
          if (items.length > 1) {
            if (tag) lines.push(`${emphasizeTipMd(tag)}${tail}`);
            for (const item of items) lines.push(`  - ${item.replace(/[。；;]+$/, '')}${tail}`);
          } else {
            lines.push(`${emphasizeTipMd(`${tag}${items[0] || ''}`)}${tail}`);
          }
        });
      } else {
        lines.push(emphasizeTipMd(r.testSuggestion));
      }
      lines.push('');
    });
  }
  lines.push('## 二、数据变更');
  lines.push('');
  if (rows.length > 0) {
    lines.push(`本期数据变更共 ${rows.length} 项，请按 2.2 操作说明完成维护。`);
    lines.push('');
  }
  lines.push('### 2.1 数据变更明细');
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
  lines.push('### 2.2 数据变更操作说明');
  lines.push('');
  lines.push('#### 1. 数据库 DDL 脚本');
  lines.push('');
  lines.push(`建议参考${DDL_DOC_NAME} ${DDL_URL} 的描述进行执行。`);
  lines.push('');
  lines.push('#### 2. 新增系统标准提醒');
  lines.push('');
  lines.push(`[信创标准环境](${STD_ENV_URL}) → 使用demo账户登录 → 打开菜单【系统提示信息】，参照代码信息进行数据维护。`);
  lines.push('');
  lines.push('#### 3. 新增系统标准配置');
  lines.push('');
  lines.push(`[信创标准环境](${STD_ENV_URL}) → 使用demo账户登录 → 打开【系统标准配置】菜单，筛选指定配置项导出文件，导入项目现场。`);
  lines.push('请勿直接维护，请使用导入功能，防止出现维护错误。');
  lines.push('');
  lines.push('#### 4. 新增代码表缓存配置');
  lines.push('');
  lines.push(`[信创标准环境](${STD_ENV_URL}) → 使用demo账户登录 → 打开【代码表缓存管理】，参照代码信息进行数据维护。`);
  lines.push('');
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
  const impactLabelStyle = 'display: inline-block; min-width: 90px; font-weight: bold; color: #555;';
  const impactLabelNarrowStyle = 'display: inline-block; min-width: 60px; font-weight: bold; color: #555;';

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
  lines.push(`    <h3 style="${h3Style}">背景与目标</h3>`);
  lines.push('    <div style="margin: 0 0 22px; padding: 14px 16px; background: #f5f8fc; border-left: 4px solid #1f4e79;">');
  lines.push(`      <p style="margin: 0 0 9px;"><strong>背景：</strong>${escapeHtml(BACKGROUND_TEXT)}</p>`);
  lines.push(`      <p style="margin: 0 0 9px;"><strong>目标：</strong>${escapeHtml(GOAL_TEXT)}</p>`);
  lines.push(`      <p style="margin: 0;"><strong>阅读说明：</strong>${escapeHtml(READING_GUIDE)}</p>`);
  lines.push('    </div>');
  lines.push('');
  if (impactRows.length > 0) {
    lines.push(`    <h3 style="${h3Style}">一、功能变更影响</h3>`);
    lines.push(`    <p style="margin: 0 0 8px; font-size: 13px; color: #333333;">本期共 ${impactRows.length} 项功能变更，按影响范围从大到小排列（${escapeHtml(buildRatingSummary(impactRows))}）。</p>`);
    lines.push('    <p style="margin: 0 0 14px; font-size: 13px; color: #595959;">影响范围评级说明（假设该功能发生严重故障时的业务波及面）：[5★] 核心业务阻断并形成大批量积压；[4★] 核心业务严重受阻、需靠手工或备用入口绕行；[3★] 单一核心模块受控中断；[2★] 非核心业务受影响；[1★] 几乎无业务感知。</p>');
    impactRows.forEach((r, i) => {
      lines.push(`    <h4 style="${h4Style}">${i + 1}. ${escapeHtml(impactPrefix(r) + r.funcPoint)}</h4>`);
      const leftFields = [
        ['岗位工作站', r.workstation],
        ...(r.funcModule && r.funcModule !== '（待确认）' ? [['功能模组', r.funcModule]] : []),
        ['需求类型', r.reqType],
      ];
      const rightFields = [['提交人', r.author], ['仓库', r.repo]];
      lines.push('    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin: 2px 0;">');
      lines.push('      <tr>');
      lines.push('        <td style="width: 50%; padding: 2px 12px 2px 16px; vertical-align: top;">');
      for (const [label, value] of leftFields) {
        lines.push(`          <p style="margin: 2px 0;"><span style="${impactLabelStyle}">${label}：</span>${escapeHtml(value)}</p>`);
      }
      lines.push('        </td>');
      lines.push('        <td style="width: 50%; padding: 2px 0; vertical-align: top; word-break: normal; overflow-wrap: break-word;">');
      for (const [label, value] of rightFields) {
        lines.push(`          <p style="margin: 2px 0;"><span style="${impactLabelNarrowStyle}">${label}：</span>${escapeHtml(value)}</p>`);
      }
      lines.push('        </td>');
      lines.push('      </tr>');
      lines.push('    </table>');
      lines.push(`    <p style="margin: 8px 0 2px 16px;"><span style="${impactLabelStyle}">改造方案：</span></p>`);
      lines.push(`    <p style="margin: 2px 0 2px 16px;">${escapeHtml(r.changePoint)}</p>`);
      const tips = splitSuggestions(r.testSuggestion);
      lines.push(`    <p style="margin: 8px 0 2px 16px;"><span style="${impactLabelStyle}">测试方式建议：</span></p>`);
      if (tips.length > 0) {
        for (const t of tips) {
          const { tag, items } = tipLayout(t);
          if (items.length > 1) {
            if (tag) lines.push(`    <p style="margin: 2px 0 2px 16px;">${emphasizeTipHtml(tag)}</p>`);
            for (const item of items) {
              const text = emphasizeTipHtml(item.replace(/[。；;]+$/, ''));
              lines.push(`    <p style="margin: 2px 0 2px 30px;"><span style="color: #8c8c8c;">·</span> ${text}</p>`);
            }
          } else {
            lines.push(`    <p style="margin: 2px 0 2px 16px;">${emphasizeTipHtml(`${tag}${items[0] || ''}`)}</p>`);
          }
        }
      } else {
        lines.push(`    <p style="margin: 2px 0 2px 16px;">${emphasizeTipHtml(r.testSuggestion)}</p>`);
      }
      lines.push('');
    });
  }
  lines.push(`    <h3 style="${h3Style}">二、数据变更</h3>`);
  if (rows.length > 0) {
    lines.push(`    <p style="margin: 0 0 14px; font-size: 13px; color: #333333;">本期数据变更共 ${rows.length} 项，请按 2.2 操作说明完成维护。</p>`);
  }
  lines.push(`    <h4 style="${h4Style}">2.1 数据变更明细</h4>`);
  lines.push(`  ${tableBlock}`);
  lines.push('');
  lines.push(`    <h4 style="${h4Style}">2.2 数据变更操作说明</h4>`);
  lines.push(`    <p style="margin: 0 0 6px; font-size: 13px; font-weight: bold; color: #333;">1. 数据库 DDL 脚本</p>`);
  lines.push(`    <p style="margin: 0 0 10px;">建议参考 <a href="${DDL_URL}" style="color: #1f4e79;">${escapeHtml(DDL_DOC_NAME)}</a> 的描述进行执行。</p>`);
  lines.push(`    <p style="margin: 0 0 6px; font-size: 13px; font-weight: bold; color: #333;">2. 新增系统标准提醒</p>`);
  lines.push(`    <p style="margin: 0 0 10px;"><a href="${STD_ENV_URL}" style="color: #1f4e79;">信创标准环境</a> → 使用demo账户登录 → 打开菜单【系统提示信息】，参照代码信息进行数据维护。</p>`);
  lines.push(`    <p style="margin: 0 0 6px; font-size: 13px; font-weight: bold; color: #333;">3. 新增系统标准配置</p>`);
  lines.push(`    <p style="margin: 0 0 10px;"><a href="${STD_ENV_URL}" style="color: #1f4e79;">信创标准环境</a> → 使用demo账户登录 → 打开【系统标准配置】菜单，筛选指定配置项导出文件，导入项目现场。<br>请勿直接维护，请使用导入功能，防止出现维护错误。</p>`);
  lines.push(`    <p style="margin: 0 0 6px; font-size: 13px; font-weight: bold; color: #333;">4. 新增代码表缓存配置</p>`);
  lines.push(`    <p style="margin: 0 0 10px;"><a href="${STD_ENV_URL}" style="color: #1f4e79;">信创标准环境</a> → 使用demo账户登录 → 打开【代码表缓存管理】，参照代码信息进行数据维护。</p>`);
  lines.push('');
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
