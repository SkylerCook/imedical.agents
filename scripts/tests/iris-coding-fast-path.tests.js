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
const feedback = read("plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md");
const general = read("plugins/coding-iris-plugin/rules/iris_coding_general.md");

for (const marker of ["fast", "full", "guarded", "parallelAssessment", "最多两个临时只读子 Agent", "主 Agent 保持唯一写入者"]) assert(general.includes(marker), marker);
for (const marker of ["executionPath", "parallelAssessment", "taskKind=business-demand", "taskKind=framework-maintenance", "纯框架维护"]) assert(skill.includes(marker), marker);
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

assert(skill.includes("../iris-demand-commit/SKILL.md"));
assert(skill.includes("--plan / --commit"));
for (const marker of ["$iris-demand-commit --plan", "$iris-demand-commit --commit"]) assert(demandCommitSkill.includes(marker));
assert(demandCommitSkill.includes("`--plan` / `-plan`"));
assert(demandCommitSkill.includes("`--commit` / `-commit`"));
assert(demandCommitSkill.includes("不得继续询问是否提交"));
assert(demandCommitSkill.includes("视为用户对本次精确文件范围的本地 commit 明确授权"));
assert(demandCommitSkill.includes("同时出现两种模式"));

assert(general.includes("文件数量仅触发重新评估"));
assert(!skill.includes("第三个文件"));
for (const entry of [skill, read("plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md"), read("plugins/coding-iris-plugin/skills/iris-backend-coding/SKILL.md"), i18nSkill]) {
  assert(entry.includes("iris_coding_general.md"));
  assert(entry.includes("guidanceMode"));
  assert(!entry.includes("涉及 3 个以上文件"));
}
const guidance = read("agents/_shared/execution-guidance.md");
for (const marker of ["auto", "concise", "assisted", "硬约束", "不自动写回配置", "内容未变化", "按需加载"]) assert(guidance.includes(marker));
assert(fs.existsSync(path.join(root, "plugins/coding-iris-plugin/references/coding-assistance.md")));

// Follow disclosed references instead of requiring their full text in every entry.
function checkLocalPointers(relative, content) {
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const [target, anchor] = match[1].split("#");
    if (/^[a-z]+:/i.test(target)) continue;
    const resolved = path.resolve(root, path.dirname(relative), target);
    assert(fs.existsSync(resolved), `${relative}: missing ${target}`);
    if (anchor) {
      const headings = [...fs.readFileSync(resolved, "utf8").matchAll(/^#{1,6} (.+)$/gm)]
        .map(x => x[1].trim().toLowerCase().replace(/ /g, "-"));
      assert(headings.includes(anchor), `${relative}: missing heading ${anchor}`);
    }
  }
}
function checkBaselineBeforeImplementation(content, implementationHeading) {
  const baseline = content.indexOf("../../references/deployment-protection.md#建立会话");
  const implementation = content.indexOf(implementationHeading);
  assert(baseline >= 0 && implementation > baseline, "deployment baseline must precede implementation");
  assert(content.slice(0, implementation).includes("第一次修改前"));
  assert(content.includes("仅分析或明确不部署"));
}
for (const name of ["iris-coding", "iris-frontend-coding", "iris-backend-coding"]) {
  const relative = `plugins/coding-iris-plugin/skills/${name}/SKILL.md`;
  const content = read(relative);
  checkLocalPointers(relative, content);
  checkBaselineBeforeImplementation(content, name === "iris-coding" ? "## 实现与验证" : "## 流程");
}
const indexPath = "plugins/coding-iris-plugin/rules/iris_coding_index.md";
checkLocalPointers(indexPath, read(indexPath));
checkLocalPointers("plugins/coding-iris-plugin/rules/iris_coding_general.md", general);
assert.throws(() => checkLocalPointers(indexPath, "[gate](missing-gate.md)"), /missing/);
assert.throws(() => checkLocalPointers(indexPath, "[gate](iris_coding_frontend.md#missing-gate)"), /missing heading/);
assert.throws(() => checkBaselineBeforeImplementation("## 实现与验证\n" + skill, "## 实现与验证"), /baseline/);
const protection = read("plugins/coding-iris-plugin/references/deployment-protection.md");
for (const marker of ["已有会话复用", "Question", "不自动 stash/rebase", "pull --ff-only", "--confirm-baseline", "不得自行把 HEAD"]) {
  assert(protection.includes(marker), marker);
}
assert(general.includes("直接上传 UTF-8 源文件"));
assert(!general.includes("按工作流转换编码"));
// These assertions check routing contracts only; actual model behavior needs execution traces.

console.log("iris-coding fast-path tests passed");
