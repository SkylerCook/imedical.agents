'use strict';

// Product adapter for the existing offline snapshot publisher. No remote writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const publisher = require('./sync-menu');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = file => { publisher.noLinks(file); return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); };
const sourceHash = source => hash(source.replace(/\r\n/g, '\n').trimEnd());
const helper = path.resolve(__dirname, '../../../../scripts/iris-mcp.js');
const CLASS = 'DHCDoc.Common.Menu';
function fail(message) { throw new Error(message); }
function write(file, value) {
  publisher.noLinks(file);
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  if (hash(read(temporary)) !== hash(value)) fail('Checkpoint readback failed');
  fs.renameSync(temporary, file);
}
function checkpoint(file, state) { write(file, { state, checksum: hash(state) }); }
function restore(file) { const saved = read(file); if (saved.checksum !== hash(saved.state)) fail('Checkpoint integrity failed'); return saved.state; }
function target(workspace) {
  const server = read(path.join(workspace, '.mcp.json')).mcpServers?.['iris-agentic-dev'];
  const env = server?.env;
  if (!env?.IRIS_HOST || !env.IRIS_WEB_PORT || !env.IRIS_NAMESPACE) fail('Explicit IRIS configuration required');
  return hash([env.IRIS_HOST, env.IRIS_WEB_PORT, env.IRIS_NAMESPACE]);
}
function client(workspace) {
  function invoke(command, args, toolArgs) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = JSON.parse(cp.execFileSync(process.execPath, [helper, command, ...args], {
          cwd: workspace, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 150000,
          stdio: ['ignore', 'pipe', 'pipe']
        }));
      } catch { fail('MCP process failed; snapshot preserved'); }
      if (!response.CHECK?.connected || !response.CHECK.hostLoaded || response.CHECK.namespaceIsDefaultUser) {
        if (attempt === 0) continue; // One new connection; never reinterpret a failure as an empty menu.
        fail('MCP connection unavailable');
      }
      if (command === 'tools') return response.TOOL_SCHEMAS;
      const result = response.RESULT;
      if (attempt === 0 && JSON.stringify(result?.error || result?.error_code || '').includes('IRIS_UNREACHABLE')) continue;
      if (result?.success !== true || result.truncated || result.isError) fail('MCP call failed: ' + args[0]);
      if (target(workspace) !== toolArgs.fingerprint) fail('Connection changed during acquisition');
      return result;
    }
  }
  const fingerprint = target(workspace);
  return {
    fingerprint,
    async schema() { return invoke('tools', ['--names', 'iris_query,iris_execute,iris_doc', '--schema', '--json']); },
    async call(name, args) {
      if (!['iris_query', 'iris_doc', 'iris_execute'].includes(name)) fail('Tool outside menu acquisition scope');
      return invoke('call', [name, JSON.stringify(args), ...(name === 'iris_execute' ? ['--allow-write'] : []), '--json'], { fingerprint });
    }
  };
}
function parseArrays(output, expected) {
  // The observed HTTP capture inserts physical line breaks every 32000 characters.
  // JSON strings already escape newlines; remove only physical CR/LF, then parse complete top-level arrays.
  if (typeof output !== 'string') fail('Missing execution output');
  const raw = output.replace(/[\r\n]/g, ''), values = [];
  let start = 0, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      if (--depth < 0) fail('Invalid execution output');
      if (!depth) { values.push(JSON.parse(raw.slice(start, i + 1).trim())); start = i + 1; }
    }
  }
  if (depth || quoted || raw.slice(start).trim() || values.length !== expected || values.some(v => !Array.isArray(v))) fail('Incomplete menu output');
  return values;
}
function normalizeData(catalog, groups, capturedAt, sourceId) {
  const stats = { virtualIds: 0, repeatedVirtualIds: 0, unnamed: 0 };
  function label(value, id) {
    const result = String(value || '').replace(/[\u0000-\u001f]/g, ' ');
    if (result.trim()) return result;
    stats.unnamed++; return '[未命名菜单 ' + id + ']';
  }
  function nodes(items, parent, depth = 0) {
    if (!Array.isArray(items) || depth > 64) fail('Invalid menu tree');
    const occurrences = new Map();
    return items.map(n => {
      let id = String(n.id ?? '');
      if (!id) {
        const signature = hash([parent, n.code || '', n.lintUrl || '', n.text || '']);
        const count = (occurrences.get(signature) || 0) + 1; occurrences.set(signature, count);
        id = 'virtual_' + signature.slice(0, 24) + (count > 1 ? '_' + count : '');
        stats.virtualIds++; if (count > 1) stats.repeatedVirtualIds++;
      }
      return { id, text: label(n.text, id), code: String(n.code || ''), url: String(n.lintUrl || ''), children: nodes(n.children || [], parent + '/' + id, depth + 1) };
    });
  }
  const input = { schema: 'iris-menu-snapshot/v1', sourceId, scope: 'all', complete: true, capturedAt,
    catalog: catalog.map(n => ({ id: String(n.id), text: label(n.text, n.id), code: String(n.code || ''), url: String(n.url || ''), parentId: String(n.parentId || '') })),
    groups: groups.map(g => ({ id: String(g.id), name: String(g.name || '[未命名安全组 ' + g.id + ']'), menus: nodes(g.menus, 'group/' + g.id) })) };
  publisher.normalize(input);
  return { input, stats };
}
async function query(api, query, parameters = []) {
  const r = await api.call('iris_query', { query, parameters });
  if (!Array.isArray(r.rows) || r.count !== r.rows.length || r.has_more || r.truncated) fail('Incomplete SQL result');
  return r.rows;
}
async function page(api, table, id, fields) {
  const expected = Number((await query(api, 'SELECT COUNT(*) AS total FROM ' + table))[0].total);
  const rows = [];
  while (rows.length < expected) {
    const last = rows.length ? Number(rows.at(-1).id) : 0;
    const batch = await query(api, 'SELECT TOP 500 ' + fields + ' FROM ' + table + ' WHERE ' + id + ' > ? ORDER BY ' + id, [String(last)]);
    if (!batch.length || batch.some((r, i) => !Number.isSafeInteger(Number(r.id)) || Number(r.id) <= (i ? Number(batch[i - 1].id) : last))) fail('SQL pagination invalid');
    rows.push(...batch);
  }
  if (rows.length !== expected) fail('SQL row count changed');
  return rows;
}
async function preflight(api, profile) {
  if (api.fingerprint !== profile.targetFingerprint) fail('Configured environment differs from enrolled source');
  const schema = await api.schema();
  for (const [name, fields] of [['iris_query', ['query', 'parameters']], ['iris_execute', ['code']], ['iris_doc', ['mode', 'name']]]) {
    const tool = schema?.find(t => t.name === name);
    if (!fields.every(f => Object.hasOwn(tool?.inputSchema?.properties || {}, f))) fail('MCP schema changed: ' + name);
  }
  const doc = await api.call('iris_doc', { mode: 'get', name: CLASS + '.cls' });
  if (typeof doc.content !== 'string' || sourceHash(doc.content) !== profile.methodSourceHash) fail('Menu class changed; review and enroll again before unattended execution');
  const tables = {
    'SQLUser.SS_Group': ['SSGRP_RowId', 'SSGRP_Desc', 'SSGRP_ActiveFlag'],
    'websys.Menu': ['ID', 'Caption', 'Name', 'LinkUrl', 'SubMenuOf'],
    'epr.GroupSettings': ['ID', 'GroupDR', 'MainMenuDR']
  };
  for (const [table, required] of Object.entries(tables)) {
    const [schemaName, tableName] = table.split('.');
    const columns = await query(api, 'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schemaName, tableName]);
    if (required.some(name => !columns.some(c => c.COLUMN_NAME === name))) fail('SQL schema changed: ' + table);
  }
}
function guard(previous, next, changes, profile) {
  if (!next.catalog.length || !next.groups.length) fail('Empty full acquisition requires human review');
  if (!previous) return;
  for (const [name, items] of [['catalog', next.catalog], ['groups', next.groups]]) {
    if (previous[name].length && (previous[name].length - items.length) / previous[name].length > profile.maxRemovalRatio) fail('Large ' + name + ' reduction requires human review');
  }
  function size(s) { let n = s.catalog.length + s.groups.length; const visit = a => a.forEach(i => { n++; visit(i.children || []); }); s.groups.forEach(g => visit(g.menus)); return n; }
  if (changes.removed.length / Math.max(1, size(previous)) > profile.maxRemovalRatio) fail('Large menu removal requires human review');
  const before = new Map(previous.groups.map(g => [g.id, g]));
  if (next.groups.some(g => !g.menus.length && before.get(g.id)?.menus.length)) fail('Previously nonempty group became empty; human review required');
}
function monthKey(value, timeZone) {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) fail('Invalid capture timestamp');
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(date);
}
async function refresh({ workspace, sourceId, execute = false, api, runId = crypto.randomUUID(), resume = false, onProgress = () => {}, oncePerMonth = false, timeZone = 'UTC', now = new Date() }) {
  publisher.id(sourceId);
  if (!/^[0-9a-f-]{36}$/.test(runId)) fail('Invalid run id');
  const context = publisher.resolveProject(workspace), root = path.join(context.contextRoot, 'work/menu-sync', sourceId);
  const configFile = path.join(context.contextRoot, 'config/menu-sync', sourceId + '.json');
  publisher.noLinks(configFile); const profile = read(configFile);
  if (profile.schema !== 'iris-menu-refresh/v1' || profile.sourceId !== sourceId || profile.groupFilter !== 'active' || profile.allowMenuRead !== true || !Number.isFinite(profile.maxRemovalRatio) || profile.maxRemovalRatio <= 0 || profile.maxRemovalRatio > 0.5) fail('Invalid menu refresh profile');
  api ||= client(context.workspaceRoot);
  if (api.fingerprint !== profile.targetFingerprint) fail('Configured environment differs from enrolled source');
  const previous = publisher.current(root);
  if (previous.generation) {
    const evidence = path.join(root, previous.generation, 'acquisition.json'); publisher.noLinks(evidence);
    if (!fs.existsSync(evidence) || read(evidence).targetFingerprint !== profile.targetFingerprint) fail('Previous snapshot source cannot be verified');
  }
  if (oncePerMonth && previous.snapshot?.coverage === 'all' && monthKey(previous.snapshot.catalogCapturedAt, timeZone) === monthKey(now, timeZone)) {
    return { status: 'already-current-month', sourceId, revision: previous.revision, capturedAt: previous.snapshot.catalogCapturedAt };
  }
  await preflight(api, profile);
  const runs = path.join(root, 'runs'), run = path.join(runs, runId); publisher.noLinks(run);
  fs.mkdirSync(runs, { recursive: true });
  const lock = path.join(root, '.refresh-lock'); fs.mkdirSync(lock);
  let done = false;
  try {
    let state;
    if (resume) {
      state = restore(path.join(run, 'checkpoint.json'));
      if (state.profileHash !== hash(profile) || state.revision !== previous.revision || Date.now() - Date.parse(state.startedAt) > 3600000) fail('Checkpoint expired or source/baseline changed');
    } else {
      fs.mkdirSync(run);
      state = { schema: 'iris-menu-acquisition/v1', profileHash: hash(profile), revision: previous.revision, startedAt: new Date().toISOString(), groups: [] };
      checkpoint(path.join(run, 'checkpoint.json'), state);
      // Independent disk readback precedes expanding the acquisition.
      if (restore(path.join(run, 'checkpoint.json')).profileHash !== state.profileHash) fail('Checkpoint unavailable');
    }
    const masterGroups = await page(api, 'SQLUser.SS_Group', 'SSGRP_RowId', 'SSGRP_RowId AS id,SSGRP_Desc AS name,SSGRP_ActiveFlag AS active');
    const settings = await page(api, 'epr.GroupSettings', 'ID', 'ID AS id,GroupDR AS groupId,MainMenuDR AS mainMenu');
    const selected = masterGroups.filter(g => g.active === 'Y');
    if (selected.some(g => !settings.some(s => String(s.groupId) === String(g.id)))) fail('Active group settings missing');
    const membershipHash = hash([masterGroups, settings]);
    if (state.membershipHash && state.membershipHash !== membershipHash) fail('Group settings changed since checkpoint');
    state.membershipHash = membershipHash;
    if (!state.catalog) {
      state.catalog = await page(api, 'websys.Menu', 'ID', 'ID AS id,Caption AS text,Name AS code,LinkUrl AS url,SubMenuOf AS parentId');
      checkpoint(path.join(run, 'checkpoint.json'), state);
    }
    const pending = selected.filter(g => !state.groups.some(saved => String(saved.id) === String(g.id)));
    for (let i = 0; i < pending.length; i += 8) {
      const batch = pending.slice(i, i + 8);
      if (batch.some(g => !/^\d+$/.test(String(g.id)))) fail('Invalid group id');
      const code = batch.map(g => 'write ##class(' + CLASS + ').getGroupData(' + g.id + ').%ToJSON(),$char(10)').join('\n');
      const r = await api.call('iris_execute', { code });
      const trees = parseArrays(r.output, batch.length);
      batch.forEach((g, index) => state.groups.push({ id: String(g.id), name: g.name, menus: trees[index] }));
      checkpoint(path.join(run, 'checkpoint.json'), state);
      onProgress({ status: 'acquiring', runId, completedGroups: state.groups.length, totalGroups: selected.length });
    }
    const endGroups = await page(api, 'SQLUser.SS_Group', 'SSGRP_RowId', 'SSGRP_RowId AS id,SSGRP_Desc AS name,SSGRP_ActiveFlag AS active');
    const endSettings = await page(api, 'epr.GroupSettings', 'ID', 'ID AS id,GroupDR AS groupId,MainMenuDR AS mainMenu');
    if (membershipHash !== hash([endGroups, endSettings]) || state.catalog.length !== Number((await query(api, 'SELECT COUNT(*) AS total FROM websys.Menu'))[0].total)) fail('Source changed during acquisition');
    await preflight(api, profile);
    const { input, stats } = normalizeData(state.catalog, state.groups, new Date().toISOString(), sourceId);
    write(path.join(run, 'input.json'), input);
    const plan = publisher.sync({ root, input });
    guard(previous.snapshot, input, plan.changes, profile);
    const changes = Object.fromEntries(Object.entries(plan.changes).map(([k, v]) => [k, v.length]));
    let result = { status: 'planned', sourceId, runId, changes, catalog: input.catalog.length, groups: input.groups.length };
    if (execute) {
      if (target(context.workspaceRoot) !== profile.targetFingerprint) fail('Connection configuration changed');
      const evidence = { schema: 'menu-acquisition-evidence/v1', sourceId, targetFingerprint: profile.targetFingerprint, methodSourceHash: profile.methodSourceHash,
        startedAt: state.startedAt, finishedAt: input.capturedAt, groupFilter: "SSGRP_ActiveFlag = 'Y'", excludedGroups: masterGroups.filter(g => g.active !== 'Y'),
        emptyGroups: input.groups.filter(g => !g.menus.length).map(g => g.id), ...stats,
        virtualIdDerivation: 'SHA256(parent path, code, URL, text), plus repeated-occurrence suffix', bdpCoverage: 'Existing predefined roots and descendants; not the full BDP catalog', changes };
      const applied = publisher.sync({ root, input, write: true, expectHash: plan.revision, expectInput: plan.inputHash, acquisition: evidence });
      const current = publisher.current(root);
      if (current.revision !== applied.revision) fail('Published revision readback failed');
      for (const [name, content] of Object.entries(publisher.render(current.snapshot))) if (fs.readFileSync(path.join(root, current.generation, name), 'utf8') !== content) fail('Published documents differ');
      result = { ...result, status: Object.values(changes).some(Boolean) ? 'refreshed' : 'no-menu-changes', revision: applied.revision, generation: current.generation, capturedAt: input.capturedAt };
      done = true;
    }
    write(path.join(run, 'result.json'), result);
    return result;
  } catch (error) {
    if (fs.existsSync(run)) write(path.join(run, 'failure.json'), { status: 'failed', runId, message: error.message, failedAt: new Date().toISOString() });
    throw error;
  } finally {
    if (done) { publisher.noLinks(run); fs.rmSync(run, { recursive: true }); }
    fs.rmdirSync(lock);
  }
}
async function enroll(workspace, sourceId, allowMenuRead) {
  if (!allowMenuRead) fail('Enrollment requires explicit --allow-menu-read after reviewing the read method');
  publisher.id(sourceId); const context = publisher.resolveProject(workspace), api = client(context.workspaceRoot);
  const current = publisher.current(path.join(context.contextRoot, 'work/menu-sync', sourceId));
  if (current.generation) {
    const evidence = path.join(context.contextRoot, 'work/menu-sync', sourceId, current.generation, 'acquisition.json'); publisher.noLinks(evidence);
    if (!fs.existsSync(evidence) || read(evidence).targetFingerprint !== api.fingerprint) fail('Existing source identity mismatch');
  }
  const doc = await api.call('iris_doc', { mode: 'get', name: CLASS + '.cls' });
  if (typeof doc.content !== 'string' || !doc.content.includes('ClassMethod getGroupData(')) fail('Menu method missing');
  const file = path.join(context.contextRoot, 'config/menu-sync', sourceId + '.json'); publisher.noLinks(file);
  if (fs.existsSync(file)) fail('Source already enrolled; review the existing profile explicitly');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  write(file, { schema: 'iris-menu-refresh/v1', sourceId, targetFingerprint: api.fingerprint, methodSourceHash: sourceHash(doc.content), allowMenuRead: true, groupFilter: 'active', maxRemovalRatio: 0.1 });
  return { status: 'enrolled', sourceId };
}
async function main(argv) {
  if (argv.includes('--help')) { console.log('refresh-menu.js enroll|run --project-root <workspace> --source-id <alias> [--allow-menu-read] [--execute] [--resume <run UUID>] [--once-per-month --time-zone <IANA zone>]'); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) fail('Node.js >=22.5.0 is required for the agent toolchain');
  const mode = argv.shift(), opts = {};
  while (argv.length) {
    const key = argv.shift();
    if (['--execute', '--allow-menu-read', '--once-per-month'].includes(key)) { if (opts[key]) fail('Duplicate flag'); opts[key] = true; }
    else if (['--project-root', '--source-id', '--resume', '--time-zone'].includes(key) && argv[0] && !argv[0].startsWith('--') && !opts[key]) opts[key] = argv.shift();
    else fail('Invalid arguments');
  }
  if (!['run', 'enroll'].includes(mode) || !opts['--project-root'] || !opts['--source-id']) fail('Explicit project, source and run/enroll required');
  if (mode === 'enroll' && (opts['--execute'] || opts['--resume'] || opts['--once-per-month'] || opts['--time-zone'])) fail('Invalid enrollment flags');
  if (mode === 'run' && opts['--allow-menu-read']) fail('Read authorization belongs to enrollment');
  const result = mode === 'enroll' ? await enroll(opts['--project-root'], opts['--source-id'], opts['--allow-menu-read']) : await refresh({ workspace: opts['--project-root'], sourceId: opts['--source-id'], execute: !!opts['--execute'], oncePerMonth: !!opts['--once-per-month'], timeZone: opts['--time-zone'] || 'UTC', resume: !!opts['--resume'], ...(opts['--resume'] ? { runId: opts['--resume'] } : {}), onProgress: p => console.error(JSON.stringify(p)) });
  console.log(JSON.stringify(result));
}
module.exports = { parseArrays, normalizeData, guard, refresh, enroll, sourceHash, monthKey, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error('Menu refresh stopped: ' + error.message); process.exitCode = 1; });
