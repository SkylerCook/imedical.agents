#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadManifest } = require('./agent-orchestrator');
const { buildNightReport, renderNightReport } = require('./lib/night-report');
function main(argv = process.argv.slice(2)) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--help') return 'Usage: node night-report.js --run-directory <existing-run> [--format json|markdown] [--output <new-file>]';
        if (!['--run-directory', '--format', '--output'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || Object.hasOwn(options, key)) throw new Error(`Invalid report argument: ${key}`);
        options[key] = argv[++i];
    }
    if (!options['--run-directory']) throw new Error('--run-directory is required');
    const directory = path.resolve(options['--run-directory']);
    const manifest = loadManifest(directory);
    const eventFile = path.join(directory, 'events.jsonl');
    const events = fs.existsSync(eventFile) ? fs.readFileSync(eventFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
    const report = buildNightReport(manifest, events);
    const output = options['--output'] ? path.resolve(options['--output']) : null;
    const format = options['--format'] || (output && /\.md$/i.test(output) ? 'markdown' : 'json');
    if (!['json', 'markdown'].includes(format)) throw new Error('Report format must be json or markdown');
    const body = format === 'markdown' ? renderNightReport(report) : JSON.stringify(report, null, 2) + '\n';
    if (!output) return body;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, body, { flag: 'wx', encoding: 'utf8' });
    return JSON.stringify({ schema: 'night-report-output/v1', output, format, runId: report.runId }) + '\n';
}
if (require.main === module) {
    try { process.stdout.write(main()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
