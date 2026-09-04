"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const skill = read("plugins/coding-iris-plugin/skills/iris-coding/SKILL.md");
const demandCommitSkill = read("plugins/coding-iris-plugin/skills/iris-demand-commit/SKILL.md");
const deploySkill = read("plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md");
const i18nSkill = read("plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md");
const lifecycle = read("agents/_shared/delivery-lifecycle.md");
const feedback = read("skills/agent-framework-feedback/SKILL.md");

for (const marker of ["fast", "full", "guarded", "parallelAssessment", "最多两个临时只读子 Agent", "主 Agent 保持唯一写入者", "taskKind=business-demand", "taskKind=framework-maintenance", "纯框架维护"]) assert(skill.includes(marker), marker);
for (const marker of ["iris_project_profile.md", "plugin_profile.md", "iris_coding_index.md", "iris_coding_general.md", "修改前后执行字节检测", "最终 diff"]) assert(skill.includes(marker), marker);
assert(skill.includes("本地验证完成不自动加载该 skill"));
assert(skill.includes("acceptance-pending"));
assert(lifecycle.includes("commit、merge、push、部署"));
assert(feedback.includes("不得读取 experience 文件"));
assert(feedback.includes("必须由用户逐项授权"));
for (const content of [deploySkill, i18nSkill]) {
  assert(content.includes("用户明确"));
  assert(content.includes("acceptance-pending"));
  assert(content.includes("只读审查"));
  assert(content.includes("逐项授权"));
}
assert(!i18nSkill.includes("需求处理完成后，检查本次是否产生可跨需求复用的经验，并按需更新"));
for (const forbidden of ["完成本地验证后读取“默认需求交付类型”", "需求完成后由 `iris-coding` 路由 `iris-demand-commit`"]) assert(!skill.includes(forbidden));

assert(skill.includes("$iris-demand-commit --plan|--commit"));
for (const marker of ["$iris-demand-commit --plan", "$iris-demand-commit --commit"]) assert(demandCommitSkill.includes(marker));
assert(demandCommitSkill.includes("`--plan` / `-plan`"));
assert(demandCommitSkill.includes("`--commit` / `-commit`"));
assert(demandCommitSkill.includes("不得继续询问是否提交"));
assert(demandCommitSkill.includes("视为用户对本次精确文件范围的本地 commit 明确授权"));
assert(demandCommitSkill.includes("同时出现两种模式"));

console.log("iris-coding fast-path tests passed");
