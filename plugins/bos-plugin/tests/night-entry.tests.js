'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = path.resolve(__dirname, '..');
const root = path.resolve(plugin, '../..');
const read = file => fs.readFileSync(file, 'utf8');

test('night skill routing resolves the shared workflow and retains the ordinary entry', () => {
    const file = path.join(plugin, 'skills/bos-demand-handle/SKILL.md');
    const skill = read(file);
    for (const name of ['bos-demand.workflow.md', 'bos-demand-unattended.workflow.md']) {
        const target = [...skill.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]).find(link => link.endsWith(name));
        assert.ok(target, name);
        assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), target);
    }
    assert.match(skill, /\$bos-demand-handle --night/);
    assert.match(skill, /自然语言/);
    assert.match(skill, /用户无需手填 JSON/);
    assert.match(skill, /不额外授予/);
    assert.match(read(path.join(root, 'workflows/bos-demand.workflow.md')), /普通单需求仍直接执行/);
    assert.match(read(path.join(root, 'workflows/bos-demand-unattended.workflow.md')), /\$bos-demand-handle --night/);
    assert.match(skill, /新批次显式设置 `decisionPolicyReference`/);
    const night = read(path.join(root, 'workflows/bos-demand-unattended.workflow.md'));
    // Ordinary and unattended routing must reach the same canonical section.
    const domainLink = [...night.matchAll(/\]\(([^)]+)\)/g)]
        .map(match => match[1]).find(link => link.endsWith('#编码体系选择'));
    assert.ok(domainLink, 'shared domain routing link');
    const [domainFile, anchor] = domainLink.split('#');
    assert.ok(read(path.resolve(root, 'workflows', domainFile)).split(/\r?\n/).includes('### ' + anchor));
    assert.match(night, /workspacePreflightReferences/);
    assert.match(night, /kind:"quota"/);
    assert.match(night, /其它宿主显式使用 `enabled:false`/);
});

test('night route is discoverable without inventing a BOS executable command', () => {
    const manifest = JSON.parse(read(path.join(plugin, '.agents-plugin/plugin.json')));
    assert.ok(manifest.defaultPrompt.some(prompt => prompt.includes('$bos-demand-handle --night')));
    for (const file of ['AGENTS.md', 'README.md']) assert.match(read(path.join(plugin, file)), /\$bos-demand-handle --night/);
    assert.match(read(path.join(plugin, 'skills/bos-demand-handle/SKILL.md')), /不是交给 BOS 查询脚本的 CLI 参数/);
});
