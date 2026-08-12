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
const { resolveWorkspaceContext, resolveGitRootForPath } = require('../../../../scripts/lib/workspace-context');

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

function toPosix(value) {
    return value.replace(/\\/g, '/');
}

function readProjectEnv(context) {
    const configPath = path.join(context.contextRoot, 'config', 'project-env.json');
    if (!fs.existsSync(configPath)) {
        return {};
    }
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
}

function gitChangedFiles(gitRoot, base) {
    const output = execFileSync('git', ['diff', '--name-only', base], {
        cwd: gitRoot,
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

function classifyFile(descriptor, config) {
    const { relativePath, physicalPath, sourceRelative, sourceRoot, gitRoot } = descriptor;
    const ext = path.posix.extname(relativePath).toLowerCase();
    const item = {
        relativePath,
        sourceRoot,
        gitRoot,
        exists: fs.existsSync(physicalPath)
    };

    if (ext === '.cls' || ext === '.mac' || ext === '.inc') {
        const relWithoutSrc = sourceRelative.replace(/^src\//i, '');
        item.kind = 'iris-class';
        item.documentName = relWithoutSrc.replace(/\//g, '.');
        item.requiresStorageStrip = false;
        if (item.exists && ext === '.cls') {
            const content = fs.readFileSync(physicalPath, 'utf8');
            item.requiresStorageStrip = /Storage\s+Default\b/i.test(content) || /Extends\s+.*%Persistent\b/i.test(content);
        }
        return item;
    }

    if (ext === '.csp') {
        const cspRelative = withoutKnownRoot(sourceRelative, 'csp');
        item.kind = 'csp';
        item.virtualPath = joinPosix(config.web?.cspBasePath || '', cspRelative);
        return item;
    }

    if (['.js', '.css', '.html', '.htm'].includes(ext)) {
        const assetRelative = withoutKnownRoot(sourceRelative, 'scripts');
        item.kind = 'web-asset';
        item.webPath = joinPosix(config.web?.basePath || '', `scripts/${assetRelative}`);
        return item;
    }

    item.kind = 'other';
    return item;
}

function isWithin(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function logicalPrefix(context, sourceRoot) {
    return toPosix(path.relative(context.workspaceRoot, sourceRoot.path)).replace(/^\.\/$/, '');
}

function descriptorForAbsolute(context, absolutePath) {
    const sourceRoot = resolveGitRootForPath(context, absolutePath);
    const sourceRelative = toPosix(path.relative(sourceRoot.target, absolutePath));
    const prefix = logicalPrefix(context, sourceRoot);
    return {
        relativePath: joinPosix(prefix === '.' ? '' : prefix, sourceRelative),
        physicalPath: absolutePath,
        sourceRelative,
        sourceRoot: sourceRoot.name,
        gitRoot: sourceRoot.gitRoot
    };
}

function descriptorForInput(context, filePath) {
    if (path.isAbsolute(filePath)) return descriptorForAbsolute(context, path.normalize(filePath));
    const normalized = toPosix(filePath).replace(/^\.\//, '');
    const matches = context.sourceRoots
        .map(sourceRoot => ({ sourceRoot, prefix: logicalPrefix(context, sourceRoot) }))
        .filter(({ prefix }) => prefix === '' || prefix === '.' || normalized === prefix || normalized.startsWith(`${prefix}/`))
        .sort((left, right) => right.prefix.length - left.prefix.length);
    const selected = matches[0] || { sourceRoot: context.sourceRoots[0], prefix: '' };
    const sourceRelative = selected.prefix && selected.prefix !== '.'
        ? normalized.slice(selected.prefix.length).replace(/^\//, '')
        : normalized;
    return descriptorForAbsolute(context, path.resolve(selected.sourceRoot.target, sourceRelative));
}

function descriptorsFromGit(context, base) {
    const changedByGitRoot = new Map();
    const descriptors = [];
    for (const sourceRoot of context.sourceRoots) {
        if (!changedByGitRoot.has(sourceRoot.gitRoot)) {
            changedByGitRoot.set(sourceRoot.gitRoot, gitChangedFiles(sourceRoot.gitRoot, base));
        }
        for (const gitRelative of changedByGitRoot.get(sourceRoot.gitRoot)) {
            const absolutePath = path.resolve(sourceRoot.gitRoot, gitRelative);
            if (isWithin(absolutePath, sourceRoot.target)) descriptors.push(descriptorForAbsolute(context, absolutePath));
        }
    }
    return descriptors;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const projectRoot = path.resolve(args.projectRoot);
    const context = resolveWorkspaceContext(projectRoot);
    if (context.mode === 'invalid') throw new Error(`Invalid workspace context: ${context.manifestError}`);
    const config = readProjectEnv(context);

    let descriptors = args.fromGit
        ? descriptorsFromGit(context, args.base)
        : args.files.map(file => descriptorForInput(context, file));

    if (!descriptors.length) {
        console.error(usage());
        process.exit(1);
    }

    const uniqueFiles = Array.from(new Map(descriptors.map(item => [`${item.sourceRoot}\0${item.relativePath}`, item])).values());
    const manifest = {
        schema: 'iris-deploy-manifest/v1',
        namespace: config.iris?.namespace || '',
        projectRoot: '.',
        source: args.fromGit ? { type: 'git-diff', base: args.base } : { type: 'files' },
        items: uniqueFiles.map(file => classifyFile(file, config))
    };

    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}

main();
