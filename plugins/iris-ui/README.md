# IRIS UI

负责 [imedical-ui](../imedical-ui/README.md) 在 **IRIS CSP＋HISUI** 中的落地适配：公共 head/body 接入、资源加载、控件 API、布局及初始化生命周期。公司共性规范和截图/浏览器评审归通用层；本层先复用 HISUI 和工程公共能力，保留业务契约。

## 使用

通过现有安装/更新流程取得插件，调用 [iris-ui-init](skills/iris-ui-init/SKILL.md) 核对并启用，再使用 [iris-ui](skills/iris-ui/SKILL.md)。目录存在只表示 available；启用沿用项目的 plugin_profile，不新增 UI 连接或工程配置。

0.2.0 正式依赖 `imedical-ui` 和 `coding-iris-plugin`，两者须 enabled 且版本兼容。已有工程从 0.1.0 升级时，按正常流程核对并接入 `imedical-ui`，同步项目注册表和 profile，再完整刷新 Context；显式禁用或冲突保持待处理。更新器出现 `plugin-dependency-missing` 时可能仍返回 0，必须核对状态及实际入口，不能只看退出码。只做 UI 评审使用 [imedical-ui-review](../imedical-ui/skills/imedical-ui-review/SKILL.md)。未来 Java/HTML 适配插件直接依赖通用层，不经过 IRIS 层。

模块部署遵循[框架更新 runbook](../../docs/update-agents.md)和[Overlay 两阶段流程](../../docs/workspace-overlay.md)：共享能力在所属根工作区更新一次，再由项目既有模块管理入口以 `-NoPull` 刷新指定模块并验证。源仓未发布或更新受阻时，报告正式部署待完成；手工同步和单独生成薄索引不算框架更新部署。

0.2.1 按共享测试协议明确验证范围与停止条件，补充空工具栏及模板预览边界案例；同时取得 coding-iris-plugin 0.20.2 的条件化前端验证指导。已明确的局部修改不默认建立浏览器矩阵，未测效果保留待验。沿正常更新取得，无业务资源、连接配置或旧文件清理。

例如：“按这组标注调整申请页，保留业务逻辑”“定位折叠侧栏后留白，检查其它主题是否受影响”。纯后端需求继续使用原编码入口；本插件不取代通用前端编码规范。

## 按需资料

- [标注读取](references/design-annotations.md)：确认画板、尺寸、视觉目标与业务边界。
- [布局生命周期](references/layout-lifecycle.md)：公共接入、承载留白、动态尺寸、首屏及重复打开。
- [已验证案例](references/verified-cases.md)：有前后对照的匿名机制与适用限制。
- [UI 任务模板](templates/ui-task.md)：较长任务需要落盘时复用；已有台账可直接补充相应字段。

编码与 HISUI 选型复用 [iris-frontend-coding](../coding-iris-plugin/skills/iris-frontend-coding/SKILL.md)，验证及交付复用 [testing-protocol](../../agents/_shared/testing-protocol.md)。工程图稿、截图和完整需求台账留在目标工程。

## 只读浏览器测量

[collect-ui-metrics.js](scripts/collect-ui-metrics.js) 提供 `collectUiMetrics(options)`。调用者先明确目标 frame，再使用该 frame 中已有的全局函数，或将独立函数源码交给浏览器工具的只读 `evaluate`，显式调用：

```javascript
collectUiMetrics({
    targets: [
        { name: "query-panel", selector: "#queryPanel" },
        { name: "content-panel", selector: "#contentPanel" }
    ]
});
```

`name` 使用不含业务标识的技术标签。测量函数只读取尺寸、滚动和限定计算样式；零匹配或多匹配报告未测量，由调用者核对目标。输出不包含输入 selector、DOM 文本、表单值或 URL。真实页面优先将独立函数源码交给现有工具的只读 evaluate，不安装全局函数；整份脚本会注册 `window.collectUiMetrics`，仅供独立夹具或已明确需要该入口的环境。无需把脚本加入业务页面 asset；Node 可使用其 CommonJS 导出，浏览器加载方式按当前工具核实，不假定动态 import 可用。测量结果辅助诊断，不能判定与标注视觉一致或代替用户验收。截图、Console、Network 和实际加载版本仍由适用工具按当前任务核对。

源仓可运行 `node --test scripts/tests/iris-ui.tests.js`。真实浏览器夹具使用 `node scripts/tests/fixtures/iris-ui-server.cjs`，仅监听回环地址并输出入口；在交互终端输入 `stop` 结束。夹具覆盖匿名控件与布局，执行器仍使用当前宿主工具。

## 部署与验证边界

部署使用 [iris-deploy](../coding-iris-plugin/skills/iris-deploy/SKILL.md) 和现行[部署契约](../coding-iris-plugin/references/deployment-protection.md)。direct 不合并部署开始前已有的服务器差异；已有 guarded 能力有需求及基线前提。项目要求增量保留他人修改时，先核对现行能力能否满足，缺少可靠基线或出现冲突即停在写入前；本插件没有新增自动合并拦截器。内容相同是否编译按实际部署模式和项目约定判断，不能把跳过上传当成跳过编译。

专项测试及平台验证以仓库实际测试结果为准。浏览器测量通过只证明目标范围的技术结果；真实环境、业务链路与用户视觉验收分别交付。后续新增经验先补适用范围和对照证据，再决定是否提升为共性规则。
