#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RESULT_SCHEMA = 'imedical-component-version-result/v1';
const RELEASE_SCHEMA = 'imedical-component-release/v1';
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_PATH_RE = /^releases\/(plugin|skill)\/([^/]+)\/([^/]+)\.md$/;

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function parseSemver(value) {
  const match = SEMVER_RE.exec(String(value || ''));
  if (!match) return null;
  return { raw: String(value), major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemver(left, right) {
  const a = typeof left === 'string' ? parseSemver(left) : left;
  const b = typeof right === 'string' ? parseSemver(right) : right;
  if (!a || !b) throw new Error('compareSemver requires strict MAJOR.MINOR.PATCH values.');
  return Math.sign(a.major - b.major || a.minor - b.minor || a.patch - b.patch);
}

function expectedLevel(previous, next) {
  const oldVersion = parseSemver(previous);
  const newVersion = parseSemver(next);
  if (!oldVersion || !newVersion || compareSemver(newVersion, oldVersion) <= 0) return null;
  if (newVersion.major === oldVersion.major && newVersion.minor === oldVersion.minor && newVersion.patch === oldVersion.patch + 1) return 'patch';
  if (newVersion.major === oldVersion.major && newVersion.minor === oldVersion.minor + 1 && newVersion.patch === 0) return 'minor';
  if (newVersion.major === oldVersion.major + 1 && newVersion.minor === 0 && newVersion.patch === 0) return 'major';
  return null;
}

function inRange(version, minVersion, maxVersionExclusive) {
  return compareSemver(version, minVersion) >= 0 && compareSemver(version, maxVersionExclusive) < 0;
}

function runGit(repoRoot, args, allowFailure = false) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function parseScalar(raw) {
  const value = String(raw).trim();
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function parseFrontmatter(content) {
  const normalized = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') return { data: {}, body: normalized, hasFrontmatter: false };
  const data = {};
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      end = index;
      break;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[index]);
    if (match) data[match[1]] = parseScalar(match[2]);
  }
  if (end < 0) return { data: {}, body: normalized, hasFrontmatter: false };
  return { data, body: lines.slice(end + 1).join('\n'), hasFrontmatter: true };
}

function walkFiles(root, relative = '') {
  const current = path.join(root, relative);
  if (!fs.existsSync(current)) return [];
  const output = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const child = normalizePath(path.join(relative, entry.name));
    if (entry.isDirectory()) output.push(...walkFiles(root, child));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

function createSource(repoRoot, ref = null) {
  const root = path.resolve(repoRoot);
  if (ref) {
    const files = runGit(root, ['ls-tree', '-r', '--name-only', ref]).stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
    const fileSet = new Set(files);
    return {
      root,
      ref,
      files,
      has(file) { return fileSet.has(normalizePath(file)); },
      read(file) { return runGit(root, ['show', `${ref}:${normalizePath(file)}`]).stdout; }
    };
  }
  const prefixes = ['plugins', 'skills', 'releases'];
  const files = prefixes.flatMap((prefix) => walkFiles(root, prefix));
  const fileSet = new Set(files);
  return {
    root,
    ref: null,
    files,
    has(file) { return fileSet.has(normalizePath(file)); },
    read(file) { return fs.readFileSync(path.join(root, normalizePath(file)), 'utf8'); }
  };
}

function componentKey(type, name) {
  return `${type}:${name}`;
}

function releasePath(type, name, version) {
  return `releases/${type}/${name}/${version}.md`;
}

function buildSnapshot(repoRoot, ref = null) {
  const source = createSource(repoRoot, ref);
  const components = new Map();
  const releases = new Map();
  const internalSkillVersions = [];
  const componentCollisions = [];

  function addComponent(component) {
    const key = componentKey(component.type, component.name || component.directoryName);
    if (components.has(key)) {
      componentCollisions.push({ key, paths: [components.get(key).manifestPath, component.manifestPath] });
      return;
    }
    components.set(key, component);
  }

  for (const file of source.files) {
    let match = /^plugins\/([^/]+)\/\.agents-plugin\/plugin\.json$/.exec(file);
    if (match) {
      const directoryName = match[1];
      const manifest = JSON.parse(source.read(file));
      const dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
      const dependencyVersions = manifest.dependencyVersions && typeof manifest.dependencyVersions === 'object' && !Array.isArray(manifest.dependencyVersions)
        ? manifest.dependencyVersions
        : {};
      const component = {
        type: 'plugin',
        name: String(manifest.name || ''),
        version: String(manifest.version || ''),
        path: `plugins/${directoryName}`,
        manifestPath: file,
        directoryName,
        dependencies,
        dependencyVersions,
        legacyNames: Array.isArray(manifest.legacyNames) ? manifest.legacyNames.map(String) : []
      };
      addComponent(component);
      continue;
    }
    match = /^skills\/([^/]+)\/SKILL\.md$/.exec(file);
    if (match) {
      const frontmatter = parseFrontmatter(source.read(file)).data;
      const component = {
        type: 'skill',
        name: String(frontmatter.name || match[1]),
        version: String(frontmatter.version || ''),
        path: `skills/${match[1]}`,
        manifestPath: file,
        directoryName: match[1],
        dependencies: [],
        dependencyVersions: {},
        legacyNames: []
      };
      addComponent(component);
      continue;
    }
    match = /^plugins\/([^/]+)\/skills\/.+\/SKILL\.md$/.exec(file);
    if (match) {
      const frontmatter = parseFrontmatter(source.read(file)).data;
      if (frontmatter.version != null && String(frontmatter.version).trim()) {
        internalSkillVersions.push({ plugin: match[1], path: file, version: String(frontmatter.version) });
      }
      continue;
    }
    match = RELEASE_PATH_RE.exec(file);
    if (match) {
      const parsed = parseFrontmatter(source.read(file));
      releases.set(file, {
        path: file,
        content: source.read(file).replace(/\r\n/g, '\n'),
        data: parsed.data,
        body: parsed.body,
        pathType: match[1],
        pathName: match[2],
        pathVersion: match[3]
      });
    }
  }
  return { repoRoot: path.resolve(repoRoot), ref, source, components, releases, internalSkillVersions, componentCollisions };
}

function validateRelease(record, issues) {
  const data = record.data;
  const required = ['schema', 'component', 'name', 'version', 'previousVersion', 'level', 'breaking', 'status', 'date', 'migration', 'commit'];
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(data, field) || data[field] === '') {
      issues.push(issue('release-field-missing', `${record.path} is missing ${field}.`, { path: record.path, field }));
    }
  }
  if (data.schema !== RELEASE_SCHEMA) issues.push(issue('release-schema-invalid', `${record.path} must use ${RELEASE_SCHEMA}.`, { path: record.path }));
  if (data.component !== record.pathType || data.name !== record.pathName || data.version !== record.pathVersion) {
    issues.push(issue('release-path-mismatch', `${record.path} frontmatter does not match its path.`, { path: record.path }));
  }
  if (!parseSemver(data.version)) issues.push(issue('release-version-invalid', `${record.path} has an invalid version.`, { path: record.path }));
  if (data.previousVersion != null && !parseSemver(data.previousVersion)) issues.push(issue('release-previous-version-invalid', `${record.path} has an invalid previousVersion.`, { path: record.path }));
  if (!['baseline', 'initial', 'patch', 'minor', 'major'].includes(data.level)) issues.push(issue('release-level-invalid', `${record.path} has an invalid level.`, { path: record.path }));
  if (typeof data.breaking !== 'boolean') issues.push(issue('release-breaking-invalid', `${record.path} breaking must be true or false.`, { path: record.path }));
  if (!['active', 'removed'].includes(data.status)) issues.push(issue('release-status-invalid', `${record.path} has an invalid status.`, { path: record.path }));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ''))) issues.push(issue('release-date-invalid', `${record.path} date must be YYYY-MM-DD.`, { path: record.path }));
  if (!['none', 'required'].includes(data.migration)) issues.push(issue('release-migration-invalid', `${record.path} migration must be none or required.`, { path: record.path }));
  if (!/^[0-9a-f]{7,40}$/i.test(String(data.commit || ''))) issues.push(issue('release-commit-invalid', `${record.path} commit must be a Git object id.`, { path: record.path }));
  if (data.migration === 'required') {
    const migration = /(?:^|\n)## Migration\s*\n([\s\S]*?)(?=\n## |$)/.exec(record.body);
    if (!migration || !migration[1].trim()) issues.push(issue('release-migration-missing', `${record.path} requires a non-empty Migration section.`, { path: record.path }));
  }
  if (data.level === 'baseline' && (data.previousVersion != null || data.breaking !== false || data.status !== 'active')) {
    issues.push(issue('release-baseline-invalid', `${record.path} baseline must be active, non-breaking, and have previousVersion null.`, { path: record.path }));
  }
}

function validateSnapshot(snapshot) {
  const issues = [];
  for (const collision of snapshot.componentCollisions || []) {
    issues.push(issue('component-name-duplicate', `${collision.key} is declared more than once.`, { component: collision.key, paths: collision.paths }));
  }
  for (const component of snapshot.components.values()) {
    if (!component.name || component.name !== component.directoryName) {
      issues.push(issue('component-name-mismatch', `${component.manifestPath} name must match its directory.`, { component: componentKey(component.type, component.name), path: component.manifestPath }));
    }
    if (!parseSemver(component.version)) {
      issues.push(issue('component-version-invalid', `${componentKey(component.type, component.name)} must use strict MAJOR.MINOR.PATCH.`, { component: componentKey(component.type, component.name), path: component.manifestPath }));
    }
  }
  for (const item of snapshot.internalSkillVersions) {
    issues.push(issue('plugin-internal-version-forbidden', `${item.path} must inherit plugin:${item.plugin} version.`, { path: item.path, component: `plugin:${item.plugin}` }));
  }
  for (const record of snapshot.releases.values()) validateRelease(record, issues);

  for (const component of snapshot.components.values()) {
    const currentReleasePath = releasePath(component.type, component.name, component.version);
    const record = snapshot.releases.get(currentReleasePath);
    if (!record) {
      issues.push(issue('component-release-missing', `${componentKey(component.type, component.name)} ${component.version} has no release record.`, { component: componentKey(component.type, component.name), path: currentReleasePath }));
    } else if (record.data.status !== 'active') {
      issues.push(issue('component-release-not-active', `${currentReleasePath} must be active for the current component.`, { component: componentKey(component.type, component.name), path: currentReleasePath }));
    }
    if (component.type !== 'plugin') continue;
    if (!Array.isArray(component.dependencies) || component.dependencies.some((item) => typeof item !== 'string' || !item)) {
      issues.push(issue('dependency-names-invalid', `${component.manifestPath} dependencies must remain an array of names.`, { component: componentKey(component.type, component.name) }));
      continue;
    }
    const dependencyNames = [...new Set(component.dependencies)];
    if (dependencyNames.length !== component.dependencies.length) issues.push(issue('dependency-name-duplicate', `${component.manifestPath} has duplicate dependencies.`, { component: componentKey(component.type, component.name) }));
    const rangeNames = Object.keys(component.dependencyVersions || {});
    for (const name of dependencyNames) {
      const dependency = snapshot.components.get(componentKey('plugin', name));
      if (!dependency) {
        issues.push(issue('dependency-component-missing', `${component.name} depends on missing plugin ${name}.`, { component: `plugin:${component.name}`, dependency: name }));
        continue;
      }
      const range = component.dependencyVersions[name];
      if (!range) {
        issues.push(issue('dependency-version-missing', `${component.name} has no dependencyVersions entry for ${name}.`, { component: `plugin:${component.name}`, dependency: name }));
        continue;
      }
      if (!parseSemver(range.minVersion) || !parseSemver(range.maxVersionExclusive) || compareSemver(range.minVersion, range.maxVersionExclusive) >= 0) {
        issues.push(issue('dependency-range-invalid', `${component.name} has an invalid range for ${name}.`, { component: `plugin:${component.name}`, dependency: name }));
        continue;
      }
      if (!inRange(dependency.version, range.minVersion, range.maxVersionExclusive)) {
        issues.push(issue('dependency-version-incompatible', `${component.name} requires ${name} in [${range.minVersion}, ${range.maxVersionExclusive}), found ${dependency.version}.`, { component: `plugin:${component.name}`, dependency: name }));
      }
    }
    for (const name of rangeNames) {
      if (!dependencyNames.includes(name)) issues.push(issue('dependency-version-redundant', `${component.name} has a dependencyVersions entry not present in dependencies: ${name}.`, { component: `plugin:${component.name}`, dependency: name }));
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(name, stack) {
    if (visiting.has(name)) {
      issues.push(issue('dependency-cycle', `Plugin dependency cycle: ${[...stack, name].join(' -> ')}.`, { component: `plugin:${name}` }));
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    const component = snapshot.components.get(componentKey('plugin', name));
    if (component) for (const dependency of component.dependencies) visit(dependency, [...stack, name]);
    visiting.delete(name);
    visited.add(name);
  }
  for (const component of snapshot.components.values()) if (component.type === 'plugin') visit(component.name, []);
  return issues;
}

function validateTransition(previous, next, record, issues) {
  const key = componentKey(next.type, next.name);
  const level = expectedLevel(previous.version, next.version);
  if (!level) {
    issues.push(issue('component-version-nonconsecutive', `${key} must advance by exactly one patch, minor, or major step.`, { component: key, previousVersion: previous.version, version: next.version }));
    return;
  }
  if (!record) return;
  if (record.data.previousVersion !== previous.version) issues.push(issue('release-previous-version-mismatch', `${record.path} previousVersion must be ${previous.version}.`, { path: record.path, component: key }));
  if (record.data.level !== level) issues.push(issue('release-level-mismatch', `${record.path} level must be ${level}.`, { path: record.path, component: key }));
  if (record.data.breaking === true) {
    const nextVersion = parseSemver(next.version);
    if (nextVersion.major === 0 && level !== 'minor') issues.push(issue('breaking-version-level-invalid', `${key} 0.x breaking changes must use a minor bump.`, { component: key }));
    if (nextVersion.major > 0 && level !== 'major') issues.push(issue('breaking-version-level-invalid', `${key} 1.x+ breaking changes must use a major bump.`, { component: key }));
    if (record.data.migration !== 'required') issues.push(issue('breaking-migration-required', `${record.path} must declare migration: required.`, { path: record.path, component: key }));
  } else if (level === 'major') {
    issues.push(issue('major-release-must-be-breaking', `${record.path} major releases must declare breaking: true.`, { path: record.path, component: key }));
  }
}

function compareSnapshots(previous, next, options = {}) {
  const issues = [...validateSnapshot(next)];
  const changes = [];
  const acceptValues = options.acceptBreaking || [];
  const accepted = new Set();
  const consumed = new Set();
  for (const value of acceptValues) {
    if (!/^(plugin|skill):[a-z0-9][a-z0-9-]*@\d+\.\d+\.\d+$/.test(value) || value.includes('*')) {
      issues.push(issue('breaking-authorization-invalid', `Invalid breaking authorization: ${value}.`, { authorization: value }));
    } else accepted.add(value);
  }

  for (const [recordPath, oldRecord] of previous.releases) {
    const newRecord = next.releases.get(recordPath);
    if (!newRecord) issues.push(issue('release-record-deleted', `${recordPath} is immutable and cannot be deleted.`, { path: recordPath }));
    else if (oldRecord.content !== newRecord.content) issues.push(issue('release-record-modified', `${recordPath} is immutable and cannot be modified.`, { path: recordPath }));
  }

  const renamedOldKeys = new Set();
  for (const nextComponent of next.components.values()) {
    if (nextComponent.type !== 'plugin') continue;
    for (const legacyName of nextComponent.legacyNames) {
      const oldKey = componentKey('plugin', legacyName);
      if (!previous.components.has(oldKey)) continue;
      renamedOldKeys.add(oldKey);
      const oldComponent = previous.components.get(oldKey);
      const record = next.releases.get(releasePath('plugin', nextComponent.name, nextComponent.version));
      if (!record || record.data.breaking !== true || record.data.migration !== 'required' || record.data.previousVersion !== oldComponent.version) {
        issues.push(issue('component-rename-release-invalid', `${legacyName} -> ${nextComponent.name} requires a breaking release with migration instructions.`, { component: `plugin:${nextComponent.name}` }));
      }
    }
  }

  for (const [key, nextComponent] of next.components) {
    const oldComponent = previous.components.get(key);
    const record = next.releases.get(releasePath(nextComponent.type, nextComponent.name, nextComponent.version));
    if (!oldComponent) {
      if (nextComponent.type === 'plugin' && nextComponent.legacyNames.some((name) => previous.components.has(componentKey('plugin', name)))) continue;
      changes.push({ component: key, from: null, to: nextComponent.version, level: 'initial', breaking: false });
      if (!record || record.data.level !== 'initial' || record.data.previousVersion != null || record.data.breaking !== false) {
        issues.push(issue('component-initial-release-invalid', `${key} requires a non-breaking initial release record.`, { component: key }));
      }
      continue;
    }
    const comparison = parseSemver(oldComponent.version) && parseSemver(nextComponent.version) ? compareSemver(nextComponent.version, oldComponent.version) : 0;
    if (comparison < 0) {
      issues.push(issue('component-version-downgrade', `${key} cannot downgrade from ${oldComponent.version} to ${nextComponent.version}.`, { component: key }));
      continue;
    }
    if (comparison === 0) continue;
    validateTransition(oldComponent, nextComponent, record, issues);
    const breaking = Boolean(record && record.data.breaking === true);
    const change = { component: key, from: oldComponent.version, to: nextComponent.version, level: record ? record.data.level : null, breaking };
    changes.push(change);
    if (options.blockBreaking && breaking) {
      const authorization = `${key}@${nextComponent.version}`;
      if (accepted.has(authorization)) consumed.add(authorization);
      else issues.push(issue('breaking-upgrade-not-accepted', `${authorization} requires exact authorization.`, { component: key, authorization }));
    }
  }

  for (const [key, oldComponent] of previous.components) {
    if (next.components.has(key) || renamedOldKeys.has(key)) continue;
    const removal = [...next.releases.values()].find((record) => record.data.component === oldComponent.type && record.data.name === oldComponent.name && record.data.status === 'removed' && record.data.previousVersion === oldComponent.version);
    if (!removal || removal.data.breaking !== true || removal.data.migration !== 'required' || !expectedLevel(oldComponent.version, removal.data.version)) {
      issues.push(issue('component-removal-release-missing', `${key} removal requires a versioned breaking removal record with migration instructions.`, { component: key }));
    }
    changes.push({ component: key, from: oldComponent.version, to: removal ? removal.data.version : null, level: removal ? removal.data.level : null, breaking: true, status: 'removed' });
  }

  for (const value of accepted) if (!consumed.has(value)) issues.push(issue('breaking-authorization-unused', `Breaking authorization was not consumed: ${value}.`, { authorization: value }));
  return { issues, changes };
}

function changedFiles(repoRoot, baseRef, headRef) {
  const args = ['diff', '--name-status', baseRef];
  if (headRef) args.push(headRef);
  args.push('--');
  const output = runGit(repoRoot, args).stdout.split(/\r?\n/).filter(Boolean).map((line) => normalizePath(line.split('\t').at(-1)));
  if (!headRef) {
    const untracked = runGit(repoRoot, ['ls-files', '--others', '--exclude-standard']).stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
    output.push(...untracked);
  }
  return [...new Set(output)];
}

function validateChanges(previous, next, files) {
  const result = compareSnapshots(previous, next, { blockBreaking: false });
  const issues = result.issues;
  const bootstrap = previous.releases.size === 0 && next.components.size > 0 && [...next.components.values()].every((component) => next.releases.has(releasePath(component.type, component.name, component.version)));
  if (bootstrap) return { issues, changes: result.changes, bootstrap: true };

  const touched = new Set();
  for (const file of files) {
    let match = /^plugins\/([^/]+)\//.exec(file);
    if (match) {
      const component = [...next.components.values()].find((item) => item.type === 'plugin' && item.directoryName === match[1]) || [...previous.components.values()].find((item) => item.type === 'plugin' && item.directoryName === match[1]);
      if (component) touched.add(componentKey('plugin', component.name));
      continue;
    }
    match = /^skills\/([^/]+)\//.exec(file);
    if (match) touched.add(componentKey('skill', match[1]));
  }
  for (const key of touched) {
    const oldComponent = previous.components.get(key);
    const newComponent = next.components.get(key);
    if (oldComponent && newComponent && oldComponent.version === newComponent.version) {
      issues.push(issue('component-version-not-bumped', `${key} changed without a version bump.`, { component: key }));
    }
  }
  return { issues, changes: result.changes, bootstrap: false };
}

function parseCli(argv) {
  const command = argv[0];
  const options = { repoRoot: '.', format: 'text', acceptBreaking: [] };
  const names = {
    '--repo-root': 'repoRoot', '--ref': 'ref', '--base-ref': 'baseRef', '--head-ref': 'headRef',
    '--from-ref': 'fromRef', '--to-ref': 'toRef', '--format': 'format', '--accept-breaking': 'acceptBreaking'
  };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--worktree') { options.worktree = true; continue; }
    const name = names[token];
    if (!name) throw new Error(`Unknown option: ${token}`);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${token} requires a value.`);
    index += 1;
    if (name === 'acceptBreaking') options.acceptBreaking.push(value);
    else options[name] = value;
  }
  if (!['text', 'json'].includes(options.format)) throw new Error('--format must be text or json.');
  return { command, options };
}

function resultPayload(command, snapshot, issues, extra = {}) {
  return {
    schema: RESULT_SCHEMA,
    command,
    ok: issues.length === 0,
    issues,
    componentCount: snapshot ? snapshot.components.size : undefined,
    components: snapshot ? [...snapshot.components.values()].map((item) => ({
      type: item.type, name: item.name, version: item.version,
      dependencies: item.dependencies.map((name) => ({ name, ...(item.dependencyVersions[name] || {}) }))
    })).sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`)) : undefined,
    ...extra
  };
}

function printResult(payload, format) {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.command === 'inventory') {
    for (const component of payload.components) {
      const dependencies = component.dependencies.length ? ` dependencies=${component.dependencies.map((item) => `${item.name}[${item.minVersion},${item.maxVersionExclusive})`).join(',')}` : '';
      process.stdout.write(`${component.type}:${component.name}@${component.version}${dependencies}\n`);
    }
  }
  if (payload.changes && payload.changes.length) for (const change of payload.changes) process.stdout.write(`change ${change.component} ${change.from || '<none>'} -> ${change.to || '<removed>'}${change.breaking ? ' breaking' : ''}\n`);
  if (payload.ok) process.stdout.write(`component-version-ok: ${payload.componentCount == null ? '' : `${payload.componentCount} component(s)`}`.trimEnd() + '\n');
  else for (const item of payload.issues) process.stdout.write(`${item.code}: ${item.message}\n`);
}

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCli(argv);
    const { command, options } = parsed;
    const repoRoot = path.resolve(options.repoRoot);
    let payload;
    if (command === 'inventory') {
      const snapshot = buildSnapshot(repoRoot, options.ref || null);
      payload = resultPayload(command, snapshot, validateSnapshot(snapshot));
    } else if (command === 'validate') {
      const next = buildSnapshot(repoRoot, options.headRef || null);
      if (options.baseRef) {
        const previous = buildSnapshot(repoRoot, options.baseRef);
        const validation = validateChanges(previous, next, changedFiles(repoRoot, options.baseRef, options.headRef || null));
        payload = resultPayload(command, next, validation.issues, { changes: validation.changes, bootstrap: validation.bootstrap });
      } else {
        payload = resultPayload(command, next, validateSnapshot(next));
      }
    } else if (command === 'compare') {
      if (!options.fromRef || !options.toRef) throw new Error('compare requires --from-ref and --to-ref.');
      const previous = buildSnapshot(repoRoot, options.fromRef);
      const next = buildSnapshot(repoRoot, options.toRef);
      const comparison = compareSnapshots(previous, next, { blockBreaking: true, acceptBreaking: options.acceptBreaking });
      payload = resultPayload(command, next, comparison.issues, { changes: comparison.changes });
    } else {
      throw new Error('Command must be inventory, validate, or compare.');
    }
    printResult(payload, options.format);
    return payload.ok ? 0 : 1;
  } catch (error) {
    const payload = { schema: RESULT_SCHEMA, command: parsed ? parsed.command : null, ok: false, issues: [issue('component-version-runtime-error', error.message)] };
    printResult(payload, parsed ? parsed.options.format : 'text');
    return 2;
  }
}

module.exports = {
  RELEASE_SCHEMA,
  buildSnapshot,
  compareSemver,
  compareSnapshots,
  expectedLevel,
  inRange,
  main,
  parseFrontmatter,
  parseSemver,
  validateChanges,
  validateSnapshot
};

if (require.main === module) process.exitCode = main();
