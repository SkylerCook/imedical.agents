#!/usr/bin/env node
'use strict';

const core = require('./code-baseline-core');
const HELP = [
    'code-baseline.js plan --project-root <workspace> (--baseline <scope.txt> | --scope <path|glob|class-package> [--scope <rule> ...]) --out <source-snapshot-root>',
    'Plan options: [--previous-plan <plan.json>] [--type CLS,CSP] [--prefix <name>] [--environment-alias <alias>] [--profile safe|balanced|fast] [--sessions <n>] [--interval-ms <ms>]',
    'code-baseline.js capture|resume|status --plan <plan.json>',
    'code-baseline.js qualify --plan <plan.json> --confirm --budget-ms <milliseconds>',
    'code-baseline.js accept-partial --plan <plan.json> --confirm --token <summary-token> --evidence <review-reference>',
    'code-baseline.js project-plan --project-root <workspace> --baseline <scope.txt> --phase initial-baseline|before-edit|pre-deploy --environment-alias <alias> --environment-type test|production [--demand <id>]',
    'Exact TXT planning, status and help run locally. Scope planning queries the current server through managed MCP and saves a private exact TXT list for capture and resume.',
    'Capture uses the managed read pool to obtain current source code. It reports excluded images and protects existing content. Qualification requires task authorization and a fixed budget; its receipt stays pending until real shutdown/resource evidence is reviewed.',
    'project-plan delegates to source-sync. Commit and deployment require separate authorization.'
].join('\n');

function parseArgs(argv) {
    const result = {command: argv[0]};
    const values = new Set(['project-root', 'baseline', 'scope', 'out', 'previous-plan', 'type', 'prefix', 'environment-alias', 'environment-type', 'sessions', 'interval-ms', 'budget-ms', 'profile', 'plan', 'token', 'evidence', 'phase', 'demand', 'baseline-ref']);
    for (let index = 1; index < argv.length; index++) {
        const name = argv[index].replace(/^--/, '');
        if (['confirm', 'json'].includes(name)) { result[name] = true; continue; }
        if (!argv[index].startsWith('--') || !values.has(name) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw Object.assign(new Error('baseline-option-invalid'), {code: 'baseline-option-invalid'});
        const value = argv[++index], key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (key === 'scope') {
            if (result.command !== 'plan') throw Error('baseline-scope-option-requires-plan');
            (result.scope ||= []).push(value);
        } else if (['sessions', 'intervalMs', 'budgetMs'].includes(key)) {
            const numeric = Number(value);
            if (!Number.isInteger(numeric) || numeric < (key === 'sessions' ? 1 : 0) || key === 'sessions' && numeric > 20) throw Error('baseline-option-invalid');
            result[key] = numeric;
        } else result[key] = value;
    }
    return result;
}
async function main(argv = process.argv.slice(2)) {
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
    const options = parseArgs(argv); let result;
    switch (options.command) {
    case 'plan': result = options.scope ? await core.createScopedPlan(options) : core.createPlan(options); break;
    case 'capture': result = await core.capture(options.plan); break;
    case 'qualify': result = await core.qualify(options.plan, options); break;
    case 'resume': result = await core.capture(options.plan, {resume: true}); break;
    case 'status': result = core.status(options.plan); result.acceptanceToken = core.acceptanceToken(core.load(options.plan)); break;
    case 'accept-partial': result = core.acceptPartial(options.plan, options); break;
    case 'project-plan': result = core.projectPlan(options); break;
    default: throw Error('baseline-command-invalid');
    }
    console.log(JSON.stringify(result));
    if (options.command !== 'status' && ['blocked', 'interrupted'].includes(result.state)) process.exitCode = 2;
    return result;
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({schema: core.SCHEMA, status: 'blocked', reason: error.code || error.message, details: error.details || {}})); process.exitCode = 1; });
module.exports = {main, parseArgs};
