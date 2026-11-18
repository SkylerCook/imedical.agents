---
name: imedical-ui
description: 按公司 UI 规范开发、适配或查询标注，覆盖 BS 端 IHOS 海蓝、PURE 天蓝与明确采用活力蓝的手机端页面。用于布局、控件、视觉状态和规范出处。
---

# 公司 UI 规范适配

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

用户只要求截图/浏览器评审或找 UI 问题时，使用 [imedical-ui-review](../imedical-ui-review/SKILL.md)，按评审范围交付发现。

## 确定当前目标

1. 读取项目入口、启用状态和 [共性规则](../../rules/imedical_ui.md)，确认页面、技术栈、修改范围和适用基准。BS 适配需兼容两套风格时，分别核对 IHOS 海蓝和 PURE 天蓝。
2. 明确采用公司手机端活力蓝时，读[活力蓝手机端参考](../../references/vital-blue-mobile.md)中对应的控件、布局或宿主章节。BS 页面按下表读取当前对象：

| 触发场景 | 参考 |
|---|---|
| 外框、查询组合、分栏、页签、导航、滚动与页面组合 | [布局与导航](../../references/layout-and-navigation.md) |
| 标签、必填表现、输入/选择、按钮主次、标题/操作图标与工具栏 | [表单与操作](../../references/forms-and-actions.md) |
| 表格、分页、状态、弹窗、提示与渐变 | [表格与反馈](../../references/tables-and-feedback.md) |
| 登录、首页、关于、申请组合、步骤条或补充构件 | [页面模式与补充构件](../../references/page-patterns-and-supplementary.md) |
| 操作表达、组件选型、内部分组或跨风格复用、配色差异 | [风格差异](../../references/style-differences.md#按对象语义判断共性) |
| 新参数提炼、有效变体/paint 判断、规则依据不明或原型批次变化 | [有效图层与来源](../../references/source-catalog.md#有效图层与参数提炼) |

完成条件：能指出本次采用的要求、适用条件、来源及尚需业务核对的部分；已有台账继续使用。

## 完成适配与核对

3. 标明采用条款的适用范围与证据类型。BS 双风格共用归属按[对象语义](../../references/style-differences.md#按对象语义判断共性)确定。活力蓝按具体宿主和构件变体适配。沿目标工程的技术栈和组件完成授权范围内的实现，IRIS CSP＋HISUI 使用 `iris-ui`。在现有记录中补充共性落点、差异出处和业务待核对项。
4. 按本次适用基准逐一核对布局、控件状态及动态阶段。活力蓝按[开发与评审核查](../../references/vital-blue-mobile.md#开发与评审核查)在实际设备及容器核对相关交互。记录可观察结果、未测项和人工评审状态。

完成条件：采用的规则均已落到实际对象并有对应核查，缺口注明原因和下一步；共性保留一份，差异限定适用范围。若任务仅要求规则查询或只读审查，交付对应出处和差异，不执行页面修改。

## 自然语言查找规范

专题不明确时使用 CapabilityRoot 下 `scripts/knowledge-query.js --project-root <workspace> --query <问题> --domain ui`。BS 查询按需加 `--theme pure|ihos|common`，活力蓝加 `--theme vital-blue`。读取结果的正文与 documentContext，结合 evidence 和引用核实规范、案例及图稿的适用范围。已获外发授权的通用问题可加 `--query-public`；工程私有问题保持本地。

索引与授权见[检索指南](../../../../docs/guides/knowledge-retrieval.md)。已有明确参考时直接读对应章节。

项目默认使用 Markdown 与本地 BM25，无需 Embedding 配置或数据库。已配置 KNOWLEDGE_RAG_CONFIG 私有 JSON 且选装公司索引时，通用并获准外发的问题加 --query-public；可用 --provider 显式选择提供方，默认 company。服务失败返回本地结果及 warnings。选装与配置按检索指南执行。
