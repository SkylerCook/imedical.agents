---
name: imedicalxc-doctor-extend-dataformat
version: 1.0.0
description: |
  HIS 医生站第三方系统集成的后端数据格式标准。
  定义 VO/DTO 设计、Jackson 注解、XmlMapper/ObjectMapper 使用方式。
  在 TDD（RED 阶段）用于测试设计和 VO/DTO 实现。
---

# iMedicalXC 医生站集成数据格式

后端数据格式标准：VO/DTO 设计、Jackson 注解、XmlMapper/ObjectMapper 使用方式。

## VO/DTO 设计标准

### 命名
- 必须使用 HIS 标准英文字段名（禁止拼音、禁止第三方原始字段名）
- 示例：`name`、`gender`、`birthDate`、`diagnoseCode`、`orderItemId`

### 字段注释（行注释）
- 每个 VO/DTO 字段**必须**带有 `@ApiModelProperty` 注解，包含：
  - 字段描述（字段含义描述）
  - 是否必填 — 基于第三方文档：
    - 第三方明确标注必填 → 注明 `required = true`
    - 第三方明确标注可选 → 注明 `required = false`
    - 第三方未说明 → 注明 `required = false`（默认非必填），并在 value 中标注“第三方未说明是否必填”
  - 示例值
- **注意**：第三方原始字段名已通过 `@JsonProperty` / `@JacksonXmlProperty` 映射，**无需在 @ApiModelProperty 中重复**。
- **模板**：`@ApiModelProperty(value = "字段含义", required = true/false, example = "示例值")`
- **禁止**：字段无 `@ApiModelProperty`、`required` 缺失、或注解为空/极简

### Jackson 注解
- XML 映射：`@JacksonXmlProperty(localName = "第三方字段名")`
- JSON 映射：`@JsonProperty("第三方字段名")`
- 同一字段可同时存在两种注解

### 注解选择指南

| 第三方格式 | 注解 | 示例 |
|-----------|------|------|
| **仅 JSON** | `@JsonProperty` | `@JsonProperty("user_name") private String userName;` |
| **仅 XML** | `@JacksonXmlProperty` | `@JacksonXmlProperty(localName = "user_name") private String userName;` |
| **JSON 与 XML 皆有** | `@JsonProperty` + `@JacksonXmlProperty` | `@JsonProperty("user_name") @JacksonXmlProperty(localName = "user_name") private String userName;` |

### 完整 VO 示例

```java
@Data
public class ThirdPartyPatientVO {
    @ApiModelProperty(value = "姓名", required = true, example = "张三")
    @JacksonXmlProperty(localName = "XM")
    @JsonProperty("XM")
    private String name;
    
    @ApiModelProperty(value = "用户ID", required = true, example = "1001")
    @JsonProperty("user_id")
    private String userId;
    
    @ApiModelProperty(value = "就诊类型", required = true, example = "100")
    @JsonProperty("JZLX")
    @JacksonXmlProperty(localName = "JZLX")
    private String admType;
    
    @ApiModelProperty(value = "备注,第三方未说明是否必填", required = false, example = "无")
    @JsonProperty("BZ")
    private String remark;
}
```

## XmlMapper / ObjectMapper 使用

### 依赖
```xml
<dependency>
    <groupId>com.fasterxml.jackson.dataformat</groupId>
    <artifactId>jackson-dataformat-xml</artifactId>
</dependency>
```

### 转换模式
```java
// XML 转对象
XmlMapper xmlMapper = new XmlMapper();
ThirdPartyPatientVO vo = xmlMapper.readValue(xmlString, ThirdPartyPatientVO.class);

// 对象转 XML
String xml = xmlMapper.writeValueAsString(vo);

// JSON 转对象
ObjectMapper objectMapper = new ObjectMapper();
ThirdPartyPatientDTO dto = objectMapper.readValue(jsonString, ThirdPartyPatientDTO.class);

// 对象转 JSON
String json = objectMapper.writeValueAsString(dto);
```

### 必备配置
```java
XmlMapper xmlMapper = new XmlMapper();
// 忽略未知字段，防止第三方新增字段导致反序列化失败
xmlMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
// 允许空字符串转 null
xmlMapper.configure(DeserializationFeature.ACCEPT_EMPTY_STRING_AS_NULL_OBJECT, true);

ObjectMapper objectMapper = new ObjectMapper();
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
```

### 集合处理
```java
// 列表 XML
@JacksonXmlElementWrapper(localName = "ITEMS")
@JacksonXmlProperty(localName = "ITEM")
private List<OrderItemVO> orderItems;
```

## 测试设计要求（RED 阶段）

在 TDD RED 阶段，先写 VO/DTO 和 XmlMapper 测试：

1. **正向测试**：给定第三方 XML/JSON 示例，反序列化为 VO/DTO，断言关键字段
2. **未知字段测试**：第三方新增字段时，反序列化不报错
3. **必填字段测试**：缺失必填字段时，验证业务校验（非 Jackson 层面）
4. **报文生成测试**：VO/DTO 序列化为 XML/JSON，与第三方预期格式比对

## 与 architecture skill 的关系

- `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md` 规则 5 定义“后端报文生成规范”
- 本 skill 提供规则 5 的具体实现细节（注解、Mapper、VO/DTO 模板）

## 相关技能
- **imedicalxc-doctor-extend-architecture** — 架构蓝图与约束规则
- **imedicalxc-doctor-blh** — BLH 模式规范（VO/DTO 在 BLH 层使用）
