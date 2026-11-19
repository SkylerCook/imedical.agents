'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { withLock } = require('./plugin-deployment');

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
Object.assign(env, { GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' });

function git(root, args, failure, raw = false) {
    const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.longpaths=true', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', '-C', root, ...args],
    { env, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (result.status !== 0 || result.error) throw new Error(failure);
    return raw ? result.stdout : result.stdout.toString('utf8').trim();
}

function targetState(target) {
    if (git(target, ['status', '--porcelain=v1'], 'Cannot read the capability checkout status.')) {
        throw new Error('Offline update requires a clean capability checkout.');
    }
    const branch = git(target, ['symbolic-ref', '--quiet', 'HEAD'], 'Offline update requires a checked-out release branch.');
    const upstream = git(target, ['rev-parse', '--verify', '@{upstream}'], 'Offline update requires a resolvable branch upstream.');
    const revision = git(target, ['rev-parse', '--verify', 'HEAD^{commit}'], 'Cannot resolve the installed capability revision.');
    const remoteRef = git(target, ['config', '--local', '--get-all', `branch.${branch.slice('refs/heads/'.length)}.merge`],
        'Cannot resolve the upstream release branch.');
    return { branch, revision, upstream, remoteRef };
}

function verifySource(source, state, expected, approved) {
    if (source.startsWith('\\\\')) throw new Error('Offline capability source must be on a local filesystem.');
    if (!fs.lstatSync(source, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Select a local bare Git repository.');
    const bare = git(source, ['rev-parse', '--is-bare-repository'], 'Select a local bare Git repository.');
    const gitDir = git(source, ['rev-parse', '--absolute-git-dir'], 'Cannot resolve the offline capability Git directory.');
    if (bare !== 'true' || path.relative(fs.realpathSync.native(source), fs.realpathSync.native(gitDir)) !== '') {
        throw new Error('Select the offline bare Git repository itself.');
    }
    if (fs.existsSync(path.join(source, 'shallow')) || fs.existsSync(path.join(source, 'objects/info/alternates')) ||
        fs.readdirSync(path.join(source, 'objects/pack')).some(name => name.endsWith('.promisor'))) {
        throw new Error('Offline capability source must contain its own complete Git history and objects.');
    }
    const ref = git(source, ['symbolic-ref', '--quiet', 'HEAD'], 'Offline capability source HEAD must identify its release branch.');
    if (!ref.startsWith('refs/heads/') || ref !== state.remoteRef) throw new Error('Offline capability branch does not match the installed upstream.');
    const revision = git(source, ['rev-parse', '--verify', 'HEAD^{commit}'], 'Cannot resolve the offline capability revision.');
    if (revision !== expected) throw new Error('Offline capability revision does not match the approved revision.');
    const tree = git(source, ['ls-tree', '-r', '-z', revision, '--', 'scripts', 'plugins', 'vendor', 'hooks'],
        'Cannot inspect the offline framework execution tree.', true);
    const deployed = tree.toString('latin1').split('\0').filter(row => row.slice(row.indexOf('\t') + 1) !== 'scripts/install-agents.ps1');
    const digest = crypto.createHash('sha256').update(deployed.join('\0'), 'latin1').digest('hex');
    if (!approved.split(',').includes(`${revision}:${digest}`)) throw new Error('Unrecognized offline framework execution tree.');
    git(source, ['merge-base', '--is-ancestor', state.revision, revision],
        'Offline update cannot fast-forward. The local branch is ahead, diverged, or absent from the offline history.');
    git(source, ['fsck', '--full', '--strict', '--no-reflogs', '--no-dangling', revision],
        'Offline capability source has missing or invalid Git objects.');
    return ref;
}

function importObjects(source, target, ref, revision) {
    const parent = path.join(os.tmpdir(), 'Codex');
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.realpathSync.native(parent);
    const stage = fs.mkdtempSync(path.join(root, 'agents-offline-update-'));
    try {
        const bundle = path.join(stage, 'capability.bundle');
        // Unbundle installs the entire object graph, including blobs a partial checkout may lack.
        // It does not negotiate with a remote or write refspecs or FETCH_HEAD.
        git(source, ['bundle', 'create', '--quiet', bundle, ref], 'Cannot stage the complete offline object graph.');
        const head = git(source, ['bundle', 'list-heads', bundle], 'Cannot read the staged offline bundle reference.');
        if (head !== `${revision} ${ref}`) throw new Error('Offline capability source changed during import.');
        git(target, ['bundle', 'unbundle', bundle], 'Cannot import offline Git objects.');
    } finally {
        if (path.dirname(stage) !== root || !fs.lstatSync(stage, { throwIfNoEntry: false })?.isDirectory()) {
            throw new Error('Offline update staging directory changed.');
        }
        fs.rmSync(stage, { recursive: true, force: true });
    }
}

function main([target, source, mode, expected, approved]) {
    if (!source || !target || !['DryRun', 'Write'].includes(mode) || !/^[a-f0-9]{40}$/.test(expected) || !approved) {
        throw new Error('Offline update requires a target, local source, mode, approved revision and trusted runtime tree.');
    }
    target = path.resolve(target);
    source = path.resolve(source);
    return withLock(target, () => {
        const before = targetState(target);
        const ref = verifySource(source, before, expected, approved);
        const receipt = { oldHash: before.revision, newHash: before.revision, upstreamHash: before.upstream };
        if (mode === 'DryRun') return { ...receipt, status: 'offline-update-planned', reason: `Verified offline target ${expected}. HEAD remains unchanged.` };

        importObjects(source, target, ref, expected);
        const current = targetState(target);
        if (current.branch !== before.branch || current.revision !== before.revision || current.upstream !== before.upstream ||
            current.remoteRef !== before.remoteRef) throw new Error('The capability checkout changed during offline import.');
        if (current.revision !== expected) {
            git(target, ['merge', '--ff-only', '--no-edit', expected], 'Offline fast-forward failed. Inspect the current checkout before retrying.');
        }
        const after = targetState(target);
        if (after.revision !== expected || after.branch !== before.branch || after.upstream !== before.upstream ||
            after.remoteRef !== before.remoteRef) throw new Error('Cannot confirm the offline revision and preserved upstream after update.');
        return { ...receipt, newHash: after.revision, status: before.revision === after.revision ? 'agents-up-to-date' : 'agents-updated',
            reason: 'Verified offline objects imported and existing upstream preserved.' };
    });
}

try {
    process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n');
} catch (error) {
    process.stderr.write(error.code ? `Offline capability file operation failed (${error.code}).\n` : `${error.message}\n`);
    process.exitCode = 1;
}
