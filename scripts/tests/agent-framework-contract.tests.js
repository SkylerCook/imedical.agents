"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const registry = read("agents/agent-registry.md");
const workflowRegistry = read("workflows/workflow-registry.md");
const orchestration = read("agents/_shared/orchestration-protocol.md");
const standard = read("workflows/standard-change.workflow.md");
const iris = read("workflows/iris-change.workflow.md");
const manifest = JSON.parse(read("plugins/agent-context-kit/templates/agent-run-manifest.json"));
const plan = JSON.parse(read("plugins/agent-context-kit/templates/agent-run-plan.json"));
const lifecycle = read("agents/_shared/delivery-lifecycle.md");
const maintenanceLifecycle = read("agents/_shared/maintenance-lifecycle.md");
const feedback = read("skills/agent-framework-feedback/SKILL.md");
const maintenance = read(".agents/skills/agent-kit-maintenance/SKILL.md");

for (const role of ["coordinator", "explorer", "planner", "coding", "review", "testing"]) {
  assert(registry.includes(`${role}-agent`));
  assert(fs.existsSync(path.join(root, "agents", `${role}-agent`, "AGENT.md")));
  assert(fs.existsSync(path.join(root, "agents", `${role}-agent`, "bindings.yaml")));
}
assert(registry.includes("iris-change-agent"));
assert(workflowRegistry.includes("standard-change"));
assert(workflowRegistry.includes("iris-change"));
assert(orchestration.includes("executionPath: fast | full | guarded"));
assert(orchestration.includes("orchestrationMode: serial | subagent | multi-session"));
for (const marker of ["serial", "subagent", "codex-session", "human", "幂等"]) assert(orchestration.includes(marker));
for (const marker of ["taskKind=business-demand", "taskKind=framework-maintenance", "acceptance-pending", "maintenance-complete", "serial -> human", "collaborationPlan"]) assert(standard.includes(marker));
assert(iris.includes("i18n-agent"));
assert.equal(manifest.schemaVersion, "2.0");
for (const key of ["taskKind", "participants", "workItems", "actions", "messages", "authorizations", "acceptance", "maintenance", "feedbackDecision"]) assert(Object.hasOwn(manifest, key));
assert.equal(plan.taskKind, "other");
assert.equal(plan.feedbackReviewApplicable, false);
assert.equal(manifest.acceptance.status, "not-applicable");
assert.equal(manifest.maintenance.status, "not-applicable");
assert.equal(manifest.feedbackDecision.applicable, false);
for (const marker of ["implementing", "locally-verified", "acceptance-pending", "accepted", "逐项授权"]) assert(lifecycle.includes(marker));
for (const marker of ["taskKind=framework-maintenance", "maintaining", "locally-verified", "maintenance-complete", "不触发或提示需求 feedback", "拆成两个独立记录"]) assert(maintenanceLifecycle.includes(marker));
for (const marker of ["feedbackReviewApplicable=true", "只读审查", "acceptance-pending", "不得读取 experience 文件", "必须由用户逐项授权", "纯 `imedical.agents` 框架维护"]) assert(feedback.includes(marker));
assert(maintenance.includes("不触发 `agent-framework-feedback`"));
assert(maintenance.includes("不在收尾时向用户建议 feedback"));
assert(maintenance.includes("taskKind=framework-maintenance"));
for (const relative of ["agents/i18n-agent/AGENT.md", "workflows/i18n-change.workflow.md", "plugins/agent-context-kit/templates/AGENTS.template.md", "plugins/agent-context-kit/templates/AGENTS.context-snippet.md"]) {
  const content = read(relative);
  assert(content.includes("acceptance-pending"), `${relative} must reference acceptance-pending`);
  assert(content.includes("只读"), `${relative} must keep feedback review read-only`);
}

console.log("agent framework contract tests passed");
