---
name: i18n-bdp-trans-seed
description: Generate and verify multilingual dictionary/table-display translation term tables and SQL using the project-configured dictionary translation storage.
---

# BDP Translation Seed — 字典数据翻译生成与部署

## 触发条件

当字典表或表字段展示值需要翻译，并通过项目配置的字典/表字段翻译 helper 在运行时展示目标语言时使用本 Skill。

字典翻译与页面级翻译无关，存储结构以 `.agents/config/i18n_project_profile.md` 为准。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. 语言目录规则：优先读取目标工程 `.agents/rules/i18n_language_catalog.md`；引用插件时读取插件 `rules/i18n_language_catalog.md`
3. 字典翻译种子规则：`i18n_dict_translation_seed.md`
4. 目标语言翻译质量规则：`i18n_translation_quality.md`
5. 如涉及后端代码改造，读取 `i18n_coding_backend.md`
6. 涉及服务器查询时读取工程根目录 `.mcp.json`

## 参数

- `targetLanguage`：目标语言代码；默认使用 project profile 配置。
- `classes`：目标实体类或 profile 指定的等价实体名。
- `fields`：需翻译的展示字段或属性名。

## 流程

1. 确认 `targetLanguage`，未指定时使用 project profile 默认值。
2. 从 project profile 指定的语言目录校验语言存在。
3. 识别目标实体和展示字段。
4. 通过 `.mcp.json` 对应的 SQL 查询能力去重展示值，或使用用户提供的数据源。
5. 排除标准代码、人名、机构名、测量值、内部占位等非翻译项。
6. 按 `i18n_translation_quality.md` 生成目标语言翻译。
7. 输出翻译表和 SQL。
8. 用户审核 SQL 后手动执行，除非用户明确要求自动写入。

## 翻译表输出

推荐命名：

```text
docs/i18n_terms_{LANG}_dict_YYYYMMDD_HHMM.md
```

固定列：

| 文件名 | 入口CSP | 位置/类型 | 中文源文案 | 占位符语义 | HIS系统最佳目标语言翻译 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |

字典翻译约定：

- `入口CSP` 默认留空。
- `位置/类型` 填 `backend-dict`。
- `备注` 填字段名或 profile 指定的字段说明。

## SQL 输出

推荐命名：

```text
docs/i18n_{LANG}_dict_insert_YYYYMMDD_HHMM.sql
```

SQL 表名、字段名和唯一键以 project profile 的字典翻译存储配置为准。

## 关键约束

- 实体名和字段名必须使用运行时代码识别的名称。
- 同一唯一键只保留一条翻译。
- 目标语言翻译写入 SQL 前必须按 SQL 字符串规则正确转义。
- SQL 由用户审核后手动执行；默认流程只做只读验证。
