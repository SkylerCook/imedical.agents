'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { withVerifiedPackage, releaseRef } = require('../build/build-offline-package');
const deployment = require('../../../scripts/lib/plugin-deployment');
const { runOwnerPowerShell } = require('./owner-powershell');

const stagedScripts = path.resolve(__dirname, '../../../scripts');
const actions = new Set(['preview', 'install', 'apply']);
const isLocalPath = value => typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value);
const runPicker = promisify(execFile);
const picker = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Select-File($title, $filter) {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    try {
        $dialog.Title = $title
        $dialog.Filter = $filter
        $dialog.CheckFileExists = $true
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
    } finally { $dialog.Dispose() }
}
$record = Select-File '选择从批准渠道另行获取的离线发行记录' '发行记录 (*.json)|*.json'
if (-not $record) { exit }
$bundle = Select-File '选择对应的 capability.bundle' '离线能力包 (capability.bundle)|capability.bundle'
if (-not $bundle) { exit }
$result = @{ releaseRecord = $record; bundle = $bundle } | ConvertTo-Json -Compress
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result))
`;
const ownerDiagnostics = [
    ['requires a clean capability checkout', 'pull-blocked-dirty'],
    ['cannot fast-forward', 'pull-blocked-diverged'],
    ['unrecognized offline framework execution tree', 'unknown-tree'],
    ['unrecognized framework execution tree', 'unknown-tree'],
    ['does not match the approved revision', 'revision-mismatch'],
    ['missing or invalid git objects', 'offline-objects-missing'],
    ['sparse-refresh-failed', 'sparse-refresh-failed']
];

function localDirectory(value) {
    if (!isLocalPath(value) || !fs.lstatSync(value, { throwIfNoEntry: false })?.isDirectory()) throw Error('offline-local-directory-required');
    const resolved = fs.realpathSync.native(value);
    if (!isLocalPath(resolved)) throw Error('offline-local-directory-required');
    return resolved;
}

function localFile(value) {
    if (!isLocalPath(value) || !fs.lstatSync(value, { throwIfNoEntry: false })?.isFile()) throw Error('offline-local-file-required');
    const file = fs.realpathSync.native(value);
    if (!isLocalPath(file)) throw Error('offline-local-file-required');
    return file;
}

async function pickOfflinePackage() {
    if (process.platform !== 'win32') throw Error('unsupported-platform');
    const systemRoot = process.env[Object.keys(process.env).find(name => /^systemroot$/i.test(name))];
    const shell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const encoded = Buffer.from(picker, 'utf16le').toString('base64');
    try {
        const { stdout } = await runPicker(shell, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
            cwd: path.dirname(shell), windowsHide: true, maxBuffer: 32 * 1024
        });
        return stdout.trim() ? JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8')) : null;
    } catch { throw Error('offline-picker-unavailable'); }
}

function readSelection({ releaseRecord, bundle }) {
    const recordFile = localFile(releaseRecord);
    const bundleFile = localFile(bundle);
    if (path.basename(bundleFile).toLowerCase() !== 'capability.bundle') throw Error('offline-bundle-name-invalid');
    const directory = path.dirname(bundleFile);
    const relative = path.relative(directory, recordFile);
    if (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`)) throw Error('offline-release-record-not-independent');
    let record;
    try {
        if (fs.statSync(recordFile).size > 16 * 1024) throw Error();
        record = JSON.parse(fs.readFileSync(recordFile, 'utf8').replace(/^\uFEFF/, ''));
    } catch { throw Error('offline-release-record-invalid'); }
    if (record?.schema !== 'imedical-agents-offline-bundle/v1' || record.bundle !== 'capability.bundle' ||
        record.objectFormat !== 'sha1' || typeof record.ref !== 'string' || !record.ref.startsWith('refs/heads/') ||
        !/^[a-f0-9]{40}$/.test(record.revision) || !/^[a-f0-9]{64}$/.test(record.sha256)) throw Error('offline-release-record-invalid');
    return { bundleDirectory: directory, release: { ref: record.ref, revision: record.revision, sha256: record.sha256 } };
}

function ownerScript(install) {
    const file = path.join(stagedScripts, install ? 'install-agents.ps1' : 'update-agents.ps1');
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() ||
        path.relative(file, fs.realpathSync.native(file)) !== '') throw Error('offline-staged-owner-missing');
    return file;
}

function preserveCheckoutEncoding(project, tools, env) {
    if (!isLocalPath(tools.gitExe) || !fs.lstatSync(tools.gitExe, { throwIfNoEntry: false })?.isFile()) throw Error('offline-git-unavailable');
    const configEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_CONFIG/i.test(key)));
    const count = Number(env.GIT_CONFIG_COUNT ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw Error('offline-git-config-unavailable');
    let next = count;
    // The offline merge uses the installed checkout's native line-ending rules. Keep other protected Git settings.
    for (const [key, type, accepted] of [
        ['core.autocrlf', 'bool-or-str', ['true', 'false', 'input']],
        ['core.eol', null, ['native', 'lf', 'crlf']]
    ]) {
        const result = spawnSync(tools.gitExe, ['--no-optional-locks', '-C', path.join(project, '.agents'),
            'config', ...(type ? [`--type=${type}`] : []), '--get', key], { env: configEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 });
        if (result.status === 1) continue;
        const value = result.stdout?.trim().toLowerCase();
        if (result.status !== 0 || !accepted.includes(value)) throw Error('offline-git-config-unavailable');
        env[`GIT_CONFIG_KEY_${next}`] = key;
        env[`GIT_CONFIG_VALUE_${next}`] = value;
        next++;
    }
    if (next !== count) env.GIT_CONFIG_COUNT = String(next);
}

function runOwner({ action, project, repository, approved, before, release, tools, lease, observe }) {
    const install = action === 'install';
    const args = install ? { RepositorySource: repository } : { ProjectRoot: project,
        Mode: action === 'preview' ? 'DryRun' : 'Write', UpdateSource: repository };
    const env = Object.fromEntries(Object.entries(tools.env).filter(([key]) =>
        !/^(IMEDICAL_DEPLOYMENT_LOCK|GIT_ALLOW_PROTOCOL|GIT_NO_LAZY_FETCH|GIT_NO_REPLACE_OBJECTS|GIT_TERMINAL_PROMPT)$/i.test(key)));
    Object.assign(env, { GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' });
    if (!install) preserveCheckoutEncoding(project, tools, env);
    if (lease) env.IMEDICAL_DEPLOYMENT_LOCK = lease.token;
    const result = runOwnerPowerShell(tools.ps, ownerScript(install), {
        ...args, ExpectedRevision: release.revision, TrustedRuntimeTree: approved,
    }, { cwd: project, env });
    const after = observe(project);
    const receipt = { action, before, after, approvedRevision: release.revision, exitCode: result.status };
    if (result.status !== 0) {
        const output = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
        const diagnostic = ownerDiagnostics.find(([message]) => output.includes(message))?.[1];
        return { ...receipt, error: 'offline-owner-failed', ...(diagnostic && { diagnostic }) };
    }
    const expected = action === 'preview' ? before.revision : release.revision;
    if (after.status !== 'standard' || after.revision !== expected ||
        (!install && after.binding !== before.binding)) return { ...receipt, error: 'offline-result-mismatch' };
    return receipt;
}

// release and trustedRuntime come from the server's independent approval record, never the selected directory.
// observe/verifyRuntime/tool paths are trusted Workbench service callbacks, not request fields.
async function execute({ action, root, bundleDirectory, release, expectedRevision, expectedBinding },
    { trustedRuntime, observe, verifyRuntime, tools }) {
    if (process.platform !== 'win32') throw Error('unsupported-platform');
    if (!actions.has(action)) throw Error('offline-action-unsupported');
    if (!isLocalPath(tools.ps) || !fs.lstatSync(tools.ps, { throwIfNoEntry: false })?.isFile()) throw Error('offline-powershell-unavailable');
    const project = localDirectory(root);
    const directory = localDirectory(bundleDirectory);
    const candidate = release?.revision;
    const digest = trustedRuntime.get(candidate);
    if (!/^[a-f0-9]{40}$/.test(candidate) || !/^[a-f0-9]{64}$/.test(digest)) throw Error('offline-revision-unapproved');
    const install = action === 'install' || (action === 'preview' && expectedRevision === null);
    if (install && release.ref !== releaseRef) throw Error('offline-install-release-branch-required');
    const cap = path.join(project, '.agents');
    const readBoundProject = () => {
        const current = observe(project);
        if (current.status !== (install ? 'no-framework' : 'standard') || current.revision !== expectedRevision ||
            typeof expectedBinding !== 'string' || !expectedBinding || current.binding !== expectedBinding) throw Error('binding-changed');
        if (!install && !trustedRuntime.has(current.revision)) throw Error('offline-installed-revision-unapproved');
        return current;
    };
    readBoundProject();
    let verified = false;
    try {
        return await withVerifiedPackage(directory, release, ({ manifest, repository }) => {
            verified = true;
            if (install && action === 'preview') {
                const before = readBoundProject();
                verifyRuntime(repository, manifest.revision, false);
                const after = readBoundProject();
                return { action, before, after, approvedRevision: manifest.revision, exitCode: 0 };
            }
            const approved = `${manifest.revision}:${digest}`;
            let lease;
            try {
                if (!install) lease = deployment.acquireLock(cap, process.pid);
                const before = readBoundProject();
                if (!install) verifyRuntime(cap, before.revision);
                return runOwner({ action, project, repository, approved, before, release: manifest, tools, lease, observe });
            } finally {
                if (lease) deployment.releaseLock(cap, lease.token);
            }
        });
    } catch (error) {
        if (!verified) throw new Error('offline-bundle-invalid', { cause: error });
        throw error;
    }
}

module.exports = { execute, pickOfflinePackage, readSelection };
