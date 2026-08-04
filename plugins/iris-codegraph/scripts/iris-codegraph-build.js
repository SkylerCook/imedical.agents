#!/usr/bin/env node

/**
 * IRISGraph 后端代码图谱构建脚本（MVP）
 * 输入：.iris-codegraph-cache/ 下的源码与清单
 * 输出：.iris-codegraph/iris-codegraph.db（SQLite）
 *
 * 首版支持：
 *   - 节点：class / method / property / parameter
 *   - 边：contains / extends / calls（##class静态解析）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');

const workspaceRoot = findWorkspaceRoot();
const mcpPath = path.join(workspaceRoot, '.mcp.json');
const cacheDir = path.join(workspaceRoot, '.iris-codegraph-cache');
const outputDir = path.join(workspaceRoot, '.iris-codegraph');
const dbPath = path.join(outputDir, 'iris-codegraph.db');
const dataPath = path.join(outputDir, 'graph-data.json');

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

function loadMcpConfig() {
    const text = fs.readFileSync(mcpPath, 'utf8');
    const config = JSON.parse(text);
    const server = config.mcpServers && config.mcpServers['iris-dev'];
    if (!server) {
        throw new Error('.mcp.json 中未找到 iris-dev 服务器配置');
    }
    const env = server.env || {};
    return {
        host: env.IRIS_HOST,
        port: parseInt(env.IRIS_WEB_PORT || '52773', 10),
        scheme: env.IRIS_SCHEME || 'https',
        username: env.IRIS_USERNAME,
        password: env.IRIS_PASSWORD,
        namespace: env.IRIS_NAMESPACE || 'USER',
        insecure: env.IRIS_INSECURE === 'true'
    };
}

function parseArgs() {
    const args = process.argv.slice(2);
    return {
        cacheDir,
        outputDir,
        namespace: null,
        module: null,
        pattern: null
    };
}

function requestJson(urlPath, iris, method = 'GET', postBody = null) {
    return new Promise((resolve, reject) => {
        const client = iris.scheme === 'https' ? https : http;
        const auth = Buffer.from(`${iris.username}:${iris.password}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Connection': 'keep-alive'
        };
        let body = null;
        if (postBody) {
            body = JSON.stringify(postBody);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(body);
        }
        const options = {
            hostname: iris.host,
            port: iris.port,
            path: `/api/atelier/v1/${iris.namespace}${urlPath}`,
            method,
            headers,
            rejectUnauthorized: !iris.insecure
        };
        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    reject(new Error(`解析 JSON 失败: ${e.message}\n${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function queryInBatches(iris, baseSql, values, batchSize = 200) {
    const results = [];
    for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        const sql = baseSql.replace(/\$PLACEHOLDER\$/g, placeholders);
        const res = await requestJson('/action/query', iris, 'POST', { query: sql, parameters: batch });
        if (res.status !== 200) {
            throw new Error(`SQL 查询失败: HTTP ${res.status}`);
        }
        if (res.body.status && res.body.status.errors && res.body.status.errors.length) {
            throw new Error(`SQL 查询失败: ${res.body.status.errors[0].error || JSON.stringify(res.body.status.errors[0])}`);
        }
        const rows = (res.body.result && res.body.result.content) || [];
        results.push(...rows);
    }
    return results;
}

async function fetchMemberDefinitions(iris, classNames) {
    if (!classNames.length) return { methods: [], properties: [], parameters: [] };
    const [methods, properties, parameters] = await Promise.all([
        queryInBatches(iris,
            `SELECT parent, Name, FormalSpec, ReturnType, ClassMethod, Private, Final, Description FROM %Dictionary.MethodDefinition WHERE parent IN ($PLACEHOLDER$)`,
            classNames),
        queryInBatches(iris,
            `SELECT parent, Name, Type, Collection, Private, Final, Description FROM %Dictionary.PropertyDefinition WHERE parent IN ($PLACEHOLDER$)`,
            classNames),
        queryInBatches(iris,
            `SELECT parent, Name, "_Default" AS DefaultValue, Type, Final FROM %Dictionary.ParameterDefinition WHERE parent IN ($PLACEHOLDER$)`,
            classNames)
    ]);
    return { methods, properties, parameters };
}

function classNameToPath(className) {
    return className.replace(/\./g, path.sep) + '.cls';
}

function readClassSource(className, cacheDir) {
    const rel = classNameToPath(className);
    const full = path.join(cacheDir, 'cls', rel);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf8');
}

function extractClassDocstring(source) {
    if (!source) return null;
    const lines = source.split(/\r?\n/);
    const docs = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('///')) {
            docs.push(trimmed.replace(/^\/{3}/, '').trim());
        } else if (trimmed.startsWith('Class ')) {
            break;
        }
    }
    return docs.length ? docs.join('\n') : null;
}

function extractSharpClassCalls(source) {
    if (!source) return [];
    const calls = [];
    const regex = /##class\(([A-Za-z0-9_.%]+)\)\.([A-Za-z0-9]+)/g;
    let m;
    while ((m = regex.exec(source)) !== null) {
        const line = source.substring(0, m.index).split(/\r?\n/).length;
        calls.push({
            targetClass: m[1],
            targetMethod: m[2],
            line,
            confidence: 1.0
        });
    }
    return calls;
}

async function main() {
    const options = parseArgs();
    const iris = loadMcpConfig();
    if (options.namespace) iris.namespace = options.namespace;

    console.log(`[信息] 目标 IRIS: ${iris.scheme}://${iris.host}:${iris.port} / ${iris.namespace}`);

    const manifestPath = path.join(options.cacheDir, `manifest-${iris.namespace}.json`);
    const defsPath = path.join(options.cacheDir, `class-definitions-${iris.namespace}.json`);
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`清单不存在: ${manifestPath}，请先运行 export-batch.js`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const classItems = manifest.items.filter(i => i.category === 'CLS');
    const classNames = classItems.map(i => i.name.replace(/\.cls$/i, ''));
    console.log(`[信息] 缓存中共有 ${classItems.length} 个类待构建图谱`);

    let definitions = [];
    if (fs.existsSync(defsPath)) {
        definitions = JSON.parse(fs.readFileSync(defsPath, 'utf8')).items || [];
    }
    const defMap = new Map(definitions.map(d => [d.Name, d]));

    console.log('[信息] 通过 iris_query 拉取类成员定义...');
    const { methods, properties, parameters } = await fetchMemberDefinitions(iris, classNames);

    fs.mkdirSync(options.outputDir, { recursive: true });

    const files = [];
    const nodes = [];
    const edges = [];
    const metadata = {};

    const nodeIdByClassName = new Map();
    let nextId = 1;

    function addNode(node) {
        const id = nextId++;
        nodes.push(Object.assign({ id }, node));
        if (node.kind === 'class') {
            nodeIdByClassName.set(node.qualified_name, id);
        }
        return id;
    }

    function addEdge(edge) {
        edges.push(edge);
    }

    // 1. 写入 files 与 class 节点
    for (const className of classNames) {
        const relPath = classNameToPath(className);
        const fullPath = path.join(options.cacheDir, 'cls', relPath);
        const source = readClassSource(className, options.cacheDir);
        const def = defMap.get(className) || {};
        const fileModule = manifest.module || null;

        files.push({
            path: relPath,
            language: 'objectscript',
            module: fileModule,
            last_modified: fs.existsSync(fullPath) ? fs.statSync(fullPath).mtimeMs : 0
        });

        const classNode = {
            kind: 'class',
            name: className.split('.').pop(),
            qualified_name: className,
            file_path: relPath,
            start_line: 1,
            docstring: extractClassDocstring(source) || def.Description || null,
            metadata: {
                super: def.Super || null,
                abstract: def.Abstract || false,
                classType: def.ClassType || null
            }
        };
        addNode(classNode);
    }

    // 2. method / property / parameter 节点 + contains 边
    for (const m of methods) {
        const className = m.parent;
        const classId = nodeIdByClassName.get(className);
        if (classId == null) continue;
        const qname = `${className}::${m.Name}`;
        const methodNode = {
            kind: 'method',
            name: m.Name,
            qualified_name: qname,
            file_path: classNameToPath(className),
            signature: `${m.Name}(${m.FormalSpec || ''})${m.ReturnType ? ' As ' + m.ReturnType : ''}`,
            visibility: m.Private ? 'private' : 'public',
            is_exported: !m.Private,
            is_static: !!m.ClassMethod,
            docstring: m.Description || null,
            metadata: { returnType: m.ReturnType || null, formalSpec: m.FormalSpec || null }
        };
        const methodId = addNode(methodNode);
        addEdge({ kind: 'contains', source: classId, target: methodId, file_path: methodNode.file_path });
    }

    for (const p of properties) {
        const className = p.parent;
        const classId = nodeIdByClassName.get(className);
        if (classId == null) continue;
        const qname = `${className}::${p.Name}`;
        const propNode = {
            kind: 'property',
            name: p.Name,
            qualified_name: qname,
            file_path: classNameToPath(className),
            visibility: p.Private ? 'private' : 'public',
            is_exported: !p.Private,
            metadata: { type: p.Type || null, collection: p.Collection || null }
        };
        const propId = addNode(propNode);
        addEdge({ kind: 'contains', source: classId, target: propId, file_path: propNode.file_path });
    }

    for (const p of parameters) {
        const className = p.parent;
        const classId = nodeIdByClassName.get(className);
        if (classId == null) continue;
        const qname = `${className}::${p.Name}`;
        const paramNode = {
            kind: 'parameter',
            name: p.Name,
            qualified_name: qname,
            file_path: classNameToPath(className),
            metadata: { type: p.Type || null, defaultValue: p.DefaultValue || null }
        };
        const paramId = addNode(paramNode);
        addEdge({ kind: 'contains', source: classId, target: paramId, file_path: paramNode.file_path });
    }

    // 3. extends 边
    for (const className of classNames) {
        const def = defMap.get(className);
        if (!def || !def.Super) continue;
        const classId = nodeIdByClassName.get(className);
        const superClasses = def.Super.split(',').map(s => s.trim()).filter(Boolean);
        for (const sup of superClasses) {
            let superId = nodeIdByClassName.get(sup);
            if (superId == null) {
                superId = addNode({
                    kind: 'class',
                    name: sup.split('.').pop(),
                    qualified_name: sup,
                    file_path: null,
                    metadata: { stub: true }
                });
            }
            addEdge({ kind: 'extends', source: classId, target: superId, file_path: classNameToPath(className) });
        }
    }

    // 4. calls 边（##class 静态解析）
    for (const className of classNames) {
        const source = readClassSource(className, options.cacheDir);
        if (!source) continue;
        const classId = nodeIdByClassName.get(className);
        const calls = extractSharpClassCalls(source);
        for (const c of calls) {
            const callerId = classId;
            let targetId = nodeIdByClassName.get(c.targetClass);
            if (targetId == null) {
                targetId = addNode({
                    kind: 'class',
                    name: c.targetClass.split('.').pop(),
                    qualified_name: c.targetClass,
                    file_path: null,
                    metadata: { stub: true }
                });
            }
            addEdge({
                kind: 'calls',
                source: callerId,
                target: targetId,
                file_path: classNameToPath(className),
                start_line: c.line,
                confidence: c.confidence,
                metadata: { targetMethod: c.targetMethod }
            });
        }
    }

    // 5. 元数据
    const now = new Date().toISOString();
    metadata.index_state = 'complete';
    metadata.indexed_at = now;
    metadata.namespace = iris.namespace;
    metadata.indexed_with_version = 'iris-codegraph-build-mvp-0.1';
    metadata.indexed_with_extraction_version = 'docs_introspect-iris_query-source-parse';
    metadata.total_classes = classNames.length;
    metadata.total_methods = methods.length;
    metadata.total_properties = properties.length;
    metadata.total_parameters = parameters.length;

    const graphData = { files, nodes, edges, metadata };
    fs.writeFileSync(dataPath, JSON.stringify(graphData, null, 2), 'utf8');
    console.log(`[信息] 图谱中间数据已写入: ${dataPath}`);

    // 6. 调用 Python 写入 SQLite
    const pyScript = path.join(__dirname, 'write-sqlite.py');
    const result = spawnSync('python', [pyScript, dataPath], { encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0) {
        console.error('[错误] Python SQLite 写入失败:');
        console.error(result.stderr || result.stdout);
        process.exit(1);
    }
    console.log(result.stdout.trim());
    console.log(`\n[完成] 图谱数据库: ${dbPath}`);
    console.log(`  类: ${classNames.length}, 方法: ${methods.length}, 属性: ${properties.length}, 参数: ${parameters.length}`);
}

main().catch(err => {
    console.error('[错误]', err.message);
    console.error(err.stack);
    process.exit(1);
});
