---
name: cure-form-init
description: 初始化 IRIS CA/CR 治疗表单开发能力、生成本地 profile，并检查 extract-doc、coding-iris-plugin、MCP 和服务器 profile 依赖。仅在项目尚未完成治疗表单配置时使用。
---

# Cure Form Init

运行参数保存在当前 ContextRoot 的 `config/project.jsonc` 的 `pluginSettings.iris-cure-form-dev` 节。 首次初始化在项目说明就位后运行 `node <CapabilityRoot>/scripts/plugin-settings.js Init iris-cure-form-dev .`，用同一脚本的 Read 命令读回。Markdown 保留说明、表格与尚未迁移的约定。


帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

1. 阅读插件 `AGENTS.md` 和 `rules/cure_form_index.md`。
2. 若 `.agents/config/cure_form_profile.md` 不存在，从 `templates/cure_form_profile.template.md` 复制项目说明，将预览资源路径写入上述插件节。Init 默认把 HISUI、jQuery 和 locale 指向随能力包部署的 `.agents/vendor/hisui/`，仍须按目标工程实际资源确认，并补齐 `asscom.css`、`adaptation.css`。需要固定 Chromium 时填写 `PreviewBrowserCommand`；使用 `common-migrate` 时从 `cure_form_common_migration.template.json` 创建项目配置并填写 `CommonMigrationConfig`，不得把业务 MapCode 或模板 RowID 回写插件。
3. 验证 `.mcp.json`、`.iris-agentic-dev.toml`、`extract-doc` 和 `coding-iris-plugin` 可发现；不得输出连接内容。
4. 确认任务 private、连接文件和 local config 已被 Git 忽略；项目配置/规则仍归属 .agents。
5. 确认 docs/ 为需求入口，docs/work/cure-form/ 为任务根；生成/预览/运行态分目录，统一使用 --task-id，参考 `../../references/cure-form-delivery-workflow.md`。
6. 运行 `node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js doctor --capability-root <path>`；只读探针需要用户已允许连接验证。
7. 不自动上传、编译或写数据库。
