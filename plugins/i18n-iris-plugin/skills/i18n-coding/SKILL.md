---
name: i18n-coding
description: Apply frontend and backend internationalization coding changes for one file, multiple files, directories, or project scopes while preserving source-language keys.
---

# I18N Coding — 国际化编码改造

## 触发条件

当任务要求对单文件、多文件、目录或整个工程做国际化编码改造时使用本 Skill。

编码改造只保留源语言文案 key，不绑定具体目标语言。源语言、默认目标语言和项目 helper 以 `.agents/config/i18n_project_profile.md` 为准。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. i18n 规则索引：优先读取目标工程 `.agents/rules/i18n_index.md`；引用插件时读取插件 `rules/i18n_index.md`
3. 前端文件读取 `i18n_coding_frontend.md`
4. 后端文件读取 `i18n_coding_backend.md`
5. UI 框架行为不确定时读取 profile 指定的控件索引或源码索引

## 输入范围

支持：

- 单个 CSP / JS / CSS / CLS 等程序文件。
- 多个指定文件。
- 目录。
- 工程范围。

开始前先确认实际文件编码。历史乱码文件只做最小改动。

## 前端改造

- 改造前先判断文本是否属于 UI 框架自动翻译；属于时不改代码，只记录到后续翻译表。
- 静态文案使用 profile 指定的前端静态翻译 helper。
- 带变量文案使用 profile 指定的占位符翻译 helper。
- 已确认由 UI 框架自动翻译的文本不改代码，但记录到后续翻译表。
- 含变量拼接、动态文案、非 UI 框架自动处理文本必须改造。
- datagrid / treegrid 列头 `title: "中文"` 默认属于 UI 框架自动翻译，禁止改成 `$g("中文")`。

## 后端改造

- 页面级后台提示使用 profile 指定的页面级翻译 helper。
- 必须显式页面上下文时使用 profile 指定的显式页面码 helper。
- 表字段/字典展示值使用 profile 指定的字典/表字段翻译 helper。
- 不改变业务流程、权限、校验、持久化或状态流转。

## 产出

- 完成代码改造。
- 列出需进入翻译表的文案范围。
- 标记无法确认的主页面、占位符语义或 UI 框架自动翻译边界。
- 提醒继续执行 `i18n-text-extract` 和对应的翻译种子 skill。
