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
- `iris_test`、`iris_coverage`、`iris_execute_method`、容器切换和其它远端执行即使不直接改业务源码，也必须按远端状态变更取得任务级授权；上游 MCP 自带门禁不能代替本仓库授权边界。
- 历史 CSP/JS/CSS 文件可能存在编码和特殊 EOF，修改前先确认实际编码和尾部格式，避免整文件重写。
- 当前前端源码、上传内容和服务器运行编码统一使用 canonical `utf8`；`project-utf8` 仅作为兼容读取别名，`standard-gb2312` 仅服务用户明确指定的历史工程，实际文件字节检测始终是最终门禁。Overlay manifest 明确只声明 `backend` 时，profile 使用 `N/A (backend-only)`，不得伪造前端编码结论。
- 在 workspace-overlay 中统一通过 capability 包的 workspace context resolver 获取 `WorkspaceRoot`、`ContextRoot`、`CapabilityRoot`、`SourceRoot` 和 `GitRoot`；配置与 profile 只从 ContextRoot 读取，插件/模板/vendor 从 CapabilityRoot 读取，源码和 Git 操作不得越过 manifest 声明边界，也不得扫描父目录或 sibling 猜测根路径。
- `compile.js` 接受 workspace-overlay 的 `backend/src/...` WorkspaceRoot 逻辑路径时，必须在声明的 backend SourceRoot target 下解析本地文件，并移除逻辑 `backend/src` 前缀后生成 IRIS 远端文档名；不得把 `src` 误作为类包名。

## Skill 路由

- 首次初始化：`skills/coding-iris-init/SKILL.md`
- 统一编码入口：`skills/iris-coding/SKILL.md`
- 后端 ObjectScript 编码：`skills/iris-backend-coding/SKILL.md`
- 前端 CSP/JS/HISUI 编码：`skills/iris-frontend-coding/SKILL.md`
- 历史前端 GB2312 转换后替换源文件：`skills/iris-frontend-gb2312-promote/SKILL.md`
- IRIS 远端部署编排：`skills/iris-deploy/SKILL.md`
- DEV→PRD 需求移植：`skills/iris-demand-promote/SKILL.md`
- 标版/项目需求提交：`skills/iris-demand-commit/SKILL.md`
- IRIS 类、方法签名与官方文档查询：`skills/iris-mcp-lookup/SKILL.md`

普通编码需求优先使用 `iris-coding`。当任务边界已经明确为纯后端、纯前端，或用户明确处理历史 GB2312 工程时，可直接使用对应专项 skill。
当用户明确要求部署、上传、编译、SFTP 同步、CSP 编译或远端部署验证时，使用 `iris-deploy`。
当用户要求把已提交的 DEV 需求更新到独立 PRD 按需导出仓库时，使用 `iris-demand-promote`；需求来源是 DEV Git 补丁，目标基线必须从 PRD 服务器导出，默认只形成本地 PRD 提交。
只有用户明确要求提交或已确认正式提交计划时才使用 `iris-demand-commit`；本地验证完成不自动加载。commit 不改变 `acceptance-pending`，也不触发 feedback。标版首行使用简短菜单/功能摘要、第三行保留完整需求，并强制 `pull --ff-only`；push 仍需另行授权。

`iris-coding` 使用 `fast/full/guarded` 开发路径，但所有路径都必须读取项目入口、profile、通用规则和命中的专项规则。每次执行做轻量 `parallelAssessment`，只在两个独立只读范围确有收益时自主使用最多两个临时子 Agent；主 Agent 是唯一写入者。并行写入、持续通信或跨会话协作应建议 `iris-change-agent` 正式 workflow。
当用户要求查询 IRIS 类、方法、函数、宏、SQL 元数据或官方文档时，使用 `iris-mcp-lookup`；该 skill 默认只读，并把当前实例元数据与官方文档版本分开报告。

前端编码还必须读取目标工程 `.agents/config/plugin_profile.md`。仅当 `i18n-iris-plugin` 为 `enabled` 且任务或最终 diff 命中翻译 helper、翻译 key 或用户可见文案时，追加 i18n profile/rules 和 helper 静态检查；普通需求不自动进入完整 i18n workflow，插件未启用时不得因目录存在而加载。

`coding-iris-init` 是 bootstrap skill。首次接入目标工程时应直接读取插件真实路径 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`，不要依赖安装后才会生成的 thin-index。

## 规则入口

- 总索引：`rules/iris_coding_index.md`
- 通用编辑安全：`rules/iris_coding_general.md`
- 后端 ObjectScript：`rules/iris_coding_backend.md`
- 前端 CSP/JS/HISUI：`rules/iris_coding_frontend.md`
- MCP/上传/编译工作流：`rules/iris_coding_workflow.md`
- IRIS 部署执行清单：`rules/iris_deploy_checklist.md`
- Legacy GB2312 提升流程：`rules/iris_gb2312_workflow.md`
- HISUI 控件参考：`references/hisui-widget-index.md`（源码内置在 `.agents/vendor/hisui/`）
- HISUI 样式与资源参考：`references/hisui-style-index.md`（主题 CSS、locale CSS、语义 class、图标与插图）
- iris-agentic-dev 配置：`rules/iris_agentic_dev.md`（Windows x64 可执行文件内置在 `.agents/vendor/iris-agentic-dev/`）
- IRIS 知识查询与 MCP 路由：`rules/iris_knowledge_lookup.md`
- IRIS 官方文档路由：`references/iris-official-docs-routing.md`

## 内置脚本

插件内置：

- `scripts/generate-plugin-thin-index.ps1`
- `scripts/convert-gb2312-upload.ps1`
- `scripts/check-frontend-encoding.ps1`
- `scripts/migrate-frontend-encoding-profile.ps1`
- `scripts/migrate-demand-delivery-profile.ps1`
- `scripts/promote-frontend-export.ps1`
- `scripts/iris-tools/`

`scripts/iris-tools/promote-demand.js` 提供 DEV→PRD 需求的 plan/apply/continue/verify 状态机；计划按 DEV/PRD 绝对路径身份隔离，远端基线暂存于系统临时目录，不写入 `.agents/work` 或业务源码，直到 apply 通过全部探测门禁。冲突后的 `continue` 必须重新校验 DEV/PRD HEAD，并拒绝未暂存或未跟踪状态。

`scripts/iris-tools/commit-demand.js` 提供普通标版/项目需求的 plan/apply/verify 状态机；新计划通过一次批量 Git 状态读取生成包含 index blob 与工作区字节哈希的防漂移指纹，`apply --verify` 在同一进程完成提交和验证。它先完成全部仓库的安全 pull 门禁，再只提交计划内精确路径，不扫描父目录或无关 sibling，不执行 push。

`generate-plugin-thin-index.ps1` 不复制到目标工程；初始化和重建索引时直接调用插件内脚本。

初始化/迁移在目标工程 `.agents/scripts/` 生成薄 wrapper，转发到插件内编码脚本。已知历史复制版本可自动迁移；用户定制版本只报告冲突，不得静默覆盖。

`scripts/iris-tools/` 是 IRIS 开发主力脚本集合，包含部署清单生成、导出、编译、Broker 调试和环境配置同步。真实连接信息由目标工程本地私有配置承载：已有 `.mcp.json` 时反向补齐 `.agents/config/project-env.json`，没有 `.mcp.json` 时才从 `templates/project-env.template.json` 创建并用 `sync-env-config.js` 生成 `.mcp.json`。这些文件不得提交到版本库。

`prepare-deploy-manifest.js --from-git` 在 workspace-overlay 中按声明的 SourceRoot/GitRoot 分组执行 Git diff，并把结果映射回 WorkspaceRoot 逻辑路径；同名仓库相对路径必须保留各自 `sourceRoot`、`gitRoot`，不得互相覆盖。前端编码迁移只扫描 `sourceRoots[name=frontend]`；manifest 明确只有 `backend` 时规范化为 `N/A (backend-only)`，其它无法判定的缺失声明继续阻断。

默认模板将 `mcp.serverPath` 指向 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。该路径只表示内置 MCP server 可执行文件位置，不包含 host、namespace、账号、密码或 token。

官方 `iris-agentic-dev` v1.2.6 中通用性较高的 8 个 ObjectScript skills 固定快照位于 `.agents/vendor/iris-agentic-dev-skills/`，在 manifest 中全部声明为 optional capability。任务命中后按需读取，普通更新不生成浅层入口；上游工具名必须先按 `rules/iris_knowledge_lookup.md` 映射到当前 `tools/list` schema。`objectscript-tdd` 只有在任务已授权远端编译和测试时才能使用，其原文中的直接 session fallback 不得绕过本插件门禁。
