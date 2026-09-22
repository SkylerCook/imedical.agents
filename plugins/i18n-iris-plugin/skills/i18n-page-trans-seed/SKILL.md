
---
name: i18n-page-trans-seed
description: Use when adding multilingual page-level non-dictionary translations to the project-configured page translation seed file with per-language load and rollback methods.
---

# Page Translation Seed — 页面级非字典翻译种子

## 触发条件

当需要把翻译表或“源文案 + 入口主页面 + 目标语言”写入页面级翻译种子类时使用本 Skill。

本 Skill 是页面级非字典翻译种子的入口，支持多目标语言。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. 语言目录规则：优先读取目标工程 `.agents/rules/i18n_language_catalog.md`；引用插件时读取插件 `rules/i18n_language_catalog.md`
3. 页面翻译种子规则：`i18n_page_translation_seed.md`

按条件继续读取：

- 需要生成或校正目标语言译文时，读取 `i18n_translation_quality.md`。
- 涉及编译、加载、服务器校验时，读取工程根目录 `.mcp.json`。
- 需要从服务器反向导出或对比页面翻译时，切换到 `i18n-csp-trans-sync`，不要在本 skill 中重写同步流程。

## 参数

- `targetLanguage`：目标语言代码；默认使用 project profile 配置。
- `termsFiles`：一个或多个翻译表。
- `mainPage` / `mainCsp`：直接输入源文案时必填。
- `batchId`：可选；默认使用 `YYYYMMDDNN`。

## 输出类

canonical 默认类为 `DHCDoc.I18n.PageTranslationSeed`，backend SourceRoot 内相对路径为 `DHCDoc/I18n/PageTranslationSeed.cls`。稳定公共方法默认为 `SetPageTrans` / `KillPageTrans`，语言聚合方法默认为 `Load{LANG}Translation` / `Kill{LANG}Translation`。

canonical 源模板位于 `.agents/plugins/i18n-iris-plugin/templates/DHCDoc/I18n/PageTranslationSeed.cls`。

初始化器应把默认契约写入 project profile；目标工程已有不同且兼容的页面翻译机制时允许覆盖。实际生成时仍从 project profile 读取类路径、类名、单条写入方法、单条回滚方法和聚合方法，不使用未确认占位类，也不扫描目录猜测 SourceRoot。

- 目标类不存在：确认 backend SourceRoot、所属 Git 仓库，以及 `DHCDoc.Util.RegisteredObject`、`DHCDoc.GetData.CT.LG.Language` 依赖存在后，从 canonical 模板创建本地类；不得自动上传或编译。
- 目标类已存在：验证类名、稳定方法签名、幂等冲突保护和逐条回滚，再增量追加批次方法及聚合调用；不得用模板覆盖已有业务批次。

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

字典翻译 SQL 和 XML 模板同步不加入该聚合方法。

## 冲突处理

- 同一 `(language,page,item)` 翻译一致时跳过。
- 翻译不一致时输出冲突清单，不自动覆盖。
- 多入口主页面按入口拆成多条，或按 project profile 约定处理。

## 回滚

只生成逐条 Kill。严禁生成按语言根节点或页面翻译根节点整棵删除的回滚逻辑。

## 验证

- 本地静态检查写入/回滚数量、引号转义和方法命名。
- 检查目标语言翻译是否符合 `i18n_translation_quality.md`，并按 ObjectScript 字符串规则正确转义。
- 服务器编译、上传或加载必须有当前运行的显式授权。该授权应由 Coordinator 在需求启动时主动收集；run manifest 已记录且 scope 覆盖本动作时直接消费，不在本阶段重复询问。
- 未授权时只做本地生成和只读验证；覆盖冲突、删除、回滚、目标环境变化或 scope 扩大必须重新确认。
- 从语言目录抽查目标语言映射。
- 抽查若干页面级翻译写入语句。
