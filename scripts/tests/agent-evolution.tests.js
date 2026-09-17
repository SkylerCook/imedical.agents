"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { record } = require("../validation-evidence.js");
const { createManifest, validateV2 } = require("../agent-orchestrator.js");
const root = path.resolve(__dirname, "../..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codex-agent-evolution-"));
function cli(args, expected = 0) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/agent-orchestrator.js"), ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, expected, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}
function json(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
function init(name, plan) {
  const file = path.join(temporary, `${name}.json`);
  json(file, plan);
  const run = path.join(temporary, name);
  return { run, manifest: cli(["init", "--run-directory", run, "--plan", file]), file };
}
function transition(run, entity, status, extra = [], expected = 0) {
  return cli(["transition", "--run-directory", run, "--entity", entity, "--status", status, ...extra], expected);
}
function accept(run) {
  transition(run, "acceptance", "locally-verified");
  transition(run, "acceptance", "acceptance-pending");
  transition(run, "acceptance", "accepted", ["--actor", "user", "--evidence-ref", "user-confirmation"]);
}
try {
  const business = init("business", { taskKind: "business-demand" });
  assert.equal(business.manifest.feedbackReviewPolicy, "on-signal");
  transition(business.run, "feedback-decision", "skipped", ["--reason", "no-signal"], 1);
  accept(business.run);
  transition(business.run, "feedback-decision", "skipped", [], 1);
  const skipped = transition(business.run, "feedback-decision", "skipped", ["--reason", "no-signal"]);
  assert.equal(skipped.feedbackDecision.skipReason, "no-signal");
  transition(business.run, "verification", "passed");
  transition(business.run, "run", "completed");
  transition(business.run, "acceptance", "implementing");
  const reopened = cli(["status", "--run-directory", business.run]);
  assert.equal(reopened.feedbackDecision.reviewState, "not-eligible");
  assert.equal(reopened.feedbackDecision.skipReason, undefined);
  const old = createManifest({ plan: business.file, runDirectory: business.run });
  delete old.feedbackReviewPolicy;
  old.acceptance = skipped.acceptance;
  old.feedbackDecision = skipped.feedbackDecision;
  assert(validateV2(old, null, false, { skipProjection: true }).some(x => x.includes("skipped")));
  const always = init("always", { taskKind: "business-demand", feedbackReviewPolicy: "always" });
  accept(always.run);
  transition(always.run, "feedback-decision", "skipped", ["--reason", "no-signal"], 1);
  transition(always.run, "feedback-decision", "completed", ["--evidence-ref", "review-summary"]);

  const pending = init("pending", {});
  cli(["message", "--run-directory", pending.run, "--from", "coordinator", "--to", "coordinator", "--type", "note", "--body", "pending"]);
  transition(pending.run, "verification", "passed");
  transition(pending.run, "run", "completed", [], 1);
  assert(cli(["validate", "--run-directory", pending.run, "--final"], 1).issues.some(x => x.includes("pending")));
  assert.notEqual(cli(["status", "--run-directory", pending.run]).status, "completed");
  const failed = init("failed", { workItems: [{ id: "required", status: "failed" }] });
  transition(failed.run, "verification", "passed");
  transition(failed.run, "run", "completed", [], 1);

  for (const adapter of ["session", "codex-session"]) {
    const sample = init(adapter, { orchestrationMode: "multi-session", adapter, adapterCapabilities: { [adapter]: true }, workItems: [{ id: "read" }] });
    assert.equal(cli(["next", "--run-directory", sample.run])[0].type, "request-authorization");
    transition(sample.run, "authorization", "granted", ["--key", "collaborationPlan", "--actor", "user"]);
    const action = cli(["next", "--run-directory", sample.run]).find(x => x.type === "create-session");
    assert(action);
    const result = path.join(temporary, "ack.json");
    json(result, { actionId: action.id, status: "succeeded", endpointId: "opaque" });
    cli(["ack", "--run-directory", sample.run, "--result", result]);
    cli(["ack", "--run-directory", sample.run, "--result", result]);
  }
  const unknown = init("unknown", { adapter: "imaginary", adapterCapabilities: { imaginary: true, serial: true }, workItems: [{ id: "read" }] });
  assert.equal(cli(["next", "--run-directory", unknown.run])[0].adapter, "serial");
  const blocked = init("blocked", { workItems: [{ id: "remote", maxAttempts: 3 }] });
  const blockedAction = cli(["next", "--run-directory", blocked.run])[0];
  const blockedResult = path.join(temporary, "blocked-ack.json");
  json(blockedResult, { actionId: blockedAction.id, status: "blocked", error: "unknown outcome" });
  cli(["ack", "--run-directory", blocked.run, "--result", blockedResult]);
  assert.equal(cli(["next", "--run-directory", blocked.run]).length, 0);
  transition(blocked.run, "action", "cancelled", ["--id", blockedAction.id], 1);
  transition(blocked.run, "action", "cancelled", ["--id", blockedAction.id, "--actor", "user", "--evidence-ref", "confirmed-no-effect"]);
  transition(blocked.run, "work-item", "pending", ["--id", "remote"]);
  const resumed = cli(["next", "--run-directory", blocked.run])[0];
  assert.notEqual(resumed.id, blockedAction.id);
  assert.equal(cli(["validate", "--run-directory", blocked.run]).valid, true);

  const repo = path.join(temporary, "repo");
  fs.mkdirSync(repo);
  for (const args of [["init"], ["config", "user.name", "Fixture"], ["config", "user.email", "fixture@example.invalid"]]) {
    assert.equal(spawnSync("git", ["-C", repo, ...args], { windowsHide: true }).status, 0);
  }
  fs.writeFileSync(path.join(repo, "code.txt"), "before\n");
  for (const args of [["add", "."], ["commit", "-m", "fixture"]]) assert.equal(spawnSync("git", ["-C", repo, ...args], { windowsHide: true }).status, 0);
  const evidenceFile = path.join(temporary, "evidence.json");
  record(repo, { suite: "fixture", command: "fixture assertion", scopes: ["code.txt"], evidenceFile });
  const evidenceList = path.join(temporary, "bindings.json");
  json(evidenceList, [{ repoRoot: repo, suite: "fixture", evidenceFile }]);
  const unbound = init("unbound", { workItems: [{ id: "edit", writeScopes: ["code.txt"], status: "completed" }] });
  transition(unbound.run, "verification", "passed", ["--verification-file", evidenceList], 1);
  const writer = init("writer", { repositoryRoot: repo, workItems: [{ id: "edit", writeScopes: ["code.txt"], status: "completed" }] });
  transition(writer.run, "verification", "passed", [], 1);
  transition(writer.run, "verification", "passed", ["--verification-file", evidenceList]);
  assert.equal(cli(["validate", "--run-directory", writer.run, "--final"]).valid, true);
  fs.writeFileSync(path.join(repo, "code.txt"), "after\n");
  assert(cli(["validate", "--run-directory", writer.run, "--final"], 1).issues.some(x => x.includes("fingerprint")));
  record(repo, { suite: "fixture", command: "fixture assertion", scopes: ["code.txt"], evidenceFile });
  assert(cli(["validate", "--run-directory", writer.run, "--final"], 1).issues.some(x => x.includes("fingerprint")));
  transition(writer.run, "run", "completed", [], 1);

  const project = path.join(temporary, "project");
  fs.mkdirSync(path.join(project, ".agents/agents/_shared"), { recursive: true });
  fs.copyFileSync(path.join(root, "agents/_shared/execution-guidance.md"), path.join(project, ".agents/agents/_shared/execution-guidance.md"));
  const entry = '\ufeff# Project\r\nCUSTOM: keep exactly\r\n- 按 `.agents/skills/project-context-maintenance/SKILL.md` 判断是否更新 memory、rules、config 或插件入口。\r\n';
  fs.writeFileSync(path.join(project, "AGENTS.md"), entry);
  const migration = path.join(root, "plugins/agent-context-kit/scripts/migrate-execution-entry.js");
  function migrate(extra = []) {
    const result = spawnSync(process.execPath, [migration, "--project-root", project, ...extra], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  assert.equal(migrate().changes.length, 2);
  assert.equal(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), entry);
  migrate(["--write"]);
  const updated = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  assert(updated.startsWith('\ufeff# Project\r\nCUSTOM: keep exactly\r\n'));
  assert(updated.includes('普通修改不例行生成维护材料'));
  assert.equal(migrate(["--write"]).changes.length, 0);
  assert(!fs.existsSync(path.join(project, ".agents/config/project_context_profile.md")));
  assert(updated.includes('.agents/agents/_shared/execution-guidance.md'));
  const { migrateText } = require('../../plugins/agent-context-kit/scripts/migrate-execution-entry.js');
  for (const text of ['# Custom\nUser text', '\ufeff# Custom\r\nUser text\r\n', '<!-- .agents/agents/_shared/execution-guidance.md -->\n']) {
    const planned = migrateText(text);
    assert.equal(planned.changes.length, 1);
    assert(planned.content.startsWith(text));
    assert.equal(migrateText(planned.content).changes.length, 0);
    if (text.includes('\r\n')) assert(!/(?<!\r)\n/.test(planned.content));
  }
  // Unknown custom clauses must block writes without damaging project-owned content.
  fs.mkdirSync(path.join(project, ".agents/config"), { recursive: true });
  const profile = path.join(project, ".agents/config/project_context_profile.md");
  fs.writeFileSync(profile, "custom: keep\r\nguidanceMode: assisted\r\n");
  const profileBefore = fs.readFileSync(profile);
  const custom = updated + "第三个文件由项目负责人复核；保留自定义说明。\r\n";
  fs.writeFileSync(path.join(project, "AGENTS.md"), custom);
  assert(migrate().warnings.length > 0);
  const rejected = spawnSync(process.execPath, [migration, "--project-root", project, "--write"], { encoding: "utf8", windowsHide: true });
  assert.notEqual(rejected.status, 0);
  assert.equal(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), custom);
  assert.deepEqual(fs.readFileSync(profile), profileBefore);
  fs.writeFileSync(path.join(project, "AGENTS.md"), entry);
  fs.unlinkSync(path.join(project, ".agents/agents/_shared/execution-guidance.md"));
  assert(migrate().warnings.some(x => x.includes("missing")));
  const missing = spawnSync(process.execPath, [migration, "--project-root", project, "--write"], { encoding: "utf8", windowsHide: true });
  assert.notEqual(missing.status, 0);
  assert.equal(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), entry);
  assert.deepEqual(fs.readFileSync(profile), profileBefore);

  // Execute the actual updater merge functions under both supported Windows shells.
  if (process.platform === 'win32') {
    const updater = path.join(root, 'scripts/update-agents.ps1').replace(/'/g, "''");
    const template = path.join(root, 'plugins/agent-context-kit/templates/project_context_profile.template.md').replace(/'/g, "''");
    const fixture = path.join(temporary, 'config-merge').replace(/'/g, "''");
    const ps = `$ErrorActionPreference='Stop'
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${updater}',[ref]$null,[ref]$null)
$names=@('Get-RelativePathPortable','Write-UpdateResult','Get-MarkdownConfigEntries','Merge-ConfigTemplate')
foreach($name in $names){$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);Invoke-Expression $fn.Extent.Text}
$dir='${fixture}'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$template='${template}'
foreach($choice in @('unset','auto','concise','assisted')){
 $target=Join-Path $dir ($choice+'.md')
 Copy-Item -LiteralPath $template -Destination $target -Force
 if($choice -ne 'unset'){Add-Content -LiteralPath $target -Encoding UTF8 -Value ('- guidanceMode: '+$choice)}
 $before=[Convert]::ToBase64String([IO.File]::ReadAllBytes($target))
 foreach($mode in @('DryRun','Write','Write','Check')){
  $results=@(Merge-ConfigTemplate -TemplatePath $template -TargetPath $target -ProjectRootFull $dir -PluginName agent-context-kit -Mode $mode)
  if(@($results | Where-Object {$_.reason -eq 'guidanceMode'}).Count){throw 'Optional choice incorrectly reported as missing or deprecated'}
 }
 if([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -ne $before){throw 'User configuration changed'}
 if($choice -eq 'unset' -and (Get-MarkdownConfigEntries $target).ContainsKey('guidanceMode')){throw 'Default was written'}
}
$newTarget=Join-Path $dir 'new.md'
Remove-Item -LiteralPath $newTarget -ErrorAction SilentlyContinue
$null=Merge-ConfigTemplate -TemplatePath $template -TargetPath $newTarget -ProjectRootFull $dir -PluginName agent-context-kit -Mode Write
if((Get-MarkdownConfigEntries $newTarget).ContainsKey('guidanceMode')){throw 'New project default was written'}
Write-Output 'optional guidance merge passed'
`;
    for (const shell of ['powershell.exe','pwsh.exe']) {
      const result = spawnSync(shell, ['-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')], {encoding:'utf8', windowsHide:true});
      assert.equal(result.status,0,result.stdout + result.stderr);
      console.log(shell + ': optional guidance merge passed');
    }
  }
  console.log("agent evolution behavior tests passed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
