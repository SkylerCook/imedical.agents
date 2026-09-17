#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const replacements = [
  ["仅在用户明确验收后调用 `.agents/skills/agent-framework-feedback/SKILL.md`", "仅在用户明确验收且发现框架缺陷、规则冲突、可复用新经验或用户要求时调用 `.agents/skills/agent-framework-feedback/SKILL.md`"],
  ["按 `.agents/skills/project-context-maintenance/SKILL.md` 判断是否更新 memory、rules、config 或插件入口。", "仅发现稳定项目事实变化、入口失效、配置变化或用户要求维护时，加载 `.agents/skills/project-context-maintenance/SKILL.md`；普通修改不例行生成维护材料。"],
  ["执行中发现范围扩大、第二个仓库、第三个文件、规则信号或验证失败时，立即从 `fast` 升级到 `full` / `guarded`，不得用 fast 跳过规则。", "执行路径统一遵循 coding-iris-plugin/rules/iris_coding_general.md；文件数量仅触发重新评估，不机械升级，所有适用门禁保持不变。"]
];

function migrateText(text) {
  let content = text;
  const changes = [];
  for (const [before, after] of replacements) if (content.includes(before)) {
    content = content.split(before).join(after);
    changes.push({ before, after });
  }
  const warnings = [];
  if (/第三个文件|每次.*feedback|验收后.*固定报告/.test(content)) warnings.push("Unrecognized custom routing/wrap-up text: review manually; retained unchanged.");
  return { content, changes, warnings };
}

function main(argv) {
  if (!argv.length || argv.includes("--help")) {
    process.stdout.write("migrate-execution-entry.js --project-root <path> [--write]\nOnly replaces known sentences in AGENTS.md; preserves profile and custom content.\n");
    return;
  }
  let projectRoot;
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project-root" && argv[i + 1]) projectRoot = path.resolve(argv[++i]);
    else if (argv[i] === "--write") write = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!projectRoot) throw new Error("--project-root is required");
  const file = path.join(projectRoot, "AGENTS.md");
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error("AGENTS.md symlink requires manual migration");
  const bytes = fs.readFileSync(file);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const result = migrateText(text);
  const guidance = path.join(projectRoot, ".agents/agents/_shared/execution-guidance.md");
  if (!fs.existsSync(guidance)) result.warnings.push("Shared execution-guidance.md is missing; update capability package first.");
  if (write && result.warnings.length) throw new Error(result.warnings.join("\n"));
  if (write && result.changes.length) fs.writeFileSync(file, result.content, "utf8");
  process.stdout.write(JSON.stringify({ file, mode: write ? "write" : "plan", changes: result.changes, warnings: result.warnings }, null, 2) + "\n");
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
}
module.exports = { migrateText };
