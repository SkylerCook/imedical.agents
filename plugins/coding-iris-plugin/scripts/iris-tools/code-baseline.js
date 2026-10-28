#!/usr/bin/env node
'use strict';

const core = require('./code-baseline-core');
const HELP = 'code-baseline.js plan --project-root <workspace> --baseline <ProjectItem.xml> --out <source-snapshot-root> [--previous-plan <plan.json>] [--type CLS,CSP] [--prefix <name>] [--environment-alias <alias>] [--profile safe|balanced|fast] [--sessions <n>] [--interval-ms <ms>]\ncode-baseline.js capture|resume|status --plan <plan.json>\ncode-baseline.js qualify --plan <plan.json> --confirm --budget-ms <milliseconds>\ncode-baseline.js accept-partial --plan <plan.json> --confirm --token <summary-token> --evidence <review-reference>\ncode-baseline.js project-plan --project-root <workspace> --baseline <ProjectItem.xml> --phase initial-baseline|before-edit|pre-deploy --environment-alias <alias> --environment-type test|production [--demand <id>]\nplan/status/help are offline. Capture uses the managed read pool and never commits, imports or deploys. Images are excluded and fully reported. A version XML selects documents; fetched source is from the configured instance now. Existing unrelated content is never overwritten. Qualification needs task authorization and a fixed budget; its receipt stays pending until real shutdown/resource evidence is reviewed. project-plan delegates to existing source-sync; later commit and deployment require their own authorization.';

function parseArgs(argv) {
    const result = {command: argv[0]};
    const values = new Set(['project-root', 'baseline', 'out', 'previous-plan', 'type', 'prefix', 'environment-alias', 'environment-type', 'sessions', 'interval-ms', 'budget-ms', 'profile', 'plan', 'token', 'evidence', 'phase', 'demand', 'baseline-ref']);
    for (let index = 1; index < argv.length; index++) {
        const name = argv[index].replace(/^--/, '');
        if (['confirm', 'json'].includes(name)) { result[name] = true; continue; }
        if (!argv[index].startsWith('--') || !values.has(name) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw Object.assign(new Error('baseline-option-invalid'), {code: 'baseline-option-invalid'});
        const value = argv[++index], key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (['sessions', 'intervalMs', 'budgetMs'].includes(key)) {
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
    case 'plan': result = core.createPlan(options); break;
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
