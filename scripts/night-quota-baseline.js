#!/usr/bin/env node
'use strict';

// Persist once before approving a PLAN. Restarts refer to this same artifact;
// an account snapshot is an observation, never permission to increase a budget.
const fs = require('node:fs');
const path = require('node:path');
const { createWeeklyBaseline } = require('./lib/night-quota');
function createBaseline({ snapshot, policy, budgetId, authorizationReference, now = Date.now() }) {
    if (typeof authorizationReference !== 'string' || !authorizationReference.trim()) throw new Error('Referenced user budget authorization required');
    return { ...createWeeklyBaseline(snapshot, policy, { now, budgetId }), recordedAt: new Date(now).toISOString(), authorizationReference };
}
function main(argv = process.argv.slice(2)) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
        if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error('Expected --snapshot --policy --budget-id --authorization-ref --output');
        args[argv[i].slice(2)] = argv[i + 1];
    }
    if (!args.snapshot || !args.policy || !args.output) throw new Error('snapshot, policy and output required');
    const baseline = createBaseline({ snapshot: JSON.parse(fs.readFileSync(args.snapshot, 'utf8')), policy: JSON.parse(fs.readFileSync(args.policy, 'utf8')), budgetId: args['budget-id'], authorizationReference: args['authorization-ref'] });
    const output = path.resolve(args.output);
    fs.writeFileSync(output, JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ output, budgetId: baseline.budgetId, recordedAt: baseline.recordedAt }) + '\n');
}
if (require.main === module) try { main(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
module.exports = { createBaseline, main };
