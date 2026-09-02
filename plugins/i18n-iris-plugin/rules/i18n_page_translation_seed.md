---
name: i18n_page_translation_seed
description: Use when generating, saving, loading, or rolling back page-level non-dictionary translation seed data.
task-affinity: [i18n, page-translation, seed, objectscript]
related:
  - i18n_language_catalog.md
---

# 页面级非字典翻译保存规则

执行本规则前必须先读取 `.agents/config/i18n_project_profile.md`。涉及服务器查询、编译、上传或加载时，还必须读取工程根目录 `.mcp.json`。

## 存储位置

页面级非字典翻译默认沿用当前工程存储结构，除非项目 profile 明确覆盖：

```objectscript
^websys.TranslationD("PAGE", langId, pageCode, chineseSourceText)=targetText
```

约束：

- `langId` 从语言目录解析；如果目标工程覆盖为其它语言标识，以 profile 为准。
- `pageCode` 是入口主页面。
- `chineseSourceText` 是源语言文案 key。
- `targetText` 是目标语言翻译。
- 迁移到新工程时不要主动改存储结构；仅当目标工程已有不同页面翻译机制时才调整 profile。

## 语言支持

- 默认目标语言从项目 profile 读取。
- 更多语言从项目语言目录读取。
- profile 可提供兜底映射，但不得替代目标环境语言目录校验。

## 种子类

页面翻译种子采用以下 canonical 默认契约：

- ObjectScript 类名：`DHCDoc.I18n.PageTranslationSeed`。
- backend SourceRoot 内相对路径：`DHCDoc/I18n/PageTranslationSeed.cls`。
- canonical 模板：`.agents/plugins/i18n-iris-plugin/templates/DHCDoc/I18n/PageTranslationSeed.cls`。
- 单条写入/回滚：`SetPageTrans(languageCode,page,item,translation)` / `KillPageTrans(languageCode,page,item)`。
- 语言聚合：`Load{LANG}Translation()` / `Kill{LANG}Translation()`。

初始化器应把这些默认值写入项目 profile。目标工程已验证存在不同且兼容的页面翻译种子机制时，允许由 profile 覆盖；不得使用 `Package.UploadPageTrans` 等未确认占位类。最终种子类路径、ObjectScript 类名、写入方法、回滚方法和聚合方法仍以项目 profile 为执行事实来源。

目标类不存在时，页面翻译种子实现任务可从 canonical 模板创建本地类；创建前必须确认 backend SourceRoot、目标 Git 仓库和依赖类存在。目标类已存在时只校验稳定接口并增量追加批次/聚合调用，不得用模板覆盖。

生成单条调用时使用 profile 指定的全类名格式，避免依赖当前类上下文。示例形态：

```objectscript
Do ##class(<SeedClass>).<SetMethod>(languageCode,page,item,translation)
Do ##class(<SeedClass>).<KillMethod>(languageCode,page,item)
```

方法名必须是目标语言运行时允许的合法标识。

## 冲突处理

- 同一 `(language,page,item)` 翻译一致时跳过。
- 同一 `(language,page,item)` 翻译不一致时输出冲突清单，人工确认后再写入。
- 多入口页面需要拆分为多条，或按项目 profile 约定记录多入口归属。

## 回滚规则

严禁删除整个语言或整个页面级翻译根节点。只允许按语言、页面、条目回滚：

```objectscript
Kill <pageTranslationStore>(..., language, pageCode, sourceText)
```

具体命令格式以项目 profile 的存储结构为准。

## 翻译表输入

支持从项目 profile 指定的翻译表目录读取，也支持输入“源文案 + 主页面 + 目标语言”生成增量批次。

翻译表中的 `HIS系统最佳目标语言翻译` 列必须按 `i18n_translation_quality.md` 生成；写入种子时按目标输出格式正确转义 `'`、`"`、换行和其它会影响 ObjectScript 字符串的字符。

## MCP 部署注意事项

- `.mcp.json` 是 MCP 连接配置唯一事实来源。
- skill 不硬编码 MCP server 名称、IRIS namespace、远程路径或服务器编号。
- 本地源码完整路径必须由项目声明的 backend SourceRoot 与 profile 中的相对路径解析，不得扫描父目录或 sibling 猜测。
- 如果某些 MCP 工具不会自动读取 `.mcp.json` 中的 namespace，执行时必须从 `.mcp.json` 解析并显式传入。
- 如果某个读取 global 的工具对中文下标不可靠，应使用项目 profile 或经验记录中指定的替代抽象能力，例如命令执行并 `Write $Get(...)`。
- 如果文档加载工具存在路径映射风险，应优先使用 profile 指定的部署链路，例如 SFTP 上传后再编译。
