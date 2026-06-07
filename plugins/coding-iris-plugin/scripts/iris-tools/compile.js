#!/usr/bin/env node

/**
 * IRIS 文件同步编译脚本（通过 MCP 协议）
 * 用法: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js <文件名或路径> [命名空间]
 * 示例: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js Sample.Util.String
 *        node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js Sample/Util/Date.cls
 *        node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js src/Sample/Util/Date.cls <namespace>
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const inputFile = process.argv[2];
const namespace = process.argv[3];

if (inputFile && /\.csp$/i.test(inputFile)) {
    console.error('[错误] compile.js 不支持 CSP 上传或编译。');
    console.error('[说明] compile.js 仅用于 .cls/.mac/.inc 等 IRIS 文档类文件。');
    console.error('[CSP] 请先通过项目 SFTP/上传能力把 CSP 上传到 Web 根，再用 WebApp 虚拟路径执行 $system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")。');
    process.exit(1);
}

function findWorkspaceRoot() {
    let dir = __dirname;
    while (true) {
        if (path.basename(dir).toLowerCase() === '.agents') {
            return path.dirname(dir);
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return process.cwd();
        }
        dir = parent;
    }
}

if (!inputFile) {
    console.error('[错误] 请提供文件名或路径作为参数');
    console.error('用法: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js <文件名或路径> [命名空间]');
    console.error('\n示例:');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js Sample.Util.String          # 类名');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js Sample/Util/Date.cls        # 相对路径');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js src/Sample/Util/Date.cls    # 带src前缀');
    process.exit(1);
}

// 读取配置
const workspaceRoot = findWorkspaceRoot();
const configPath = path.join(workspaceRoot, '.agents', 'config', 'project-env.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error(`[错误] 无法读取配置文件: ${configPath}`);
    console.error(error.message);
    process.exit(1);
}

const iris = config.iris;
const ns = namespace || iris.namespace;
if (!ns || ns === 'TODO') {
    console.error('[错误] 缺少 IRIS namespace，请通过命令行参数或 .agents/config/project-env.json 的 iris.namespace 配置。');
    process.exit(1);
}

// 将输入转换为本地路径和远程文档名
function resolvePaths(input) {
    let localPath;
    let docName;

    const isClassName = !input.includes('/') && !input.includes('\\')
        && (/^[A-Za-z][A-Za-z0-9.]*$/.test(input));

    if (isClassName) {
        const baseName = input.replace(/\.cls$/i, '');
        localPath = path.join('src', ...baseName.split('.')) + '.cls';
        docName = baseName + '.cls';
    } else {
        let relPath = input;
        const srcPrefixes = ['src/', 'src\\'];
        for (const prefix of srcPrefixes) {
            if (relPath.startsWith(prefix)) {
                relPath = relPath.slice(prefix.length);
                break;
            }
        }

        const lastSegment = relPath.split(/[/\\]/).pop();
        if (!/\.\w+$/.test(lastSegment)) {
            relPath = relPath + '.cls';
        }

        localPath = path.join('src', relPath);
        docName = relPath.replace(/[/\\]/g, '.');
    }

    return { localPath, docName };
}

const { localPath, docName } = resolvePaths(inputFile);
const fullPath = path.resolve(localPath);

if (!fs.existsSync(fullPath)) {
    console.error(`[错误] 本地文件不存在: ${fullPath}`);
    process.exit(1);
}

console.log(`[信息] 本地文件: ${localPath}`);
console.log(`[信息] 远程文档: ${docName}`);
console.log(`[信息] 命名空间: ${ns}`);

// MCP 客户端：通过 stdio 与 MCP 服务器通信
class McpClient {
    constructor(serverPath) {
        this.serverPath = serverPath;
        this.proc = null;
        this.buffer = '';
        this.pendingRequests = new Map();
        this.nextId = 1;
    }

    start() {
        return new Promise((resolve, reject) => {
            this.proc = spawn(this.serverPath, ['mcp', '--transport', 'stdio'], {
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
                if (msg) console.error(`[MCP] ${msg}`);
            });
            this.proc.on('error', reject);
            this.proc.on('exit', (code) => {
                if (code && code !== 0) {
                    reject(new Error(`MCP 服务器退出，代码: ${code}`));
                }
            });

            // 发送 initialize 请求
            this._sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'compile-script', version: '1.0.0' }
            }).then((result) => {
                // 发送 initialized 通知
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
            const message = JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params
            }) + '\n';

            this.pendingRequests.set(id, { resolve, reject });
            this.proc.stdin.write(message);
        });
    }

    _sendNotification(method, params) {
        const message = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params
        }) + '\n';
        this.proc.stdin.write(message);
    }

    _onData(data) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // 保留未完成的行

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
            } catch (e) {
                // 忽略非 JSON 行（可能是日志输出）
            }
        }
    }
}

(async () => {
    const mcp = new McpClient(config.mcp.serverPath);

    try {
        // 1. 连接 MCP 服务器
        console.log('[信息] 正在连接 MCP 服务器...');
        await mcp.start();
        console.log('[信息] MCP 服务器已连接');

        // 2. 上传文档
        console.log('[信息] 正在上传文档...');
        const content = fs.readFileSync(fullPath, 'utf8');
        const putResult = await mcp.callTool('iris_doc', {
            mode: 'put',
            name: docName,
            content: content,
            namespace: ns
        });

        // 解析上传结果
        const putText = extractText(putResult);
        if (putResult.isError) {
            console.error('[上传失败]');
            console.error(putText);
            process.exit(1);
        }
        console.log('[信息] 文档上传成功');

        // 3. 编译文档
        console.log('[信息] 正在编译...');
        const compileResult = await mcp.callTool('iris_compile', {
            target: docName,
            namespace: ns
        });

        // 解析编译结果
        console.log('[调试] 原始结果:', JSON.stringify(compileResult).substring(0, 500));
        const compileText = extractText(compileResult);
        const compileData = tryParseJson(compileText);

        if (compileData) {
            // 输出编译控制台日志
            if (compileData.console && compileData.console.length > 0) {
                console.log('\n--- 编译控制台 ---');
                compileData.console.forEach(line => console.log(line));
                console.log('--- 控制台结束 ---\n');
            }

            // 输出错误
            if (compileData.errors && compileData.errors.length > 0) {
                console.error('[编译失败]');
                compileData.errors.forEach(err => {
                    const loc = err.line ? `行 ${err.line}` : '';
                    const col = err.column ? `:${err.column}` : '';
                    console.error(`  ${loc}${col}: ${err.text || err.error || JSON.stringify(err)}`);
                });
                process.exit(1);
            }

            // 输出警告
            if (compileData.warnings && compileData.warnings.length > 0) {
                compileData.warnings.forEach(w => console.warn(`[警告] ${w}`));
            }

            if (compileData.success) {
                console.log('[编译成功]');
            } else {
                console.error('[编译失败]');
                process.exit(1);
            }
        } else {
            // 纯文本输出
            if (compileText) console.log(compileText);
            if (compileResult.isError) {
                process.exit(1);
            } else {
                console.log('[编译成功]');
            }
        }

    } catch (error) {
        console.error(`[错误] ${error.message}`);
        process.exit(1);
    } finally {
        mcp.close();
    }
})();

// 从 MCP 结果中提取文本
function extractText(result) {
    if (!result || !result.content) return '';
    return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
}

// 尝试解析 JSON
function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
