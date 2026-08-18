#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MIN_NODE = [22, 5, 0];
const FORM_TYPES = new Set(['CA', 'CR']);
const REMOTE_CHUNK_SIZE = 12000;
const MAX_REMOTE_RESULT_LENGTH = 5 * 1024 * 1024;
const MAX_INLINE_SERVER_ARGUMENT = 8000;
const DOCUMENT_SOURCE_EXTENSIONS = new Set(['.doc', '.docx', '.pdf', '.xls', '.xlsx']);
const COMMANDS = new Set([
  'doctor', 'intake', 'inspect', 'prepare', 'review', 'plan',
  'apply', 'verify', 'rollback', 'common-migrate'
]);

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      result._.push(argument);
      continue;
    }
    const equalIndex = argument.indexOf('=');
    if (equalIndex > 2) {
      result[toCamel(argument.slice(2, equalIndex))] = argument.slice(equalIndex + 1);
      continue;
    }
    const key = toCamel(argument.slice(2));
    const next = argv[index + 1];
    if (next != null && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function requireOption(args, name) {
  const value = args[name];
  if (value == null || String(value).trim() === '') fail(`Missing required option --${name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`);
  return String(value);
}

function assertNodeVersion() {
  const current = process.versions.node.split('.').map(Number);
  for (let index = 0; index < MIN_NODE.length; index += 1) {
    if (current[index] > MIN_NODE[index]) return;
    if (current[index] < MIN_NODE[index]) {
      fail(`Node.js >= ${MIN_NODE.join('.')} is required; current version is ${process.versions.node}. Install or select a supported Node.js runtime.`);
    }
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(file, value) {
  const target = path.resolve(file);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return target;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
    return result;
  }
  return value;
}

function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(stableValue(value));
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function assertFormType(value) {
  const formType = String(value || '').trim().toUpperCase();
  if (!FORM_TYPES.has(formType)) fail('Only CA and CR forms are supported; empty or pathology MapType is rejected.');
  return formType;
}

function projectRoot(args) {
  return path.resolve(args.projectRoot || process.cwd());
}

function projectPath(args, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot(args), value);
}

function workRoot(args) {
  return args.workRoot ? projectPath(args, args.workRoot) : path.join(projectRoot(args), '.agents', 'work', 'cure-form');
}

function docsRoot(args) {
  return args.docsRoot ? projectPath(args, args.docsRoot) : path.join(projectRoot(args), 'docs');
}

function developmentRoot(args) {
  return args.developmentRoot ? projectPath(args, args.developmentRoot) : path.join(docsRoot(args), 'cure-form');
}

function discoverDocumentSource(args) {
  const root = docsRoot(args);
  if (!fs.existsSync(root)) fail(`Default document directory does not exist: ${root}. Provide --source or create the project docs directory.`);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && DOCUMENT_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(target);
    }
  };
  visit(root);
  files.sort((left, right) => left.localeCompare(right));
  if (files.length === 1) return files[0];
  if (!files.length) fail(`No Word, PDF, or Excel requirement document was found under ${root}. Provide --source explicitly.`);
  fail(`Multiple requirement documents were found under ${root}; provide --source explicitly. Candidates: ${files.map((file) => path.relative(root, file)).join(', ')}`);
}

function capabilityRoot(args) {
  const root = args.capabilityRoot || process.env.IMEDICAL_AGENTS_ROOT || path.join(process.cwd(), '.agents');
  return path.resolve(root);
}

function validateSpec(spec, options = {}) {
  if (!spec || spec.schema !== 'cure-form-spec/v1') fail('Expected schema cure-form-spec/v1.');
  spec.formType = assertFormType(spec.formType);
  if (!['document', 'server'].includes(spec.sourceMode)) fail('sourceMode must be document or server.');
  for (const name of ['moduleId', 'mapCode', 'title']) {
    if (!String(spec[name] || '').trim()) fail(`Specification field ${name} is required.`);
  }
  const scriptHref = String(spec.scriptHref || '').trim();
  const scriptDeploymentPath = String(spec.scriptDeploymentPath || '').trim();
  if (spec.scriptHref != null || spec.scriptDeploymentPath != null) {
    if (!scriptHref || !scriptDeploymentPath) {
      fail('Form-level JavaScript must declare both scriptHref and scriptDeploymentPath.');
    }
    if (/^(?:[A-Za-z]:|\/|[a-z]+:)/i.test(scriptHref) || scriptHref.includes('\\') || !/\.js(?:[?#].*)?$/i.test(scriptHref)) {
      fail(`scriptHref must be a project-relative JavaScript URL: ${scriptHref || '<empty>'}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*\.js$/.test(scriptDeploymentPath) || scriptDeploymentPath.split('/').includes('..')) {
      fail(`scriptDeploymentPath must be a safe project-relative JavaScript path: ${scriptDeploymentPath || '<empty>'}`);
    }
    const hrefScriptName = path.posix.basename(scriptHref.split(/[?#]/, 1)[0]);
    const deploymentScriptName = path.posix.basename(scriptDeploymentPath);
    if (hrefScriptName !== deploymentScriptName) {
      fail('Form-level JavaScript reference and deployment basenames must match.');
    }
    const scriptBaseName = path.posix.basename(scriptDeploymentPath, '.js');
    if (!/^[a-z][A-Za-z0-9]*$/.test(scriptBaseName) || scriptBaseName.length > 24) {
      fail(`scriptDeploymentPath basename must be semantic camelCase with at most 24 characters: ${scriptBaseName || '<empty>'}`);
    }
  }
  if (spec.aggregateTemplateInit != null && typeof spec.aggregateTemplateInit !== 'boolean') {
    fail('aggregateTemplateInit must be a boolean when present.');
  }
  if (spec.aggregateTemplateInit === true && (!scriptHref || !scriptDeploymentPath)) {
    fail('aggregateTemplateInit=true requires a form-level scriptHref and scriptDeploymentPath.');
  }
  for (const name of ['sections', 'fields', 'dictionaries', 'calculations', 'visibilityRules', 'layout', 'commonTemplates', 'unresolved']) {
    if (!Array.isArray(spec[name])) fail(`Specification field ${name} must be an array.`);
  }
  if (spec.stylesheets != null) {
    if (!Array.isArray(spec.stylesheets)) fail('Specification field stylesheets must be an array when present.');
    const stylesheetPaths = [];
    for (const stylesheet of spec.stylesheets) {
      const stylesheetPath = String(stylesheet && stylesheet.path || '').trim();
      const content = String(stylesheet && stylesheet.content || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.css$/.test(stylesheetPath)) {
        fail(`Stylesheet path must be a module-local CSS filename: ${stylesheetPath || '<empty>'}`);
      }
      if (!content.trim()) fail(`Stylesheet content must not be empty: ${stylesheetPath}`);
      const loadMode = String(stylesheet && stylesheet.loadMode || 'template').trim();
      if (!['host', 'template'].includes(loadMode)) fail(`Stylesheet loadMode must be host or template: ${loadMode || '<empty>'}`);
      if (loadMode === 'host' && (!scriptHref || !scriptDeploymentPath)) {
        fail('Host-loaded stylesheets require form-level scriptHref and scriptDeploymentPath.');
      }
      const runtimeHref = String(stylesheet && stylesheet.runtimeHref || stylesheetPath).trim();
      if (!runtimeHref || /^(?:[A-Za-z]:|\/|[a-z]+:)/i.test(runtimeHref) || runtimeHref.includes('\\') || !/\.css(?:[?#].*)?$/i.test(runtimeHref)) {
        fail(`Stylesheet runtimeHref must be a project-relative URL: ${runtimeHref || '<empty>'}`);
      }
      const deploymentPath = String(stylesheet && stylesheet.deploymentPath || stylesheetPath).trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*\.css$/.test(deploymentPath) || deploymentPath.split('/').includes('..')) {
        fail(`Stylesheet deploymentPath must be a safe project-relative CSS path: ${deploymentPath || '<empty>'}`);
      }
      const stylesheetBaseName = path.posix.basename(deploymentPath, '.css');
      if (!/^[a-z][A-Za-z0-9]*$/.test(stylesheetBaseName) || stylesheetBaseName.length > 24) {
        fail(`Stylesheet deploymentPath basename must be semantic camelCase with at most 24 characters: ${stylesheetBaseName || '<empty>'}`);
      }
      stylesheetPaths.push(stylesheetPath.toLowerCase());
    }
    if (new Set(stylesheetPaths).size !== stylesheetPaths.length) fail('Stylesheet paths must be unique.');
    if (stylesheetPaths.length && spec.publicStylesheets == null) {
      fail('Specification field publicStylesheets is required when stylesheets are present. Resolve its URLs from the target project instead of assuming a public CSS path.');
    }
  }
  if (spec.publicStylesheets != null) {
    if (!spec.publicStylesheets || typeof spec.publicStylesheets !== 'object' || Array.isArray(spec.publicStylesheets)) {
      fail('Specification field publicStylesheets must be an object when present.');
    }
    for (const name of ['baseHref', 'responsiveHref']) {
      const href = String(spec.publicStylesheets[name] || '').trim();
      if (!href || /^(?:[A-Za-z]:|\/\/|[a-z]+:)/i.test(href)) {
        fail(`publicStylesheets.${name} must be a non-empty project-relative URL.`);
      }
    }
  }
  const fieldIds = spec.fields.map((field) => String(field && field.id || ''));
  if (fieldIds.some((id) => !id)) fail('Every specification field must have a non-empty id.');
  if (new Set(fieldIds).size !== fieldIds.length) fail('Specification field IDs must be unique.');
  if (spec.templates != null) {
    if (!Array.isArray(spec.templates)) fail('Specification field templates must be an array when present.');
    const templateKeys = spec.templates.map((template) => String(template && template.key || ''));
    if (templateKeys.some((key) => !key)) fail('Every template must have a non-empty key.');
    if (new Set(templateKeys).size !== templateKeys.length) fail('Template keys must be unique.');
    if (spec.expectedTemplateCount != null && spec.templates.length !== Number(spec.expectedTemplateCount)) {
      fail(`Expected exactly ${spec.expectedTemplateCount} templates; received ${spec.templates.length}.`);
    }
    for (const field of spec.fields) {
      if (field.templateKey && !templateKeys.includes(String(field.templateKey))) {
        fail(`Field ${field.id} references unknown templateKey ${field.templateKey}.`);
      }
    }
    if (options.approved || options.readyForApproval) {
      for (const template of spec.templates) {
        if (!String(template.rootId || '').trim() || !String(template.moduleName || '').trim()) {
          fail(`Approved multi-template specification requires rootId and moduleName for template ${template.key}.`);
        }
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(template.moduleName))) {
          fail(`Template moduleName must be a JavaScript identifier: ${template.moduleName}`);
        }
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(template.rootId))) {
          fail(`Template rootId must use letters, digits, and underscores: ${template.rootId}`);
        }
        const javascriptHref = String(template.javascriptHref || '').trim();
        const javascriptDeploymentPath = String(template.javascriptDeploymentPath || '').trim();
        const javascriptSource = String(template.javascript || '').trim();
        if (javascriptSource && (!javascriptHref || !javascriptDeploymentPath)) {
          fail(`Template JavaScript must declare both javascriptHref and javascriptDeploymentPath: ${template.key}`);
        }
        if (!javascriptSource && (javascriptHref || javascriptDeploymentPath)) {
          fail(`Template external JavaScript requires source content: ${template.key}`);
        }
        if (javascriptHref || javascriptDeploymentPath) {
          if (!javascriptHref || /^(?:[A-Za-z]:|\/|[a-z]+:)/i.test(javascriptHref) || javascriptHref.includes('\\') || !/\.js(?:[?#].*)?$/i.test(javascriptHref)) {
            fail(`Template javascriptHref must be a project-relative JavaScript URL: ${template.key}`);
          }
          if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*\.js$/.test(javascriptDeploymentPath) || javascriptDeploymentPath.split('/').includes('..')) {
            fail(`Template javascriptDeploymentPath must be a safe project-relative JavaScript path: ${template.key}`);
          }
          const deploymentScriptName = path.posix.basename(javascriptDeploymentPath);
          const hrefScriptName = path.posix.basename(javascriptHref.split(/[?#]/, 1)[0]);
          const templateScriptBaseName = path.posix.basename(deploymentScriptName, '.js');
          if (deploymentScriptName !== hrefScriptName) {
            fail(`Template JavaScript reference and deployment basenames must match: ${template.key}`);
          }
          if (!/^[a-z][A-Za-z0-9]*$/.test(templateScriptBaseName) || templateScriptBaseName.length > 24) {
            fail(`Template JavaScript basename must be semantic camelCase with at most 24 characters: ${template.key}`);
          }
        }
        if (template.fragmentHtml != null) {
          const fragment = String(template.fragmentHtml);
          if (/<\/?(?:html|head|body)|<script\b|<link\b/i.test(fragment)) {
            fail(`Template fragmentHtml must contain only a root div fragment: ${template.key}`);
          }
          const rootPattern = new RegExp(`<div\\b[^>]*\\bid=["']${String(template.rootId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
          if (!rootPattern.test(fragment) || !/assess-form--responsive/.test(fragment)) {
            fail(`Template fragmentHtml must preserve rootId and responsive classes: ${template.key}`);
          }
          const snapshot = contractSnapshot(fragment);
          if (new Set(snapshot.ids).size !== snapshot.ids.length) {
            fail(`Template fragmentHtml contains duplicate DOM IDs: ${template.key}`);
          }
          for (const field of spec.fields.filter((item) => item.templateKey === template.key)) {
            const fieldPattern = new RegExp(`\\bid=["']${String(field.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
            if (!fieldPattern.test(fragment)) fail(`Template fragmentHtml is missing field ${field.id}: ${template.key}`);
            if (field.cacheTag && !snapshot.cacheTags.includes(String(field.cacheTag))) {
              fail(`Template fragmentHtml is missing cache tag ${field.cacheTag}: ${template.key}`);
            }
          }
        }
        if (template.javascript != null) {
          const script = String(template.javascript);
          const modulePattern = new RegExp(`\\bvar\\s+${String(template.moduleName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
          if (!modulePattern.test(script) || !/\bInit\b/.test(script) || !/\bOtherInfo\b/.test(script) || !/\bPrintInfo\b/.test(script)) {
            fail(`Template javascript must define its approved module and runtime interfaces: ${template.key}`);
          }
          try { new Function(script); }
          catch (error) { fail(`Template javascript syntax is invalid for ${template.key}: ${error.message}`); }
        }
      }
    }
  }
  if (options.approved || options.readyForApproval) {
    const allowedControls = new Set(['text', 'textarea', 'select', 'number', 'date', 'radio', 'checkbox', 'readonly']);
    for (const field of spec.fields) {
      if (field.candidate || !allowedControls.has(String(field.control || ''))) {
        fail(`Field ${field.id} is still a candidate or has unresolved control type.`);
      }
    }
  }
  if (!spec.runtimeContract || typeof spec.runtimeContract !== 'object') fail('runtimeContract must be an object.');
  if (options.approved) {
    if (spec.unresolved.length) fail(`Deployment is blocked: unresolved[] contains ${spec.unresolved.length} item(s).`);
    if (!spec.approval || !spec.approval.approvedBy || !spec.approval.specHash) fail('Deployment is blocked: specification has no human approval.');
    const copy = JSON.parse(JSON.stringify(spec));
    delete copy.approval;
    if (sha256(copy) !== spec.approval.specHash) fail('Specification changed after approval; review it again.');
  }
  return spec;
}

function publicResponsiveCssPaths(args, requireDeployCopy) {
  const source = requireOption(args, 'publicResponsiveCss');
  const paths = [path.resolve(source)];
  if (requireDeployCopy) paths.push(path.resolve(requireOption(args, 'publicResponsiveCssCopy')));
  else if (args.publicResponsiveCssCopy) paths.push(path.resolve(args.publicResponsiveCssCopy));
  for (const file of paths) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`Public responsive CSS file was not found: ${file}`);
  }
  return paths;
}

function validatePublicResponsiveBoundary(spec, args, requireDeployCopy = false) {
  const stylesheets = Array.isArray(spec.stylesheets) ? spec.stylesheets : [];
  if (!stylesheets.length) return;
  const frameworkClasses = /^(?:assess-form|panel|panel-body|textbox|numberbox|combo|radio|checked|i-label-box|m-label-box|hisui-[A-Za-z0-9_-]+)$/;
  const privateClasses = new Set();
  for (const stylesheet of stylesheets) {
    const css = String(stylesheet.content || '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      if (!frameworkClasses.test(match[1])) privateClasses.add(match[1]);
    }
  }
  const privateIds = [spec.moduleId, ...(Array.isArray(spec.templates) ? spec.templates.flatMap((template) => [template.rootId, template.moduleName]) : [])]
    .map((value) => String(value || '').trim()).filter(Boolean);
  const violations = [];
  for (const file of publicResponsiveCssPaths(args, requireDeployCopy)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const className of privateClasses) {
      if (new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(content)) {
        violations.push(`${file}: .${className}`);
      }
    }
    for (const id of privateIds) {
      if (content.includes(id)) violations.push(`${file}: ${id}`);
    }
  }
  if (violations.length) fail(`Public responsive CSS contains form-specific selectors:\n${violations.join('\n')}`);
}

function sourceLabel(structure) {
  return structure.source && (structure.source.name || structure.source.path) || structure.sourceFile || 'hospital-document';
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function stableId(text, prefix, used) {
  let base = cleanText(text).normalize('NFKC').replace(/[^A-Za-z0-9\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  if (!base) base = prefix;
  let value = `${prefix}_${base}`;
  let suffix = 2;
  while (used.has(value)) value = `${prefix}_${base}_${suffix++}`;
  used.add(value);
  return value;
}

function columnNumber(letters) {
  let value = 0;
  for (const letter of String(letters).toUpperCase()) value = value * 26 + letter.charCodeAt(0) - 64;
  return value;
}

function columnLetters(value) {
  let number = Number(value);
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function rangeAddress(range) {
  return `${columnLetters(range.startColumn)}${range.startRow}:${columnLetters(range.endColumn)}${range.endRow}`;
}

function parseCellAddress(value) {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(String(value || '').trim());
  if (!match) fail(`Invalid cell address: ${value}`);
  return { row: Number(match[2]), column: columnNumber(match[1]) };
}

function parseRange(value) {
  const match = /^\s*([^:]+):([^:]+)\s*$/.exec(String(value || ''));
  if (!match) fail(`Invalid A1 range: ${value}`);
  const start = parseCellAddress(match[1]);
  const end = parseCellAddress(match[2]);
  if (start.row > end.row || start.column > end.column) fail(`Invalid descending A1 range: ${value}`);
  return { startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column, address: String(value).toUpperCase() };
}

function rangesIntersect(left, right) {
  return left.startRow <= right.endRow && left.endRow >= right.startRow &&
    left.startColumn <= right.endColumn && left.endColumn >= right.startColumn;
}

function rangeIntersection(left, right) {
  if (!rangesIntersect(left, right)) return null;
  return {
    startRow: Math.max(left.startRow, right.startRow),
    startColumn: Math.max(left.startColumn, right.startColumn),
    endRow: Math.min(left.endRow, right.endRow),
    endColumn: Math.min(left.endColumn, right.endColumn)
  };
}

function cellInRange(cell, range) {
  return Number(cell.row) >= range.startRow && Number(cell.row) <= range.endRow &&
    Number(cell.column) >= range.startColumn && Number(cell.column) <= range.endColumn;
}

function rangesCoverRange(ranges, target) {
  for (let row = target.startRow; row <= target.endRow; row += 1) {
    const intervals = ranges
      .filter((range) => range.startRow <= row && range.endRow >= row)
      .map((range) => [
        Math.max(range.startColumn, target.startColumn),
        Math.min(range.endColumn, target.endColumn)
      ])
      .filter(([start, end]) => start <= end)
      .sort((left, right) => left[0] - right[0]);
    let nextColumn = target.startColumn;
    for (const [start, end] of intervals) {
      if (start > nextColumn) break;
      nextColumn = Math.max(nextColumn, end + 1);
      if (nextColumn > target.endColumn) break;
    }
    if (nextColumn <= target.endColumn) return false;
  }
  return true;
}

function cellText(cell) {
  return cleanText(cell.displayedValue != null ? cell.displayedValue : cell.displayValue != null ? cell.displayValue : cell.value != null ? cell.value : cell.text);
}

function classifyWorkbookCell(text, templateTitle) {
  if (!text) return 'blank';
  if (cleanText(text) === cleanText(templateTitle)) return 'heading';
  if (/^(?:cm|kg|s|sec|秒|分钟|分|°|度|L|R)$/i.test(text)) return 'unit-or-axis';
  if (/^(?:左|右|初测|复测|日期|时间|得分|评分|正常值)[：:]?$/i.test(text)) return 'dimension';
  if (text.length > 24 || /(?:^|\s)[0-9.]+\s*(?:=|≥|≤|>|<)|(?:=|≥|≤)\s*[0-9.]|评分指标|知情|风险|不良反应|BMI/i.test(text)) return 'rule-or-guidance';
  return 'label-or-value';
}

function workbookExtent(sheet) {
  const populated = (sheet.cells || []).filter((cell) => cellText(cell));
  if (!populated.length) return null;
  return {
    startRow: Math.min(...populated.map((cell) => Number(cell.row))),
    startColumn: Math.min(...populated.map((cell) => Number(cell.column))),
    endRow: Math.max(...populated.map((cell) => Number(cell.row))),
    endColumn: Math.max(...populated.map((cell) => Number(cell.column)))
  };
}

function loadTemplateBoundaries(args) {
  if (!args.templateBoundaries) return null;
  const config = readJson(args.templateBoundaries);
  if (!config || config.schema !== 'cure-form-template-boundaries/v1') fail('Expected cure-form-template-boundaries/v1.');
  if (!Array.isArray(config.templates) || !config.templates.length) fail('Template boundary config must contain templates[].');
  if (config.expectedTemplateCount != null && config.templates.length !== Number(config.expectedTemplateCount)) {
    fail(`Template boundary config expected ${config.expectedTemplateCount} templates; received ${config.templates.length}.`);
  }
  return config;
}

function extractWorkbookCandidates(structure, boundaryConfig) {
  const sheets = Array.isArray(structure.sheets) ? structure.sheets : [];
  if (!sheets.length || !boundaryConfig) return null;
  const sheetName = boundaryConfig.sheet || sheets[0].name;
  const sheet = sheets.find((item) => item.name === sheetName);
  if (!sheet) fail(`Template boundary sheet was not found: ${sheetName}`);
  const used = new Set();
  const fields = [];
  const templates = [];
  const overlaps = [];
  const mergeSplits = [];
  const parsedBoundaries = boundaryConfig.templates.map((template, index) => {
    const sourceRanges = Array.isArray(template.sourceRanges) ? template.sourceRanges : [template.sourceRange];
    if (!sourceRanges.length || sourceRanges.some((value) => !value)) fail(`Template ${template.key || index + 1} must define sourceRange or sourceRanges[].`);
    return {
      ...template,
      order: Number(template.order || index + 1),
      sourceRanges,
      parsedRanges: sourceRanges.map(parseRange)
    };
  });
  for (let left = 0; left < parsedBoundaries.length; left += 1) {
    for (let right = left + 1; right < parsedBoundaries.length; right += 1) {
      for (const leftRange of parsedBoundaries[left].parsedRanges) {
        for (const rightRange of parsedBoundaries[right].parsedRanges) {
          if (!rangesIntersect(leftRange, rightRange)) continue;
          const intersection = rangeIntersection(leftRange, rightRange);
          overlaps.push({ left: parsedBoundaries[left].key, right: parsedBoundaries[right].key, leftRange: leftRange.address, rightRange: rightRange.address, intersection: rangeAddress(intersection) });
        }
      }
    }
  }
  for (const mergedRange of sheet.mergedRanges || []) {
    const parsedMerge = parseRange(mergedRange);
    const intersectingTemplates = parsedBoundaries
      .filter((template) => template.parsedRanges.some((range) => rangesIntersect(range, parsedMerge)))
      .map((template) => template.key);
    if (!intersectingTemplates.length) continue;
    const owningTemplates = parsedBoundaries
      .filter((template) => rangesCoverRange(template.parsedRanges, parsedMerge))
      .map((template) => template.key);
    if (owningTemplates.length !== 1) {
      mergeSplits.push({ mergedRange, intersectingTemplates, owningTemplates });
    }
  }
  for (const template of parsedBoundaries.sort((a, b) => a.order - b.order)) {
    const cells = (sheet.cells || []).filter((cell) => template.parsedRanges.some((range) => cellInRange(cell, range)) && cellText(cell));
    const mergeRanges = (sheet.mergedRanges || []).filter((value) => template.parsedRanges.some((range) => rangesIntersect(parseRange(value), range)));
    const mergedFacts = mergeRanges.map((value) => {
      const parsed = parseRange(value);
      const anchor = (sheet.cells || []).find((cell) => Number(cell.row) === parsed.startRow && Number(cell.column) === parsed.startColumn);
      const text = anchor ? cellText(anchor) : '';
      return { range: value, anchorText: text, role: classifyWorkbookCell(text, template.title) };
    });
    const roleCounts = {};
    const facts = cells.map((cell) => {
      const text = cellText(cell);
      const role = classifyWorkbookCell(text, template.title);
      roleCounts[role] = (roleCounts[role] || 0) + 1;
      return { coordinate: cell.coordinate, text, formula: cell.formula || '', role };
    });
    for (const fact of facts.filter((item) => item.role === 'label-or-value')) {
      const base = `candidate_${String(template.key).replace(/[^a-z0-9]+/gi, '_')}_${String(fact.coordinate).toLowerCase()}`;
      const id = stableId(base, 'field', used).replace(/[^A-Za-z0-9_]/g, '_');
      fields.push({
        id,
        label: fact.text,
        control: 'unresolved',
        templateKey: template.key,
        sourceRef: `${sheet.name}!${fact.coordinate}`,
        confidence: 0.4,
        cacheTag: null,
        dictionaryId: null,
        candidate: true
      });
    }
    templates.push({
      key: template.key,
      order: template.order,
      title: template.title,
      sourceRange: template.sourceRanges.length === 1 ? template.sourceRanges[0] : null,
      sourceRanges: template.sourceRanges,
      sourceRef: template.sourceRanges.map((value) => `${sheet.name}!${value}`).join(';'),
      description: template.description || '',
      rootId: template.rootId || null,
      moduleName: template.moduleName || null,
      populatedCellCount: cells.length,
      mergedRanges: mergeRanges,
      mergedFacts,
      formulaCells: facts.filter((item) => item.formula).map((item) => ({ coordinate: item.coordinate, formula: item.formula })),
      roleCounts,
      facts
    });
  }
  return {
    sections: templates.map((template) => ({ id: `section_${template.key}`, title: template.title, sourceRef: template.sourceRef, confidence: 1 })),
    fields,
    templates,
    overlaps,
    mergeSplits,
    workbook: {
      sheet: sheet.name,
      formattedMaxRow: Number(sheet.maxRow || 0),
      formattedMaxColumn: Number(sheet.maxColumn || 0),
      populatedExtent: workbookExtent(sheet),
      mergedRangeCount: (sheet.mergedRanges || []).length,
      dataValidationCount: (sheet.dataValidations || []).length
    }
  };
}

function extractCandidates(structure) {
  const fields = [];
  const sections = [];
  const used = new Set();
  const paragraphs = structure.paragraphs || structure.document && structure.document.paragraphs || [];
  for (const paragraph of paragraphs) {
    const text = cleanText(paragraph.text);
    if (!text) continue;
    if (/标题|评估|记录|治疗|一般资料|基本信息|评分/.test(text) && text.length <= 40) {
      sections.push({ id: stableId(text, 'section', used), title: text, sourceRef: paragraph.sourceRef || `paragraph:${paragraph.index}`, confidence: 0.6 });
    }
  }
  const tables = structure.tables || structure.document && structure.document.tables || [];
  for (const table of tables) {
    const cells = Array.isArray(table.cells) ? table.cells : [];
    for (const cell of cells) {
      const text = cleanText(cell.text != null ? cell.text : cell.displayValue);
      if (!text || text.length > 80 || /^[-—_\d.]+$/.test(text)) continue;
      if (!/[：:？?（）()]/.test(text) && text.length > 24) continue;
      fields.push({
        id: stableId(text.replace(/[：:？?].*$/, ''), 'field', used),
        label: text.replace(/[：:？?]+$/, ''),
        control: 'text',
        sourceRef: cell.sourceRef || `table:${table.index || table.name || 0}:cell:${cell.coordinate || `${cell.row},${cell.column}`}`,
        confidence: 0.45,
        cacheTag: null,
        dictionaryId: null
      });
    }
  }
  return { sections, fields };
}

function structureToSpec(structure, args) {
  if (!structure || (structure.schema || structure.schemaVersion) !== 'extract-doc/structure-v1') fail('Expected extract-doc/structure-v1 input.');
  const formType = assertFormType(args.formType);
  const moduleId = requireOption(args, 'moduleId');
  const mapCode = args.mapCode || moduleId;
  const boundaryConfig = loadTemplateBoundaries(args);
  const workbookCandidates = extractWorkbookCandidates(structure, boundaryConfig);
  const candidates = workbookCandidates || extractCandidates(structure);
  const visual = Boolean(structure.requiresVisualExtraction || structure.document && structure.document.requiresVisualExtraction);
  const unresolved = [];
  if (visual) unresolved.push({ code: 'VISUAL_EXTRACTION_REQUIRED', message: '来源没有可靠文本层；必须渲染页面、进行视觉提取、保留置信度并获得人工确认。' });
  if (!candidates.fields.length) unresolved.push({ code: 'NO_CONFIRMED_FIELDS', message: '未提取到可靠字段；零字段规格不得批准。' });
  else unresolved.push({ code: 'FIELD_SEMANTICS_REVIEW_REQUIRED', message: '请确认哪些候选项是真实输入，并逐项确认控件类型、选项值、缓存标签、字典、计算和保存语义。' });
  if (workbookCandidates && workbookCandidates.overlaps.length) {
    unresolved.push({ code: 'TEMPLATE_RANGE_OVERLAP', message: '配置的模板范围存在重叠；每个重叠单元格必须人工指定唯一的最终归属模板。', details: workbookCandidates.overlaps });
  }
  if (workbookCandidates && workbookCandidates.mergeSplits.length) {
    unresolved.push({ code: 'TEMPLATE_MERGE_SPLIT', message: '模板边界截断或重复覆盖了合并单元格；每个合并区域必须完整且唯一地归属一个模板。', details: workbookCandidates.mergeSplits });
  }
  if (boundaryConfig && Array.isArray(boundaryConfig.unresolved)) unresolved.push(...boundaryConfig.unresolved);
  return {
    schema: 'cure-form-spec/v1',
    sourceMode: 'document',
    formType,
    moduleId,
    mapCode,
    title: args.title || path.parse(sourceLabel(structure)).name || moduleId,
    expectedTemplateCount: boundaryConfig && boundaryConfig.expectedTemplateCount != null ? Number(boundaryConfig.expectedTemplateCount) : null,
    source: {
      schema: structure.schema || structure.schemaVersion,
      sha256: structure.source && structure.source.sha256 || structure.sourceHash || null,
      converter: structure.converter || null,
      requiresVisualExtraction: visual
    },
    sections: candidates.sections,
    fields: candidates.fields,
    templates: workbookCandidates ? workbookCandidates.templates : [],
    dictionaries: [],
    calculations: [],
    visibilityRules: [],
    layout: [],
    commonTemplates: [],
    runtimeContract: formType === 'CR'
      ? { functions: ['Init', 'OtherInfo', 'PrintInfo', 'SaveCureRecord'], globals: ['CureExpJsonStr', 'MapID'], preserveDomIds: true, preserveCacheTags: true, preserveRadioValues: true }
      : { functions: ['Init', 'OtherInfo', 'PrintInfo'], preserveDomIds: true, preserveCacheTags: true, preserveRadioValues: true },
    unresolved,
    diagnostics: structure.diagnostics || [],
    sourceStructure: workbookCandidates ? workbookCandidates.workbook : null
  };
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: options.cwd || process.cwd(), encoding: 'utf8', windowsHide: true, env: options.env || process.env });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} failed (${result.status}): ${cleanText(result.stderr || result.stdout)}`);
  return result.stdout || '';
}

function commandDoctor(args) {
  const root = capabilityRoot(args);
  const project = projectRoot(args);
  const checks = {
    node: process.versions.node,
    capabilityRoot: fs.existsSync(root),
    extractDoc: fs.existsSync(path.join(root, 'plugins', 'extract-doc', 'scripts', 'extract-doc-ingest.py')),
    codingIris: fs.existsSync(path.join(root, 'plugins', 'coding-iris-plugin')),
    mcpHelper: fs.existsSync(path.join(root, 'scripts', 'iris-mcp.js')),
    mcpConfig: fs.existsSync(path.join(project, '.mcp.json')),
    irisProfile: fs.existsSync(path.join(project, '.iris-agentic-dev.toml'))
  };
  checks.ok = Object.entries(checks).filter(([key]) => key !== 'node').every(([, value]) => Boolean(value));
  if (args.probe) {
    if (!checks.mcpHelper) fail('Cannot run probe: iris-mcp.js was not found.');
    run(process.execPath, [path.join(root, 'scripts', 'iris-mcp.js'), 'call', 'iris_query', JSON.stringify({ query: 'SELECT 1 AS Probe' })]);
    checks.readOnlyProbe = true;
  }
  console.log(JSON.stringify(checks, null, 2));
  if (!checks.ok) process.exitCode = 2;
}

function commandIntake(args) {
  const moduleId = requireOption(args, 'moduleId');
  const usesDefaultDocsLayout = !args.workRoot && !args.output;
  const root = args.workRoot
    ? projectPath(args, args.workRoot)
    : args.output
      ? path.dirname(projectPath(args, args.output))
      : path.join(developmentRoot(args), moduleId);
  ensureDir(root);
  let structureFile = args.structure && projectPath(args, args.structure);
  if (!structureFile) {
    const source = args.source ? projectPath(args, args.source) : discoverDocumentSource(args);
    const ingestDir = path.join(workRoot(args), 'ingest', `${Date.now()}-${path.parse(source).name}`);
    ensureDir(ingestDir);
    const script = path.join(capabilityRoot(args), 'plugins', 'extract-doc', 'scripts', 'extract-doc-ingest.py');
    if (!fs.existsSync(script)) fail(`extract-doc ingest script not found under capability root: ${script}`);
    run(args.python || process.env.PYTHON || 'python', [
      script, '--file', source, '--project-root', ingestDir, '--output-root', '.', '--emit-structure'
    ]);
    const candidates = fs.readdirSync(ingestDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(ingestDir, entry.name, 'structure.json'))
      .filter((file) => fs.existsSync(file));
    if (candidates.length !== 1) fail(`extract-doc must produce exactly one structure.json artifact; found ${candidates.length}.`);
    structureFile = candidates[0];
  }
  const spec = structureToSpec(readJson(structureFile), args);
  const output = args.output ? projectPath(args, args.output) : path.join(root, 'cure-form-spec.json');
  writeJson(output, spec);
  let report = null;
  if (args.report || usesDefaultDocsLayout) report = writeIntakeReport(spec, args.report ? projectPath(args, args.report) : path.join(root, 'intake-report.md'));
  console.log(JSON.stringify({ command: 'intake', output, report, templates: spec.templates.length, unresolved: spec.unresolved.length, deployable: false }, null, 2));
}

function markdownCell(value) {
  return cleanText(value).replace(/\|/g, '\\|');
}

function writeIntakeReport(spec, reportFile) {
  const lines = [
    `# ${spec.title}：只读摄取报告`,
    '',
    `- 规格：\`${spec.schema}\``,
    `- 表单类型（待人工批准）：\`${spec.formType}\``,
    `- 临时 moduleId：\`${spec.moduleId}\``,
    `- 源 SHA-256：\`${spec.source.sha256 || 'unknown'}\``,
    `- 解析器：\`${spec.source.converter || 'unknown'}\``,
    `- 模板数：${spec.templates.length}${spec.expectedTemplateCount != null ? ` / 期望 ${spec.expectedTemplateCount}` : ''}`,
    `- unresolved：${spec.unresolved.length}`,
    ''
  ];
  if (spec.sourceStructure) {
    const extent = spec.sourceStructure.populatedExtent;
    lines.push('## 工作簿结构事实', '');
    lines.push(`- Sheet：\`${spec.sourceStructure.sheet}\``);
    lines.push(`- 格式化范围终点：row ${spec.sourceStructure.formattedMaxRow}, column ${spec.sourceStructure.formattedMaxColumn}`);
    if (extent) lines.push(`- 实际非空范围：row ${extent.startRow}-${extent.endRow}, column ${extent.startColumn}-${extent.endColumn}`);
    lines.push(`- 合并区域：${spec.sourceStructure.mergedRangeCount}`);
    lines.push(`- 数据验证：${spec.sourceStructure.dataValidationCount}`);
    lines.push('');
  }
  lines.push('## 模板边界', '', '| # | key | 标题 | 来源范围 | 非空单元格 | 合并区域 | 规则/说明 | 候选标签 |', '|---:|---|---|---|---:|---:|---:|---:|');
  for (const template of spec.templates) {
    const ranges = Array.isArray(template.sourceRanges) ? template.sourceRanges.join('; ') : template.sourceRange;
    lines.push(`| ${template.order} | ${markdownCell(template.key)} | ${markdownCell(template.title)} | \`${ranges}\` | ${template.populatedCellCount} | ${template.mergedRanges.length} | ${template.roleCounts['rule-or-guidance'] || 0} | ${template.roleCounts['label-or-value'] || 0} |`);
  }
  lines.push('', '## 规则、单位与维度摘录', '');
  for (const template of spec.templates) {
    const rules = template.facts.filter((fact) => fact.role === 'rule-or-guidance').slice(0, 12).map((fact) => `${fact.coordinate} ${fact.text}`);
    const axes = template.facts.filter((fact) => ['unit-or-axis', 'dimension'].includes(fact.role)).map((fact) => `${fact.coordinate} ${fact.text}`);
    const merges = (template.mergedFacts || []).filter((item) => item.anchorText).slice(0, 12).map((item) => `${item.range} ${item.anchorText}`);
    lines.push(`### ${template.order}. ${template.title}`, '');
    lines.push(`- 单位/维度：${axes.length ? axes.map((item) => `\`${markdownCell(item)}\``).join('、') : '未识别'}`);
    lines.push(`- 规则/说明：${rules.length ? rules.map((item) => `\`${markdownCell(item)}\``).join('；') : '未识别'}`);
    lines.push(`- 合并层级：${merges.length ? merges.map((item) => `\`${markdownCell(item)}\``).join('；') : '无带文本的合并锚点'}`);
    lines.push('');
  }
  lines.push('## unresolved 门禁', '');
  for (const item of spec.unresolved) {
    lines.push(`- \`${item.code}\`：${item.message}`);
    if (item.details) lines.push(`  - 详情：\`${markdownCell(JSON.stringify(item.details))}\``);
  }
  lines.push('', '> 本报告只记录文档结构事实和候选语义，不代表字段、计算、模板组成或部署已获批准。', '');
  const target = path.resolve(reportFile);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, lines.join('\n'), 'utf8');
  return target;
}

function extractResult(output) {
  const line = output.split(/\r?\n/).find((item) => item.startsWith('RESULT='));
  if (!line) fail('MCP helper returned no RESULT payload.');
  const value = JSON.parse(line.slice('RESULT='.length));
  if (value && typeof value.result === 'string') return JSON.parse(value.result);
  if (value && value.raw && typeof value.raw === 'string') {
    try { return JSON.parse(value.raw); } catch { return value; }
  }
  return value;
}

function objectScriptArgument(value) {
  const encoded = Buffer.from(String(value == null ? '' : value), 'utf8').toString('base64');
  return `$zconvert(##class(%SYSTEM.Encryption).Base64Decode("${encoded}"),"I","UTF8")`;
}

function unwrapServerResult(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    try { return JSON.parse(text); } catch { return value; }
  }
  if (!value || typeof value !== 'object') return value;
  for (const key of ['output', 'stdout', 'return_value', 'returnValue', 'result', 'value', 'raw']) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== value) {
      const candidate = unwrapServerResult(value[key]);
      if (candidate && (typeof candidate !== 'string' || candidate.trim())) return candidate;
    }
  }
  return value;
}

function invokeIrisExecute(helper, code) {
  const payload = { code, confirmed: true, translate_sql: false, timeout: 120 };
  const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-form-mcp-'));
  const payloadFile = path.join(payloadDir, 'tool-arguments.json');
  try {
    fs.writeFileSync(payloadFile, JSON.stringify(payload), 'utf8');
    const helperArgs = [helper, 'call', 'iris_execute', '--json-file', payloadFile, '--allow-write'];
    return extractResult(run(process.execPath, helperArgs));
  } finally {
    fs.rmSync(payloadDir, { recursive: true, force: true });
  }
}

function transportOutput(value) {
  if (value && typeof value === 'object' && typeof value.output === 'string') return value.output;
  const unwrapped = unwrapServerResult(value);
  return typeof unwrapped === 'string' ? unwrapped : '';
}

function invokeServerChunked(helper, methodCall) {
  const lengthResult = invokeIrisExecute(helper, `set value=${methodCall} write $length(value)`);
  const lengthText = transportOutput(lengthResult).trim();
  if (!/^\d+$/.test(lengthText)) fail('Remote ClassMethod returned no readable result length.');
  const length = Number(lengthText);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_REMOTE_RESULT_LENGTH) {
    fail(`Remote ClassMethod result length ${lengthText} is outside the allowed range.`);
  }
  let text = '';
  for (let start = 1; start <= length; start += REMOTE_CHUNK_SIZE) {
    const end = Math.min(start + REMOTE_CHUNK_SIZE - 1, length);
    const chunkResult = invokeIrisExecute(helper, `set value=${methodCall} write $extract(value,${start},${end})`);
    const chunk = transportOutput(chunkResult);
    if (!chunk) fail(`Remote ClassMethod chunk ${start}-${end} was empty.`);
    text += chunk;
  }
  if (text.length !== length) fail(`Remote ClassMethod chunked result length mismatch: expected ${length}, received ${text.length}.`);
  try { return JSON.parse(text); } catch { return text; }
}

function invokeServerDirect(method, methodArgs, args, write) {
  const helper = path.join(capabilityRoot(args), 'scripts', 'iris-mcp.js');
  if (!fs.existsSync(helper)) fail(`iris-mcp.js was not found: ${helper}`);
  if (!args.confirmRemoteExecution) fail('Remote ClassMethod execution requires explicit --confirm-remote-execution.');
  if (!['InspectForm', 'ValidatePackage', 'ApplyPackage', 'VerifyOperation', 'RollbackOperation', 'PutPackageChunk', 'ValidateStagedPackage', 'ApplyStagedPackage', 'ClearStagedPackage'].includes(method)) fail('Server method is not in the cure deployment allowlist.');
  const methodCall = `##class(web.DHCDocAPPBLDeploy).${method}(${methodArgs.map(objectScriptArgument).join(',')})`;
  if (write && !args.confirmWrite) fail('Server write requires explicit --confirm-write.');
  const transport = invokeIrisExecute(helper, `write ${methodCall}`);
  if (transport && typeof transport === 'object' && transport.success === true && transport.output === '') {
    if (write) fail('Remote write ClassMethod returned an empty result; refusing to repeat a state-changing call.');
    return invokeServerChunked(helper, methodCall);
  }
  return unwrapServerResult(transport);
}

function resultIsOk(value) {
  return Boolean(value && (value.ok === true || value.ok === 1));
}

function invokeStagedPackage(method, methodArgs, args, write) {
  if (!args.confirmWrite && !args.confirmStagingWrite) {
    fail('Large package transport temporarily writes staged chunks and requires --confirm-staging-write or --confirm-write.');
  }
  const packageJson = String(methodArgs[0]);
  const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-form-stage-'));
  const packageFile = path.join(payloadDir, 'package.json');
  try {
    fs.writeFileSync(packageFile, packageJson, 'utf8');
    const transport = path.join(__dirname, 'cure-form-staged-transport.js');
    const transportArgs = [transport, '--method', method, '--package-file', packageFile];
    if (method === 'ApplyPackage') transportArgs.push('--operator', String(methodArgs[1]), '--reason', String(methodArgs[2]));
    return extractResult(run(process.execPath, transportArgs));
  } finally {
    fs.rmSync(payloadDir, { recursive: true, force: true });
  }
}

function invokeServer(method, methodArgs, args, write) {
  const packageJson = methodArgs[0];
  if (['ValidatePackage', 'ApplyPackage'].includes(method) && typeof packageJson === 'string' && packageJson.length > MAX_INLINE_SERVER_ARGUMENT) {
    return invokeStagedPackage(method, methodArgs, args, write);
  }
  return invokeServerDirect(method, methodArgs, args, write);
}

function commandInspect(args) {
  let snapshot;
  if (args.snapshot) snapshot = readJson(args.snapshot);
  else {
    if (!args.confirmRemoteExecution) fail('Remote ClassMethod execution requires explicit --confirm-remote-execution.');
    const transport = path.join(__dirname, 'cure-form-staged-transport.js');
    snapshot = extractResult(run(process.execPath, [
      transport,
      '--method', 'InspectForm',
      '--form-type', assertFormType(requireOption(args, 'formType')),
      '--map-code', requireOption(args, 'mapCode')
    ]));
  }
  const type = assertFormType(snapshot.formType || snapshot.MapType || args.formType);
  const mapCode = snapshot.mapCode || snapshot.MapCode || args.mapCode;
  if (!mapCode) fail('Server snapshot has no mapCode.');
  snapshot.schema = snapshot.schema || 'cure-form-server-snapshot/v1';
  snapshot.formType = type;
  snapshot.mapCode = mapCode;
  snapshot.contentHash = snapshot.contentHash || sha256(snapshot);
  const output = path.resolve(args.output || path.join(workRoot(args), 'snapshots', `${mapCode}-${Date.now()}.json`));
  writeJson(output, snapshot);
  console.log(JSON.stringify({ command: 'inspect', output, formType: type, mapCode, contentHash: snapshot.contentHash }, null, 2));
}

function htmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderField(field) {
  const id = htmlEscape(field.id);
  const label = htmlEscape(field.label || field.id);
  const cache = field.cacheTag ? ` data-cache-tag="${htmlEscape(field.cacheTag)}"` : '';
  let control;
  if (field.control === 'textarea') control = `<textarea id="${id}" class="textbox" rows="${Number(field.rows || 2)}"${cache}></textarea>`;
  else if (field.control === 'select') control = `<input id="${id}" class="hisui-combobox textbox"${cache}>`;
  else if (field.control === 'number') control = `<input id="${id}" class="hisui-numberbox"${cache}>`;
  else if (field.control === 'date') control = `<input id="${id}" class="hisui-datebox textbox"${cache}>`;
  else control = `<input id="${id}" class="textbox" type="text"${cache}>`;
  return `      <tr><th><label for="${id}">${label}</label></th><td>${control}</td></tr>`;
}

function renderTemplateFragment(spec, template) {
  const rootId = htmlEscape(template.rootId);
  const fields = spec.fields.filter((field) => !field.templateKey || field.templateKey === template.key).map(renderField).join('\n');
  return `<div id="${rootId}" class="hisui-panel assess-form assess-form--responsive" data-form-type="${spec.formType}" data-options="border:false">\n  <div id="${rootId}_panel_content" class="hisui-panel" title="${htmlEscape(template.title)}" data-options="headerCls:'panel-header-gray',iconCls:'icon-evaluate-green'">\n    <table class="item-table assess-form-grid">\n${fields}\n    </table>\n  </div>\n</div>\n`;
}

function renderModuleScript(moduleName, formType) {
  const crContract = formType === 'CR'
    ? ", RuntimeContract: { saveEntry: 'SaveCureRecord', payload: 'CureExpJsonStr', mapKey: 'MapID' }"
    : '';
  return `'use strict';\nvar ${moduleName} = (function () {\n  function Init() {}\n  function OtherInfo() { return ""; }\n  function PrintInfo() { return ""; }\n  return { Init: Init, OtherInfo: OtherInfo, PrintInfo: PrintInfo${crContract} };\n}());\n`;
}

function renderMainModuleScript(moduleName, templateArtifacts, formType) {
  const childModules = templateArtifacts.filter((item) => item.hasBusinessScript).map((item) => item.template.moduleName);
  const initCalls = childModules.map((name) => `    if (typeof ${name} !== 'undefined' && ${name}.Init) { ${name}.Init(); }`).join('\n');
  const crContract = formType === 'CR'
    ? ", RuntimeContract: { saveEntry: 'SaveCureRecord', payload: 'CureExpJsonStr', mapKey: 'MapID' }"
    : '';
  return `'use strict';\nvar ${moduleName} = (function () {\n  var initialized = false;\n  function Init() {\n    if (initialized) { return; }\n    initialized = true;\n${initCalls}\n  }\n  function scheduleInit() {\n    if (typeof window === 'undefined' || typeof document === 'undefined') { return; }\n    function deferredInit() { window.setTimeout(Init, 0); }\n    if (window.jQuery) { window.jQuery(deferredInit); return; }\n    if (document.readyState === 'loading') {\n      if (document.addEventListener) { document.addEventListener('DOMContentLoaded', deferredInit); }\n      else if (window.attachEvent) { window.attachEvent('onload', deferredInit); }\n    } else { deferredInit(); }\n  }\n  function OtherInfo() { return ""; }\n  function PrintInfo() { return ""; }\n  scheduleInit();\n  return { Init: Init, OtherInfo: OtherInfo, PrintInfo: PrintInfo${crContract} };\n}());\n`;
}

function renderStylesheetBootstrap(moduleId, stylesheets, publicResponsiveHref) {
  const templateStylesheets = stylesheets.filter((stylesheet) => String(stylesheet.loadMode || 'template') === 'template');
  if (!templateStylesheets.length) return '';
  const anchorFile = String(publicResponsiveHref).split(/[?#]/, 1)[0].replace(/\\/g, '/').split('/').pop();
  const entries = templateStylesheets.map((stylesheet) => ({
    id: `${moduleId}-stylesheet-${sha256(stylesheet.path).slice(0, 10)}`,
    href: stylesheet.runtimeHref || stylesheet.path,
    version: sha256(stylesheet.content).slice(0, 16)
  }));
  return `(function () {\n  if (typeof document === 'undefined' || !document.head) { return; }\n  var anchorFile = ${JSON.stringify(anchorFile)};\n  var links = document.querySelectorAll('link[rel~="stylesheet"]');\n  var anchor = null;\n  for (var index = 0; index < links.length; index += 1) {\n    var href = String(links[index].href || '').split(/[?#]/, 1)[0];\n    if (href.slice(-anchorFile.length) === anchorFile) { anchor = links[index]; break; }\n  }\n  if (!anchor) { return; }\n  var anchorHref = String(anchor.href || '').split(/[?#]/, 1)[0];\n  var baseHref = anchorHref.slice(0, anchorHref.length - anchorFile.length);\n  if (!baseHref) { return; }\n  var stylesheets = ${JSON.stringify(entries)};\n  stylesheets.forEach(function (stylesheet) {\n    if (document.getElementById(stylesheet.id)) { return; }\n    var link = document.createElement('link');\n    link.id = stylesheet.id;\n    link.rel = 'stylesheet';\n    link.href = baseHref + stylesheet.href + '?v=' + stylesheet.version;\n    document.head.appendChild(link);\n  });\n}());\n`;
}

function renderHostStylesheetBootstrap(moduleId, stylesheets) {
  const hostStylesheets = stylesheets.filter((stylesheet) => String(stylesheet.loadMode || 'template') === 'host');
  if (!hostStylesheets.length) return '';
  const entries = hostStylesheets.map((stylesheet) => ({
    id: `${moduleId}-stylesheet-${sha256(stylesheet.path).slice(0, 10)}`,
    href: stylesheet.runtimeHref || stylesheet.path,
    version: sha256(stylesheet.content).slice(0, 16)
  }));
  return `(function () {\n  if (typeof document === 'undefined') { return; }\n  var scripts = document.getElementsByTagName('script');\n  var anchor = document.currentScript || (scripts.length ? scripts[scripts.length - 1] : null);\n  var anchorHref = String(anchor && anchor.src || '').split(/[?#]/, 1)[0];\n  var slash = anchorHref.lastIndexOf('/');\n  if (slash < 0) { return; }\n  var baseHref = anchorHref.slice(0, slash + 1);\n  var target = document.head || document.getElementsByTagName('head')[0] || document.documentElement;\n  var stylesheets = ${JSON.stringify(entries)};\n  stylesheets.forEach(function (stylesheet) {\n    if (document.getElementById(stylesheet.id)) { return; }\n    var link = document.createElement('link');\n    link.id = stylesheet.id;\n    link.rel = 'stylesheet';\n    link.href = baseHref + stylesheet.href + '?v=' + stylesheet.version;\n    target.appendChild(link);\n  });\n}());\n`;
}

function prependStylesheetBootstrap(script, bootstrap) {
  if (!bootstrap) return script;
  const withoutDirective = String(script).replace(/^\s*(['"])use strict\1;?\s*/, '');
  return `'use strict';\n${bootstrap}${withoutDirective}`;
}

function renderCreate(spec, outputRoot) {
  const moduleDir = path.join(path.resolve(outputRoot), spec.moduleId);
  ensureDir(moduleDir);
  const isMultiTemplate = Array.isArray(spec.templates) && spec.templates.length > 0;
  const templates = isMultiTemplate
    ? [...spec.templates].sort((a, b) => Number(a.order) - Number(b.order))
    : [{ key: 'main', order: 1, title: spec.title, rootId: spec.moduleId, moduleName: spec.moduleId }];
  const templateDir = path.join(moduleDir, 'templates');
  if (isMultiTemplate) ensureDir(templateDir);
  const stylesheets = Array.isArray(spec.stylesheets) ? spec.stylesheets : [];
  const publicStylesheets = spec.publicStylesheets || {
    baseHref: '../scripts_lib/com/css/asscom.css',
    responsiveHref: '../scripts_lib/com/css/adaptation.css'
  };
  const templateStylesheetBootstrap = renderStylesheetBootstrap(spec.moduleId, stylesheets, publicStylesheets.responsiveHref);
  const hostStylesheetBootstrap = renderHostStylesheetBootstrap(spec.moduleId, stylesheets);
  const stylesheetLinks = stylesheets.map((stylesheet) => {
    const id = `${spec.moduleId}-stylesheet-${sha256(stylesheet.path).slice(0, 10)}`;
    return `  <link id="${htmlEscape(id)}" rel="stylesheet" href="${htmlEscape(stylesheet.path)}">`;
  }).join('\n');
  for (const stylesheet of stylesheets) {
    fs.writeFileSync(path.join(moduleDir, stylesheet.path), String(stylesheet.content).trimEnd() + '\n', 'utf8');
  }
  const templateArtifacts = templates.map((template) => {
    const fragment = template.fragmentHtml != null ? String(template.fragmentHtml).trimEnd() + '\n' : renderTemplateFragment(spec, template);
    const hasApprovedScript = Object.prototype.hasOwnProperty.call(template, 'javascript');
    const approvedScript = String(template.javascript || '').trim();
    const sourceScript = hasApprovedScript && approvedScript ? approvedScript + '\n' : '';
    const script = prependStylesheetBootstrap(sourceScript, templateStylesheetBootstrap);
    const safeKey = String(template.key).replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const prefix = String(template.order).padStart(2, '0');
    if (isMultiTemplate) {
      fs.writeFileSync(path.join(templateDir, `${prefix}-${safeKey}.fragment.html`), fragment, 'utf8');
      if (script) fs.writeFileSync(path.join(templateDir, `${prefix}-${safeKey}.js`), script, 'utf8');
    }
    return { template, fragment, script, hasBusinessScript: Boolean(sourceScript), safeKey, prefix };
  });
  const body = isMultiTemplate
    ? `<div id="${htmlEscape(spec.moduleId)}" class="hisui-panel assess-form assess-form--responsive" data-options="border:false">\n${templateArtifacts.map((item) => item.fragment).join('')}\n</div>\n`
    : templateArtifacts[0].fragment;
  const templateScriptTags = isMultiTemplate
    ? templateArtifacts.filter((item) => item.script).map((item) => `  <script src="templates/${item.prefix}-${item.safeKey}.js"></script>`).join('\n') + '\n'
    : '';
  const previewInitCalls = isMultiTemplate
    ? (spec.aggregateTemplateInit === true ? '' : templateArtifacts.filter((item) => item.hasBusinessScript).map((item) => `if (typeof ${item.template.moduleName} !== 'undefined' && ${item.template.moduleName}.Init) { ${item.template.moduleName}.Init(); }`).join(' '))
    : '';
  const html = `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${htmlEscape(spec.title)}</title>\n  <link rel="stylesheet" href="../scripts_lib/hisui-0.1.0/dist/css/hisui.pure.min.css">\n  <script src="../scripts_lib/hisui-0.1.0/dist/js/jquery-1.11.3.min.js"></script>\n  <script src="../scripts_lib/hisui-0.1.0/dist/js/jquery.hisui.min.js"></script>\n  <script src="../scripts_lib/hisui-0.1.0/dist/js/locale/hisui-lang-zh_CN.js"></script>\n  <link rel="stylesheet" href="${htmlEscape(publicStylesheets.baseHref)}">\n  <link rel="stylesheet" href="${htmlEscape(publicStylesheets.responsiveHref)}">\n${stylesheetLinks ? stylesheetLinks + '\n' : ''}</head>\n<body>\n${body}${templateScriptTags}  <script src="${spec.moduleId}.js"></script>\n  <script>$(function () { ${previewInitCalls} ${spec.moduleId}.Init(); });</script>\n</body>\n</html>\n`;
  const mainScript = spec.aggregateTemplateInit === true
    ? renderMainModuleScript(spec.moduleId, templateArtifacts, spec.formType)
    : renderModuleScript(spec.moduleId, spec.formType);
  const js = prependStylesheetBootstrap(mainScript, hostStylesheetBootstrap);
  fs.writeFileSync(path.join(moduleDir, `${spec.moduleId}.html`), html, 'utf8');
  fs.writeFileSync(path.join(moduleDir, `${spec.moduleId}.js`), js, 'utf8');
  fs.writeFileSync(path.join(moduleDir, `${spec.moduleId}.fragment.html`), body, 'utf8');
  writeJson(path.join(moduleDir, 'cure-form-spec.json'), spec);
  const changes = {
    map: {
      code: spec.mapCode,
      name: spec.title,
      mapType: spec.formType,
      active: 'Y',
      composition: templates.map((template) => template.rootId),
      ...(spec.scriptHref != null ? { showJS: String(spec.scriptHref || '').trim() } : {})
    },
    ...(spec.templateCategory ? {
      templateCategory: {
        name: spec.templateCategory.name,
        type: spec.templateCategory.type || 'CATEGORY',
        content: '',
        appId: spec.templateCategory.appId || spec.moduleId,
        js: '',
        mapType: spec.formType,
        lastId: '0'
      }
    } : {}),
    templates: templateArtifacts.map(({ template, fragment, script }) => ({
      name: template.title,
      type: 'FORM',
      content: fragment,
      appId: template.rootId,
      js: script ? template.javascriptHref : '',
      mapType: spec.formType,
      lastId: '0',
      items: spec.fields.filter((field) => !field.templateKey || field.templateKey === template.key).map((field) => ({
        id: field.id,
        name: field.label || field.id,
        type: field.control || 'text',
        showJS: '',
        required: field.required ? 'Y' : 'N',
        save: 'Y',
        length: field.maxLength || '',
        xType: field.xType || '',
        xId: field.xId || '',
        printName: field.printName || '',
        refAssessmentScale: field.refAssessmentScale || ''
      }))
    })),
    resources: [
      { kind: 'html', path: `${spec.moduleId}.html` },
      { kind: 'javascript', path: spec.scriptDeploymentPath || `${spec.moduleId}.js` },
      ...stylesheets.map((stylesheet) => ({ kind: 'stylesheet', path: stylesheet.deploymentPath || stylesheet.path, loadMode: stylesheet.loadMode || 'template' })),
      ...templateArtifacts.flatMap(({ template, script, safeKey, prefix }) => isMultiTemplate ? [
        { kind: 'fragment', path: `templates/${prefix}-${safeKey}.fragment.html`, appId: template.rootId },
        ...(script ? [{ kind: 'javascript', path: template.javascriptDeploymentPath, appId: template.rootId }] : [])
      ] : [])
    ]
  };
  writeJson(path.join(moduleDir, 'cure-form-deploy-changes.json'), changes);
  return moduleDir;
}

function contractSnapshot(html) {
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]).sort();
  const cacheTags = [...html.matchAll(/\b(?:cachetag|data-cache-tag)\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]).sort();
  const choices = [...html.matchAll(/<input\b[^>]*\btype\s*=\s*["'](?:radio|checkbox)["'][^>]*>/gi)].map((match) => {
    const tag = match[0];
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(tag);
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag);
    const value = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag);
    return `${type ? type[1].toLowerCase() : ''}:${name ? name[1] : ''}=${value ? value[1] : ''}`;
  }).sort();
  return { ids, cacheTags, choices };
}

function addTagClasses(tag, requiredClasses) {
  const classMatch = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(tag);
  if (classMatch) {
    const classes = classMatch[2].split(/\s+/).filter(Boolean);
    for (const required of requiredClasses) {
      if (!classes.includes(required)) classes.push(required);
    }
    return tag.replace(classMatch[0], `class=${classMatch[1]}${classes.join(' ')}${classMatch[1]}`);
  }
  return tag.replace(/\s*(\/?)>$/, ` class="${requiredClasses.join(' ')}"$1>`);
}

function removeFixedMinWidth(tag) {
  return tag.replace(/\s+style\s*=\s*(["'])(.*?)\1/i, (whole, quote, style) => {
    const declarations = style.split(';').map((item) => item.trim()).filter(Boolean);
    const kept = declarations.filter((item) => !/^min-width\s*:/i.test(item));
    return kept.length ? ` style=${quote}${kept.join(';')};${quote}` : '';
  });
}

function addResponsiveContract(html) {
  let output = html;
  if (/<html\b/i.test(output) && !/<meta\b[^>]*name=["']viewport["']/i.test(output)) {
    output = output.replace(/<head\b[^>]*>/i, (value) => `${value}\n  <meta name="viewport" content="width=device-width, initial-scale=1">`);
  }
  if (/<html\b/i.test(output) && !/adaptation\.css/i.test(output)) {
    output = output.replace(/<\/head>/i, '  <link rel="stylesheet" href="../scripts_lib/com/css/adaptation.css">\n</head>');
  }
  output = output.replace(/<div\b[^>]*>/i, (tag) => {
    const withoutMinWidth = removeFixedMinWidth(tag);
    return addTagClasses(withoutMinWidth, ['cure-form-responsive', 'assess-form', 'assess-form--responsive']);
  });
  output = output.replace(/<table\b[^>]*>/gi, (tag, offset, source) => {
    const classMatch = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(tag);
    if (!classMatch) return tag;
    const classes = classMatch[2].split(/\s+/).filter(Boolean);
    const required = [];
    if (classes.includes('item-table')) required.push('assess-form-grid');
    if (classes.includes('item-table-line')) required.push('assess-measurement-table');
    if (!required.length) return tag;
    const nextTag = addTagClasses(tag, required);
    if (!required.includes('assess-measurement-table')) return nextTag;
    const after = source.slice(offset + tag.length);
    if (/^\s*<colgroup\b/i.test(after)) return nextTag;
    return `${nextTag}\n<colgroup><col class="assess-measurement-point"><col class="assess-measurement-value"><col class="assess-measurement-value"><col class="assess-measurement-value"></colgroup>`;
  });
  return output;
}

function prepareResponsive(args) {
  const source = path.resolve(requireOption(args, 'html'));
  const original = fs.readFileSync(source, 'utf8');
  const before = contractSnapshot(original);
  const responsive = addResponsiveContract(original);
  const after = contractSnapshot(responsive);
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('Responsive transformation changed DOM IDs, cache tags, or radio name/value pairs.');
  const output = path.resolve(args.output || source.replace(/\.html?$/i, '.responsive.html'));
  fs.writeFileSync(output, responsive, 'utf8');
  const report = {
    schema: 'cure-form-responsive-report/v1', mode: args.mode, source, output,
    sourceHash: sha256(original), outputHash: sha256(responsive), contractPreserved: true,
    widths: [360, 390, 430, 768, 810, 1024, 1080, 1194, 1280], browserVerificationRequired: true
  };
  writeJson(args.report || `${output}.report.json`, report);
  console.log(JSON.stringify(report, null, 2));
}

function cloneWithoutServerIds(value) {
  if (Array.isArray(value)) return value.map(cloneWithoutServerIds);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:rowId|RowID)$/i.test(key)) continue;
    result[key] = cloneWithoutServerIds(child);
  }
  return result;
}

function prepareCommonResponsive(args) {
  const snapshotPath = path.resolve(requireOption(args, 'snapshot'));
  const snapshot = readJson(snapshotPath);
  const formType = assertFormType(snapshot.formType || snapshot.MapType);
  if (!Array.isArray(snapshot.templates) || !snapshot.templates.length) fail('Server snapshot must contain templates[].');
  const outputRoot = path.resolve(requireOption(args, 'outputRoot'));
  ensureDir(outputRoot);
  const versionLabel = cleanText(args.versionLabel || `v${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`);
  const converted = [];
  const contracts = [];
  for (const sourceTemplate of snapshot.templates) {
    const original = String(sourceTemplate.content || sourceTemplate.ConT || '');
    if (!original) fail(`Template ${sourceTemplate.rowId || sourceTemplate.name || 'unknown'} has no HTML content.`);
    const before = contractSnapshot(original);
    const content = addResponsiveContract(original);
    const after = contractSnapshot(content);
    if (JSON.stringify(before) !== JSON.stringify(after)) fail(`Responsive transformation changed the runtime contract for template ${sourceTemplate.rowId || sourceTemplate.name || 'unknown'}.`);
    const clone = cloneWithoutServerIds(sourceTemplate);
    clone.name = `${sourceTemplate.name || sourceTemplate.Name || '治疗模板'} ${versionLabel}`;
    clone.content = content;
    clone.sourceTemplateRowId = String(sourceTemplate.rowId || sourceTemplate.RowID || '');
    clone.lastId = clone.sourceTemplateRowId || String(sourceTemplate.lastId || sourceTemplate.LastId || '0');
    clone.items = Array.isArray(clone.items) ? clone.items : [];
    converted.push(clone);
    contracts.push({
      sourceTemplateRowId: clone.sourceTemplateRowId,
      sourceHash: sha256(original),
      outputHash: sha256(content),
      contractPreserved: true
    });
  }
  const changes = {
    schema: 'cure-form-responsive-changes/v1',
    formType,
    mapCode: snapshot.mapCode || snapshot.MapCode || null,
    strategy: 'versioned-clone',
    versionLabel,
    templates: converted
  };
  const report = {
    schema: 'cure-form-responsive-report/v1',
    mode: 'common-responsive',
    source: snapshotPath,
    formType,
    strategy: 'versioned-clone',
    templates: contracts,
    runtimeContract: {
      requiredInterfaces: formType === 'CR'
        ? ['Init', 'OtherInfo', 'PrintInfo', 'SaveCureRecord', 'CureExpJsonStr', 'MapID']
        : ['Init', 'OtherInfo', 'PrintInfo']
    },
    widths: [360, 390, 430, 768, 810, 1024, 1080, 1194, 1280],
    browserVerificationRequired: true
  };
  const changesPath = writeJson(path.join(outputRoot, 'responsive-changes.json'), changes);
  const reportPath = writeJson(path.join(outputRoot, 'responsive-report.json'), report);
  console.log(JSON.stringify({ command: 'prepare', mode: 'common-responsive', changes: changesPath, report: reportPath, templates: converted.length }, null, 2));
}

function commandPrepare(args) {
  const mode = args.mode || 'create';
  if (!['create', 'responsive', 'common-responsive'].includes(mode)) fail('prepare --mode must be create, responsive, or common-responsive.');
  if (mode === 'responsive') return prepareResponsive({ ...args, mode });
  if (mode === 'common-responsive') return prepareCommonResponsive(args);
  const spec = validateSpec(readJson(projectPath(args, requireOption(args, 'spec'))), { approved: true });
  validatePublicResponsiveBoundary(spec, args, false);
  const outputRoot = args.outputRoot ? projectPath(args, args.outputRoot) : developmentRoot(args);
  const output = renderCreate(spec, outputRoot);
  console.log(JSON.stringify({ command: 'prepare', mode, output, formType: spec.formType }, null, 2));
}

function commandReview(args) {
  const file = path.resolve(requireOption(args, 'spec'));
  const spec = validateSpec(readJson(file), { readyForApproval: true });
  if (spec.unresolved.length) fail(`Cannot approve: unresolved[] contains ${spec.unresolved.length} item(s). Resolve them explicitly in the specification first.`);
  const copy = JSON.parse(JSON.stringify(spec));
  delete copy.approval;
  spec.approval = {
    approvedBy: requireOption(args, 'approvedBy'),
    approvedAt: new Date().toISOString(),
    unresolvedCount: 0,
    specHash: sha256(copy)
  };
  writeJson(args.output || file, spec);
  console.log(JSON.stringify({ command: 'review', approved: true, specHash: spec.approval.specHash }, null, 2));
}

function approvedCloneMap(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) && value.approvedClones
    ? value.approvedClones
    : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('approved-clones must be a JSON object keyed by source template rowId.');
  const result = {};
  for (const [sourceRowId, approvedRowId] of Object.entries(source)) {
    const sourceId = cleanText(sourceRowId);
    const targetId = cleanText(approvedRowId);
    if (!/^\d+$/.test(sourceId) || !/^\d+$/.test(targetId)) fail('approved-clones keys and values must be numeric template rowIds.');
    result[sourceId] = targetId;
  }
  return result;
}

function applyApprovedCloneReferences(changes, spec, approvedClones) {
  const output = JSON.parse(JSON.stringify(changes || {}));
  if (!Array.isArray(output.templates)) fail('changes.templates[] is required when --approved-clones is used.');
  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  const references = [];
  let sectionIndex = 0;
  output.templates = output.templates.map((template) => {
    if (template && template.referenceOnly) return template;
    const section = sections[sectionIndex++] || {};
    const sourceTemplateRowId = cleanText(template && template.sourceTemplateRowId || section.id || section.rowId || '');
    if (!sourceTemplateRowId) fail('Every created template must expose sourceTemplateRowId or align with specification.sections[] when --approved-clones is used.');
    const approvedCloneRowId = approvedClones[sourceTemplateRowId];
    if (!approvedCloneRowId) return { ...template, sourceTemplateRowId };
    references.push({ sourceTemplateRowId, approvedCloneRowId });
    return {
      rowId: approvedCloneRowId,
      referenceOnly: true,
      sourceTemplateRowId,
      reuseReason: 'approved-common-template'
    };
  });
  return { changes: output, references };
}

function commandPlan(args) {
  const spec = validateSpec(readJson(requireOption(args, 'spec')), { approved: true });
  validatePublicResponsiveBoundary(spec, args, true);
  const snapshot = args.snapshot ? readJson(args.snapshot) : null;
  if (snapshot) assertFormType(snapshot.formType || snapshot.MapType);
  if (snapshot && String(snapshot.mapCode || snapshot.MapCode) !== spec.mapCode) fail('Snapshot mapCode does not match specification mapCode.');
  const snapshotVersion = snapshot ? (snapshot.version ?? snapshot.Version) : undefined;
  const snapshotContentHash = snapshot ? (snapshot.contentHash ?? snapshot.ContentHash) : undefined;
  const snapshotIsMissing = Boolean(snapshot && (snapshot.exists === false || snapshot.exists === 0));
  const hasChanges = Boolean(args.changes);
  let changes = hasChanges ? readJson(args.changes) : {};
  let commonTemplateReferences = [];
  if (args.approvedClones) {
    const resolved = applyApprovedCloneReferences(changes, spec, approvedCloneMap(readJson(args.approvedClones)));
    changes = resolved.changes;
    commonTemplateReferences = resolved.references;
  }
  const packageValue = {
    schema: 'cure-form-package/v1',
    formType: spec.formType,
    moduleId: spec.moduleId,
    mapCode: spec.mapCode,
    title: spec.title,
    expectedVersion: snapshotIsMissing ? 'NEW' : (snapshotVersion ?? args.expectedVersion ?? 'NEW'),
    expectedContentHash: snapshotIsMissing ? null : (snapshotContentHash ?? args.expectedContentHash ?? null),
    approvedSpecHash: spec.approval.specHash,
    specification: spec,
    changes,
    commonTemplateReferences,
    deploymentReady: hasChanges,
    audit: { operator: args.operator || null, reason: args.reason || null },
    dryRun: true,
    createdAt: new Date().toISOString()
  };
  const output = path.resolve(args.output || path.join(workRoot(args), 'packages', `${spec.mapCode}-${Date.now()}.json`));
  writeJson(output, packageValue);
  console.log(JSON.stringify({ command: 'plan', output, dryRun: true, packageHash: sha256(packageValue) }, null, 2));
}

function validatePackage(value, write) {
  if (!value || value.schema !== 'cure-form-package/v1') fail('Expected cure-form-package/v1.');
  assertFormType(value.formType);
  validateSpec(value.specification, { approved: true });
  if (value.mapCode !== value.specification.mapCode || value.formType !== value.specification.formType) fail('Package target does not match specification.');
  if (!value.deploymentReady) fail('Package is review-only because no confirmed changes payload was supplied.');
  const expectedTemplateCount = Number(value.specification.expectedTemplateCount || 0);
  if (expectedTemplateCount > 0) {
    const changeTemplates = value.changes && Array.isArray(value.changes.templates) ? value.changes.templates : [];
    const composition = value.changes && value.changes.map && Array.isArray(value.changes.map.composition) ? value.changes.map.composition : [];
    const fragmentResources = value.changes && Array.isArray(value.changes.resources)
      ? value.changes.resources.filter((resource) => resource.kind === 'fragment')
      : [];
    if (changeTemplates.length !== expectedTemplateCount || composition.length !== expectedTemplateCount || fragmentResources.length !== expectedTemplateCount) {
      fail(`Multi-template package count mismatch: expected ${expectedTemplateCount} templates, composition entries, and fragment resources.`);
    }
    const expectedComposition = [...value.specification.templates].sort((a, b) => Number(a.order) - Number(b.order)).map((template) => template.rootId);
    if (JSON.stringify(composition) !== JSON.stringify(expectedComposition)) fail('Multi-template package composition order does not match the approved specification.');
  }
  if (write && (!value.audit || !cleanText(value.audit.operator) || !cleanText(value.audit.reason))) fail('Write package requires operator and reason.');
  return value;
}

function commandApply(args) {
  const packageValue = readJson(requireOption(args, 'package'));
  if (args.confirmWrite) {
    packageValue.audit = packageValue.audit || {};
    packageValue.audit.operator = requireOption(args, 'operator');
    packageValue.audit.reason = requireOption(args, 'reason');
  }
  validatePackage(packageValue, Boolean(args.confirmWrite));
  if (!args.confirmWrite) {
    const serverValidation = args.confirmRemoteExecution
      ? invokeServer('ValidatePackage', [JSON.stringify(packageValue)], args, false)
      : null;
    if (serverValidation && !resultIsOk(serverValidation)) {
      fail(`Server validation rejected the package: ${JSON.stringify(serverValidation)}`);
    }
    const result = { command: 'apply', dryRun: true, valid: true, formType: packageValue.formType, mapCode: packageValue.mapCode, packageHash: sha256(packageValue), serverValidation };
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const result = invokeServer('ApplyPackage', [JSON.stringify(packageValue), packageValue.audit.operator, packageValue.audit.reason], args, true);
  console.log(JSON.stringify({ command: 'apply', dryRun: false, result }, null, 2));
}

function commandVerify(args) {
  const result = invokeServer('VerifyOperation', [requireOption(args, 'operationId')], args, false);
  console.log(JSON.stringify({ command: 'verify', result }, null, 2));
}

function commandRollback(args) {
  if (!args.confirmWrite) fail('Rollback changes server state and requires --confirm-write.');
  const result = invokeServer('RollbackOperation', [requireOption(args, 'operationId'), requireOption(args, 'operator'), requireOption(args, 'reason')], args, true);
  console.log(JSON.stringify({ command: 'rollback', result }, null, 2));
}

function commandCommonMigrate(args) {
  const source = readJson(requireOption(args, 'inventory'));
  const rows = Array.isArray(source) ? source : source.maps;
  if (!Array.isArray(rows)) fail('Inventory must be an array or contain maps[].');
  const allowed = rows.filter((row) => FORM_TYPES.has(String(row.formType || row.MapType || '').toUpperCase())).map((row) => ({
    mapCode: row.mapCode || row.MapCode || '',
    mapName: row.mapName || row.MapName || '',
    formType: String(row.formType || row.MapType || '').toUpperCase(),
    composition: row.composition || row.Composition || '',
    active: row.active || row.Active || ''
  }));
  const excluded = rows.length - allowed.length;
  const order = ['LymphedemaLimb', 'PhysicalTherapy', 'CR-PTTemp'];
  const rank = (row) => {
    const code = row.mapCode || '';
    const index = order.indexOf(code);
    if (index >= 0) return index;
    return row.formType === 'CA' ? 100 : 200;
  };
  allowed.sort((a, b) => rank(a) - rank(b));
  const approvedClones = args.approvedClones ? readJson(args.approvedClones) : {};
  const publicTemplates = [
    { sourceTemplateRowId: '51', formTypes: ['CA', 'CR'] },
    { sourceTemplateRowId: '52', formTypes: ['CA', 'CR'] },
    { sourceTemplateRowId: '53', formTypes: ['CA', 'CR'] },
    { sourceTemplateRowId: '57', formTypes: ['CA', 'CR'] },
    { sourceTemplateRowId: '141', formTypes: ['CR'] }
  ].map((template) => ({ ...template, approvedCloneRowId: approvedClones[template.sourceTemplateRowId] || null }));
  const plan = {
    schema: 'cure-form-common-migration/v1', strategy: 'versioned-clone', dryRun: true,
    seedTemplates: { crossType: [51, 52, 53, 57], CR: [141] },
    publicTemplates,
    maps: allowed, excludedNonCureOrPathology: excluded,
    gates: ['clone', 'responsive-verify', 'approve', 'switch-canary', 'verify', 'expand', 'rollback-ready']
  };
  const output = path.resolve(args.output || path.join(workRoot(args), 'common-migration-plan.json'));
  writeJson(output, plan);
  console.log(JSON.stringify({ command: 'common-migrate', output, included: allowed.length, excluded }, null, 2));
}

function usage() {
  console.log(`Usage: cure-form <command> [options]\nCommands: ${[...COMMANDS].join(', ')}\nDocument create defaults: --project-root <cwd>, source discovery under docs/, generated files under docs/cure-form/<moduleId>/. Use --source, --docs-root, --development-root, or --output-root to override.`);
}

function main() {
  assertNodeVersion();
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) return usage();
  if (!COMMANDS.has(command)) fail(`Unknown command: ${command}`);
  const handlers = {
    doctor: commandDoctor,
    intake: commandIntake,
    inspect: commandInspect,
    prepare: commandPrepare,
    review: commandReview,
    plan: commandPlan,
    apply: commandApply,
    verify: commandVerify,
    rollback: commandRollback,
    'common-migrate': commandCommonMigrate
  };
  handlers[command](args);
}

module.exports = { addResponsiveContract, assertFormType, contractSnapshot, objectScriptArgument, sha256, structureToSpec, unwrapServerResult, validatePackage, validateSpec };

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`ERROR=${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}
