'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pluginProfile = require('../../../scripts/lib/project-plugin-profile');
const { databasePath, bundlePath } = require('../../../scripts/lib/knowledge-retrieval');
const { safeFile } = require('../../../scripts/lib/knowledge-sources');
const { readReceipts, validReceiptId } = require('../../ai-dev-offline/configure-project');
const { inspectClients } = require('./agent-handoff');

const receiptStates = new Set(['prepared', 'applied', 'rolling-back', 'rolled-back', 'reverted-after-failure', 'reverted-after-interruption']);

function pluginCounts(contextRoot) {
    try {
        const { canonical, entries, exists } = pluginProfile.read(contextRoot);
        const counts = { available: 0, enabled: 0, disabled: 0 };
        for (const { status } of Object.values(entries)) counts[status]++;
        return { profile: canonical ? 'jsonc' : exists ? 'legacy-markdown' : 'absent', counts };
    } catch { return { profile: 'unreadable' }; }
}

function indexPresent(capabilityRoot, file) {
    try { return fs.lstatSync(safeFile(capabilityRoot, path.relative(capabilityRoot, file))).isFile(); }
    catch { return false; }
}

function exportProjectState(workspaceRoot, { layout, revision, contextRoot, capabilityRoot }) {
    const { receipts, receiptIssue } = readReceipts(workspaceRoot);
    const knowledge = {
        scope: layout === 'overlay' ? 'shared-capability' : capabilityRoot ? 'local-capability' : 'none',
        indexes: capabilityRoot ? ['openai', 'company', 'local'].map(provider => {
            const context = { capabilityRoot };
            return {
                provider,
                cachePresent: indexPresent(capabilityRoot, databasePath(context, { provider })),
                bundlePresent: indexPresent(capabilityRoot, bundlePath(context, { provider })),
            };
        }) : [],
    };
    return {
        schema: 'agents-workbench-state/v1',
        observedAt: new Date().toISOString(),
        framework: { layout, revision },
        plugins: pluginCounts(contextRoot),
        hosts: inspectClients(workspaceRoot).map(({ id, entries }) => ({ id, entryObserved: entries.length > 0 })),
        knowledge,
        configuration: {
            receipts: receipts.filter(row => validReceiptId(row.id) && receiptStates.has(row.state))
                .map(({ id, state, files, updated }) => ({ id, state, files, updated })),
            receiptIssue: Boolean(receiptIssue),
        },
    };
}

module.exports = { exportProjectState };
