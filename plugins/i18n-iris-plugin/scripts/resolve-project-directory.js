#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resolveWorkspaceContext } = require('../../../scripts/lib/workspace-context');
const { resolveDirectory } = require('../../../scripts/lib/project-directories');
const owner = 'i18n-iris-plugin';

function readProfile(file) {
  if (!fs.existsSync(file)) return {};
  const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)).replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const values = {};
  let section = '', fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*`{3}|^\s*~{3}/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^##\s+/.test(line)) section = line.replace(/^##\s+/, '').trim();
    const match = line.match(/^\s*-\s*`?(xmlPrintReferencesDir|xmlPrintOutputDir|i18nTermsDir|cspTransBackupsDir|ReferencesDir|OutputDir|备份目录)`?\s*[:：]\s*(.+?)\s*$/);
    if (!match || (match[1] === '备份目录' && section !== 'CSP 翻译同步配置')) continue;
    const value = match[2].replace(/^`([^`]+)`[。.]?$/, '$1').trim();
    if (!value || /^TODO(?:$|\s|[:：])/.test(value)) continue;
    const key = match[1] === 'ReferencesDir' ? 'xmlPrintReferencesDir' : match[1] === 'OutputDir' ? 'xmlPrintOutputDir' : match[1] === '备份目录' ? 'cspTransBackupsDir' : match[1];
    if (values[key] && values[key] !== value) throw Error('Conflicting i18n profile directory: ' + key);
    values[key] = value;
  }
  return values;
}

function resolveI18nDirectories(projectRoot, options = {}) {
  const context = resolveWorkspaceContext(path.resolve(projectRoot));
  if (context.mode === 'invalid') throw Error('Invalid workspace context');
  const profile = readProfile(path.resolve(context.workspaceRoot, options.profile || path.join(context.contextRoot, 'config/i18n_project_profile.md')));
  const choose = (explicit, key, id, fallback) => explicit !== undefined
    ? path.resolve(context.workspaceRoot, explicit)
    : profile[key] ? path.resolve(context.workspaceRoot, profile[key])
      : resolveDirectory(context.workspaceRoot, owner, id, fallback);
  const result = {};
  const kind = options.kind || 'xml';
  if (kind === 'xml') {
    result.referencesDir = choose(options.referencesDir, 'xmlPrintReferencesDir', 'print-template-sources', 'references/xmlPrintTemp');
    result.outputDir = choose(options.outputDir, 'xmlPrintOutputDir', 'print-templates', 'docs/xmlPrintTemp');
  } else if (kind === 'terms') {
    result.path = choose(options.outputDir, 'i18nTermsDir', 'terms', 'docs');
  } else if (kind === 'csp-backups') {
    result.path = choose(options.outputDir, 'cspTransBackupsDir', 'csp-backups', 'docs/i18n-csp-trans-sync/backups');
  } else throw Error('Unknown i18n directory kind');
  return result;
}

function main(argv) {
  const [kind, ...args] = argv;
  const options = { kind };
  const keys = { '--project-root': 'projectRoot', '--profile': 'profile', '--references-dir': 'referencesDir', '--output-dir': 'outputDir' };
  for (let i = 0; i < args.length; i += 2) {
    const key = keys[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key] !== undefined) throw Error('Invalid or duplicate i18n directory option');
    options[key] = args[i + 1];
  }
  if (!options.projectRoot || !['xml', 'terms', 'csp-backups'].includes(kind)) throw Error('Usage: resolve-project-directory.js xml|terms|csp-backups --project-root <workspace> [--profile <file>] [--references-dir <dir>] [--output-dir <dir>]');
  return resolveI18nDirectories(options.projectRoot, options);
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { resolveI18nDirectories, readProfile, main };
