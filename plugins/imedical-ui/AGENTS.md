# iMedical UI

本插件是公司 BS 端 UI 规范的技术栈无关入口。规范要求归本插件；组件选型、页面初始化、框架尺寸及代码实现归目标技术栈的适配能力。

- 开发/规范查询：[imedical-ui](skills/imedical-ui/SKILL.md)；截图或浏览器评审：[imedical-ui-review](skills/imedical-ui-review/SKILL.md)；纯初始化：[imedical-ui-init](skills/imedical-ui-init/SKILL.md)。
- 共性执行约束：[imedical_ui](rules/imedical_ui.md)；具体尺寸、条件和例外按 skill 路由读取 references，不全量加载。
- 本期评审基准为 IHOS 海蓝与 PURE 天蓝。原始出处及 30 画板覆盖见 [source-catalog](references/source-catalog.md)。
- `iris-ui` 正式依赖本插件，负责 IRIS CSP＋HISUI 落地。未来 Java/HTML 适配插件也直接依赖本插件，不经 IRIS 层；本期不创建未来插件。
- 本插件不提供运行 CSS、组件库、浏览器运行器或部署器。工程公共能力优先复用，技术实现通过目标工程既有 owner 完成。
- 资料快照保留公司版权及分发限制。源仓授权接收不等于向公开镜像发布；工程截图、真实业务数据和连接信息仍留目标工程。

维护时核对来源摘要、规则适用条件、两基准差异、全部画板覆盖、skill 条件路由及插件版本。公司规范的证据范围与业务共性的实现范围分别判断，归类方法集中于[风格差异](references/style-differences.md#按对象语义判断共性)。明确文字、构件参数和页面示例分别记录；设计器操作不提升为产品要求。
