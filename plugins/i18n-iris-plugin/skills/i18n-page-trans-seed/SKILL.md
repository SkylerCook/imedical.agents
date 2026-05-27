---
name: i18n-page-trans-seed
description: Add multilingual page-level non-dictionary translations to the project-configured page translation seed file with per-language load and rollback methods.
---

# Page Translation Seed — 页面级非字典翻译种子

## 触发条件

当需要把翻译表或“源文案 + 入口主页面 + 目标语言”写入页面级翻译种子类时使用本 Skill。

本 Skill 是页面级非字典翻译种子的入口，支持多目标语言。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. 语言目录规则：优先读取目标工程 `.agents/rules/i18n_language_catalog.md`；引用插件时读取插件 `rules/i18n_language_catalog.md`
3. 页面翻译种子规则：`i18n_page_translation_seed.md`
4. 目标语言翻译质量规则：`i18n_translation_quality.md`
5. 涉及编译、加载、服务器校验时读取工程根目录 `.mcp.json`

## 参数

- `targetLanguage`：目标语言代码；默认使用 project profile 配置。
- `termsFiles`：一个或多个翻译表。
- `mainPage` / `mainCsp`：直接输入源文案时必填。
- `batchId`：可选；默认使用 `YYYYMMDDNN`。

## 输出类

输出类路径、类名、单条写入方法、单条回滚方法、聚合方法均从 project profile 读取。

写入调用使用 profile 指定的全类名形式，示例形态：

```objectscript
Do ##class(<SeedClass>).<SetMethod>("<LANG>","<page>","<source>","<translation>")
Do ##class(<SeedClass>).<KillMethod>("<LANG>","<page>","<source>")
```

## 方法命名

增量批次方法命名从 project profile 读取。推荐形态：

- `Save{LANG}Translate{YYYYMMDDNN}()`
- `Kill{LANG}Translate{YYYYMMDDNN}()`

方法名必须是合法运行时标识，不使用运行时不支持的字符。

## 聚合方法

新增批次后同步更新 project profile 指定的语言聚合方法。推荐形态：

- `Load{LANG}Translation()`
- `Kill{LANG}Translation()`

## 冲突处理

- 同一 `(language,page,item)` 翻译一致时跳过。
- 翻译不一致时输出冲突清单，不自动覆盖。
- 多入口主页面按入口拆成多条，或按 project profile 约定处理。

## 回滚

只生成逐条 Kill。严禁生成按语言根节点或页面翻译根节点整棵删除的回滚逻辑。

## 验证

- 本地静态检查写入/回滚数量、引号转义和方法命名。
- 检查目标语言翻译是否符合 `i18n_translation_quality.md`，并按 ObjectScript 字符串规则正确转义。
- 用户明确要求时，才按 `.mcp.json` 映射的 IRIS 编译能力编译种子类。默认不做服务器编译、上传或加载。
- 从语言目录抽查目标语言映射。
- 抽查若干页面级翻译写入语句。
