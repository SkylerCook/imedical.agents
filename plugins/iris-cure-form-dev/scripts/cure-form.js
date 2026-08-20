#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MIN_NODE = [22, 5, 0];
const FORM_TYPES = new Set(['CA', 'CR']);
const CURE_FORM_DEPLOY_CLASS = 'DHCDoc.Cure.AI.CureFormDeploy';
const REMOTE_CHUNK_SIZE = 12000;
const MAX_REMOTE_RESULT_LENGTH = 5 * 1024 * 1024;
const MAX_INLINE_SERVER_ARGUMENT = 8000;
const DOCUMENT_SOURCE_EXTENSIONS = new Set(['.doc', '.docx', '.pdf', '.xls', '.xlsx']);
const PREVIEW_WIDTHS = [360, 390, 430, 768, 810, 1024, 1080, 1194, 1280];
const PREVIEW_GATE_VERSION = 'cure-form-preview-gate/2';
const PREVIEW_RUNNER_SCHEMA = 'cure-form-browser-runner/v1';
const INTERACTION_REPORT_SCHEMA = 'cure-form-interaction-report/v1';
const INTERACTION_VERIFICATION_SCHEMA = 'cure-form-interaction-verification/v1';
const PREVIEW_MANIFEST_PLACEHOLDER = '__CURE_FORM_PREVIEW_MANIFEST_HASH__';
const PREVIEW_REQUIRED_CHECKS = [
  'preview-html-integrity', 'resources', 'css-dependencies', 'network-errors', 'console-errors', 'jquery', 'parser',
  'panel', 'radio', 'radio-atomic-pairing', 'horizontal-overflow', 'runtime-errors'
];
const PREVIEW_RESOURCE_SPECS = [
  { role: 'hisuiCss', profileKey: 'PreviewHisuiCss', basename: 'hisui.pure.min.css', tag: 'link' },
  { role: 'jqueryJs', profileKey: 'PreviewJqueryJs', basename: 'jquery-1.11.3.min.js', tag: 'script' },
  { role: 'hisuiJs', profileKey: 'PreviewHisuiJs', basename: 'jquery.hisui.min.js', tag: 'script' },
  { role: 'hisuiLocaleJs', profileKey: 'PreviewHisuiLocaleJs', basename: 'hisui-lang-zh_CN.js', tag: 'script' },
  { role: 'asscomCss', profileKey: 'PreviewAsscomCss', basename: 'asscom.css', tag: 'link' },
  { role: 'adaptationCss', profileKey: 'PreviewAdaptationCss', basename: 'adaptation.css', tag: 'link' }
];
const COMMANDS = new Set([
  'doctor', 'intake', 'inspect', 'prepare', 'review', 'plan',
  'preview', 'preview-run', 'preview-check', 'interaction-prepare', 'interaction-check',
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

function resourceBasename(reference) {
  return path.posix.basename(String(reference || '').replace(/\\/g, '/').split(/[?#]/, 1)[0]);
}

function parseMarkdownProfile(file) {
  const result = {};
  if (!file || !fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*-\s*([^:]+):\s*(.*?)\s*$/.exec(line);
    if (match) result[match[1].trim()] = match[2].trim();
  }
  return result;
}

function htmlAttribute(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match ? match[2] : '';
}

function htmlHasClass(tag, className) {
  return htmlAttribute(tag, 'class').split(/\s+/).includes(className);
}

function htmlTagsWithScope(html, scopeClass) {
  const tokens = String(html || '').match(/<\/?[A-Za-z][^>]*>/g) || [];
  const stack = [false];
  const result = [];
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const tag of tokens) {
    if (/^<\//.test(tag)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const nameMatch = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(tag);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    const inScope = stack[stack.length - 1] || htmlHasClass(tag, scopeClass);
    result.push({ tag, inScope });
    if (!voidElements.has(name) && !/\/>\s*$/.test(tag)) stack.push(inScope);
  }
  return result;
}

function resourceReferencesFromHtml(html) {
  const result = {};
  const tags = String(html || '').match(/<(?:link|script)\b[^>]*>/gi) || [];
  for (const spec of PREVIEW_RESOURCE_SPECS) {
    const attribute = spec.tag === 'link' ? 'href' : 'src';
    const matches = tags.map((tag) => htmlAttribute(tag, attribute)).filter((value) => resourceBasename(value) === spec.basename);
    if (matches.length > 1) fail(`Existing page declares preview resource ${spec.basename} more than once.`);
    if (matches.length === 1) result[spec.role] = matches[0];
  }
  return result;
}

function pathIsWithin(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function copyPreviewCssDependencies(sourceCss, targetCss, outputDir, args, state) {
  const sourceKey = path.resolve(sourceCss).toLowerCase();
  if (state.visited.has(sourceKey)) return;
  state.visited.add(sourceKey);
  const css = fs.readFileSync(sourceCss, 'utf8');
  const references = [];
  const pattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  let match;
  while ((match = pattern.exec(css)) !== null) references.push(match[2].trim());
  const importPattern = /@import\s+(["'])([^"']+)\1/gi;
  while ((match = importPattern.exec(css)) !== null) references.push(match[2].trim());
  for (const reference of [...new Set(references)]) {
    if (!reference || /^(?:data:|#)/i.test(reference)) continue;
    if (/^(?:https?:|\/\/)/i.test(reference)) {
      fail(`Preview CSS dependency must be local and hashable: ${reference}`);
    }
    const cleanReference = reference.split(/[?#]/, 1)[0];
    if (!cleanReference) continue;
    const sourceAsset = reference.startsWith('/')
      ? path.resolve(projectRoot(args), cleanReference.replace(/^\/+/, ''))
      : path.resolve(path.dirname(sourceCss), cleanReference);
    const targetAsset = reference.startsWith('/')
      ? path.resolve(outputDir, cleanReference.replace(/^\/+/, ''))
      : path.resolve(path.dirname(targetCss), cleanReference);
    if (!pathIsWithin(targetAsset, outputDir)) {
      fail(`Preview CSS dependency escapes the output directory: ${reference}`);
    }
    const href = path.relative(outputDir, targetAsset).replace(/\\/g, '/');
    if (!fs.existsSync(sourceAsset) || !fs.statSync(sourceAsset).isFile()) {
      state.unresolved.push({ stylesheet: path.basename(sourceCss), reference, href, reason: 'source-missing' });
      continue;
    }
    const contentHash = crypto.createHash('sha256').update(fs.readFileSync(sourceAsset)).digest('hex');
    const existing = state.targets.get(path.resolve(targetAsset).toLowerCase());
    if (existing && existing.contentHash !== contentHash) {
      fail(`Preview CSS dependencies collide at ${href}: ${existing.source} and ${sourceAsset}`);
    }
    ensureDir(path.dirname(targetAsset));
    fs.copyFileSync(sourceAsset, targetAsset);
    const dependency = { href, basename: path.basename(targetAsset), contentHash };
    state.targets.set(path.resolve(targetAsset).toLowerCase(), { ...dependency, source: sourceAsset });
    state.dependencies.set(href, dependency);
    if (/\.css$/i.test(cleanReference)) copyPreviewCssDependencies(sourceAsset, targetAsset, outputDir, args, state);
  }
}

function createCssDependencyState() {
  return { visited: new Set(), targets: new Map(), dependencies: new Map(), unresolved: [] };
}

function cssDependencyManifest(state) {
  return {
    dependencies: [...state.dependencies.values()].sort((a, b) => a.href.localeCompare(b.href)),
    unresolved: [...state.unresolved].sort((a, b) => `${a.stylesheet}:${a.reference}`.localeCompare(`${b.stylesheet}:${b.reference}`))
  };
}

function previewProfilePath(args) {
  if (args.targetProfile) return projectPath(args, args.targetProfile);
  return path.join(projectRoot(args), '.agents', 'config', 'cure_form_profile.md');
}

function resolvePreviewResource(reference, spec, baseDir, outputDir, args, copyLocal) {
  const value = String(reference || '').trim();
  if (!value || /^<?(?:required|unset|todo)>?$/i.test(value)) {
    fail(`Preview resource ${spec.profileKey} is not configured.`);
  }
  if (resourceBasename(value) !== spec.basename) {
    fail(`Preview resource ${spec.profileKey} must resolve to ${spec.basename}: ${value}`);
  }
  if (/^(?:https?:)?\/\//i.test(value)) {
    if (copyLocal) fail(`Canonical preview requires a local hashable resource for ${spec.profileKey}: ${value}`);
    return { role: spec.role, basename: spec.basename, tag: spec.tag, href: value, local: false, contentHash: null };
  }

  let localPath;
  if (/^\//.test(value)) {
    localPath = path.resolve(projectRoot(args), value.replace(/^\/+/, ''));
  } else {
    localPath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(baseDir, value);
  }
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    fail(`Preview resource file does not exist: ${value}`);
  }

  let href;
  const contentHash = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex');
  if (copyLocal) {
    const assetsDir = path.join(outputDir, 'assets');
    ensureDir(assetsDir);
    const target = path.join(assetsDir, spec.basename);
    const existing = args.cssDependencyState.targets.get(path.resolve(target).toLowerCase());
    if (existing && existing.contentHash !== contentHash) {
      fail(`Preview resource collides with CSS dependency at assets/${spec.basename}: ${existing.source} and ${localPath}`);
    }
    args.cssDependencyState.targets.set(path.resolve(target).toLowerCase(), { href: `assets/${spec.basename}`, basename: spec.basename, contentHash, source: localPath });
    fs.copyFileSync(localPath, target);
    if (spec.tag === 'link') copyPreviewCssDependencies(localPath, target, outputDir, args, args.cssDependencyState);
    href = `assets/${spec.basename}`;
  } else {
    href = path.relative(outputDir, localPath).replace(/\\/g, '/');
    if (!href.startsWith('.')) href = `./${href}`;
  }
  return {
    role: spec.role,
    basename: spec.basename,
    tag: spec.tag,
    href,
    local: true,
    contentHash
  };
}

function resolvePreviewResources(args, outputDir, options = {}) {
  const profileFile = previewProfilePath(args);
  const profile = parseMarkdownProfile(profileFile);
  const pageFile = args.pageHtml ? projectPath(args, args.pageHtml) : null;
  if (pageFile && (!fs.existsSync(pageFile) || !fs.statSync(pageFile).isFile())) {
    fail(`Existing page for preview resource discovery does not exist: ${pageFile}`);
  }
  const pageReferences = pageFile ? resourceReferencesFromHtml(fs.readFileSync(pageFile, 'utf8')) : {};
  const missing = [];
  const resources = [];
  for (const spec of PREVIEW_RESOURCE_SPECS) {
    const pageReference = pageReferences[spec.role];
    const profileReference = profile[spec.profileKey];
    const reference = profileReference || pageReference;
    if (!reference) {
      missing.push(`${spec.profileKey} (${spec.basename})`);
      continue;
    }
    resources.push(resolvePreviewResource(
      reference,
      spec,
      profileReference ? projectRoot(args) : path.dirname(pageFile),
      outputDir,
      { ...args, cssDependencyState: options.cssDependencyState },
      options.copyLocal === true
    ));
  }
  if (missing.length) {
    fail(`Complete preview requires all target resources. Missing: ${missing.join(', ')}. Configure ${profileFile} or provide --page-html.`);
  }
  return resources;
}

function assertCompletePreviewResources(html) {
  const references = resourceReferencesFromHtml(html);
  const missing = PREVIEW_RESOURCE_SPECS.filter((spec) => !references[spec.role]).map((spec) => spec.basename);
  if (missing.length) fail(`Complete HTML is missing required preview resources: ${missing.join(', ')}.`);
  return references;
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
  const methodCall = `##class(${CURE_FORM_DEPLOY_CLASS}).${method}(${methodArgs.map(objectScriptArgument).join(',')})`;
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

function renderPreviewResourceTags(resources, tracked = false) {
  return resources.map((resource) => {
    const state = tracked
      ? ` data-cure-preview-resource="${resource.role}" onload="window.__curePreviewResource('${resource.role}','loaded')" onerror="window.__curePreviewResource('${resource.role}','error')"`
      : '';
    if (resource.tag === 'link') return `  <link rel="stylesheet" href="${htmlEscape(resource.href)}"${state}>`;
    return `  <script src="${htmlEscape(resource.href)}"${state}></script>`;
  }).join('\n');
}

function renderPreviewProbe(manifestHash, resources) {
  const roles = resources.map((resource) => resource.role);
  return `<script>
(function () {
  'use strict';
  var states = {};
  var runtimeErrors = [];
  var roles = ${JSON.stringify(roles)};
  roles.forEach(function (role) { states[role] = 'pending'; });
  window.__curePreviewResource = function (role, state) { states[role] = state; };
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target.getAttribute && target.getAttribute('data-cure-preview-resource')) { return; }
    runtimeErrors.push(String(event && (event.message || event.error) || 'window error'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    runtimeErrors.push(String(event && event.reason || 'unhandled rejection'));
  });
  window.__cureFormPreviewCheck = function () {
    var jq = window.jQuery;
    var parserAvailable = Boolean(jq && jq.parser && typeof jq.parser.parse === 'function');
    if (parserAvailable) {
      try { jq.parser.parse(document.body); } catch (error) { runtimeErrors.push('parser: ' + String(error && error.message || error)); }
    }
    var panels = Array.prototype.slice.call(document.querySelectorAll('.hisui-panel'));
    var initializedPanels = 0;
    panels.forEach(function (panel) {
      try {
        if (jq && jq.fn && typeof jq.fn.panel === 'function' && jq(panel).panel('options')) { initializedPanels += 1; }
      } catch (error) { runtimeErrors.push('panel: ' + String(error && error.message || error)); }
    });
    var radios = Array.prototype.slice.call(document.querySelectorAll('input[type="radio"]'));
    var generatedLabels = radios.filter(function (radio) {
      var id = radio.getAttribute('id');
      var next = radio.nextElementSibling;
      if (next && next.matches && next.matches('label.radio')) { return true; }
      if (!id) { return false; }
      var labels = document.querySelectorAll('label.radio[for]');
      for (var index = 0; index < labels.length; index += 1) {
        if (labels[index].getAttribute('for') === id) { return true; }
      }
      return false;
    }).length;
    var hisuiRadioTargets = Array.prototype.slice.call(document.querySelectorAll('.assess-form input[type="radio"].hisui-radio.radio-f'));
    var completeHisuiRadioPairs = 0;
    var brokenHisuiRadioPairs = 0;
    var unpairedHisuiRadios = 0;
    hisuiRadioTargets.forEach(function (radio) {
      var id = radio.getAttribute('id');
      var assessForm = radio.parentElement;
      while (assessForm && !(assessForm.matches && assessForm.matches('.assess-form'))) { assessForm = assessForm.parentElement; }
      var semanticLabels = assessForm ? Array.prototype.slice.call(assessForm.querySelectorAll('label.i-label-box[for], label.m-label-box[for]')) : [];
      var generatedLabel = radio.nextElementSibling;
      var semanticLabel = generatedLabel && generatedLabel.nextElementSibling;
      var generatedIsAdjacent = Boolean(generatedLabel && generatedLabel.matches && generatedLabel.matches('label.radio'));
      var semanticIsAdjacent = Boolean(semanticLabel && semanticLabel.matches && semanticLabel.matches('label.i-label-box, label.m-label-box'));
      var semanticForMatches = Boolean(id && semanticIsAdjacent && semanticLabel.getAttribute('for') === id);
      var hasMatchingSemanticLabel = Boolean(id && semanticLabels.some(function (label) {
        return label.getAttribute('for') === id;
      }));
      if (generatedIsAdjacent && semanticForMatches) {
        completeHisuiRadioPairs += 1;
      } else if (hasMatchingSemanticLabel) {
        brokenHisuiRadioPairs += 1;
      } else {
        unpairedHisuiRadios += 1;
      }
    });
    var resourceStates = roles.map(function (role) { return { role: role, state: states[role] || 'missing' }; });
    var networkErrors = [];
    if (window.performance && typeof window.performance.getEntriesByType === 'function') {
      window.performance.getEntriesByType('resource').forEach(function (entry) {
        if (typeof entry.responseStatus === 'number' && entry.responseStatus >= 400) {
          networkErrors.push({ url: String(entry.name || ''), status: entry.responseStatus });
        }
      });
    }
    return {
      schema: 'cure-form-browser-result/v1',
      manifestHash: ${JSON.stringify(manifestHash)},
      width: window.innerWidth,
      resources: resourceStates,
      checks: {
        jqueryAvailable: Boolean(jq),
        parserAvailable: parserAvailable,
        panelCount: panels.length,
        initializedPanelCount: initializedPanels,
        radioCount: radios.length,
        generatedRadioLabelCount: generatedLabels,
        hisuiRadioTargetCount: hisuiRadioTargets.length,
        completeHisuiRadioPairCount: completeHisuiRadioPairs,
        brokenHisuiRadioPairCount: brokenHisuiRadioPairs,
        unpairedHisuiRadioCount: unpairedHisuiRadios,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      },
      networkErrors: networkErrors,
      consoleErrors: [],
      runtimeErrors: runtimeErrors.slice()
    };
  };
  window.addEventListener('load', function () {
    window.setTimeout(function () { window.__cureFormPreviewLatest = window.__cureFormPreviewCheck(); }, 0);
  });
}());
</script>`;
}

function renderCompletePreview(title, body, resources, manifestHash = null) {
  const probe = manifestHash ? renderPreviewProbe(manifestHash, resources) : '';
  const resourceTags = renderPreviewResourceTags(resources, Boolean(manifestHash));
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <link rel="icon" href="data:,">\n  <title>${htmlEscape(title)}</title>\n${probe ? probe + '\n' : ''}${resourceTags}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function renderCreate(spec, outputRoot, args) {
  const moduleDir = path.join(path.resolve(outputRoot), spec.moduleId);
  ensureDir(moduleDir);
  const isMultiTemplate = Array.isArray(spec.templates) && spec.templates.length > 0;
  const templates = isMultiTemplate
    ? [...spec.templates].sort((a, b) => Number(a.order) - Number(b.order))
    : [{ key: 'main', order: 1, title: spec.title, rootId: spec.moduleId, moduleName: spec.moduleId }];
  const templateDir = path.join(moduleDir, 'templates');
  if (isMultiTemplate) ensureDir(templateDir);
  const stylesheets = Array.isArray(spec.stylesheets) ? spec.stylesheets : [];
  const previewResources = resolvePreviewResources(args, moduleDir);
  const previewByRole = Object.fromEntries(previewResources.map((resource) => [resource.role, resource]));
  const publicStylesheets = spec.publicStylesheets || {
    baseHref: previewByRole.asscomCss.href,
    responsiveHref: previewByRole.adaptationCss.href
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
  const previewBody = `${body}${templateScriptTags}  <script src="${spec.moduleId}.js"></script>\n  <script>$(function () { ${previewInitCalls} ${spec.moduleId}.Init(); });</script>`;
  let html = renderCompletePreview(spec.title, previewBody, previewResources);
  if (stylesheetLinks) html = html.replace('</head>', `${stylesheetLinks}\n</head>`);
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
  if (/<html\b/i.test(responsive)) assertCompletePreviewResources(responsive);
  const after = contractSnapshot(responsive);
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('Responsive transformation changed DOM IDs, cache tags, or radio name/value pairs.');
  const output = path.resolve(args.output || source.replace(/\.html?$/i, '.responsive.html'));
  fs.writeFileSync(output, responsive, 'utf8');
  const report = {
    schema: 'cure-form-responsive-report/v1', mode: args.mode, source, output,
    sourceHash: sha256(original), outputHash: sha256(responsive), contractPreserved: true,
    widths: PREVIEW_WIDTHS, browserVerificationRequired: true
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
    widths: PREVIEW_WIDTHS,
    browserVerificationRequired: true
  };
  const changesPath = writeJson(path.join(outputRoot, 'responsive-changes.json'), changes);
  const reportPath = writeJson(path.join(outputRoot, 'responsive-report.json'), report);
  console.log(JSON.stringify({ command: 'prepare', mode: 'common-responsive', changes: changesPath, report: reportPath, templates: converted.length }, null, 2));
}

function previewBodyFromChanges(changes) {
  if (!changes || typeof changes !== 'object' || !Array.isArray(changes.templates) || !changes.templates.length) {
    fail('Preview changes must contain templates[].');
  }
  const fragments = changes.templates.filter((template) => !template.referenceOnly).map((template) => {
    const content = String(template && (template.content || template.ConT) || '').trim();
    if (!content) fail(`Preview template ${template && (template.appId || template.name) || 'unknown'} has no HTML content.`);
    if (/<(?:html|head|body)\b/i.test(content)) fail('Preview changes must contain template fragments rather than complete HTML pages.');
    return content;
  });
  if (!fragments.length) fail('Preview changes contain no materialized template fragments.');
  return `<main id="cure-form-preview-root">\n${fragments.join('\n')}\n</main>`;
}

function previewRuntimeExpectations(body) {
  const tags = String(body || '').match(/<[^>]+>/g) || [];
  const scopedTags = htmlTagsWithScope(body, 'assess-form').filter((item) => item.inScope).map((item) => item.tag);
  const panelCount = tags.filter((tag) => /\bclass\s*=\s*(["'])[^"']*\bhisui-panel\b[^"']*\1/i.test(tag)).length;
  const radioTags = tags.filter((tag) => /^<input\b/i.test(tag) && /\btype\s*=\s*(["'])radio\1/i.test(tag));
  const semanticLabels = scopedTags.filter((tag) => /^<label\b/i.test(tag) && (htmlHasClass(tag, 'i-label-box') || htmlHasClass(tag, 'm-label-box')));
  // Source templates normally gain `radio-f` only after HISUI parsing. The
  // browser probe verifies the exact initialized `.hisui-radio.radio-f` shape.
  const hisuiRadios = scopedTags.filter((tag) => /^<input\b/i.test(tag) && /\btype\s*=\s*(["'])radio\1/i.test(tag) && htmlHasClass(tag, 'hisui-radio'));
  const semanticRadioPairCount = hisuiRadios.filter((tag) => {
    const id = htmlAttribute(tag, 'id');
    return Boolean(id && semanticLabels.some((label) => htmlAttribute(label, 'for') === id));
  }).length;
  if (panelCount < 1) fail('Preview changes must contain at least one .hisui-panel for browser initialization verification.');
  return { panelCount, radioCount: radioTags.length, hisuiRadioCount: hisuiRadios.length, semanticRadioPairCount };
}

function commandPreview(args) {
  const changesPath = projectPath(args, requireOption(args, 'changes'));
  const changes = readJson(changesPath);
  const snapshot = args.snapshot ? readJson(projectPath(args, args.snapshot)) : null;
  if (snapshot) assertFormType(snapshot.formType || snapshot.MapType);
  const outputRoot = args.outputRoot ? projectPath(args, args.outputRoot) : path.join(workRoot(args), 'preview');
  ensureDir(outputRoot);
  const cssState = createCssDependencyState();
  const resources = resolvePreviewResources(args, outputRoot, { copyLocal: true, cssDependencyState: cssState });
  const cssDependencies = cssDependencyManifest(cssState);
  const dependencyHash = sha256(cssDependencies);
  const title = cleanText(args.title || changes.title || (changes.map && (changes.map.name || changes.map.code)) || (snapshot && (snapshot.mapName || snapshot.MapName || snapshot.mapCode || snapshot.MapCode)) || 'Cure Form Preview');
  const body = previewBodyFromChanges(changes);
  const expectedRuntime = previewRuntimeExpectations(body);
  const htmlTemplate = renderCompletePreview(title, body, resources, PREVIEW_MANIFEST_PLACEHOLDER);
  const manifest = {
    schema: 'cure-form-preview-manifest/v1',
    title,
    previewHtml: 'preview.html',
    gateVersion: PREVIEW_GATE_VERSION,
    requiredChecksHash: sha256(PREVIEW_REQUIRED_CHECKS),
    changesHash: sha256(changes),
    snapshotHash: snapshot ? sha256(snapshot) : null,
    previewHtmlTemplateHash: sha256(htmlTemplate),
    resourceHash: sha256({
      resources: resources.map((resource) => ({ role: resource.role, basename: resource.basename, href: resource.href, contentHash: resource.contentHash })),
      dependencyHash
    }),
    resources: resources.map((resource) => ({ role: resource.role, basename: resource.basename, href: resource.href, contentHash: resource.contentHash })),
    cssDependencies,
    dependencyHash,
    widths: PREVIEW_WIDTHS,
    expectedRuntime,
    requiredChecks: PREVIEW_REQUIRED_CHECKS
  };
  const manifestPath = writeJson(path.join(outputRoot, 'preview-manifest.json'), manifest);
  const manifestHash = sha256(manifest);
  const html = htmlTemplate.replace(PREVIEW_MANIFEST_PLACEHOLDER, manifestHash);
  const htmlPath = path.join(outputRoot, 'preview.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(JSON.stringify({ command: 'preview', html: htmlPath, manifest: manifestPath, manifestHash, widths: PREVIEW_WIDTHS }, null, 2));
}

function commandPreviewRun(args) {
  const runner = path.join(__dirname, 'cure-form-browser-runner.js');
  if (!fs.existsSync(runner)) fail(`Canonical browser runner is missing: ${runner}`);
  const manifest = projectPath(args, requireOption(args, 'manifest'));
  const output = projectPath(args, args.output || path.join(workRoot(args), 'preview', 'browser-results.json'));
  const runnerArgs = [runner, '--manifest', manifest, '--output', output, '--project-root', projectRoot(args)];
  if (args.browserCommand) runnerArgs.push('--browser-command', String(args.browserCommand));
  if (args.targetProfile) runnerArgs.push('--target-profile', projectPath(args, args.targetProfile));
  if (args.timeoutMs) runnerArgs.push('--timeout-ms', String(args.timeoutMs));
  const result = spawnSync(process.execPath, runnerArgs, { cwd: projectRoot(args), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`Canonical browser runner failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`Canonical browser runner failed with exit code ${result.status}.`);
}

function validateBrowserResult(result, width, manifest, manifestHash) {
  if (!result || result.schema !== 'cure-form-browser-result/v1') fail(`Browser result for width ${width} has an invalid schema.`);
  if (result.manifestHash !== manifestHash) fail(`Browser result for width ${width} does not match the preview manifest.`);
  if (Number(result.width) !== width) fail(`Browser result width mismatch: expected ${width}, received ${result.width}.`);
  if (!Array.isArray(result.resources) || result.resources.length !== manifest.resources.length) fail(`Browser result resources are incomplete at width ${width}.`);
  const resourceStates = new Map(result.resources.map((item) => [item.role, item.state]));
  if (resourceStates.size !== manifest.resources.length) fail(`Browser result resources contain duplicate roles at width ${width}.`);
  for (const resource of manifest.resources) {
    if (resourceStates.get(resource.role) !== 'loaded') fail(`Preview resource ${resource.role} did not load at width ${width}.`);
  }
  const checks = result.checks || {};
  if (checks.jqueryAvailable !== true) fail(`jQuery is unavailable at width ${width}.`);
  if (checks.parserAvailable !== true) fail(`HISUI $.parser is unavailable at width ${width}.`);
  const expectedRuntime = manifest.expectedRuntime || {};
  if (!Number.isInteger(Number(checks.panelCount)) || !Number.isInteger(Number(checks.initializedPanelCount)) || Number(checks.panelCount) !== Number(expectedRuntime.panelCount) || Number(checks.initializedPanelCount) !== Number(expectedRuntime.panelCount)) {
    fail(`HISUI panel initialization is incomplete at width ${width}.`);
  }
  if (!Number.isInteger(Number(checks.radioCount)) || !Number.isInteger(Number(checks.generatedRadioLabelCount)) || Number(checks.radioCount) < 0 || Number(checks.generatedRadioLabelCount) < 0) {
    fail(`HISUI radio counts are invalid at width ${width}.`);
  }
  if (Number(checks.radioCount) !== Number(expectedRuntime.radioCount) || Number(checks.generatedRadioLabelCount) < Number(expectedRuntime.radioCount)) {
    fail(`HISUI radio label generation is incomplete at width ${width}.`);
  }
  const hasAtomicRadioExpectations = Object.prototype.hasOwnProperty.call(expectedRuntime, 'hisuiRadioCount') || Object.prototype.hasOwnProperty.call(expectedRuntime, 'semanticRadioPairCount');
  if (hasAtomicRadioExpectations) {
    const atomicFields = ['hisuiRadioTargetCount', 'completeHisuiRadioPairCount', 'brokenHisuiRadioPairCount', 'unpairedHisuiRadioCount'];
    if (!atomicFields.every((field) => Number.isInteger(Number(checks[field])) && Number(checks[field]) >= 0)) {
      fail(`HISUI radio atomic pairing counts are invalid at width ${width}.`);
    }
    if (Number(checks.hisuiRadioTargetCount) !== Number(checks.completeHisuiRadioPairCount) + Number(checks.brokenHisuiRadioPairCount) + Number(checks.unpairedHisuiRadioCount)) {
      fail(`HISUI radio atomic pairing counts are inconsistent at width ${width}.`);
    }
    if (Number(checks.hisuiRadioTargetCount) !== Number(expectedRuntime.hisuiRadioCount)) {
      fail(`HISUI radio initialized atomic targets are incomplete at width ${width}.`);
    }
    if (Number(checks.brokenHisuiRadioPairCount) !== 0) {
      fail(`HISUI radio atomic pairing is broken at width ${width}.`);
    }
    if (Number(checks.completeHisuiRadioPairCount) !== Number(expectedRuntime.semanticRadioPairCount)) {
      fail(`HISUI radio atomic pairing is incomplete at width ${width}.`);
    }
  }
  if (checks.horizontalOverflow !== false) fail(`Preview has horizontal overflow or no overflow evidence at width ${width}.`);
  if (!Array.isArray(result.networkErrors)) fail(`Preview network error evidence is missing at width ${width}.`);
  if (result.networkErrors.length) fail(`Preview resource requests failed at width ${width}: ${JSON.stringify(result.networkErrors)}`);
  if (!Array.isArray(result.consoleErrors)) fail(`Preview console error evidence is missing at width ${width}.`);
  if (result.consoleErrors.length) fail(`Preview console errors occurred at width ${width}: ${result.consoleErrors.join('; ')}`);
  if (!Array.isArray(result.runtimeErrors)) fail(`Preview runtime error evidence is missing at width ${width}.`);
  if (result.runtimeErrors.length) fail(`Preview runtime errors occurred at width ${width}: ${result.runtimeErrors.join('; ')}`);
}

function commandPreviewCheck(args) {
  const manifestPath = projectPath(args, requireOption(args, 'manifest'));
  const manifest = readJson(manifestPath);
  if (!manifest || manifest.schema !== 'cure-form-preview-manifest/v1') fail('Expected cure-form-preview-manifest/v1.');
  if (manifest.gateVersion !== PREVIEW_GATE_VERSION) fail(`Preview manifest must use ${PREVIEW_GATE_VERSION}; regenerate it with the current plugin.`);
  if (JSON.stringify(manifest.requiredChecks) !== JSON.stringify(PREVIEW_REQUIRED_CHECKS) || manifest.requiredChecksHash !== sha256(PREVIEW_REQUIRED_CHECKS)) {
    fail('Preview manifest required checks do not match the current canonical gate.');
  }
  if (JSON.stringify(manifest.widths) !== JSON.stringify(PREVIEW_WIDTHS)) fail('Preview manifest does not contain the canonical nine-width matrix.');
  const manifestHash = sha256(manifest);
  const previewHtmlPath = path.resolve(path.dirname(manifestPath), manifest.previewHtml || 'preview.html');
  if (!pathIsWithin(previewHtmlPath, path.dirname(manifestPath)) || !fs.existsSync(previewHtmlPath) || !fs.statSync(previewHtmlPath).isFile()) fail('Preview HTML is missing or outside the manifest directory.');
  const previewHtml = fs.readFileSync(previewHtmlPath, 'utf8');
  if (previewHtml.split(manifestHash).length - 1 !== 1 || sha256(previewHtml.replace(manifestHash, PREVIEW_MANIFEST_PLACEHOLDER)) !== manifest.previewHtmlTemplateHash) {
    fail('Preview HTML does not match the manifest; regenerate browser evidence from the current changes.');
  }
  if (!Array.isArray(manifest.resources) || manifest.resources.length !== PREVIEW_RESOURCE_SPECS.length || manifest.resources.some((resource, index) => resource.role !== PREVIEW_RESOURCE_SPECS[index].role || resource.basename !== PREVIEW_RESOURCE_SPECS[index].basename || resourceBasename(resource.href) !== PREVIEW_RESOURCE_SPECS[index].basename)) {
    fail('Preview manifest does not contain the canonical six-resource matrix.');
  }
  if (!manifest.expectedRuntime || !Number.isInteger(Number(manifest.expectedRuntime.panelCount)) || Number(manifest.expectedRuntime.panelCount) < 1 || !Number.isInteger(Number(manifest.expectedRuntime.radioCount)) || Number(manifest.expectedRuntime.radioCount) < 0) {
    fail('Preview manifest does not contain valid runtime expectations.');
  }
  const hasHisuiRadioCount = Object.prototype.hasOwnProperty.call(manifest.expectedRuntime, 'hisuiRadioCount');
  const hasSemanticRadioPairCount = Object.prototype.hasOwnProperty.call(manifest.expectedRuntime, 'semanticRadioPairCount');
  if (hasHisuiRadioCount !== hasSemanticRadioPairCount || (hasHisuiRadioCount && (!Number.isInteger(Number(manifest.expectedRuntime.hisuiRadioCount)) || Number(manifest.expectedRuntime.hisuiRadioCount) < 0 || !Number.isInteger(Number(manifest.expectedRuntime.semanticRadioPairCount)) || Number(manifest.expectedRuntime.semanticRadioPairCount) < 0 || Number(manifest.expectedRuntime.semanticRadioPairCount) > Number(manifest.expectedRuntime.hisuiRadioCount)))) {
    fail('Preview manifest does not contain valid HISUI radio atomic pairing expectations.');
  }
  if (!manifest.cssDependencies || !Array.isArray(manifest.cssDependencies.dependencies) || !Array.isArray(manifest.cssDependencies.unresolved)) {
    fail('Preview manifest CSS dependency evidence is missing.');
  }
  const dependencyHash = sha256(manifest.cssDependencies);
  if (manifest.dependencyHash !== dependencyHash) fail('Preview manifest CSS dependency hash is invalid.');
  const manifestResourceHash = sha256({
    resources: manifest.resources.map((resource) => ({ role: resource.role, basename: resource.basename, href: resource.href, contentHash: resource.contentHash })),
    dependencyHash
  });
  if (manifest.resourceHash !== manifestResourceHash) fail('Preview manifest resource hash is invalid.');
  for (const resource of [...manifest.resources, ...manifest.cssDependencies.dependencies]) {
    if (/^(?:https?:)?\/\//i.test(resource.href) || !/^[a-f0-9]{64}$/i.test(String(resource.contentHash || ''))) fail(`Canonical preview resource must be local and hashable: ${resource.href}`);
    const resourcePath = path.resolve(path.dirname(manifestPath), resource.href);
    if (!pathIsWithin(resourcePath, path.dirname(manifestPath)) || !fs.existsSync(resourcePath) || !fs.statSync(resourcePath).isFile()) {
      fail(`Preview manifest resource is missing: ${resource.href}`);
    }
    const contentHash = crypto.createHash('sha256').update(fs.readFileSync(resourcePath)).digest('hex');
    if (contentHash !== resource.contentHash) fail(`Preview manifest resource hash mismatch: ${resource.href}`);
  }
  const browserPayload = readJson(projectPath(args, requireOption(args, 'browserResults')));
  if (!browserPayload || browserPayload.schema !== 'cure-form-browser-results/v1') fail('Browser results must use schema cure-form-browser-results/v1.');
  if (!browserPayload.runner || browserPayload.runner.schema !== PREVIEW_RUNNER_SCHEMA || browserPayload.runner.gateVersion !== PREVIEW_GATE_VERSION || browserPayload.runner.engine !== 'chromium-cdp' || browserPayload.runner.manifestHash !== manifestHash || !cleanText(browserPayload.runner.browser) || !cleanText(browserPayload.runner.browserProduct) || !cleanText(browserPayload.runner.protocolVersion) || Number.isNaN(Date.parse(browserPayload.runner.completedAt))) {
    fail('Browser results were not produced by the current canonical browser runner.');
  }
  const results = browserPayload.results;
  if (!Array.isArray(results)) fail('Browser results must contain results[].');
  if (results.length !== PREVIEW_WIDTHS.length) fail('Browser results must contain only the canonical nine-width matrix.');
  for (const width of PREVIEW_WIDTHS) {
    const matches = results.filter((result) => Number(result && result.width) === width);
    if (matches.length !== 1) fail(`Browser results must contain exactly one result for width ${width}.`);
    validateBrowserResult(matches[0], width, manifest, manifestHash);
  }
  const verification = {
    schema: 'cure-form-preview-verification/v1',
    status: 'passed',
    gateVersion: PREVIEW_GATE_VERSION,
    requiredChecksHash: sha256(PREVIEW_REQUIRED_CHECKS),
    runner: browserPayload.runner,
    manifestHash,
    changesHash: manifest.changesHash,
    snapshotHash: manifest.snapshotHash,
    previewHtmlTemplateHash: manifest.previewHtmlTemplateHash,
    resourceHash: manifest.resourceHash,
    dependencyHash: manifest.dependencyHash,
    browserResultsHash: sha256({ runner: browserPayload.runner, results }),
    resultCount: results.length,
    widths: PREVIEW_WIDTHS,
    verifiedAt: new Date().toISOString()
  };
  const output = projectPath(args, args.output || path.join(workRoot(args), 'preview', 'preview-verification.json'));
  writeJson(output, verification);
  console.log(JSON.stringify({ command: 'preview-check', output, status: verification.status, widths: PREVIEW_WIDTHS }, null, 2));
}

function commandPrepare(args) {
  const mode = args.mode || 'create';
  if (!['create', 'responsive', 'common-responsive'].includes(mode)) fail('prepare --mode must be create, responsive, or common-responsive.');
  if (mode === 'responsive') return prepareResponsive({ ...args, mode });
  if (mode === 'common-responsive') return prepareCommonResponsive(args);
  const spec = validateSpec(readJson(projectPath(args, requireOption(args, 'spec'))), { approved: true });
  validatePublicResponsiveBoundary(spec, args, false);
  const outputRoot = args.outputRoot ? projectPath(args, args.outputRoot) : developmentRoot(args);
  const output = renderCreate(spec, outputRoot, args);
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

function validatePreviewVerification(value, changesHash, snapshotHash) {
  if (!value || value.schema !== 'cure-form-preview-verification/v1' || value.status !== 'passed') {
    fail('Deployable changes require a passed cure-form-preview-verification/v1 report.');
  }
  if (value.gateVersion !== PREVIEW_GATE_VERSION || value.requiredChecksHash !== sha256(PREVIEW_REQUIRED_CHECKS)) {
    fail(`Preview verification must use ${PREVIEW_GATE_VERSION}; regenerate browser evidence with the current plugin.`);
  }
  if (!value.runner || value.runner.schema !== PREVIEW_RUNNER_SCHEMA || value.runner.gateVersion !== PREVIEW_GATE_VERSION || value.runner.engine !== 'chromium-cdp' || value.runner.manifestHash !== value.manifestHash || !cleanText(value.runner.browser) || !cleanText(value.runner.browserProduct) || !cleanText(value.runner.protocolVersion) || Number.isNaN(Date.parse(value.runner.completedAt))) {
    fail('Preview verification is missing current canonical browser runner evidence.');
  }
  if (value.changesHash !== changesHash) fail('Preview verification does not match the supplied changes payload.');
  if ((value.snapshotHash || null) !== (snapshotHash || null)) fail('Preview verification does not match the supplied snapshot.');
  if (JSON.stringify(value.widths) !== JSON.stringify(PREVIEW_WIDTHS)) fail('Preview verification does not cover the canonical nine-width matrix.');
  if (!/^[a-f0-9]{64}$/i.test(String(value.manifestHash || '')) || !/^[a-f0-9]{64}$/i.test(String(value.resourceHash || ''))) {
    fail('Preview verification is missing manifest or resource hashes.');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(value.browserResultsHash || '')) || Number(value.resultCount) !== PREVIEW_WIDTHS.length) {
    fail('Preview verification is missing canonical browser result evidence.');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(value.dependencyHash || ''))) fail('Preview verification is missing the CSS dependency hash.');
  if (!/^[a-f0-9]{64}$/i.test(String(value.previewHtmlTemplateHash || ''))) fail('Preview verification is missing the preview HTML integrity hash.');
  return value;
}

function interactionCase(id, category, title, sourceRefs, steps, expected) {
  return {
    id,
    category,
    title,
    sourceRefs: [...new Set((sourceRefs || []).map(cleanText).filter(Boolean))],
    steps: Array.isArray(steps) ? steps.map(cleanText).filter(Boolean) : [],
    expected: cleanText(expected),
    required: true
  };
}

function fieldConstraint(field, name) {
  if (field && field.validation && field.validation[name] != null) return field.validation[name];
  return field && field[name] != null ? field[name] : null;
}

function ruleLabel(rule, fallback) {
  return cleanText(rule && (rule.title || rule.name || rule.id || rule.description || rule.expression)) || fallback;
}

function interactionRequiredCases(spec, stage) {
  const cases = [];
  if (stage === 'pre-deploy') {
    for (const field of spec.fields || []) {
      const id = cleanText(field && field.id);
      const label = cleanText(field && (field.label || field.name || field.title)) || id;
      const control = cleanText(field && field.control);
      if (control === 'number') {
        cases.push(interactionCase(`number:${id}:integer`, 'numberbox', `${label}整数输入`, [id], [`输入有效整数并离开控件`], '控件保留完整多位整数，联动和显示符合规格。'));
        cases.push(interactionCase(`number:${id}:decimal`, 'numberbox', `${label}小数输入`, [id], [`输入有效小数并离开控件`], '控件按规格接受或规范化小数，不截断多位输入。'));
        cases.push(interactionCase(`number:${id}:empty`, 'numberbox', `${label}空值处理`, [id], ['清空控件并离开控件'], '空值、默认值和必填提示符合规格。'));
        for (const boundary of ['min', 'max']) {
          const value = fieldConstraint(field, boundary);
          if (value != null && String(value).trim() !== '') {
            cases.push(interactionCase(`number:${id}:${boundary}`, 'numberbox-boundary', `${label}${boundary === 'min' ? '最小' : '最大'}边界`, [id], [`输入规格声明的${boundary}边界值 ${value}`], '边界值处理符合规格，且不会破坏相关联动。'));
          }
        }
      } else if (['radio', 'checkbox', 'select'].includes(control)) {
        cases.push(interactionCase(`selection:${id}`, 'selection', `${label}选择状态`, [id], ['逐项选择、切换并恢复目标状态'], '选中态、互斥关系、回显值和关联状态符合规格。'));
      }
    }
    (spec.calculations || []).forEach((rule, index) => {
      const label = ruleLabel(rule, `计算规则 ${index + 1}`);
      const refs = [rule && rule.id, rule && rule.output, ...(Array.isArray(rule && rule.inputs) ? rule.inputs : [])];
      cases.push(interactionCase(`calculation:${cleanText(rule && rule.id) || index + 1}`, 'calculation', label, refs, ['按规格组合输入计算源字段'], cleanText(rule && rule.expected) || '计算结果、精度、空值和边界行为符合已批准规格。'));
    });
    (spec.visibilityRules || []).forEach((rule, index) => {
      const label = ruleLabel(rule, `显隐或联动规则 ${index + 1}`);
      const refs = [rule && rule.id, rule && rule.target, ...(Array.isArray(rule && rule.targets) ? rule.targets : []), ...(Array.isArray(rule && rule.inputs) ? rule.inputs : [])];
      cases.push(interactionCase(`visibility:${cleanText(rule && rule.id) || index + 1}`, 'visibility-linkage', label, refs, ['触发规则的进入、切换和恢复条件'], cleanText(rule && rule.expected) || '目标字段显隐、启用状态、值清理和恢复行为符合已批准规格。'));
    });
    cases.push(interactionCase('semantic:unit-deduplication', 'semantic-deduplication', '单位显示去重', [], ['检查字段标签、输入框附加文本和表格表头中的单位'], '每个业务值只显示一次正确单位，无重复拼接或遗漏。'));
    cases.push(interactionCase('semantic:side-deduplication', 'semantic-deduplication', '左右侧显示去重', [], ['检查左右侧字段、选项、表头和回显文本'], '左右侧语义各出现一次且对应正确，无重复标签。'));
  } else if (stage === 'post-deploy') {
    cases.push(interactionCase('lifecycle:save', 'lifecycle', '保存', [], ['在获准的测试数据范围内填写并保存表单'], '保存成功且服务器未报告业务或运行时错误。'));
    cases.push(interactionCase('lifecycle:reopen', 'lifecycle', '重开', [], ['关闭并重新打开已保存表单'], '表单能够重新打开，结构和控件初始化正常。'));
    cases.push(interactionCase('lifecycle:restore', 'lifecycle', '回显', [], ['核对重新打开后的字段值和联动状态'], '保存值、计算结果、显隐和选择状态正确回显。'));
    cases.push(interactionCase('lifecycle:print', 'lifecycle', '打印', [], ['执行目标系统打印或打印预览'], '打印内容、单位、左右侧和关键业务值正确且无重复。'));
    if (spec.formType === 'CR') {
      cases.push(interactionCase('runtime:cr-contract', 'runtime-contract', 'CR 保存运行时契约', ['SaveCureRecord', 'CureExpJsonStr', 'MapID'], ['通过宿主入口保存并回显治疗记录'], 'SaveCureRecord、CureExpJsonStr、MapID 及回显行为保持兼容。'));
    }
  } else {
    fail('interaction-prepare --stage must be pre-deploy or post-deploy.');
  }
  const ids = cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) fail('Generated interaction case IDs are not unique; make calculation and visibility rule IDs unique.');
  return cases;
}

function interactionCaseDefinitionsHash(cases) {
  return sha256((cases || []).map((item) => ({
    id: item.id,
    category: item.category,
    title: item.title,
    sourceRefs: item.sourceRefs || [],
    steps: item.steps || [],
    expected: item.expected,
    required: item.required === true
  })));
}

function interactionMarkdown(report) {
  const lines = [
    `# ${report.title}人工交互测试`,
    '',
    `- 阶段：${report.stage}`,
    `- 类型：${report.formType}`,
    `- 模块：${report.moduleId}`,
    '- 默认优先人工操作；canonical preview-run 不执行点击、输入或选择。',
    '- 用户亲自验收时，可向 Agent 明确告知整体测试通过；Agent 自测时必须逐项填写实际结果。',
    '- 批量脚本化交互不属于本报告能力，执行前必须另行取得用户明确确认。',
    '',
    '## 必测项',
    ''
  ];
  for (const item of report.requiredCases) {
    lines.push(`- [ ] ${item.title} \`${item.id}\``);
    if (item.steps.length) lines.push(`  - 操作：${item.steps.join('；')}`);
    lines.push(`  - 预期：${item.expected}`);
  }
  lines.push('', '## 自定义业务用例', '', '- 在 JSON 的 `customCases[]` 中补充无法从规格推导的业务联动和预期结果。', '');
  return lines.join('\n');
}

function commandInteractionPrepare(args) {
  const stage = cleanText(args.stage || 'pre-deploy');
  let spec;
  let bindings;
  if (stage === 'pre-deploy') {
    spec = validateSpec(readJson(projectPath(args, requireOption(args, 'spec'))), { approved: true });
    const changes = readJson(projectPath(args, requireOption(args, 'changes')));
    const snapshot = args.snapshot ? readJson(projectPath(args, args.snapshot)) : null;
    const changesHash = sha256(changes);
    const snapshotHash = snapshot ? sha256(snapshot) : null;
    const previewVerification = validatePreviewVerification(readJson(projectPath(args, requireOption(args, 'previewVerification'))), changesHash, snapshotHash);
    bindings = {
      approvedSpecHash: spec.approval.specHash,
      changesHash,
      snapshotHash,
      previewVerificationHash: sha256(previewVerification),
      previewManifestHash: previewVerification.manifestHash
    };
  } else if (stage === 'post-deploy') {
    const packageValue = readJson(projectPath(args, requireOption(args, 'package')));
    validatePackage(packageValue, false);
    if (packageValue.expectedVersion !== 'NEW') fail('Post-deploy interaction reports are required only for new forms with expectedVersion=NEW.');
    spec = packageValue.specification;
    bindings = {
      packageHash: sha256(packageValue),
      approvedSpecHash: spec.approval.specHash,
      changesHash: packageValue.previewSourceChangesHash,
      operationId: requireOption(args, 'operationId')
    };
  } else {
    fail('interaction-prepare --stage must be pre-deploy or post-deploy.');
  }
  const requiredCases = interactionRequiredCases(spec, stage);
  const report = {
    schema: INTERACTION_REPORT_SCHEMA,
    stage,
    formType: spec.formType,
    moduleId: spec.moduleId,
    mapCode: spec.mapCode,
    title: spec.title,
    bindings,
    requiredCases,
    requiredCasesHash: interactionCaseDefinitionsHash(requiredCases),
    customCases: [],
    execution: {
      mode: null,
      testedBy: null,
      testedAt: null,
      environment: null,
      summary: null,
      overallStatus: 'pending'
    },
    results: [],
    createdAt: new Date().toISOString()
  };
  const output = projectPath(args, args.output || path.join(workRoot(args), 'interaction', `${spec.moduleId}-${stage}.json`));
  writeJson(output, report);
  const markdown = projectPath(args, args.markdown || output.replace(/\.json$/i, '') + '.md');
  ensureDir(path.dirname(markdown));
  fs.writeFileSync(markdown, interactionMarkdown(report) + '\n', 'utf8');
  console.log(JSON.stringify({ command: 'interaction-prepare', stage, output, markdown, requiredCaseCount: requiredCases.length }, null, 2));
}

function validateInteractionCase(item, label) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${label} must be an object.`);
  for (const name of ['id', 'category', 'title', 'expected']) {
    if (!cleanText(item[name])) fail(`${label}.${name} is required.`);
  }
  if (!Array.isArray(item.steps) || !item.steps.map(cleanText).filter(Boolean).length) fail(`${label}.steps must contain at least one operation.`);
  if (item.sourceRefs != null && !Array.isArray(item.sourceRefs)) fail(`${label}.sourceRefs must be an array when present.`);
}

function commandInteractionCheck(args) {
  const report = readJson(projectPath(args, requireOption(args, 'report')));
  if (!report || report.schema !== INTERACTION_REPORT_SCHEMA) fail(`Expected schema ${INTERACTION_REPORT_SCHEMA}.`);
  if (!['pre-deploy', 'post-deploy'].includes(report.stage)) fail('Interaction report stage must be pre-deploy or post-deploy.');
  if (!Array.isArray(report.requiredCases) || !report.requiredCases.length) fail('Interaction report requiredCases[] must not be empty.');
  report.requiredCases.forEach((item, index) => validateInteractionCase(item, `requiredCases[${index}]`));
  if (interactionCaseDefinitionsHash(report.requiredCases) !== report.requiredCasesHash) fail('Generated interaction cases were removed or changed; regenerate the report and add business cases only under customCases[].');
  if (!Array.isArray(report.customCases)) fail('Interaction report customCases[] must be an array.');
  report.customCases.forEach((item, index) => validateInteractionCase(item, `customCases[${index}]`));
  const allCases = [...report.requiredCases, ...report.customCases];
  const caseIds = allCases.map((item) => cleanText(item.id));
  if (new Set(caseIds).size !== caseIds.length) fail('Interaction case IDs must be unique across requiredCases[] and customCases[].');
  const execution = report.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) fail('Interaction report execution is required.');
  const mode = cleanText(execution.mode);
  if (mode === 'automated' || mode === 'automation') fail('Automated interaction execution is not supported; it requires separate explicit user confirmation and a future approved runner.');
  if (!['user-attested', 'agent-manual'].includes(mode)) fail('Interaction execution mode must be user-attested or agent-manual.');
  if (!cleanText(execution.testedBy)) fail('Interaction execution testedBy is required.');
  if (Number.isNaN(Date.parse(execution.testedAt))) fail('Interaction execution testedAt must be a valid timestamp.');
  if (!cleanText(execution.summary)) fail('Interaction execution summary is required.');
  if (cleanText(execution.overallStatus) !== 'passed') fail('Interaction execution did not pass.');
  if (!Array.isArray(report.results)) fail('Interaction report results[] must be an array.');
  const resultById = new Map(report.results.map((item) => [cleanText(item && item.caseId), item]));
  if (resultById.size !== report.results.length) fail('Interaction results contain empty or duplicate caseId values.');
  for (const [caseId, result] of resultById.entries()) {
    if (!caseIds.includes(caseId)) fail(`Interaction result references unknown case ${caseId}.`);
    if (cleanText(result && result.status) !== 'passed') fail(`Interaction case did not pass: ${caseId}.`);
  }
  if (mode === 'agent-manual') {
    if (!cleanText(execution.environment)) fail('Agent manual interaction testing requires a non-empty environment description.');
    for (const item of allCases) {
      const result = resultById.get(item.id);
      if (!result) fail(`Agent manual interaction result is missing for case ${item.id}.`);
      if (!cleanText(result.actualResult)) fail(`Agent manual interaction actualResult is required for case ${item.id}.`);
      if (result.evidence != null && !Array.isArray(result.evidence)) fail(`Agent manual interaction evidence must be an array for case ${item.id}.`);
    }
  }
  const verification = {
    schema: INTERACTION_VERIFICATION_SCHEMA,
    stage: report.stage,
    status: 'passed',
    mode,
    formType: assertFormType(report.formType),
    moduleId: cleanText(report.moduleId),
    mapCode: cleanText(report.mapCode),
    testedBy: cleanText(execution.testedBy),
    testedAt: new Date(execution.testedAt).toISOString(),
    summary: cleanText(execution.summary),
    environment: cleanText(execution.environment) || null,
    bindings: report.bindings,
    requiredCasesHash: report.requiredCasesHash,
    caseCount: allCases.length,
    reportHash: sha256(report),
    createdAt: new Date().toISOString()
  };
  const output = projectPath(args, args.output || path.join(workRoot(args), 'interaction', `${report.moduleId}-${report.stage}-verification.json`));
  writeJson(output, verification);
  console.log(JSON.stringify({ command: 'interaction-check', stage: report.stage, mode, output, status: verification.status }, null, 2));
}

function validateInteractionVerification(value, expected) {
  if (!value || value.schema !== INTERACTION_VERIFICATION_SCHEMA || value.stage !== expected.stage || value.status !== 'passed') {
    fail(`New forms require a passed ${INTERACTION_VERIFICATION_SCHEMA} ${expected.stage} report.`);
  }
  if (!['user-attested', 'agent-manual'].includes(value.mode)) fail('Interaction verification mode is invalid or automated.');
  if (!cleanText(value.testedBy) || Number.isNaN(Date.parse(value.testedAt)) || !cleanText(value.summary)) fail('Interaction verification is missing human test attribution.');
  for (const name of ['formType', 'moduleId', 'mapCode']) {
    if (expected[name] != null && value[name] !== expected[name]) fail(`Interaction verification does not match ${name}.`);
  }
  if (!value.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings)) fail('Interaction verification bindings are missing.');
  for (const [name, expectedValue] of Object.entries(expected.bindings)) {
    const actualValue = value.bindings[name] == null ? null : value.bindings[name];
    const normalizedExpected = expectedValue == null ? null : expectedValue;
    if (actualValue !== normalizedExpected) fail(`Interaction verification does not match ${name}.`);
  }
  for (const name of ['requiredCasesHash', 'reportHash']) {
    if (!/^[a-f0-9]{64}$/i.test(String(value[name] || ''))) fail(`Interaction verification ${name} is missing or invalid.`);
  }
  if (!Number.isInteger(Number(value.caseCount)) || Number(value.caseCount) < 1) fail('Interaction verification caseCount is invalid.');
  return value;
}

function commandPlan(args) {
  const spec = validateSpec(readJson(projectPath(args, requireOption(args, 'spec'))), { approved: true });
  validatePublicResponsiveBoundary(spec, args, true);
  const snapshot = args.snapshot ? readJson(projectPath(args, args.snapshot)) : null;
  if (snapshot) assertFormType(snapshot.formType || snapshot.MapType);
  if (snapshot && String(snapshot.mapCode || snapshot.MapCode) !== spec.mapCode) fail('Snapshot mapCode does not match specification mapCode.');
  const snapshotVersion = snapshot ? (snapshot.version ?? snapshot.Version) : undefined;
  const snapshotContentHash = snapshot ? (snapshot.contentHash ?? snapshot.ContentHash) : undefined;
  const snapshotIsMissing = Boolean(snapshot && (snapshot.exists === false || snapshot.exists === 0));
  const hasChanges = Boolean(args.changes);
  let changes = hasChanges ? readJson(projectPath(args, args.changes)) : {};
  const previewSourceChangesHash = hasChanges ? sha256(changes) : null;
  const snapshotHash = snapshot ? sha256(snapshot) : null;
  const previewVerification = hasChanges
    ? validatePreviewVerification(readJson(projectPath(args, requireOption(args, 'previewVerification'))), previewSourceChangesHash, snapshotHash)
    : null;
  const expectedVersion = snapshotIsMissing ? 'NEW' : (snapshotVersion ?? args.expectedVersion ?? 'NEW');
  const interactionExpected = hasChanges ? {
    stage: 'pre-deploy',
    formType: spec.formType,
    moduleId: spec.moduleId,
    mapCode: spec.mapCode,
    bindings: {
      approvedSpecHash: spec.approval.specHash,
      changesHash: previewSourceChangesHash,
      snapshotHash,
      previewVerificationHash: sha256(previewVerification),
      previewManifestHash: previewVerification.manifestHash
    }
  } : null;
  const interactionVerification = hasChanges && (expectedVersion === 'NEW' || args.interactionVerification)
    ? validateInteractionVerification(readJson(projectPath(args, requireOption(args, 'interactionVerification'))), interactionExpected)
    : null;
  let commonTemplateReferences = [];
  if (args.approvedClones) {
    const resolved = applyApprovedCloneReferences(changes, spec, approvedCloneMap(readJson(projectPath(args, args.approvedClones))));
    changes = resolved.changes;
    commonTemplateReferences = resolved.references;
  }
  const packageValue = {
    schema: 'cure-form-package/v1',
    formType: spec.formType,
    moduleId: spec.moduleId,
    mapCode: spec.mapCode,
    title: spec.title,
    expectedVersion,
    expectedContentHash: snapshotIsMissing ? null : (snapshotContentHash ?? args.expectedContentHash ?? null),
    approvedSpecHash: spec.approval.specHash,
    specification: spec,
    changes,
    previewSourceChangesHash,
    sourceSnapshotHash: snapshotHash,
    plannedChangesHash: hasChanges ? sha256(changes) : null,
    previewVerification,
    interactionVerification,
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
  if (value.plannedChangesHash !== sha256(value.changes || {})) fail('Package changes do not match the planned changes hash.');
  validatePreviewVerification(value.previewVerification, value.previewSourceChangesHash, value.sourceSnapshotHash);
  if (value.expectedVersion === 'NEW' || value.interactionVerification) {
    validateInteractionVerification(value.interactionVerification, {
      stage: 'pre-deploy',
      formType: value.formType,
      moduleId: value.moduleId,
      mapCode: value.mapCode,
      bindings: {
        approvedSpecHash: value.specification.approval.specHash,
        changesHash: value.previewSourceChangesHash,
        snapshotHash: value.sourceSnapshotHash,
        previewVerificationHash: sha256(value.previewVerification),
        previewManifestHash: value.previewVerification.manifestHash
      }
    });
  }
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

function readCommonMigrationConfig(args) {
  const profile = parseMarkdownProfile(previewProfilePath(args));
  const configured = args.migrationConfig || profile.CommonMigrationConfig;
  if (!configured || /^<?(?:required|unset|todo)>?$/i.test(String(configured).trim())) {
    fail('common-migrate requires --migration-config or CommonMigrationConfig in the target profile.');
  }
  const file = projectPath(args, configured);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`Common migration config does not exist: ${configured}`);
  const config = readJson(file);
  if (!config || config.schema !== 'cure-form-common-migration-config/v1') {
    fail('Common migration config must use schema cure-form-common-migration-config/v1.');
  }
  if (!Array.isArray(config.priorityMapCodes) || !config.priorityMapCodes.every((value) => cleanText(value))) {
    fail('Common migration config priorityMapCodes must be an array of non-empty map codes.');
  }
  const priorityMapCodes = config.priorityMapCodes.map(cleanText);
  if (new Set(priorityMapCodes).size !== priorityMapCodes.length) fail('Common migration config priorityMapCodes must be unique.');
  if (!Array.isArray(config.publicTemplates)) fail('Common migration config publicTemplates[] is required.');
  const publicTemplates = config.publicTemplates.map((template, index) => {
    const sourceTemplateRowId = cleanText(template && template.sourceTemplateRowId);
    if (!/^\d+$/.test(sourceTemplateRowId)) fail(`publicTemplates[${index}].sourceTemplateRowId must be numeric.`);
    if (!Array.isArray(template.formTypes) || !template.formTypes.length) fail(`publicTemplates[${index}].formTypes[] is required.`);
    const formTypes = template.formTypes.map(assertFormType);
    if (new Set(formTypes).size !== formTypes.length) fail(`publicTemplates[${index}].formTypes must be unique.`);
    return { sourceTemplateRowId, formTypes };
  });
  const rowIds = publicTemplates.map((template) => template.sourceTemplateRowId);
  if (new Set(rowIds).size !== rowIds.length) fail('Common migration config publicTemplates sourceTemplateRowId values must be unique.');
  return { file, value: { schema: config.schema, priorityMapCodes, publicTemplates } };
}

function commandCommonMigrate(args) {
  const source = readJson(projectPath(args, requireOption(args, 'inventory')));
  const migrationConfig = readCommonMigrationConfig(args);
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
  const order = migrationConfig.value.priorityMapCodes;
  const rank = (row) => {
    const code = row.mapCode || '';
    const index = order.indexOf(code);
    if (index >= 0) return index;
    return row.formType === 'CA' ? 100 : 200;
  };
  allowed.sort((a, b) => rank(a) - rank(b));
  const approvedClones = args.approvedClones
    ? approvedCloneMap(readJson(projectPath(args, args.approvedClones)))
    : {};
  const publicTemplates = migrationConfig.value.publicTemplates.map((template) => ({
    ...template,
    approvedCloneRowId: approvedClones[template.sourceTemplateRowId] || null
  }));
  const seedTemplates = { CA: [], CR: [] };
  for (const template of publicTemplates) {
    for (const formType of template.formTypes) seedTemplates[formType].push(template.sourceTemplateRowId);
  }
  const plan = {
    schema: 'cure-form-common-migration/v1', strategy: 'versioned-clone', dryRun: true,
    migrationConfigHash: sha256(migrationConfig.value),
    seedTemplates,
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
    preview: commandPreview,
    'preview-run': commandPreviewRun,
    'preview-check': commandPreviewCheck,
    'interaction-prepare': commandInteractionPrepare,
    'interaction-check': commandInteractionCheck,
    apply: commandApply,
    verify: commandVerify,
    rollback: commandRollback,
    'common-migrate': commandCommonMigrate
  };
  handlers[command](args);
}

module.exports = { addResponsiveContract, assertCompletePreviewResources, assertFormType, contractSnapshot, interactionRequiredCases, objectScriptArgument, previewBodyFromChanges, resolvePreviewResources, sha256, structureToSpec, unwrapServerResult, validateBrowserResult, validateInteractionVerification, validatePackage, validatePreviewVerification, validateSpec };

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`ERROR=${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}
