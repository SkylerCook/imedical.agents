#!/usr/bin/env node
'use strict';

/**
 * 功能变更影响表生成器
 * 
 * 输入：evaluations-<label>.json + it-shape-mapping.json
 * 输出：impact-table-<label>.html（邮件附件）
 * 
 * 列：岗位工作站 / 功能模组 / 功能模块 / 需求类型 / 提交人 / 仓库 / 改造功能点
 */

const fs = require('fs');
const path = require('path');

// 仓库 → 系统（归属）映射
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

// 系统 → 岗位工作站映射（从 Sheet ③ 提取）
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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadMapping(mappingPath) {
  if (!fs.existsSync(mappingPath)) {
    console.warn(`警告：映射文件不存在 ${mappingPath}，将使用简化映射`);
    return { classToModule: [], moduleToWorkstation: [], moduleDetails: [] };
  }
  return JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
}

function extractClassName(filePath) {
  // 从文件路径提取 Java 类名
  const match = filePath.match(/([^/]+)\.java$/);
  return match ? match[1] : null;
}

function findModuleByClassName(className, classToModule) {
  if (!className) return null;
  // 精确匹配
  const exact = classToModule.find((m) => m.className === className);
  if (exact) return exact;
  // 模糊匹配（类名包含关键字）
  const fuzzy = classToModule.find((m) => className.includes(m.className) || m.className.includes(className));
  return fuzzy || null;
}

function findModuleByFilePath(filePath, moduleDetails) {
  if (!filePath) return null;
  // 从文件路径提取关键字，尝试匹配模块
  const keywords = filePath.split('/').filter((s) => s && !s.endsWith('.java'));
  for (const kw of keywords) {
    const match = moduleDetails.find((m) => {
      const vn = (m.versionName || '').toLowerCase();
      const mn = (m.moduleName || '').toLowerCase();
      return vn && (kw.toLowerCase().includes(vn) || vn.includes(kw.toLowerCase()));
    });
    if (match) return match;
  }
  return null;
}

function determineWorkstation(repo, system) {
  // 优先从系统映射
  if (system && SYSTEM_TO_WORKSTATION[system]) {
    return SYSTEM_TO_WORKSTATION[system];
  }
  // 回退：从仓库名推断
  if (repo.includes('opcare') || repo.includes('opreg') || repo.includes('opalloc')) {
    return '门诊诊疗医师工作站';
  }
  if (repo.includes('ipcare')) {
    return '住院诊疗医师工作站';
  }
  if (repo.includes('curc')) {
    return '康复治疗科室工作站';
  }
  if (repo.includes('cf/') || repo.includes('ct/')) {
    return '诊疗配置工作站';
  }
  return '（未分类）';
}

function determineModule(evalItem, mapping) {
  const { classToModule, moduleToWorkstation, moduleDetails } = mapping;
  
  // 尝试从 changed files 提取类名并匹配
  if (evalItem.files && evalItem.files.length > 0) {
    for (const file of evalItem.files) {
      const className = extractClassName(file.path);
      const moduleMatch = findModuleByClassName(className, classToModule);
      if (moduleMatch) {
        return {
          moduleName: moduleMatch.module,
          source: 'class-name-match'
        };
      }
    }
    // 尝试从文件路径匹配
    for (const file of evalItem.files) {
      const detailMatch = findModuleByFilePath(file.path, moduleDetails);
      if (detailMatch) {
        return {
          moduleName: detailMatch.workstationModule || detailMatch.moduleName,
          source: 'path-match'
        };
      }
    }
  }
  
  // 回退：从 impactScope 或 summary 推断
  const text = `${evalItem.impactScope || ''} ${evalItem.summary || ''}`;
  if (text.includes('医嘱')) return { moduleName: '医嘱录入', source: 'keyword' };
  if (text.includes('诊断')) return { moduleName: '诊断录入', source: 'keyword' };
  if (text.includes('检验') || text.includes('检查')) return { moduleName: '检验检查申请', source: 'keyword' };
  if (text.includes('病历')) return { moduleName: '病历文书', source: 'keyword' };
  if (text.includes('配置')) return { moduleName: '常用维护', source: 'keyword' };
  
  return { moduleName: '（待确认）', source: 'fallback' };
}

function generateTestSuggestion(ev) {
  const text = `${ev.impactScope || ''} ${ev.summary || ''} ${ev.reqType || ''}`;
  const suggestions = [];
  
  // 基础测试（最低限度）
  suggestions.push('【必测】验证变更功能点正常');
  
  // 根据需求类型补充
  if (ev.reqType === '流程修改') {
    suggestions.push('完整流程走通（从入口到结束）');
  } else if (ev.reqType === '业务调整') {
    suggestions.push('配置生效验证（新配置/旧配置对比）');
  }
  
  // 根据关键字补充测试范围
  if (text.includes('医嘱')) {
    suggestions.push('医嘱录入/修改/撤销/提交');
    if (text.includes('模板')) suggestions.push('医嘱模板调用');
    if (text.includes('草药') || text.includes('中药')) suggestions.push('草药医嘱专项流程');
    if (text.includes('出院') || text.includes(' discharge')) suggestions.push('出院带药医嘱');
  }
  if (text.includes('诊断')) {
    suggestions.push('诊断录入/修改/删除');
    if (text.includes('主诊断')) suggestions.push('主诊断切换');
  }
  if (text.includes('检验') || text.includes('检查')) {
    suggestions.push('检验检查申请/报告查看');
  }
  if (text.includes('病历')) {
    suggestions.push('病历文书生成/查看/打印');
  }
  if (text.includes('配置') || text.includes('config')) {
    suggestions.push('系统标准配置菜单验证');
    suggestions.push('配置项导出/导入流程');
  }
  if (text.includes('排班')) {
    suggestions.push('排班查询/预约/取消');
    if (text.includes('停诊')) suggestions.push('停诊自动取消预约流程');
  }
  if (text.includes('挂号')) {
    suggestions.push('挂号/退号流程');
    if (text.includes('年龄') || text.includes('外来')) suggestions.push('特殊人群挂号校验');
  }
  if (text.includes('医保') || text.includes('处方')) {
    suggestions.push('医保处方提交');
    suggestions.push('自费原因字段验证');
  }
  if (text.includes('打印')) {
    suggestions.push('打印模板/打印预览');
  }
  if (text.includes('提醒') || text.includes('警告') || text.includes('拦截')) {
    suggestions.push('触发条件验证（应提醒/不应提醒）');
  }
  if (text.includes('缓存') || text.includes('cache')) {
    suggestions.push('代码表缓存刷新验证');
  }
  if (text.includes('前端') || text.includes('页面') || text.includes('界面')) {
    suggestions.push('前端页面功能验证');
    suggestions.push('浏览器兼容性（Chrome/Edge）');
  }
  
  // 关联影响提示
  if (text.includes('跨仓库') || text.includes('接口') || text.includes('Feign')) {
    suggestions.push('⚠️ 跨模块联调（上下游接口）');
  }
  if (ev.rating && ev.rating <= 2) {
    suggestions.push('⚠️ 低风险提交，重点关注边界场景');
  }
  
  // 去重并拼接
  const unique = [...new Set(suggestions)];
  return unique.join('；');
}

function mergeFilesIntoEvals(evaluations, rawCommits) {
  if (!rawCommits) return evaluations;
  const filesByHash = {};
  for (const c of rawCommits) {
    if (c.hash && c.files) filesByHash[c.hash] = c.files;
  }
  return evaluations.map((ev) => ({
    ...ev,
    files: ev.files || filesByHash[ev.hash] || []
  }));
}

function buildImpactRows(evaluations, mapping) {
  const rows = [];
  
  for (const ev of evaluations) {
    const system = REPO_TO_SYSTEM[ev.repo] || '（未分类）';
    const workstation = determineWorkstation(ev.repo, system);
    const moduleInfo = determineModule(ev, mapping);
    const funcModule = moduleInfo.moduleName;
    
    // 功能模块：从 impactScope 提取，或标记为待分析
    const funcPoint = ev.impactScope || ev.summary || '（待分析）';
    
    rows.push({
      workstation,
      funcModule,
      funcPoint,
      reqType: ev.reqType || '代码变更',
      author: ev.author || '—',
      repo: ev.repo || '—',
      changePoint: ev.summary || '—',
      testSuggestion: generateTestSuggestion(ev)
    });
  }
  
  return rows;
}

function buildImpactHtml(rows, opts = {}) {
  const thStyle = 'border: 1px solid #d9d9d9; background: #f2f6fa; padding: 8px 10px;'
    + ' text-align: left; font-weight: bold; color: #1f4e79; white-space: nowrap;';
  const tdStyle = 'border: 1px solid #d9d9d9; padding: 8px 10px; vertical-align: top; word-break: break-all;';
  const wrapStyle = 'max-width: 1200px; margin: 0 auto; padding: 20px;'
    + " font-family: 'Microsoft YaHei', 'PingFang SC', Arial, sans-serif;"
    + ' font-size: 13px; color: #333333; line-height: 1.6; background: #ffffff;';

  const trs = rows.map((r) => `      <tr>
        <td style="${tdStyle}">${escapeHtml(r.workstation)}</td>
        <td style="${tdStyle}">${escapeHtml(r.funcModule)}</td>
        <td style="${tdStyle}">${escapeHtml(r.funcPoint)}</td>
        <td style="${tdStyle}">${escapeHtml(r.reqType)}</td>
        <td style="${tdStyle}">${escapeHtml(r.author)}</td>
        <td style="${tdStyle}">${escapeHtml(r.repo)}</td>
        <td style="${tdStyle}">${escapeHtml(r.changePoint)}</td>
        <td style="${tdStyle}">${escapeHtml(r.testSuggestion)}</td>
      </tr>`).join('\n');

  const lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="zh-CN">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push(`  <title>${escapeHtml(opts.title || '功能变更影响表')}</title>`);
  lines.push('</head>');
  lines.push('<body style="margin: 0; padding: 0; background: #f5f6f8;">');
  lines.push(`  <div style="${wrapStyle}">`);
  lines.push(`    <h2 style="margin: 0 0 16px; padding-bottom: 10px; font-size: 18px; color: #1f4e79; border-bottom: 2px solid #1f4e79;">${escapeHtml(opts.title || '功能变更影响表')}</h2>`);
  if (opts.range) {
    lines.push(`    <p style="margin: 0 0 12px; font-size: 12px; color: #666;">检测时间窗：${escapeHtml(opts.range)}</p>`);
  }
  lines.push(`    <p style="margin: 0 0 16px; font-size: 12px; color: #666;">生成时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')} (UTC+8)</p>`);
  lines.push('    <p style="margin: 0 0 16px;">本期医生站开发提交涉及以下功能变更，请相关岗位工作站负责人组织测试验证。</p>');
  lines.push(`    <table style="border-collapse: collapse; width: 100%; font-size: 12px;">`);
  lines.push('      <thead>');
  lines.push('        <tr>');
  lines.push(`          <th style="${thStyle}">岗位工作站</th>`);
  lines.push(`          <th style="${thStyle}">功能模组</th>`);
  lines.push(`          <th style="${thStyle}">功能模块</th>`);
  lines.push(`          <th style="${thStyle}">需求类型</th>`);
  lines.push(`          <th style="${thStyle}">提交人</th>`);
  lines.push(`          <th style="${thStyle}">仓库</th>`);
  lines.push(`          <th style="${thStyle}">改造功能点</th>`);
  lines.push(`          <th style="${thStyle}">测试方式建议</th>`);
  lines.push('        </tr>');
  lines.push('      </thead>');
  lines.push('      <tbody>');
  lines.push(trs);
  lines.push('      </tbody>');
  lines.push('    </table>');
  lines.push('    <p style="margin: 20px 0 0; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #999;">本表由医生站信创产品迭代周报流程自动生成，功能模块列基于静态映射，具体测试范围请结合实际变更确认。</p>');
  lines.push('  </div>');
  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const evalInput = argv.find((a) => !a.startsWith('--'));
  if (!evalInput) {
    console.error('Usage: node build-impact-table.js <evaluations-<label>.json> [--raw-commits=<raw-commits-<label>.json>] [--mapping=<it-shape-mapping.json>] [--title=<标题>]');
    process.exit(1);
  }
  
  const opt = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length).trim() : '';
  };
  
  const mappingPath = opt('mapping') || path.join(__dirname, '../config/it-shape-mapping.json');
  const rawCommitsPath = opt('raw-commits');
  const title = opt('title') || '功能变更影响表';
  
  const evaluationsRaw = JSON.parse(fs.readFileSync(evalInput, 'utf8'));
  const mapping = loadMapping(mappingPath);
  
  // 如果 evaluations 是数组，直接使用；如果是对象且有 commits 字段，取 commits
  let evalList = Array.isArray(evaluationsRaw) ? evaluationsRaw : (evaluationsRaw.commits || evaluationsRaw.evaluations || []);
  
  // 合并 raw-commits 的 files 信息
  let rawCommits = null;
  let meta = {};
  if (rawCommitsPath && fs.existsSync(rawCommitsPath)) {
    const rawRaw = JSON.parse(fs.readFileSync(rawCommitsPath, 'utf8'));
    rawCommits = rawRaw.commits || (Array.isArray(rawRaw) ? rawRaw : []);
    meta = rawRaw.meta || {};
    evalList = mergeFilesIntoEvals(evalList, rawCommits);
  }
  
  const w = meta.window || {};
  const range = w.since && w.until ? `${w.since} ~ ${w.until}` : (w.label || '');
  
  const rows = buildImpactRows(evalList, mapping);
  
  // 输出文件名：与 evaluations 同目录，impact-table-<label>.html
  const base = path.join(
    path.dirname(evalInput),
    path.basename(evalInput).replace(/^evaluations-/, 'impact-table-').replace(/\.json$/, '')
  );
  const outputPath = `${base}.html`;
  
  fs.writeFileSync(outputPath, buildImpactHtml(rows, { title, range }), 'utf8');
  
  console.log(`影响表标题: ${title}`);
  console.log(`输出文件: ${outputPath}`);
  console.log(`影响行数: ${rows.length}`);
  if (range) console.log(`时间窗: ${range}`);
  
  // 统计各工作站分布
  const byWorkstation = {};
  for (const r of rows) {
    byWorkstation[r.workstation] = (byWorkstation[r.workstation] || 0) + 1;
  }
  console.log('工作站分布:', JSON.stringify(byWorkstation, null, 2));
}

main();
