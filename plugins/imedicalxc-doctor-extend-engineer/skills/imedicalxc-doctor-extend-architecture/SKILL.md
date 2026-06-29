---
name: imedicalxc-doctor-extend-architecture
version: 1.0.0
description: |
  HIS 医生站第三方系统集成的架构蓝图与代码组织模板。
  定义系统拓扑、数据流、生命周期钩子、中间件注册表以及计划注入模板。
  在编写计划时用于向任务描述中注入结构性要求。
---

# iMedicalXC 医生站集成架构

HIS 医生站工作流第三方集成的架构蓝图。

> **业务约束规则**：本文档的 `references/domain-constraints.md` 定义了所有业务约束（什么能做/什么不能做、职责边界、接口契约细则、XML 生成方式），是本 skill 的规则子文件。

---

## 1. 系统拓扑与通信模式

### 1.1 三层架构总图

```
┌─────────────────────────────────────────────────────────────┐
│  第 1 层：业务 JS（页面逻辑）                                │
│  例如：/opcare/oeord/scripts/orderEntry.js                   │
│  职责：UI 交互、调用中间件                                   │
│                                                              │
│  Common_ControlObj.BeforeUpdate("Interface", data, cb);    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  第 2 层：业务中间件（Common.Control.js）                    │
│  例如：/opcare/oeord/scripts/OEOrder.Common.Control.js       │
│  职责：抽象业务、编排钩子                                    │
│                                                              │
│  BeforeUpdate：遍历 InterfaceArr，调用各外部接口             │
│  的 BeforeUpdate 钩子                                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  第 3 层：外部接口层                                         │
│  /comoe/interface/{Vendor}/{Module}.js                       │
│  职责：封装第三方 API、透传                                  │
│                                                              │
│  // 形参名必须与中间件 argObj 属性名精确一致（名称匹配）     │
│  OEOrd: {                                                    │
│      BeforeUpdate: function(episodeId, PAAdmType,            │
│                     OrderItemStr, CallBackFunc) { }          │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
            ┌─────────────────┼─────────────────┬─────────────────┐
            ↓                 ↓                 ↓                 ↓
   ┌────────────────┐  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐
   │ WebSocket      │  │ 后端 HTTP    │  │ WebSysAddins  │  │ 后端 ESB      │
   │ (ws://localhost)│  │ Controller   │  │ (DLL/OCX)     │  │ InterfaceUtil │
   │ 方案1：直连    │  │ 方案2：HTTP  │  │ 方案3：中间件 │  │ 方案4：ESB    │
   └───────┬────────┘  └──────┬───────┘  └───────┬───────┘  └───────┬───────┘
            ↓                 ↓                 ↓                 ↓
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  第三方系统（SPD、药房、医保等）                                         │
   └─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 四种标准数据流

**HTTP/REST 模式**：
```
前端（触发） → 后端 Controller（组装数据） → 前端（透传） → 第三方 HTTP
```

**WebSocket 模式**：
```
前端（触发） → 后端 Controller（组装数据） → 前端（WebSocket 发送） → 第三方 WebSocket（localhost）
```

**DLL/OCX 模式**：
```
前端（触发） → 后端 Controller（组装数据） → 前端（透传） → WebSysAddins（转发） → 第三方 DLL
```

**ESB/集成平台模式**：
```
前端（触发） → 后端 Controller（组装数据） → InterfaceUtil.executeRestByBody(interfaceCode, body) → 集成平台（路由转发） → 第三方服务
```

**ESB 模式详细说明**：

与前三种模式不同，ESB 模式的第三方调用**完全在后端完成**，前端不需要透传报文。后端通过 `InterfaceUtil` 直接发起 HTTP/SOAP 调用，经医院信息平台组的集成平台（ESB）路由至第三方服务。

**调用入口**：

| 类 | 来源 | 关键方法 |
|---|------|---------|
| `com.mediway.hos.app.config.util.InterfaceUtil` | `hos-app-config` JAR | `executeRestByBody(interfaceCode, body)`、`executeRest(…)`、`executeSoap(…)`、`pakExecuteRestByBody(…)` 等 30 个公开方法 |

**核心参数 — interfaceCode**：

`interfaceCode` 是 ESB 接口编码，格式为 `"esb-{模块缩写}-{功能名}"`。方法内部通过 `InterfacesCache.me().getByCode(interfaceCode)` 从集成平台接口配置表中获取对应 URL、HTTP 方法、超时时间等配置后发起 HTTP 调用。

**interfaceCode 常量定义规范**：

根据项目的实际编码约定，`interfaceCode` **必须在类中定义为私有静态常量**，禁止在调用处直接写字符串字面量：

```java
// 私有内部静态常量（强制）
private static final String FEE_PRE_CHECK = "esb-DIP-call";
private static final String CALL_HIS_DATA = "esb-DIP-callHisData";
private static final String DIAG_ASSIST_FILL = "esb-DIP-dipdagns";

// 调用
String result = InterfaceUtil.executeRestByBody(FEE_PRE_CHECK, body);
```

若同一模块内多个类共享同一批 interfaceCode，可提取为内部接口常量类：

```java
public static final class InterfaceCode {
    public static final String SHAKEHANDS_CODE = "esb-Recog-shakehands";
    public static final String MAINHR_HR_CODE = "esb-Recog-mainhr";
    // ...
}
```

**禁止行为**：直接写字符串字面量（如 `InterfaceUtil.executeRestByBody("esb-SPD-SPI101", body)`），这会散布接口编码，导致运维排查困难。

**常用方法选用指南**：

| 第三方协议 | 推荐方法 | 入参模式 |
|-----------|---------|---------|
| REST + JSON Body | `executeRestByBody(interfaceCode, body)` | `(String, String)` |
| REST + JSON Body + 自定义 Header | `executeRestByBody(interfaceCode, body, headers)` | `(String, String, Map)` |
| REST + URL 查询参数 | `executeRestByParams(interfaceCode, params)` | `(String, Map)` |
| REST + Form 表单 | `executeRestByFormParams(interfaceCode, formParams)` | `(String, Map)` |
| SOAP XML | `executeSoap(interfaceCode, soapXml, method, headers)` | `(String, String, String, Map)` |
| 返回需解析为 JSONObject | 使用 `pak` 前缀变体（如 `pakExecuteRestByBody`） | 返回 `JSONObject` |

**ESB 模式的特征**：

- 第三方服务不需要对浏览器/前端网络可达，仅需对集成平台开放
- 所有调用由后端发起，敏感凭证（token/secret）不会暴露到前端
- 集成平台负责路由、协议适配、重试、日志审计
- 调用为**同步阻塞**：后端等待第三方响应后处理业务逻辑，再返回前端
- 集成平台侧的接口配置（URL/协议/超时）由医院信息平台组维护，医生站组只持有 `interfaceCode`

**团队归属**：
- **医生站组**：后端 Controller/BLH 中组装数据、调用 `InterfaceUtil`、处理返回值、向前端返回业务结果
- **医院信息平台组**：维护集成平台侧的接口注册、路由配置、协议适配

> 所有模式中，数据组装由后端完成。HTTP/WebSocket/DLL 模式中前端只做透传；ESB 模式中调用完全在后端完成。禁止的数据流见 `references/domain-constraints.md` → 规则 3 / 清单 3。

---

## 2. 设计原则

1. **前端优先设计**：先定义前端接口契约，后端再适配前端契约
2. **后端格式转换**：所有 XML/JSON 组装与转换必须在后端完成。具体约束见 `references/domain-constraints.md` → 规则 5
3. **BLH 模式**：后端必须遵循 BLH（Business Logic Handler）模式（详见 `imedicalxc-doctor-blh`）
4. **后端四层架构**：Controller → BLH → Service → Mapper
5. **生命周期钩子**：使用业务中间件钩子（Init/BeforeUpdate/AfterUpdate）
6. **前后端职责划分**：前后端/WebSocket/中间件职责边界见 `references/domain-constraints.md` → 规则 2

---

## 3. 业务中间件体系

### 3.1 中间件入口识别

当第三方厂商要求“在医嘱过程中嵌入”时，需识别所有相关的业务中间层入口。
以下为医嘱过程最常见的 4 个入口，完整清单见下方决策门禁（§3.1.1）和完整注册表（§3.3）。

#### 3.1.1 入口确认决策门禁（MANDATORY GATE）

**在编写任何外部接口代码之前，必须逐项完成以下决策清单，并由用户确认。**

将第三方需求逐条分解，与下表交叉比对，勾选所有可能涉及的中间件入口。
> 完整注册表见 §3.3（包含 Diag、Treat、OrderView、Card 等所有业务域的中间件入口）。

**医嘱过程入口**（第三方描述含“医嘱”“开立”“处方”“申请”等关键词时，逐项评估）：

| # | 判断条件 | 中间件代码 | 是否需要？ |
|---|---------|-----------|-----------|
| 1 | 第三方需要在**医嘱录入**保存/审核时嵌入？ | **OEOrd** | |
| 2 | 第三方需要在**中草药录入**保存时嵌入？ | **CMOEOrd** | |
| 3 | 第三方需要在**治疗申请**保存时嵌入？ | **Cure** | |
| 4 | 第三方需要在**检查申请、检验申请、病理申请**保存时嵌入？ | **DHCApp** | |

**诊断过程入口**：

| # | 判断条件 | 中间件代码 | 是否需要？ |
|---|---------|-----------|-----------|
| 5 | 第三方需要在**诊断录入**保存/删除时嵌入？ | **Diag** | |

**其他域入口**（按需从 §3.3 补充）：

| # | 判断条件 | 中间件代码 | 是否需要？ |
|---|---------|-----------|-----------|
| 6 | 第三方需要在**住院医嘱总览**停止时嵌入？ | **OrderView** | |
| 7 | 第三方需要在**门诊治疗**流程中嵌入？ | **Treat** | |
| 8 | 第三方需要在**检查/检验结果查看**流程中嵌入？ | **RepExamLis** | |

**确认规则**：
- 每项只能回答“是”或“否”
- 至少一项必须为“是”（如果全部为“否”，则无需外部接口层，直接进入 Funcs 非标准模式）
- 如果第三方需求涉及上述未覆盖的域（如 HISPA 患者管理、OPREG 挂号等），从 §3.3 注册表中按业务域补增对应入口
- 用户确认后，**只读取确认为“是”的中间件 JS 文件**，不读无关的中间件 JS

#### 3.1.2 从确认的中间件 JS 中提取外部接口契约（Step 3A 契约规格输出）

对每个确认的中间件入口，依次读取对应 JS 文件，提取以下三层信息：

1. **文件头“钩子清单”表** → 获取该中间件的完整钩子集、触发时机、argObj 属性名
2. **每个 Required 钩子的 JSDoc `@typedef` + `@example`** → 获取接口层函数签名模板和注册方式
3. **`@see` 指向的后端 DTO / 前端 JS** → 获取参数的数据结构定义

本节输出为 **Step 3A 契约规格输出**，必须通过 §3.1.2.A 与 §3.1.2.B 两个强制门禁后，方可进入 Step 3B 前端契约映射。

##### 3.1.2.A 复杂参数内部结构提取门禁（强制子代理）

当钩子入参为复杂类型（`Object`、`Array`、`{...}` 等）时，仅知道顶层类型不足以正确使用该参数。**主代理禁止自己“看一眼 JSDoc”就填写 `{Object[]}`；必须对每个复杂参数单独派发 Explore 子代理**。

**子代理任务定义**：

- **目标**：提取参数 X 的内部字段结构
- **输入**：
  - 中间件 JS 文件路径
  - 参数名
  - 该参数在 JSDoc 中的 `@typedef` 和 `@see` 列表
- **输出格式强制**（必须产出字段级表格）：

| 字段名 | 类型 | 是否必填 | 业务含义 | 值域/示例 | 来源位置（文件:行号） |
|--------|------|----------|----------|-----------|----------------------|
| `field1` | String | 是 | 示例字段说明 | `A\|B\|C` | `OEOrder.Common.Control.js:123` |
| `field2` | Object | 否 | 嵌套对象 | 见子表 | `OEOrder.Common.Control.js:145` |

**子代理执行顺序**：

1. 先尝试从中间件 JSDoc `@param` 中读取内部字段说明；
2. 若 JSDoc 未说明，则打开中间件源码中该参数的构建/赋值逻辑，逐字段提取；
3. 若参数指向 `@see` 文件，则打开该 `@see` 文件继续提取；
4. 最终输出必须包含**每个字段的来源位置（文件:行号）**，确保可追溯。

**禁止行为**：

- 主代理未派子代理，仅凭类型名脑补内部结构；
- 输出只有顶层类型，没有字段级表格；
- 字段来源位置为空或不可追溯；
- 在外部接口 JS JSDoc 中单独使用 `@param {Object[]}`、`@param {Object}` 或 `@param {Array}` 而不附加字段级内联说明。

##### 3.1.2.B @see 内联阻塞式检查清单

Step 3A 契约规格输出必须附带以下 checklist。**未全部勾选 = 阻塞，不得进入 Step 3B。**

- [ ] 每个 `@see` 指向的 JS 源码位置已打开并提取了字段结构
- [ ] 每个 `@see` 指向的后端 DTO 已打开并提取了字段名、类型、`@ApiModelProperty` 描述
- [ ] 外部接口 JS 的 JSDoc 中，复杂参数以 `[{field1: 类型/含义, field2: 类型/含义}]` 格式写出
- [ ] 不存在仅写 `@param {Object[]}`、`@param {Object}` 或 `@param {Array}` 而未附 `[{field: 类型/含义}]` 内联结构的参数
- [ ] 不存在“仅保留 `@see` 引用行但无内联结构”的参数

**@see 内联步骤**：

1. 打开 `@see` 指向的后端 DTO Java 文件，提取字段名、类型、`@ApiModelProperty` 描述；
2. 打开 `@see` 指向的前端 JS 文件，找到对应的构建/赋值逻辑，理解数据实际形态；
3. 将提取的结构以 `@param {Object[]} paramName - 描述 [{field1: 类型/含义, field2: 类型/含义, ...}]` 格式直接写入外部接口层 JSDoc，不依赖外部文件引用。

`@see` 是待办标记，不是完成状态。仅保留 `@see` 引用行而不做内联 = FAIL。

外部接口层实现时，形参名**必须与中间件 argObj 属性名精确一致**（因为中间件通过 `AnalysisArg` 做名称匹配），返回格式**必须符合 `@example` 中的约定**。

**⚠️ 外部接口层 JSDoc 必须忠实保留中间件 `@example` 的文档信息**：中间件的 `@example` 模板是外部接口层 JSDoc 的权威基线，以下信息禁止在外部接口层中丢失或简化：

1. **`@param` 值域说明**：中间件 `@example` 中描述的值域必须完整保留。如中间件写 `@param {string} PAAdmType - 就诊类型(I:住院, O:门诊, E:急诊, H:体检)`，外部接口层不得简化为 `@param {string} PAAdmType - 就诊类型`
2. **内部结构标注**：中间件 `@example` 中已标注的数组/对象内部结构（如 `[{addRowId: rowid, orderType: orderType, partIds: ""}]`）必须保留，不得简化为泛型描述（如“行 ID 列表”）
3. **类型精确性**：中间件 `@example` 标注的类型（如 `{string}`）不得在外部接口层升级为更宽泛的类型（如 `{Array}`）。若对类型有疑问，必须查阅 `@see` 指向的数据源确认

禁止行为：以“精简注释”为由删除中间件 `@example` 中的任何结构化文档信息。外部接口层 JSDoc 是中间件契约的下游副本，信息只可增加不可删减。

### 3.2 生命周期钩子

具体的钩子名称、触发时机、argObj 属性名、函数签名模板，已通过 §3.1.2 从确认的中间件 JS 文件中提取，以下为通用规范。

#### 标准钩子

| 钩子 | 触发时机 | 是否必填 | 用途 |
|------|---------|----------|------|
| `Init` | 页面初始化 | 是 | 初始化外部接口、加载配置 |
| `xhrRefresh` | 患者切换 | 否 | 刷新患者相关数据 |
| `BeforeUpdate` | 数据保存前 | 是 | 校验、拦截、修改数据 |
| `AfterUpdate` | 数据保存后 | 否 | 同步、打印、通知 |
| `AfterAdd` | 添加数据行后 | 否 | 行级处理 |
| `BeforeStop` | 停止医嘱前 | 否 | 停止前校验 |
| `AfterStop` | 停止医嘱后 | 否 | 同步停止结果 |
| `BeforeDelete` | 删除记录前 | 否 | 删除前校验 |
| `AfterDelete` | 删除记录后 | 否 | 同步删除结果 |

> 不同中间件支持的钩子不同。例如 OEOrd 有 BeforeStop/AfterStop（无 BeforeDelete），Diag 有 BeforeDelete/AfterDelete（无 BeforeStop）。以各中间件 JS 文件头的“钩子清单”表为准。

#### 钩子实现要求

1. **方法签名必须精确匹配**：参数名和类型必须匹配。中间件使用 `AnalysisArg` 按名称匹配，因此参数名至关重要，顺序不重要。
2. **必须调用回调函数**：所有方法必须通过回调返回，不得阻塞
3. **返回格式必须标准**：使用统一返回对象格式
4. **错误处理必须完整**：所有异常都通过回调返回错误信息

#### 标准返回格式

```javascript
// BeforeUpdate / AfterUpdate 返回格式
{
    SuccessFlag: true/false,        // 必填
    UpdateFlag: true/false,         // 可选：数据是否被修改
    OrderItemStr: "...",            // UpdateFlag=true 时必填
    UpdateOrderItemList: [...],     // 可选
    ErrorMessage: "..."             // SuccessFlag=false 时必填
}

// Init / xhrRefresh / AfterAdd 返回格式
{
    SuccessFlag: true/false,
    ErrorMessage: "..."
}
```

#### 注册

外部接口 JS 必须在文件末尾注册：
```javascript
PushInterfaceArr(VendorModuleObj);
```

### 3.3 中间件注册表（完整注册表）

§3.1 的入口表仅覆盖医嘱/诊断相关入口。下表为所有业务域的完整注册表。如 §3.1.1 决策清单未覆盖的需求，从本表按业务域补充。

#### 临床（门诊与住院）

| 代码 | 说明 | 中间件 JS 路径 | 模块 |
|------|------|----------------|------|
| **Diag** | 诊断录入 | `/opcare/mrdia/script/diagnosentry.common.control.js` | opcare-mrdia |
| **OEOrd** | 医嘱录入 | `/opcare/oeord/scripts/OEOrder.Common.Control.js` | opcare-oeord |
| **CMOEOrd** | 中草药录入 | `/opcare/oeord/scripts/OEOrderCM.Common.Control.js` | opcare-oeord |
| **Cure** | 治疗申请 | `/opcare/oeord/scripts/OEOrder.Common.Control.js` | opcare-oeord |
| **DHCApp** | 检查/检验/病理申请 | `/comoe/exam/scripts/dhcapp.common.control.js` | comoe-exam |
| **RepExamLis** | 检查/检验结果查看 | `/comoe/exam/scripts/RepExamLis.Common.Control.js` | comoe-exam |

> **注意**：`Cure` 与 `OEOrd` 共用同一中间件 JS 文件 `/opcare/oeord/scripts/OEOrder.Common.Control.js`。实现外部接口层时，必须以该文件头钩子清单表为准确认 Cure 相关钩子的对象 key 与参数名，禁止自行假设其为独立 `Cure` 对象或复制 OEOrd 示例参数名。

#### 门诊（OPCare）

| 代码 | 说明 | 中间件 JS 路径 | 模块 |
|------|------|----------------|------|
| **Treat** | 门诊接诊患者的中间层，包括多媒体呼叫、接诊患者 | `/opcare/adm/scripts/treat.common.control.js` | opcare-adm |

#### 住院（IPCare）

| 代码 | 说明 | 中间件 JS 路径 | 模块 |
|------|------|----------------|------|
| **OrderView** | 医嘱总览 | `/ipcare/oeord/scripts/inpatorderview.common.control.js` | ipcare-oeord |

#### 患者管理（HISPA）

| 代码 | 说明 | 中间件 JS 路径 | 模块 |
|------|------|----------------|------|
| **Card** | 卡管理 | `/hispa/pat/scripts/card.common.control.js` | hispa-pat |

#### 挂号（OPREG）

| 代码 | 说明 | 中间件 JS 路径 | 模块 |
|------|------|----------------|------|
| **AdmReg** | 挂号 | `/opreg/opreg-adm/scripts/reg.common.control.js` | opreg-adm |
| **AdmReturn** | 复诊 | `/opreg/opreg-adm/scripts/return.common.control.js` | opreg-adm |
| **CardReturn** | 退卡 | `/opreg/opreg-pat/scripts/cardreturn.common.control.js` | opreg-pat |
| **CardReg** | 建卡 | `/opreg/opreg-pat/scripts/CardReg.Common.Control.js` | opreg-pat |

> **范围与后端模块提醒**：本注册表覆盖多业务域中间件入口。`opcare`/`ipcare` 域的临床工作流集成，后端 Controller 按 §4.1 放入 `opcare-mediway-boot`/`ipcare-mediway-boot`。`hispa`/`opreg`/`comoe-exam` 等非临床域集成，需先通过 `imedicalxc-doctor-extend-scope` 确认团队归属与后端模块，不得默认套用 opcare/ipcare 规则。

### 3.4 外部接口对象结构模板

```javascript
var VendorModuleObj = {
    Name: "Vendor_Module",
    // ============================================================
    //  可配置常量
    //  所有因项目/医院/厂商而异的第三方参数，必须走外部接口管理扩展设定，
    //  通过 BusInterfaceConfigAbstract 读取，禁止在此处硬编码。
    // ============================================================
    Config: {
        // 非敏感配置由后端在 Init/BeforeUpdate 时注入
        baseUrl: "",        // 第三方服务基地址，必填
        timeout: 30000,     // 调用超时（毫秒），默认 30000
        // 敏感配置（token/appKey/secret）仅在后端读取，禁止进入前端作用域
    },

    // ============================================================
    //  私有辅助方法
    // ============================================================
    ///TODO: 私有方法（如数据转换、日志记录、标准请求封装等）

    /**
     * ==========================================
     * OEOrd 医嘱录入中间层生命周期钩子实现
     * 对应中间层：/opcare/oeord/scripts/OEOrder.Common.Control.js
     * 其他中间层钩子实现类似，参数（Args）和职责（Hook 位置）需要严格遵守中间层定义
     * ==========================================
     */
    OEOrd: {
        // ⚠️ 以下参数名为 OEOrd 示意，禁止直接复制到其他中间件。实际参数名必须以对应中间件 JS 文件头的钩子清单表和 @typedef 为准（AnalysisArg 名称匹配）。
        // 注意：不同中间件的 argObj 属性名大小写可能不同（如 OEOrd 用 episodeID，Diag 用 EpisodeID）
        // 必须以各中间件 JS 文件头的 @typedef 定义为准
        Init: function(episodeId) { },
        xhrRefresh: function(episodeID, PAAdmType) { },
        BeforeUpdate: function(episodeId, PAAdmType, OrderItemStr, CallBackFunc) { },
        AfterUpdate: function(episodeId, PAAdmType, OEOrdItemIDs) { }
    },
    
    /**
     * ==========================================
     * CMOEOrd 中草药录入中间层生命周期钩子实现
     * 对应中间层：/opcare/oeord/scripts/OEOrderCM.Common.Control.js
     * ==========================================
     */
    CMOEOrd: {
        Init: function(episodeId) { },
        BeforeUpdate: function(episodeId, PAAdmType, OrderItemStr, CallBackFunc) { }
    },
    
    /**
     * ==========================================
     * 非标准业务流程，用于实现无法嵌入到标准钩子函数的嵌入点
     * 需要自行实现，大部分情况下都需要配合做业务代码改造，例如在医嘱录入界面增加一个按钮，单独触发某个第三方接口
     * ==========================================
     */
    Funcs: {
        // 函数名自定义，形参名同样通过 AnalysisArg 从 argObj 按名匹配
        XHZY: function(ARCIMRowid) { },
        YDTS: function() { }
    }
};

PushInterfaceArr(VendorModuleObj);
```

---

## 4. 代码组织蓝图

### 4.1 文件放置位置

| 组件 | 位置 | 说明 |
|------|------|------|
| **前端外部接口 JS** | `{hisfront}/static/comoe/interface/{Vendor}/{Module}.js` | 厂商子目录（如 `WanDaXinXi`）必须存在，禁止直接放在 `comoe/interface/` 根下。`{hisfront}` 是前端独立根目录，非 `his/hisfront/` |
| **后端 Controller** | `opcare-mediway-boot` 或 `ipcare-mediway-boot` | **绝不放在 comoe-mediway** |
| **后端 BLH** | `{模块}/blh/{功能}/ext/` | 实现类必须在 ext 子包下 |
| **后端 Service** | `{模块}/service/` | 公共 Service 在 comoe 中 |
| **中间件** | WebSysAddins 独立工程 | 通过 `imedical-bsp-websysaddins` 开发 |

### 4.2 标准分层

**前端三层**（参见 §1.1 总图）：
```
业务 JS（第 1 层） → 业务中间件（第 2 层） → 外部接口层（第 3 层） → 三种通道 → 第三方
```

**后端四层**：
```
Controller → BLH（Abstract → CommonBLH / RegionBLH / ProjectBLH） → Service → Mapper
```
> BLH 详细规范见 `imedicalxc-doctor-blh`；Service/Mapper 数据查询规范见 `imedicalxc-doctor-dbdata`。

**中间件通道**（参见 §1.2 DLL 模式）：
```
WebSysAddins → DLL/OCX → 第三方客户端
```

**WebSocket 通道**（参见 §1.2 WebSocket 模式）：
```
前端（触发） → 后端 Controller（组装数据） → 前端（WebSocket 发送） → 第三方 WebSocket（localhost）
```

---

## 5. 实施计划注入模板

计划拆分时，按任务类型注入以下结构项。每项描述结构要求，业务约束内容由 `references/domain-constraints.md` 提供。

### 前端任务注入模板

> **通用约束来源**：前端外部接口 JS 的通用约束（职责边界、数据流、代码位置、返回格式、PushInterfaceArr 注册等）已集中在 `references/domain-constraints.md` → 清单 2-4、6-9、12-14。本模板只保留架构与计划注入特有的要求。

> **⚠️ 编写外部接口 JS 时的参考优先级**：
> 1. **第一参考（权威契约）**：对应中间件 JS 文件中的 JSDoc `@typedef` + `@example` — 定义钩子签名、形参名、返回值格式
> 2. **第二参考（代码骨架）**：主 skill §3.4 外部接口对象结构模板 — 定义文件整体结构
> 3. **补充参考**：`references/domain-constraints.md` 中的约束清单
> 4. **禁止作为主参考**：其他已存在的外部接口 JS 实现文件、IDE 本地历史文件（`.history/`）。这些可能包含过时模式、错误实现或非标准写法，不得直接复制

- [ ] 已通过 §3.1.1 决策门禁逐项确认需要嵌入的中间件入口
- [ ] 已读取每个确认入口的中间件 JS 文件，提取了 §3.1.2 的三层契约信息（钩子清单表 / @typedef+@example / @see 指向的 DTO）
- [ ] **入参语义理解**：对每个钩子的每个入参（中间件 argObj 注入的属性），必须彻底理解其含义后才能开始编写代码。理解的内容包括：参数代表什么业务概念、在什么场景下生成、值域范围是什么、与其他参数的关系。禁止在不理解参数含义的情况下盲目透传或随意选择参数传递给后端。具体要求：
  - 每个入参的含义已在代码注释中标注（一行中文说明）
  - 选择了哪些入参传递给后端，选择的理由（与后端 DTO 字段对应）
  - 未使用的入参，说明原因
  - **复杂参数内部结构文档化**：若入参为 `Object`/`Array`/复杂结构，必须提取其内部字段名、类型、含义并注释在钩子函数上方。若中间件 JSDoc 未描述内部结构，需阅读中间件源码提取，不得仅标注 `@param {Object}`、`@param {Object[]}` 或 `@param {Array}` 即透传。同一后端接口的同一字段，被不同钩子传入时，类型必须一致（如两个钩子都往 `orderItemList` 传值，不能一个传 Array 一个传 string）
- [ ] **`@see` 内容已内联**：中间件 `@example` 中每个 `@see` 指向的文件已经实际打开阅读，目标文件中的数据结构定义已提取并以 `[{field: 含义}]` 格式写入外部接口层 JSDoc。`@see` 引用可保留作为溯源标记，但**不能替代**内联的结构说明
- [ ] 已按 §5.1.1 要求输出 Step 3B 三向映射表，并确认映射表中每个前端入参字段已在 §3.1.2.A 中完成内部结构提取、每个后端 VO setter 已存在于实际 DTO/VO 中
- [ ] 所有报文内容透传自后端，前端不做解析和修改
- [ ] **第三方可变参数管理**：非敏感配置（如 `baseUrl`、`timeout`）由后端在 `Init` / `BeforeUpdate` 时注入到 `VendorModuleObj.Config`，禁止在前端 JS 中硬编码第三方 URL、端口、token、appKey、secret 等项目差异参数
- [ ] **敏感参数隔离**：`token`、`appKey`、`secret` 等敏感参数不得进入前端作用域、不得写入前端配置文件或本地存储
- [ ] 完整审查见 `references/domain-constraints.md` → 清单 2-4、6-9、12-14

#### 5.1.1 Step 3B 前端契约映射：三向映射表

在计划的前端契约章节中，必须输出以下格式的映射表。该表**必须在打开 `@see` 文件、完成 §3.1.2.A 字段提取后才能填写**，禁止从 JSDoc 类型名直接脑补。

| 第三方 XML 字段 | HIS 业务概念 | 前端入参字段 | 前端入参类型 | 后端 VO setter | 备注 |
|-----------------|--------------|--------------|--------------|----------------|------|
| YPMC | 医嘱项名称 | GridColumnsParam.orderName | String | setYpmc | 需确认实际字段名 |
| YPGG | 单次剂量+单位 | orderDoseQty + orderDoseUOM | String | setYpgg | 拼接 |

- [ ] 映射表中的每个前端入参字段已在 §3.1.2.A 中完成内部结构提取
- [ ] 映射表中的每个后端 VO setter 已确认存在于实际 DTO/VO 中

### 后端任务注入模板

> **通用约束来源**：后端实现的通用约束（Controller/BLH 位置、VO/DTO 规范、报文生成、BaseResponse、外部接口注册、敏感参数等）已集中在 `references/domain-constraints.md` → 规则 2、规则 5、清单 2-7、11-14，以及 `imedicalxc-doctor-extend-dataformat`、`imedicalxc-doctor-blh`、`imedicalxc-doctor-invoke`、`imedicalxc-doctor-dbdata`。本模板只保留架构与计划注入特有的要求。

- [ ] 分层：Controller → BLH（Abstract/CommonBLH）→ Service → Mapper
- [ ] BLH 实现放 **Abstract 父类**：真正的业务逻辑（参数校验、数据装配、Service 编排）写在 Abstract 中
- [ ] CommonBLH **仅做 @BLH 注解路由壳**，继承 Abstract，不写入任何业务实现代码
- [ ] RegionBLH / ProjectBLH 只 override 需要差异化方法，其余逻辑全部继承 Abstract
- [ ] **字段名验证（implementer 子代理第一步）**：后端 implementer 拿到 DTO/VO 后，第一步不是写 XML 组装，而是：
  1. 打开计划中引用的 DTO/VO Java 文件（例如 `GridColumnsParam.java`、`OeOrdItemVO.java`），列出所有可用 getter；
  2. 与 Step 3B 三向映射表中的后端 VO setter 列逐项比对；
  3. 如果计划中的 getter/setter 不存在，立即反馈，不得用相似字段名猜测。
- [ ] 数据库查询：基础字典用 DocCacheUtils，配置数据用 hiscfsv 常量类枚举式读取（详见 `imedicalxc-doctor-dbdata`）
- [ ] 内部产品组调用：封装在 invoke 模块中（详见 `imedicalxc-doctor-invoke`）
- [ ] **第三方可变参数读取**：创建/复用配置读取 Service/BLH，统一通过 `com.mediway.his.hiscfsv.ipcare.doctor.blh.BusInterfaceConfigAbstract#findLinkSubValByCode`（或 `findLinkDataByCode`）读取扩展设定参数
- [ ] **配置缓存**：使用 `DocCacheUtils` 缓存扩展设定，缓存 key = `thirdparty:{vendor}:{module}:{hospCode}:{paramKey}`
- [ ] **缓存刷新**：提供配置变更后的缓存清除或刷新机制，或在配置说明文档中明确“修改扩展设定后需重启/清缓存”
- [ ] **编译门禁**：代码完成后必须执行 `mvn compile -DskipTests`（UTF-8 编码），exit 0 且无 ERROR 输出方可通过
- [ ] 完整审查见 `references/domain-constraints.md` → 规则 2、规则 5、清单 2-7、11-14

### 中间件任务注入模板

- [ ] 标签：`type: middleware`，`skill: imedical-bsp-websysaddins`
- [ ] 在架构中的位置：§1.2 DLL 通道
- [ ] 中间件只提供转发通道，不处理业务逻辑
- [ ] 交付物：fat-jar + 配置说明.md + 前端调用说明.md + 源码说明.md
- [ ] 职责边界见 `references/domain-constraints.md`

### WebSocket 任务注入模板

- [ ] 在架构中的位置：§1.2 WebSocket 通道
- [ ] 前端在 trigger 点完成 connect / send / receive / close
- [ ] 报文内容由后端组装后透传，前端不解析不修改
- [ ] 30 秒超时配置
- [ ] 所有分支调用 CallBackFunc 返回结果
- [ ] 约束细节见 `references/domain-constraints.md`

### 5.5 计划阶段 JSDoc 保真度 mini-review 门禁（Step 3C 计划审批前）

**⚠️ 本门禁必须在前端契约任务完成后、整个计划批准前执行。不通过则阻塞进入 Step 3C 计划审批。**

在前端契约映射（Step 3B）完成后、计划进入审批（Step 3C）之前，主代理必须做一次 JSDoc 保真度 mini-review：

- [ ] 外部接口 JS JSDoc 与中间件 `@example` 逐项比对，无遗漏参数、无简化值域
- [ ] 每个复杂参数均有内部结构说明（字段名 | 类型 | 是否必填 | 业务含义 | 值域/示例 | 来源位置）
- [ ] 值域说明未丢失（如 `PAAdmType` 的 `I:住院, O:门诊, E:急诊, H:体检` 等）
- [ ] 每个 `@see` 均已内联，不存在仅保留引用行的情况

**阻塞规则**：上述 checklist 任一项未通过，立即返回补充 §3.1.2 契约规格输出或 Step 3B 三向映射表，不得进入计划审批。

---

## 参考文档

| 文档 | 路径 | 内容 |
|------|------|------|
| **模块注册表** | `references/module-registry.md` | 27 个已注册业务模块（医保卡、SPD、合理用药等） |
| **厂商目录** | `references/vendor-directory.md` | 厂商命名约定与已注册厂商列表 |
| **前端架构** | `references/frontend-architecture.md` | 医为浏览器（CEFSharp 109）特性、JS 与本地客户端交互 |
| **前端集成模式** | `references/frontend-integration-patterns.md` | 同步/异步调用模式、错误处理、性能优化 |
| **外部接口管理** | `references/external-interface-management.md` | CF_Doc_Interface_Portal 注册、命名约定 |
| **基础数据统一对照** | `imedicalxc-doctor-dbdata` → 基础数据统一对照 | HIS代码与第三方代码映射的标准方法论（convertData、前端配置操作步骤、第三方接口开发标准步骤） |
| **医保对照数据** | `imedicalxc-doctor-dbdata` → 医保对照数据获取 | 医院/医护人员医保编码、医嘱项/诊断医保目录对照及 ArInsuCtApi 扩展方法规范 |
| **合并查询** | `imedicalxc-doctor-dbdata` → 合并查询（Merge Query） | 多表合并查询的标准方法论（两类合并场景、Merge Service 清单、命名规范） |

## 相关技能
- **imedicalxc-doctor-extend-engineer** — 完整集成工作流编排器
- **imedicalxc-doctor-extend-dataformat** — VO/DTO 设计与 Jackson 注解细节
- **imedicalxc-doctor-blh** — BLH 模式开发规范
- **imedicalxc-doctor-invoke** — 内部产品组 invoke 模块规范
- **imedicalxc-doctor-dbdata** — 数据库查询规范
- **imedical-bsp-websysaddins** — WebSys Addins 平台技术支持（BSP 组）
