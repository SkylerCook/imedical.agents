---
name: i18n_language_catalog
description: Use when an i18n task needs target language, language id, or language code resolution.
task-affinity: [i18n, language, catalog, translation]
related:
  - i18n_index.md
---

# 国际化语言目录规则

## 系统事实来源

语言目录来源由 `.agents/config/i18n_project_profile.md` 指定。当前项目可能使用数据库表、全局变量、配置文件或其它目录服务作为事实来源。

页面级翻译需要稳定的语言 id；字典或表字段翻译通常使用语言代码。二者的实际映射必须从项目语言目录解析，不能把某个工程的 id 当作通用规则。

## 默认目标语言

- 默认目标语言以项目 profile 为准。
- Skill 和脚本必须支持 `targetLanguage` 参数。
- 未传 `targetLanguage` 时使用 profile 中的默认目标语言。
- 指定其它语言时，先从语言目录解析语言代码对应的 id 或存储标识；未找到时停止并输出需确认信息。

## 代码约束

- 禁止把某个语言 id 当作通用常量。
- 只有项目 profile 明确提供兜底映射，且目标语言与该映射一致时，才可使用兜底值。
- 页面级翻译写入格式由项目 profile 指定；当前通用形态为：

```objectscript
Set <pageTranslationGlobal>(scope, langId, pageCode, sourceText)=targetText
```

- 字典数据翻译使用语言代码还是语言 id，以项目 profile 指定的存储规则为准。

## 本地配置建议

项目 profile 可以提供常用语言兜底映射，用于离线生成种子或缺少运行时查询时的校验提示。但部署前仍应优先从目标环境语言目录确认实际映射。
