# 前端需翻译文本提取规则

## 适用范围

用于从 CSP、JavaScript、CSS 中提取需要进入翻译表的用户可见中文文本。

支持单文件、多文件、目录、工程范围。

## 提取目标

- CSP 普通可见中文。
- CSP HTML 属性：`placeholder`、`alt`、非 HISUI 自动翻译的 `title`、`label`、`data-options` 文案。
- JavaScript `$g("中文")`、`$trans("中文{0}", ...)`。
- datagrid / treegrid 列头 `title: "中文"`。这是提取目标，不是编码改造目标；HISUI 自动翻译列头保持原代码，不包 `$g()`。
- `$.messager.alert`、`confirm`、`popover`、`progress` 中的中文标题、消息、`msg`、`text`。
- tooltip、popover、上传提示、保存/删除/审核提示、打印/导出标题。
- CSS `content` 中的业务中文。

## 类型判断

- HISUI 自动翻译且代码不改：`frontend-hisui`。
- 需要 `$g`、`$trans`、`#(..Get())#` 或其它额外处理：`frontend-extra`。
- CSP `<server></server>` 文案按后端提取规则处理，类型为 `backend-message`。

特别约束：

- datagrid / treegrid 列头 `title: "中文"` 默认归为 `frontend-hisui`。
- 提取时必须记录到翻译表，但不得因此要求编码阶段把列头改成 `$g("中文")`。
- 只有已确认该列头不经过 HISUI 自动翻译时，才标为 `frontend-extra`。

## 入口 CSP 映射

- 主 CSP 自身文案归属自身。
- `*.show.csp` 文案归属引用它的主 CSP。
- JS 文案归属实际引用该 JS 的主 CSP。
- 同一 JS 被多个主 CSP 引用时，为每个主 CSP 分别记录，或在 `入口CSP` 中用分号列出。
- 无法确认时填 `需确认`，备注说明调用链不明。

## 过滤规则

不提取：

- 注释中的中文。
- `console.log` 调试输出。
- 字段名、接口参数名、URL、业务编码。
- `hidden:true` 且确认不可见的 datagrid 列头。

## 翻译表输出

`HIS系统最佳目标语言翻译` 列必须按 `i18n_translation_quality.md` 生成。

默认输出：

```text
docs/i18n_terms_EN_YYYYMMDD_HHMM.md
```

指定目标语言时：

```text
docs/i18n_terms_FR_YYYYMMDD_HHMM.md
```

固定列：

| 文件名 | 入口CSP | 位置/类型 | 中文源文案 | 占位符语义 | HIS系统最佳目标语言翻译 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |

没有占位符时，占位符语义填 `无`。
