const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceScript = path.join(repoRoot, 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools', 'export.js');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-export-encoding-'));
const scriptPath = path.join(testRoot, '.agents', 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools', 'export.js');
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
  fs.mkdirSync(configRoot, { recursive: true });
  fs.copyFileSync(sourceScript, scriptPath);

  const server = http.createServer((req, res) => {
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
      '| `src/imedical/web` | project-utf8 |',
      ''
    ].join('\n'), 'utf8');
    const projectResult = await run(['project.csp']);
    assert.strictEqual(projectResult.code, 0, projectResult.stderr || projectResult.stdout);
    const projectPath = path.join(testRoot, 'src', 'imedical', 'web', 'csp', 'project.csp');
    assert.ok(fs.existsSync(projectPath), 'project-utf8 should export directly to source');
    assert.ok(projectResult.stdout.includes('"staging":false'), 'project-utf8 JSON should report source output');

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
