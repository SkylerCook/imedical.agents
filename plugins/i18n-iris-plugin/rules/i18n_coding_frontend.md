---
name: i18n_coding_frontend
description: Use when applying frontend i18n changes to CSP, JavaScript, CSS, or frontend-rendered visible text.
task-affinity: [i18n, iris, csp, javascript, frontend, coding]
related:
  - i18n_index.md
  - i18n_hisui_widget_index.md
  - ../../coding-iris-plugin/rules/iris_coding_frontend.md
---

# 前端国际化编码支持规则

执行本规则前必须先读取 `.agents/config/i18n_project_profile.md`，确认当前项目的前端框架、翻译 helper 和自动翻译边界。

涉及 `.csp` / `.js` / `.css` 文件写入时，还必须遵守 `coding-iris-plugin` 的前端编码规则：读取 `.agents/config/iris_project_profile.md` 和 `.agents/plugins/coding-iris-plugin/rules/iris_coding_frontend.md`。i18n 改造不得把历史 GB2312 前端源文件永久保存为 UTF-8。

## 适用范围

适用于 CSP、JavaScript、CSS，以及由前端负责渲染的用户可见文本。

编码改造只保留源语言文案 key，不绑定目标语言。运行时按当前语言查询翻译表。

## 编码边界

- i18n 前端改造会修改源语言文案，必须先确认目标文件实际编码；历史 HIS 前端文件按 GB2312 处理。
- 若原文件为 GB2312，可以使用临时 UTF-8 工作副本辅助编辑，但最终写回源文件必须保持原编码。
- 禁止因为 `$g()`、`$trans()`、模板 helper 或翻译 key 修改，把 GB2312 源文件顺手保存成 UTF-8。
- profile 要求前端 GB2312 时，改造后使用 `.agents/scripts/check-frontend-encoding.ps1 -ExpectedEncoding gb2312 -ErrorOnMismatch` 或等价检查确认未发生编码漂移。

## CSP / 页面模板

- 普通静态可见文本使用 project profile 指定的模板翻译 helper。
- HTML 属性中的可见文本也要处理，例如 placeholder、alt、非框架自动处理的 title。
- 页面中的服务端代码块属于后端程序，按后端编码规则处理。
- 已确认由 UI 框架自动翻译的位置不要再包模板 helper，避免重复翻译。

常见需要模板翻译的位置：

- 普通 DOM 文本、表单标签。
- 原生 `placeholder`、`alt`、非 UI 框架自动处理的 `title`。
- 页面渲染的 CSS `content` 业务文案。

## JavaScript

- JavaScript 文案改造前必须先判断是否属于 UI 框架自动翻译文本。
- 不属于 UI 框架自动翻译的静态可见文本，使用 project profile 指定的 JS 静态翻译 helper。
- 带变量文本使用 project profile 指定的 JS 占位符翻译 helper。
- 不要新增裸源语言拼接提示，应改为占位符翻译。
- 消息标题若确认由 UI 框架自动翻译，可保持源语言标题，但必须进入翻译表。

## UI 框架边界

UI 框架已自动翻译的文本不改代码，但必须进入翻译表，类型记为 `frontend-hisui` 或 project profile 指定的等价类型。

硬性判断：

- `frontend-hisui`：不改代码，只记录翻译表。
- `frontend-extra`：需要按 helper 改代码，并记录翻译表。
- 判断顺序必须是先确认是否 `frontend-hisui`，再决定是否使用 `$g` / `$trans` / 模板 helper。

典型自动翻译位置：

- 框架按钮文本。
- panel / dialog / window 等容器标题。
- checkbox / radio 标签。
- datagrid / treegrid 列头。
- 无变量的框架消息提示文本。

datagrid / treegrid 列头规则：

- 列头 `title: "中文"` 属于 UI 框架自动翻译文本，禁止改成 `$g("中文")`、`$trans("中文")` 或其它 helper。
- 保持中文源文案作为 `title` 值，进入翻译表，类型记为 `frontend-hisui`。
- 只有当列头是非框架渲染、自定义 HTML 拼接、动态变量拼接，或已确认框架不会自动翻译时，才按 `frontend-extra` 处理。

正确示例：

```javascript
{ field: "name", title: "姓名" }
```

错误示例：

```javascript
{ field: "name", title: $g("姓名") }
```

错误原因：这会破坏“源语言作为唯一 key”的稳定性，也可能触发框架重复翻译或导致翻译表提取遗漏。

以下场景按 `frontend-extra` 或 project profile 指定的等价类型改造：

- 有变量拼接。
- 动态生成文案。
- 非 UI 框架自动翻译的 DOM/HTML 属性。
- CSS `content`。
- 含 HTML 标签且会被框架翻译函数跳过的 tooltip 文本。

## CSS

- 独立 `.css` 文件原则上不承载业务文案。
- 页面渲染的 CSS 可以使用 profile 指定的模板 helper。
- 翻译后文本可能变长，不应依赖过窄固定宽度或强制不换行。

## 输出要求

前端改造后必须配合文本提取规则生成翻译表。UI 框架自动翻译文本即使代码未改，也必须进入翻译表。
