# IRIS UI

本插件负责 IRIS/HISUI 页面改造的方法与只读测量辅助。具体源码、主题、原型和业务契约以目标工程当前事实为准。

- 日常入口：[iris-ui](skills/iris-ui/SKILL.md)；启用入口：[iris-ui-init](skills/iris-ui-init/SKILL.md)。纯 init 不生成薄索引。
- 模块接入及部署先按 [框架更新流程](../../docs/update-agents.md) 和 [Overlay 流程](../../docs/workspace-overlay.md) 执行，薄索引生成不能替代框架更新。
- UI 增量约束的唯一来源：[iris_ui.md](rules/iris_ui.md)。编码、i18n、部署及提交复用 [coding-iris-plugin](../coding-iris-plugin/AGENTS.md)，验证复用 [testing-protocol](../../agents/_shared/testing-protocol.md)。
- 标注、布局生命周期、匿名案例按主 skill 的条件指针读取；不在入口重复正文。
- 工程截图、业务数据、连接信息、部署快照和需求台账留在目标工程；本插件只保存脱敏方法、受限样例和可复用工具。

## 维护

修改能力时同步 README、manifest、对应 skill/rule/reference/template、专项测试和 owner 版本。新经验先核实证据与适用条件，再决定是否补规则、案例或项目记录；单点修复不自动成为所有 HISUI 页面的实现要求。

浏览器辅助只测调用者明确指定的目标 frame，不进入 HIS 生产页面的常驻依赖。部署保护由原 owner 维护，本插件不另建传输、合并或会话工具。
