#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('./lib/workspace-context');
const retrieval = require('./lib/knowledge-retrieval');
const { initializeConfiguration } = require('./lib/knowledge-embedding');

function resolveContext(root) {
    const absolute = path.resolve(root);
    if (fs.existsSync(path.join(absolute, 'plugins/coding-iris-plugin/.agents-plugin/plugin.json'))) {
        return { workspaceRoot: absolute, capabilityRoot: absolute, contextRoot: absolute };
    }
    const context = resolveWorkspaceContext(absolute);
    if (context.mode === 'invalid' || (context.mode !== 'standard' && workspaceContextBlockers(context).length)) {
        throw new Error('Invalid workspace context');
    }
    return context;
}

async function main(argv) {
    if (argv.includes('--help')) {
        console.log('knowledge-query.js --project-root <workspace> [--action query|preview|build|export|install-index|remove-index|init-config] [--provider company|openai] [--config-file <private JSON path>] [--query <text>] [--domain business|ui|all] [--theme pure|ihos|common] [--limit 6] [--max-chars 12000] [--query-public] [--local-only] [--approve <preview snapshot>]');
        return;
    }
    const options = {};
    const flags = new Set(['--query-public', '--local-only']);
    const values = new Set(['--project-root', '--action', '--query', '--domain', '--theme', '--limit', '--max-chars', '--approve', '--provider', '--config-file']);
    while (argv.length) {
        const key = argv.shift();
        if (Object.hasOwn(options, key)) throw new Error('Duplicate argument');
        if (flags.has(key)) options[key] = true;
        else if (values.has(key) && argv.length) options[key] = argv.shift();
        else throw new Error('Invalid argument');
    }
    if (options['--action'] === 'init-config') {
        console.log(JSON.stringify(initializeConfiguration(options['--config-file'])));
        return;
    }
    if (!options['--project-root']) throw new Error('Explicit project root required');
    const context = resolveContext(options['--project-root']);
    const action = options['--action'] || 'query';
    const embeddingOptions = { provider: options['--provider'] || retrieval.readPolicy(context).defaultProvider };
    let result;
    if (action === 'preview') result = retrieval.preview(context, undefined, embeddingOptions);
    else if (action === 'export') result = retrieval.exportBundle(context, embeddingOptions);
    else if (action === 'build') result = await retrieval.build(context, { ...embeddingOptions, approve: options['--approve'] });
    else if (action === 'install-index' || action === 'remove-index') {
        const { selectKnowledgeIndex } = require('./refresh-agents-sparse');
        result = selectKnowledgeIndex(context.capabilityRoot, options['--provider'] || 'company', action === 'install-index');
    }
    else if (action === 'query') result = await retrieval.search(context, options['--query'], {
        ...embeddingOptions,
        domain: options['--domain'], theme: options['--theme'], queryPublic: !!options['--query-public'], localOnly: !!options['--local-only'],
        limit: options['--limit'] === undefined ? undefined : Number(options['--limit']),
        maxChars: options['--max-chars'] === undefined ? undefined : Number(options['--max-chars'])
    });
    else throw new Error('Invalid action');
    console.log(JSON.stringify(result));
}

module.exports = { resolveContext, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
