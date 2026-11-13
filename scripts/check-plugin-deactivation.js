'use strict';

const fs = require('node:fs');
const path = require('node:path');
const deployment = require('./lib/plugin-deployment');

function checkDeactivation(capabilityRoot, contextRoot, targetName) {
    const catalog = deployment.readJson(path.join(capabilityRoot, 'scripts/lib/plugin-catalog.json'), { plugins: [] });
    const items = new Map(catalog.plugins.map(item => [item.manifest.name, item]));
    const pluginRoot = path.join(capabilityRoot, 'plugins');
    if (fs.existsSync(pluginRoot)) {
        for (const entry of fs.readdirSync(pluginRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const manifest = deployment.readJson(path.join(pluginRoot, entry.name, '.agents-plugin/plugin.json'));
            if (manifest) items.set(manifest.name || entry.name, { directory: entry.name, manifest });
        }
    }
    const resolve = name => {
        const matches = [...items.values()].filter(item =>
            [item.manifest.name, item.directory, ...(item.manifest.legacyNames || item.manifest.legacy_names || item.manifest.aliases || [])]
                .some(alias => alias.toLowerCase() === name.toLowerCase()));
        if (matches.length !== 1) throw new Error('Unknown or ambiguous plugin: ' + name);
        return matches[0];
    };
    const { statuses } = deployment.profileContext(capabilityRoot, contextRoot);
    const active = new Set(['agent-context-kit', 'agent-framework-evolution'].filter(name => items.has(name)));
    const canonicalStatuses = new Map();
    for (const [name, status] of statuses) {
        const canonical = resolve(name).manifest.name;
        if (canonicalStatuses.has(canonical) && canonicalStatuses.get(canonical) !== status) {
            throw new Error('Conflicting plugin aliases: ' + canonical);
        }
        canonicalStatuses.set(canonical, status);
        if (status === 'enabled') active.add(canonical);
        else active.delete(canonical);
    }
    const target = resolve(targetName).manifest.name;
    const chains = [];
    function visit(item, chain) {
        const name = item.manifest.name;
        if (chain.includes(name)) return;
        const next = [...chain, name];
        if (name === target) { chains.push(next); return; }
        const dependencies = item.manifest.dependencies || item.manifest.dependsOn || item.manifest.depends_on || [];
        for (const dependency of dependencies) visit(resolve(dependency), next);
    }
    for (const name of active) {
        if (name !== target) visit(resolve(name), []);
    }
    if (chains.length) throw new Error('plugin-required-by-enabled: ' + chains.map(chain => chain.join(' -> ')).join('; '));
}

if (require.main === module) {
    try { checkDeactivation(...process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkDeactivation };
