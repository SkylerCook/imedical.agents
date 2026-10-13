#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUBJECT = '信创版数据变更通知-医生站';
const DDL_URL = 'https://docs.qq.com/sheet/DSnJ5V0tYRG9jT1VL?tab=ipn52r';
const DDL_DOC_NAME = '【腾讯文档】信创版HIS数据库升级脚本汇总表格';

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
    rows.push(['新增系统标准配置', `${it.stCode || it.stCodeRaw} / ${it.itemCode}`, it.author]);
  }
  for (const r of db.reminders || []) {
    const code = r.resolvedCode || `${r.expr}+${r.codeSuffix}`;
    rows.push(['新增系统标准提醒', r.message ? `${code}（${r.message}）` : code, r.author]);
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

function buildEmailMd(db) {
  const w = (db.meta && db.meta.window) || {};
  const range = w.since && w.until ? `${w.since} ~ ${w.until}` : (w.label || '');
  const rows = buildRows(db);
  const lines = [];
  lines.push(`# ${SUBJECT}`);
  lines.push('');
  if (range) {
    lines.push(`> 检测时间窗：${range}`);
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
  lines.push('公司标准库 demo → 打开菜单【系统提醒信息】，参照代码信息进行数据维护。');
  lines.push('');
  lines.push('### 3. 新增系统标准配置');
  lines.push('');
  lines.push('公司标准库 demo → 打开【系统标准配置】菜单，筛选指定配置项导出，导入项目现场。请勿直接维护，请使用导入功能，防止出现维护错误。');
  lines.push('');
  lines.push('### 4. 新增代码表缓存配置');
  lines.push('');
  lines.push('公司标准库 demo → 打开【代码表缓存管理】，参照代码信息进行数据维护。');
  lines.push('');
  return lines.join('\n');
}

function buildEmailHtml(db) {
  const w = (db.meta && db.meta.window) || {};
  const range = w.since && w.until ? `${w.since} ~ ${w.until}` : (w.label || '');
  const rows = buildRows(db);

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
  lines.push(`  <title>${escapeHtml(SUBJECT)}</title>`);
  lines.push('</head>');
  lines.push('<body style="margin: 0; padding: 0; background: #f5f6f8;">');
  lines.push(`  <div style="${wrapStyle}">`);
  lines.push(`    <h2 style="margin: 0 0 10px; padding-bottom: 10px; font-size: 20px; color: #1f4e79; border-bottom: 2px solid #1f4e79;">${escapeHtml(SUBJECT)}</h2>`);
  if (range) {
    lines.push(`    <p style="${metaStyle}">检测时间窗：${escapeHtml(range)}</p>`);
  }
  lines.push(`    <p style="${metaStyle}">生成时间：${cstNow()}</p>`);
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
  lines.push('    <p style="margin: 0 0 10px;">公司标准库 demo → 打开菜单【系统提醒信息】，参照代码信息进行数据维护。</p>');
  lines.push(`    <h4 style="${h4Style}">3. 新增系统标准配置</h4>`);
  lines.push('    <p style="margin: 0 0 10px;">公司标准库 demo → 打开【系统标准配置】菜单，筛选指定配置项导出，导入项目现场。请勿直接维护，请使用导入功能，防止出现维护错误。</p>');
  lines.push(`    <h4 style="${h4Style}">4. 新增代码表缓存配置</h4>`);
  lines.push('    <p style="margin: 0 0 10px;">公司标准库 demo → 打开【代码表缓存管理】，参照代码信息进行数据维护。</p>');
  lines.push('');
  lines.push('    <p style="margin: 26px 0 0; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999999;">本邮件由医生站信创产品迭代周报流程自动生成，请勿直接回复。</p>');
  lines.push('  </div>');
  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node build-db-email.js <db-changes-<label>.json>');
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(input, 'utf8'));
  const base = path.join(
    path.dirname(input),
    path.basename(input).replace(/^db-changes-/, 'db-change-email-').replace(/\.json$/, '')
  );
  fs.writeFileSync(`${base}.md`, buildEmailMd(db), 'utf8');
  fs.writeFileSync(`${base}.html`, buildEmailHtml(db), 'utf8');
  console.log(`邮件标题: ${SUBJECT}`);
  console.log(`正文文件(MD): ${base}.md`);
  console.log(`正文文件(HTML): ${base}.html`);
  console.log(`变更行数: ${buildRows(db).length}`);
}

main();
