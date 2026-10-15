// Broker CLI: machine mode is isolated from legacy interactive configuration.
'use strict';
const { main, parseArgs, toRequestPath } = require('./debugger-legacy');

const { callBroker } = require('./broker-client');

async function machineMain() {
    // Explicit machine mode never reads private config or waits for interactive answers.
    let bytes = 0;
    const chunks = [];
    const input = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { process.stdin.destroy(); reject(new Error('stdin-timeout')); }, 30000);
        process.stdin.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) { clearTimeout(timer); process.stdin.destroy(); reject(new Error('stdin-too-large')); }
            else chunks.push(chunk);
        });
        process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
        process.stdin.on('error', () => { clearTimeout(timer); reject(new Error('stdin-error')); });
    });
    const result = await callBroker(JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'transport-ok' ? 2 : 1;
}

if (require.main === module) {
    const machine = process.argv.includes('--json') || process.argv.includes('--stdin');
    const action = machine
        ? (process.argv.includes('--stdin') && process.argv.includes('--json') ? machineMain() : Promise.reject(new Error('stdin-and-json-required')))
        : main();
    action.catch(() => {
        process.stderr.write(machine ? 'Broker machine input or execution failed\n' : 'Broker debug failed\n');
        process.exitCode = 1;
    });
}

module.exports = { callBroker, parseArgs, toRequestPath };
