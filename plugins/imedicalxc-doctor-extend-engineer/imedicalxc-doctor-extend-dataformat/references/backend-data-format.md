# 后端数据格式转换规范

## ⚠️ 重要规范提醒

### BLH 架构规范（必须遵守）

**严格禁止在 `comoe` 模块中建立 Controller！**

根据 **imedicalxc-doctor-blh** skill 规范，后端程序必须遵循 BLH（Business Logic Handler）三层架构：

```
Controller (BLH 层) → Service (业务层) → Mapper/DAO (数据层)
```

**正确做法**：
- **Controller 必须放在业务模块中**（如 `opcare-mediway-boot`、`ipcare-mediway-boot`）
- **BLH/Service 可以放在业务模块或 comoe 中**：业务相关的放在业务模块，公共通用的放在 comoe
- **comoe 模块提供公共能力**：VO 定义、工具类、常量、公共 BLH/Service 等
- **禁止在 comoe 中创建**：Controller

**目录结构示例**：
```
opcare-mediway-boot/
└── opcare-external/
    └── src/main/java/com/mediway/his/opcare/external/
        ├── controller/          # Controller 层（必须在业务模块）
        │   └── ExternalInterfaceController.java
        ├── blh/                 # BLH 层（业务模块特有）
        │   └── ExternalInterfaceBLH.java
        └── service/             # Service 层（业务模块特有）
            └── ExternalInterfaceService.java

comoe-mediway/
└── src/main/java/com/mediway/his/comoe/
    ├── model/vo/              # VO 定义（公共）
    │   └── ThirdPartyPatientVO.java
    ├── blh/                   # BLH 层（公共通用）
    │   └── CommonExternalBLH.java
    ├── service/               # Service 层（公共通用）
    │   └── CommonExternalService.java
    └── util/                  # 工具类（公共）
        └── XmlUtils.java
```

**详细规范参考**：`imedicalxc-doctor-blh` skill

---

## 核心原则

**严禁在前端进行 XML/JSON 字符串拼接**，所有格式转换必须在后端完成。

## 错误做法（禁止）

```javascript
// 前端直接拼接 XML - 禁止！
var xml = "<?xml version='1.0'?>\n";
xml += "<ROOT>\n";
xml += "  <NAME>" + data.name + "</NAME>\n";  // 禁止！
xml += "</ROOT>";
```

## 正确做法（必须）

### 1. 后端 VO 定义

使用 HIS 标准英文命名字段，根据第三方格式选择对应注解进行映射：

```java
@Data
public class ThirdPartyRootVO {
    // 仅 XML 格式时使用 @JacksonXmlProperty
    @ApiModelProperty(value = "姓名,第三方文档命名:XM", example = "张三")
    @JacksonXmlProperty(localName = "XM")
    private String name;
    
    // 仅 JSON 格式时使用 @JsonProperty
    @ApiModelProperty(value = "用户ID,第三方文档命名:user_id", example = "1001")
    @JsonProperty("user_id")
    private String userId;
    
    // 同时支持 JSON/XML 时两个注解一起使用
    @ApiModelProperty(value = "就诊类型,第三方文档命名:JZLX", example = "100")
    @JsonProperty("JZLX")
    @JacksonXmlProperty(localName = "JZLX")
    private String admType;
}
```

### 2. 后端 XML 转换工具

使用 Jackson XmlMapper 进行对象到 XML 的转换：

```java
@Slf4j
public class XmlUtils {
    private static final XmlMapper XML_MAPPER = new XmlMapper();
    
    public static String toXml(Object obj) {
        try {
            return XML_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            log.error("对象转 XML 失败", e);
            throw HisBusinessException.build("xml.convert.error", "对象转 XML 失败:" + e.getMessage());
        }
    }
}
```

### 3. 前端调用

前端只负责调用后端接口获取 XML 字符串，然后发送给第三方：

```javascript
// 前端调用后端接口获取 XML
$ipost('/api/external/vendor/action', param, function(resp) {
    if (resp.success) {
        // resp.data 就是后端生成的 XML 字符串
        sendToThirdParty(resp.data);
    }
});
```

## 命名规范要求

- VO/DTO 字段必须使用 HIS 标准英文命名（如 `name`、`gender`、`birthDate`）
- 第三方原始字段名通过 `@JsonProperty` / `@JacksonXmlProperty` 映射，无需在 `@ApiModelProperty` 中重复
- `@ApiModelProperty` 必须标注字段含义、是否必填（`required`）、示例值
- `required` 取值规则：第三方明确标注 → 以第三方为准；第三方未说明 → `required = false`，value 中标注“第三方未说明是否必填”
- 严禁使用拼音或第三方原始字段名作为 Java 字段名

## 字段映射注解选择

| 第三方格式 | 使用的注解 | 示例 |
|-----------|-----------|------|
| **仅 JSON** | `@JsonProperty` | `@JsonProperty("user_name") private String userName;` |
| **仅 XML** | `@JacksonXmlProperty` | `@JacksonXmlProperty(localName = "user_name") private String userName;` |
| **同时支持 JSON/XML** | `@JsonProperty` + `@JacksonXmlProperty` | `@JsonProperty("user_name") @JacksonXmlProperty(localName = "user_name") private String userName;` |

## 注解使用原则

- 如果第三方只要求 JSON 格式，使用 `@JsonProperty`
- 如果第三方只要求 XML 格式，使用 `@JacksonXmlProperty`
- 如果同一 VO 需要同时支持 JSON 和 XML 输出，两个注解一起使用
- 无论使用哪种注解，Java 字段名必须保持 HIS 标准英文命名

## Controller 层设计

⚠️ **重要**：Controller 必须放在业务模块中（如 `opcare-mediway-boot`、`ipcare-mediway-boot`），**禁止在 comoe 中创建 Controller**。

**核心职责**：
- 接收前端请求，参数校验
- 调用 BLH 层处理业务逻辑
- 返回统一响应格式（使用 `BaseResponse`）

**关键代码示例**：
```java
@RestController
@RequestMapping("/api/external/{vendor}/{module}")
public class ExternalInterfaceController {

    @Resource
    private ExternalInterfaceBLH externalInterfaceBLH;  // 注入 BLH 层
    
    @GetMapping("/patient/{episodeId}")
    public BaseResponse<ThirdPartyPatientDTO> getPatientForThirdParty(
            @PathVariable String episodeId) {
        
        // 调用 BLH 层处理业务逻辑
        return externalInterfaceBLH.getPatientForThirdParty(episodeId);
    }
}
```

**注意**：
- 使用 `BaseResponse` 作为统一返回类型（医生站组规范）
- Controller 层只负责参数接收和响应封装
- 代码目录层级为 `/{vendor}/{module}/ExternalInterfaceController.java`
- 业务逻辑在 BLH 层处理（参考 `imedicalxc-doctor-blh` skill）

## Service 层设计

**核心职责**：
- 查询数据库组装数据
- 封装数据库访问
- 统一异常处理

**关键要点**：
- 使用 MyBatis Plus 查询多个表
- 封装第三方 HTTP 调用（如需）
- 统一异常处理

## 前端调用方式

前端只需传递关键标识（如 `episodeId`），由后端完成数据组装和格式转换：

```javascript
// 外部接口层调用示例
var VendorModule = {
    getPatientInfo: function(episodeId, callback) {
        // 前端只传递 episodeId
        $iget('/api/external/VendorModule/patient/' + episodeId, {}, function(response) {
            // 后端已组装好第三方格式的数据
            callback(response);
        });
    }
};
```

## 核心规则

### 规则 1：医为中间件职责边界（单一职责）

**医为中间件仅提供消息转发通道，禁止处理任何业务逻辑。**

- ✅ 允许：DLL/OCX 调用封装、参数透传、结果返回
- ❌ 禁止：XML 解析、业务判断、数据转换、编码映射

### 规则 2：前后端职责划分

| 职责 | 后端 | 前端 | 医为中间件 |
|------|------|------|-----------|
| 复杂数据结构组装 | ✅ | ❌ | ❌ |
| XML/JSON 格式转换 | ✅ | ❌ | ❌ |
| 数据查询与整合 | ✅ | ❌ | ❌ |
| 字段映射与编码转换 | ✅ | ❌ | ❌ |
| 业务触发与结果展示 | ❌ | ✅ | ❌ |
| 消息转发与通道提供 | ❌ | ❌ | ✅ |

### 规则 3：数据流向规则

**标准流向**：
```
前端（触发） → 后端 Controller（组装数据） → 前端（透传） → 医为中间件（转发） → 第三方 DLL
```

**禁止流向**：
- ❌ 前端直接组装 XML/JSON
- ❌ 后端直接调用客户端 DLL
- ❌ 医为中间件解析业务数据

### 规则 4：技术选型决策规则

根据第三方技术要求选择方案：

| 第三方提供 | 后端职责 | 中间件职责 |
|-----------|---------|-----------|
| HTTP/REST 接口 | 直接调用第三方接口 | 不使用 |
| DLL/OCX（客户端部署） | 组装 XML/JSON 数据 | 仅转发 |
| Socket（本地端口） | 组装数据 | 仅转发 |
| 硬件设备 | 不使用 | 设备访问 |

### 规则 5：接口契约设计规则

**前端→后端**：
- 仅传递关键标识（episodeId、oeoriIds 等）
- 禁止传递复杂结构化数据

**后端→前端**：
- 返回组装完成的 XML/JSON 字符串
- 返回是否成功标识和错误信息

**前端→医为中间件**：
- 透传后端返回的 XML/JSON 内容
- 禁止修改或解析内容

## 相关规范

- **imedicalxc-doctor-blh** — BLH 三层架构规范
- **imedicalxc-doctor-invoke** — Feign 接口调用规范
- **imedicalxc-doctor-dbdata** — 数据库查询规范
