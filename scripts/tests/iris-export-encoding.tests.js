const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceScript = path.join(repoRoot, 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools', 'export.js');
const sourceWorkspaceContext = path.join(repoRoot, 'scripts', 'lib', 'workspace-context.js');
const testRoot = require('./fixtures/temp-directory').createTempDirectory('iris-export-encoding-');
const scriptPath = path.join(testRoot, '.agents', 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools', 'export.js');
const workspaceContextPath = path.join(testRoot, '.agents', 'scripts', 'lib', 'workspace-context.js');
const configRoot = path.join(testRoot, '.agents', 'config');

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: testRoot });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

(async () => {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.mkdirSync(path.dirname(workspaceContextPath), { recursive: true });
  fs.mkdirSync(configRoot, { recursive: true });
  fs.copyFileSync(sourceScript, scriptPath);
  for (const name of ['source-sync-core.js', 'project-env.js']) {
    fs.copyFileSync(path.join(path.dirname(sourceScript), name), path.join(path.dirname(scriptPath), name));
  }
  fs.copyFileSync(sourceWorkspaceContext, workspaceContextPath);
  for (const name of ['atelier-client.js', 'iris-remote-operations.js']) {
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'lib', name), path.join(path.dirname(workspaceContextPath), name));
  }

  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: { content: ['<div>患者姓名</div>'], db: '@FS' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  fs.writeFileSync(path.join(configRoot, 'project-env.json'), JSON.stringify({
    iris: { scheme: 'http', host: '127.0.0.1', port, username: 'test', password: 'test', namespace: 'TEST' },
    web: { basePath: 'imedical/web', cspBasePath: 'imedical/web/csp' }
  }), 'utf8');

  try {
    fs.writeFileSync(path.join(configRoot, 'iris_project_profile.md'), [
      '- 前端编码模式：standard-gb2312',
      '',
      '### 前端编码路径覆盖',
      '',
      '| 前端根目录 | 编码模式 |',
      '|---|---|',
      '| `src/imedical/web` | utf8 |',
      ''
    ].join('\n'), 'utf8');
    const projectResult = await run(['project.csp']);
    assert.strictEqual(projectResult.code, 0, projectResult.stderr || projectResult.stdout);
    const projectPath = path.join(testRoot, 'src', 'imedical', 'web', 'csp', 'project.csp');
    assert.ok(fs.existsSync(projectPath), 'utf8 should export directly to source');
    assert.ok(projectResult.stdout.includes('"staging":false'), 'utf8 JSON should report source output');

    const overwriteResult = await run(['project.csp']);
    assert.notStrictEqual(overwriteResult.code, 0, 'existing source should require --overwrite');
    assert.ok(overwriteResult.stderr.includes('--overwrite'), 'overwrite refusal should explain the required flag');

    fs.writeFileSync(path.join(configRoot, 'iris_project_profile.md'), '- 前端编码模式：standard-gb2312\n', 'utf8');
    const standardResult = await run(['standard.csp']);
    assert.strictEqual(standardResult.code, 0, standardResult.stderr || standardResult.stdout);
    const sourcePath = path.join(testRoot, 'src', 'imedical', 'web', 'csp', 'standard.csp');
    const stagingPath = path.join(testRoot, '.agents', 'work', 'iris-export', 'src', 'imedical', 'web', 'csp', 'standard.csp');
    assert.ok(!fs.existsSync(sourcePath), 'standard-gb2312 must not write UTF-8 directly to source');
    assert.ok(fs.existsSync(stagingPath), 'standard-gb2312 should write UTF-8 staging output');
    assert.ok(standardResult.stdout.includes('"conversionRequired":true'), 'standard JSON should require conversion');

    fs.writeFileSync(path.join(configRoot, 'iris_project_profile.md'), '- 前端编码模式：project-utf8\n', 'utf8');
    const legacyAliasResult = await run(['legacy-alias.csp']);
    assert.strictEqual(legacyAliasResult.code, 0, legacyAliasResult.stderr || legacyAliasResult.stdout);
    assert.ok(fs.existsSync(path.join(testRoot, 'src', 'imedical', 'web', 'csp', 'legacy-alias.csp')), 'project-utf8 alias should still export directly to source');

    fs.writeFileSync(path.join(configRoot, 'iris_project_profile.md'), '- 前端编码模式：N/A (backend-only)\n', 'utf8');
    const backendOnlyResult = await run(['backend-only.csp']);
    assert.notStrictEqual(backendOnlyResult.code, 0, 'backend-only profile must reject frontend export');
    assert.ok(backendOnlyResult.stderr.includes('N/A (backend-only)'), 'backend-only rejection should explain the canonical profile mode');
    assert.ok(!fs.existsSync(path.join(testRoot, 'src', 'imedical', 'web', 'csp', 'backend-only.csp')), 'backend-only export must not write frontend source');
    assert.ok(!fs.existsSync(path.join(testRoot, '.agents', 'work', 'iris-export', 'src', 'imedical', 'web', 'csp', 'backend-only.csp')), 'backend-only export must not write staging output');

    fs.writeFileSync(path.join(configRoot, 'project_context_profile.md'), '- contextMode: intent-first-on-demand-export\n');
    fs.writeFileSync(path.join(configRoot, 'iris_project_profile.md'), '- 前端编码模式：utf8\n- 默认需求交付类型：project\n');
    const beforeRequests = requests;
    for (const identifier of ['Existing.cls', 'Missing.cls', 'existing.csp', 'missing.csp']) {
      const existing = identifier.toLowerCase().startsWith('existing');
      const destination = identifier.endsWith('.cls') ? path.join(testRoot, 'src', identifier) : path.join(testRoot, 'src/imedical/web/csp', identifier);
      if (existing) fs.writeFileSync(destination, 'local changes to preserve\n');
      const refused = await run([identifier, '--overwrite']);
      assert.notStrictEqual(refused.code, 0, identifier + ': source export must use source-sync');
      assert.match(refused.stderr, /source-sync-before-edit-required/);
      if (existing) assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'local changes to preserve\n');
      else assert.ok(!fs.existsSync(destination), identifier + ': refused export must not create source');
      assert.strictEqual(requests, beforeRequests, identifier + ': refuse before remote reads');
    }
    const explicitStandard = await run(['Existing.cls', '--kind', 'standard']);
    assert.match(explicitStandard.stderr, /--overwrite/, 'explicit task kind takes precedence over the project default');
    fs.writeFileSync(path.join(configRoot, 'iris_project_profile.md'), '- 前端编码模式：utf8\n- 默认需求交付类型：standard\n');
    const standardExisting = await run(['Existing.cls']);
    assert.match(standardExisting.stderr, /--overwrite/, 'standard keeps its existing export entry');
    assert.ok(!standardExisting.stderr.includes('source-sync-before-edit-required'));
    const explicitProject = await run(['Existing.cls', '--kind', 'project', '--overwrite']);
    assert.match(explicitProject.stderr, /source-sync-before-edit-required/);
    assert.strictEqual(requests, beforeRequests);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  console.log('iris export encoding tests passed');
})().catch(error => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  console.error(error.stack || error.message);
  process.exit(1);
});
