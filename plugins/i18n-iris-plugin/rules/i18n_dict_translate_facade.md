---
name: i18n_dict_translate_facade
description: Use when backend code needs a shared facade for dictionary or table-field display value translation.
task-affinity: [i18n, iris, objectscript, dictionary, facade]
related:
  - i18n_coding_backend.md
  - i18n_dict_translation_seed.md
---

# 字典翻译公共门面规则

执行本规则前必须先读取 `.agents/config/i18n_project_profile.md`。本规则用于约束后端字典/表字段展示值翻译的代码入口，避免业务代码反复直接拼接 `className + fieldName`。

## 默认门面

- 当前 IRIS 医生站默认字典翻译公共门面类为 `DHCDoc.Common.Translate`；目标工程 profile 有覆盖时，以 profile 为准。
- 首次遇到新的字典/表字段展示值翻译时，优先补公共 `GetTransXxx` 方法，再改业务代码调用该方法。
- 业务代码优先调用 `##class(DHCDoc.Common.Translate).GetTransXxx(value, languageId, qTrantable)`。
- 只有公共门面不存在且本次不适合新增时，才临时使用 `%TranslateTableFieldValue(...)`，并在输出中说明原因。
- 页面固定文案、无表枚举、整句提示不进入本门面，仍按页面级 `%Trans` / `%Translate` 处理。

## 方法命名

- 方法名使用业务语义，不机械拼接完整持久类名。
- 命名结构为 `GetTrans{Domain?}{EntityAlias}{FieldAlias?}`。
- `{Domain}` 只在跨模块可能冲突时使用，例如 `Dental`、`Doc`、`Cure`。
- `{EntityAlias}` 使用稳定业务短名，例如 `TADict`、`Loc`、`Sex`、`Arcim`。
- `{FieldAlias}` 只在非主描述字段或多字段实体中使用，例如 `Name`、`ShowName`、`ShortName`。
- 长类名必须压缩为清晰业务别名，例如 `CT.DOC.Dental.TA.Dictory.showName` 推荐 `GetTransDentalTADictShowName`，不推荐 `GetTransCTDOCDentalTADictoryShowName`。
- 如果命名冲突，逐级增加业务域或实体限定词，例如 `GetTransDentalApplyTADictShowName`。
- Unique 由“方法名 + 注释中的 `class/field/source` + 重复映射检查”共同保证；方法名不要求完整包含类名。
- 禁止两个方法指向同一 `tClassName + fieldName`，除非注释明确说明是兼容别名。

## 方法签名与实现

公共方法签名默认使用：

```objectscript
ClassMethod GetTransXxx(value As %String, languageId As %String = "", qTrantable As %String = "")
{
    q ..%TranslateTableFieldValue("Class.Name", "FieldName", value, languageId, qTrantable)
}
```

要求：

- `value` 是源语言展示值，不是 rowId、code、状态码或持久化标识。
- `languageId`、`qTrantable` 必须透传到底层翻译 helper。
- 不在公共方法内改变业务含义、过滤数据、更新持久化数据或拼接页面固定文案。
- 同一实体多个翻译字段必须拆成多个方法，例如 `GetTransStatusDictName` 与 `GetTransStatusDictShowName`。

## 注释规范

每个 `GetTransXxx` 必须写清楚语义和映射：

```objectscript
/// desc:   牙科 TA 字典显示名翻译
/// class:  CT.DOC.Dental.TA.Dictory
/// field:  showName
/// source: ^XXX(id) piece 4 / SQLUser.xxx.showName
/// debug:  w ##class(DHCDoc.Common.Translate).GetTransDentalTADictShowName("待处理", 1)
```

要求：

- `desc` 写用户可见业务语义。
- `class` 写运行时识别的持久类名或翻译表使用的实体名。
- `field` 写运行时识别的属性名，不写数据库列名替代属性名。
- `source` 写源展示值来源，可包含 Global 节点、piece、SQL 表字段或 GetData 方法。
- `debug` 给出可直接执行的最小调用示例。

## Global 到类字段定位

当源码从 `^Global` 取展示值时，按以下顺序定位翻译类和字段：

1. 先查现有 `DHCDoc.GetData.*` 类；若已有对应 GetData 类，以其类说明和 `GetDesc()` / `GetXxx()` 中的 `%TranslateTableFieldValue` 映射为准。
2. 若没有 GetData 类，按源码事实定位：`^Global` 取值位置 -> 对应 SQLUser 表或持久类 -> 属性字段 -> 翻译字段。
3. 若仍无法确认类或字段，不直接猜测；在输出中标记“需确认映射”，并列出已知 Global、节点、piece 和候选业务语义。
4. 确认映射后，先补 `DHCDoc.Common.Translate.GetTransXxx`，再改业务代码调用。

## 翻译位置贴近原则

字典翻译应贴近原始字段来源，不应在最终变量上无脑套 `GetTransXxx`。

当代码明确从某个数据源（如 `^ARCIM(...,1)`）取出展示值（如 `ARCIMDesc`）时，可以在该取值后立即调用翻译。若后续变量又被外部接口返回值覆盖，则不应对覆盖后的最终变量继续套同一个字典翻译方法。

这种写法能避免把不同来源、不同业务含义的文本误认为同一个字典字段。详细分类规则见 `i18n_field_classification.md`。

## 与 GetData 的关系

- 新写“取数据”代码优先使用 `DHCDoc.GetData`，例如通过 rowId 获取科室、性别、用户等完整对象或描述。
- 新写“翻译已有展示值”代码使用 `DHCDoc.Common.Translate.GetTransXxx`。
- `DHCDoc.GetData` 类内部可继续使用自身 `TranslateTableFieldValue`，但新增通用字典时应同步补公共门面方法，方便非 GetData 场景复用。
- 旧链路 i18n 小改造不强制重构到 `DHCDoc.GetData`；只有新增代码或局部改造成本低时向 GetData 靠拢。

## 完成检查

- 新增字典翻译调用前，已查找公共门面中是否存在可复用 `GetTransXxx`。
- 首次遇到新字典时，已补公共方法、注释和业务调用。
- 新增方法没有重复映射到已有 `tClassName + fieldName`。
- 多字段字典没有混用 `Name`、`ShowName`、`Desc` 等字段。
- 不能确认 Global 到类字段映射时，已明确标记待确认而不是猜测实现。
