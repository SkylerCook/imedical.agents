'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { refresh, verify } = require('../refresh-agents-sparse');
const { resolveWorkspaceContext } = require('../lib/workspace-context');

const repo = path.resolve(__dirname, '../..');
const protocol = 'docs/guides/capability-help.md';
const maintenanceSkill = '.agents/skills/agent-kit-maintenance/SKILL.md';
const pluginSkill = 'plugins/bos-plugin/skills/bos-demand-entry/SKILL.md';
const agent = 'agents/explorer-agent/AGENT.md';
const read = (file, root = repo) => fs.readFileSync(path.join(root, file), 'utf8');
const slash = value => value.replaceAll('\\', '/');

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

function definitions(root = repo) {
  const skills = walk(path.join(root, 'plugins')).filter(file => /[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/.test(file));
  skills.push(...walk(path.join(root, 'skills')).filter(file => path.basename(file) === 'SKILL.md'));
  const agents = walk(path.join(root, 'agents')).filter(file => /[\\/][^\\/]+-agent[\\/]AGENT\.md$/.test(file));
  return { skills: skills.map(file => slash(path.relative(root, file))), agents: agents.map(file => slash(path.relative(root, file))) };
}

function firstParagraph(text, file) {
  const frontmatter = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '';
  const body = text.slice(frontmatter.length);
  const heading = body.match(/^\s*# [^\r\n]+\r?\n/);
  assert.ok(heading, `${file}: must start with the capability title`);
  const remainder = body.slice(heading[0].length).replace(/^\s*\r?\n/, '');
  const paragraph = remainder.split(/\r?\n\s*\r?\n/, 1)[0];
  return { frontmatter, paragraph };
}

function helpTarget(file, root = repo) {
  const text = read(file, root);
  const { frontmatter, paragraph } = firstParagraph(text, file);
  if (file.endsWith('/SKILL.md')) {
    assert.match(frontmatter, /^name:\s*\S+/m, `${file}: skill name must remain in frontmatter`);
    assert.match(frontmatter, /^description:\s*\S+/m, `${file}: description must remain in frontmatter`);
  }
  assert.match(paragraph, /--help/, `${file}: help must precede workflow and business preflight`);
  const links = [...paragraph.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)];
  const target = links.map(match => path.resolve(root, path.dirname(file), match[1].split('#')[0]))
    .find(candidate => candidate === path.join(root, protocol));
  assert.ok(target, `${file}: first paragraph must link to the shared help protocol`);
  assert.ok(fs.statSync(target).isFile(), `${file}: help protocol must be readable`);
  return target;
}

function sparsePatterns(file, variable) {
  const block = read(file).match(new RegExp('\\$' + variable + ' = @\\(([\\s\\S]*?)\\)'));
  assert.ok(block, `${file}: actual sparse list not found`);
  return [...block[1].matchAll(/"([^"\r\n]+)"/g)].map(match => match[1]);
}

const installPatterns = sparsePatterns('scripts/install-agents.ps1', 'sparsePaths');
const updatePatterns = sparsePatterns('scripts/update-agents.ps1', 'runtimeSparsePaths');

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture(t) {
  const base = process.env.AGENTS_TEST_TEMP || path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'capability-help-'));
  t.after(() => {
    const relative = path.relative(path.resolve(base), path.resolve(root));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'cleanup stays within this task directory');
    fs.rmSync(root, { recursive: true, force: true });
    assert.ok(!fs.existsSync(root), 'fixture cleanup completed');
  });
  const upstream = path.join(root, 'upstream');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '-q');
  for (const [key, value] of Object.entries({ 'user.name': 'Capability Help Test', 'user.email': 'test@example.invalid', 'core.autocrlf': 'false', 'commit.gpgsign': 'false' })) git(upstream, 'config', key, value);
  git(upstream, 'config', 'core.hooksPath', path.join(upstream, '.git/no-hooks'));
  const inventory = definitions();
  const sources = [...inventory.skills, ...inventory.agents];
  const contents = new Map(sources.map(file => [file, read(file)]));
  for (const [file, content] of contents) {
    const { paragraph } = firstParagraph(content, file);
    write(upstream, file, paragraph.includes('capability-help.md') ? content.replace(paragraph, '') : content);
  }
  for (const file of ['scripts/generate-plugin-thin-index.ps1', 'scripts/generate-agent-thin-index.ps1', 'agents/explorer-agent/bindings.yaml', 'workflows/standard-change.workflow.md', 'plugins/bos-plugin/.agents-plugin/plugin.json']) write(upstream, file, fs.readFileSync(path.join(repo, file)));
  write(upstream, maintenanceSkill, read(maintenanceSkill));
  write(upstream, 'docs/README.md', '# Project docs\n');
  for (const file of ['AGENTS.md', 'memory/private.md', 'maintenance/private.md', 'releases/plugin/test/1.0.0.md', 'scripts/tests/private.js']) write(upstream, file, 'Source-only fixture\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'old canonical sources without shared help');
  return { root, upstream, sources, contents };
}

function cloneProject({ root, upstream }, name, patterns) {
  const project = path.join(root, name);
  const capability = path.join(project, '.agents');
  fs.mkdirSync(project);
  git(upstream, '-c', 'core.autocrlf=false', 'clone', '-q', '--no-local', '--no-checkout', upstream, capability);
  git(capability, 'config', 'core.autocrlf', 'false');
  git(capability, 'config', 'core.hooksPath', path.join(capability, '.git/no-hooks'));
  refresh(capability, patterns, true);
  fs.appendFileSync(path.join(capability, '.git/info/exclude'), '\n/skills/\n');
  return { project, capability };
}

function publishHelp({ upstream, contents }) {
  for (const [file, content] of contents) write(upstream, file, content);
  for (const file of [protocol, 'docs/guides/capability-guide.md', 'docs/guides/capability-catalog.md']) write(upstream, file, fs.readFileSync(path.join(repo, file)));
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'add shared help and canonical routes');
}

function generateIndexes({ project, capability }) {
  const shell = process.env.TEST_POWERSHELL || (process.platform === 'win32' ? 'pwsh.exe' : 'pwsh');
  const env = { ...process.env };
  if (/^powershell(?:\.exe)?$/i.test(path.basename(shell))) for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  for (const script of ['generate-plugin-thin-index.ps1', 'generate-agent-thin-index.ps1']) {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(capability, 'scripts', script), '-ProjectRoot', project, '-ContextRoot', capability, '-CapabilityRoot', capability, '-Mode', 'Write'];
    if (script.startsWith('generate-plugin')) args.push('-PluginPath', path.join(capability, 'plugins/bos-plugin'));
    execFileSync(shell, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return ['skills/bos-demand-entry/SKILL.md', 'skills/explorer-agent/SKILL.md'].map(file => ({ file, bytes: fs.readFileSync(path.join(capability, file)) }));
}

function indexSource(index, workspace) {
  const reference = index.match(/^source:\s*(\.agents\/[^\r\n]+)/m)?.[1] || index.match(/Role definition:\s*`(\.agents\/[^`]+)`/)?.[1];
  assert.ok(reference, 'generated entry must reference canonical source');
  return path.join(workspace.capabilityRoot, reference.slice('.agents/'.length));
}

test('every owned skill and Agent has an early, reachable shared-help route', () => {
  const inventory = definitions();
  assert.ok(inventory.skills.length > 0 && inventory.agents.length > 0);
  for (const file of [...inventory.skills, ...inventory.agents, maintenanceSkill]) helpTarget(file);
});

test('fresh install materializes new help and canonical definitions while source-only assets stay excluded', t => {
  const state = fixture(t);
  publishHelp(state);
  const { capability } = cloneProject(state, 'fresh-project', installPatterns);
  verify(capability, installPatterns);
  for (const file of state.sources) {
    helpTarget(file, capability);
    assert.equal(firstParagraph(read(file, capability), file).frontmatter, firstParagraph(state.contents.get(file), file).frontmatter);
  }
  assert.equal(read(protocol, capability), read(protocol));
  for (const file of [maintenanceSkill, 'AGENTS.md', 'memory/private.md', 'maintenance/private.md', 'releases/plugin/test/1.0.0.md', 'scripts/tests/private.js']) assert.ok(!fs.existsSync(path.join(capability, file)), `${file}: must not be deployed`);
});

test('existing sparse checkout receives help by fast-forward while old thin-index bytes still reach current canonical sources', t => {
  const state = fixture(t);
  const project = cloneProject(state, 'existing-project', updatePatterns);
  assert.ok(!fs.existsSync(path.join(project.capability, protocol)), 'help is introduced by the upgrade');
  const indexes = generateIndexes(project);
  const oldMetadata = new Map(state.sources.map(file => [file, firstParagraph(read(file, project.capability), file).frontmatter]));
  publishHelp(state);
  git(project.capability, 'pull', '--ff-only');
  refresh(project.capability, updatePatterns);
  verify(project.capability, updatePatterns);
  for (const file of state.sources) {
    helpTarget(file, project.capability);
    assert.equal(firstParagraph(read(file, project.capability), file).frontmatter, oldMetadata.get(file), `${file}: help must not rewrite discovery metadata`);
  }
  const workspace = resolveWorkspaceContext(project.project);
  for (const { file, bytes } of indexes) {
    assert.deepEqual(fs.readFileSync(path.join(project.capability, file)), bytes, `${file}: existing generated entry remains intact`);
    const canonical = indexSource(bytes.toString('utf8'), workspace);
    helpTarget(slash(path.relative(workspace.capabilityRoot, canonical)), workspace.capabilityRoot);
  }
  assert.ok(!fs.existsSync(path.join(project.capability, 'config')), 'help is reachable without private project configuration');
  assert.equal(git(project.capability, 'status', '--porcelain'), '');
});

test('Overlay without a docs mapping resolves shared help from manifest CapabilityRoot', t => {
  const state = fixture(t);
  publishHelp(state);
  const { capability } = cloneProject(state, 'shared-project', updatePatterns);
  const moduleRoot = path.join(state.root, 'module');
  write(moduleRoot, '.agents/capability.json', JSON.stringify({ schemaVersion: 1, mode: 'workspace-overlay', workspace: 'help-module', contextRoot: '.agents', capabilityRoot: path.relative(moduleRoot, capability), sharedDirectories: ['plugins', 'agents', 'workflows'], localDirectories: ['config', 'rules', 'memory', 'skills', 'scripts'], sourceRoots: [{ name: 'module', path: 'src', target: 'src', gitRoot: 'src' }] }));
  const workspace = resolveWorkspaceContext(moduleRoot);
  assert.equal(workspace.mode, 'workspace-overlay');
  assert.equal(workspace.capabilityRoot, capability);
  assert.ok(!fs.existsSync(path.join(workspace.contextRoot, 'docs')), 'module has no docs junction');
  assert.ok(!fs.existsSync(path.join(workspace.contextRoot, 'config')), 'help needs no private config');
  for (const file of [pluginSkill, agent]) assert.equal(helpTarget(file, workspace.capabilityRoot), path.join(capability, protocol));
  assert.equal(read(protocol, workspace.capabilityRoot), read(protocol));
});
