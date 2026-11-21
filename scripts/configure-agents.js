#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {contextFor} = require('./lib/project-directories');
const config = require('./lib/project-configuration-service');

function main([action,root,mode,applyMode]) {
  if (!['describe','read','plan','apply','verify','migrate','restore'].includes(action) || !root) {
    throw Error('Usage: configure-agents.js describe|read|plan|apply|verify|migrate|restore PROJECT_ROOT');
  }
  const context = contextFor(path.resolve(root));
  if (action === 'describe') return config.describe();
  if (action === 'read') return config.read(context);
  if (action === 'migrate') return config.migrate(context,mode || 'DryRun');
  if (action === 'restore') {
    return require('./lib/project-configuration-migration').restoreSection(context,mode,applyMode || 'DryRun');
  }
  if (action === 'verify') {
    const {sections} = config.read(context);
    require('./lib/iris-selected-target').selected(context,{requireBindings:true});
    const migration = config.migrate(context,'Check');
    const issues = sections.filter(section=>section.conflict).map(({id,conflict})=>({id,conflict}));
    const review = issues.length || migration.some(row=>row.status==='review-required');
    return {status:review ? 'review-required' : migration.length ? 'migration-pending' : 'verified',issues,migration};
  }
  return config[action](context,JSON.parse(fs.readFileSync(0,'utf8')));
}

try { console.log(JSON.stringify(main(process.argv.slice(2)))); }
catch (error) {
  const message = /^[A-Za-z][A-Za-z0-9 .:/_<>|\[\]-]{0,230}$/.test(error.message) ? error.message : 'invalid-or-unrecognized-configuration';
  console.error(message);
  process.exitCode = 1;
}
