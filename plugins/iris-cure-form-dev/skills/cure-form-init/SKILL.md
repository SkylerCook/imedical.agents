---
name: cure-form-init
description: 初始化 IRIS CA/CR 治疗表单开发能力、生成本地 profile，并检查 extract-doc、coding-iris-plugin、MCP 和服务器 profile 依赖。仅在项目尚未完成治疗表单配置时使用。
---

# Cure Form Init

1. 阅读插件 `AGENTS.md` 和 `rules/cure_form_index.md`。
2. 若 `.agents/config/cure_form_profile.md` 不存在，从 `templates/cure_form_profile.template.md` 复制并只填写本地路径；补齐六个 `Preview*` 资源字段，分别指向目标工程实际 HISUI、jQuery、locale、`asscom.css` 和 `adaptation.css` 文件。
3. 验证 `.mcp.json`、`.iris-agentic-dev.toml`、`extract-doc` 和 `coding-iris-plugin` 可发现；不得输出连接内容。
4. 确认 `.agents/work/`、连接文件和 local config 已被 Git 忽略。
5. 确认业务项目 `docs/` 为默认需求入口，`docs/cure-form/` 为默认新表单开发目录；如项目另有约定，在 local profile 配置 `DocsRoot` / `DevelopmentRoot` 并在命令中显式传参。
6. 运行 `node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js doctor --capability-root <path>`；只读探针需要用户已允许连接验证。
7. 不自动上传、编译或写数据库。
