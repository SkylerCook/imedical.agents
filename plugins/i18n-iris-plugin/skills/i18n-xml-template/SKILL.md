---
name: i18n-xml-template
description: Translate XML print template defaultvalue text into a target language while preserving XML structure, coordinates, and encoding.
---

# XML Template I18N — XML 打印模版翻译

## 触发条件

- 用户提供 XML 打印模版文件。
- 用户要求翻译模版中的源语言 `defaultvalue` 文案。
- 用户指定目标语言，或未指定时使用 project profile 默认目标语言。

本 Skill 只处理 XML 打印模版，不处理页面级翻译或字典翻译。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. 语言目录规则：优先读取目标工程 `.agents/rules/i18n_language_catalog.md`；引用插件时读取插件 `rules/i18n_language_catalog.md`
3. 目标语言翻译质量规则：`i18n_translation_quality.md`
4. 如需同步生成页面翻译表，再读取 `i18n_page_translation_seed.md`

## 参数

- `targetLanguage`：目标语言代码；默认使用 project profile 配置。
- `sourceFiles`：一个或多个 XML 模版文本文件。
- `outputDir`：输出目录；未指定时使用 project profile 或 `docs/xmlPrintTemp/`。

## 流程

```text
源 XML 模版
  -> 提取 defaultvalue 源语言文本
  -> 按 targetLanguage 翻译
  -> 保持 XML 结构、坐标、样式不变
  -> 输出 {filename}-{LANG}.txt
```

## 步骤 1：识别待翻译文本

只翻译 `defaultvalue="..."` 属性中的用户可见源语言文本，不翻译以下内容：

| 不翻译 | 示例 | 原因 |
| --- | --- | --- |
| 字体名 | `fontname="宋体"` | 系统配置 |
| 打印机名 | `PrtDevice="打印机名称"` | 系统配置 |
| 编码声明 | `encoding="gb2312"` | XML 元数据 |
| 勾选框符号 | `☐` | 非语言符号 |
| 测试数据 | `1234567890` | 占位数据 |
| URL | `https://...` | 资源路径 |

## 步骤 2：翻译原则

- 源文案稳定：源语言作为唯一 key。
- 目标语言可切换：默认语言从 project profile 读取。
- 翻译质量：按 `i18n_translation_quality.md` 处理医疗术语、目标语言正字法、UI 长度和结构化输出安全。
- 版面优先：译文长度尽量接近源文案，避免打印时溢出或换行。
- 术语一致：同一中文文案在同一目标语言中使用统一翻译。
- 新增文案：映射表中不存在的源文案，按同样原则翻译，并在本次产物说明中补充映射。

## 步骤 3：输出

- 输出路径：`{outputDir}/{filename}-{LANG}.txt`。
- 保持源文件的 XML 结构、坐标、样式属性完全不变。
- 只替换 `defaultvalue` 中的源语言文本。
- 输出文件编码与源文件一致；源文件编码不明确时先确认编码再处理。

## 步骤 4：验证

- 检查输出文件中 `defaultvalue` 是否仍有未翻译的源语言文本。
- 人工检查目标语言文本没有明显溢出、截断或覆盖。
- 不应翻译的系统配置值仍保持原样。
- 同一源文案在同一目标语言中翻译一致。

## 关键约束

1. 只改 `defaultvalue` 属性，不动 XML 结构、坐标、样式。
2. 字体名、打印机名、编码声明等系统配置值保留原值。
3. 目标语言翻译需考虑模版实际打印宽度。
4. 输出文件编码与原文件一致。
5. 不在 `src/` 目录下产生 XML 模版输出，除非用户明确要求。
