'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const toolsRoot = path.join(repoRoot, 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools');
const tools = ['prepare-deploy-manifest.js', 'compile.js', 'export.js', 'debugger.js', 'sync-env-config.js'];

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
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

console.log('iris workspace context tests passed');
