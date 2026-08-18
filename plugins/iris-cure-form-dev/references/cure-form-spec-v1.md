# cure-form-spec/v1

必需顶层字段：

```json
{
  "schema": "cure-form-spec/v1",
  "sourceMode": "document",
  "formType": "CA",
  "moduleId": "ExampleForm",
  "mapCode": "ExampleForm",
  "title": "示例治疗评估",
  "expectedTemplateCount": 2,
  "sections": [],
  "fields": [],
  "templates": [
    {
      "key": "base-info",
      "order": 1,
      "title": "基本信息",
      "sourceRange": "A1:H8",
      "rootId": "ExampleBaseInfo",
      "moduleName": "ExampleBaseInfo",
      "fragmentHtml": "<div id=\"ExampleBaseInfo\" class=\"hisui-panel assess-form assess-form--responsive\">...</div>",
      "javascript": "var ExampleBaseInfo = (function () { ... }());"
    }
  ],
  "dictionaries": [],
  "calculations": [],
  "visibilityRules": [],
  "layout": [],
  "commonTemplates": [],
  "runtimeContract": {},
  "unresolved": []
}
```

`formType` 只能为 `CA` 或 `CR`。`sourceMode` 只能为 `document` 或 `server`。每个字段应保留来源定位、置信度、所属 `templateKey` 和稳定 ID。

Excel 多模板边界输入使用 `cure-form-template-boundaries/v1`。`templates[]` 按 `order` 生成 Map 组成模板；`expectedTemplateCount` 存在时必须严格匹配。批准前每个模板必须确认唯一 `key`、`rootId`、`moduleName`，所有候选字段必须确认控件类型并清除 candidate 状态。范围重叠、合并单元格被边界截断、缺失计算规则或未确认存储语义必须保留在 `unresolved[]`。

模板来源通常使用单个 `sourceRange`；一个业务模板由多个不连续区域组成时使用 `sourceRanges[]`。同一模板内部可使用多个范围，不同模板之间仍不得重叠。任一 Excel 合并区域必须被某一个模板的单个或多个范围完整覆盖，且只能存在一个完整覆盖者；否则写入 `TEMPLATE_MERGE_SPLIT`。

`fragmentHtml` 和 `javascript` 为可选的获批生成覆盖项。`fragmentHtml` 必须是单个根 `div` 片段，保留模板 `rootId`、`assess-form`、`assess-form--responsive`，不得包含 `html/head/body/script/link`，且必须包含该模板全部字段的唯一 DOM ID 与 `data-cache-tag`。`javascript` 必须定义与 `moduleName` 一致的全局模块，保持 `Init/OtherInfo/PrintInfo`，并通过语法校验。缺少覆盖项时仍使用插件默认生成器。

`aggregateTemplateInit` 为可选布尔值，默认 `false`。设置为 `true` 时必须同时声明 `scriptHref` 与 `scriptDeploymentPath`；生成的 Map 总入口会在 DOM ready 回调之后再延迟一轮，按模板顺序调用实际存在的业务 JavaScript 模块 `Init`，用于宿主无法可靠管理分模板生命周期的场景。分模板 `Init` 必须可重复调用或自行幂等。

人工确认写入 `approval`，至少包含批准人、时间、规格 SHA-256 和 `unresolvedCount=0`。
