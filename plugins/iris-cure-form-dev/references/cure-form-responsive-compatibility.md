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

响应式转换必须保留对应 `input` 的 `id/name/value`、原生 `label.radio`、业务语义标签及其相对配对关系。不得为了消除重复圆圈删除节点、改名、拆散配对或改变保存值。完整配对按以下连续三节点识别：

```text
input.hisui-radio.radio-f + label.radio + label.i-label-box/m-label-box
```

业务语义标签的 `for` 必须等于 input 的 `id`；否则视为不完整配对并保持原状，不得猜测或批量改写 DOM ID。

## 公共样式边界

公共响应式样式的实际文件位置由目标工程配置或页面已有资源引用确定，不应写入插件规则。它只保存跨表单复用的响应式和 HISUI 兼容契约；禁止加入 moduleId、业务根 ID、专属颜色、业务矩阵或仅由单一表单使用的 class。

表单专属规则写入独立业务 CSS。宿主不支持直接声明 stylesheet 时，可以由规格声明的表单 JavaScript 根据已加载的公共响应式样式 URL 推导目标资源并幂等追加外部 `<link rel="stylesheet">`；不得拼接 `<style>` 或 CSS 文本，且必须使用内容哈希更新浏览器缓存。部署静态资源 basename 必须使用语义明确的 camelCase 且不超过 24 个字符；业务标识过长时只缩短资源名，不修改稳定业务标识。

公共样式需要重绘 radio 时，只能在“浏览器支持条件选择器”和“当前 `label.radio` 后确实存在完整 `i-label-box` 或 `m-label-box` 配对”同时成立时处理。推荐将条件规则包在 `@supports selector(...)` 内，并用完整配对选择器限制作用域。

禁止无条件对所有 `label.radio` 使用 `display:none`、隐藏伪元素或覆盖点击区域。旧 WebView 不支持条件选择器时，不执行重绘，让 HISUI 原生 radio 保持可见、可点和可回显。

旧内核保留原生圆圈仍可能在窄宽度把圆圈与语义文字拆到不同行。目标工程需要兼容这种内核时，可在 HISUI 初始化完成后对上述完整三节点做幂等的原地原子包装，并遵守以下约束：

- 仅在 `CSS.supports("selector(:has(*))")` 不存在或返回 `false` 时启用；现代浏览器继续使用条件重绘分支。
- 包装必须连同 input 一起移动，保持 `input.nextElementSibling === label.radio`，不得克隆节点、重新初始化控件或重绑业务事件。
- 包装容器只承担布局，使圆圈与文字成为不可拆分选项、选项之间仍可自然换行；不得改变 `id/name/value`、缓存标签或保存/回显协议。
- 重复执行不得产生嵌套；不完整配对、`for/id` 不一致及目标表单作用域外的 radio 必须保持原状。

原子包装的具体 class、公共 CSS 文件和初始化函数属于目标工程实现，插件不保存其副本，也不写死工程路径。

插件不保存公共 CSS 副本。实际文件编码、上传与编译遵循目标项目配置并委托 `coding-iris-plugin`。

验收门禁必须同时扫描开发源文件与实际部署副本；任一副本发现表单专属选择器、两份公共样式语义不一致或目标编码损坏时，停止部署。

删除或迁移公共 selector 时，不能只验证新表单。应读取代表性已改造表单的服务端快照并扫描 selector 依赖；若仍有依赖，先发布受影响表单的独立 CSS 和幂等外链 loader，回归通过后再单独发布公共 CSS 清理。

## 回归矩阵

| 场景 | 必查项 |
|---|---|
| 普通布局 `m-label-box` | 输入圆圈可见；点击文字和圆圈都能更新 `input.checked` 与 HISUI 选中态 |
| 表格布局 `i-label-box` | 圆圈不消失、不挤压字段；单元格内可点击并正确回显 |
| 未配对原生 radio | 不被公共样式隐藏，仍使用 HISUI 原生渲染 |
| 旧 WebView | 不依赖不受支持的选择器；fallback 可见、可点、可保存；完整选项的圆圈与文字不拆行 |
| 手机/PDA/PAD | 无横向溢出；选中态颜色、圆点和文字保持同步 |

验收至少覆盖 `360/390/430/768/810/1024/1080/1194/1280`。完整预览必须由 canonical `preview-run` 通过 Chromium CDP 采集；浏览器探针必须同时确认六类资源及 CSS 依赖请求成功、Console 无错误、`jQuery` 与 `$.parser` 可用、HISUI panel 已初始化、存在 radio 时生成对应 `label.radio`、完整三节点配对没有被破坏、无横向溢出且无运行时错误。点击圆圈和文字都要验证 `input.checked`、HISUI 选中态和同名 radio 互斥关系；旧内核分支还要验证包装幂等、未配对节点不变以及圆圈和文字不拆行。

九档结果通过 `preview-check` 汇总为绑定当前 gate、runner、完整 HTML、资源与依赖清单的哈希凭证；旧 gate、缺少 runner 元数据或 manifest 后编辑的页面不得复用。现代 Chromium 无法证明缺少 `:has()` 的旧内核分支；旧 WebView 与真实触控设备证据必须单独记录，不得通过强改 `CSS.supports` 返回值冒充目标内核验收。
