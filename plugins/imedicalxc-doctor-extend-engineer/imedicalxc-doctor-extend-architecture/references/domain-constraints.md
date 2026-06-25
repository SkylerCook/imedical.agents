
# HIS 医生站第三方系统集成领域约束

HIS 医生站工作流第三方集成的硬性约束与审查清单。

> 本文档是 `imedicalxc-doctor-extend-architecture` skill 的规则子文件，定义全部业务约束规则。

---

## 核心规则

### 规则 1：WebSysAddins 职责边界（单一职责）

**WebSysAddins 中间件只提供消息转发通道，不得处理任何业务逻辑。**

- 允许：DLL/OCX 调用封装、参数透传、结果返回
- 禁止：XML 解析、业务判断、数据转换、代码映射

### 规则 2：前后端职责划分

| 职责 | 后端 | 前端 | WebSysAddins | WebSocket（通道） |
|------|------|------|--------------|------------------|
| 复杂数据结构组装 | 是 | 否 | 否 | 否 |
| XML/JSON 格式转换 | 是 | 否 | 否 | 否 |
| 数据查询与整合 | 是 | 否 | 否 | 否 |
| 字段映射与代码转换 | 是 | 否 | 否 | 否 |
| 业务触发与结果展示 | 否 | 是 | 否 | 否 |
| 消息转发与通道提供 | 否 | 否 | 是 | 否 |
| 在触发点完成 WebSocket 连接/发送/接收/关闭 | 否 | 是 | 否 | 否 |
| 消息原样透传不做修改 | 否 | 是 | 否 | 是 |
| 需要 30 秒超时 | 否 | 否 | 否 | 是 |
| 所有分支都调用 CallBackFunc | 否 | 否 | 否 | 是 |

### 规则 3：数据流规则

**标准数据流**：四种标准数据流的完整拓扑定义见主 skill §1.2。所有实现必须遵循该图中定义的 HTTP/WebSocket/DLL/ESB 四种通信模式。

**禁止的数据流**：
- 前端直接组装 XML/JSON
- 后端直接调用客户端 DLL
- WebSysAddins 解析业务数据
- WebSocket 处理程序解析或修改消息内容
- 前端 WebSocket 发送绕过后端数据组装
- 在 ESB 模式中于调用处直接写 interfaceCode 字符串字面量（必须定义为私有静态常量）
- 在 ESB 模式中将集成平台返回的原始 JSON 字符串直接透传给前端（必须解析为 VO 后再返回）

### 规则 4：接口契约设计规则

**前端 → 后端**：
- 只传递关键标识符（episodeId、oeoriIds 等）
- 禁止传递复杂结构化数据

**后端 → 前端**：
- 返回组装好的 XML/JSON 字符串
- 返回成功标识与错误信息

**前端 → WebSysAddins**：
- 原样透传后端返回的 XML/JSON 内容
- 禁止修改或解析内容

**前端 → WebSocket（本地第三方服务）**：
- 原样透传后端返回的 XML/JSON 内容
- 禁止修改或解析内容
- 在单一触发点（如 BeforeUpdate）内完成连接、发送、接收响应、关闭
- 必须配置 30 秒超时

### 规则 5：后端 XML/JSON 生成规范

**严禁在后端使用字符串拼接生成 XML/JSON！**

错误做法（禁止）：
```java
// 字符串拼接 - 禁止！
String xml = "<?xml version='1.0'?>\n";
xml += "<ROOT><NAME>" + name + "</NAME></ROOT>";  // 禁止！
```

正确做法（必须）：
- 使用 `jackson-dataformat-xml` 库（Maven 依赖）
- 使用 `XmlMapper` / `ObjectMapper` 进行对象转换
- VO/DTO 使用 `@JacksonXmlProperty` / `@JsonProperty` 注解映射第三方字段名
- 调用 `xmlMapper.writeValueAsString(vo)` 生成报文

---

## 核心约束

### 必须遵守（MUST DO）

- **后端格式转换**：所有 XML/JSON 转换在后端通过 VO + Jackson 注解完成 — 详见规则 5
- **标准字段命名**：VO/DTO 使用 HIS 标准英文字段名 — 详见 `imedicalxc-doctor-extend-dataformat`
- **注册外部接口**：必须在外部接口管理（CF_Doc_Interface_Portal）中注册
- **遵循架构**：实现必须遵循主 skill 中定义的架构骨架：
  - 前端外部接口 JS 通过业务中间件（Layer 2）被调用，不得被业务 JS（Layer 1）直接调用（主 skill §1.1）
  - 后端 Controller 位于 opcare/ipcare 业务模块中，数据流经过 BLH → Service 层（主 skill §4.2）
  - 所有报文组装（XML/JSON）在后端完成，前端和 WebSysAddins 只透传（主 skill §1.2）
  - WebSocket 连接在触发点由前端管理，报文内容不经解析（主 skill §1.2）
- **使用业务中间件生命周期钩子**：前端通过 `Init` / `BeforeUpdate` 等生命周期钩子嵌入
- **模块级类名前缀**：ipcare 模块中的类（Controller/BLH/Service/Model）必须以 `IpCare` 开头，opcare 模块中的类必须以 `OpCare` 开头。例如：ipcare 中的 `IpCareAdmController`，opcare 中的 `OpCareMrdiaBLH`。此规则确保类名即可标识归属模块，避免跨模块命名冲突
- **前后端按 admtype 路由**：前端页面必须根据就诊类型（admtype）调用对应模块的后端服务。门急诊（OP/EM）→ 调用 `opcare` 服务，住院（IP）→ 调用 `ipcare` 服务。禁止在门急诊页面中调用 ipcare 接口，也禁止在住院页面中调用 opcare 接口。融合层（aggcare）不区分 admtype，可同时调用两者

### 禁止事项（MUST NOT DO）

- **前端 XML/JSON 字符串拼接**：禁止在前端 JS 中构造 XML/JSON
- **非标准字段命名**：禁止在 VO/DTO 中使用拼音或第三方原始字段名
- **从业务 JS 直接调用第三方接口**：第三方接口调用必须通过外部接口层
- **WebSocket 消息解析**：禁止在 WebSocket 处理程序中解析或修改消息内容
- **WebSocket 绕过**：禁止未经后端数据组装直接发往 WebSocket
- **将其他接口 JS 或 .history 文件作为主要参考**：编写外部接口层 JS 时，禁止以其他已存在的接口 JS 文件或 IDE 本地历史文件（`.history/`）为主要参考来源。必须首先以中间件 JS 文件中的 JSDoc `@typedef` + `@example` 为权威契约，再以主 skill §3.4 外部接口对象结构模板为代码骨架。其他接口 JS 仅可作为补充参考，不得直接复制其实现模式
- **将复杂钩子参数不透明地透传给后端**：禁止在不理解复杂参数内部结构的情况下将其原样透传给后端。当钩子入参是 `Object`/`Array` 等复杂类型时，必须先提取其内部字段结构（字段名、类型、含义），再根据后端 DTO 需要选择性传递。全量透传一个内容未知的复杂对象给后端，导致后端被迫使用 `Map<String, Object>` 接收入参 = FAIL

---

## 审查清单（供代码质量审查子代理使用）

将以下清单派发给代码质量审查子代理。任何未勾选项 = REJECT（驳回）。

### 清单 1：WebSysAddins 职责边界
- [ ] WebSysAddins 只转发消息
- [ ] WebSysAddins 中不存在 XML 解析
- [ ] WebSysAddins 中不存在业务判断
- [ ] WebSysAddins 中不存在数据转换
- [ ] WebSysAddins 中不存在代码映射

### 清单 2：前后端职责划分
- [ ] 复杂数据组装只由后端完成
- [ ] XML/JSON 格式转换只由后端完成
- [ ] 数据查询与整合只由后端完成
- [ ] 字段映射与代码转换只由后端完成
- [ ] 业务触发与结果展示只由前端完成
- [ ] 消息转发与通道提供只由 WebSysAddins 完成
- [ ] WebSocket 连接/发送/接收/关闭只在前端触发点处理
- [ ] WebSocket 消息原样透传不做修改
- [ ] WebSocket 配置 30 秒超时
- [ ] WebSocket 所有分支都调用 CallBackFunc 返回结果
- [ ] WebSocket 处理程序中不存在业务判断
- [ ] WebSocket 处理程序中不存在数据转换
- [ ] WebSocket 处理程序中不存在代码映射

### 清单 3：数据流规则
- [ ] WebSocket 流：前端（触发）→ 后端（组装）→ 前端（WebSocket 发送）→ 第三方 WebSocket
- [ ] HTTP 流：前端（触发）→ 后端（组装）→ 前端（透传）→ 第三方 HTTP
- [ ] DLL 流：前端（触发）→ 后端（组装）→ 前端（透传）→ WebSysAddins（转发）→ 第三方 DLL
- [ ] ESB 流：前端（触发）→ 后端（组装）→ InterfaceUtil.executeRestByBody → 集成平台（路由转发）→ 第三方服务
- [ ] 前端不直接组装 XML/JSON
- [ ] 后端不直接调用客户端 DLL
- [ ] 后端不直接写 interfaceCode 字符串字面量（必须定义为私有静态常量）
- [ ] WebSysAddins 不解析业务数据
- [ ] WebSocket 处理程序不解析或修改消息内容
- [ ] ESB 模式中集成平台返回的原始字符串不直接透传给前端（必须解析为 VO 后返回）

### 清单 4：接口契约设计
- [ ] 前端→后端：只传关键标识符（episodeId、oeoriIds 等）
- [ ] 前端→后端：不传复杂结构化数据或已组装 XML/JSON
- [ ] 后端→前端：返回已组装 XML/JSON 字符串
- [ ] 后端→前端：返回成功标识与错误信息
- [ ] 后端→前端：使用 BaseResponse 作为标准返回类型
- [ ] 前端→WebSysAddins：原样透传 XML/JSON 内容
- [ ] 前端→WebSysAddins：不解析或修改内容
- [ ] 前端→WebSocket：原样透传 XML/JSON 内容
- [ ] 前端→WebSocket：不解析或修改内容
- [ ] 前端→WebSocket：配置 30 秒超时
- [ ] 后端→集成平台：interfaceCode 定义为私有静态常量，不在调用处写字符串字面量
- [ ] 后端→集成平台：body 通过 VO + Jackson/ObjectMapper 序列化生成，不使用字符串拼接
- [ ] 后端→集成平台：返回结果解析为强类型 VO 后再处理，不透传原始字符串
- [ ] 后端→集成平台：敏感凭证（token/secret）禁止出现在 interfaceCode 或 body 的日志输出中

### 清单 5：后端 XML/JSON 生成
- [ ] 不使用字符串拼接构建 XML/JSON
- [ ] 使用 jackson-dataformat-xml 配合 XmlMapper / ObjectMapper
- [ ] VO/DTO 使用 @JacksonXmlProperty 映射 XML 字段
- [ ] VO/DTO 使用 @JsonProperty 映射 JSON 字段
- [ ] 每个 VO/DTO 字段都带有 @ApiModelProperty，包含字段描述、是否必填、示例值（第三方字段名已在 @JsonProperty/@JacksonXmlProperty 中体现）
- [ ] 通过 xmlMapper.writeValueAsString(vo) 或 objectMapper.writeValueAsString(dto) 生成报文
- [ ] 后端实现者已验证 XML/JSON 生成中使用的每个 getter/setter 在所引用的 DTO/VO 上真实存在；不存在的已反馈，未自行猜测
- [ ] 后端实现者已验证每个从前端钩子参数赋值的字段都映射到 DTO/VO 中真实存在的字段

### 清单 6：代码位置与命名
- [ ] Controller 位于业务模块（opcare-mediway-boot / ipcare-mediway-boot），绝不在 comoe 中
- [ ] ipcare 模块中所有类（Controller/BLH/Service/Model/DTO/VO）以 `IpCare` 开头
- [ ] opcare 模块中所有类（Controller/BLH/Service/Model/DTO/VO）以 `OpCare` 开头
- [ ] VO/DTO 使用 HIS 标准英文命名（无拼音、无第三方原始字段名）
- [ ] VO/DTO 字段带有 @ApiModelProperty，包含第三方字段名、描述、示例值
- [ ] Jackson 注解正确（XML 用 @JacksonXmlProperty，JSON 用 @JsonProperty）
- [ ] 后端任务未在前端契约任务完成前开始
- [ ] 外部接口已在外部接口管理（CF_Doc_Interface_Portal）中注册
- [ ] 前端页面 admtype 路由正确：门急诊（OP/EM）页面调 opcare 后端，住院（IP）页面调 ipcare 后端，无跨 admtype 调用

### 清单 7：架构合规
- [ ] 已从主 skill §3.1 确认所有需嵌入的中间件入口（不限于 OEOrd）
- [ ] 已从主 skill §3.2 确认所有 Required 标记的钩子已实现
- [ ] 前端 JS 文件路径：`{hisfront}/static/comoe/interface/{Vendor}/{Module}.js`（`{hisfront}` 为前端独立根目录，**禁止**放在 `his/hisfront/` 下，**禁止**缺少厂商子目录直接放 `comoe/interface/` 根下）
- [ ] 后端 Controller 属于主 skill §4.1 规定的业务模块（opcare/ipcare）
- [ ] WebSocket 实现遵循主 skill §1.2 WebSocket 模式
- [ ] ESB 实现遵循主 skill §1.2 ESB/集成平台模式
- [ ] 中间件实现遵循主 skill §1.2 DLL 模式
- [ ] 中间件实现遵循主 skill §1.2 DLL 模式
- [ ] 前端外部接口对象结构符合主 skill §3.4 模板
- [ ] 前端钩子签名匹配主 skill §3.2 参数规范
- [ ] `PushInterfaceArr()` 注册方式正确

### 清单 8：前端 admtype 路由
- [ ] OP/EM 页面只调用 `/opcare/` 或 `/aggcare/` 端点；任何 `/ipcare/` 调用 = FAIL
- [ ] IP 页面只调用 `/ipcare/` 或 `/aggcare/` 端点；任何 `/opcare/` 调用 = FAIL
- [ ] aggcare 页面可同时调用 `/opcare/` 和 `/ipcare/` 端点
- [ ] 外部接口 JS（`/comoe/interface/{Vendor}/{Module}.js`）接收 `admtype` 并动态选择 `/opcare/` 或 `/ipcare/`；硬编码一侧 = FAIL
- [ ] `/opcare/` 下的页面文件只调用 opcare；`/ipcare/` 下的页面文件只调用 ipcare

### 清单 9：前端 JS 参考来源与入参语义
- [ ] 钩子签名精确匹配中间件 JSDoc `@typedef` + `@example`
- [ ] 文件结构匹配主 skill §3.4 外部接口对象模板
- [ ] 未在无明示引用声明的情况下复制其他厂商 JS 文件或 `.history/` 中的模式
- [ ] 每个钩子入参都有一行中文语义注释
- [ ] 传给后端的参数经过有意识选择，非盲目透传；每个透传参数都映射到后端 DTO 字段
- [ ] 未使用的参数有简短原因注释
- [ ] JSDoc 保留中间件 `@example` 中的值域描述、`@see` 引用、数组/对象内部结构、精确类型
- [ ] 复杂参数以 `[{field: 类型/含义}]` 格式描述内部结构，不使用泛化的 `Object`/`Array`
- [ ] 中间件 `@example` 中的每个 `@see` 引用都已打开，其字段结构已内联到外部接口 JS JSDoc 中
- [ ] `@see` 指向的后端 DTO 字段已打开确认字段名、类型和 @ApiModelProperty 描述
- [ ] 不存在仅写 `@param {Object}`、`@param {Object[]}` 或 `@param {Array}` 而无内联 `[{field: 类型/含义}]` 结构的参数
- [ ] 不存在只保留 `@see` 引用行而无伴随内联字段结构的情况

### 清单 10：值语义对齐
- [ ] `@ApiModelProperty` 描述与第三方文档对同名字段的定义一致
- [ ] 赋值（如 `setVisitType("OP")`）与第三方期望值域匹配
- [ ] HIS 内部枚举值与第三方值不一致时，有显式映射方法（`mapXxx()`）
- [ ] 数据源代码体系与第三方要求一致（例如：医院代码使用国家卫生健康机构代码，而非 HIS 内部 hosp code，除非已做映射）

### 清单 11：数据结构审查
- [ ] 方法参数和返回类型不使用 `Map<String, Object>`、`Map<String, String>`、`JSONObject`、`JSONArray`；使用强类型 VO/DTO
- [ ] 任何声称的 `Map` 豁免都经过验证：JS 源码已文档化内部字段、后端通过有意义的 key 消费、已评估 DTO 成本
- [ ] 多个钩子传入同一后端字段时，JS 侧类型保持一致

### 清单 12：TODO / 占位符扫描
- [ ] 变更的 `.java`、`.js`、`.xml` 文件中零匹配 `TODO`、`FIXME`、`XXX`、`HACK`、`TBD`、`占位`、`暂未`、`临时`、`待实现`、`待完善`

### 清单 13：实现完整性
- [ ] 不存在 null 返回、空集合/映射、空对象、`UnsupportedOperationException`、空方法体、仅日志方法或透传返回
- [ ] 计划中的每个功能点都有对应实现方法，且包含真实业务逻辑
- [ ] 未赋值的 VO/DTO 字段有单行注释说明原因
- [ ] 声称“不可用”的注释已对照 `LoginUserInfo` getter 验证

### 清单 14：单元测试质量
- [ ] 每个 `@Test` 至少包含一个 `assert*` / `verify` / `assertEquals`
- [ ] 每个新增 public/protected 方法都有正常路径测试和异常/边界路径测试
- [ ] 断言验证业务含义，而非仅 `assertNotNull`
- [ ] Mock 仅用于外部依赖（Feign、Mapper、文件系统）；核心逻辑不被 Mock

### 常用 LoginUserInfo 字段参考

当清单 13 发现某条注释声称某字段“不可用”时，先对照下表 `LoginUserInfo` getter 验证：

| 字段 | Getter | 注释中常见的“缺失”写法 |
|------|--------|------------------------|
| 医院代码 | `getHospCode()` | hospitalCode, hospDr |
| 医院名称 | `getHospDesc()` | hospitalName |
| 用户代码 | `getUserCode()` | doctorCode, userCode |
| 用户名称 | `getUserName()` | doctorName, userName |
| 医护人员代码 | `getCtCareProvCode()` | careProvCode |
| 医护人员名称 | `getCtCareProvName()` | doctorTitle, careProvName |
| 科室代码 | `getCtLocCode()` | deptCode, locCode |
| 科室名称 | `getCtLocDesc()` | deptName, locDesc |
| 客户端 IP | `getClientIp()` | agentIp, clientIp |
| 客户端 MAC | `getClientMac()` | agentMac, clientMac |
| 病区 ID | `getWardId()` | wardId |
| 角色列表 | `getRoleIdList()` | roleIds |

若声称缺失的字段在上表中存在，则该注释无效 = FAIL。

---

## 相关技能
- **imedicalxc-doctor-extend-engineer** — 完整集成工作流编排器
- **imedicalxc-doctor-extend-dataformat** — VO/DTO 设计与 Jackson 注解细节
