#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function generate(root) {
    const plugins = fs.readdirSync(path.join(root, 'plugins')).sort().flatMap(directory => {
        const file = path.join(root, 'plugins', directory, '.agents-plugin/plugin.json');
        if (!fs.existsSync(file)) return [];
        const bytes = fs.readFileSync(file);
        const manifest = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
        return [{ directory, manifest, manifestHash: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex') }];
    });
    const groups = JSON.parse(fs.readFileSync(path.join(root, 'scripts/lib/plugin-groups.json'), 'utf8')).groups;
    const grouped = groups.flatMap(group => group.plugins);
    const names = plugins.map(item => item.manifest.name);
    if (new Set(grouped).size !== grouped.length || grouped.length !== names.length || grouped.some(name => !names.includes(name))) {
        throw new Error('Each plugin must belong to exactly one known group');
    }
    return { schema: 'plugin-catalog/v1', basePlugins: ['agent-context-kit', 'agent-framework-evolution'], groups, plugins };
}

if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    const file = path.join(root, 'scripts/lib/plugin-catalog.json');
    const content = JSON.stringify(generate(root), null, 2) + '\n';
    if (process.argv.includes('--check')) {
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
            console.error('Plugin catalog is stale; run node scripts/generate-plugin-catalog.js');
            process.exitCode = 1;
        }
    } else fs.writeFileSync(file, content);
}
module.exports = { generate };
