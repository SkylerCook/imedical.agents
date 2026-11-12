'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const toolsRoot = path.join(repoRoot, 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools');
const tools = ['prepare-deploy-manifest.js', 'deploy-protected.js', 'export.js', 'debugger-legacy.js', 'sync-env-config.js'];

// Thin entrypoints delegate configuration lookup to their actual implementation.
assert.match(fs.readFileSync(path.join(toolsRoot, 'compile.js'), 'utf8'), /require\('\.\/deploy-protected'\)\.main/);
assert.match(fs.readFileSync(path.join(toolsRoot, 'debugger.js'), 'utf8'), /require\('\.\/debugger-legacy'\)/);

for (const tool of tools) {
  const text = fs.readFileSync(path.join(toolsRoot, tool), 'utf8');
  assert.match(text, /resolveWorkspaceContext/, `${tool} must reuse workspace-context.js`);
  assert.doesNotMatch(text, /function findWorkspaceRoot/, `${tool} must not maintain its own upward .agents search`);
}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-workspace-context-'));
try {
  const workspaceRoot = path.join(testRoot, 'workspace');
  const contextRoot = path.join(workspaceRoot, '.agents');
  const capabilityRoot = path.join(testRoot, 'capability');
  fs.mkdirSync(path.join(contextRoot, 'config'), { recursive: true });
  const initialized = spawnSync('git', ['init', '-q', workspaceRoot], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(initialized.status, 0, initialized.stderr);
  fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '.mcp.json\n.agents/\n');
  fs.mkdirSync(path.join(capabilityRoot, 'plugins', 'coding-iris-plugin', 'templates'), { recursive: true });
  fs.writeFileSync(path.join(capabilityRoot, 'plugins', 'coding-iris-plugin', 'templates', 'project-env.template.json'), '{}');
  fs.writeFileSync(path.join(contextRoot, 'project-placeholder'), 'context');
  fs.writeFileSync(path.join(contextRoot, 'config', 'project-env.json'), JSON.stringify({
    iris: { host: '127.0.0.1', username: 'user', password: 'secret', namespace: 'TEST' },
    mcp: { serverName: 'iris', serverPath: 'iris-agentic-dev.exe' },
    sftp: { enabled: false },
  }));
  fs.writeFileSync(path.join(contextRoot, 'capability.json'), JSON.stringify({
    schemaVersion: 1,
    mode: 'workspace-overlay',
    workspace: 'workspace',
    contextRoot: '.agents',
    capabilityRoot,
    sharedDirectories: ['plugins', 'vendor', 'skills'],
    localDirectories: ['config', 'rules', 'memory', 'work'],
    sourceRoots: [{ name: 'backend', path: 'backend', target: workspaceRoot, gitRoot: workspaceRoot }],
  }));

  const result = spawnSync(process.execPath, [path.join(toolsRoot, 'sync-env-config.js')], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(contextRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stderr + result.stdout, /Workspace root:/);
  assert.ok(fs.existsSync(path.join(workspaceRoot, '.mcp.json')), 'sync-env-config must write workspace-local .mcp.json');
  const generatedMcp = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.mcp.json'), 'utf8'));
  assert.ok(generatedMcp.mcpServers.iris.args.includes('--no-skills'), 'generated MCP config must disable built-in skills by default');
  assert.strictEqual(generatedMcp.mcpServers.iris.env.IRIS_NO_SKILLS, 'true');

  const optInConfigPath = path.join(contextRoot, 'config', 'project-env.json');
  const optInConfig = JSON.parse(fs.readFileSync(optInConfigPath, 'utf8'));
  optInConfig.mcp.includeBuiltInSkills = true;
  fs.writeFileSync(optInConfigPath, JSON.stringify(optInConfig));
  const optInResult = spawnSync(process.execPath, [path.join(toolsRoot, 'sync-env-config.js')], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(optInResult.status, 0, optInResult.stderr);
  const optInMcp = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.mcp.json'), 'utf8'));
  assert.ok(!optInMcp.mcpServers.iris.args.includes('--no-skills'), 'explicit opt-in must keep built-in skill tools');
  assert.strictEqual(optInMcp.mcpServers.iris.env.IRIS_NO_SKILLS, 'false');

  const mcpPath = path.join(workspaceRoot, '.mcp.json');
  optInMcp.inputs = [{ id: 'custom-input', type: 'promptString' }];
  optInMcp.mcpServers.iris.disabled = true;
  optInMcp.mcpServers.iris.timeout = 123;
  optInMcp.mcpServers.iris.env.CUSTOM_SETTING = 'preserved';
  optInMcp.mcpServers.other = { command: 'custom-tool' };
  fs.writeFileSync(mcpPath, JSON.stringify(optInMcp));
  const runSync = () => spawnSync(process.execPath, [path.join(toolsRoot, 'sync-env-config.js')], {
    cwd: workspaceRoot, encoding: 'utf8', windowsHide: true,
  });
  assert.strictEqual(runSync().status, 0);
  const preserved = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.deepStrictEqual(preserved.inputs, optInMcp.inputs);
  assert.deepStrictEqual(preserved.mcpServers.other, optInMcp.mcpServers.other);
  assert.strictEqual(preserved.mcpServers.iris.disabled, true);
  assert.strictEqual(preserved.mcpServers.iris.timeout, 123);
  assert.strictEqual(preserved.mcpServers.iris.env.CUSTOM_SETTING, 'preserved');
  const stableBytes = fs.readFileSync(mcpPath, 'utf8');
  assert.strictEqual(runSync().status, 0);
  assert.strictEqual(fs.readFileSync(mcpPath, 'utf8'), stableBytes);
  fs.writeFileSync(optInConfigPath, JSON.stringify(optInConfig));
  fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '.agents/\n');
  const unignored = runSync();
  assert.notStrictEqual(unignored.status, 0);
  assert.match(unignored.stderr, /private-file-not-ignored/);
  assert.strictEqual(fs.readFileSync(mcpPath, 'utf8'), stableBytes);
  fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '.mcp.json\n.agents/\n');

  for (const invalid of [null, [], {}, { iris: [] }, { ...optInConfig, sftp: { enabled: 'false' } }]) {
    fs.writeFileSync(optInConfigPath, JSON.stringify(invalid));
    const failed = runSync();
    assert.strictEqual(failed.status, 1);
    assert.doesNotMatch(failed.stderr, /TypeError|secret/);
    assert.strictEqual(fs.readFileSync(mcpPath, 'utf8'), stableBytes);
    if (invalid && !Array.isArray(invalid) && Object.keys(invalid).length === 0) {
      for (const field of ['iris.host', 'iris.username', 'iris.password', 'iris.namespace', 'mcp.serverPath']) {
        assert.ok(failed.stderr.includes(field), failed.stderr);
      }
    }
  }
  fs.writeFileSync(optInConfigPath, '{"diagnosticMarker":"test-config-marker",');
  const malformed = runSync();
  assert.strictEqual(malformed.status, 1);
  assert.match(malformed.stderr, /JSON invalid/);
  assert.doesNotMatch(malformed.stderr, /test-config-marker/);
  fs.unlinkSync(optInConfigPath);
  assert.match(runSync().stderr, /file missing/);
  assert.strictEqual(fs.readFileSync(mcpPath, 'utf8'), stableBytes);
  fs.writeFileSync(optInConfigPath, JSON.stringify({ ...optInConfig, sftp: { enabled: true } }));
  const incompleteSftp = runSync();
  assert.strictEqual(incompleteSftp.status, 1);
  for (const field of ['sftp.host', 'sftp.username', 'sftp.password', 'sftp.localPath', 'sftp.remotePath']) {
    assert.ok(incompleteSftp.stderr.includes(field), incompleteSftp.stderr);
  }
  assert.strictEqual(fs.readFileSync(mcpPath, 'utf8'), stableBytes);

  if (process.platform === 'win32' && process.arch === 'x64') {
    const vendorPath = path.join(capabilityRoot, 'vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    fs.writeFileSync(vendorPath, 'fixture only');
    fs.unlinkSync(mcpPath);
    fs.writeFileSync(optInConfigPath, JSON.stringify({ iris: optInConfig.iris }));
    const defaultRuntime = runSync();
    assert.strictEqual(defaultRuntime.status, 0, defaultRuntime.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers['iris-agentic-dev'].command, vendorPath);
  }
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

console.log('iris workspace context tests passed');
