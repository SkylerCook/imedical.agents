---
name: i18n-text-extract
description: Use when extracting user-visible source-language text from frontend or backend program files into target-language i18n term tables.
---

# I18N Text Extract — 程序文件需翻译文本提取

## 触发条件

当任务要求从程序文件中提取需翻译文本，或为国际化改造生成翻译表时使用本 Skill。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. i18n 规则索引：优先读取目标工程 `.agents/rules/i18n_index.md`；引用插件时读取插件 `rules/i18n_index.md`
3. 语言目录规则：`i18n_language_catalog.md`

按条件继续读取：

- 需要生成目标语言译文时，读取 `i18n_translation_quality.md`。
- 前端提取读取 `i18n_extract_frontend.md`。
- 后端提取读取 `i18n_extract_backend.md`。
- 涉及多种数据形态或入口归属不明时，读取 `i18n_field_classification.md`。

## 参数

- `targetLanguage`：目标语言代码；默认使用 project profile 配置。
- `scope`：单文件、多文件、目录或工程范围。
- `mainPage` / `mainCsp`：可选；指定入口主页面时优先作为翻译保存归属。

## 流程

1. 确认 `targetLanguage`，未指定时使用 project profile 默认值。
2. 按文件类型提取用户可见源语言文本。
3. 根据 rules 和 project profile 识别 `frontend-hisui`、`frontend-extra`、`backend-message`、`backend-dict` 等类型。
4. 追踪入口主页面归属；不能确定时填 `需确认`。
5. 对占位符文案写明 `{0}`、`{1}` 等语义。
6. 按 `i18n_translation_quality.md` 生成目标语言翻译。
7. 输出翻译表。

## 输出文件

非字典页面级翻译推荐：

```text
docs/i18n_terms_{LANG}_YYYYMMDD_HHMM.md
```

字典翻译推荐：

```text
docs/i18n_terms_{LANG}_dict_YYYYMMDD_HHMM.md
```

实际目录和命名可由 project profile 覆盖。

## 表格格式

| 文件名 | 入口CSP | 位置/类型 | 中文源文案 | 占位符语义 | HIS系统最佳目标语言翻译 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |

## 检查

- JS datagrid 列头和消息提示必须交叉比对。
- UI 框架自动翻译文本即使不改代码也要入表。
- 后台类文案必须追踪到入口主页面。
- 字典翻译入口主页面按 project profile 约定处理，默认留空。
