---
name: iris-interface-build
description: 当需要实际开发一个 IRIS 接口（前端 JavaScript + 后端 ObjectScript）时使用：覆盖厂家/模块/业务中间层接入管理（框架A）、接口方法注册与统一调度 DHCDocHisInterface/SOAP/HTTP（框架B），以及对外数据视图 Query 实现（框架C），端到端产出可编译的 .cls/.js/.csp 源码与配置项。关键词：接口开发、accessmanage、中间件JS、DHCDocHisInterface、接口方法注册、SOAP/HTTP、厂家接入、medStepCode、视图Query、websys.Query。
---

# IRIS 接口开发（实现）

把"接口需求"落成可运行的 IRIS 源码与配置：后端 ObjectScript 类方法/Query，前端中间件 JS（或 CSP 调用），以及 `dhcdoc.interface.accessmanage.csp` / `dhcdocinterfaceregister` 中的配置项。

本 skill 是 `iris-interface-dev` 插件中唯一负责"写代码"的实现技能。文档解析、字段匹配、计划仍由 `init`/`doc-ingest`/`field-match`/`dev-plan` 负责；离线审查仍走 `iris_interface_review`。v1 的"不生成最终 ObjectScript"限制只针对计划类 skill——本 skill 是与之互补的实现技能，但编译/上传/远端验证/部署仍须交给 `coding-iris-plugin`，且默认禁止远程写入，除非用户明确要求。

## 必读（规范基础）

1. 总索引与约束：`../../rules/iris_interface_index.md`、`../../rules/iris_interface_workflow.md`、`../../rules/iris_interface_review.md`
2. 代码模板与配置契约：`../../references/iris-interface-build-conventions.md`
3. **medStepCode 值域说明（何时用哪个诊疗环节、可用事件）：`../../references/medstepcode-values.md`**
4. 实现对外数据视图 Query 时读取：`../../references/iris-query-view-template.md`
5. 接入管理（框架A）源码事实：
   - CSP 入口：`src/frontend/public/csp/dhcdoc.interface.accessmanage.csp`（含 `accessmanage.show.csp`、`scripts/dhcdoc/interface/accessmanage.js`）
   - 后端：`src/backend/public/DHCDoc/Interface/AccessManage.cls`（`LoadJS` / `GetAccessLinkInfo` / `SaveAccessLink` / `GetAccessLinkExt` / `CheckOpenInterface` / `CallModuleMethod`）
   - 中间件 JS 范例：`src/frontend/public/scripts/dhcdoc/interface/iMedical/CDSS.js`
6. 方法注册与统一调度（框架B）源码事实：
   - 注册 UI：`src/frontend/public/csp/dhcdocinterfaceregister.hui.csp`（含 `.show.hui.csp`）
   - 调度类：`src/backend/public/web/DHCDocInterfaceMethod.cls`（`DHCDocHisInterface` / `WebServiceInterface` / `HttpServiceInterface` / `RunSql` / `DebugInterfaceMethod`）
   - SOAP 入口：`src/backend/public/web/DHCDocInterfaceWebService.cls`（`DHCWebInterface`）
   - 页内调度：`src/backend/public/DHCDoc/GetData/Portal.cls`（`DHCDocHisInterface`）
   - 后端实现范例：`src/backend/public/DHCDoc/Interface/Inside/CDSS.cls`（既有范例；**新接口建议放 `DHCDoc.Interface.Outside.<X>` 或业务包下**）
7. 编码规范（写代码时按需加载）：`coding-iris-plugin` 的 `iris-coding` / `iris-backend-coding` / `iris-frontend-coding` / `iris-frontend-gb2312-promote`

> 本地代码可能不完整。编码前先按 AGENTS.md「编码前规则路由」确认目标类/JS/页面是否已导出；缺失时先从服务器导出再修改（默认禁止远程写入，除非用户明确要求）。

## 三套机制的关系（先分清再用）

- **框架A（accessmanage）= 对外接口接入管理**：维护 厂家(Company) / 模块(Module) / 业务中间层(Product) / 关联(Link) / 扩展(Ext)。每个 厂家+模块 对应一个固定路径中间件 JS `scripts/dhcdoc/interface/<厂家代码>/<模块代码>.js`，由 CSP 通过 `DHCDoc.Interface.AccessManage.LoadJS(SessionStr, ProductDomain, medStepCode)` 动态加载。适合"第三方/厂家按诊疗环节(Reg/Diag/Order/…)注入能力"的场景。
- **框架B（方法注册+调度）= 接口方法统一注册与调用**：在 `User.DocInterfaceMethod` 注册 接口代码 → 类.方法，由 `web.DHCDocInterfaceMethod.DHCDocHisInterface(接口代码, 入参...)` 按 `interfaceType`(HIS/SOAP/HTTP) 与 `methodType`(ClassMethod/Query/Sql) 统一分发；对外提供 SOAP `DHCWebInterface` 与 HTTP 调用；页内调用走 `DHCDoc.GetData.Portal.DHCDocHisInterface`。
- **框架C（对外数据视图 Query）= 视图类型只读多行数据后端实现**：面向外部系统通过 `SqlProc` 拉取 HIS 数据的只读视图，通常是框架B 中 `methodType=Query` 的后端落地形态；不涉 UI 注入、不需要 `medStepCode`。Query 实现约束、时间索引选择与模板见 `../../references/iris-query-view-template.md`。
- **组合关系**：A 与 B 可组合——中间件 JS（A）内部用 `$.cm({ClassName, MethodName})` 调用后端类（该类既可以是普通类，也可以是 B 中注册的接口方法）；页内也可直接通过 B 的调度入口拿数据。框架C 通常作为 B 的 `methodType=Query` 后端一起交付（C 不触发 UI 注入，故与 A 无组合关系）。

## 开发流程（端到端）

### 0. 需求澄清（门禁）
- 明确：这是"厂家按环节注入"（走 A）、"注册一个可被 SOAP/HTTP/HIS 统一调用的接口"（走 B），还是两者组合。
- 明确入参/出参：
  - **出入参推荐统一用 `%DynamicObject` 承载**（字段即属性，易扩展、易校验、与 JSON 自然互转）。
  - 仅当超长 / 流式报文（如大段 XML/文件）时改用 `%Stream.GlobalCharacter`。
  - 简单标量（单值、短字符串）可用 `%String`。
  - 字段名、类型、是否必填、备注、值域都要列清；类型说明与模板见 `../../references/iris-interface-build-conventions.md` §1。
- 明确 medStepCode（仅 A 需要）：取值与含义、典型业务环节、可用生命周期事件见 **`../../references/medstepcode-values.md`**，常用 `Reg`/`Diag`/`Order`/`Disp`/`Exam`/`Opera`/`Bill`/`Other`；并明确触发事件（`BeforeUpdate`/`AfterUpdate`/`AfterDelete`/`BeforePrint`…），具体可用事件以对应中间件 JS 文件头"钩子清单表"为准。

### 1. 后端实现（ObjectScript）
- 普通后端类（A 的厂商类 / B 的被调类）：放在 **`DHCDoc.Interface.Outside.<X>` 或业务包下**，继承 `DHCDoc.Util.RegisteredObject`。（既有范例 `DHCDoc.Interface.Inside.CDSS` 仍可作参考，新接口建议统一放 `Outside`。）
- 返回值：`%DynamicObject` 后用 `.%ToJSON()` 返回 JSON 字符串；**视图类型 Query 用 `websys.Query(ROWSPEC=...)`**（见 **框架C**，权威模板 `../../references/iris-query-view-template.md`），并在方法注释写 ROWSPEC；在 `User.DocInterfaceMethod` 注册时按 `methodType` 选 `ClassMethod`/`Query`/`Sql`。
- 入参解析：`$g(Input(n))`；超长/流式用 `%Stream.GlobalCharacter`；日期统一 `yyyy-mm-dd` / `hh:mm:ss`（见 `RunSql` 注释约定）。
- 异常处理：`s $zt="ErrTag"` + `ErrTag s $zt="" q "-1^"_$ze`（或返回 `GetOutputObj("false",...,$ze)`）。
- 国际化：提示文案用 `..%Translate("<csp页面>", "<中文>", langid)` 或 `$g(...)`。
- **禁止点号循环体**：`.s .f .i .q .d` 及 `..s ..f ..i ..q ..d` 必须在离线审查阶段失败（见 `iris_interface_review`）。

### 2. 配置维护（基础依据）
- **A（accessmanage.csp）**：依次维护 厂家(自动生成代码) → 模块 → 业务中间层 → 关联(厂家+模块+LinkClass+ProductDomain+ActiveFlag+ReferenceJS+科室授权+扩展)。或用 `DHCDoc.Interface.AccessManage` 的类方法批量维护。
- **B（dhcdocinterfaceregister）**：填写 接口代码/名称/接口类型(HIS/SOAP/HTTP)/调用类型(S服务/C调用)/方法类型(ClassMethod/Query/Sql)/类名称/方法名称/入参/出参/日志标识/启用；入参出参以 `$C(28)` 分隔记录、`$C(14)` 分隔字段（`type^requireFlag^desc^note^extNoteHidden^keyname`，出入参类型推荐 `%DynamicObject`，见 conventions §1）。详细契约见 `../../references/iris-interface-build-conventions.md`。

### 3. 前端实现（JavaScript）
- **A 中间件 JS**：新建 `scripts/dhcdoc/interface/<厂家代码>/<模块代码>.js`，IIFE 包裹，定义 `ProductObj = { Name, <medStepCode>: { <Event>: fn } }`，结尾 `PushInterfaceArr(ProductObj)`。通过 `$.cm({ClassName, MethodName, ...})` 调后端（后端类用 `DHCDoc.Interface.Outside.<X>`）。`medStepCode` 与事件钩子取值见 `../../references/medstepcode-values.md`。
- **B 页内调用**：CSP/JS 用 `$.cm({ClassName:"web.DHCDocInterfaceMethod", MethodName:"DHCDocHisInterface", KeyName:"<接口代码>", ...})` 或经 `DHCDoc.GetData.Portal.DHCDocHisInterface`；SOAP 外部用 `DocWebService.DHCWebInterface`。
- HISUI 组件、多语言 `$g`、GB2312 提升按 `iris-frontend-*` 规范。

### 4. 验证
- 后端单测：`w ##class(web.DHCDocInterfaceMethod).DebugInterfaceMethod(<RowID>, "<入参$C(28)拼接>")`
- 页内：`w ##class(DHCDoc.GetData.Portal).DHCDocHisInterface("<接口代码>", <参数>)`
- SOAP：`w ##class(web.DHCDocInterfaceWebService).DHCWebInterface("<接口代码>", <流式入参>)`
- 界面自测：accessmanage 的关联"调试"、`dhcdoc.interface.outside.test.hui.csp`、日志 `dhcdoc.interface.accesslog.csp` / `dhcdoc.interfacelog.hui.csp`
- 离线审查：按 `iris_interface_review` 核对字段产物与点号循环体（可跑 `scripts/iris-interface-review.py`）。

### 5. 交付门禁
- 源码写入本地；**编译/上传/远端验证/部署必须交给 `coding-iris-plugin`**，且默认禁止远程写入，除非用户明确要求。
- 字段覆盖、出入参、日志开关与界面一致；**不得把连接/账号/密钥写入 skill 或记忆**。

## 输出
- 新增/修改的 `.cls`（后端类/方法）、`.js`（中间件或页内调用）、必要时 `.csp`（若需新页面）。
- accessmanage / dhcdocinterfaceregister 的配置项说明（代码或 SQL 片段，不写真实凭据）。
- 验证记录（调试命令与期望输出）。

## 硬边界
- 本 skill 写源码，但不替代 `coding-iris-plugin` 的编译/上传/部署与远端验证。
- 不生成点号循环体；不把真实连接/密钥落入产物。
- 出入参类型优先 `%DynamicObject`（复杂结构不得滥用 `%String`），详见 `../../references/iris-interface-build-conventions.md` §1。
- 若需求仅到"计划"阶段，转 `iris-interface-dev-plan`，不要在此直接落地代码。
- 不臆造 `User.DocInterfaceMethod` / accessmanage 的注册事实；配置项以界面或类方法调用为准，缺数据先导出。
