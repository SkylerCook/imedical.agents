'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { planWorkspace, checkWorkspace } = require('../night-workspace');
function runGit(repo, args) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function fixture(t) {
    const parent = process.platform === 'win32' ? 'D:/tmp/Codex' : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'night-workspace-'));
    const business = path.join(root, 'business'), source = path.join(root, 'source'), cap = path.join(root, 'capability');
    for (const dir of [business, source, cap]) fs.mkdirSync(dir);
    for (const repo of [source, cap]) runGit(repo, ['init', '-q']);
    write(path.join(source, 'code.txt'), 'original\n');runGit(source, ['add', 'code.txt']);runGit(source, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    write(path.join(business, '.agents/config/plugin_profile.md'), 'enabled fixture\n');
    write(path.join(business, 'AGENTS.md'), '# Project entrypoint\n');
    fs.mkdirSync(path.join(cap, 'scripts/lib'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../lib/workspace-context.js'), path.join(cap, 'scripts/lib/workspace-context.js'));
    write(path.join(cap, 'scripts/check.js'), "'use strict';\n");
    write(path.join(cap, 'plugins/fixture/skills/check/SKILL.md'), '# Actual skill\n');
    for (const dir of ['vendor', 'agents', 'workflows']) fs.mkdirSync(path.join(cap, dir));
    const request = { businessWorkspace: business, capabilityRoot: cap, batchId: 'batch-1', role: 'developer', roleOwnerId: 'dev', repositories: [{ name: 'backend', sourceRepo: source, ref: runGit(source, ['rev-parse', 'HEAD']) }], requiredSkills: ['check'], requiredScripts: ['scripts/check.js'], contextReferences: [{ path: 'config/plugin_profile.md', source: path.join(business, '.agents/config/plugin_profile.md') }] };
    const targets = [];
    t.after(() => {
        for (const target of targets) if (fs.existsSync(target)) runGit(source, ['worktree', 'remove', '--force', target]);
        assert.equal(path.dirname(root), path.resolve(parent));
        assert.ok(path.basename(root).startsWith('night-workspace-'));
        assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
        fs.rmSync(root, { recursive: true, force: true });
        assert.equal(fs.existsSync(root), false);
    });
    function setup() {
        const plan = planWorkspace(request);
        fs.mkdirSync(path.dirname(plan.repositories[0].target), { recursive: true });
        runGit(source, ['worktree', 'add', '--detach', plan.repositories[0].target, request.repositories[0].ref]); targets.push(plan.repositories[0].target);
        const context = path.join(plan.workspaceRoot, '.agents');
        fs.symlinkSync(path.join(business, 'AGENTS.md'), path.join(plan.workspaceRoot, 'AGENTS.md'), 'file');
        for (const dir of plan.manifest.localDirectories) fs.mkdirSync(path.join(context, dir), { recursive: true });
        write(path.join(context, 'capability.json'), JSON.stringify(plan.manifest));
        for (const dir of plan.manifest.sharedDirectories) fs.symlinkSync(path.join(cap, dir), path.join(context, dir), 'junction');
        fs.mkdirSync(path.join(plan.workspaceRoot, 'src'));
        fs.symlinkSync(plan.repositories[0].target, path.join(plan.workspaceRoot, 'src/backend'), 'junction');
        fs.symlinkSync(request.contextReferences[0].source, path.join(context, 'config/plugin_profile.md'), 'file');
        write(path.join(context, 'skills/check/SKILL.md'), '---\nthin-index: true\nsource: .agents/plugins/fixture/skills/check/SKILL.md\n---\n');
        return plan;
    }
    return { root, business, source, cap, request, setup };
}
test('plan is read-only, defaults under business and carries explicit owner/source/overlay', t => {
    const f=fixture(t), before=runGit(f.source,['status','--porcelain=v1']), plan=planWorkspace(f.request);
    assert.equal(plan.workspaceRoot,path.join(f.business,'.worktrees/batch-1/developer'));
    assert.equal(plan.roleOwnerId,'dev');assert.equal(plan.repositories[0].status,'create');
    assert.equal(fs.existsSync(path.join(f.business,'.worktrees')),false);assert.equal(runGit(f.source,['status','--porcelain=v1']),before);
    assert.equal(checkWorkspace(plan).ok,false);
    const alternate=planWorkspace({...f.request,worktreeRoot:path.join(f.root,'custom')});assert.ok(alternate.workspaceRoot.startsWith(path.join(f.root,'custom')));
});
test('real registered worktree and actual worker cwd resolve shared capability, context and thin skill', t => {
    const f=fixture(t), plan=f.setup();const started=performance.now(),checked=checkWorkspace(plan);t.diagnostic(`Complete fresh-cwd check: ${Math.round(performance.now()-started)} ms`);assert.equal(checked.ok,true,JSON.stringify(checked));
    assert.equal(checked.repositories[0].status,'reuse');
    assert.equal(checked.repositories[0].target,plan.repositories[0].target);
    const mismatch=structuredClone(plan);mismatch.workspaceRoot=f.root;assert.match(checkWorkspace(mismatch).issues.join(' '),/differs from its request/);
    const wrongTarget=structuredClone(plan);wrongTarget.repositories[0].target=f.source;assert.match(checkWorkspace(wrongTarget).issues.join(' '),/differs from its request/);
    fs.unlinkSync(path.join(f.cap,'plugins/fixture/skills/check/SKILL.md'));
    assert.equal(checkWorkspace(plan).ok,false,'a thin index alone is not a reachable skill');
});
test('planning refuses dirty reuse but dispatch check permits task changes and descendant commits', t => {
    const f=fixture(t),plan=f.setup(),target=plan.repositories[0].target;
    write(path.join(target,'code.txt'),'local change\n');assert.throws(()=>planWorkspace(f.request),/dirty/);assert.equal(checkWorkspace(plan).ok,true);assert.equal(fs.readFileSync(path.join(target,'code.txt'),'utf8'),'local change\n');
    runGit(target,['add','code.txt']);runGit(target,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','different']);assert.throws(()=>planWorkspace(f.request),/revision differs/);assert.equal(checkWorkspace(plan).ok,true);
    runGit(target,['checkout','--orphan','unrelated']);runGit(target,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','orphan']);assert.equal(checkWorkspace(plan).ok,false,'an unrelated history cannot count as task progress');
});
test('mismatched original context and invalid scripts fail actual preflight', t => {
    const f=fixture(t),plan=f.setup(),profile=path.join(plan.workspaceRoot,'.agents/config/plugin_profile.md');
    fs.unlinkSync(profile);write(profile,'same-looking local copy\n');assert.match(checkWorkspace(plan).issues.join(' '),/original fact source/);
    fs.unlinkSync(profile);fs.symlinkSync(f.request.contextReferences[0].source,profile,'file');write(path.join(f.cap,'scripts/check.js'),'const broken = ;');assert.match(checkWorkspace(plan).issues.join(' '),/not loadable/);
});
test('path traversal, reserved roles and linked roots cannot redirect creation plan', t => {
    const f=fixture(t);assert.equal(checkWorkspace(null).ok,false);assert.throws(()=>planWorkspace({...f.request,role:'../elsewhere'}),/Safe/);assert.throws(()=>planWorkspace({...f.request,role:'CON'}),/Safe/);
    fs.symlinkSync(f.source,path.join(f.business,'.worktrees'),'junction');assert.throws(()=>planWorkspace(f.request),/traverses a link/);
});
test('an ordinary directory or unrelated git repository is never reused', t => {
    const f=fixture(t),plan=planWorkspace(f.request),target=plan.repositories[0].target;fs.mkdirSync(target,{recursive:true});write(path.join(target,'keep'),'unrelated');assert.equal(checkWorkspace(plan).ok,false);runGit(target,['init','-q']);assert.match(checkWorkspace(plan).issues.join(' '),/another repository/);assert.equal(fs.readFileSync(path.join(target,'keep'),'utf8'),'unrelated');
});
test('configured rules must load and source logical paths cannot silently change', t => {
    const f=fixture(t);f.request.requiredRules=['index.md'];const plan=f.setup();
    assert.equal(checkWorkspace(plan).ok,false);
    write(path.join(plan.workspaceRoot,'.agents/rules/index.md'),'# Project rules\n');assert.equal(checkWorkspace(plan).ok,true);
    plan.manifest.sourceRoots[0].path='src/redirected';
    fs.symlinkSync(plan.repositories[0].target,path.join(plan.workspaceRoot,'src/redirected'),'junction');
    write(path.join(plan.workspaceRoot,'.agents/capability.json'),JSON.stringify(plan.manifest));
    assert.match(checkWorkspace(plan).issues.join(' '),/SourceRoot\/GitRoot differs/);
});
