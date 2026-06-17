# AGENTS.md

## 插件定位

`coding-iris-plugin` 提供 IRIS/ObjectScript/CSP/JavaScript/HISUI 工程的通用编码规则、初始化流程和 IRIS 开发主力脚本。

插件只承载可复用能力；目标工程差异必须写入目标工程 `.agents/config/iris_project_profile.md`，MCP 连接事实必须以目标工程 `.mcp.json` 为准。

## 使用约束

- 不在插件 rules/skills 中硬编码服务器、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。
- `templates/profile-defaults/<type>.md` 只作为用户显式选择项目类型后的领域默认值来源；它不是通用规则，加载后仍需代码探索或用户确认校验。
- 涉及工程差异时读取目标工程 `.agents/config/iris_project_profile.md`。
- 导出、编译、Broker 调试和环境配置同步优先使用插件内 IRIS 开发主力脚本。
- MCP 作为辅助能力，用于补上下文、只读 SQL/远程读取、脚本未覆盖的能力，或用户明确要求用 MCP 的场景。
- 涉及 MCP、上传、编译、远程读取或只读 SQL 验证时读取目标工程 `.mcp.json`。
- 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。
- 历史 CSP/JS/CSS 文件可能存在编码和特殊 EOF，修改前先确认实际编码和尾部格式，避免整文件重写。

## Skill 路由

- 首次初始化：`skills/coding-iris-init/SKILL.md`
- 统一编码入口：`skills/iris-coding/SKILL.md`
- 后端 ObjectScript 编码：`skills/iris-backend-coding/SKILL.md`
- 前端 CSP/JS/HISUI 编码：`skills/iris-frontend-coding/SKILL.md`
- 前端 GB2312 转换后替换源文件：`skills/iris-frontend-gb2312-promote/SKILL.md`
- IRIS 远端部署编排：`skills/iris-deploy/SKILL.md`

普通编码需求优先使用 `iris-coding`。当任务边界已经明确为纯后端、纯前端或 GB2312 promote 时，可直接使用对应专项 skill。
当用户明确要求部署、上传、编译、SFTP 同步、CSP 编译或远端部署验证时，使用 `iris-deploy`。

`coding-iris-init` 是 bootstrap skill。首次接入目标工程时应直接读取插件真实路径 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`，不要依赖安装后才会生成的 thin-index。

## 规则入口

- 总索引：`rules/iris_coding_index.md`
- 通用编辑安全：`rules/iris_coding_general.md`
- 后端 ObjectScript：`rules/iris_coding_backend.md`
- 前端 CSP/JS/HISUI：`rules/iris_coding_frontend.md`
- MCP/上传/编译工作流：`rules/iris_coding_workflow.md`
- IRIS 部署执行清单：`rules/iris_deploy_checklist.md`
- GB2312 提升流程：`rules/iris_gb2312_workflow.md`
- HISUI 控件参考：`references/hisui-widget-index.md`（源码内置在 `.agents/vendor/hisui/`）
- iris-agentic-dev 配置：`rules/iris_agentic_dev.md`（Windows x64 可执行文件内置在 `.agents/vendor/iris-agentic-dev/`）

## 内置脚本

插件内置：

- `scripts/generate-plugin-thin-index.ps1`
- `scripts/convert-gb2312-upload.ps1`
- `scripts/iris-tools/`

`generate-plugin-thin-index.ps1` 不复制到目标工程；初始化和重建索引时直接调用插件内脚本。

`convert-gb2312-upload.ps1` 初始化时复制到目标工程 `.agents/scripts/`。若目标工程已有同名脚本且内容不同，初始化流程必须报告冲突，不得静默覆盖。

`scripts/iris-tools/` 是 IRIS 开发主力脚本集合，包含部署清单生成、导出、编译、Broker 调试和环境配置同步。真实连接信息由目标工程本地私有配置承载：已有 `.mcp.json` 时反向补齐 `.agents/config/project-env.json`，没有 `.mcp.json` 时才从 `templates/project-env.template.json` 创建并用 `sync-env-config.js` 生成 `.mcp.json`。这些文件不得提交到版本库。

默认模板将 `mcp.serverPath` 指向 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。该路径只表示内置 MCP server 可执行文件位置，不包含 host、namespace、账号、密码或 token。
