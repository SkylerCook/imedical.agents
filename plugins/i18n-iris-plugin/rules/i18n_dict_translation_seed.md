# 字典数据翻译保存规则

执行本规则前必须先读取 `.agents/config/i18n_project_profile.md`。字典翻译存储表、字段名、语言字段和部署方式均以项目 profile 为准。

## 存储位置

字典和表字段展示值翻译与页面级翻译完全独立。默认沿用当前工程的 `BDP_Translation` 存储；仅当项目 profile 明确覆盖时，才使用其它存储结构。

代码侧应使用项目 profile 指定的字典/表字段展示值翻译 helper。通用形态：

```objectscript
<TranslateTableFieldValue>(className, fieldName, fieldValue, language, escapeMode)
```

## SQL 字段规则

默认 SQL 字段含义沿用当前工程配置；若项目 profile 覆盖为其它翻译表结构，再按 profile 生成 SQL。通用要求：

- 表/类名使用运行时代码实际识别的实体名。
- 字段名使用运行时代码实际识别的属性名，不要混用数据库列名。
- 字典翻译 SQL 的 `className` / `fieldName` 应与公共 `GetTransXxx` 注释中的 `class` / `field` 一致。
- 语言字段使用项目要求的语言代码或语言 id。
- 源展示值是源语言显示文本。
- 目标展示值是目标语言显示文本。

## 翻译表

`HIS系统最佳目标语言翻译` 列必须按 `i18n_translation_quality.md` 生成。

固定列：

| 文件名 | 入口CSP | 位置/类型 | 中文源文案 | 占位符语义 | HIS系统最佳目标语言翻译 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |

字典翻译约定：

- `入口CSP` 留空，除非项目 profile 另有要求。
- `位置/类型` 为 `backend-dict`。
- `备注` 写字段名或 profile 指定的字段说明；若新增或使用了公共 `GetTransXxx`，同时写入方法名，方便回查代码入口。
- 多字段字典必须分别生成翻译条目和 SQL，不合并 `Name`、`ShowName`、`Desc` 等不同字段。

## 生成文件

文件命名以项目 profile 指定的输出目录和目标语言为准。推荐形态：

```text
docs/i18n_terms_{LANG}_dict_YYYYMMDD_HHMM.md
docs/i18n_{LANG}_dict_insert_YYYYMMDD_HHMM.sql
```

生成 SQL 时必须按目标数据库和 SQL 字符串规则正确转义目标语言翻译中的 `'`、`"`、换行和其它特殊字符。

## 排除项

不翻译：

- 标准代码、状态码、字典编码。
- 人名、机构名、品牌名中已有官方原文的部分。
- 数值、测量值、型号规格。
- 内部占位值。

## 部署

SQL 默认由用户审核后手动执行。MCP 或自动化流程只做只读验证，除非用户明确要求写入。
