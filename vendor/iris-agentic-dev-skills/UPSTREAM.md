# iris-agentic-dev skills vendor snapshot

- Upstream: `https://github.com/intersystems-community/iris-agentic-dev`
- Commit: `568a0e03cb5bdfae6870973a73d1d4d86ae42ab9`
- Upstream version at commit: `0.9.4`
- Imported: `2026-07-23`
- License: MIT，见同目录 `LICENSE`

## 选择范围

仅引入通用性较高、可按任务触发的 7 个 skill：

- `objectscript-review`
- `objectscript-guardrails`
- `objectscript-sql-patterns`
- `objectscript-list-patterns`
- `objectscript-navigation`
- `objectscript-unit-test`
- `objectscript-debugging`

未引入与现有 workflow 重复或领域过窄的 `objectscript-tdd`、`objectscript-repair`、`iris-vector-ai`、`iris-connectivity`、`ensemble-production`、`iris-devtester`。官方 `iris-docs` 含固定 Algolia key，且其数据源决策与本次要求的 URL Fetch 路由不一致；本仓库不保存该 key，而是将安全的数据源决策适配到 `coding-iris-plugin/skills/iris-mcp-lookup/`。

## 使用边界

- 本目录保留上游 `SKILL.md` 原文，不在 vendor 文件中做本地化修改。
- 上游 skill 的工具名可能与仓库内置 `iris-agentic-dev` 版本不同；执行前读取 `plugins/coding-iris-plugin/rules/iris_knowledge_lookup.md` 的兼容映射，并以当前 `tools/list` schema 为准。
- 这些 skill 在 `coding-iris-plugin` manifest 中声明为 optional capability，不随普通更新自动生成浅层入口。
- 任务命中后可直接读取 `.agents/vendor/iris-agentic-dev-skills/skills/<name>/SKILL.md`；需要运行时用户级副本时，按更新 runbook 显式同步指定 skill。
