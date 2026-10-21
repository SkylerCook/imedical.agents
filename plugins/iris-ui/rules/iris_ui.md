---
name: iris_ui
description: 将 imedical-ui 规范落实到 IRIS CSP＋HISUI 的公共接入、布局、生命周期与主题适配规则。
task-affinity: [iris, hisui, frontend, ui]
related:
  - ../../coding-iris-plugin/rules/iris_coding_frontend.md
  - ../references/design-annotations.md
  - ../references/layout-lifecycle.md
  - ../../imedical-ui/rules/imedical_ui.md
---

# UI 增量规则

编码格式、兼容基线、i18n、控件视觉归属和源码检查使用 [IRIS 前端规则](../../coding-iris-plugin/rules/iris_coding_frontend.md)；本文件只补 UI 改造判断。

## 依赖与公司规范

- 本入口包括 frontend skill 的直接调用：先核对当前 Context 的 `imedical-ui` 与 `coding-iris-plugin` 均为 enabled，且实际版本满足本插件 manifest。缺失、available、disabled 或版本不兼容时，将 UI 实施标为待接入，沿[框架更新流程](../../../docs/update-agents.md)处理；保留显式禁用，不自行改启用集合。
- 依赖满足后读取 [公司 UI 共性规则](../../imedical-ui/rules/imedical_ui.md)，按其中场景指针选取规范。共性和风格差异以通用层为唯一来源，本层不复制一套规范。
- 本层关注 CSP/CSR、公共 head/body、资源链和 HISUI API/尺寸生命周期。采用 `DOC:HEAD` / `docBodyAttr` 的工程核对正确输出及实际生效，其它 IRIS 接入按当前源码查证，不写死具体业务目录。

## 修改前

- 从实际页面追踪公共 head、body 属性、主题与自适应的接入关系，再判断页面缺口。核对公共接入是正确输出并生效，而非仅在源文件里存在。
- 对照标注提取目标，并记录布局由宿主、公共组件或页面哪层负责。页面任务限定其授权范围；公共源码缺口交给对应 owner，授权后再改。
- 模块内共用样式在已授权任务范围内处理；跨模块或全局公共样式的新增、调整先提交具体影响和拟改内容给用户审核。
- 把展示变更与业务契约分开：字段 ID、事件入口、请求参数、持久化值、权限与状态逻辑以现行实现和需求为准。需要改变业务含义时先明确范围。

## 布局与主题

- 复用顺序及控件状态按前端规则执行。页面样式限定作用域，只承担公共能力未覆盖的布局或目标视觉；清理冲突覆盖优先于叠加覆盖。
- 分别判定通用布局和主题专属视觉。DOM/CSS 改变了所有主题的容器契约时，尺寸逻辑须覆盖受影响主题；标注专属的配色、分隔线或阴影是否推广，按实际要求确定。
- 沿用原字段分组与动态字典内容，按当前容器及实际控件测量布局。复合单元格、嵌套表格和 iframe 的测量对象须与其空间所有者一致。
- 生命周期修复覆盖实际触发阶段：首次绘制、异步内容、动画收尾、页签显示或重复打开。新增监听与回调保留既有行为，并核对过期回调、销毁与异常释放。

## 证据与交付

- 验证按 [testing-protocol](../../../agents/_shared/testing-protocol.md) 执行；选取与改动原因直接相关的状态及对照。测量脚本只提供技术证据，不替代截图、交互或验收。
- 原型条目、开发自测、部署结果、实际页面诊断与用户验收分别记录。未复现不等于已修复；未测状态保持缺口，因果未证实保持推断。
- 部署按 [现行部署契约](../../coding-iris-plugin/references/deployment-protection.md) 及项目约定执行。需要保留服务器既有差异时，确认适用模式、基线与合并能力；工具缺口不得包装成已自动拦截。
- 工程图稿、截图、需求号、真实数据及部署快照留在项目。可复用经验保留机制、对照和限制，单次观察不升级为普遍禁令。
