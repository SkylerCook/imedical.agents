# 反馈：HISUI 前端编码样式优先复用与 CSS 索引拆分

- 日期：2026-07-18
- 提交人：xingkaile
- 基于版本：b0faabde775a28bc1ca52eb8c3f04fb5a7075c21
- HIS 需求号：6684541、7079252
- 状态：已应用

## 场景描述

需求 6684541 的病历浏览检查报告/检验结果空状态，需要同时满足业务布局和 HISUI 主题、多语言语义资源复用；需求 7079252 的排班模板 DataGrid 合并单元格需要显示分割线，同时避免写死颜色或通过边框改变布局。两项需求共同暴露出原前端规则偏重控件 API、缺少 HISUI 样式复用和 CSS 源码检索指引的问题。

## 发现的问题

1. 原 `HISUI 优先原则` 主要约束按钮、弹窗、面板和表单控件，没有明确覆盖布局、状态反馈、图标、图片、颜色、边框、间距及多语言样式资源。
2. 控件 API 和 CSS 样式都集中在 `hisui-widget-index.md`，大型图标目录与控件行为索引混杂，开发者不容易判断应查 JavaScript 还是主题 CSS。
3. 缺少跨主题复用顺序和兜底边界，容易直接复制默认主题颜色、图片 URL，或使用 `background`、`border` 简写覆盖 HISUI 已有状态，从而产生主题漂移或布局偏移。
4. 对“控件未提供原生配置但必须补视觉边界”的场景缺少约束，没有明确主题计算值只能作为末级兜底，并需保留非目标边框宽度和样式。

## 问题发现过程

- 读取的框架文件及目的：读取 `plugins/coding-iris-plugin/rules/iris_coding_frontend.md` 确认前端通用约束，读取 `references/hisui-widget-index.md` 判断现有 HISUI 路由范围，并读取 `vendor/hisui/dist/css/` 下的主题和 locale CSS 核对稳定 selector 与资源覆盖。
- 原始指引：原规则要求优先使用 HISUI 控件，并在 API 不确定时查询 widget 索引和 JavaScript 源码，但没有独立的主题、样式、图标和 locale 资源路由。
- 按原始指引执行的实际结果：控件行为可以定位，但视觉资源仍需临时搜索多个主题 CSS；widget 索引同时承载控件 API 和大型图标目录，无法快速判断 owner。
- 与预期不符的具体表现：开发者容易从单一主题复制颜色、边框或图片路径，或用简写属性覆盖 HISUI 已有状态，无法稳定保持多主题和多语言视觉一致性。

## 本次修改说明

### plugins/coding-iris-plugin/rules/iris_coding_frontend.md

- 改了什么：将 HISUI 优先原则扩展到所有前端控件、布局、交互、状态反馈、图标、图片和视觉样式；补充复用顺序、主题值禁写死、简写属性风险和计算样式兜底规则。
- 为什么改：让 HISUI 多主题、多语言和控件结构成为前端实现的默认约束，避免一次性 CSS 破坏主题适配或布局。

### plugins/coding-iris-plugin/references/hisui-style-index.md

- 改了什么：新增独立的 HISUI CSS 样式索引，收录主题与多语言资源路径、跨主题稳定入口、语义空状态类、图标目录、覆盖边界和验证流程。
- 为什么改：为颜色、边框、背景、图标、状态和 locale 资源提供可检索的 CSS owner 入口，与控件 API 索引解耦。

### plugins/coding-iris-plugin/references/hisui-widget-index.md

- 改了什么：聚焦控件 API、JavaScript 行为和框架文本，将主题、样式、图标与多语言资源路由到 `hisui-style-index.md`，并移出完整图标目录。
- 为什么改：明确“控件行为查 widget、视觉资源查 style”的职责边界，降低索引噪声。

### plugins/coding-iris-plugin/rules/iris_coding_index.md

- 改了什么：增加 HISUI 样式、图标、主题和多语言资源的独立路由。
- 为什么改：确保规则入口可以直接发现新的样式索引。

### plugins/coding-iris-plugin/skills/iris-coding/SKILL.md

- 改了什么：在统一编码路由中区分 HISUI 控件/API 与样式/图标/locale 查询，并增加主题适配检查。
- 为什么改：让混合前端任务能在执行前读取正确参考资料。

### plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md

- 改了什么：在前端专项流程和完成检查中加入样式索引路由及 HISUI 主题资源复用检查。
- 为什么改：将样式优先复用落实到前端编码的执行和验收环节。

### plugins/coding-iris-plugin/AGENTS.md

- 改了什么：登记 `hisui-style-index.md` 参考入口。
- 为什么改：保持插件 Agent 入口与实际参考结构一致。

### plugins/coding-iris-plugin/README.md

- 改了什么：分别说明 widget 索引与 style 索引的用途。
- 为什么改：让插件维护者和使用者能快速理解两个索引的分工。

## 验证状态

- [x] 已验证：8 个反馈副本与当前修正后的 owner 文件逐文件一致。
- [x] 已验证：`git diff --check` 通过，无空白错误。
- [x] 已验证：完整图标目录从 widget 索引迁移至 style 索引后内容一致，共 12638 个字符。
- [x] 已验证：索引引用的 HISUI JavaScript、主题 CSS、locale、icons 和 fonts 路径均存在。
- [x] 已验证：插件规则、技能、README 和 AGENTS 共 7 个入口可路由到新样式索引。
- [x] 已验证：未修改用户明确排除的 `src/dental/.agents`。
- [ ] 待验证：HISUI 升级后需复核源码行号和选择器入口；项目存在自定义主题时需基于页面实际加载的 CSS 再验证。

## 适用范围与风险

- 适用范围：所有使用 HISUI 的 CSP、JavaScript 和 CSS 前端编码任务。
- 风险：源码行号会随 HISUI 版本变化；运行期计算样式只适合作为控件无原生配置、无稳定主题类时的末级兜底，不应替代主题语义类。

---

<!-- 维护者处理后填写 -->
## 处理记录

- 处理人：Codex
- 处理日期：2026-07-18
- 处理结果：已应用
- 说明：owner 文件已在 `ca310db0c31a8fbd023dde4f7769b521303fc770` 应用；本轮维护补齐反馈状态、发现过程和源仓/部署态路径边界。
