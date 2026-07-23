# IRIS 接口实现规范参考（iris-interface-build）

与 `skills/iris-interface-build/SKILL.md` 配套，沉淀 iMedical IRIS 接口框架的代码模板与配置契约。示例基于已验证的 `accessmanage`、`DHCDocInterfaceMethod`、`DHCDoc.GetData.Portal`、`DHCDoc.Interface.Inside.CDSS` 和中间件 JS 模式；使用前仍须从目标项目导出并核对对应实现。

> 新接口后端实现类建议放在 `DHCDoc.Interface.Outside.<X>` 或业务包下（既有范例 `DHCDoc.Interface.Inside.CDSS` 仍可作参考，但其位于 `Inside`，新代码统一用 `Outside`）。

---

## 1. 入参 / 出参存储格式（框架B 注册表）

`User.DocInterfaceMethod` 的 `methodInput` / `methodOutput` 是字符串：

- 多条记录之间用 `$C(28)`（File Separator，0x1C）拼接。
- 单条记录内字段用 `$C(14)`（Shift Out，0x0E）拼接。

**入参字段顺序**（6 段）：`type ^ requireFlag ^ desc ^ note ^ extNoteHidden ^ keyname`
- `type`：`%String` / `%Stream.GlobalCharacter` / `%DynamicObject`
- `requireFlag`：`Y` 必填 / 空 可选
- `desc`：字段中文说明
- `keyname`：代码中引用名（缺省时框架补 `inputN` / `outputN`）

**出参字段顺序**（5 段）：`type ^ desc ^ descHidden ^ extNoteHidden ^ keyname`

### 出入参类型推荐（重要）

- **推荐统一用 `%DynamicObject` 承载出入参**：字段即属性，易扩展、易校验，且与 JSON 自然互转（`%ToJSON()` / `%FromJSON()`）。复杂结构（嵌套对象/数组）尤其适合。
- 仅当**超长 / 流式报文**（如大段 XML、文件内容、超过单值长度限制）时改用 `%Stream.GlobalCharacter`。
- 简单标量（单值、短字符串、单个 ID）可用 `%String`。
- 注册时 `type` 列按上述选择填写；字段名、是否必填、备注、值域都要列清。

> 调试时拼接入参示例：`d ##class(web.DHCDocInterfaceMethod).DebugInterfaceMethod(<RowID>, "val1"_$C(28)_"val2")`

---

## 2. 后端类模板（ObjectScript）

### 2.1 厂商类 / 被调类（返回 JSON 字符串）

```objectscript
/// <厂商/模块> 后台数据统一输出类
/// Creator: <你>
/// CreateDate: <YYYY-MM-DD>
Class DHCDoc.Interface.Outside.<X> Extends DHCDoc.Util.RegisteredObject
{

/// Desc: <业务说明>
/// Input: EpisodeID:就诊ID
/// Output: JSON 字符串
ClassMethod GetXxx(EpisodeID, SessionStr = "") As %String
{
    s $zt="GetXxxErr"
    s:SessionStr="" SessionStr=..%SessionStr()
    Q:EpisodeID="" ""
    s UserID=$p(SessionStr,"^",1)
    s LocID=$p(SessionStr,"^",3)
    s HospID=$p(SessionStr,"^",4)
    s Obj={}
    s Obj.EpisodeID=EpisodeID
    ; ... 组装数据 ...
    q Obj.%ToJSON()
GetXxxErr
    s $zt=""
    q "-1^"_$ze
}

}
```

### 2.2 Query（带 ROWSPEC，注册时 methodType=Query）

```objectscript
/// Desc: <说明>
/// Others: d ##class(%ResultSet).RunQuery("DHCDoc.Interface.Outside.<X>","QryXxx","<参数>")
Query QryXxx(Param As %String) As websys.Query(ROWSPEC = "code:%String,desc:%String,value:%String")
{
}
ClassMethod QryXxxExecute(ByRef QHandle As %Binary, Param As %String) As %Status
{
    s repid=$I(^CacheTemp)
    s ind=1
    s QHandle=$lb(0,repid,0)
    ; ... 写 ^CacheTemp(repid,ind)=$lb(code,desc,value) ...
    q $$$OK
}
```

### 2.3 注册为接口方法后，页内统一调用（框架B）

```objectscript
/// 调试：w ##class(DHCDoc.GetData.Portal).DHCDocHisInterface("<接口代码>", <参数>)
/// 内部按 methodType(SQL/QUERY/CLASSMETHOD) 分发，并 FormatOutput(outputType, obj)
```

返回信封（outputType=OBJ/JSON/XML 时）：
`{ "success": "true/false", "msg": "信息", "data": <接口内容> }`

---

## 3. 前端中间件 JS 模板（框架A）

路径固定：`scripts/dhcdoc/interface/<厂家代码>/<模块代码>.js`
CSP 通过 `DHCDoc.Interface.AccessManage.LoadJS(SessionStr, ProductDomain, medStepCode)` 自动加载。

```javascript
/**
* CreateDate:  <YYYY-MM-DD>
* Creator:     <你>
* 厂商：       <厂家代码>
* scripts/dhcdoc/interface/<厂家代码>/<模块代码>.js
* Description: <说明>
*/
(function () {
    if (typeof <Mod>Obj == 'object') return;   // 防重复加载

    // 后端调用封装
    function Call(MethodName, ParamObj, callBackFun) {
        try {
            $.cm($.extend({
                ClassName: "DHCDoc.Interface.Outside.<X>",
                SessionStr: GetSessionStr()
            }, ParamObj), function (Data) {
                if (callBackFun) callBackFun(Data);
            });
        } catch (e) {
            if (callBackFun) callBackFun(true);
        }
    }

    var ProductObj = {
        Name: "<厂家代码>_<模块代码>",
        // 诊疗环节 + 事件钩子
        Diag: {
            BeforeUpdate: function (EpisodeID, DiagRows, CallBackFunc) {
                Call("GetDiagRowsInfo", { MethodName: "GetDiagRowsInfo", EpisodeID: EpisodeID, DiagRows: JSON.stringify(DiagRows) }, CallBackFunc);
            },
            AfterUpdate: function (EpisodeID, DiagRowids) { /* 同步 */ }
        },
        Order: {
            BeforeUpdate: function (EpisodeID, OrderItemStr, CallBackFunc) { /* 阻断预警 */ },
            AfterUpdate:  function (EpisodeID, OEOrdItemIDs) { /* 同步 */ }
        }
        // 其它 medStepCode: Reg/Disp/Exam/Opera/Bill/Other
    };

    // 统一注册进框架（关键，不能漏）
    PushInterfaceArr(ProductObj);
})();
```

要点：
- 必用 IIFE 包裹，开头 `if (typeof XxxObj == 'object') return;` 防重复。
- 钩子挂在 `ProductObj.<medStepCode>.<Event>`；框架在对应环节（切换病人、保存前后、删除后等）回调。
- 调后端统一走 `$.cm({ ClassName, MethodName, ... })`；`SessionStr` 用全局 `GetSessionStr()`。
- 结尾必须 `PushInterfaceArr(ProductObj)`。

---

## 4. accessmanage 配置契约（框架A）

后端类 `DHCDoc.Interface.AccessManage` 关键方法（编程批量维护或理解 UI 字段）：

| 方法 | 作用 |
|---|---|
| `SaveAccessCompany(CompanyJson)` | 保存厂家（代码自动生成，名称后可改但代码不变） |
| `SaveAccessModule(ModuleJson)` | 保存模块 |
| `SaveAccessProduct(ProductJson)` | 保存业务中间层（ProductDomain） |
| `SaveAccessLink(InputJson)` | 保存 厂家+模块 关联（含 LinkClass / ProductDomain / ActiveFlag / ReferenceJS / 科室授权 / 扩展） |
| `LoadJS(SessionStr, ProductDomain, medStepCode)` | 按 medStepCode 动态输出中间件 JS 的 `<script>` |
| `GetAccessLinkInfo(...)` | 查询厂家/模块关联 |
| `GetAccessLinkExt(CompanyCode, ModeCode, ExtCode, HospID)` | 取扩展自定义参数值 |
| `CheckOpenInterface(JsonStr)` | 接口启用前校验（扩展 `CheckBeforeInterfaceEnableFlag`） |

界面路径：`dhcdoc.interface.accessmanage.csp`。模块对应 JS 路径固定，CSP 加载时自动引用。

---

## 5. dhcdocinterfaceregister 配置契约（框架B）

注册 UI：`dhcdocinterfaceregister.hui.csp`。落库：`User.DocInterfaceMethod`。
保存入口：`web.DHCDocInterfaceMethod.SaveDocInterfaceMethodInfo(tmpAllInPar, tmpAllOutPar, Input...)`，其中 `Input` 顺序（16 段）：

```
1  RowId            2  interfaceCode     3  interfaceName      4  interfaceSttDate
5  ProductLine      6  Active           7  isLocal            8  methodInvokType(S/C)
9  ProductLinkGroup 10 methodClassName  11 methodName         12 methodType(ClassMethod/Query/Sql)
13 methodNote       14 ExptJson         15 sqlStr            16 outputType(OBJ/JSON/XML)
```

字段要点：
- `interfaceType`（HIS/SOAP/HTTP）：决定 `DHCDocHisInterface` 分发分支。
- `methodInvokType`：S=服务（本系统提供）/ C=调用（调外部）。
- 设了 `outputType` 时，HIS 分支走 `DHCDoc.GetData.Portal.DHCDocHisInterface`（新路径）；否则按 `methodType` 直接 `$ClassMethod` / `%ResultSet` / `RunSql`。
- HTTP 类还需 `HServer/HPort/HPath/HDomainFlag/HHttps/HSSLConfiguration/HHeaderJson/HMethodType/HContentType/HTimeout`。
- `LogFlag=Y` 时自动写日志注册表，调用会经 `web.DHCDocInterfaceLog.SaveInterfaceLog`。

---

## 6. 框架C：对外数据视图 Query（视图类型后端实现）

**定位**：框架C 是"对外数据视图"的**后端实现方式**——面向外部系统通过 `SqlProc` 拉取 HIS 数据的**只读多行视图**。它通常是框架B 注册中 `methodType=Query` / `interfaceType=HIS` 的后端落地形态；也可被外部直接 `call <SQL_SCHEMA>.<SqlProc>(...)` 调用。

**与框架A / 框架B 的关系**：
- 框架A（accessmanage 中间件 JS）：按 UI 诊疗环节注入能力，需要 `medStepCode` + 事件钩子。框架C **不涉及 UI 注入、不需要 `medStepCode`**（按 `medstepcode-values.md` 标注 N/A）。
- 框架B（方法注册 + `DHCDocHisInterface` 调度）：注册 接口代码 → 类.方法，按 `methodType` 分发。框架C 的 Query 作为 `methodType=Query` 的后端被注册与调度。
- 即：**框架C = 视图类型 Query 的实现规范；框架B = 它的注册/调度层。** 二者配合完成"国考/外部系统拉取 HIS 视图数据"的完整链路。

**何时用框架C（Query）而非框架B 的 ClassMethod**：
- 返回多行集合（逐行记录），需要被当作结果集/存储过程消费；
- 外部系统希望用标准 `call <Schema>.<Proc>(...)` 拉数；
- 数据按业务时间节点（就诊/入院/开嘱/执行/申请日期）增量取数。

**权威模板（必须遵循）**：完整约束、时间索引选择表、日期范围模板、多层索引模板、全量去重模板、交付检查清单见 **`iris-query-view-template.md`**（以下简称“视图模板”）。本框架的 Query 实现**必须**以该模板为准，**禁止猜测**源表/Global/piece/状态码/关联键。

**核心约束摘要（详见视图模板）**：
1. Query 名、Execute 方法名与参数严格对应：`<QueryName>` / `<QueryName>Execute`。
2. 有业务时间节点的视图统一声明 `stDate/endDate`，空参数默认当天（`$zdh(value,3)` / `+$h`）。
3. 外层循环只按已验证索引 `$o` 定位业务 ID，循环体只推进索引 + `d <rowLabel>`；字段读取全部放进 `<rowLabel>` 标签，且无返回值 `q:condition` 跳过。
4. `$lb(...)` 字段数、顺序、语义必须与 ROWSPEC 完全一致；输出日期用 `$zd(date,3)_" "_$zt(time,1)`。
5. Query 只读，不 DDL/DML、不写业务 Global、不留调试 `^TEMP`。
6. `websys.Query` 复用其内置 Fetch/Close；若改用 `%Query` 须实现同名 Fetch/Close 并清理 `^CacheTemp(repid)`。
7. 禁止点号循环体（`.s/.f/.i/.q/.d`、`..s` 等）。

**最小示例（日期范围视图）**：见视图模板"日期范围 Query 模板"。**全量主数据（如患者）**用"全量去重模板"（无 `stDate/endDate`，用 `seen(id)` 去重）。

**落地要求**：类名、SQL schema/procedure、索引 Global 与字段表达式必须来自目标项目已导出的源码或用户确认，不把某个项目的实现路径固化为插件默认值。

---

## 7. 验证命令速查

```objectscript
; 后端单测（按 RowID 调试，入参 $C(28) 拼接）
d ##class(web.DHCDocInterfaceMethod).DebugInterfaceMethod(<RowID>, "v1"_$C(28)_"v2")

; 页内调度
w ##class(DHCDoc.GetData.Portal).DHCDocHisInterface("<接口代码>", <参数>)

; SOAP 入口（ParamStr 为 %Stream.GlobalCharacter）
w ##class(web.DHCDocInterfaceWebService).DHCWebInterface("<接口代码>", <流式入参>)

; 反查类方法的出入参（用来回填注册表的 type/requireFlag/desc）
w ##class(web.DHCDocInterfaceMethod).GetMethodParamsStr("<类名>","<方法名>","Method")
w ##class(web.DHCDocInterfaceMethod).GetMethodParamsStr("<类名>","<Query名>","Query")
```

界面自测：
- accessmanage 关联行的"调试"
- `dhcdoc.interface.outside.test.hui.csp`（外部接口测试）
- 日志：`dhcdoc.interface.accesslog.csp`、`dhcdoc.interfacelog.hui.csp`

---

## 8. 红线（离线审查必须失败）

- 点号循环体：行首 `.s` / `.f` / `.i` / `.q` / `.d`，以及 `..s` / `..f` / `..i` / `..q` / `..d`。
- 不得把连接串、账号、密码、namespace、包映射、远端路径写入源码或 skill。
- 编译/上传/部署不在此 skill 内完成，交给 `coding-iris-plugin`。
