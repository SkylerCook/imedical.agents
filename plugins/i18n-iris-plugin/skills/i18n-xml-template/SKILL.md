---
name: i18n-xml-template
description: Translate XML print template defaultvalue text into a target language with encoding verification, layout-aware short translations, optional coordinate adjustment, and report generation. Use when Codex works on XML print template files whose visible text is stored in defaultvalue attributes.
---

# XML Template I18N - XML 打印模板翻译

本 Skill 只处理 XML 打印模板。核心目标是：翻译 `defaultvalue` 中的用户可见文本，同时避免编码乱码和英文 label/value 版面覆盖。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. 语言目录规则：优先读取目标工程 `.agents/rules/i18n_language_catalog.md`；引用插件时读取插件 `rules/i18n_language_catalog.md`
3. 翻译质量规则：`i18n_translation_quality.md`
4. 如需同步生成页面翻译表，再读取 `i18n_page_translation_seed.md`

## 输入参数

- `targetLanguage`：目标语言代码；默认使用 project profile 配置，通常为 `EN`。
- `sourceFiles`：一个或多个 XML 打印模板文本文件。
- `outputDir`：输出目录；未指定时使用 project profile 或 `docs/xmlPrintTemp/`。

## 输出产物

对每个源文件输出：

- `{filename}-{LANG}.txt`：标准翻译版。只替换 `defaultvalue`，不改坐标。
- `{filename}-{LANG}-layout.txt`：版面适配版。仅在存在覆盖风险或用户要求时生成，可调整静态 label 及其相关动态 value 坐标。
- `{filename}-{LANG}-layout-report.md`：版面风险和调整报告。生成 layout 版时必须生成。

禁止在 `src/` 目录下生成 XML 模板输出，除非用户明确要求。

## 总流程

```text
源 XML 模板
  -> 编码判定与可读性校验
  -> 提取 defaultvalue 用户可见文本
  -> 生成标准译文
  -> 检查 label/value 和同一行字段组版面风险
  -> 必要时生成 layout 版和 report
  -> XML 解析、编码、中文残留、结构校验
```

## 步骤 1：编码判定（强制）

不要盲信 XML 声明中的 `encoding`。读取源文件时按顺序执行：

1. 检查 BOM。
2. 读取 XML 声明中的编码，例如 `encoding="gb2312"`。
3. 分别尝试 UTF-8、GB2312/GBK 解码。
4. 选择“中文可读、无明显乱码、XML 可解析或接近可解析”的解码结果。

如果 XML 声明与实际可读编码冲突：

- 以实际可读文本作为翻译依据。
- 默认保持 XML 声明不变，并按声明编码写出输出文件。
- 如果声明编码无法表示目标语言字符，才同步修正 XML 声明和输出编码，并在报告中说明。

禁止把乱码当作源文案翻译。出现 `锛`、`鍙`、`�`、断裂中文等明显乱码时，必须先重新判定编码。

## 步骤 2：识别待翻译文本

只翻译 `defaultvalue="..."` 属性中的用户可见源语言文本。

不要翻译：

| 不翻译 | 示例 | 原因 |
| --- | --- | --- |
| 字体名 | `fontname="宋体"` | 系统配置 |
| 打印机名 | `PrtDevice="打印机名称"` | 系统配置 |
| 编码声明 | `encoding="gb2312"` | XML 元数据 |
| 坐标和样式 | `xcol="20.106"`、`fontsize="10"` | 模板排版 |
| 动态变量名 | `[PatName]`、`[MedicareNo]` | 业务占位符 |
| 条码字体 | `fontname="C39P36DmTt"` | 系统配置 |
| URL / 路径 | `https://...` | 资源路径 |

空 `defaultvalue=""` 不翻译。

## 步骤 3：翻译策略

按 `i18n_translation_quality.md` 保证医疗术语准确。对 XML 打印模板额外执行三档译文策略：

1. 标准译文：语义最完整，优先用于宽区域。
2. 紧凑译文：语义不丢失，优先用于 HIS 打印单 label。
3. 极短译文：只用于空间严重不足的 label，例如 `Req. Dr:`、`Fee:`。

允许使用 HIS 常见短写：

- `MRN`
- `DOB`
- `Dept`
- `No`
- `Req`
- `Dr`

不要为了短而丢失医学语义。例如：

- `临床症状、体征及实验室检查:` 不要压缩成只表示 `Symptoms:`。
- 可用 `Symptoms, Signs & Lab Tests:`。

同一源文案在同一目标语言中必须保持同译。

## 步骤 4：生成标准翻译版

标准版输出路径：

```text
{outputDir}/{filename}-{LANG}.txt
```

标准版要求：

- 只替换 `defaultvalue` 中的源语言文本。
- 不改 XML 结构。
- 不改 `xcol`、`yrow`、`fontname`、`fontsize`、`fontbold`、线框、条码、图片、打印机、编码声明。
- 按最终 XML 声明对应编码写出。

标准版生成后必须进入步骤 5 做版面检查；不要因为 XML 可解析就结束。

## 步骤 5：布局检查（强制）

XML 打印模板通常是绝对坐标。英文 label 变长后，容易出现：

- label 覆盖 value。
- value 覆盖下一个 label。
- 同一行多个字段组互相覆盖。
- 标题覆盖顶部状态字段。
- 右侧窄区域字段覆盖，例如 `Fee/MRN/Card No`。
- 底部两组字段覆盖，例如 `Receiving Dept/Location`。

检查方法：

1. 抽取 `txtdatapara` 中的 `name`、`xcol`、`yrow`、`defaultvalue`、`fontsize`。
2. 将 `yrow` 接近的项视为同一行。
3. 同一行按 `xcol` 排序。
4. 对静态 label 和相关动态 value 成组检查。
5. label 到 value 的目标视觉间距默认约 `1.5-2.5mm`。
6. 组与组之间必须保留清晰分隔，不能为了缩短 label/value 间距导致字段组互相覆盖。

当出现风险时，按顺序处理：

1. 优先使用紧凑译文。
2. 仍不足时使用极短译文。
3. 仍不足时生成 layout 版，调整静态 label 和相关动态 value 坐标。

## 步骤 6：生成 layout 版（按需）

layout 版输出路径：

```text
{outputDir}/{filename}-{LANG}-layout.txt
```

layout 版允许调整：

- 静态 label 的 `xcol/yrow`。
- 与该 label 绑定的动态 value 的 `xcol/yrow`。

layout 版禁止调整：

- XML 结构。
- 线框、条码、图片。
- 字体名、打印机名、编码声明等系统配置。
- 与本次风险无关的字段。

调整原则：

- 按字段组移动，不要只移动 label 或只移动 value。
- label/value 间距保持约 `1.5-2.5mm`。
- 同一行多字段组优先保留组间分隔。
- 动态 value 可以移动，但不要改变业务变量名或占位符。

## 步骤 7：生成 layout report（生成 layout 版时强制）

报告路径：

```text
{outputDir}/{filename}-{LANG}-layout-report.md
```

报告必须包含：

- 源文件路径。
- 标准版路径。
- layout 版路径。
- 目标语言。
- 最终编码。
- 使用的译文策略。
- 每个风险项。
- 每个坐标调整项：字段名、字段类型、调整后的 `xcol/yrow`、调整原因。
- 人工视觉复核重点。

## 步骤 8：验证（强制）

每个输出文件都必须验证：

1. 编码：输出编码与 XML 声明一致；若不一致，报告说明原因。
2. XML：用 XML parser 加载，不只靠肉眼检查。
3. 翻译：`defaultvalue` 不残留源语言文本。
4. 保留项：字体名、打印机名、编码声明、业务占位符未被误翻译。
5. 标准版结构：除 `defaultvalue` 外不改其它属性。
6. layout 版调整：只调整报告列出的静态 label 和相关动态 value 坐标。

最终回复必须说明：

- 生成了哪些文件。
- 是否生成 layout 版和 report。
- XML 解析是否通过。
- `defaultvalue` 源语言残留数量。
- 仍需人工视觉复核的区域。

## 常见失败与处理

- 看到乱码：停止翻译，重新判定编码。
- 英文太长：先短译，再考虑 layout。
- label/value 距离太远：只移动动态 value 起点即可，不必改译文。
- label/value 重叠：先短译，再按字段组移动 label/value。
- 多字段同一行拥挤：不要只看单组 label/value，必须检查组间分隔。
- 输出 XML 解析失败：先修复转义和编码，再谈版面。
