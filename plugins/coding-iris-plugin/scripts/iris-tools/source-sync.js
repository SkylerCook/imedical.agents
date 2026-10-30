#!/usr/bin/env node
'use strict';

const core = require('./source-sync-core');
const fs = require('node:fs');
function args(argv) {
    const result = {command: argv[0], files: []};
    const flags = new Set(['confirm-commit', 'confirm-review', 'confirm-local-git', 'confirm-recovery', 'continue']);
    const names = new Set(['project-root', 'phase', 'demand', 'kind', 'environment-alias', 'environment-type', 'development-mode', 'mode', 'baseline-ref', 'map', 'files', 'scope-file', 'plan', 'subject', 'title', 'modification', 'evidence', 'to', 'token', 'resolve-delete', 'accept-partial']);
    const configureNames = new Set(['project-root', 'mode', 'development-mode', 'kind', 'environment-alias', 'environment-type']);
    for (let i = 1; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (result.command === 'configure' && !configureNames.has(key) || result.command !== 'configure' && ['mode', 'development-mode'].includes(key)) throw Error('unknown-source-sync-option');
        if (flags.has(key)) { result[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true; continue; }
        if (!names.has(key) || !argv[i].startsWith('--')) throw Error('unknown-source-sync-option');
        if (key === 'files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) result.files.push(argv[++i]); continue; }
        if (key === 'resolve-delete') { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('missing-source-sync-option-value'); (result.resolveDelete ||= []).push(argv[++i]); continue; }
        if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('missing-source-sync-option-value');
        result[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    }
    if (result.scopeFile) result.files = JSON.parse(fs.readFileSync(result.scopeFile, 'utf8')).files;
    return result;
}
async function main(argv) {
    if (!argv.length || argv.includes('--help')) {
        console.log('source-sync.js configure --project-root <workspace> --mode DryRun|Write|Check [--development-mode connected|offline] [--kind standard|project] [--environment-alias <confirmed-alias>] [--environment-type test|development|production]\nconfigure creates missing private configuration only; existing values and bytes are preserved. Check and DryRun never write. Remote qualification remains pending; no source baseline, Git repository or remote connection is created.');
        console.log('source-sync.js init --project-root <workspace> --confirm-local-git\nsource-sync.js plan --project-root <workspace> --phase before-edit|pre-deploy|initial-baseline --environment-alias <alias> --environment-type test|production --demand <id> --files <logical-path...> [--baseline-ref <trusted-ref>] [--scope-file <json>] [--map <ProjectItem.xml>]\nsource-sync.js prepare --plan <plan.json>\nsource-sync.js apply|continue --plan <plan.json> --confirm-commit [--subject <subject>] [--modification <text>]\nsource-sync.js review --plan <plan.json> --confirm-review --evidence <review-reference>\nsource-sync.js finish --plan <plan.json> --confirm-review --confirm-commit --evidence <review-reference> [--continue]\nsource-sync.js rollback-plan --project-root <workspace> --demand <id> --to <commit> --files <logical-path...>\nsource-sync.js rollback-local --plan <plan.json> --confirm-commit [--continue]\nsource-sync.js recover-lock --plan <plan.json> --confirm-recovery --token <lock-token> --evidence <local-evidence-file>\nsource-sync.js status|verify --plan <plan.json>\nplan is local only; prepare reads remote; apply commits locally and never deploys. No content change means no empty commit.');
        console.log('Project branch only: supply --kind project or a confirmed project demand default. contextMode does not select demand kind. A deletion conflict is resolved with continue --resolve-delete <logical-path> after review.');
        console.log('An initial partial baseline applies only verified fetched files; review excludedReadItems and pass --accept-partial <partialAcceptanceToken>. Missing daily documents never silently delete local source.');
        return;
    }
    const input = args(argv); let result;
    switch (input.command) {
    case 'configure': result = require('./development-config').configure(input); break;
    case 'init': result = core.initialize(input); break;
    case 'plan': result = core.createPlan(input); break;
    case 'prepare': result = await core.prepare(input.plan); break;
    case 'apply': result = core.apply(input.plan, input); break;
    case 'continue': result = core.apply(input.plan, {...input, continue: true}); break;
    case 'review': result = core.review(input.plan, input); break;
    case 'finish': result = await core.finish(input.plan, input); break;
    case 'rollback-plan': result = core.createRollbackPlan(input); break;
    case 'rollback-local': result = core.rollbackLocal(input.plan, input); break;
    case 'recover-lock': result = core.recoverLock(input.plan, input); break;
    case 'verify': result = core.verify(input.plan); break;
    case 'status': result = core.status(input.plan); break;
    default: throw Error('unknown-source-sync-command');
    }
    console.log(JSON.stringify(result));
    if (input.command === 'configure' && !result.configurationReady) process.exitCode = 2;
    if (['needs-user-input', 'failed-or-unknown', 'read-blocked'].includes(result.state)) process.exitCode = 2;
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({schema: core.SCHEMA, status: 'blocked', reason: error.code || error.message, details: error.details || {}})); process.exitCode = 1;
});
module.exports = {main, args};
