#!/usr/bin/env node

/**
 * IRIS Universal Export Script
 * Automatically detects file type and exports from IRIS server
 * 
 * Usage: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <fileIdentifier> [outputDir] [namespace] [--basePath <prefix>] [--target-mode auto|source|staging] [--overwrite] [--probe] [--json] [--staging-dir <path>] [--kind standard|project]
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
const { createAtelierClient } = require('../../../../scripts/lib/atelier-client');
const { contextMode } = require('../../../../scripts/lib/iris-remote-operations');

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
let demandKind;

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
    } else if (args[i] === '--kind') {
        demandKind = args[++i] || '';
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
if (demandKind !== undefined && !['standard', 'project'].includes(demandKind)) {
    console.error('[错误] --kind 只允许 standard 或 project');
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
require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(workspaceContext);
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
    for (const line of text.split(/\r\n|\r|\n/)) {
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
            encodingPolicy: fileInfo.frontend ? require('./frontend-encoding').resolve(workspaceContext, fileInfo.fullPath, {requireConfirmed:false,projectTask:demandKind==='project'}) : null,
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
    const encodingPolicy = require('./frontend-encoding').resolve(workspaceContext, intendedPath, {requireConfirmed:false,projectTask:demandKind==='project'});
    const useStaging = targetMode === 'staging' || !encodingPolicy.confirmed || !encodingPolicy.serverEncoding;
    if (targetMode === 'source' && useStaging) throw new Error('frontend-server-encoding-confirmation-required');
    const finalPath = useStaging ? path.join(workspaceContext.contextRoot, 'work', 'iris-export', relativeTarget) : intendedPath;
    return Object.assign({}, fileInfo, {
        fullPath: finalPath,
        intendedDestination: intendedPath,
        frontendMode,
        staging: useStaging,
        encodingPolicy,
        conversionRequired: encodingPolicy.sourceEncoding !== encodingPolicy.serverEncoding
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
    if (!probe && !fileInfo.staging && contextMode(workspaceContext) === 'intent-first-on-demand-export' &&
        require('./source-sync-core').demandKind(workspaceContext, {kind: demandKind}).kind === 'project') {
        throw new Error('source-sync-before-edit-required: 项目按需开发的待修改文件，无论本地是否存在，都先执行 source-sync.js 的 before-edit plan / prepare / apply；有变化先提交 export 基线，再开始需求修改。只读参考可用 --probe 或独立 staging。');
    }
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
    const binaryExport = !!fileInfo.encodingPolicy?.confirmed && !!fileInfo.encodingPolicy?.serverEncoding;
    const apiUrl = `${irisScheme}://${iris.host}:${irisPort}/api/atelier/v1/${namespace}/doc/${fileInfo.apiUrlPath}${binaryExport ? '?binary=1' : ''}`;

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
            emitFailure('unavailable', '收到 503 Service Unavailable；已停止，不自动重试。请核对许可与服务状态。', 1);
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
            if (!Array.isArray(response.result.content) || !response.result.content.every(line => typeof line === 'string')) throw new Error('atelier-document-invalid');

            // Check db field
            const dbType = response.result.db;
            if (dbType === '@FS') {
                info('[信息] 文件存储类型: 文件系统 (@FS)');
            }

            const encoding = require('./frontend-encoding');
            let content;
            let representation = 'atelier-text';
            let serverSha256 = null;
            if (binaryExport) {
                if (!response.result.enc) throw new Error('frontend-raw-read-unavailable');
                const encoded = response.result.content.join('');
                const bytes = Buffer.from(encoded, 'base64');
                if (bytes.toString('base64') !== encoded) throw new Error('atelier-binary-content-invalid');
                content = encoding.decode(bytes, fileInfo.encodingPolicy.serverEncoding, fileInfo.fullPath);
                serverSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
                representation = 'atelier-binary';
            } else {
                if (response.result.enc) throw new Error('frontend-server-encoding-confirmation-required');
                content = response.result.content.join('\n');
            }
            const localEncoding = fileInfo.encodingPolicy && !fileInfo.staging ? fileInfo.encodingPolicy.sourceEncoding : 'utf8';
            const contentBuffer = encoding.encode(content, localEncoding, fileInfo.fullPath);
            const encodingReceipt = {encoding:localEncoding,localEncoding,serverEncoding:fileInfo.encodingPolicy?.serverEncoding||null,serverEncodingConfirmed:!!fileInfo.encodingPolicy?.confirmed,representation,serverSha256,hashRepresentation:'local-output-bytes'};
            const contentHash = crypto.createHash('sha256').update(contentBuffer).digest('hex').toUpperCase();
            if (probe) {
                emitResult({ status: 'found', type: fileInfo.type, document: fileInfo.apiUrlPath, db: dbType || '', ...encodingReceipt, length: contentBuffer.length, sha256: contentHash });
                return;
            }

            // Write file
            fs.writeFileSync(fileInfo.fullPath, contentBuffer);

            info(`[成功] ${fileInfo.type} 文件已导出到: ${fileInfo.fullPath}`);
            emitResult({
                status: 'exported',
                path: fileInfo.fullPath,
                intendedDestination: fileInfo.intendedDestination || fileInfo.fullPath,
                ...encodingReceipt,
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

// A one-file CLI still uses the same bounded client as batch/source-sync.
// No 503 replay: the shared admission owner preserves a pool-wide circuit.
const RETRY_DELAYS = [];

/**
 * Execute an HTTP request with cookie session reuse and 503 retry.
 */
function requestWithRetry(apiUrl, options, maxRetries, callback) {
    let client;
    try {
        const required = contextMode(workspaceContext) === 'intent-first-on-demand-export';
        let connection = { protocol: irisScheme + ':', hostname: iris.host, port: irisPort,
            namespace, auth: iris.username + ':' + iris.password, rejectUnauthorized: String(iris.tlsVerify ?? false).toLowerCase() !== 'false' };
        const mcpPath = path.join(workspaceRoot, '.mcp.json');
        if (required) {
            const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8').replace(/^\uFEFF/, ''));
            connection = require('./compile-csp').connection(config, mcp);
            if (namespace !== iris.namespace) throw new Error('remote-namespace-override-rejected');
        }
        client = createAtelierClient({ connection, context: workspaceContext });
        const url = new URL(apiUrl);
        const name = url.pathname.split('/doc/')[1];
        client.request('GET', 'doc/' + name + url.search).then(async result => {
            const exit = await client.close();
            if (!exit.cleanupVerified) return callback(new Error('remote-session-exit-unverified'));
            callback(null, result === null ? 404 : 200, result === null ? '{}' : JSON.stringify(result));
        }, async error => {
            await client.close();
            callback(error.status === 503 ? null : error, error.status, '{}');
        }).catch(error => callback(error));
    } catch (error) { callback(error); }
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
