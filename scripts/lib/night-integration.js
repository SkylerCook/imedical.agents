'use strict';

// Frozen sources and impact reviews are artifacts of the existing run. Local
// worktrees remain writable; only publication of a shared target is ordered.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = value => digest(Buffer.from(JSON.stringify(value)));
const text = value => typeof value === 'string' && value.trim().length > 0;
const refs = value => Array.isArray(value) && value.length > 0 && value.every(text);
const physical = value => fs.realpathSync.native(path.resolve(value));
const same = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const enabled = manifest => manifest.executionPlan?.version === 1;
function git(root, args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim(); }
function commonDirectory(root) { return physical(path.resolve(root, git(root, ['rev-parse', '--git-common-dir']))); }
function under(root, file) { const rel = path.relative(root, file); return rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
function noLinks(file, stop) {
    let current = path.resolve(file);
    while (under(stop, current)) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Frozen artifact path traverses a link');
        current = path.dirname(current);
    }
}
function logicalSourceMatches(leftRoot, rightRoot) { try { return same(commonDirectory(leftRoot), commonDirectory(rightRoot)); } catch { return false; } }
function integrationCovers(manifest, record, originalRoot, scope) {
    if (!enabled(manifest) || !record.integrationBinding) return false;
    const binding = record.integrationBinding, planned = manifest.executionPlan.integration;
    if (planned.strategy === 'review-only' || binding.ownerId !== planned.ownerId || !same(binding.repositoryRoot, planned.targetRepo)) return false;
    return record.sourceScopes?.some(source => same(source.repoRoot, binding.repositoryRoot) && logicalSourceMatches(originalRoot, source.repoRoot) && source.scopes.some(parent => parent === '.' || scope === parent || scope.startsWith(parent + '/')));
}
function listFiles(source) {
    const raw = execFileSync('git', ['-C', source.repoRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...source.scopes], { windowsHide: true, stdio: 'pipe' });
    const files = new Set(raw.toString('utf8').split('\0').filter(Boolean));
    for (const relative of source.scopes) if (relative !== '.' && fs.existsSync(path.join(source.repoRoot, relative)) && fs.lstatSync(path.join(source.repoRoot, relative)).isFile()) files.add(relative);
    return [...files].sort().filter(relative => fs.existsSync(path.join(source.repoRoot, relative)));
}
function freezeSources(record, runDirectory, liveSources) {
    if (!record.assessment?.post) throw new Error('Source freeze requires the independent post assessment');
    const before = liveSources({ ...record, sourceSnapshot: undefined });
    if (before.frozenVersion !== record.frozenVersion) throw new Error('Source changed before freeze');
    const run = physical(runDirectory), root = path.join(run, 'evidence', 'frozen-sources', hash([record.id, before.frozenVersion]));
    noLinks(root, run); fs.mkdirSync(root, { recursive: true });
    const files = [];
    for (const source of before.sources) {
        const names = listFiles(source);
        if (!names.length) throw new Error('Frozen source scope has no files');
        for (const relative of names) {
            if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || /(^|\/)(?:\.git|\.agents|\.mcp\.json|\.env(?:\..*)?)($|\/)/i.test(relative.replace(/\\/g, '/'))) throw new Error('Private configuration is outside frozen business sources');
            const original = path.join(source.repoRoot, relative), stat = fs.lstatSync(original);
            if (!stat.isFile()) throw new Error('Frozen business sources must be regular files');
            const bytes = fs.readFileSync(original), artifact = path.join(hash(source.repoRoot).slice(0, 20), relative), target = path.join(root, artifact);
            if (!under(root, target)) throw new Error('Frozen source escaped artifact root');
            noLinks(target, run); fs.mkdirSync(path.dirname(target), { recursive: true });
            if (fs.existsSync(target)) { if (!fs.lstatSync(target).isFile() || digest(fs.readFileSync(target)) !== digest(bytes)) throw new Error('Immutable frozen source artifact differs'); }
            else fs.writeFileSync(target, bytes, { flag: 'wx' });
            files.push({ repoRoot: source.repoRoot, relative, artifact, sha256: digest(bytes), length: bytes.length, executable: stat.mode & 0o111 });
        }
    }
    if (liveSources({ ...record, sourceSnapshot: undefined }).frozenVersion !== before.frozenVersion) throw new Error('Source changed while freezing');
    return { schema: 'night-frozen-sources/v1', root, ...before, files, createdAt: new Date().toISOString() };
}
function frozenSources(record) {
    const snapshot = record.sourceSnapshot;
    if (snapshot?.schema !== 'night-frozen-sources/v1' || !path.isAbsolute(snapshot.root || '') || !snapshot.files?.length) throw new Error('Invalid frozen sources');
    const sources = snapshot.sources.map(source => {
        const parts = [Buffer.from(`content-v2\0${source.scopes.join('\0')}\0`)];
        for (const entry of snapshot.files.filter(f => same(f.repoRoot, source.repoRoot)).sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0)) {
            const target = path.resolve(snapshot.root, entry.artifact);
            if (!under(snapshot.root, target)) throw new Error('Frozen artifact escaped its root');
            noLinks(target, path.dirname(snapshot.root));
            if (!fs.lstatSync(target).isFile()) throw new Error('Frozen artifact is not a regular file');
            const content = fs.readFileSync(target);
            if (digest(content) !== entry.sha256 || content.length !== entry.length) throw new Error('Frozen artifact changed');
            parts.push(Buffer.from(`${entry.relative}\0file\0${entry.executable}\0${content.length}\0`), content);
        }
        const fingerprint = digest(Buffer.concat(parts));
        if (fingerprint !== source.fingerprint) throw new Error('Frozen source fingerprint differs');
        return { ...source, fingerprint };
    });
    const scopeFingerprint = hash(sources.map(({ repoRoot, scopes, fingerprint }) => ({ repoRoot, scopes, fingerprint })));
    if (scopeFingerprint !== snapshot.scopeFingerprint || snapshot.frozenVersion !== `content:${scopeFingerprint}`) throw new Error('Frozen source version differs');
    return { scopeFingerprint, frozenVersion: snapshot.frozenVersion, sources };
}
function targetsFor(manifest, item, artifacts = []) {
    if (!enabled(manifest) || item.night.phase !== 'deployment') return [];
    const declared = item.night.deploymentTargets;
    if (!refs(declared)) throw new Error('Execution PLAN deployment requires explicit deploymentTargets');
    if (artifacts.length && (artifacts.some(a => !text(a.targetId)) || hash([...new Set(artifacts.map(a => a.targetId))].sort()) !== hash([...new Set(declared)].sort()))) throw new Error('Actual transport targets differ from approved deploymentTargets');
    return [...new Set(declared)].sort().map(target => hash([item.night.environmentAlias, target]));
}
function publicationReasons(manifest, item, artifacts = []) {
    if (!enabled(manifest) || item.night.phase !== 'deployment') return [];
    const targets = targetsFor(manifest, item, artifacts), record = manifest.night.demands.find(d => d.id === item.night.demandId);
    const reasons = [];
    for (const op of manifest.night.operations || []) {
        if (op.phase !== 'deployment' || !op.targetKeys?.some(k => targets.includes(k))) continue;
        if (op.status === 'running' || op.status === 'review-pending') reasons.push('publication-target-unresolved');
        if (op.status === 'verified' && op.demandId !== record?.id && (manifest.night.operations?.some(v => v.phase === 'verification' && v.demandId === op.demandId && ['running', 'review-pending'].includes(v.status)) || manifest.workItems.some(w => w.night.demandId === op.demandId && w.night.phase === 'verification' && w.status === 'running'))) reasons.push('publication-verification-window');
        if (op.status === 'verified' && op.frozenVersion !== record?.frozenVersion) {
            const old = manifest.night.demands.find(d => d.id === op.demandId);
            const verification = manifest.workItems.filter(w => w.night.demandId === op.demandId && w.night.phase === 'verification');
            if (old?.frozenVersion === op.frozenVersion && !old.candidateReady && verification.some(w => !['completed', 'skipped'].includes(w.status))) reasons.push('publication-verification-window');
        }
    }
    // Serial publication alone cannot preserve an earlier demand's changes.
    // Every affected demand must independently review the same new bytes. Its
    // runtime checks may follow this publication; they are requeued on rebinding.
    if (artifacts.length) {
        const previous = new Map();
        for (const op of manifest.night.operations || []) if (op.phase === 'deployment' && op.status === 'verified' && op.demandId !== record?.id && op.targetKeys?.some(k => targets.includes(k))) {
            for (const artifact of artifacts) if (op.targetKeys.includes(hash([item.night.environmentAlias, artifact.targetId]))) previous.set(`${op.demandId}:${artifact.targetId}`, { op, artifact });
        }
        for (const { op, artifact } of previous.values()) {
            const peer = manifest.night.demands.find(d => d.id === op.demandId);
            const old = manifest.night.sourceSnapshots?.find(s => s.demandId === op.demandId && s.snapshot.frozenVersion === op.frozenVersion)?.snapshot || (peer?.sourceSnapshot?.frozenVersion === op.frozenVersion ? peer.sourceSnapshot : null);
            const published = op.artifacts?.find(a => a.targetId === artifact.targetId);
            const file = old?.files.find(f => published && (same(published.localPath, path.join(old.root, f.artifact)) || same(published.localPath, path.join(f.repoRoot, f.relative))));
            let reviewed = false;
            try {
                if (file && peer?.sourceSnapshot && peer.assessment?.post?.reviewerId !== peer.implementationOwnerId && text(peer.assessment?.post?.reviewerId) && peer.assessment.post.frozenVersion === peer.frozenVersion && peer.assessment.post.scopeFingerprint === peer.scopeFingerprint) {
                    frozenSources(peer);
                    reviewed = peer.sourceSnapshot.files.some(f => f.relative === file.relative && logicalSourceMatches(f.repoRoot, file.repoRoot) && f.sha256 === artifact.sha256);
                }
            } catch { /* Missing or changed joint evidence remains blocked. */ }
            if (!reviewed) reasons.push('publication-joint-source-review-required');
        }
    }
    return [...new Set(reasons)];
}
function sharedPublicationCovers(manifest, operation, item) {
    if (!enabled(manifest) || item.night.phase !== 'deployment' || operation.phase !== 'deployment' || operation.status !== 'verified' || operation.environmentAlias !== item.night.environmentAlias || operation.configurationFingerprint !== manifest.night.preflight?.deploymentConfigFingerprint) return false;
    const record = manifest.night.demands.find(d => d.id === item.night.demandId);
    if (!record?.sourceSnapshot || record.frozenVersion !== operation.frozenVersion) return false;
    try { return targetsFor(manifest, item).every(key => operation.targetKeys?.includes(key)); } catch { return false; }
}
function snapshotChanges(before, after) {
    const key = f => `${commonDirectory(f.repoRoot)}:${f.relative}`;
    const old = new Map(before.files.map(f => [key(f), f])), next = new Map(after.files.map(f => [key(f), f]));
    return [...new Set([...old.keys(), ...next.keys()])].sort().filter(k => old.get(k)?.sha256 !== next.get(k)?.sha256 || old.get(k)?.executable !== next.get(k)?.executable).map(k => ({ source: k, before: old.get(k)?.sha256 || null, after: next.get(k)?.sha256 || null }));
}
function impactDiff(before, after) {
    frozenSources({ sourceSnapshot: before }); frozenSources({ sourceSnapshot: after });
    const changes = snapshotChanges(before, after);
    const locate = (snapshot, source) => snapshot.files.find(f => `${commonDirectory(f.repoRoot)}:${f.relative}` === source);
    return { schema: 'night-source-impact/v1', fromVersion: before.frozenVersion, toVersion: after.frozenVersion, changesHash: hash(changes), changes,
        files: changes.map(change => {
            const left = locate(before, change.source), right = locate(after, change.source);
            const original = left ? path.join(before.root, left.artifact) : null, current = right ? path.join(after.root, right.artifact) : null;
            const bytes = file => file ? fs.readFileSync(file) : Buffer.alloc(0);
            const old = bytes(original), next = bytes(current), binary = old.includes(0) || next.includes(0);
            return { source: change.source, beforeArtifact: original, afterArtifact: current, binary,
                ...(binary || old.length + next.length > 4 * 1024 * 1024 ? {} : { beforeText: old.toString('utf8'), afterText: next.toString('utf8') }) };
        }) };
}
function recordIntegration(manifest, input, runDirectory, liveSources) {
    if (!enabled(manifest)) throw new Error('Execution PLAN required for source integration');
    const record = manifest.night.demands.find(d => d.id === input.demandId);
    if (!record) throw new Error('Unknown integration demand');
    manifest.night.sourceSnapshots ||= [];
    if (input.kind === 'source-integrate') {
        const binding = input.integrationBinding, planned = manifest.executionPlan.integration;
        if (!binding || planned.strategy === 'review-only' || binding.ownerId !== planned.ownerId || !same(binding.repositoryRoot, planned.targetRepo) || !text(planned.authorizationReference)) throw new Error('Integration source is outside the approved integration scope');
        if (manifest.night.operations?.some(o => o.demandId === record.id && o.status === 'running')) throw new Error('Cannot integrate an active operation');
        try { git(binding.repositoryRoot, ['merge-base', '--is-ancestor', planned.baseRevision, 'HEAD']); } catch { throw new Error('Integration HEAD is outside the approved fixed base'); }
        if (!record.sourceScopes.some(s => logicalSourceMatches(s.repoRoot, binding.repositoryRoot))) throw new Error('Integration changes source repository identity');
        record.integrationBinding = structuredClone(binding);
        record.sourceScopes = record.sourceScopes.map(s => logicalSourceMatches(s.repoRoot, binding.repositoryRoot) ? { ...s, repoRoot: binding.repositoryRoot } : s);
        const current = liveSources({ ...record, sourceSnapshot: undefined });
        Object.assign(record, current);
        delete record.sourceSnapshot; delete record.automatedResult;
        record.assessment.post = null; record.candidateReady = false;
    } else if (input.kind === 'source-freeze') {
        if (manifest.night.operations?.some(o => o.demandId === record.id && o.status === 'running')) throw new Error('Cannot freeze an active operation');
        if (input.integrationBinding) throw new Error('Use source-integrate then independent post review before source-freeze');
        const snapshot = freezeSources(record, runDirectory, liveSources);
        const old = manifest.night.sourceSnapshots.find(s => s.demandId === record.id && s.snapshot.frozenVersion === snapshot.frozenVersion);
        if (old && hash(old.snapshot.files) !== hash(snapshot.files)) throw new Error('Frozen version already has different artifacts');
        if (!old) manifest.night.sourceSnapshots.push({ demandId: record.id, snapshot });
        record.sourceSnapshot = old?.snapshot || snapshot;
    } else if (input.kind === 'evidence-reuse') {
        const review = input.review, planned = manifest.executionPlan.integration;
        if (!review || !text(review.reviewerId) || review.reviewerId === record.implementationOwnerId || !manifest.participants.some(p => p.id === review.reviewerId) || !refs(review.checkIds) || !Array.isArray(review.affectedChecks) || !refs(review.evidenceRefs)) throw new Error('Evidence reuse needs an independent impact review and checks');
        const previous = manifest.night.sourceSnapshots.find(s => s.demandId === record.id && s.snapshot.frozenVersion === review.fromVersion)?.snapshot;
        if (!previous || !record.sourceSnapshot || review.toVersion !== record.frozenVersion || planned.ownerId === undefined) throw new Error('Impact review needs retained old and current frozen versions');
        frozenSources({ sourceSnapshot: previous }); frozenSources(record);
        const changes = snapshotChanges(previous, record.sourceSnapshot);
        if (review.changesHash !== hash(changes)) throw new Error('Impact review does not match actual source changes');
        if (!path.isAbsolute(review.diffReference || '') || !review.evidenceRefs.includes(review.diffReference) || hash(JSON.parse(fs.readFileSync(review.diffReference, 'utf8'))) !== hash(impactDiff(previous, record.sourceSnapshot))) throw new Error('Impact review requires the actual retained before/after diff artifact');
        if (review.checkIds.some(id => {
            if (review.affectedChecks.includes(id)) return true;
            const plannedTest = manifest.executionPlan.minimumTests.find(t => t.demandId === record.id && t.id === id);
            if (plannedTest && ['internal-method', 'external-api', 'ui'].includes(plannedTest.level)) return !record.testReceipts?.some(r => r.caseId === id && r.status === 'passed' && r.frozenVersion === review.fromVersion && r.level === plannedTest.level && text(r.evidenceRef) && manifest.workItems.find(w => w.id === r.workItemId)?.ownerId === plannedTest.ownerId);
            return !record.checks?.some(c => c.id === id && c.status === 'passed' && c.frozenVersion === review.fromVersion && refs(c.evidenceRefs));
        })) throw new Error('Affected or unproven checks cannot be reused at a stronger test level');
        record.evidenceReuse ||= [];
        const material = { ...structuredClone(review), changes, currentScopeFingerprint: record.scopeFingerprint, at: new Date().toISOString() };
        record.evidenceReuse.push(material);
    } else throw new Error('Unknown integration event');
}
function reusedCheck(record, id) { return record.evidenceReuse?.some(r => r.toVersion === record.frozenVersion && r.currentScopeFingerprint === record.scopeFingerprint && r.checkIds.includes(id) && !r.affectedChecks.includes(id)); }
module.exports = { enabled, commonDirectory, logicalSourceMatches, integrationCovers, freezeSources, frozenSources, targetsFor, publicationReasons, sharedPublicationCovers, snapshotChanges, impactDiff, recordIntegration, reusedCheck, hash };
