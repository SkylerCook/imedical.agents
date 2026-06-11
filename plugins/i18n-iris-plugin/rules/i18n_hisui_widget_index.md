---
name: i18n_hisui_widget_index
description: HISUI i18n 自动翻译边界与源码索引，用于判断哪些 HISUI 文案不应重复包裹翻译 helper
task-affinity: [i18n, frontend, hisui, reference, auto-translation]
tags: [i18n, HISUI, frontend, auto-translation, source-code]
category: i18n
related:
  - i18n_coding_frontend.md
  - i18n_extract_frontend.md
createdAt: 2026-04-24
updatedAt: 2026-05-26
---

# HISUI i18n 自动翻译边界索引

本文只记录 HISUI 与 i18n 相关的自动翻译边界和源码确认入口，不作为通用前端编码指南。

执行前先读取 `.agents/config/i18n_project_profile.md`，确认目标工程是否使用 HISUI。

| 项目 | 值 |
|---|---|
| **源码文件** | `.agents/vendor/hisui/dist/js/jquery.hisui.js` |
| **用途** | 确认 HISUI 自动翻译边界，避免重复包裹 helper |

## 核心原则

- HISUI 已自动翻译的文案，编码阶段不再包 `$g()`、`$trans()`、`#(..Get())#` 或其它 helper。
- HISUI 自动翻译文本仍必须进入翻译表，通常标记为 `frontend-hisui`。
- 是否自动翻译不确定时，先查 `.agents/vendor/hisui/dist/js/jquery.hisui.js`，再决定是否改代码。
- 含变量、HTML、动态拼接或框架会跳过的文本，按 `i18n_coding_frontend.md` 判断是否需要额外处理。

## 常见自动翻译边界

- `datagrid` / `treegrid` 列头 `title: "中文"` 默认属于 HISUI 自动翻译文本。
- `panel` / `window` / `dialog` 等容器标题通常由 HISUI 处理，改造前应查源码确认是否调用翻译函数。
- `$.messager.alert()`、`confirm()`、`prompt()`、`progress()` 等消息文本可能存在 HISUI 自动翻译处理。
- `$.messager.popover()` 和元素 `popover` 需要区分入口；带 HTML 或动态内容时不要只依赖框架自动翻译。
- `tooltip` / `popover` 中含 HTML 标签且被框架翻译函数跳过的文案，应按前端 i18n 规则做额外处理。

## 提取与编码要求

- `datagrid` / `treegrid` 列头保持源语言 `title` 值，不得仅因提取翻译表而改成 `$g("中文")`。
- HISUI 自动翻译文本在提取阶段进入翻译表，类型记为 `frontend-hisui` 或 project profile 指定的等价类型。
- 已确认非 HISUI 自动翻译的静态文本，按 `frontend-extra` 处理。
- 目标语言翻译生成时仍需读取 `i18n_translation_quality.md`。

## 源码确认入口

以下行号只作为当前 HISUI 版本的快速定位线索。使用前应在 `.agents/vendor/hisui/dist/js/jquery.hisui.js` 中重新搜索确认。

| 关注点 | 搜索建议 |
|---|---|
| HISUI 翻译函数 | `getTrans`、`$.hisui.getTrans` |
| datagrid 列头 | `.fn.datagrid`、`title`、`getTrans` |
| treegrid 列头 | `.fn.treegrid`、`title`、`getTrans` |
| messager | `$.messager`、`alert`、`confirm`、`prompt`、`progress` |
| popover | `popoverSrcMsg`、`$.messager.popover`、`.fn.popover` |
| tooltip | `.fn.tooltip`、`content`、`getTrans` |

## 禁止事项

- 不把本文件扩展成通用 HISUI 控件选型或前端编码手册。
- 不在本文件写服务器、namespace、远程路径、业务页面清单或当前工程绝对路径。
- 不因 HISUI 文案需要入翻译表，就要求编码阶段重复包翻译 helper。
