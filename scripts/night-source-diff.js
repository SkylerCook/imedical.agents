#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadManifest } = require('./agent-orchestrator');
const { impactDiff } = require('./lib/night-integration');
function main(argv = process.argv.slice(2)) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i+1];
    if (!args['run-directory'] || !args.demand || !args.from) throw new Error('--run-directory --demand --from required');
    const manifest = loadManifest(path.resolve(args['run-directory']));
    const previous = manifest.night.sourceSnapshots?.find(s => s.demandId === args.demand && s.snapshot.frozenVersion === args.from)?.snapshot;
    const current = manifest.night.demands.find(d => d.id === args.demand)?.sourceSnapshot;
    if (!previous || !current) throw new Error('Retained old and current frozen source required');
    const output = JSON.stringify(impactDiff(previous, current), null, 2) + '\n';
    if (args.output) fs.writeFileSync(path.resolve(args.output), output, { flag: 'wx' });
    else process.stdout.write(output);
}
if (require.main === module) try { main(); } catch (error) { process.stderr.write(error.message+'\n');process.exitCode=1; }
module.exports = { main };
