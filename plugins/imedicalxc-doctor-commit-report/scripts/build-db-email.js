#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUBJECT = '信创版数据变更通知-医生站';
const DDL_URL = 'https://docs.qq.com/sheet/DSnJ5V0tYRG9jT1VL?tab=ipn52r';

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
    rows.push(['新增代码表缓存配置', `${cc.poClass}.${cc.method}${cc.firstUse ? '（首次使用）' : ''}`, cc.author]);
  }
  return rows;
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
  lines.push(`建议参考【腾讯文档】信创版HIS数据库升级脚本汇总表格 ${DDL_URL} 的描述进行执行。`);
  lines.push('');
  lines.push('### 2. 新增系统标准提醒');
  lines.push('');
  lines.push('公司标准库 demo → 打开菜单【系统提醒信息】，参照代码信息进行数据维护。');
  lines.push('');
  lines.push('### 3. 新增系统标准配置');
  lines.push('');
  lines.push('公司标准库 demo → 打开【系统标准配置】菜单，筛选指定配置项导出，导入项目现场。');
  lines.push('');
  lines.push('### 4. 新增代码表缓存配置');
  lines.push('');
  lines.push('公司标准库 demo → 打开【代码表缓存管理】，参照代码信息进行数据维护。');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node build-db-email.js <db-changes-<label>.json>');
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(input, 'utf8'));
  const md = buildEmailMd(db);
  const outPath = path.join(
    path.dirname(input),
    path.basename(input).replace(/^db-changes-/, 'db-change-email-').replace(/\.json$/, '.md')
  );
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`邮件标题: ${SUBJECT}`);
  console.log(`正文文件: ${outPath}`);
  console.log(`变更行数: ${buildRows(db).length}`);
}

main();
