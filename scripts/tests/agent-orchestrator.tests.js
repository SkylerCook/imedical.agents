"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createManifest, validateV2, scopeConflict } = require("../agent-orchestrator.js");

const repoRoot = path.resolve(__dirname, "../..");
const cli = path.join(repoRoot, "scripts", "agent-orchestrator.js");

function invoke(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.equal(result.status, expected, `${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agent-orchestrator-"));
try {
  const serialPlan = path.join(temporary, "serial-plan.json");
  writeJson(serialPlan, {
    topic: "parallel read-only fixture",
    workflow: "standard-change",
    executionPath: "fast",
    orchestrationMode: "subagent",
    adapter: "subagent",
    adapterCapabilities: { subagent: true, serial: true, human: true },
    coordinatorId: "coordinator",
    participants: [
      { id: "coordinator", role: "coordinator", endpoint: { type: "serial" } },
      { id: "explorer-a", role: "explorer", endpoint: { type: "subagent" }, readScopes: ["src/a"] },
      { id: "explorer-b", role: "explorer", endpoint: { type: "subagent" }, readScopes: ["src/b"] }
    ],
    workItems: [
      { id: "read-a", title: "Read A", ownerId: "explorer-a", readScopes: ["src/a"], completionCriteria: ["facts"] },
      { id: "read-b", title: "Read B", ownerId: "explorer-b", readScopes: ["src/b"], maxAttempts: 2, completionCriteria: ["facts"] }
    ]
  });
  const serialRun = path.join(temporary, "serial-run");
  const initialized = invoke(["init", "--run-directory", serialRun, "--plan", serialPlan, "--json"]);
  assert.equal(initialized.schemaVersion, "2.0");
  assert.notEqual(initialized.executionPath, initialized.orchestration.mode);
  const firstActions = invoke(["next", "--run-directory", serialRun, "--json"]);
  assert.equal(firstActions.length, 2);
  assert(firstActions.every((action) => action.type === "spawn-subagent"));
  const repeatedActions = invoke(["next", "--run-directory", serialRun, "--json"]);
  assert.deepEqual(repeatedActions.map((item) => item.id), firstActions.map((item) => item.id));
  assert.equal(invoke(["validate", "--run-directory", serialRun, "--json"]).valid, true);
  const serialManifestPath = path.join(serialRun, "00-run-manifest.json");
  const corrupted = JSON.parse(fs.readFileSync(serialManifestPath, "utf8"));
  corrupted.topic = "corrupted projection";
  writeJson(serialManifestPath, corrupted);
  assert.equal(invoke(["validate", "--run-directory", serialRun, "--json"], 1).valid, false);
  const replayedStatus = invoke(["status", "--run-directory", serialRun, "--json"]);
  assert.equal(replayedStatus.projectionRecovered, true);
  assert.equal(replayedStatus.topic, "parallel read-only fixture");

  const resultFile = path.join(temporary, "ack.json");
  writeJson(resultFile, { actionId: firstActions[0].id, status: "succeeded", artifactRefs: ["handoffs/read-a.md"] });
  invoke(["ack", "--run-directory", serialRun, "--result", resultFile, "--json"]);
  invoke(["ack", "--run-directory", serialRun, "--result", resultFile, "--json"]);
  writeJson(resultFile, { actionId: firstActions[0].id, status: "failed", error: "conflict" });
  invoke(["ack", "--run-directory", serialRun, "--result", resultFile, "--json"], 1);

  const message = invoke(["message", "--run-directory", serialRun, "--from", "explorer-a", "--to", "coordinator", "--type", "handoff", "--body", "facts", "--json"]);
  assert(fs.existsSync(path.join(serialRun, message.bodyRef)));
  writeJson(resultFile, { actionId: firstActions[1].id, status: "failed", error: "retryable" });
  invoke(["ack", "--run-directory", serialRun, "--result", resultFile, "--json"]);
  const retry = invoke(["next", "--run-directory", serialRun, "--json"]).find((item) => item.workItemId === "read-b");
  assert.notEqual(retry.id, firstActions[1].id);
  writeJson(resultFile, { actionId: retry.id, status: "succeeded", artifactRefs: ["handoffs/read-b.md"] });
  invoke(["ack", "--run-directory", serialRun, "--result", resultFile, "--json"]);

  const gitFixture = path.join(temporary, "git-fixture");
  fs.mkdirSync(gitFixture);
  git(gitFixture, ["init"]);
  git(gitFixture, ["config", "user.email", "fixture@example.invalid"]);
  git(gitFixture, ["config", "user.name", "Fixture"]);
  fs.writeFileSync(path.join(gitFixture, "README.md"), "fixture\n", "utf8");
  git(gitFixture, ["add", "README.md"]);
  git(gitFixture, ["commit", "-m", "fixture base"]);
  const worktreeA = path.join(temporary, "worktrees", "a");
  const worktreeB = path.join(temporary, "worktrees", "b");
  fs.mkdirSync(path.dirname(worktreeA), { recursive: true });
  git(gitFixture, ["worktree", "add", "--detach", worktreeA, "HEAD"]);
  git(gitFixture, ["worktree", "add", "--detach", worktreeB, "HEAD"]);

  const multiPlan = path.join(temporary, "multi-plan.json");
  writeJson(multiPlan, {
    topic: "isolated worktree fixture",
    taskKind: "business-demand",
    workflow: "standard-change",
    executionPath: "full",
    orchestrationMode: "multi-session",
    adapter: "codex-session",
    adapterCapabilities: { "codex-session": true, serial: true, human: true },
    feedbackReviewApplicable: true,
    feedbackApplicabilityReason: "business-demand",
    coordinatorId: "coordinator",
    participants: [
      { id: "coordinator", role: "coordinator", endpoint: { type: "serial" } },
      { id: "writer-a", role: "coding", endpoint: { type: "codex-session" }, worktree: { mode: "isolated", ref: "worktrees/a" }, writeScopes: ["src/a"] },
      { id: "writer-b", role: "coding", endpoint: { type: "codex-session" }, worktree: { mode: "isolated", ref: "worktrees/b" }, writeScopes: ["src/b"] }
    ],
    workItems: [
      { id: "write-a", ownerId: "writer-a", writeScopes: ["src/a"] },
      { id: "write-b", ownerId: "writer-b", writeScopes: ["src/b"] }
    ]
  });
  const multiRun = path.join(temporary, "multi-run");
  invoke(["init", "--run-directory", multiRun, "--plan", multiPlan, "--json"]);
  const authorizationAction = invoke(["next", "--run-directory", multiRun, "--json"]);
  assert.equal(authorizationAction[0].type, "request-authorization");
  invoke(["transition", "--run-directory", multiRun, "--entity", "authorization", "--key", "collaborationPlan", "--status", "granted", "--actor", "user", "--json"]);
  const sessionActions = invoke(["next", "--run-directory", multiRun, "--json"]);
  assert.equal(sessionActions.filter((item) => item.type === "create-session").length, 2);
  assert.deepEqual(
    sessionActions.filter((item) => item.type === "create-session").map((item) => item.title).sort(),
    ["isolated worktree fixture · coding · write-a", "isolated worktree fixture · coding · write-b"]
  );
  fs.mkdirSync(path.join(worktreeA, "src"), { recursive: true });
  fs.mkdirSync(path.join(worktreeB, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktreeA, "src", "a.txt"), "a\n", "utf8");
  fs.writeFileSync(path.join(worktreeB, "src", "b.txt"), "b\n", "utf8");
  git(worktreeA, ["add", "src/a.txt"]); git(worktreeA, ["commit", "-m", "fixture a"]);
  git(worktreeB, ["add", "src/b.txt"]); git(worktreeB, ["commit", "-m", "fixture b"]);
  for (const action of sessionActions.filter((item) => item.type === "create-session")) {
    writeJson(resultFile, { actionId: action.id, status: "succeeded", endpointId: `fixture-${action.targetId}`, artifactRefs: [`handoffs/${action.targetId}.md`] });
    invoke(["ack", "--run-directory", multiRun, "--result", resultFile, "--json"]);
  }
  const integrationActions = invoke(["next", "--run-directory", multiRun, "--json"]);
  assert.equal(integrationActions.filter((item) => item.type === "prepare-integration" && item.authorizationCategory === "merge").length, 1);
  assert.equal(invoke(["validate", "--run-directory", multiRun, "--json"]).valid, true);

  invoke(["transition", "--run-directory", multiRun, "--entity", "feedback-decision", "--status", "completed", "--json"], 1);
  invoke(["transition", "--run-directory", multiRun, "--entity", "acceptance", "--status", "locally-verified", "--json"]);
  invoke(["transition", "--run-directory", multiRun, "--entity", "acceptance", "--status", "acceptance-pending", "--json"]);
  invoke(["transition", "--run-directory", multiRun, "--entity", "acceptance", "--status", "accepted", "--actor", "coordinator", "--evidence-ref", "messages/no.md", "--json"], 1);
  const acceptedBusinessRun = invoke(["transition", "--run-directory", multiRun, "--entity", "acceptance", "--status", "accepted", "--actor", "user", "--evidence-ref", "messages/user-acceptance.md", "--json"]);
  assert.equal(acceptedBusinessRun.feedbackDecision.reviewState, "pending");
  const reopenedBusinessRun = invoke(["transition", "--run-directory", multiRun, "--entity", "acceptance", "--status", "implementing", "--json"]);
  assert.equal(reopenedBusinessRun.feedbackDecision.reviewState, "not-eligible");
  const expandedPlan = path.join(temporary, "expanded-plan.json");
  const expanded = JSON.parse(fs.readFileSync(multiPlan, "utf8"));
  expanded.participants.push({ id: "reviewer", role: "review", endpoint: { type: "codex-session" }, worktree: { mode: "none", ref: null }, readScopes: ["src"] });
  expanded.workItems.push({ id: "review", ownerId: "reviewer", dependsOn: ["write-a", "write-b"], readScopes: ["src"] });
  writeJson(expandedPlan, expanded);
  const replanned = invoke(["transition", "--run-directory", multiRun, "--entity", "plan", "--status", "updated", "--patch-file", expandedPlan, "--json"]);
  assert.equal(replanned.authorizations.collaborationPlan.state, "revoked");
  assert.equal(replanned.acceptance.status, "implementing");
  assert.equal(invoke(["next", "--run-directory", multiRun, "--json"])[0].type, "request-authorization");

  const conflict = createManifest({ runDirectory: path.join(temporary, "conflict"), plan: multiPlan });
  conflict.participants[2].writeScopes = ["src/a/nested"];
  assert(validateV2(conflict, null, false, { skipProjection: true }).some((issue) => issue.includes("write scope conflict")));
  assert.equal(scopeConflict("src/a", "src/a/nested"), true);

  const cyclePlan = path.join(temporary, "cycle-plan.json");
  writeJson(cyclePlan, { topic: "cycle", participants: [{ id: "coordinator", role: "coordinator" }], workItems: [{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }] });
  invoke(["init", "--run-directory", path.join(temporary, "cycle-run"), "--plan", cyclePlan, "--json"], 1);

  const guardedPlan = path.join(temporary, "guarded-plan.json");
  writeJson(guardedPlan, {
    topic: "authorization fixture",
    executionPath: "guarded",
    orchestrationMode: "serial",
    participants: [{ id: "coordinator", role: "coordinator", endpoint: { type: "serial" } }],
    workItems: [{ id: "deploy", ownerId: "coordinator", authorizationCategory: "deploy" }]
  });
  const guardedRun = path.join(temporary, "guarded-run");
  invoke(["init", "--run-directory", guardedRun, "--plan", guardedPlan, "--json"]);
  assert.equal(invoke(["next", "--run-directory", guardedRun, "--json"])[0].type, "request-authorization");
  invoke(["transition", "--run-directory", guardedRun, "--entity", "authorization", "--key", "feedbackWrite", "--status", "granted", "--actor", "user", "--json"], 1);
  invoke(["transition", "--run-directory", guardedRun, "--entity", "authorization", "--key", "deploy", "--status", "granted", "--actor", "user", "--json"]);
  const deployAction = invoke(["next", "--run-directory", guardedRun, "--json"]).find((item) => item.workItemId === "deploy" && item.type === "run-serial");
  assert.equal(deployAction.authorizationCategory, "deploy");

  const maintenancePlan = path.join(temporary, "maintenance-plan.json");
  writeJson(maintenancePlan, {
    topic: "framework maintenance fixture",
    taskKind: "framework-maintenance",
    workflow: "standard-change",
    feedbackReviewApplicable: false,
    feedbackApplicabilityReason: "framework-maintenance",
    participants: [{ id: "coordinator", role: "coordinator", endpoint: { type: "serial" } }],
    workItems: []
  });
  const maintenanceRun = path.join(temporary, "maintenance-run");
  const maintenanceManifest = invoke(["init", "--run-directory", maintenanceRun, "--plan", maintenancePlan, "--json"]);
  assert.equal(maintenanceManifest.feedbackDecision.applicable, false);
  assert.equal(maintenanceManifest.acceptance.status, "not-applicable");
  assert.equal(maintenanceManifest.maintenance.status, "maintaining");
  invoke(["transition", "--run-directory", maintenanceRun, "--entity", "acceptance", "--status", "locally-verified", "--json"], 1);
  invoke(["transition", "--run-directory", maintenanceRun, "--entity", "maintenance", "--status", "locally-verified", "--evidence-ref", "tests/framework.txt", "--json"]);
  const completedMaintenance = invoke(["transition", "--run-directory", maintenanceRun, "--entity", "maintenance", "--status", "maintenance-complete", "--actor", "coordinator", "--evidence-ref", "reports/maintenance-summary.md", "--json"]);
  assert.equal(completedMaintenance.maintenance.status, "maintenance-complete");
  assert.equal(completedMaintenance.feedbackDecision.reviewState, "not-eligible");
  invoke(["transition", "--run-directory", maintenanceRun, "--entity", "feedback-decision", "--status", "pending", "--json"], 1);
  invoke(["transition", "--run-directory", maintenanceRun, "--entity", "authorization", "--key", "feedbackWrite", "--status", "granted", "--actor", "user", "--json"], 1);
  invoke(["transition", "--run-directory", maintenanceRun, "--entity", "verification", "--status", "passed", "--actor", "testing-agent", "--revision", "fixture", "--json"]);
  invoke(["transition", "--run-directory", maintenanceRun, "--entity", "run", "--status", "completed", "--json"]);
  assert.equal(invoke(["validate", "--run-directory", maintenanceRun, "--json"]).valid, true);
  assert.equal(invoke(["validate", "--run-directory", maintenanceRun, "--final", "--json"]).valid, true);

  const mixedPlan = path.join(temporary, "mixed-plan.json");
  writeJson(mixedPlan, { topic: "invalid mixed fixture", taskKind: "framework-maintenance", feedbackReviewApplicable: true });
  invoke(["init", "--run-directory", path.join(temporary, "mixed-run"), "--plan", mixedPlan, "--json"], 1);

  const legacyRun = path.join(temporary, "legacy-run");
  fs.mkdirSync(legacyRun);
  writeJson(path.join(legacyRun, "00-run-manifest.json"), { schemaVersion: "1.2", topic: "legacy", stages: [] });
  const legacyStatus = invoke(["status", "--run-directory", legacyRun, "--json"]);
  assert.equal(legacyStatus.legacyReadOnly, true);
  invoke(["next", "--run-directory", legacyRun, "--json"], 1);

  console.log("agent-orchestrator tests passed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
