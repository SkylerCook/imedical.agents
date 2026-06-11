---
name: iris-coding
description: Use when an IRIS coding request may involve ObjectScript, CSP, JavaScript, CSS, HISUI, or needs routing between backend, frontend, GB2312 promotion, and workflow rules.
---

# IRIS Coding

## 使用时机

当任务是 IRIS/ObjectScript/CSP/JavaScript/HISUI 编码需求，且用户未明确只要求后端或前端专项 skill 时，优先使用本 Skill。

适用场景：

- 需求同时涉及 `.cls`、CSP、JS、CSS 或 HISUI。
- 用户只描述业务现象、页面、按钮、接口或功能目标，尚未明确前后端边界。
- 需要先判断应走后端、前端、前后端混合、上传/编译验证或 GB2312 提升流程。

明确的单一专项任务仍可直接使用：

- 后端 ObjectScript：`iris-backend-coding`
- 前端 CSP/JS/HISUI：`iris-frontend-coding`
- 永久替换 `{name}.gb2312.{ext}` 回源文件：`iris-frontend-gb2312-promote`

## 必读规则

1. 目标工程 `.agents/config/iris_project_profile.md`
2. `rules/iris_coding_index.md`
3. `rules/iris_coding_general.md`

按任务范围继续读取：

- 后端 `.cls`、BLH/DATA/SQL、Broker、Query、ObjectScript 编译验证：读取 `iris-backend-coding` 和 `rules/iris_coding_backend.md`
- 前端 CSP、HTML、JavaScript、CSS、HISUI、页面布局、前端数据回显：读取 `iris-frontend-coding` 和 `rules/iris_coding_frontend.md`
- HISUI 控件选型或 API 不确定：读取 `references/hisui-widget-index.md`，再读 `.agents/vendor/hisui/dist/js/jquery.hisui.js` 查看源码
- 上传、编译、远程读取、只读 SQL 验证：读取目标工程 `.mcp.json` 和 `rules/iris_coding_workflow.md`
- 上传、编译、部署和远端验证：读取 `rules/iris_deploy_checklist.md`
- 永久替换 `{name}.gb2312.{ext}` 回源文件：切换到 `iris-frontend-gb2312-promote`

## 路由流程

1. 读取需求描述，列出已知入口、涉及文件、页面、类、方法和用户可见现象。
2. 判断任务边界：
   - 只涉及 `.cls`、BLH/DATA/SQL、Broker、Query：走后端专项流程。
   - 只涉及 CSP/JS/CSS/HISUI：走前端专项流程。
   - 同时涉及后端接口和前端页面：先梳理调用链和文件边界，再分阶段改后端和前端。
   - 用户要求上传、编译、远端读取或 SQL 验证：只在明确要求后进入工作流规则。
   - 用户要求提升 GB2312 临时文件为源文件：切换到 promote skill。
3. 本地搜索现有实现和同类代码，优先沿用目标工程模式。
4. 按已判定的专项流程执行编码改造。
5. 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。

## 前后端混合需求

混合需求按阶段执行：

1. 定位入口：页面、按钮、JS 调用、Broker 方法或后端类方法。
2. 划分边界：明确前端负责展示/交互/采集，后端负责业务处理/数据读写/返回结构。
3. 后端改造：按 `iris-backend-coding` 和 `iris_coding_backend.md` 处理。
4. 前端改造：按 `iris-frontend-coding` 和 `iris_coding_frontend.md` 处理。
5. 验证：本地结构检查优先；用户明确要求后再上传、编译或远端验证。

## 产出

- 改造范围和涉及文件。
- 任务路由结论：后端、前端、前后端混合、GB2312 promote 或部署验证。
- 前后端分工和执行顺序。
- 已执行的本地验证。
- 仍需用户确认的上传、编译、远程写入、数据库变更或生产环境动作。

## 需求完成后的经验沉淀

需求处理完成后，检查本次是否产生可跨需求复用的经验，并按需更新 `docs/demand-com-exp.md`。

需要沉淀的情况：

- 本次遇到现有 rules/skills 未覆盖的坑、边界或判断标准。
- 本次验证出可复用的工程模式、处理顺序或检查项。
- IRIS 编码场景包括持久化类、SQL、HisUI DataGrid、CSP 页面、Broker、GB2312 编码或部署验证经验。
- 已有经验条目再次命中本次需求：追加需求号并 `命中+1`；没有明确需求号时，记录可追溯的任务标题或不更新命中计数。

沉淀要求：

- 先搜索已有条目，能合并就合并，不重复新增。
- 按 `docs/demand-com-exp.md` 的分类和条目格式记录。
- 不写服务器、账号、namespace、远程路径、患者样本等敏感信息。
- 不复制长段命令输出、完整 diff 或一次性排障流水。
- 没有可复用经验时不写；不强制每次需求都沉淀。

## 完成检查

- 已读取 project profile 和通用规则索引。
- 已按任务范围读取对应专项 skill/rule。
- 未把服务器、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类写入插件。
- 上传、编译、远程写入、数据库变更没有在用户未明确要求时执行。
