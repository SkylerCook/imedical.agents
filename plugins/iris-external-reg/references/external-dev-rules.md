# 预约挂号接口开发 ObjectScript 编码规则

## 使用方式

开始实现、审查或修复 `DHCDoc.Interface.Outside.RegInterface` 代码时读取本文。先确认包结构和公共组件规则，再按接口模式选择模式 A 或模式 B 的模板；涉及 Global 遍历、院区过滤或数据源不确定时，必须读取本文的 Global 数据访问、多院区隔离和待确认数据源规范。

## 目录

- 包路径与包结构
- 公共组件开发
- 接口开发模式
- 调试辅助
- 状态记录
- 常用 Global 数据访问
- 多院区数据隔离规范
- 待确认数据源处理规范

## 包路径：src/DHCDoc/Interface/Outside/RegInterface/

按照执行计划文档中的计划，在 `DHCDoc.Interface.Outside.RegInterface` 包中实现代码。

**包结构与继承链:**

```
DHCDoc.Interface.Outside.RegInterface
├── Public.cls          — 公共组件基类，extends DHCDoc.Util.RegisteredObject
│   ├── Parameter XXXX = "xxx"            — 公共固定参数
│   ├── parseInPut(param)                 — 入参解析（根据入参转为对象，如JSON串转为%DynamicObject、XML串转为%DynamicObject）
│   ├── getOutPut(code, msg, data)        — 统一出参 {code, msg, data} → %Stream
│   ├── getObjToStream(obj)               — %DynamicObject → %Stream.GlobalCharacter
│   ├── sendINFData(action, obj)          — 平台通信统一入口
├── BaseData.cls        — 基础数据推送接口（模式A），extends Public
│   ├── pushDepartmentSingle(param)         — 单条科室数据推送
│   ├── pushDoctorSingle(param)           — 单条医生数据推送
│
├── Query.cls           — 基础数据查询接口（模式B），extends Public
│   ├── queryDepartment(param)            — 科室信息查询
│   ├── queryDoctor(param)                — 医生信息查询
│   ├── queryDepartmentSchedule(param)    — 科室排班查询
│
├── Patient.cls         — 患者管理接口（模式B），extends Public
│   ├── createPatient(param)              — 建档
│
├── Register.cls        — 挂号业务接口（模式B），extends Public
│   ├── lockOrder(param)                  — 锁号
│   ├── cancelLock(param)                 — 取消锁号
│   ├── registerOrder(param)              — 预约/挂号
│
├── Report.cls          — 业务报表上报接口（模式A），extends Public
│   ├── reportReleaseSource(param)        — 放号数据上报
│   ├── reportAppointment(param)          — 预约数据上报
```

**开发顺序**：先公共组件，再逐个接口。

### 1 公共组件开发（Public.cls）

1. 在处理第一个需要公共方法的接口前，先将公共入参校验、公共出参构建、公共业务逻辑方法添加到 `Public.cls`
2. 确保新增方法有完整的注释：`/// desc:`、`/// input:`、`/// debugger:`

### 2 接口开发（两种架构模式）

每个接口遵循 DHCDoc.Interface.Outside.RegInterface 统一模板结构（`$zt` 错误陷阱 → 入参解析 → 业务处理 → 出参构建）。

根据**接口发起方和数据流向**，分为两种实现模式：

---

#### 模式 A：接入方主动推送/上报（Push/Report）

**适用接口**：`pushXXX`、`reportXXX` 等由 HIS 主动发起的接口（如 pushDepartmentSingle、reportReleaseSource）

**数据流向**：`HIS 全局变量` → 翻译层 → 省平台 Open API（sendINFData）

**入参职责**：入参仅包含**查询条件/标识**（如 code、dateRange、orderId），完整业务数据从 HIS 全局变量读取

**关键规范**：
- 调用 `..sendINFData()` 推送至省平台
- **⚠️ 数据源确认约束**：对于含义不明确的数据源，必须先完成 TODO 确认（参见文末「待确认数据源处理规范」），禁止自行臆测字段含义和取片位置

**编码模板**：

```objectscript
ClassMethod pushDepartmentSingle(param = "") As %Stream.GlobalCharacter
{
    s $zt = "pushDepartmentSingleErr"
    s req = ..parseInPut(param)
    
    // Step 1: 校验查询条件（仅校验标识参数）
    i req.hospitalCode="" q ..getOutPut(-1, "缺少必填参数hospitalCode")
    i req.code="" q ..getOutPut(-1, "缺少必填参数code")
    
    // Step 2: 从 HIS 全局变量读取完整业务数据
    s deptId = ..getDeptId(req.code)
    i deptId="" q ..getOutPut(-1, "科室编码不存在")
    
    s locData = $g(^CTLOC(deptId))
    s locName = $p(locData, "^", 2)
    s locAddress = $p(locData, "^", 3)
    // ... 读取其他字段 ...
    
    // Step 3: 构建推送数据（使用 HIS 实际数据）
    s pushData = {
        "hospitalCode": (req.hospitalCode),
        "code": (req.code),
        "name": (locName),
        "address": (locAddress)
        // ... 其他字段从 HIS 读取 ...
    }
    
    // Step 4: 调用省平台 Open API
    s rtn = ..sendINFData("DEPARTMENT_SINGLE", pushData)
    i $p(rtn, "^", 1)'=0 q ..getOutPut(-1, "推送失败：" _$p(rtn, "^", 2))
    
    q ..getOutPut(0, "成功")

pushDepartmentSingleErr
    s $zt = ""
    q ..getOutPut(-1, $ze)
}
```

---

#### 模式 B：平台发起查询/操作（Query/Operation）

**适用接口**：`queryXXX`、`lockOrder`、`createPatient` 等平台发起的接口

**数据流向**：平台请求 → 翻译层 → `DHCExternalService` XML 调用 → HIS 核心服务

**入参职责**：入参包含**完整业务数据**（平台传入，如 patientName、idCardNo、scheduleCode 等），翻译层负责格式转换

**关键规范**：
- 入参包含完整业务字段（平台传入的原始数据）
- 构建 Entity 对象 → `XMLExportToString` → 调用 `DHCExternalService`
- 遍历 XML 响应，转换为 JSON 输出

**编码模板**： 

```objectscript
ClassMethod querySchedule(param = "") As %Stream.GlobalCharacter
{
    s $zt = "queryScheduleErr"
    s req = ..parseInPut(param)
    s hospId = ..getHospId(req.hospitalCode)

    // Step 1: 构建 DHCExternalService Entity 请求对象
    s input = ##class(DHCExternalService.RegInterface.Entity.SelfReg.QueryAdmScheduleRq).%New()
    s input.TradeCode = "3014"
    s input.HospitalId = hospId
    s input.DepartmentCode = req.departmentCode
    s input.StartDate = req.startDate
    s input.EndDate = req.endDate
    s input.ExtUserID = ..#UserCode

    // Step 2: 导出 XML 并调用 DHCExternalService 方法
    d input.XMLExportToString(.xmlStr, "Request")
    s rp = ##class(DHCExternalService.RegInterface.SelfRegMethods).QueryAdmSchedule(xmlStr, "")

    // Step 3: 检查 XML 响应结果
    if rp.ResultCode '= "0" {
        q ..getOutPut("-1", rp.ResultContent, {})
    }

    // Step 4: 遍历 XML 响应对象，转换为 JSON 输出
    s count = rp.Schedules.Count()
    for loop = 1 : 1 : count {
        s one = rp.Schedules.GetAt(loop)
        // ... 构建 JSON 对象 ...
    }
    q ..getOutPut(0, "成功", resultList)

queryScheduleErr
    s $zt = ""
    q ..getOutPut(-1, $ze)
}
```

关键规范要点：

- **XML 互操作模式**：构建 Entity → XMLExportToString → 调用 DHCExternalService → 检查 ResultCode → 遍历集合转 JSON/XML。

### 3 调试辅助

开发过程中使用临时日志：
```objectscript
s ^tempExternal("methodName") = $lb(input, output)
```

### 4 状态记录

每完成一个方法，更新 `接口列表.json` 中的接口状态：
```json
{
    "接口1": {"描述": "接口1描述", "状态": "已完善"},
    "接口2": {"描述": "接口2描述", "状态": "开发中"},
    "接口3": {"描述": "接口3描述", "状态": "待开发"}
}
```

## 常用 Global 数据访问

> ⚠️ **重要**：以下 Global 数据访问表仅列出已知确认的数据结构。对于未明确确认的数据源，**禁止自行臆测**。必须在开发前形成 TODO 列表，经人工确认后再编码实现。

| Global | 含义 | 访问示例 |
|--------|------|---------|
| `^CTPCP(docId, 1)` | 医护人员信息 | `$p(data, "^", 1)` → 代码, `$p(data, "^", 2)` → 姓名 |
| `^SSU("SSUSR", 0, "CTPCP", docId, userId)` | 医生→用户关联 | 获取医生的用户扩展信息 |
| `^CTLOC(0, "Hosp", hospId, locId)` | 按院区索引科室 | 遍历某院区所有科室 |
| `^CTLOC(locId)` | 科室基本信息 | `$p(^CTLOC(locId), "^", 22)` → 院区ID |
| `^RB("RES", resId)` | 资源表基本信息 | `$p(resData, "^", 1)` → 科室ID, `$p(resData, "^", 2)` → 医生ID |
| `^RB("RES", 0, "CTLOC", locId, resId)` | 按科室索引资源 | 遍历某科室所有医生资源 |
| `^RBAS(resId, subId)` | 排班表 | `$p(rbasData, "^", 1)` → 排班日期, `$p(rbasData, "^", 5)` → 总号数 |
| `^RBAS(resId, subId, "APPT", appId)` | 预约记录 | `$p(apptData, "^", 2)` → 患者ID |
| `^PAPER(patId, "ALL")` | 患者基本信息 | `$p(data, "^", 1)` → 姓名 |
| `^DHCPBL(blackId)` | 黑名单记录 | `$p(data, "^", 2)` → 患者ID, `$p(data, "^", 13)` → 原因 |

### 5 多院区数据隔离规范

当 HIS 系统支持多院区时，所有接口必须严格遵守院区数据隔离，禁止跨院区泄露数据。

**关键约束**：

1. **入参必须包含 `hospitalCode`**：所有接口（除明确说明外）必须接收并校验 `hospitalCode`，作为院区数据隔离的入口条件。

2. **遍历全局变量时必须过滤院区**：
   - 遍历 `^CTLOC` 时，必须使用 `^CTLOC(0, "Hosp", hospId, locId)` 索引，禁止直接遍历 `^CTLOC(locId)`
   - 遍历 `^RB("RES")` 时，应优先使用 `^RB("RES", 0, "CTLOC", locId, resId)` 按科室索引，或确保获取的 `resId` 关联的科室属于目标院区
   - 遍历 `^RBAS` 时，需通过 `^RB("RES", resId)` 获取科室ID，再校验科室是否属于目标院区

3. **模式 A（推送/上报）的院区过滤示例**：

```objectscript
ClassMethod reportReleaseSource(param = "") As %Stream.GlobalCharacter
{
    s $zt = "reportReleaseSourceErr"
    s req = ..parseInPut(param)
    
    ; 1. 校验 hospitalCode 并获取 hospId
    i req.hospitalCode="" q ..getOutPut(-1, "缺少必填参数hospitalCode")
    s hospId = ..getHospId(req.hospitalCode)
    i hospId="" q ..getOutPut(-1, "医院编码不存在")
    
    ; 2. 遍历科室时必须按院区过滤
    s locId = ""
    f {
        s locId = $o(^CTLOC(0, "Hosp", hospId, locId))
        q:locId=""
        
        ; 3. 遍历该科室下的排班资源
        s resId = ""
        f {
            s resId = $o(^RB("RES", 0, "CTLOC", locId, resId))
            q:resId=""
            
            ; ... 处理排班数据 ...
        }
    }
    
    ; ... 其余逻辑 ...
}
```

4. **模式 B（查询/操作）的院区传递**：
   - 构建 XML 请求对象时，必须将 `hospId` 传入 `HospitalId` 属性
   - 禁止忽略 `hospitalCode` 入参，直接使用默认院区

5. **公共方法的院区约束**：
   - `findLocList()` 必须接收 `hospId` 并按院区过滤
   - `findDocList()` 应接收 `hospId` 和 `deptId`，按科室过滤时隐式限定院区
   - 任何新增的全局变量遍历方法，必须考虑院区过滤参数

**错误示例（禁止）**：

```objectscript
; ❌ 错误：直接遍历所有科室，未按院区过滤
s locId = ""
f {
    s locId = $o(^CTLOC(locId))
    q:locId=""
    ; ... 会泄露其他院区数据 ...
}

; ❌ 错误：直接遍历所有资源，未校验科室院区归属
s resId = ""
f {
    s resId = $o(^RB("RES", resId))
    q:resId=""
    ; ... 会包含其他院区排班 ...
}

; ❌ 错误：忽略 hospitalCode，使用默认院区
s input = ##class(DHCExternalService.RegInterface.Entity.SelfReg.QueryAdmScheduleRq).%New()
; s input.HospitalId = hospId  ; 缺少这一行
```

**正确示例**：

```objectscript
; ✅ 正确：按院区索引遍历科室
s locId = ""
f {
    s locId = $o(^CTLOC(0, "Hosp", hospId, locId))
    q:locId=""
    ; ... 仅处理目标院区科室 ...
}

; ✅ 正确：遍历资源时校验院区归属
s resId = ""
f {
    s resId = $o(^RB("RES", resId))
    q:resId=""
    
    s resData = $g(^RB("RES", resId))
    s deptId = $p(resData, "^", 1)
    s deptHospId = $p($g(^CTLOC(deptId)), "^", 22)
    continue:deptHospId'=hospId  ; 跳过非目标院区
    
    ; ... 仅处理目标院区排班 ...
}
```

**待确认项（多院区）**：

| TODO-ID | 待确认内容 | 影响范围 | 确认状态 |
|---------|-----------|---------|---------|
| TODO-M1 | `^RB("RES", resId)` 第 1 片（科室ID）是否足以确定院区归属，还是需要额外索引 | 资源遍历过滤 | ⏳ 待确认 |
| TODO-M2 | `^OEORD` 是否包含院区标识，多院区环境下是否需要额外过滤条件 | 医嘱数据隔离 | ⏳ 待确认 |
| TODO-M3 | 是否存在更高效的按院区索引方式（如 `^RB("RES", 0, "Hosp", hospId, resId)`） | 性能优化 | ⏳ 待确认 |

### 6 待确认数据源处理规范

当开发过程中遇到以下情况时，必须严格执行 TODO 流程：

1. **Global 字段含义不明确**
2. **数据源与业务逻辑关联未确认**
3. **状态码枚举值未确认**
4. **任何自行推断的数据结构假设**

**TODO 流程**：

```markdown
### 待确认项列表（开发前必须完成）

- [ ] TODO-1: 确认 `^OEORD` 的数据结构 — 第 9 片是否为 resId，第 10 片是否为 subId，第 13 片是否为预约日期，第 15 片是否为状态
- [ ] TODO-2: 确认 `^OEORD` 第 15 片状态码的完整枚举值及含义（A/N/C/D 等）
- [ ] TODO-3: 确认预约数据上报的数据源选择 — 是否优先使用 `^RBAS(resId, subId, "APPT")` 还是 `^OEORD`
- [ ] TODO-4: 确认 `^OEORD` 与 `^RBAS(..., "APPT")` 的数据关系，是否存在冗余或互补
```

**编码约束**：
- 在 TODO 项未确认前，相关代码处必须保留注释标记：`; TODO: 待确认 — ^OEORD 第 X 片含义`
- 禁止在 TODO 未确认的情况下，将代码标记为"已完成"或"测试通过"
- 测试验证阶段，必须逐项核对 TODO 确认结果与实际数据是否一致
