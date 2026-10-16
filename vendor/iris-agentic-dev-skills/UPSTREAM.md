# iris-agentic-dev skills vendor snapshot

- Upstream: `https://github.com/intersystems-community/iris-agentic-dev`
- Commit: `2b3e017b7fc73d6370fc1e89e7fa03f3de49a1a1`
- Upstream version at commit: `1.5.0`
- Imported: `2026-10-16`
- License: MIT，见同目录 `LICENSE`

## 选择范围

仅引入通用性较高、可按任务触发的 8 个 skill：

- `objectscript-review`
- `objectscript-guardrails`
- `objectscript-sql-patterns`
- `objectscript-list-patterns`
- `objectscript-navigation`
- `objectscript-unit-test`
- `objectscript-debugging`
- `objectscript-tdd`

未引入与现有 workflow 重复、含不适合本仓库的 Git 回退操作或领域过窄的 `objectscript-repair`、`iris-vector-ai`、`iris-connectivity`、`ensemble-production`、`iris-devtester`。官方 `iris-docs` 含固定 Algolia key，且其数据源决策与本仓库的 URL Fetch 路由不一致；本仓库不保存该 key，而是将安全的数据源决策适配到 `coding-iris-plugin/skills/iris-mcp-lookup/`。

## 使用边界

- 本目录保留上游 `SKILL.md` 原文，不在 vendor 文件中做本地化修改。
- 上游 skill 的工具名可能与仓库内置 `iris-agentic-dev` 版本不同；执行前读取 `plugins/coding-iris-plugin/rules/iris_knowledge_lookup.md` 的兼容映射，并以当前 `tools/list` schema 为准。
- `objectscript-tdd` 中的编译、测试和直接 `iris session` fallback 都属于远端执行；上游原文不构成授权，必须先满足 `coding-iris-plugin` 的任务级远程动作门禁。
- 这些 skill 在 `coding-iris-plugin` manifest 中声明为 optional capability，不随普通更新自动生成浅层入口。
- 任务命中后可直接读取 `.agents/vendor/iris-agentic-dev-skills/skills/<name>/SKILL.md`；需要运行时用户级副本时，按更新 runbook 显式同步指定 skill。

## v1.5.0 同步说明

- 原有 8 项与 LICENSE 均按固定提交逐个验证 Git blob SHA，保留上游原文；7 项为 core，objectscript-navigation 为 extra。上游 tier 不改变本仓 optional capability 的加载方式。
- 主要更新为 SQLCODE 与取数错误处理、列表追加复杂度、事务层级与命名空间恢复、测试类选择和零测试失败判定；未额外引入 iris-query-plans 等技能。
- 上游编译、上传和测试示例是参考能力，执行时优先采用目标项目既有部署入口、Storage 保护和远程动作授权；不因示例使用 iris_doc put 而绕过项目部署契约。
- 上游 frontmatter 中保留的 benchmark/pass_rate 是历史元数据；v1.5.0 发布说明已撤回旧评测收益，不作为当前有效性证据。真实 IRIS 版本适用性按目标工程验证。
- 业务工程正常更新能力包即可取得 vendor 快照；用户级目录已有同名 SKILL.md 时，同步器报告 vendor-skill-reused 并保留原内容，不比较版本或覆盖旧副本。需要新版时优先直接读取项目 vendor；确需替换用户级副本，应先核对来源和用户修改，再单独执行明确授权的更新。
