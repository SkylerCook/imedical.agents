#!/usr/bin/env node

/**
 * IRIS Universal Export Script
 * Automatically detects file type and exports from IRIS server
 * 
 * Usage: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <fileIdentifier> [outputDir] [namespace] [--basePath <prefix>] [--target-mode auto|source|staging] [--overwrite] [--probe] [--json] [--staging-dir <path>]
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
 *   # Probe a CSS document without writing it
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/theme.css --probe --json
 *   
 *   # Export with custom parameters
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js src <namespace> --basePath "<web-root-prefix>"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { resolveWorkspaceContext } = require('../../../../scripts/lib/workspace-context');

// Parse command line arguments
const args = process.argv.slice(2);
let fileIdentifier = args[0];
let outputDir = 'src';
let namespace = '';
let basePath; // undefined means use project-env web defaults; empty string disables prefixing.
let targetMode = 'auto';
let overwrite = false;
let probe = false;
let jsonOutput = false;
let stagingDir = '';

// Parse optional arguments
for (let i = 1; i < args.length; i++) {
    if (args[i] === '--basePath' || args[i] === '-BasePath') {
        basePath = args[++i] || '';
    } else if (args[i] === '--target-mode') {
        targetMode = args[++i] || 'auto';
    } else if (args[i] === '--overwrite') {
        overwrite = true;
    } else if (args[i] === '--probe') {
        probe = true;
    } else if (args[i] === '--json') {
        jsonOutput = true;
    } else if (args[i] === '--staging-dir') {
        stagingDir = args[++i] || '';
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
    console.error('[错误] 请提供文件标识符（类名、JS、CSP 或 CSS 路径）');
    console.error('\n用法: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <fileIdentifier> [outputDir] [namespace] [--basePath <prefix>]');
    console.error('\n示例:');
    console.error('  # 导出类');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js Sample.Package.Class');
    console.error('  # 导出JS文件');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/Alloc.ExaBorRoom.hui.js');
    console.error('  # 导出CSP文件');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js alloc.exaborroom.hui.csp');
    console.error('  # 只探测CSS文件并输出JSON');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/theme.css --probe --json');
    console.error('  # 自定义参数');
    console.error('  node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js src <namespace> --basePath "<web-root-prefix>"');
    process.exit(1);
}

// Load configuration
const workspaceContext = resolveWorkspaceContext(process.cwd());
const workspaceRoot = workspaceContext.workspaceRoot;
const configPath = path.join(workspaceContext.contextRoot, 'config', 'project-env.json');
const profilePath = path.join(workspaceContext.contextRoot, 'config', 'iris_project_profile.md');
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
    const modeMatch = text.match(/^\s*-\s*前端编码模式\s*[：:]\s*([^\r\n]+?)\s*$/m);
    const overrides = [];
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*\|\s*`?([^|`]+?)`?\s*\|\s*(utf8|standard-gb2312|project-utf8)\s*\|\s*$/);
        if (match) {
            overrides.push({ root: match[1].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''), mode: normalizeFrontendMode(match[2]) });
        }
    }
    return { mode: modeMatch ? normalizeFrontendMode(modeMatch[1]) : null, overrides };
}

function normalizeFrontendMode(mode) {
    const value = String(mode || '').trim();
    if (value === 'project-utf8') return 'utf8';
    if (value === 'utf8' || value === 'standard-gb2312') return value;
    if (value === 'N/A (backend-only)' || value === 'N/A（backend-only）' || value === 'backend-only N/A') return 'backend-only';
    return null;
}

function resolveFrontendMode(relativeTarget) {
    const profile = readFrontendEncodingProfile();
    const normalized = relativeTarget.replace(/\\/g, '/').replace(/^\.\//, '');
    const matches = profile.overrides.filter(item => normalized === item.root || normalized.startsWith(`${item.root}/`));
    matches.sort((a, b) => b.root.length - a.root.length);
    return matches.length > 0 ? matches[0].mode : profile.mode;
}

function prepareOutputTarget(fileInfo) {
    if (stagingDir) {
        const stagingRoot = path.resolve(stagingDir);
        const finalPath = path.resolve(stagingRoot, fileInfo.localRelativePath);
        const stagingRelative = path.relative(stagingRoot, finalPath).replace(/\\/g, '/');
        if (stagingRelative.startsWith('../') || path.isAbsolute(stagingRelative)) {
            throw new Error(`导出目标超出 staging 目录: ${finalPath}`);
        }
        return Object.assign({}, fileInfo, {
            fullPath: finalPath,
            intendedDestination: null,
            frontendMode: fileInfo.frontend ? resolveFrontendMode(fileInfo.projectRelativePath) : null,
            staging: true,
            conversionRequired: false
        });
    }
    const isFrontend = fileInfo.type === 'CSP' || fileInfo.type === 'JS' || fileInfo.type === 'CSS';
    const selectedRoot = isFrontend
        ? (workspaceContext.sourceRoots.find(sourceRoot => sourceRoot.name === 'frontend') || workspaceContext.sourceRoots[0])
        : (workspaceContext.sourceRoots.find(sourceRoot => sourceRoot.name === 'backend') || workspaceContext.sourceRoots[0]);
    const intendedPath = path.resolve(selectedRoot.target, fileInfo.fullPath);
    const sourceRelative = path.relative(selectedRoot.target, intendedPath).replace(/\\/g, '/');
    if (sourceRelative.startsWith('../') || path.isAbsolute(sourceRelative)) {
        throw new Error(`导出目标超出声明的 SourceRoot: ${intendedPath}`);
    }
    const logicalPrefix = path.relative(workspaceRoot, selectedRoot.path).replace(/\\/g, '/');
    const relativeTarget = [logicalPrefix === '.' ? '' : logicalPrefix, sourceRelative].filter(Boolean).join('/');
    if (!isFrontend) {
        return Object.assign({}, fileInfo, { fullPath: intendedPath, intendedDestination: intendedPath, frontendMode: null, staging: false, conversionRequired: false });
    }
    const frontendMode = resolveFrontendMode(relativeTarget);
    if (frontendMode === 'backend-only') {
        throw new Error('当前 profile 为 N/A (backend-only)，没有可导出的 frontend SourceRoot。');
    }
    let useStaging = targetMode === 'staging' || (targetMode === 'auto' && frontendMode !== 'utf8');
    if (targetMode === 'source' && frontendMode !== 'utf8') {
        throw new Error('只有已确认的 utf8 前端允许直接导出到源码；legacy standard-gb2312 或未确认模式必须使用 staging。');
    }
    const finalPath = useStaging ? path.join(workspaceContext.contextRoot, 'work', 'iris-export', relativeTarget) : intendedPath;
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
    const normalizedIdentifier = String(identifier || '').replace(/\\/g, '/');
    const ext = path.posix.extname(normalizedIdentifier).toLowerCase();
    const objectScriptExtensions = new Set(['.cls', '.mac', '.inc', '.int']);
    const isObjectScript = objectScriptExtensions.has(ext) ||
        (!normalizedIdentifier.includes('/') && normalizedIdentifier.includes('.') && !['.js', '.csp', '.css'].includes(ext));

    if (isObjectScript) {
        const documentExtension = objectScriptExtensions.has(ext) ? ext : '.cls';
        let documentStem = normalizedIdentifier;
        if (objectScriptExtensions.has(ext)) documentStem = documentStem.slice(0, -documentExtension.length);
        const documentName = documentStem + documentExtension;
        const localPath = documentStem.replace(/\./g, path.sep) + documentExtension;
        return {
            type: documentExtension.slice(1).toUpperCase(),
            filePath: documentName,
            apiUrlPath: documentName,
            fullPath: path.join(outputDir, localPath),
            displayName: documentName,
            localRelativePath: localPath,
            projectRelativePath: `src/${localPath.replace(/\\/g, '/')}`,
            frontend: false
        };
    }

    if (ext === '.csp') {
        let documentPath = normalizedIdentifier;
        const normalizedInput = normalizePrefix(documentPath);
        const defaultCspPrefix = normalizedInput.startsWith('csp/') ? webBasePath : cspBasePath;
        const effectiveBasePath = basePath !== undefined ? normalizePrefix(basePath) : defaultCspPrefix;
        requireWebBasePath(effectiveBasePath, 'CSP', '--basePath "" 可用于传入完整 IRIS doc 路径时禁用自动前缀');
        documentPath = prependBasePath(documentPath, effectiveBasePath);
        return frontendFileInfo('CSP', documentPath);
    }

    if (ext === '.js' || ext === '.css') {
        let documentPath = normalizedIdentifier;
        const effectiveBasePath = basePath !== undefined ? normalizePrefix(basePath) : webBasePath;
        const type = ext === '.css' ? 'CSS' : 'JS';
        requireWebBasePath(effectiveBasePath, type, '--basePath "" 可用于传入完整 IRIS doc 路径时禁用自动前缀');
        documentPath = prependBasePath(documentPath, effectiveBasePath);
        return frontendFileInfo(type, documentPath);
    }

    throw new Error(`无法识别文件类型: ${identifier}\n支持的类型: ObjectScript(.cls/.mac/.inc/.int), JS(.js), CSP(.csp), CSS(.css)`);
}

function frontendFileInfo(type, documentPath) {
    const localPath = documentPath.replace(/\//g, path.sep);
    return {
        type,
        filePath: localPath,
        apiUrlPath: documentPath,
        fullPath: path.join(outputDir, localPath),
        displayName: documentPath,
        localRelativePath: localPath,
        projectRelativePath: `src/${localPath.replace(/\\/g, '/')}`,
        frontend: true
    };
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
    info(`[信息] 检测到文件类型: ${fileInfo.type}`);
    info(`[信息] 正在导出: ${fileInfo.displayName}`);
    if (!probe) info(`[信息] 目标文件: ${fileInfo.fullPath}`);

    if (!probe && fs.existsSync(fileInfo.fullPath) && !overwrite) {
        console.error(`[错误] 目标文件已存在；如确认覆盖请显式传入 --overwrite: ${fileInfo.fullPath}`);
        process.exit(1);
    }

    // Create directory if not exists
    const dirPath = path.dirname(fileInfo.fullPath);
    if (!probe && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        info(`[信息] 创建目录: ${dirPath}`);
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
            emitFailure('connection-error', error.message, 1);
            process.exit(1);
        }

        if (statusCode === 503) {
            emitFailure('unavailable', '多次重试后仍收到 503 Service Unavailable，可能 License 已耗尽', 1);
            process.exit(1);
        }

        if (statusCode === 404) {
            emitFailure('not-found', `未找到 ${fileInfo.displayName}`, 3);
            process.exit(3);
        }

        try {
            const response = JSON.parse(data);

            // Check for errors
            if (response.status && response.status.errors && response.status.errors.length > 0) {
                const message = String(response.status.errors[0]);
                const notFound = /not\s+found|does\s+not\s+exist|不存在|未找到/i.test(message);
                emitFailure(notFound ? 'not-found' : 'remote-error', message, notFound ? 3 : 1);
                process.exit(notFound ? 3 : 1);
            }

            // Check if content exists
            if (!response.result || !response.result.content) {
                emitFailure('not-found', `未找到 ${fileInfo.type} 文件内容`, 3);
                const statusText = response.result && response.result.status;
                if (statusText) {
                    info(`[信息] 状态: ${statusText}`);
                }
                process.exit(3);
            }

            // Check db field
            const dbType = response.result.db;
            if (dbType === '@FS') {
                info('[信息] 文件存储类型: 文件系统 (@FS)');
            }

            let content = response.result.content.join('\n');
            const contentBuffer = Buffer.from(content, 'utf8');
            const contentHash = crypto.createHash('sha256').update(contentBuffer).digest('hex').toUpperCase();
            if (probe) {
                emitResult({ status: 'found', type: fileInfo.type, document: fileInfo.apiUrlPath, db: dbType || '', encoding: 'utf8', length: contentBuffer.length, sha256: contentHash });
                return;
            }

            // Write file
            fs.writeFileSync(fileInfo.fullPath, content, 'utf8');

            info(`[成功] ${fileInfo.type} 文件已导出到: ${fileInfo.fullPath}`);
            emitResult({
                status: 'exported',
                path: fileInfo.fullPath,
                intendedDestination: fileInfo.intendedDestination || fileInfo.fullPath,
                encoding: 'utf8',
                preset: fileInfo.frontendMode,
                staging: Boolean(fileInfo.staging),
                conversionRequired: Boolean(fileInfo.conversionRequired),
                sha256: contentHash
            });

        } catch (parseError) {
            emitFailure('parse-error', `解析响应失败: ${parseError.message}`, 1);
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
        info('[信息] 正在连接 IRIS 服务器...');

        client.get(apiUrl, reqOptions, (res) => {
            // Capture session cookie from first response
            if (!sharedCookie) {
                const setCookie = res.headers['set-cookie'];
                if (setCookie) {
                    const sessionEntry = setCookie.find(c => c.startsWith('CSPSESSIONID'));
                    if (sessionEntry) {
                        sharedCookie = sessionEntry.split(';')[0];
                        info('[信息] 已获取 Session Cookie，后续请求将复用该会话');
                    }
                }
            }

            // Handle 503 with retry
            if (res.statusCode === 503 && retryCount < maxRetries) {
                const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
                info(`[警告] 收到 503，${delay / 1000}秒后重试 (${retryCount + 1}/${maxRetries})...`);
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

function info(message) {
    if (!jsonOutput) console.log(message);
}

function emitResult(result) {
    console.log(JSON.stringify(result));
}

function emitFailure(status, message, exitCode) {
    if (jsonOutput) console.log(JSON.stringify({ status, message, exitCode }));
    else console.error(`[错误] ${message}`);
}

// Main execution
try {
    const fileInfo = prepareOutputTarget(detectFileType(fileIdentifier));
    exportFile(fileInfo);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
