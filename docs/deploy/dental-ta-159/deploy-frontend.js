#!/usr/bin/env node

/**
 * 批量前端部署脚本 v2 - dental-ws
 * 用法: node plans/deploy-frontend.js [--upload-only] [--compile-only]
 *
 * 修复:
 *   - SFTP 只上传 csp/ 和 scripts/ 目录（排除 .git/ 等无关文件）
 *   - CSP 编译使用 zn "DHC-APP" 切换命名空间
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const uploadOnly = process.argv.includes('--upload-only');
const compileOnly = process.argv.includes('--upload-only') ? false : process.argv.includes('--compile-only');

// ========== 配置 ==========
const workspaceRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(workspaceRoot, 'frontend');
const cspBasePath = 'imedical/web/csp';

const sftpEnv = {
  TARGET_HOST: '172.18.18.159',
  TARGET_PORT: '22322',
  TARGET_USERNAME: 'dhcuser138',
  TARGET_PASSWORD: 'pEmYg*7GRAj4',
  REMOTE_PATH: '/dthealth/app/dthis/web/',
  IGNORE_PATTERNS: JSON.stringify([
    '*.log', 'node_modules/', '.git/', '.vscode/',
    '*.gb2312.*', '.gitignore', 'README.md'
  ])
};

const irisEnv = {
  IRIS_HOST: '172.18.18.159',
  IRIS_WEB_PORT: '2443',
  IRIS_SCHEME: 'https',
  IRIS_USERNAME: 'dhact',
  IRIS_PASSWORD: 'TryNoh!hP2',
  IRIS_NAMESPACE: 'DHC-APP',
  IRIS_TLS_VERIFY: 'false',
  NODE_TLS_REJECT_UNAUTHORIZED: '0'
};

// ========== 文件收集 ==========
function collectFiles(dir, baseDir = dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      if (relPath.includes('.gb2312.')) continue;
      if (relPath === '.gitignore' || relPath === 'README.md') continue;
      files.push({ localPath: fullPath.replace(/\\/g, '/'), relPath });
    }
  }
  return files;
}

// ========== MCP 客户端 ==========
class McpClient {
  constructor(command, args, env) {
    this.cmd = command;
    this.args = args || [];
    this.env = env;
    this.proc = null;
    this.buffer = '';
    this.pendingRequests = new Map();
    this.nextId = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      console.log(`  [MCP] 启动: ${this.cmd} ${this.args.join(' ')}`);
      this.proc = spawn(this.cmd, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.env }
      });

      this.proc.stdout.on('data', (data) => this._onData(data));
      this.proc.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.error(`  [MCP stderr] ${msg}`);
      });
      this.proc.on('error', reject);

      this._sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'deploy-frontend-v2', version: '2.0.0' }
      }).then((result) => {
        this._sendNotification('notifications/initialized', {});
        console.log('  [MCP] 已连接并初始化');
        resolve(result);
      }).catch(reject);
    });
  }

  callTool(name, args) {
    return this._sendRequest('tools/call', { name, arguments: args });
  }

  close() {
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
    }
  }

  _sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.pendingRequests.set(id, { resolve, reject });
      this.proc.stdin.write(message);
    });
  }

  _sendNotification(method, params) {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.proc.stdin.write(message);
  }

  _onData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, reject } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {}
    }
  }
}

function extractText(result) {
  if (!result || !result.content) return '';
  return result.content.map(c => c.text || '').join('');
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ========== 主流程 ==========
async function main() {
  // 只收集 csp/ 和 scripts/ 下的文件
  const cspFiles = collectFiles(path.join(frontendDir, 'csp'));
  const scriptFiles = collectFiles(path.join(frontendDir, 'scripts'));
  const allUploadFiles = [...cspFiles, ...scriptFiles];

  console.log('========================================');
  console.log('  前端部署 v2 - dental-ws → 159');
  console.log('========================================');
  console.log(`  CSP 文件: ${cspFiles.length}`);
  console.log(`  脚本/样式/图片: ${scriptFiles.length}`);
  console.log(`  合计上传: ${allUploadFiles.length} 个文件`);
  console.log('');

  // ==================== Phase 1: SFTP 上传 ====================
  if (!compileOnly) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Phase 1: SFTP 上传 (仅 csp/ + scripts/)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const sftpMcp = new McpClient(
      'python',
      ['C:\\Users\\10946\\.mcp\\sftp-server\\src\\main.py'],
      sftpEnv
    );

    try {
      await sftpMcp.start();
    } catch (e) {
      console.error(`  ❌ SFTP MCP 启动失败: ${e.message}`);
      sftpMcp.close();
      process.exit(1);
    }

    let totalUploaded = 0;
    let totalErrors = 0;

    // 分两批同步: csp/ 和 scripts/
    const syncDirs = [
      {
        name: 'CSP 文件',
        local: path.join(frontendDir, 'csp'),
        remote: '/dthealth/app/dthis/web/csp'
      },
      {
        name: '脚本/样式/图片',
        local: path.join(frontendDir, 'scripts'),
        remote: '/dthealth/app/dthis/web/scripts'
      }
    ];

    for (const dir of syncDirs) {
      console.log(`\n  📁 同步: ${dir.name}`);
      console.log(`     本地: ${dir.local}`);
      console.log(`     远程: ${dir.remote}`);

      try {
        const result = await sftpMcp.callTool('sync_directory', {
          local_dir: dir.local,
          remote_dir: dir.remote
        });
        const text = extractText(result);
        const data = tryParseJson(text);

        if (data) {
          const uploaded = data.uploaded || [];
          const errors = data.errors || [];
          const ignored = data.ignored || [];
          const createdDirs = data.created_dirs || [];

          totalUploaded += uploaded.length;
          totalErrors += errors.length;

          console.log(`     ✅ 已上传: ${uploaded.length} 个文件`);
          if (createdDirs.length > 0) {
            console.log(`     📁 创建目录: ${createdDirs.length} 个`);
          }
          if (ignored.length > 0) {
            console.log(`     ⏭️  跳过: ${ignored.length} 个`);
          }
          if (errors.length > 0) {
            console.log(`     ❌ 失败: ${errors.length} 个`);
            errors.forEach(e => console.log(`       - ${e.path}: ${e.error}`));
          }
          // 显示文件明细
          uploaded.forEach(f => console.log(`     ✅ ${f.path} (${f.size} bytes)`));
        } else {
          console.log(`     返回: ${text.substring(0, 500)}`);
        }
      } catch (e) {
        console.error(`     ❌ 同步失败: ${e.message}`);
        totalErrors++;
      }
    }

    sftpMcp.close();

    console.log('\n  ━━ Phase 1 SFTP 上传结果 ━━');
    console.log(`  总上传: ${totalUploaded} 个文件`);
    if (totalErrors > 0) {
      console.log(`  总失败: ${totalErrors}`);
    }
    console.log(`  Phase 1 ${totalErrors === 0 ? '完成 ✅' : '有失败 ❌'}\n`);

    if (totalErrors > 0 && !uploadOnly) {
      console.error('  ⚠️  上传有失败，但仍继续编译...\n');
    }
  }

  // ==================== Phase 2: CSP 编译 ====================
  if (!uploadOnly) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Phase 2: CSP 编译 (${cspFiles.length} 个)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const irisMcp = new McpClient(
      'D:\\CodeSpace\\IRIS\\VSCode\\iris-dev-mcp\\iris-agentic-dev.exe',
      ['mcp', '--transport', 'stdio'],
      irisEnv
    );

    try {
      await irisMcp.start();
    } catch (e) {
      console.error(`  ❌ IRIS MCP 启动失败: ${e.message}`);
      irisMcp.close();
      process.exit(1);
    }

    let compiled = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < cspFiles.length; i++) {
      const cspFile = cspFiles[i];
      const virtualPath = `${cspBasePath}/${cspFile.relPath}`;

      // 关键：必须传 namespace: "DHC-APP" 参数，否则 iris_execute 在 USER 命名空间执行
      // ERROR #5920: Must use web page from namespace 'DHC-APP' and not current namespace 'USER'
      const code = `s result=$system.OBJ.Load("${virtualPath}","c") w result`;

      try {
        const result = await irisMcp.callTool('iris_execute', { code, namespace: 'DHC-APP' });
        const text = extractText(result);
        const output = (() => { try { return JSON.parse(text).output || ''; } catch { return text; } })();
        const hasError = output.includes('ERROR') || output.includes('Detected') && output.includes('error');
        const isSuccess = output.includes('Load finished successfully') || output.includes('Compiling file');

        if (isSuccess || (!hasError && output.length > 0)) {
          compiled++;
          console.log(`  ✅ [${i + 1}/${cspFiles.length}] ${cspFile.relPath}`);
        } else {
          failed++;
          const errMsg = hasError ? output.substring(0, 200) : (output || 'empty response');
          failures.push({ file: cspFile.relPath, error: errMsg });
          console.log(`  ❌ [${i + 1}/${cspFiles.length}] ${cspFile.relPath}: ${errMsg}`);
        }
      } catch (e) {
        failed++;
        failures.push({ file: cspFile.relPath, error: e.message });
        console.error(`  ❌ [${i + 1}/${cspFiles.length}] ${cspFile.relPath}: ${e.message}`);
      }
    }

    irisMcp.close();

    console.log('');
    console.log('  ━━ Phase 2 CSP 编译结果 ━━');
    console.log(`  成功: ${compiled}/${cspFiles.length}`);
    if (failed > 0) {
      console.log(`  失败: ${failed}/${cspFiles.length}`);
      failures.forEach(f => console.log(`    ❌ ${f.file}: ${f.error}`));
    }
    console.log(`  Phase 2 ${failed === 0 ? '完成 ✅' : '有失败 ❌'}\n`);
  }

  console.log('========================================');
  console.log('  前端部署全部完成!');
  console.log('========================================');
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(1);
});
