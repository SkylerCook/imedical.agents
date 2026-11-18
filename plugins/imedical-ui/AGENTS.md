# iMedical UI

本插件所有自有 skill 的帮助请求（`--help`、查看用法）先按[统一帮助协议](../../docs/guides/capability-help.md)展示帮助并结束，优先于插件启用、连接检查和业务前置。源定义随正常能力包更新分发，已有 thin-index 继续读取 source；帮助不自动启用插件。

本插件是公司 UI 规范的技术栈无关入口。规范要求归本插件，组件选型、页面初始化、框架尺寸及代码实现归目标技术栈的适配能力。

- 开发/规范查询：[imedical-ui](skills/imedical-ui/SKILL.md)；截图或浏览器评审：[imedical-ui-review](skills/imedical-ui-review/SKILL.md)；纯初始化：[imedical-ui-init](skills/imedical-ui-init/SKILL.md)。
- 共性执行约束：[imedical_ui](rules/imedical_ui.md)；具体尺寸、条件和例外按 skill 路由读取 references，不全量加载。
- BS 基准为 IHOS 海蓝与 PURE 天蓝，30 画板沿[来源目录](references/source-catalog.md)定位。明确采用公司手机端活力蓝时读[手机端参考](references/vital-blue-mobile.md)。回查图形参数时核对 paint 开关、透明度、祖先和变体。[有效图层与参数提炼](references/source-catalog.md#有效图层与参数提炼)
- `iris-ui` 正式依赖本插件，负责 IRIS CSP＋HISUI 落地。未来 Java/HTML 适配插件也直接依赖本插件，不经 IRIS 层；本期不创建未来插件。
- 本插件不提供运行 CSS、组件库、浏览器运行器或部署器。工程公共能力优先复用，技术实现通过目标工程既有 owner 完成。
- 资料快照保留公司版权及分发限制。源仓授权接收不等于向公开镜像发布；工程截图、真实业务数据和连接信息仍留目标工程。

维护时核对来源摘要、适用条件、画板覆盖、skill 条件路由及插件版本。按基准分别记录明确文字、构件参数和页面示例。BS 共性和实现归属沿[风格差异](references/style-differences.md#按对象语义判断共性)核对。

业务知识、UI 规范与 HISUI 自然语言查找可使用[轻量混合检索](../../docs/guides/knowledge-retrieval.md)，复用根 scripts、本机授权策略和离线降级。

按需部署时，由 manifest 的 runtimeResources 与 required skill 依赖取得必需 vendor 资源；可选资料随任务触发补装，流程见[插件按需部署](../../docs/guides/plugin-deployment.md)。
