'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '../..');
const output = path.join(repo, 'plugins/bos-plugin/runtime');
const helper = path.join('scripts', 'lib', 'configuration-file-io.js');
const parser = path.join('vendor', 'jsonc-parser');
const checkoutText = new Set([helper, path.join(parser, '.gitattributes'), path.join(parser, 'UPSTREAM.json')]);

function listFiles(root, relative = '') {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return [];
    if (stat.isFile()) return [relative];
    if (!stat.isDirectory()) throw new Error(`Expected a regular runtime file or directory: ${file}`);
    return fs.readdirSync(file).flatMap(name => listFiles(root, path.join(relative, name)));
}

function bytes(root, name) {
    const content = fs.readFileSync(path.join(root, name));
    // Upstream JS and LICENSE.md are pinned byte for byte by vendor's .gitattributes.
    return checkoutText.has(name) ? Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : content;
}

function sync(mode) {
    const parserFiles = listFiles(repo, parser);
    if (!parserFiles.includes(path.join(parser, 'main.js'))) throw new Error('The canonical JSONC parser is missing');
    const expected = new Set([helper, ...parserFiles]);
    const actual = new Set(listFiles(output));
    const unexpected = [...actual].filter(name => !expected.has(name));
    if (unexpected.length) throw new Error(`Unexpected files in the generated BOS runtime: ${unexpected.join(', ')}`);

    const changed = [];
    for (const name of expected) {
        const content = bytes(repo, name);
        if (actual.has(name) && bytes(output, name).equals(content)) continue;
        changed.push(name);
        if (mode === '--write') {
            const target = path.join(output, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
        }
    }
    if (mode === '--check' && changed.length) {
        throw new Error(`Stale BOS configuration runtime: ${changed.join(', ')}. Run node maintenance/governance/sync-bos-config-runtime.js --write`);
    }
    console.log(`BOS configuration runtime: ${expected.size} files verified`);
}

try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length || !['--write', '--check'].includes(mode)) {
        throw new Error('Usage: node maintenance/governance/sync-bos-config-runtime.js --write|--check');
    }
    sync(mode);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
