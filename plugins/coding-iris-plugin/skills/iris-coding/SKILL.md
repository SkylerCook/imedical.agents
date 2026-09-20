---
name: iris-coding
description: Route IRIS coding requests with unclear frontend/backend boundaries or mixed ObjectScript and CSP/JavaScript/HISUI changes. For a clearly scoped frontend or backend task, use its specialist skill directly.
---

# IRIS Coding

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
| 用户要求从补丁补录 BOSS 需求、可选 Excel 或编号回填 | [iris-demand-entry](../iris-demand-entry/SKILL.md) |
| 用户要求生成提交信息、明确要求提交，或显式调用 iris-demand-commit 的 --plan / --commit | [iris-demand-commit](../iris-demand-commit/SKILL.md)；本地验证完成不自动加载该 skill |

## 修改前

1. 读取目标工程 `.agents/config/iris_project_profile.md`、`.agents/config/plugin_profile.md`、[规则索引](../../rules/iris_coding_index.md)和[通用规则](../../rules/iris_coding_general.md)。复用仍持有且未变化的内容。
2. 按通用规则判定 executionPath、parallelAssessment 和正式 run；guidanceMode 使用共享辅助协议。风险分流不减少命中的硬约束。
3. **需要部署的业务需求，在所属仓库第一次修改前**读取[部署保护的建立会话要求](../../references/deployment-protection.md#建立会话)，完成或复用固定 Git 基线；已有修改、需求号缺失或基线不明时先通过 Question 确认。仅分析或明确不部署的任务不额外建立会话。
4. 定位页面、按钮、JS 调用和后端方法，确认调用链及文件边界；按上表读取命中的专项 skill 和规则。前端修改前执行[条件 i18n 门禁](../../rules/iris_coding_frontend.md#条件-i18n-门禁)，启用状态、信号、规则加载和失败处理均以该节为准。

业务背景、菜单与实现参考按通用规则“自主使用知识资料”按需查询；用户要求刷新菜单资料时转 [iris-menu-sync](../iris-menu-sync/SKILL.md)。涉及远端读取或 SQL 验证时按规则索引读取工作流和目标工程私有连接配置，遵守对应授权边界。

## 实现与验证

1. 沿用现有实现；混合任务先明确前端展示/采集与后端处理/返回契约，再分阶段执行各自专项流程。
2. 前端每个触碰文件修改前后执行字节检测，按[编码策略](../../rules/iris_coding_frontend.md#编码策略)保持 canonical `utf8`，异常停止；HISUI 复用、控件状态和 CSP 验证沿用前端规则。
3. 最终 diff 后再次执行条件 i18n 门禁；命中时完成 owner 规则要求的 helper 静态检查，失败停止。核对接口契约、改动范围与目标验证结果。
4. 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。部署执行转 iris-deploy，已有基线不代替部署授权。

## 完成条件与交付

- 命中的专项规则、字节检查、i18n 门禁和必要验证已完成；缺失验证明确说明限制，未通过的门禁不能报告完成。
- 报告改动范围、验证结果及必要的混合任务接口分工；前端正常时只给一行编码摘要。提交计划与 commit 结果仅在用户要求时按 iris-demand-commit 输出，需求号、标题和默认交付类型不触发提交或追问。
- 业务需求设置 taskKind=business-demand，按[交付生命周期](../../../../agents/_shared/delivery-lifecycle.md)进入 acceptance-pending 并给出最短验收步骤。仅在用户验收后且存在框架缺陷、规则冲突、可复用经验或用户要求时做只读 feedback 审查；任何写入逐项授权。
- 纯框架维护使用 taskKind=framework-maintenance 和[维护生命周期](../../../../agents/_shared/maintenance-lifecycle.md)，不进入业务验收或 feedback 流程。
