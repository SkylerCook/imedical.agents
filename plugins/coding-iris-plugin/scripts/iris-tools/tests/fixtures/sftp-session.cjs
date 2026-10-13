// Local protocol fixture; no network or Python dependency.
const readline = require('node:readline');
console.log(JSON.stringify({type: 'ready'}));
readline.createInterface({input: process.stdin}).on('line', line => {
    const request = JSON.parse(line);
    if (request.mode === 'hang') return;
    if (request.mode === 'crash') {
        console.log(JSON.stringify({type: 'file-result', index: 0, result: {file: 'a.js', status: 'uploaded', sha256: 'a', verified: true}}));
        console.log(JSON.stringify({type: 'progress', stage: 'upload', state: 'start', fileIndex: 2, total: 3}));
        console.log(JSON.stringify({type: 'temporary', path: '/web/b.js.imedical-test.tmp', owned: true}));
        process.exitCode = 1;
        process.stdin.destroy();
        return;
    }
    console.error('private diagnostics must not escape');
    console.log(JSON.stringify({type: 'progress', stage: 'compare', state: 'end', fileIndex: 1, total: 1, elapsedMs: 2, password: 'private'}));
    console.log(JSON.stringify({type: 'result', id: request.id, status: 'verified', pid: process.pid,
        transport: {timings: {compare: 2}, counts: {connections: 1}, cleanupPending: []}}));
});
