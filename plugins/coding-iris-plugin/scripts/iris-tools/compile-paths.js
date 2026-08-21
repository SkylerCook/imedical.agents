'use strict';

const path = require('path');

function cleanLogicalPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function hasExtension(value) {
    return /\.\w+$/.test(String(value || '').split('/').pop());
}

function resolveCompilePaths(input, options) {
    const workspaceRoot = path.resolve(options && options.workspaceRoot ? options.workspaceRoot : '.');
    const sourceRoot = options && options.sourceRoot;
    if (!sourceRoot) throw new Error('sourceRoot is required.');

    const value = String(input || '');
    const isClassName = !value.includes('/') && !value.includes('\\')
        && /^[A-Za-z][A-Za-z0-9.]*$/.test(value);
    const normalizedInput = cleanLogicalPath(value);
    const logicalSourcePath = sourceRoot.path ? path.relative(workspaceRoot, sourceRoot.path) : '';
    const sourcePrefix = cleanLogicalPath(logicalSourcePath || sourceRoot.name || '');

    if (sourcePrefix && (normalizedInput === sourcePrefix || normalizedInput.startsWith(`${sourcePrefix}/`))) {
        let localRelativePath = normalizedInput.slice(sourcePrefix.length).replace(/^\//, '');
        if (!hasExtension(localRelativePath)) localRelativePath += '.cls';
        const documentRelativePath = localRelativePath.replace(/^src\//i, '');
        return {
            localPath: localRelativePath.replace(/\//g, path.sep),
            docName: documentRelativePath.replace(/[/\\]/g, '.')
        };
    }

    if (isClassName) {
        const baseName = value.replace(/\.cls$/i, '');
        return {
            localPath: path.join('src', ...baseName.split('.')) + '.cls',
            docName: baseName + '.cls'
        };
    }

    let relativePath = value.replace(/^src[\\/]/i, '');
    if (!hasExtension(relativePath.replace(/\\/g, '/'))) relativePath += '.cls';
    return {
        localPath: path.join('src', relativePath),
        docName: relativePath.replace(/[/\\]/g, '.')
    };
}

module.exports = { resolveCompilePaths };
