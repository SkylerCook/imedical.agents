# AGENTS.md

## 插件定位

`coding-iris-plugin` 提供 IRIS/ObjectScript/CSP/JavaScript/HISUI 工程的通用编码规则、初始化流程和 IRIS 开发主力脚本。

插件只承载可复用能力；目标工程差异必须写入目标工程 `.agents/config/iris_project_profile.md`，MCP 连接事实必须以目标工程 `.mcp.json` 为准。

## 使用约束

- 不在插件 rules/skills 中硬编码服务器、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。
- 涉及工程差异时读取目标工程 `.agents/config/iris_project_profile.md`。
- 导出、编译、Broker 调试和环境配置同步优先使用插件内 IRIS 开发主力脚本。
- MCP 作为辅助能力，用于补上下文、只读 SQL/远程读取、脚本未覆盖的能力，或用户明确要求用 MCP 的场景。
- 涉及 MCP、上传、编译、远程读取或只读 SQL 验证时读取目标工程 `.mcp.json`。
- 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。
- 历史 CSP/JS/CSS 文件可能存在编码和特殊 EOF，修改前先确认实际编码和尾部格式，避免整文件重写。

## Skill 路由

- 首次初始化：`skills/coding-iris-init/SKILL.md`
- 后端 ObjectScript 编码：`skills/iris-backend-coding/SKILL.md`
- 前端 CSP/JS/HISUI 编码：`skills/iris-frontend-coding/SKILL.md`
- 前端 GB2312 转换后替换源文件：`skills/iris-frontend-gb2312-promote/SKILL.md`

`coding-iris-init` 是 bootstrap skill。首次接入目标工程时应直接读取插件真实路径 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`，不要依赖安装后才会生成的 thin-index。

## 规则入口

- 总索引：`rules/iris_coding_index.md`
- 通用编辑安全：`rules/iris_coding_general.md`
- 后端 ObjectScript：`rules/iris_coding_backend.md`
- 前端 CSP/JS/HISUI：`rules/iris_coding_frontend.md`
- MCP/上传/编译工作流：`rules/iris_coding_workflow.md`
- HISUI 控件参考：`references/hisui-widget-index.md`
- iris-agentic-dev 配置：`rules/iris-agentic-dev.md`

## 内置脚本

插件内置：

- `scripts/generate-plugin-thin-index.ps1`
- `scripts/convert-gb2312-upload.ps1`
- `scripts/iris-tools/`

`generate-plugin-thin-index.ps1` 不复制到目标工程；初始化和重建索引时直接调用插件内脚本。

`convert-gb2312-upload.ps1` 初始化时复制到目标工程 `.agents/scripts/`。若目标工程已有同名脚本且内容不同，初始化流程必须报告冲突，不得静默覆盖。

`scripts/iris-tools/` 是 IRIS 开发主力脚本集合，包含导出、编译、Broker 调试和环境配置同步。真实连接信息由目标工程 `.agents/config/project-env.json` 提供，该文件应由用户从 `templates/project-env.template.json` 复制后填写，不得提交到版本库。
