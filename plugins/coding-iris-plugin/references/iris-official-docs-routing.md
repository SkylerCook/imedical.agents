---
name: iris-official-docs-routing
description: Use when selecting and reading InterSystems IRIS DocBook, Documatic, class reference, or official documentation search sources.
task-affinity: [iris, documentation, web, reference]
related:
  - ../rules/iris_knowledge_lookup.md
---

# InterSystems IRIS 官方文档路由

## 数据源选择

| 已知信息 | 使用方式 |
|---|---|
| 用户提供完整 `docs.intersystems.com` URL | 直接用当前运行器网页读取能力抓取正文 |
| 已知 DocBook `KEY` | 构造对应产品版本的 DocBook URL |
| 已知准确类名 | 优先 `docs_introspect` 核对当前实例；需要说明和示例时再查 Class Reference |
| 只有自然语言问题 | `iris_doc_search` 存在时调用；否则仅搜索 `docs.intersystems.com` |
| 目标 IRIS 版本已知 | 使用对应版本文档，不默认使用 `irislatest` |

## DocBook URL

通用形式：

```text
https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=<KEY>
```

示例：

```text
https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GGBL_structure
```

网页读取后至少核对：

- 页面标题。
- 页面显示的产品和版本。
- 正文是否包含用户查询的章节，而不是只有导航或错误页。
- 页面 URL 中的 `KEY` 是否与目标主题一致。

Claude Code 可能把调用显示为 `Fetch(...)` 或 `WebFetch(...)`。其它运行器使用等价的 Open/Fetch 能力，不在 canonical 中固定工具专属语法。

## Documatic / Class Reference

已知类名时可使用：

```text
https://docs.intersystems.com/iris<version>/csp/documatic/%25CSP.Documatic.cls?LIBRARY=<library>&CLASSNAME=<class>
```

注意：

- `%SYS` 在 URL 中编码为 `%25SYS`。
- `Ens.*` 通常位于 `ENSLIB`。
- Class Reference 页面用于说明和版本文档；当前实例实际方法签名仍应由 `docs_introspect` 核对。

## `iris_doc_search`

- 只有当前 `tools/list` 实际包含 `iris_doc_search` 时才调用。
- 它用于搜索 InterSystems 官方文档，不等同于 `iris_doc`。
- 仓库内置 `iris-agentic-dev 0.9.3` 当前包含该工具；其它运行版本仍必须先检查 `tools/list`，不得仅凭仓库版本假设可用。
- 不在仓库中硬编码 Algolia key、临时搜索凭据或其它可能轮换的站点实现细节。

## 版本与冲突处理

- 从目标实例获取产品版本；不要用文档页面版本反推实例版本。
- 目标实例版本与文档不同：在结论中并列写明。
- 当前实例没有某方法但新版本文档存在：说明它可能是版本新增，不能建议直接在旧实例调用。
- 当前实例存在自定义或已弃用方法而官方文档没有：报告实例事实，不把它包装成官方推荐。

## 失败处理

- 网页读取只有导航壳：尝试当前运行器的浏览器/渲染读取能力或官方文档搜索。
- 页面返回 404：核对产品版本和 `KEY`，再搜索官方域名。
- 官方页面暂时不可访问：保留 URL 和失败原因，使用当前实例元数据回答可确认部分。
- 不抓取或大段复制官方文档；只提取回答问题所需的短摘要和链接。
