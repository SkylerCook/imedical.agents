---
name: iris-coding
description: Use when an IRIS coding request may involve ObjectScript, CSP, JavaScript, CSS, HISUI, or needs routing between backend, UTF-8 frontend, legacy GB2312 promotion, and workflow rules.
---

# IRIS Coding

涉及 `.cls` 编码时按 `../../references/cls-coding-format.md` 处理新增/修改位置的格式；禁止为此整理整个已有类。格式自检仅提示，上传、编译和提交沿用原流程。

## 使用时机

需求只有业务名称或菜单路径、尚未找到实现时，可用 `../iris-imedical-knowledge/SKILL.md` 检索参考并核对当前源码；用户要求刷新菜单资料时转 `../iris-menu-sync/SKILL.md`。不为普通编码默认加载知识库。

当任务是 IRIS/ObjectScript/CSP/JavaScript/HISUI 编码需求，且用户未明确只要求后端或前端专项 skill 时，优先使用本 Skill。

适用场景：

- 需求同时涉及 `.cls`、CSP、JS、CSS 或 HISUI。
- 用户只描述业务现象、页面、按钮、接口或功能目标，尚未明确前后端边界。
- 需要先判断应走后端、UTF-8 前端、前后端混合、上传/编译验证或历史 GB2312 提升流程。

明确的单一专项任务仍可直接使用：

- 后端 ObjectScript：`iris-backend-coding`
- 前端 CSP/JS/HISUI：`iris-frontend-coding`
- 历史工程永久替换 `{name}.gb2312.{ext}` 回源文件：`iris-frontend-gb2312-promote`
- 远端部署、上传、编译、SFTP 同步或部署验证：`iris-deploy`
- 独立 DEV/PRD 按需导出仓库之间按需求号移植本地提交：`iris-demand-promote`
- 已完成标版/项目需求的提交信息生成、pull 门禁和本地提交：`iris-demand-commit`，支持显式 `--plan` / `--commit`
- 标版从代码改动/提交记录补录 BOSS 需求、可选 Excel 导入与编号回填：`iris-demand-entry`，仅在用户要求整理需求或闭环时加载；不因开发完成自动提交。
- IRIS 类、方法签名、宏、SQL 元数据或官方文档查询：`iris-mcp-lookup`

## 必读规则

1. 目标工程 `.agents/config/iris_project_profile.md`
2. 目标工程 `.agents/config/plugin_profile.md`
3. `rules/iris_coding_index.md`
4. `rules/iris_coding_general.md`

`executionPath: fast | full | guarded` 只决定分析和验证深度，不决定是否遵守规则。三条路径都必须读取上述入口，并按任务信号读取命中的前端、后端、i18n、HISUI、编码和安全规则。

## 执行路径

统一使用 rules/iris_coding_general.md 的 executionPath、parallelAssessment 和正式 run 判定。guidanceMode 按共享 execution-guidance 协议解析，辅助程度不改变安全底线。主 Agent 保持唯一写入者；允许时最多两个临时只读子 Agent。

按任务范围继续读取：

- 后端 `.cls`、BLH/DATA/SQL、Broker、Query、ObjectScript 编译验证：读取 `iris-backend-coding` 和 `rules/iris_coding_backend.md`
- 前端 CSP、HTML、JavaScript、CSS、HISUI、页面布局、前端数据回显：读取 `iris-frontend-coding` 和 `rules/iris_coding_frontend.md`
- 前端任务且 `i18n-iris-plugin` 为 `enabled`：修改前和最终 diff 后按 `rules/iris_coding_frontend.md` 检查 i18n 信号；命中 `$g`、`$trans`、翻译 key、用户可见文案或 `placeholder` / `title` / `tooltip` / `alt` 时，追加读取 `.agents/config/i18n_project_profile.md`、i18n `rules/i18n_index.md` 和 `rules/i18n_coding_frontend.md`
- HISUI 控件或 API 不确定：读取 `references/hisui-widget-index.md`，再读 `.agents/vendor/hisui/dist/js/jquery.hisui.js`
- HISUI 样式、图标或多语言视觉资源不确定：读取 `references/hisui-style-index.md`，再检查对应主题 CSS、locale CSS 和页面实际引入关系
- 上传、编译、远程读取、只读 SQL 验证：读取目标工程 `.mcp.json` 和 `rules/iris_coding_workflow.md`
- 类/方法是否存在、签名、继承或官方文档不确定：切换到 `iris-mcp-lookup`，读取 `rules/iris_knowledge_lookup.md`
- 上传、编译、部署和远端验证：读取 `rules/iris_deploy_checklist.md`
- 用户明确处理历史工程并永久替换 `{name}.gb2312.{ext}` 回源文件：切换到 `iris-frontend-gb2312-promote`

## 路由流程

1. 读取需求描述，列出已知入口、涉及文件、页面、类、方法和用户可见现象。
2. 判断任务边界：
   - 只涉及 `.cls`、BLH/DATA/SQL、Broker、Query：走后端专项流程。
   - 只涉及 CSP/JS/CSS/HISUI：走前端专项流程。
   - 同时涉及后端接口和前端页面：先梳理调用链和文件边界，再分阶段改后端和前端。
   - 用户要求部署、上传、编译、SFTP 同步或部署验证：切换到 `iris-deploy`。
   - 用户要求把已提交 DEV 需求更新到独立 PRD 仓库：切换到 `iris-demand-promote`，不把它当远端生产部署。
   - 只有用户要求生成提交信息、明确要求提交，或显式调用 `$iris-demand-commit --plan|--commit` 时才读取并切换到该 skill；本地验证完成不自动加载该 skill。
   - 用户要求远端读取或 SQL 验证但不部署：只在明确要求后进入工作流规则。
   - 用户要求查询 IRIS API、签名、宏、SQL 元数据或官方文档：切换到 `iris-mcp-lookup`。
   - 用户明确处理历史 GB2312 工程并要求提升临时文件为源文件：切换到 promote skill。
3. 前端任务读取 `plugin_profile.md` 并执行条件 i18n 门禁；只有 `i18n-iris-plugin` 为 `enabled` 且任务或改动命中 i18n 信号时才追加 i18n 规则。明确 i18n 需求切换到 `i18n-coding`，普通业务需求只追加轻量规则，不自动进入完整 i18n workflow。
4. 本地搜索现有实现和同类代码，优先沿用目标工程模式。
5. 前端任务将 canonical `utf8` 作为当前模式，并对每个触碰文件修改前后执行字节检测；正常时不展开诊断，GB2312、UTF-16、冲突、unknown 或 mixed 时停止。
6. 按已判定的专项流程执行编码改造。
7. 最终 diff 再执行一次条件 i18n 门禁；命中且插件已启用时运行 i18n helper 静态检查，失败必须停止。
8. 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。
9. 本地验证完成后按 `agents/_shared/delivery-lifecycle.md` 进入 `acceptance-pending`，提供最短验收步骤。需求号、标题或默认交付类型均不触发 `iris-demand-commit`；只有用户要求生成提交信息、明确要求提交，或显式调用 `$iris-demand-commit --plan|--commit` 时才读取交付类型并路由。

## 前后端混合需求

混合需求按阶段执行：

1. 定位入口：页面、按钮、JS 调用、Broker 方法或后端类方法。
2. 划分边界：明确前端负责展示/交互/采集，后端负责业务处理/数据读写/返回结构。
3. 后端改造：按 `iris-backend-coding` 和 `iris_coding_backend.md` 处理。
4. 前端改造：按 `iris-frontend-coding` 和 `iris_coding_frontend.md` 处理。
5. 验证：本地结构检查优先；用户明确要求后再上传、编译或远端验证。

## 产出

- 改造范围和涉及文件。
- 任务路由结论：后端、UTF-8 前端、前后端混合、legacy GB2312 promote 或部署验证。
- 前后端分工和执行顺序。
- 已执行的本地验证。
- 前端任务正常完成时只输出一行编码摘要，例如“前端编码：utf8，3 个文件已保持 UTF-8”；仅异常时展开完整编码诊断。
- 仍需用户确认的上传、编译、远程写入、数据库变更或生产环境动作。
- 仅在用户要求提交或生成提交计划时报告需求提交模式、需求类型来源和完整方案型“修改说明”；`--plan` 只报告提交信息且明确未创建 commit，`--commit` 在明确授权后报告本地 commit hash，并始终单独说明未执行 push。

## 用户验收后的 feedback 审查

业务需求设置 taskKind=business-demand，纯框架维护使用独立 taskKind=framework-maintenance。本地验证后停在 acceptance-pending。用户明确验收后，仅发现框架缺陷、规则冲突、可复用新经验或用户要求时加载 agent-framework-feedback 做只读审查；没有信号不加载、不例行报告。任何 feedback 写入仍需逐项授权。完整生命周期见 agents/_shared/delivery-lifecycle.md。

## 完成检查

- 已读取 project profile 和通用规则索引。
- 当前前端编码模式只写 canonical `utf8`；`project-utf8` 和 `standard-gb2312` 仅兼容读取旧 profile，其中后者必须由用户明确指定为历史工程。实际文件字节检测是最终门禁。
- 已按任务范围读取对应专项 skill/rule。
- 前端任务已按 `plugin_profile.md` 在修改前和最终 diff 后执行条件 i18n 门禁；未启用插件时没有因目录存在而加载 i18n 能力。
- i18n 门禁命中时，翻译 helper key 已通过稳定字面量静态检查；检查失败没有继续交付。
- 未把服务器、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类写入插件。
- 上传、编译、远程写入、数据库变更没有在用户未明确要求时执行。
- 只有明确提交/提交计划请求才检查交付类型并加载 iris-demand-commit；其它任务不检查 TODO 交付类型、不追问提交。
- `executionPath` 与是否使用临时只读子 Agent 相互独立；fast 未跳过任何适用规则。
- 本地验证后停在 `acceptance-pending`；用户验收前未读取或写入 feedback。

## 需求修改前的 Git 基线

需要部署的业务需求，在所属仓库第一次修改前，按插件 references/deployment-protection.md 用 deploy-guard.js init 同步 upstream（pull --ff-only）并记录固定基线。已有修改、需求号缺失或基线不明时通过 Question 确认；不猜 HEAD、不自动 stash/rebase。已有会话复用，不能为部署重建历史。仅分析或明确不部署的任务不额外建立会话。
