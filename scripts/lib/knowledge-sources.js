'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const slash = value => value.split(path.sep).join('/');

function safeFile(root, relative) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid knowledge path');
    const base = fs.realpathSync(root);
    const file = path.resolve(base, relative);
    let cursor = file;
    while (cursor !== base) {
        if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Knowledge path traverses a link');
        cursor = path.dirname(cursor);
    }
    return file;
}

function loadDocuments(context, domain = 'all') {
    if (!['all', 'business', 'ui'].includes(domain)) throw new Error('Invalid domain');
    const root = context.capabilityRoot;
    const documents = [];
    function add(relative, meta = {}, expectedHash) {
        const bytes = fs.readFileSync(safeFile(root, relative));
        const hash = digest(bytes);
        if (expectedHash && hash !== expectedHash) throw new Error('Knowledge source integrity mismatch: ' + relative);
        documents.push({ path: relative, hash, revision: hash, scope: 'shared', ...meta,
            content: bytes.toString('utf8').replace(/^\uFEFF/, '') });
    }
    const manifestPath = 'vendor/imedical-knowledge/sources.json';
    if (domain !== 'ui' && fs.existsSync(path.join(root, manifestPath))) {
        const manifest = JSON.parse(fs.readFileSync(safeFile(root, manifestPath), 'utf8'));
        if (manifest.schema !== 'imedical-knowledge-source/v1') throw new Error('Unsupported knowledge source');
        for (const file of manifest.files) {
            if (!file.path.startsWith('sources/')) throw new Error('Invalid source manifest path');
            add('vendor/imedical-knowledge/' + file.path, { domain: 'business', kind: 'upstream-reference',
                revision: manifest.commit, sourcePath: file.sourcePath, evidence: 'reference-unverified' }, file.sha256);
        }
    }
    if (domain !== 'business') {
        for (const directory of ['plugins/imedical-ui/references', 'plugins/iris-ui/references']) {
            if (!fs.existsSync(path.join(root, directory))) continue;
            for (const name of fs.readdirSync(path.join(root, directory)).sort()) {
                if (name.endsWith('.md')) add(directory + '/' + name, { domain: 'ui', kind: 'ui-reference',
                    evidence: name === 'verified-cases.md' ? 'verified-case' : name === 'source-catalog.md' ? 'source-catalog' : 'curated-guidance' });
            }
        }
        for (const name of ['hisui-widget-index.md', 'hisui-style-index.md']) {
            const relative = 'plugins/coding-iris-plugin/references/' + name;
            if (fs.existsSync(path.join(root, relative))) add(relative, { domain: 'ui', kind: 'hisui-reference', evidence: 'source-index' });
        }
    }
    return documents;
}

// Keep fenced blocks and table rows together. Oversized blocks remain atomic.
function chunks(document) {
    const lines = document.content.split(/\r\n|\n|\r/);
    const result = [];
    // Imported wiki often stores its document title only in YAML frontmatter.
    const frontmatterEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    const titleLine = frontmatterEnd > 0 ? lines.slice(1, frontmatterEnd).find(line => /^name:\s*\S/.test(line)) : null;
    const headings = titleLine ? [titleLine.replace(/^name:\s*/, '').replace(/^['"]|['"]$/g, '')] : [];
    const firstSection = lines.findIndex(line => /^##\s/.test(line));
    const documentContext = firstSection > 0 ? lines.slice(0, firstSection).join('\n').replace(/^---[\s\S]*?---\s*/, '').slice(0, 2200) : '';
    let start = 0;
    let fence = null;
    let block = [];
    let tableHeader = [];
    let continuationHeader = [];
    let frontmatter = lines[0] === '---';
    function flush() {
        if (!block.some(line => line.trim())) { block = []; return; }
        const text = [...continuationHeader, ...block].join('\n').trim();
        const heading = headings.filter(Boolean).join(' > ');
        const themes = [];
        if (/pure|纯净|天蓝/i.test(heading + '\n' + text)) themes.push('pure');
        if (/ihos|海蓝/i.test(heading + '\n' + text)) themes.push('ihos');
        if (!themes.length || /共性|通用|两套|两风格/.test(heading)) themes.push('common');
        const references = [...text.matchAll(/\[[^\]]*\]\(<?([^\s>]+)>?\)/g)].map(match => match[1]);
        const { content, ...meta } = document;
        result.push({ ...meta, id: digest(document.path + '\0' + start + '\0' + text),
            line: start + 1, endLine: start + block.length, heading, text, documentContext, themes, references });
        block = [];
        continuationHeader = [];
    }
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (frontmatter) { if (index > 0 && line === '---') frontmatter = false; continue; }
        const marker = line.match(/^\s*(`{3,}|~{3,})/);
        if (!fence && /^\s*\|?\s*:?-{3,}/.test(line) && index > 0 && lines[index - 1].includes('|')) {
            tableHeader = [lines[index - 1], line];
        }
        if (!fence && !line.includes('|')) tableHeader = [];
        if (!fence && tableHeader.length && line.includes('|') && block.join('\n').length > 1800) {
            flush();
            continuationHeader = tableHeader;
        }
        const heading = !fence && line.match(/^(#{1,6})\s+(.+)/);
        if (heading) {
            flush();
            headings.length = heading[1].length;
            headings[heading[1].length - 1] = heading[2];
        }
        if (!block.length) start = index;
        block.push(line);
        if (marker) {
            if (!fence) fence = marker[1];
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
        }
        if (!fence && !line.trim() && block.join('\n').length >= 1800) flush();
    }
    flush();
    return result;
}

module.exports = { digest, slash, safeFile, loadDocuments, chunks };
