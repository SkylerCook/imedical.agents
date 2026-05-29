#!/usr/bin/env node

/**
 * IRIS Universal Export Script
 * Automatically detects file type and exports from IRIS server
 * 
 * Usage: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <fileIdentifier> [outputDir] [namespace] [--basePath <prefix>]
 * 
 * Examples:
 *   # Export class (detected by dot notation without path)
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js DHCDoc.AI.KBase
 *   
 *   # Export JS file (auto-prepends basePath for JS files)
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/Alloc.ExaBorRoom.hui.js
 *   
 *   # Export CSP file (auto-prepends basePath for CSP files)
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js alloc.exaborroom.hui.csp
 *   
 *   # Export with custom parameters
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js imedical/web/scripts/test.js src DHC-APP --basePath ""
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Parse command line arguments
const args = process.argv.slice(2);
let fileIdentifier = args[0];
let outputDir = 'src';
let namespace = 'DHC-APP';
let basePath = ''; // Will be set based on file type

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

// Parse optional arguments
for (let i = 1; i < args.length; i++) {
    if (args[i] === '--basePath' || args[i] === '-BasePath') {
        basePath = args[++i] || '';
    } else if (i === 1 && !args[i].startsWith('--') && !args[i].startsWith('-')) {
        outputDir = args[i];
    } else if (i === 2 && !args[i].startsWith('--') && !args[i].startsWith('-')) {
        namespace = args[i];
    }
}

if (!fileIdentifier) {
    console.error('[错误] 请提供文件标识符（类名、JS路径或CSP路径）');
    console.error('\n用法: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <fileIdentifier> [outputDir] [namespace] [--basePath <prefix>]');
    console.error('\n示例:');
    console.error('  # 导出类');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js DHCDoc.AI.KBase');
    console.error('  # 导出JS文件');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/Alloc.ExaBorRoom.hui.js');
    console.error('  # 导出CSP文件');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js alloc.exaborroom.hui.csp');
    console.error('  # 自定义参数');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js imedical/web/scripts/test.js src DHC-APP --basePath ""');
    process.exit(1);
}

// Load configuration
const workspaceRoot = findWorkspaceRoot();
const configPath = path.join(workspaceRoot, '.agents', 'config', 'project-env.json');
let config;
try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configContent);
} catch (error) {
    console.error(`[错误] 无法读取配置文件: ${error.message}`);
    process.exit(1);
}

const iris = config.iris;
const irisScheme = iris.scheme || 'https';
const irisPort = iris.port || 2443;

// Validate password
if (!iris.password || iris.password.trim() === '') {
    console.error('[错误] 密码不能为空，请在 .agents/config/project-env.json 中设置有效的 iris.password');
    process.exit(1);
}

/**
 * Detect file type and prepare export parameters
 * Returns: { type, filePath, apiUrlPath, fullPath }
 */
function detectFileType(identifier) {
    // Check if it's a class name
    // Case 1: Contains dots but no slashes, doesn't end with .js or .csp
    // Case 2: Ends with .cls (explicit class file)
    const isClass = (!identifier.includes('/') && 
                     identifier.includes('.') && 
                     !identifier.endsWith('.js') && 
                     !identifier.endsWith('.csp')) ||
                    identifier.endsWith('.cls');
    
    if (isClass) {
        // It's a class name like DHCDoc.AI.KBase or web.DHCExaBorDep.cls
        let className = identifier;
        
        // If it ends with .cls, remove the extension for API call
        if (className.endsWith('.cls')) {
            className = className.slice(0, -4); // Remove '.cls'
        }
        
        const filePath = className.replace(/\./g, path.sep) + '.cls';
        const fullPath = path.join(outputDir, filePath);
        
        return {
            type: 'CLASS',
            filePath: className + '.cls',
            apiUrlPath: className + '.cls',
            fullPath: fullPath,
            displayName: className
        };
    }
    
    // Check file extension
    const ext = path.extname(identifier).toLowerCase();
    
    if (ext === '.csp') {
        // It's a CSP file
        let cspPath = identifier;
        
        // Auto-prepend basePath if not already present
        if (!basePath && !cspPath.includes('imedical/web/')) {
            cspPath = `imedical/web/csp/${cspPath}`;
        } else if (basePath && !cspPath.includes('imedical/web/')) {
            cspPath = `${basePath}/${cspPath}`;
        }
        
        const localPath = cspPath.replace(/\//g, path.sep);
        const fullPath = path.join(outputDir, localPath);
        
        return {
            type: 'CSP',
            filePath: localPath,
            apiUrlPath: cspPath,
            fullPath: fullPath,
            displayName: cspPath
        };
    }
    
    if (ext === '.js' || identifier.includes('.hui.js')) {
        // It's a JS file
        let jsPath = identifier;
        
        // Auto-prepend basePath if not already present
        if (!basePath && !jsPath.includes('imedical/web/')) {
            jsPath = `imedical/web/${jsPath}`;
        } else if (basePath && !jsPath.includes('imedical/web/')) {
            jsPath = `${basePath}/${jsPath}`;
        }
        
        const localPath = jsPath.replace(/\//g, path.sep);
        const fullPath = path.join(outputDir, localPath);
        
        return {
            type: 'JS',
            filePath: localPath,
            apiUrlPath: jsPath,
            fullPath: fullPath,
            displayName: jsPath
        };
    }
    
    // If contains slash but no recognized extension, try to detect by context
    if (identifier.includes('/')) {
        // Assume it's a JS file if in scripts directory
        if (identifier.includes('scripts/')) {
            let jsPath = identifier;
            if (!basePath && !jsPath.includes('imedical/web/')) {
                jsPath = `imedical/web/${jsPath}`;
            } else if (basePath && !jsPath.includes('imedical/web/')) {
                jsPath = `${basePath}/${jsPath}`;
            }
            
            const localPath = jsPath.replace(/\//g, path.sep);
            const fullPath = path.join(outputDir, localPath);
            
            return {
                type: 'JS',
                filePath: localPath,
                apiUrlPath: jsPath,
                fullPath: fullPath,
                displayName: jsPath
            };
        }
        
        // Assume it's a CSP file if in csp directory
        if (identifier.includes('csp/')) {
            let cspPath = identifier;
            if (!basePath && !cspPath.includes('imedical/web/')) {
                cspPath = `imedical/web/${cspPath}`;
            } else if (basePath && !cspPath.includes('imedical/web/')) {
                cspPath = `${basePath}/${cspPath}`;
            }
            
            const localPath = cspPath.replace(/\//g, path.sep);
            const fullPath = path.join(outputDir, localPath);
            
            return {
                type: 'CSP',
                filePath: localPath,
                apiUrlPath: cspPath,
                fullPath: fullPath,
                displayName: cspPath
            };
        }
    }
    
    // Unknown type
    throw new Error(`无法识别文件类型: ${identifier}\n支持的类型: 类名(如 DHCDoc.AI.KBase), JS文件(.js), CSP文件(.csp)`);
}

/**
 * Export file from IRIS server
 */
function exportFile(fileInfo) {
    console.log(`[信息] 检测到文件类型: ${fileInfo.type}`);
    console.log(`[信息] 正在导出: ${fileInfo.displayName}`);
    console.log(`[信息] 目标文件: ${fileInfo.fullPath}`);

    // Create directory if not exists
    const dirPath = path.dirname(fileInfo.fullPath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`[信息] 创建目录: ${dirPath}`);
    }

    // Build API URL
    const apiUrl = `${irisScheme}://${iris.host}:${irisPort}/api/atelier/v1/${namespace}/doc/${fileInfo.apiUrlPath}`;

    // Prepare authentication
    const auth = Buffer.from(`${iris.username}:${iris.password}`).toString('base64');

    const options = {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        },
        rejectUnauthorized: false
    };

    requestWithRetry(apiUrl, options, RETRY_DELAYS.length, (error, statusCode, data) => {
        if (error) {
            console.error(`[错误] ${error.message}`);
            process.exit(1);
        }

        if (statusCode === 503) {
            console.error('[错误] 多次重试后仍收到 503 Service Unavailable，可能 License 已耗尽');
            process.exit(1);
        }

        try {
            const response = JSON.parse(data);

            // Check for errors
            if (response.status && response.status.errors && response.status.errors.length > 0) {
                console.error(`[错误] ${response.status.errors[0]}`);
                process.exit(1);
            }

            // Check if content exists
            if (!response.result || !response.result.content) {
                console.error(`[错误] 未找到 ${fileInfo.type} 文件内容`);
                const statusText = response.result && response.result.status;
                if (statusText) {
                    console.log(`[信息] 状态: ${statusText}`);
                }
                process.exit(1);
            }

            // Check db field
            const dbType = response.result.db;
            if (dbType === '@FS') {
                console.log('[信息] 文件存储类型: 文件系统 (@FS)');
            }

            // Write file
            let content = response.result.content.join('\n');
            fs.writeFileSync(fileInfo.fullPath, content, 'utf8');

            console.log(`[成功] ${fileInfo.type} 文件已导出到: ${fileInfo.fullPath}`);

        } catch (parseError) {
            console.error(`[错误] 解析响应失败: ${parseError.message}`);
            process.exit(1);
        }
    });
}

// Shared session cookie to avoid license exhaustion
let sharedCookie = null;

/**
 * Retry delay (ms) for 503 errors: 2s → 5s → 10s
 */
const RETRY_DELAYS = [2000, 5000, 10000];

/**
 * Execute an HTTP request with cookie session reuse and 503 retry.
 */
function requestWithRetry(apiUrl, options, maxRetries, callback) {
    const client = irisScheme === 'https' ? https : http;

    // Inject session cookie and keep-alive
    const reqOptions = Object.assign({}, options, {
        headers: Object.assign({}, options.headers, {
            'Connection': 'keep-alive'
        })
    });
    if (sharedCookie) {
        reqOptions.headers['Cookie'] = sharedCookie;
    }

    const attempt = (retryCount) => {
        console.log('[信息] 正在连接 IRIS 服务器...');

        client.get(apiUrl, reqOptions, (res) => {
            // Capture session cookie from first response
            if (!sharedCookie) {
                const setCookie = res.headers['set-cookie'];
                if (setCookie) {
                    const sessionEntry = setCookie.find(c => c.startsWith('CSPSESSIONID'));
                    if (sessionEntry) {
                        sharedCookie = sessionEntry.split(';')[0];
                        console.log(`[信息] 已获取 Session Cookie: ${sharedCookie}`);
                    }
                }
            }

            // Handle 503 with retry
            if (res.statusCode === 503 && retryCount < maxRetries) {
                const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
                console.log(`[警告] 收到 503，${delay / 1000}秒后重试 (${retryCount + 1}/${maxRetries})...`);
                setTimeout(() => attempt(retryCount + 1), delay);
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => callback(null, res.statusCode, data));
        }).on('error', (error) => {
            callback(error);
        });
    };

    attempt(0);
}

// Main execution
try {
    const fileInfo = detectFileType(fileIdentifier);
    exportFile(fileInfo);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
