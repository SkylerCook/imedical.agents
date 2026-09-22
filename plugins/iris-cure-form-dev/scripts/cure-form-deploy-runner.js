'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DeploymentBudget, selectDeployment } = require('./cure-form-deployment-policy');
const { writeHandoff } = require('./cure-form-manual-handoff');
const { privateRoot, formRoot } = require('./cure-form-workspace');

async function deploy({ packages, outputRoot, mode = 'manual', operator, reason, confirmWrite = false, executeCommand, budgetOptions }, validatePackage) {
  selectDeployment({ mode });
  const inputs = packages.map((file) => ({ file: path.resolve(file), value: validatePackage(JSON.parse(fs.readFileSync(file, 'utf8')), false) }));
  if (!inputs.length) throw new Error('No deployment packages.');
  if (new Set(inputs.map(({ value }) => value.mapCode)).size !== inputs.length) throw new Error('Duplicate Map in deployment batch.');
  const workspace = { workRoot: outputRoot };
  const handoffs = inputs.map(({ value }) => writeHandoff(value, path.join(formRoot(workspace, value.mapCode), 'manual-deploy')));
  if (mode === 'manual') return { status: 'manual-ready', serverWrite: false, handoffs };
  if (!confirmWrite || !operator || !reason) throw new Error('Automatic deployment requires --confirm-write, operator and reason.');
  const reportPath = path.join(privateRoot(workspace), 'deployment', 'deployment-result.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  if (fs.existsSync(reportPath)) throw new Error('Use a new output directory; preserve the previous deployment result.');
  const budget = new DeploymentBudget(budgetOptions);
  const report = { schema: 'cure-form-deployment-result/v1', status: 'running', startedAt: budget.startedAt, handoffs, operations: [] };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  save();
  let active;
  const invoke = async (args, writing) => {
    budget.check();
    budget.writeStarted = writing;
    if (writing) { active.status = 'write-outcome-unknown'; save(); }
    if (executeCommand) return executeCommand(args, writing);
    return new Promise((resolve, reject) => {
    args.push('--work-root', outputRoot);
    const child = spawn(process.execPath, [path.join(__dirname, 'cure-form.js'), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', buffer = '', timedOut = false;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const event = JSON.parse(line);
          if (event.event === 'deployment-progress' && ['chunk-confirmed'].includes(event.stage)) budget.progress();
        } catch { /* Plain diagnostics are not progress. */ }
      }
    });
    const timer = setInterval(() => {
      if (timedOut) return;
      if (budget.remaining() > 0) return;
      timedOut = true;
      // Do not retry or start subsequent Maps. An in-flight server commit may still finish.
      if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else child.kill();
    }, 250);
    child.on('error', (error) => { clearInterval(timer); reject(error); });
    child.on('close', (code) => {
      clearInterval(timer);
      if (timedOut) return reject(new Error(writing ? 'write-outcome-unknown' : 'manual-handoff-required'));
      if (code !== 0) return reject(new Error(stderr || `CLI exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(writing ? 'write-outcome-unknown' : 'Invalid deployment response')); }
    });
    });
  };
  try {
    for (const input of inputs) {
      active = { mapCode: input.value.mapCode, status: 'validating' };
      report.operations.push(active); save();
      await invoke(['apply', '--package', input.file, '--confirm-remote-execution', '--confirm-staging-write'], false);
      budget.progress();
      const applied = await invoke(['apply', '--package', input.file, '--confirm-remote-execution', '--confirm-write', '--operator', operator, '--reason', reason], true);
      if (!applied.result || !applied.result.ok || !applied.result.operationId) throw new Error('Apply did not return a successful operation ID; inspect outcome before retry.');
      active.operationId = applied.result.operationId; active.status = 'applied'; save();
      budget.progress();
      const verified = await invoke(['verify', '--operation-id', active.operationId, '--confirm-remote-execution'], false);
      if (!verified.result || !verified.result.ok) throw new Error('Post-deployment verification failed.');
      active.status = 'verified'; save(); budget.progress();
    }
    report.status = 'verified';
  } catch (error) {
    report.status = active && active.status === 'write-outcome-unknown' ? 'write-outcome-unknown' : 'manual-handoff-required';
    report.error = error.message;
  } finally {
    report.elapsedMs = Date.now() - budget.startedAt;
    save();
  }
  return { ...report, reportPath };
}
module.exports = { deploy };
