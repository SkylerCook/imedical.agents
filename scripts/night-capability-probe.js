#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { probeCapabilities } = require('./lib/night-capability');
async function main(argv = process.argv.slice(2), { createClient } = {}) {
    const args = {};
    for (let i = 0; i < argv.length; i++) { const key = argv[i]; if (!['--profile', '--output'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) throw Error('Use --profile <initial project adapter> --output <private new receipt>'); args[key] = argv[++i]; }
    if (!args['--profile'] || !args['--output']) throw Error('Initial profile and persistent output required');
    const output = path.resolve(args['--output']);
    if (fs.existsSync(output)) throw Object.assign(Error('EEXIST: reuse or review the existing capability receipt'), { code: 'EEXIST' });
    const file = path.resolve(args['--profile']), loaded = require(file), profile = typeof loaded === 'function' ? await loaded({ mode: 'capability-probe' }) : loaded;
    const controller = new AbortController(), cancel = () => controller.abort();
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    let receipt, ownedBody, sealed = false;
    function persist(value) {
        const body = JSON.stringify(value, null, 2) + '\n';
        fs.mkdirSync(path.dirname(output), { recursive: true });
        if (ownedBody === undefined) fs.writeFileSync(output, body, { flag: 'wx' });
        else {
            if (fs.readFileSync(output, 'utf8') !== ownedBody) throw Error('Capability receipt changed outside this probe');
            const temporary = output + '.' + process.pid + '.tmp';
            fs.writeFileSync(temporary, body, { flag: 'wx' });
            try { fs.renameSync(temporary, output); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        }
        if (fs.readFileSync(output, 'utf8') !== body) throw Error('Capability receipt readback failed');
        ownedBody = body; return body;
    }
    try { receipt = await probeCapabilities(profile, file, { signal: controller.signal, createClient, onProgress: async progress => {
        if (sealed) throw Error('Capability receipt already finalized');
        persist({ schema: 'night-capability-probe/v1', checkedAt: new Date().toISOString(), cleanupVerified: false, operationExited: false, eligibleDemandIds: [], requirements: [], checks: [], ...progress });
    } }); }
    finally { sealed = true; process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    const body = persist(receipt);
    return { output, sha256: crypto.createHash('sha256').update(body).digest('hex'), eligibleDemandIds: receipt.eligibleDemandIds, blockedDemandIds: [...new Set(receipt.requirements.filter(r => !r.executable).map(r => r.demandId))], gaps: receipt.requirements.filter(r => !r.executable).map(({ demandId, role, caseId, gaps, blockers }) => ({ demandId, role, ...(caseId ? { caseId } : {}), gaps, blockers })), cleanupVerified: receipt.cleanupVerified };
}
if (require.main === module) main().then(result => { process.stdout.write(JSON.stringify(result) + '\n'); if (!result.cleanupVerified) process.exitCode = 1; }, () => { process.stderr.write('Capability probe unavailable; inspect the protected project adapter and reconcile probe resources.\n'); process.exitCode = 1; });
module.exports = { main };
