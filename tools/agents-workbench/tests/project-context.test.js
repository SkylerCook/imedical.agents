'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { inspectFramework } = require('../src/project-context');

test('reads the independent capability HEAD without executing project code', t => {
  const parent = path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(parent,{recursive:true});
  const root = fs.mkdtempSync(path.join(parent, 'workbench-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capability = path.join(root, '.agents');
  assert.equal(inspectFramework(root).status, 'no-framework');
  fs.mkdirSync(path.join(capability, 'scripts'), {recursive: true});
  fs.writeFileSync(path.join(capability, 'scripts/update-agents.ps1'), 'throw "must never run"');
  assert.equal(inspectFramework(root).status, 'partial');
  const git = (...args) => execFileSync('git', ['-C', capability, ...args], {encoding:'utf8'}).trim();
  git('init', '-q');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture');
  assert.equal(inspectFramework(root).revision, git('rev-parse','HEAD'));
  assert.equal(inspectFramework(root).status, 'unknown-source');
  fs.writeFileSync(path.join(capability,'capability.json'), '{}');
  assert.equal(inspectFramework(root).status, 'invalid-declaration');
});
