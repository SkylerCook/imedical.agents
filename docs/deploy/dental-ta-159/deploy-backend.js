#!/usr/bin/env node

/**
 * 批量后端部署脚本 - dental-ws
 * 用法: node plans/deploy-backend.js [--upload-only] [--compile-only]
 * 
 * 流程: 连接 MCP → 按包分批上传 → 按包分批编译 → 报告结果
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const uploadOnly = process.argv.includes('--upload-only');
const compileOnly = process.argv.includes('--compile-only');

// ========== 需要去掉 Storage Default 的实体类 ==========
const entityClasses = new Set([
  'CF/DOC/Dental/TA/DictLevel.cls',
  'CT/DOC/Dental/TA/DictCtlg.cls',
  'CT/DOC/Dental/TA/Dictionary.cls',
  'CT/DOC/Dental/TA/Material.cls',
  'DOC/Dental/TA/Application.cls',
  'DOC/Dental/TA/ApplAttachment.cls',
  'DOC/Dental/TA/ApplLab.cls',
  'DOC/Dental/TA/ApplLinkMaterial.cls',
  'DOC/Dental/TA/ApplProduct.cls',
  'DOC/Dental/TA/ApplRequire.cls',
  'DOC/Dental/TA/ApplRework.cls',
  'DOC/Dental/TA/ApplStatus.cls',
  'DOC/Dental/TA/ApplTechRating.cls',
  'DOC/Dental/TA/ApplToothColor.cls'
]);

function stripStorageDefault(content) {
  // Normalize line endings first, then strip Storage Default block
  const normalized = content.replace(/\r\n/g, '\n');
  // Match "Storage Default\n{\n...\n}\n" - the closing } must be on its own line
  // Use a balanced brace counter approach for safety
  const lines = normalized.split('\n');
  const result = [];
  let inStorage = false;
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inStorage && line === 'Storage Default') {
      inStorage = true;
      continue; // skip "Storage Default" line
    }
    if (inStorage) {
      if (line.trim() === '{') {
        braceDepth++;
        continue;
      }
      if (line.trim() === '}' && braceDepth > 0) {
        braceDepth--;
        if (braceDepth === 0) {
          inStorage = false;
          continue; // skip closing }
        }
      }
      continue; // skip all content inside Storage Default
    }
    result.push(line);
  }
  return result.join('\n');
}

function normalizeContent(content) {
  // Convert CRLF to LF for IRIS compatibility
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ========== 文件分组定义 ==========
// 实体类合并为一组：先全部上传再统一编译，解决跨包依赖
const groups = [
  {
    name: '全部实体类 (CF+CT+DOC)',
    files: [
      'CF/DOC/Dental/TA/DictLevel.cls',
      'CT/DOC/Dental/TA/DictCtlg.cls',
      'CT/DOC/Dental/TA/Dictionary.cls',
      'CT/DOC/Dental/TA/Material.cls',
      'DOC/Dental/TA/Application.cls',
      'DOC/Dental/TA/ApplAttachment.cls',
      'DOC/Dental/TA/ApplLab.cls',
      'DOC/Dental/TA/ApplLinkMaterial.cls',
      'DOC/Dental/TA/ApplProduct.cls',
      'DOC/Dental/TA/ApplRequire.cls',
      'DOC/Dental/TA/ApplRework.cls',
      'DOC/Dental/TA/ApplStatus.cls',
      'DOC/Dental/TA/ApplTechRating.cls',
      'DOC/Dental/TA/ApplToothColor.cls'
    ]
  },
  {
    name: 'COM 公共/基类',
    files: [
      'DHCDoc/Dental/TA/COM/ClearData.cls',
      'DHCDoc/Dental/TA/COM/Super.cls',
      'DHCDoc/Dental/TA/COM/Util.cls'
    ]
  },
  {
    name: 'CF 业务',
    files: [
      'DHCDoc/Dental/TA/CF/DictLevelSql.cls',
      'DHCDoc/Dental/TA/CF/DictLevelData.cls',
      'DHCDoc/Dental/TA/CF/DictLevelBlh.cls'
    ]
  },
  {
    name: 'CT 业务',
    files: [
      'DHCDoc/Dental/TA/CT/DictCtlgSql.cls',
      'DHCDoc/Dental/TA/CT/DictCtlgData.cls',
      'DHCDoc/Dental/TA/CT/DictCtlgBlh.cls',
      'DHCDoc/Dental/TA/CT/DictionarySql.cls',
      'DHCDoc/Dental/TA/CT/DictionaryData.cls',
      'DHCDoc/Dental/TA/CT/DictionaryBlh.cls',
      'DHCDoc/Dental/TA/CT/MaterialSQL.cls',
      'DHCDoc/Dental/TA/CT/MaterialDATA.cls',
      'DHCDoc/Dental/TA/CT/MaterialBLH.cls'
    ]
  },
  {
    name: 'DHCDoc 核心业务',
    files: [
      'DHCDoc/Dental/TA/ApplicationSql.cls',
      'DHCDoc/Dental/TA/ApplicationData.cls',
      'DHCDoc/Dental/TA/ApplicationBlh.cls',
      'DHCDoc/Dental/TA/ApplAttachmentSql.cls',
      'DHCDoc/Dental/TA/ApplAttachmentData.cls',
      'DHCDoc/Dental/TA/ApplFileBLH.cls',
      'DHCDoc/Dental/TA/ApplLabSQL.cls',
      'DHCDoc/Dental/TA/ApplLabDATA.cls',
      'DHCDoc/Dental/TA/ApplLabBLH.cls',
      'DHCDoc/Dental/TA/ApplLinkMaterialSQL.cls',
      'DHCDoc/Dental/TA/ApplLinkMaterialDATA.cls',
      'DHCDoc/Dental/TA/ApplLinkMaterialBLH.cls',
      'DHCDoc/Dental/TA/ApplProductSql.cls',
      'DHCDoc/Dental/TA/ApplProductData.cls',
      'DHCDoc/Dental/TA/ApplRequireSql.cls',
      'DHCDoc/Dental/TA/ApplRequireData.cls',
      'DHCDoc/Dental/TA/ApplReworkSQL.cls',
      'DHCDoc/Dental/TA/ApplReworkDATA.cls',
      'DHCDoc/Dental/TA/ApplReworkBLH.cls',
      'DHCDoc/Dental/TA/ApplStatusSql.cls',
      'DHCDoc/Dental/TA/ApplStatusData.cls',
      'DHCDoc/Dental/TA/ApplStatsReportBLH.cls',
      'DHCDoc/Dental/TA/ApplTechRatingSQL.cls',
      'DHCDoc/Dental/TA/ApplTechRatingDATA.cls',
      'DHCDoc/Dental/TA/ApplTechRatingBLH.cls',
      'DHCDoc/Dental/TA/ApplToothColorSql.cls',
      'DHCDoc/Dental/TA/ApplToothColorData.cls',
      'DHCDoc/Dental/TA/ApplPrintBLH.cls',
      'DHCDoc/Dental/TA/MainworkBLH.cls',
      'DHCDoc/Dental/TA/WorkstationBlh.cls'
    ]
  },
  {
    name: 'Inter 集成',
    files: [
      'DHCDoc/Dental/TA/Inter/Invoke.cls',
      'DHCDoc/Dental/TA/Inter/PAInvoke.cls'
    ]
  }
];

// ========== 配置读取 ==========
const workspaceRoot = path.resolve(__dirname, '..');
const configPath = path.join(workspaceRoot, '.agents', 'config', 'project-env.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error(`[错误] 无法读取配置: ${configPath}`);
  process.exit(1);
}

const iris = config.iris;
const ns = iris.namespace;
if (!ns || ns === 'TODO') {
  console.error('[错误] 缺少 namespace');
  process.exit(1);
}

const backendRoot = path.join(workspaceRoot, 'backend');

// ========== 路径转换 ==========
function pathToDocName(relPath) {
  return relPath.replace(/[/\\]/g, '.');
}

function resolveLocalPath(relPath) {
  return path.join(backendRoot, ...relPath.split('/'));
}

// ========== MCP 客户端 ==========
class McpClient {
  constructor() {
    this.proc = null;
    this.buffer = '';
    this.pendingRequests = new Map();
    this.nextId = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(config.mcp.serverPath, ['mcp', '--transport', 'stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          IRIS_HOST: iris.host,
          IRIS_WEB_PORT: String(iris.port || 2443),
          IRIS_NAMESPACE: ns,
          IRIS_USERNAME: iris.username,
          IRIS_PASSWORD: iris.password,
          IRIS_SCHEME: iris.scheme || 'https',
          IRIS_TLS_VERIFY: String(iris.tlsVerify ?? false),
          NODE_TLS_REJECT_UNAUTHORIZED: config.mcp?.nodeTlsRejectUnauthorized || '0'
        }
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
        clientInfo: { name: 'deploy-backend', version: '1.0.0' }
      }).then((result) => {
        this._sendNotification('notifications/initialized', {});
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

// ========== 工具函数 ==========
function extractText(result) {
  if (!result || !result.content) return '';
  return result.content.map(c => c.text || '').join('');
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ========== 部署执行 ==========
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  dental-ws 后端批量部署`);
  console.log(`  服务器: ${iris.scheme}://${iris.host}:${iris.port}`);
  console.log(`  命名空间: ${ns}`);
  console.log(`  模式: ${uploadOnly ? '仅上传' : compileOnly ? '仅编译' : '上传+编译'}`);
  console.log(`${'='.repeat(60)}\n`);

  // 验证所有文件存在
  let missingFiles = [];
  for (const group of groups) {
    for (const file of group.files) {
      const localPath = resolveLocalPath(file);
      if (!fs.existsSync(localPath)) {
        missingFiles.push(file);
      }
    }
  }
  if (missingFiles.length > 0) {
    console.error('[错误] 以下文件不存在:');
    missingFiles.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  const mcp = new McpClient();
  const allResults = [];

  try {
    console.log('[信息] 连接 MCP 服务器...');
    await mcp.start();
    console.log('[信息] MCP 已连接\n');

    for (const group of groups) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`  📦 ${group.name} (${group.files.length} 个文件)`);
      console.log(`${'─'.repeat(50)}`);

      // 阶段 A: 删除旧实体类（避免残留 Storage 冲突）
      if (!compileOnly) {
        const entityFiles = group.files.filter(f => entityClasses.has(f));
        if (entityFiles.length > 0) {
          console.log(`\n  [清理] 删除旧实体类定义...`);
          for (const file of entityFiles) {
            const docName = pathToDocName(file);
            const className = docName.replace(/\.cls$/, '');
            try {
              await mcp.callTool('iris_execute', {
                code: `do $system.OBJ.Delete("${className}.cls")`,
                namespace: ns
              });
              console.log(`    🗑  ${className}`);
            } catch (err) {
              console.log(`    ⚠️  ${className} - 删除跳过: ${err.message}`);
            }
          }
        }
      }

      // 阶段 B: 上传
      if (!compileOnly) {
        console.log(`\n  [上传] 开始上传 ${group.files.length} 个文件...`);
        for (const file of group.files) {
          const localPath = resolveLocalPath(file);
          const docName = pathToDocName(file);
          let content = fs.readFileSync(localPath, 'utf8');
          // 行尾规范化
          content = normalizeContent(content);
          // 实体类去掉 Storage Default 避免 #5559 解析错误
          if (entityClasses.has(file)) {
            const originalLen = content.length;
            content = stripStorageDefault(content);
            if (content.length < originalLen) {
              console.log(`    [去Storage] ${docName} - 已去除 Storage Default 块`);
            } else {
              console.log(`    [警告] ${docName} - Storage Default 未被去除！`);
            }
          }

          try {
            const putResult = await mcp.callTool('iris_doc', {
              mode: 'put',
              name: docName,
              content: content,
              namespace: ns
            });

            if (putResult.isError) {
              const errText = extractText(putResult);
              console.log(`    ❌ ${docName} - 上传失败: ${errText.substring(0, 100)}`);
              allResults.push({ group: group.name, file: docName, phase: 'upload', status: 'fail', error: errText });
            } else {
              console.log(`    ✅ ${docName}`);
              allResults.push({ group: group.name, file: docName, phase: 'upload', status: 'ok' });
            }
          } catch (err) {
            console.log(`    ❌ ${docName} - 异常: ${err.message}`);
            allResults.push({ group: group.name, file: docName, phase: 'upload', status: 'error', error: err.message });
          }
        }
      }

      // 阶段 C: 编译
      if (!uploadOnly) {
        console.log(`\n  [编译] 开始编译 ${group.files.length} 个文件...`);
        for (const file of group.files) {
          const docName = pathToDocName(file);

          try {
            const compileResult = await mcp.callTool('iris_compile', {
              target: docName,
              namespace: ns
            });

            const compileText = extractText(compileResult);
            const compileData = tryParseJson(compileText);

            if (compileData) {
              if (compileData.errors && compileData.errors.length > 0) {
                console.log(`    ❌ ${docName} - 编译失败:`);
                compileData.errors.forEach(err => {
                  console.log(`       行${err.line || '?'}: ${err.text || err.error || JSON.stringify(err)}`);
                });
                allResults.push({ group: group.name, file: docName, phase: 'compile', status: 'fail', errors: compileData.errors });
              } else {
                if (compileData.warnings && compileData.warnings.length > 0) {
                  console.log(`    ⚠️  ${docName} - 有警告:`);
                  compileData.warnings.forEach(w => console.log(`       ${w}`));
                } else {
                  console.log(`    ✅ ${docName}`);
                }
                allResults.push({ group: group.name, file: docName, phase: 'compile', status: 'ok', warnings: compileData.warnings });
              }
            } else {
              if (compileResult.isError) {
                console.log(`    ❌ ${docName} - ${compileText.substring(0, 100)}`);
                allResults.push({ group: group.name, file: docName, phase: 'compile', status: 'fail', error: compileText });
              } else {
                console.log(`    ✅ ${docName}`);
                allResults.push({ group: group.name, file: docName, phase: 'compile', status: 'ok' });
              }
            }
          } catch (err) {
            console.log(`    ❌ ${docName} - 异常: ${err.message}`);
            allResults.push({ group: group.name, file: docName, phase: 'compile', status: 'error', error: err.message });
          }
        }
      }
    }

  } catch (error) {
    console.error(`\n[致命错误] ${error.message}`);
    process.exit(1);
  } finally {
    mcp.close();
  }

  // ========== 汇总报告 ==========
  console.log(`\n${'='.repeat(60)}`);
  console.log('  部署汇总');
  console.log(`${'='.repeat(60)}\n`);

  const uploadResults = allResults.filter(r => r.phase === 'upload');
  const compileResults = allResults.filter(r => r.phase === 'compile');

  if (uploadResults.length > 0) {
    const uploadOk = uploadResults.filter(r => r.status === 'ok').length;
    const uploadFail = uploadResults.filter(r => r.status !== 'ok').length;
    console.log(`  上传: ${uploadOk} 成功, ${uploadFail} 失败 (共 ${uploadResults.length})`);
    if (uploadFail > 0) {
      uploadResults.filter(r => r.status !== 'ok').forEach(r => {
        console.log(`    ❌ ${r.file}: ${r.error || '未知错误'}`);
      });
    }
  }

  if (compileResults.length > 0) {
    const compileOk = compileResults.filter(r => r.status === 'ok').length;
    const compileFail = compileResults.filter(r => r.status !== 'ok').length;
    console.log(`  编译: ${compileOk} 成功, ${compileFail} 失败 (共 ${compileResults.length})`);
    if (compileFail > 0) {
      compileResults.filter(r => r.status !== 'ok').forEach(r => {
        console.log(`    ❌ ${r.file}: ${r.error || (r.errors || []).map(e => e.text || e.error).join('; ') || '未知错误'}`);
      });
    }
  }

  const hasFailure = allResults.some(r => r.status !== 'ok');
  console.log(`\n  结果: ${hasFailure ? '❌ 存在失败' : '✅ 全部成功'}\n`);

  if (hasFailure) process.exit(1);
}

main().catch(err => {
  console.error(`[未捕获错误] ${err.message}`);
  process.exit(1);
});
