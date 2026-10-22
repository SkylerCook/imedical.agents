# iMedical UI

把公司 UI 原型和规范提炼为 AI 可直接使用的规则与按需参考。本期覆盖 **IHOS／海蓝**和 **PURE／天蓝**，业务共性一次适配，确认存在的风格差异按需补齐。

## 使用

通过既有框架更新流程取得能力，按项目 plugin_profile/注册表启用 `imedical-ui`，由框架生成日常 skill 与 rule 薄索引。首次接入直接读 [imedical-ui-init](skills/imedical-ui-init/SKILL.md)；日常调用 [imedical-ui](skills/imedical-ui/SKILL.md)。不新增 UI profile 或连接配置。

例如：“按两套评审规范核对这个查询页，先列共性和差异，保留业务逻辑。”AI 先读共性规则，再按场景选参考，输出有出处的适配点与核查结果。材料只提供一种主题时，仍按[对象语义](references/style-differences.md#按对象语义判断共性)设计业务共性，分别记录实际验证覆盖。已有需求台账/任务记录直接补充，不另建验收状态。

只做评审时使用 [imedical-ui-review](skills/imedical-ui-review/SKILL.md)：可提供截图或指定已打开的浏览器页面，输出定位、观察事实、规范出处、适用风格、建议及证据限制。截图无法证明的交互与未提供风格保持未覆盖；浏览器使用宿主已有能力，不安装第二套运行器。AI 评审与正式 UI 组/用户验收分别记录。

| 需要解决的问题 | 按需参考 |
|---|---|
| 页面外框、查询组合、分栏、导航、页签与滚动 | [布局与导航](references/layout-and-navigation.md) |
| 标签、必填表现、输入选择、按钮主次与工具栏 | [表单与操作](references/forms-and-actions.md) |
| 表格、分页、状态、弹窗、提示与渐变 | [表格与反馈](references/tables-and-feedback.md) |
| 登录、首页、关于、申请组合、步骤条与补充控件 | [页面模式与补充构件](references/page-patterns-and-supplementary.md) |
| 两风格的外框、背景、配色及共性边界 | [风格差异](references/style-differences.md) |
| 证据类型、资料批次、原图与完整图层定位 | [来源与覆盖](references/source-catalog.md) |
| 截图或浏览器评审、问题归因与报告 | [评审方法](references/review-method.md) |

`rules` 只保留每次任务都需要的判断；详细参数及例外在 references。vendor 是可追溯底稿，日常开发不需要反复读取巨型 data.js，也不从查看器 CSS 推导业务样式。

## 技术栈适配

- 本插件不依赖 IRIS、Java、HTML 框架、HISUI 或服务器配置，负责“应当呈现什么”。
- [iris-ui](../iris-ui/README.md) 正式依赖本插件及 coding-iris-plugin，负责 IRIS CSP＋HISUI 中“如何接入和实现”。
- 未来 `java-ui` / `html-ui` 可直接依赖本插件，复用公司规则，各自处理技术栈接入；不建立当前尚无需求的适配插件。
- HISUI 已覆盖的控件视觉、状态、图标及尺寸 API 由 HISUI 接管；其他技术栈同样先用工程已有组件和公共能力。

模块内共用样式在已授权业务范围内处理；跨模块或全局公共样式的补充/调整，先提交具体缺口、影响和拟改内容供用户审核。规范中的业务交互要求与现行契约不同时，保留待业务核对项。

## 接入、更新与验证

按 [框架更新流程](../../docs/update-agents.md)接入；Overlay 先更新共享 capability 一次，再通过项目模块管理入口 `-NoPull` 刷新并验证。`iris-ui` 0.2.0 起要求本插件已 enabled；已有工程必须同时核对注册表和 profile 的依赖启用集合，显式 disabled 或身份冲突不绕过。

源仓测试：`node --test scripts/tests/imedical-ui.tests.js scripts/tests/iris-ui.tests.js`。检查覆盖来源字节、30 画板、引用图层、文档路径、依赖拓扑和隔离 Context 的发现行为。文档或薄索引检查不能替代真实模型读取、业务页面运行或 UI 评审。

原始证据见 [vendor 说明](../../vendor/imedical-ui-standards/README.md)。本期没有新增查询 CLI、自动 CSS 生成、完整查看器、业务页面补丁或自动部署。
