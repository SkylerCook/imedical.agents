#!/usr/bin/env node

/**
 * 生成 IRIS 部署清单，不执行上传、编译或远端写入。
 *
 * 用法:
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --files <path...>
 *   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --from-git [--base HEAD]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function usage() {
    return [
        '用法:',
        '  node prepare-deploy-manifest.js [--project-root <path>] --files <path...>',
        '  node prepare-deploy-manifest.js [--project-root <path>] --from-git [--base <rev>]',
        '',
        '说明: 本脚本只输出 JSON 清单，不执行上传、编译或远端写入。'
    ].join('\n');
}

function parseArgs(argv) {
    const args = {
        projectRoot: process.cwd(),
        files: [],
        fromGit: false,
        base: 'HEAD'
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--project-root') {
            args.projectRoot = argv[++i];
        } else if (arg === '--files') {
            while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
                args.files.push(argv[++i]);
            }
        } else if (arg === '--from-git') {
            args.fromGit = true;
        } else if (arg === '--base') {
            args.base = argv[++i];
        } else if (arg === '--help' || arg === '-h') {
            console.log(usage());
            process.exit(0);
        } else {
            args.files.push(arg);
        }
    }

    return args;
}

function normalizeRelative(filePath, projectRoot) {
    const absolute = path.isAbsolute(filePath)
        ? path.normalize(filePath)
        : path.resolve(projectRoot, filePath);
    return path.relative(projectRoot, absolute).replace(/\\/g, '/');
}

function readProjectEnv(projectRoot) {
    const configPath = path.join(projectRoot, '.agents', 'config', 'project-env.json');
    if (!fs.existsSync(configPath)) {
        return {};
    }
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
}

function gitChangedFiles(projectRoot, base) {
    const output = execFileSync('git', ['diff', '--name-only', base], {
        cwd: projectRoot,
        encoding: 'utf8'
    });
    return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function withoutKnownRoot(relativePath, folderName) {
    const normalized = relativePath.replace(/\\/g, '/');
    const marker = `${folderName}/`;
    const index = normalized.indexOf(marker);
    if (index >= 0) {
        return normalized.slice(index + marker.length);
    }
    return path.posix.basename(normalized);
}

function joinPosix(prefix, suffix) {
    const cleanPrefix = String(prefix || '').replace(/^\/+|\/+$/g, '');
    const cleanSuffix = String(suffix || '').replace(/^\/+/g, '');
    if (!cleanPrefix) return cleanSuffix;
    if (!cleanSuffix) return cleanPrefix;
    return `${cleanPrefix}/${cleanSuffix}`;
}

function classifyFile(relativePath, projectRoot, config) {
    const ext = path.posix.extname(relativePath).toLowerCase();
    const fullPath = path.join(projectRoot, ...relativePath.split('/'));
    const item = {
        relativePath,
        exists: fs.existsSync(fullPath)
    };

    if (ext === '.cls' || ext === '.mac' || ext === '.inc') {
        const relWithoutSrc = relativePath.replace(/^src\//i, '');
        item.kind = 'iris-class';
        item.documentName = relWithoutSrc.replace(/\//g, '.');
        item.requiresStorageStrip = false;
        if (item.exists && ext === '.cls') {
            const content = fs.readFileSync(fullPath, 'utf8');
            item.requiresStorageStrip = /Storage\s+Default\b/i.test(content) || /Extends\s+.*%Persistent\b/i.test(content);
        }
        return item;
    }

    if (ext === '.csp') {
        const cspRelative = withoutKnownRoot(relativePath, 'csp');
        item.kind = 'csp';
        item.virtualPath = joinPosix(config.web?.cspBasePath || '', cspRelative);
        return item;
    }

    if (['.js', '.css', '.html', '.htm'].includes(ext)) {
        const assetRelative = withoutKnownRoot(relativePath, 'scripts');
        item.kind = 'web-asset';
        item.webPath = joinPosix(config.web?.basePath || '', `scripts/${assetRelative}`);
        return item;
    }

    item.kind = 'other';
    return item;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const projectRoot = path.resolve(args.projectRoot);
    const config = readProjectEnv(projectRoot);

    let files = args.files;
    if (args.fromGit) {
        files = gitChangedFiles(projectRoot, args.base);
    }

    if (!files.length) {
        console.error(usage());
        process.exit(1);
    }

    const uniqueFiles = Array.from(new Set(files.map(file => normalizeRelative(file, projectRoot))));
    const manifest = {
        schema: 'iris-deploy-manifest/v1',
        namespace: config.iris?.namespace || '',
        projectRoot: '.',
        source: args.fromGit ? { type: 'git-diff', base: args.base } : { type: 'files' },
        items: uniqueFiles.map(file => classifyFile(file, projectRoot, config))
    };

    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}

main();
