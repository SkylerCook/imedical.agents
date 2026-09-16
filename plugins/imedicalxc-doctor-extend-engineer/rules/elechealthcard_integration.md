---
name: elechealthcard_integration
description: |
  电子健康卡第三方集成通用约束。
  涵盖请求结构、字段来源严格性、数据对照 SQL 规范。
  适用于所有外部平台接口对接场景。
task-affinity: [elechealthcard, vendor-integration, external-api]
---

# 电子健康卡第三方集成通用约束

以下规则从电子健康卡集成实践中提炼，适用于所有外部平台接口对接场景。

## 请求结构

- **文档字段 vs DTO 字段**：DTO 只放文档中明确定义的业务字段；公共字段（如 orgCode/appRecordNo/appMode）由调用层统一赋值，不放 DTO。
- **公共信息统一赋值**：凡属于"所有接口都需要、值来自配置"的字段，在 buildBody/invoke 层统一 put，不在每个 Strategy 中单独 set。
- **配置驱动 + 默认值**：公共字段的值从扩展设定（interfaceConfig）读取，代码中维护合理默认值（如 appMode 默认 "3"=医疗卫生机构窗口申请）。

## 字段来源严格性

- **文档中没有的字段不加**：不要把其他厂商/其他平台的字段混入当前厂商的 DTO。每个字段必须在对应厂商的接口文档中有明确定义。
- **条件必填字段**：如果某字段仅在特定条件下必填（如 payAmount 在诊疗环节=010105 时必填），而 HIS 无法获取该值，则**排除该条件对应的对照数据**（如不对照 010105 环节），并在 DTO 的 @ApiModelProperty notes 中标注约束和排除原因。
- **必填值校验**：调用外部平台接口前，必须校验所有必填字段（配置参数 + DTO 业务字段）不为空。
  - **DTO 业务字段**：在 DTO 字段上加注解，调用层方法参数加 `@Valid`，类加 `@Validated`，由 Spring 自动校验。
    - `@NotBlank(message = "xxx不能为空")`（`javax.validation.constraints`）— 用在 String 上，不能为 null 且 trim 后长度 > 0
    - `@NotNull(message = "xxx不能为空")` — 用在基本类型/包装类/对象上，不能为 null（但可为 empty）
    - `@NotEmpty(message = "xxx不能为空")` — 用在集合类上，不能为 null 且长度 > 0
    - **message 必须写**：取 `@ApiModelProperty(value)` 的中文名 + "不能为空"，如 `@NotBlank(message = "姓名不能为空")`
    - 新增 DTO 时只需在必填字段加注解 + 方法参数加 `@Valid`，无需写校验代码
  - **配置参数**（如 appId/orgCode/appRecordNo）：在 invoke 统一入口用 `checkNotBlank` 手动校验，配置未维护时快速失败
  - 校验失败抛 `HisBusinessException`，提示具体字段名

## 数据对照 SQL

- **输出位置**：SQL/文档放在 `电子健康卡/{厂家名称}/` 下（不放代码目录），不放 `src/main/resources`（避免打入 JAR、避免误提交）。
- **SQL 必须赋具体值**：扩展设定 SQL 中的参数必须从平台提供的配置文件/文档中提取实际值填入，不留 REPLACE_xxx 占位符。设备码等需从设备清单 Excel 中提取。
- **对照规则以参考文档为准**：数据对照明细（hiscode/hisname/extcode/extname）以厂商/平台提供的参考 SQL 或文档附录为准，不自行按 code 推断。hisname 取本院 HIS 字典表的 name 字段。
- **建目录 SQL 完整字段**：ct_dic_basedatamap 的 INSERT 须包含 parent_dr（用子查询关联上级）、attribute、common_class、activity 等完整字段，不遗漏。
- **is_deleted 软删除处理（必须）**：ct_dic_basedatamap 和 ct_dic_basedatamapdetail 均有 `is_deleted` 列（软删除）。若记录曾被删除（is_deleted=1），NOT EXISTS 仍会匹配到该行导致 INSERT 跳过、数据无法恢复。因此每个 INSERT 前必须先 UPDATE 恢复：
  - **ct_dic_basedatamap（建目录 SQL）**：每个目录节点 INSERT 前，按 code + parent_dr 条件 UPDATE `is_deleted = 0`；批量插入的子节点（如维度类别）可合并为一条 UPDATE（按 code IN (...) 条件）。
  - **ct_dic_basedatamapdetail（明细 SQL）**：每个维度类别的 INSERT 前，按 `basedatamap_dr`（用子查询定位到对应目录节点）条件 UPDATE `is_deleted = 0`，恢复该类别下所有软删除的明细记录。
  - **模式**：先 UPDATE 恢复 → 再 INSERT WHERE NOT EXISTS 跳过已存在。脚本头部注释须注明此处理逻辑。
