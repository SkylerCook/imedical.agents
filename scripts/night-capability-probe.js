#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { probeCapabilities } = require('./lib/night-capability');
async function main(argv = process.argv.slice(2)) {
    const args = {};
    for (let i = 0; i < argv.length; i++) { const key = argv[i]; if (!['--profile', '--output'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) throw Error('Use --profile <initial project adapter> --output <private new receipt>'); args[key] = argv[++i]; }
    if (!args['--profile'] || !args['--output']) throw Error('Initial profile and persistent output required');
    const output = path.resolve(args['--output']);
    if (fs.existsSync(output)) throw Object.assign(Error('EEXIST: reuse or review the existing capability receipt'), { code: 'EEXIST' });
    const file = path.resolve(args['--profile']), loaded = require(file), profile = typeof loaded === 'function' ? await loaded({ mode: 'capability-probe' }) : loaded;
    const controller = new AbortController(), cancel = () => controller.abort();
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    let receipt;
    try { receipt = await probeCapabilities(profile, file, { signal: controller.signal }); }
    finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    const body = JSON.stringify(receipt, null, 2) + '\n';
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, body, { flag: 'wx' });
    if (fs.readFileSync(output, 'utf8') !== body) throw Error('Capability receipt readback failed');
    return { output, sha256: crypto.createHash('sha256').update(body).digest('hex'), eligibleDemandIds: receipt.eligibleDemandIds, blockedDemandIds: [...new Set(receipt.requirements.filter(r => !r.executable).map(r => r.demandId))], cleanupVerified: receipt.cleanupVerified };
}
if (require.main === module) main().then(result => { process.stdout.write(JSON.stringify(result) + '\n'); if (!result.cleanupVerified) process.exitCode = 1; }, () => { process.stderr.write('Capability probe unavailable; inspect the protected project adapter and reconcile probe resources.\n'); process.exitCode = 1; });
module.exports = { main };
