# 反馈：HISUI 控件自动解析与手工初始化重复

- 日期：2026-07-23
- 提交人：Codex
- 基于版本：c04650f23ebde8a9d9ed0c8aebf69c82607bdac2
- HIS 需求号：7040009
- 状态：待处理

## 需求上下文

- HIS 需求描述：在修改关联业务记录的界面增加插入、字段变更和删除审计日志，并提供配置与查询能力。
- 涉及入口：业务记录修改入口、审计日志查询页、审计配置页。
- 涉及代码：持久化审计父类及实体触发器、审计配置/查询 BLH-DATA-SQL、两个 CSP 页面及其 JavaScript。
- 数据特征：持久化实体新旧值、字段配置、指针显示值解析、操作人/客户端/调用栈、业务动作映射。

## 发现的问题

1. 前端规则将“使用 HISUI 标准控件”简化成原始 DOM 必须使用 `hisui-combobox`，没有区分 parser 声明式初始化与页面 JavaScript 手工初始化的所有权。
2. 同一 `<input>` 同时带 `hisui-combobox` 并在 ready 回调中执行 `.combobox(options)` 时发生重复初始化，状态和操作下拉显示为空。
3. 当前 HISUI 参考索引的 parser、combobox 行号与 vendor 源码不一致，排查时容易跳到错误位置。
4. 本次运行版本的静态本地下拉需要显式 `url: ""` + `data`，该版本边界未在参考中说明。

<!-- discovery-process -->
## 问题发现过程

- 读取的框架文件及目的：
  - `skills/iris-frontend-coding/SKILL.md`：确认 HISUI 控件复用和源码核对流程。
  - `plugins/coding-iris-plugin/rules/iris_coding_frontend.md`：确认表单控件和验证规则。
  - `plugins/coding-iris-plugin/references/hisui-widget-index.md`：定位 parser、combobox API。
  - `.agents/vendor/hisui/dist/js/jquery.hisui.js`：核对 parser 扫描和 combobox 初始化实现。
- 原始指引：“表单输入使用 `hisui-combobox`、`hisui-validatebox`、`hisui-lookup`、`datebox`、`numberbox` 等标准控件。”
- 按原始指引执行的实际结果：CSP 输入使用 `hisui-combobox`，页面 JavaScript 同时调用 `.combobox(options)`。
- 与预期不符的具体表现：状态、操作等静态下拉为空；将 DOM class 改为 `textbox`、保留单次 JavaScript 初始化后恢复。页面实测同时确认静态数据需要 `url: ""`，不需要额外 `loadData`。

## 本次修改说明

### plugins/coding-iris-plugin/rules/iris_coding_frontend.md

- 改了什么：把 HISUI 标准控件规则细化为“声明式 parser 初始化”和“JavaScript 初始化”二选一；增加重复初始化检查项及静态/异步数据边界。
- 为什么改：防止 agent 机械套用 `hisui-combobox` class 后又在 JS 初始化，造成空下拉或控件状态异常。

### plugins/coding-iris-plugin/references/hisui-widget-index.md

- 改了什么：增加 parser 自动初始化陷阱和本地数据边界；按当前 vendor 源码修正文件总行数、关键控件及全局入口行号，移除当前源码不存在的 `combogridmult` 条目，并更新校验日期。
- 为什么改：让排查能直接命中真实源码，并明确 class 本身具有初始化副作用。

## 验证结果

- [x] 已验证：在 HIS-7040009 审计配置页和日志查询页中，改为 `textbox` + 单次 JavaScript 初始化后下拉正常显示。
- [x] 已验证：静态本地数据保留 `url: ""` + `data`，去掉额外 `loadData` 后显示正常。
- [x] 副作用检查：修正规则不否定声明式 HISUI 控件，只要求同一控件单一初始化所有权；异步字典仍可在接口返回后调用 `loadData`。
- 适用范围：使用 HISUI parser 且页面脚本会手工初始化同一控件的 CSP/HTML 页面；`url: ""` 细节需按目标运行版本复核。

---

<!-- 维护者处理后填写 -->
## 处理记录

- 处理人：
- 处理日期：
- 处理结果：已应用 / 已跳过 / 需讨论
- 说明：
