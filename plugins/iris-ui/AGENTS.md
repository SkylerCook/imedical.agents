# IRIS UI

本插件所有自有 skill 的帮助请求（`--help`、查看用法）先按[统一帮助协议](../../docs/guides/capability-help.md)展示帮助并结束，优先于插件启用、连接检查和业务前置。源定义随正常能力包更新分发，已有 thin-index 继续读取 source；帮助不自动启用插件。

本插件负责把 [imedical-ui](../imedical-ui/AGENTS.md) 的公司 UI 规范落实到 IRIS CSP＋HISUI，处理公共接入、资源、布局生命周期及只读测量。公司规范和截图/浏览器评审归 imedical-ui；具体源码与业务契约以目标工程为准。

- 日常入口：[iris-ui](skills/iris-ui/SKILL.md)；启用入口：[iris-ui-init](skills/iris-ui-init/SKILL.md)。纯 init 不生成薄索引。
- 模块接入及部署先按 [框架更新流程](../../docs/update-agents.md) 和 [Overlay 流程](../../docs/workspace-overlay.md) 执行，薄索引生成不能替代框架更新。
- UI 增量约束的唯一来源：[iris_ui.md](rules/iris_ui.md)。编码、i18n、部署及提交复用 [coding-iris-plugin](../coding-iris-plugin/AGENTS.md)，验证复用 [testing-protocol](../../agents/_shared/testing-protocol.md)。
- `imedical-ui` 与 `coding-iris-plugin` 均须 enabled 且满足 manifest 版本。frontend 直达 rule 也执行同一依赖约束；未来 Java/HTML 适配直接依赖通用层，不依赖本插件。
- 标注、布局生命周期、匿名案例按主 skill 的条件指针读取；实施自检见[布局生命周期](references/layout-lifecycle.md#实施自检)，已验收 UI 业务需求的经验回归见[经验回归入口](references/verified-cases.md#经验回归入口)。不在入口重复正文。
- 业务共性归类、主题条件与共用调用者的最终核对按 UI rule 执行；[只读扫描器](scripts/check-theme-scope.js)提供显式文件候选和覆盖限制，不判违规、不修改业务源码。
- 工程截图、业务数据、连接信息、部署快照和需求台账留在目标工程；本插件只保存脱敏方法、受限样例和可复用工具。

## 维护

修改能力时同步 README、manifest、对应 skill/rule/reference/template、专项测试和 owner 版本。新经验先核实证据与适用条件，再决定是否补规则、案例或项目记录；单点修复不自动成为所有 HISUI 页面的实现要求。

浏览器辅助只测调用者明确指定的目标 frame，不进入 HIS 生产页面的常驻依赖。部署保护由原 owner 维护，本插件不另建传输、合并或会话工具。
