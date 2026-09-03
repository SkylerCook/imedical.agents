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

涉及 `.csp` / `.js` / `.css` 文件写入时，还必须遵守 `coding-iris-plugin` 的 canonical UTF-8 与 legacy 兼容边界：读取 `.agents/config/iris_project_profile.md` 和 `.agents/plugins/coding-iris-plugin/rules/iris_coding_frontend.md`，并以实际文件字节检测作为最终门禁。

## 适用范围

适用于 CSP、JavaScript、CSS，以及由前端负责渲染的用户可见文本。

编码改造只保留源语言文案 key，不绑定目标语言。运行时按当前语言查询翻译表。

## 编码边界

- 当前前端文件统一保持 canonical UTF-8，修改前后必须通过 UTF-8 字节检查，并禁止调用 GB2312 转换器。
- `project-utf8` 仅作为 `utf8` 的兼容读取别名；只有用户明确指定的历史 `standard-gb2312` 工程才沿用 legacy 检查与转换流程。
- 禁止因为 `$g()`、`$trans()`、模板 helper 或翻译 key 修改而改变目标模式要求的源码编码。
- 每个触碰文件改造前后按 UTF-8 检查；GB2312、UTF-16、unknown、mixed 或配置冲突时停止。

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

翻译 helper 的 key 必须是稳定字面量。静态 helper 只接收静态文案；运行时值必须通过占位符 helper 的后续参数传入，不能拼进 key，也不能使用带插值的模板字符串作为 key。

```javascript
// 错误：key 随运行时快捷键变化，翻译条目无法稳定匹配
$g(PageLogicObj.shortcutKey + " 键打开模板维护")

// 正确：key 稳定，运行时值作为占位符参数传入
$trans("{0} 键打开模板维护", PageLogicObj.shortcutKey)
```

修改前和最终 diff 后，对全部触碰的 JS/CSP 文件运行只读检查器；helper 名称取自 `.agents/config/i18n_project_profile.md`：

```powershell
node .agents/plugins/i18n-iris-plugin/scripts/check-i18n-helper-usage.js `
  --file <path> `
  --static-helper '$g' `
  --placeholder-helper '$trans'
```

多个文件重复传入 `--file`。退出码 `1` 表示动态翻译 key，退出码 `2` 表示参数或文件读取错误，两者都必须停止；不得以“沿用原代码 helper”为理由忽略。

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

最终输出必须说明 helper 稳定 key 静态检查是否执行及结果；未命中任何 JS/CSP helper 时说明不适用。
