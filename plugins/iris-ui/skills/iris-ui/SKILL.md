---
name: iris-ui
description: 将 imedical-ui 规范落实到 IRIS CSP＋HISUI 页面，处理公共接入、布局优化、主题兼容及生命周期故障。纯评审使用 imedical-ui-review；普通后端、仅业务规则修改和非 IRIS 网页不触发。
---

# IRIS/HISUI UI 改造

## 建立当前事实

1. 读取目标工程入口、插件启用状态和现有 IRIS profile，确认源码、Git/worktree 与修改边界。未启用时说明启用方式，按用户要求使用同插件 init；只读分析不自动写配置。
2. 读取 [UI 规则](../../rules/iris_ui.md)，通过其统一入口核对 `imedical-ui`、`coding-iris-plugin` 已启用且兼容，再加载公司规范。实现复用 [iris-frontend-coding](../../../coding-iris-plugin/skills/iris-frontend-coding/SKILL.md)，核对 CSP 公共加载链、实际主题及已有适配后判定缺口。只做截图或浏览器视觉评审时转 [imedical-ui-review](../../../imedical-ui/skills/imedical-ui-review/SKILL.md)；源码只读核查沿当前范围交付依据与未验证项。
3. 有原型、截图或评审标注时读 [标注方法](../../references/design-annotations.md)，把视觉目标、业务取舍和当前证据分开。按 UI 规则归类共性、有据差异与业务待确认项；只有单主题材料也不默认做主题独占实现。无原型的故障修复先建立前后可观察断言。

完成条件：已定位实际入口与修改层，能说明哪些表现由公共能力负责、哪些是本次页面差异；影响实现的业务问题保持待确认，独立 UI 工作继续。

## 实施与定向验证

4. 保留字段、事件与数据契约，共性复用一套组件和适配入口，主题条件仅包实际差异。遇到首屏、异步填充、侧栏、页签、弹窗或重复打开问题，读 [布局生命周期](../../references/layout-lifecycle.md)。相同机制影响多入口时核对共享调用者。
5. 先按共享协议的[验证范围与停止条件](../../../../agents/_shared/testing-protocol.md#验证范围与停止条件)选定必要检查；需要运行证据时，再按具体风险选择主题、宽度、内容和状态组合。需要只读尺寸辅助时，在明确目标 frame 中显式使用 [collect-ui-metrics.js](../../scripts/collect-ui-metrics.js)；它不采文本、值、URL，也不判断视觉验收。
6. 最终 diff 后按 UI 规则的[最终差异核对](../../rules/iris_ui.md#最终差异核对)检查本次影响的主题限定、helper 和共用调用者，执行一次只读候选扫描并复用有效结果；主题限定变化时核对已有验收基准的 CSS 优先级及动态阶段。修复仍反复失效或准备推广经验时，读 [已验证案例](../../references/verified-cases.md)，不机械套用案例代码。

完成条件：选定技术检查已完成，证据与当前差异匹配，剩余缺口明确；静态检查、匿名夹具、真实页面诊断和用户验收分别陈述。静态交付可以保留视觉或运行待验，不据此声明功能运行通过。

## 交付

需要部署时调用原 owner 的 [iris-deploy](../../../coding-iris-plugin/skills/iris-deploy/SKILL.md)，先核对现行模式与项目的并行修改保护要求；不以 UI 任务隐含部署或业务写入授权。报告最终差异、复用点、实际验证、未测项与恢复信息。用户负责视觉验收时保留待验收状态，技术诊断不冒充其结论。

长任务需要落盘可用 [任务模板](../../templates/ui-task.md)；已有需求台账、测试证据和部署回执优先复用，不生成第二套同义记录。
