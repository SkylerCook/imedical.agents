---
name: iris-coding
description: Route IRIS coding requests with unclear frontend/backend boundaries or mixed ObjectScript and CSP/JavaScript/HISUI changes. For a clearly scoped frontend or backend task, use its specialist skill directly.
---

# IRIS Coding

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

## 使用时机

前后端边界不明或同时涉及两端时使用本入口；明确的单一专项任务直接读取下表命中的 skill，无需先经过本入口。

| 任务 | 入口 |
|---|---|
| ObjectScript、BLH/DATA/SQL、Broker、Query | [iris-backend-coding](../iris-backend-coding/SKILL.md) |
| CSP、HTML、JavaScript、CSS、HISUI | [iris-frontend-coding](../iris-frontend-coding/SKILL.md) |
| 用户要求部署、上传、编译、SFTP 同步或部署验证 | [iris-deploy](../iris-deploy/SKILL.md) |
| 已提交 DEV 需求移植到独立 PRD 按需导出仓库 | [iris-demand-promote](../iris-demand-promote/SKILL.md)，区别于远端生产部署 |
| 用户明确处理历史 GB2312 工程并要求将临时文件替换回源文件 | [iris-frontend-gb2312-promote](../iris-frontend-gb2312-promote/SKILL.md) |
| IRIS 类、方法签名、宏、SQL 元数据或官方文档查询 | [iris-mcp-lookup](../iris-mcp-lookup/SKILL.md) |
| 用户要求从补丁补录 BOSS 需求、可选 Excel 或编号回填 | [bos-demand-entry](../../../bos-plugin/skills/bos-demand-entry/SKILL.md) |
| 用户要求生成提交信息、明确要求提交，或显式调用 demand-commit 的 --plan / --commit | [demand-commit](../../../demand-delivery-plugin/skills/demand-commit/SKILL.md)；本地验证完成不自动加载该 skill |

## 修改前

先读取当前 ContextRoot 的 `config/iris-development.json`：`developmentMode: offline` 直接按[离线开发协议](../../references/iris-offline-development.md)处理人工源码或完整 XML，本地修改/检查/Review/交付后等待用户现场验证；禁止医院远端读取、执行与部署，也不调用原生 IRIS MCP。缺省或 `connected` 才执行下面的在线条件；未知值停止核对，普通更新不自动切换模式。

当前需求类型为 `project` 且 `contextMode: intent-first-on-demand-export` 时，先读[项目开发协议](../../references/project-demand-development.md)，在需求范围内建立/刷新基线并保护现场；该分支优先于下列默认 direct。类型由用户本次指定或合法项目默认值确定，不能由 contextMode 推导；标版沿既有分支，后续均读取命中的专项规则。

1. 读取目标工程 `.agents/config/iris_project_profile.md`、`.agents/config/plugin_profile.md`、[规则索引](../../rules/iris_coding_index.md)和[通用规则](../../rules/iris_coding_general.md)。复用仍持有且未变化的内容。
2. 按通用规则判定 executionPath、parallelAssessment 和正式 run；guidanceMode 使用共享辅助协议。风险分流不减少命中的硬约束。
3. 非按需导出工程日常开发部署默认 direct，不要求需求号或 Git 基线会话；已有修改不触发基线确认。仅在用户或项目要求 guarded 时，在第一次修改前读取[建立会话要求](../../references/deployment-protection.md#建立会话)。上传、编译仍需明确授权。
4. 定位页面、按钮、JS 调用和后端方法，确认调用链及文件边界；按上表读取命中的专项 skill 和规则。前端修改前执行[UI 条件门禁](../../rules/iris_coding_frontend.md#ui-条件门禁)及[条件 i18n 门禁](../../rules/iris_coding_frontend.md#条件-i18n-门禁)，启用状态、信号、规则加载和失败处理均以各 owner 节为准。

业务背景、菜单与实现参考按通用规则“自主使用知识资料”按需查询；用户要求刷新菜单资料时转 [iris-menu-sync](../iris-menu-sync/SKILL.md)。涉及远端读取或 SQL 验证时按规则索引读取工作流和目标工程私有连接配置，遵守对应授权边界。

## 实现与验证

涉及前端时，修改前加载[前端命名与格式规范](../../references/frontend-coding-format.md)，最终 diff 后复核；混合 CSP 的服务端 ObjectScript 引用其中的 CLS 规范。Review 随 diff 传递适用规范、项目覆盖与兼容基线。

1. 复用现有业务实现与兼容契约，编码风格按各自专项规范执行；混合任务先明确前端展示/采集与后端处理/返回契约，再分阶段执行各自专项流程。
2. 前端每个触碰文件修改前后执行字节检测，按[编码策略](../../rules/iris_coding_frontend.md#编码策略)保持 canonical `utf8`，异常停止；HISUI 复用、控件状态和 CSP 验证沿用前端规则。
3. 最终 diff 后再次执行 UI 条件门禁与条件 i18n 门禁；命中时完成 owner 规则要求的核对及 helper 静态检查，失败停止。核对接口契约、改动范围与目标验证结果。
4. 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。部署执行转 iris-deploy，已有基线不代替部署授权。

## 完成条件与交付

- 命中的专项规则、字节检查、i18n 门禁和必要验证已完成；缺失验证明确说明限制，未通过的门禁不能报告完成。
- 报告改动范围、验证结果及必要的混合任务接口分工；前端正常时只给一行编码摘要。提交计划与 commit 结果仅在用户要求时按 demand-commit 输出，需求号、标题和默认交付类型不触发提交或追问。
- 业务需求设置 taskKind=business-demand，按[交付生命周期](../../../../agents/_shared/delivery-lifecycle.md)进入 acceptance-pending 并给出最短验收步骤。仅在用户验收后且存在框架缺陷、规则冲突、可复用经验或用户要求时做只读 feedback 审查；写入前按[反馈授权](../../../agent-framework-evolution/skills/agent-framework-feedback/SKILL.md#写入授权与自动待审补丁)核对当前有效授权。
- 纯框架维护使用 taskKind=framework-maintenance 和[维护生命周期](../../../../agents/_shared/maintenance-lifecycle.md)，不进入业务验收或 feedback 流程。

## BOS 需求衔接

从已启用 bos-plugin 的 bos-demand-handle 进入时，复用已核对的编号、完整标题、预期行为、范围及用户原始授权，不重复查询或让用户再次输入。仍按本技能决定领域规则与风险深度。验证结论区分静态、本地行为、远端编译、部署回读及用户验收，未执行的检查不得标为通过。BOS 查询归独立插件，本插件不依赖其安装；直接给正文的开发流程保持可用。
