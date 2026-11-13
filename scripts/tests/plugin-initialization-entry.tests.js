'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deployment = require('../lib/plugin-deployment');
const { createTempDirectory, ownsTempDirectory } = require('./fixtures/temp-directory');

test('general adoption returns readable owner-relative initialization sources including plugins without initSkill', t => {
    const temporary = createTempDirectory('plugin-initialization-entry-');
    t.after(() => {
        assert.ok(ownsTempDirectory(temporary));
        fs.rmSync(temporary, { recursive: true });
        assert.equal(fs.existsSync(temporary), false);
    });
    const root = path.resolve(__dirname, '../..');
    const contextRoot = path.join(temporary, '.agents');
    fs.mkdirSync(contextRoot);
    const catalog = deployment.catalog(root);
    const selected = deployment.expandSelection(catalog, { groups: ['general'] });
    const result = deployment.plan({ capabilityRoot: root, contextRoot, workspaceRoot: temporary }, selected);
    assert.ok(result.initialization.length > 0);
    const delivery = result.initialization.find(item => item.plugin === 'demand-delivery-plugin');
    assert.ok(delivery, 'The real general group must include demand delivery');
    assert.equal(delivery.skill, null);
    assert.equal(delivery.source, 'plugins/demand-delivery-plugin/AGENTS.md');
    assert.match(fs.readFileSync(path.join(root, delivery.source), 'utf8'), /# Demand Delivery Plugin/);
    for (const item of result.initialization) {
        const owner = deployment.find(catalog, item.plugin);
        assert.ok(item.source.startsWith('plugins/' + owner.directory + '/'), item.plugin);
        const absolute = path.resolve(root, item.source);
        assert.ok(fs.statSync(absolute).isFile(), item.source);
    }
});
