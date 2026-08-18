---
name: cure-form-responsive-compatibility
description: CA/CR 治疗表单响应式改造的 HISUI radio DOM、公共样式与旧 WebView 兼容验证参考
task-affinity: [iris, cure, frontend, hisui, responsive, compatibility, reference]
tags: [CA, CR, HISUI, radio, responsive, WebView]
category: frontend
related:
  - ../skills/cure-form-responsive/SKILL.md
  - ../rules/cure_form_deploy.md
createdAt: 2026-08-18
updatedAt: 2026-08-18
---

# 治疗表单响应式兼容参考

## DOM 契约

HISUI 处理 radio 后，页面可能同时存在原生生成的 `label.radio` 和业务模板的语义标签。已验证的业务形态包括：

- 普通/通用评估模板：`label.radio` 与 `label.m-label-box` 配对。
- 表格评估模板：`label.radio` 与 `label.i-label-box` 配对。

响应式转换必须保留对应 `input` 的 `id/name/value`、原生 `label.radio`、业务语义标签及其相对配对关系。不得为了消除重复圆圈删除节点、改名、拆散配对或改变保存值。

## 公共样式边界

公共响应式样式的实际文件位置由目标工程配置或页面已有资源引用确定，不应写入插件规则。它只保存跨表单复用的响应式和 HISUI 兼容契约；禁止加入 moduleId、业务根 ID、专属颜色、业务矩阵或仅由单一表单使用的 class。

表单专属规则写入独立业务 CSS。宿主不支持直接声明 stylesheet 时，可以由规格声明的表单 JavaScript 根据已加载的公共响应式样式 URL 推导目标资源并幂等追加外部 `<link rel="stylesheet">`；不得拼接 `<style>` 或 CSS 文本，且必须使用内容哈希更新浏览器缓存。部署静态资源 basename 必须使用语义明确的 camelCase 且不超过 24 个字符；业务标识过长时只缩短资源名，不修改稳定业务标识。

公共样式需要重绘 radio 时，只能在“浏览器支持条件选择器”和“当前 `label.radio` 后确实存在完整 `i-label-box` 或 `m-label-box` 配对”同时成立时处理。推荐将条件规则包在 `@supports selector(...)` 内，并用完整配对选择器限制作用域。

禁止无条件对所有 `label.radio` 使用 `display:none`、隐藏伪元素或覆盖点击区域。旧 WebView 不支持条件选择器时，不执行重绘，让 HISUI 原生 radio 保持可见、可点和可回显。

插件不保存公共 CSS 副本。实际文件编码、上传与编译遵循目标项目配置并委托 `coding-iris-plugin`。

验收门禁必须同时扫描开发源文件与实际部署副本；任一副本发现表单专属选择器、两份公共样式语义不一致或目标编码损坏时，停止部署。

删除或迁移公共 selector 时，不能只验证新表单。应读取代表性已改造表单的服务端快照并扫描 selector 依赖；若仍有依赖，先发布受影响表单的独立 CSS 和幂等外链 loader，回归通过后再单独发布公共 CSS 清理。

## 回归矩阵

| 场景 | 必查项 |
|---|---|
| 普通布局 `m-label-box` | 输入圆圈可见；点击文字和圆圈都能更新 `input.checked` 与 HISUI 选中态 |
| 表格布局 `i-label-box` | 圆圈不消失、不挤压字段；单元格内可点击并正确回显 |
| 未配对原生 radio | 不被公共样式隐藏，仍使用 HISUI 原生渲染 |
| 旧 WebView | 不依赖不受支持的选择器；fallback 可见、可点、可保存 |
| 手机/PDA/PAD | 无横向溢出；选中态颜色、圆点和文字保持同步 |

验收至少覆盖 `360/390/430/768/810/1024/1080/1194/1280`。完整预览的浏览器探针必须同时确认六类资源请求成功、`jQuery` 与 `$.parser` 可用、HISUI panel 已初始化、存在 radio 时生成对应 `label.radio`、无横向溢出且无运行时错误。九档结果通过 `preview-check` 汇总为哈希绑定凭证；浏览器模拟只证明布局与事件前置条件，旧 WebView 和触控分支仍需目标 HIS 或真实设备验证。
