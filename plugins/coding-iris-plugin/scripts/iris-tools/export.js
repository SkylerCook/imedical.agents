#!/usr/bin/env node

/**
 * IRIS Universal Export Script
 * Automatically detects file type and exports from IRIS server
 * 
 * Usage: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <fileIdentifier> [outputDir] [namespace] [--basePath <prefix>] [--target-mode auto|source|staging] [--overwrite]
 * 
 * Examples:
 *   # Export class (detected by dot notation without path)
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js Sample.Package.Class
 *   
 *   # Export JS file (auto-prepends basePath for JS files)
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/Alloc.ExaBorRoom.hui.js
 *   
 *   # Export CSP file (auto-prepends basePath for CSP files)
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js alloc.exaborroom.hui.csp
 *   
 *   # Export with custom parameters
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js src <namespace> --basePath "<web-root-prefix>"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Parse command line arguments
const args = process.argv.slice(2);
let fileIdentifier = args[0];
let outputDir = 'src';
let namespace = '';
let basePath; // undefined means use project-env web defaults; empty string disables prefixing.
let targetMode = 'auto';
let overwrite = false;

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
    } else if (args[i] === '--target-mode') {
        targetMode = args[++i] || 'auto';
    } else if (args[i] === '--overwrite') {
        overwrite = true;
    } else if (i === 1 && !args[i].startsWith('--') && !args[i].startsWith('-')) {
        outputDir = args[i];
    } else if (i === 2 && !args[i].startsWith('--') && !args[i].startsWith('-')) {
        namespace = args[i];
    }
}

if (!['auto', 'source', 'staging'].includes(targetMode)) {
    console.error(`[错误] --target-mode 只允许 auto、source 或 staging，当前值: ${targetMode}`);
    process.exit(1);
}

if (!fileIdentifier) {
    console.error('[错误] 请提供文件标识符（类名、JS路径或CSP路径）');
    console.error('\n用法: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <fileIdentifier> [outputDir] [namespace] [--basePath <prefix>]');
    console.error('\n示例:');
    console.error('  # 导出类');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js Sample.Package.Class');
    console.error('  # 导出JS文件');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/Alloc.ExaBorRoom.hui.js');
    console.error('  # 导出CSP文件');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js alloc.exaborroom.hui.csp');
    console.error('  # 自定义参数');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js src <namespace> --basePath "<web-root-prefix>"');
    process.exit(1);
}

// Load configuration
const workspaceRoot = findWorkspaceRoot();
const configPath = path.join(workspaceRoot, '.agents', 'config', 'project-env.json');
const profilePath = path.join(workspaceRoot, '.agents', 'config', 'iris_project_profile.md');
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
namespace = namespace || iris.namespace;
if (!namespace || namespace === 'TODO') {
    console.error('[错误] 缺少 IRIS namespace，请通过命令行参数或 .agents/config/project-env.json 的 iris.namespace 配置。');
    process.exit(1);
}

const webConfig = config.web || {};
const webBasePath = normalizePrefix(configValue(webConfig.basePath) || configValue(iris.webBasePath) || '');
const cspBasePath = normalizePrefix(configValue(webConfig.cspBasePath) || (webBasePath ? `${webBasePath}/csp` : ''));

function readFrontendEncodingProfile() {
    let text = '';
    try {
        text = fs.readFileSync(profilePath, 'utf8');
    } catch (_) {
        return { mode: null, overrides: [] };
    }
    const modeMatch = text.match(/^\s*-\s*前端编码模式\s*[：:]\s*(standard-gb2312|project-utf8)\s*$/m);
    const overrides = [];
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*\|\s*`?([^|`]+?)`?\s*\|\s*(standard-gb2312|project-utf8)\s*\|\s*$/);
        if (match) {
            overrides.push({ root: match[1].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''), mode: match[2] });
        }
    }
    return { mode: modeMatch ? modeMatch[1] : null, overrides };
}

function resolveFrontendMode(relativeTarget) {
    const profile = readFrontendEncodingProfile();
    const normalized = relativeTarget.replace(/\\/g, '/').replace(/^\.\//, '');
    const matches = profile.overrides.filter(item => normalized === item.root || normalized.startsWith(`${item.root}/`));
    matches.sort((a, b) => b.root.length - a.root.length);
    return matches.length > 0 ? matches[0].mode : profile.mode;
}

function prepareOutputTarget(fileInfo) {
    const intendedPath = path.resolve(workspaceRoot, fileInfo.fullPath);
    const relativeTarget = path.relative(workspaceRoot, intendedPath).replace(/\\/g, '/');
    if (relativeTarget.startsWith('../') || path.isAbsolute(relativeTarget)) {
        throw new Error(`导出目标超出项目根目录: ${intendedPath}`);
    }
    const isFrontend = fileInfo.type === 'CSP' || fileInfo.type === 'JS';
    if (!isFrontend) {
        return Object.assign({}, fileInfo, { fullPath: intendedPath, intendedDestination: intendedPath, frontendMode: null, staging: false, conversionRequired: false });
    }
    const frontendMode = resolveFrontendMode(relativeTarget);
    let useStaging = targetMode === 'staging' || (targetMode === 'auto' && frontendMode !== 'project-utf8');
    if (targetMode === 'source' && frontendMode !== 'project-utf8') {
        throw new Error('只有已确认的 project-utf8 前端允许直接导出到源码；standard-gb2312 或未确认模式必须使用 staging。');
    }
    const finalPath = useStaging ? path.join(workspaceRoot, '.agents', 'work', 'iris-export', relativeTarget) : intendedPath;
    return Object.assign({}, fileInfo, {
        fullPath: finalPath,
        intendedDestination: intendedPath,
        frontendMode,
        staging: useStaging,
        conversionRequired: frontendMode === 'standard-gb2312'
    });
}

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
        // It's a class name like Sample.Package.Class or web.SamplePage.cls
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
        const normalizedInput = normalizePrefix(cspPath);
        const defaultCspPrefix = normalizedInput.startsWith('csp/') ? webBasePath : cspBasePath;
        const effectiveBasePath = basePath !== undefined ? normalizePrefix(basePath) : defaultCspPrefix;
        requireWebBasePath(effectiveBasePath, 'CSP', '--basePath "" 可用于传入完整 IRIS doc 路径时禁用自动前缀');
        
        cspPath = prependBasePath(cspPath, effectiveBasePath);
        
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
        const effectiveBasePath = basePath !== undefined ? normalizePrefix(basePath) : webBasePath;
        requireWebBasePath(effectiveBasePath, 'JS', '--basePath "" 可用于传入完整 IRIS doc 路径时禁用自动前缀');
        
        jsPath = prependBasePath(jsPath, effectiveBasePath);
        
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
            const effectiveBasePath = basePath !== undefined ? normalizePrefix(basePath) : webBasePath;
            requireWebBasePath(effectiveBasePath, 'JS', '--basePath "" 可用于传入完整 IRIS doc 路径时禁用自动前缀');
            jsPath = prependBasePath(jsPath, effectiveBasePath);
            
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
            const effectiveBasePath = basePath !== undefined ? normalizePrefix(basePath) : webBasePath;
            requireWebBasePath(effectiveBasePath, 'CSP', '--basePath "" 可用于传入完整 IRIS doc 路径时禁用自动前缀');
            cspPath = prependBasePath(cspPath, effectiveBasePath);
            
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
    throw new Error(`无法识别文件类型: ${identifier}\n支持的类型: 类名(如 Sample.Package.Class), JS文件(.js), CSP文件(.csp)`);
}

function normalizePrefix(prefix) {
    return String(prefix || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function configValue(value) {
    const text = String(value || '').trim();
    return text.startsWith('TODO') ? '' : text;
}

function requireWebBasePath(prefix, fileType, hint) {
    if (basePath === '') {
        return;
    }
    if (!prefix) {
        throw new Error(`${fileType} 导出缺少 Web 路径前缀。请在 .agents/config/project-env.json 配置 web.basePath / web.cspBasePath，或通过 --basePath 显式传入。${hint ? ` ${hint}` : ''}`);
    }
}

function prependBasePath(filePath, prefix) {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const normalizedPrefix = normalizePrefix(prefix);
    if (!normalizedPrefix || normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)) {
        return normalizedPath;
    }
    return `${normalizedPrefix}/${normalizedPath}`;
}

/**
 * Export file from IRIS server
 */
function exportFile(fileInfo) {
    console.log(`[信息] 检测到文件类型: ${fileInfo.type}`);
    console.log(`[信息] 正在导出: ${fileInfo.displayName}`);
    console.log(`[信息] 目标文件: ${fileInfo.fullPath}`);

    if (fs.existsSync(fileInfo.fullPath) && !overwrite) {
        console.error(`[错误] 目标文件已存在；如确认覆盖请显式传入 --overwrite: ${fileInfo.fullPath}`);
        process.exit(1);
    }

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
            console.log(JSON.stringify({
                path: fileInfo.fullPath,
                intendedDestination: fileInfo.intendedDestination || fileInfo.fullPath,
                encoding: 'utf8',
                preset: fileInfo.frontendMode,
                staging: Boolean(fileInfo.staging),
                conversionRequired: Boolean(fileInfo.conversionRequired)
            }));

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
                        console.log('[信息] 已获取 Session Cookie，后续请求将复用该会话');
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
    const fileInfo = prepareOutputTarget(detectFileType(fileIdentifier));
    exportFile(fileInfo);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
