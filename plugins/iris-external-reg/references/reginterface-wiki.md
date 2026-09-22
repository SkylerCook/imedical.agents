# DHCExternalService.RegInterface 核心功能接口文档

## 目录结构

```
RegInterface/
├── RegManager.cls              # 核心预约挂号管理类
├── SelfRegMethods.cls           # 自助机/外部系统接口方法
├── SelfRegQueryMetods.cls       # 查询相关Query方法
├── PatientManager.cls           # 患者管理
├── SelfRegPlulic.cls           # 公共方法(入参/出参对象工厂)
├── InterfaceMethods.cls         # 第三方服务接口调用
├── SynVisitSchedule.cls        # 排班同步服务
├── GetRelate.cls               # 外部代码对照转换
├── Entity/                     # 实体定义目录
│   ├── ImportApptToHISRt.cls   # 平台预约入HIS入参
│   ├── ImportApptToHISRp.cls   # 平台预约入HIS出参
│   ├── CancelOrderToHISRt.cls   # 取消预约入HIS入参
│   ├── CancelOrderToHISRp.cls   # 取消预约入HIS出参
│   ├── ServiceBookRt.cls        # 预约挂号入参
│   ├── ServiceBookRp.cls        # 预约挂号出参
│   ├── LockOrderRt.cls          # 锁号入参
│   ├── LockOrderRp.cls          # 锁号出参
│   ├── PaymentOrderRt.cls       # 支付入参
│   ├── PaymentOrderRp.cls       # 支付出参
│   ├── RefundRegRt.cls         # 退号入参
│   ├── RefundRegRp.cls         # 退号出参
│   ├── SelfReg/                 # 自助机接口实体
│   │   ├── GetPatInfoRq.cls    # 获取患者信息请求
│   │   ├── GetPatInfoRp.cls    # 获取患者信息响应
│   │   ├── OPRegisterRq.cls   # 挂号请求
│   │   ├── OPRegisterRp.cls   # 挂号响应
│   │   ├── LockOrderRt.cls     # 锁号请求
│   │   ├── LockOrderRp.cls     # 锁号响应
│   │   ├── QueryAdmScheduleRq.cls    # 查询排班请求
│   │   ├── QueryAdmScheduleRp.cls    # 查询排班响应
│   │   ├── QueryDepDocRq.cls   # 查询科室/医生请求
│   │   ├── CancelOPRegistRq.cls   # 取消挂号请求
│   │   ├── OPRegReturnRq.cls  # 退号请求
│   │   └── ... (更多实体)
│   ├── List/                   # 列表类型实体
│   └── SelfAppt/               # 预约实体
```

---

## 方法快速索引

> 使用 `rg -n "^#### 方法名" references/reginterface-wiki.md` 可定位目标方法。

| 方法名 | 所属类 | 行号 | 说明 |
|--------|--------|------|------|
| UpdateNotifyStatus | RegManager | 101 | 修改停诊通知状态 |
| LockOrder | RegManager | 114 | 锁号请求 |
| RemoveLockOrder | RegManager | 129 | 解除锁号请求 |
| InToOut | RegManager | 144 | HIS调用平台接口入口 |
| BookService | RegManager | 154 | 预约挂号 |
| PaymentOrder | RegManager | 168 | 支付确认 |
| RefundReg | RegManager | 176 | 退号/取消预约 |
| RegfeeRefund | RegManager | 191 | 挂号退费通知 |
| ImportApptToHIS | RegManager | 206 | 平台预约入HIS |
| CancelOrderToHIS | RegManager | 243 | 取消HIS预约 |
| GetPatInfo | SelfRegMethods | 288 | 获取患者信息 |
| QueryAdmSchedule | SelfRegMethods | 333 | 查询排班 |
| OPRegister | SelfRegMethods | 363 | 挂号/取号 |
| LockOrder | SelfRegMethods | 406 | 锁号 (XML) |
| UnLockOrder | SelfRegMethods | 445 | 解锁号 |
| OPRegReturn | SelfRegMethods | 453 | 退号 |
| CancelOPRegist | SelfRegMethods | 474 | 取消挂号 |
| QueryDepartment | SelfRegMethods | 490 | 查询科室 |
| QueryDoctor | SelfRegMethods | 509 | 查询医生 |
| QueryScheduleTimeInfo | SelfRegMethods | 525 | 查询分时段信息 |
| SynVisitSchedule | SynVisitSchedule | 549 | 同步排班信息 |
| SynRegCount | SynVisitSchedule | 554 | 同步预约总数 |
| SynStopVisitSchedule | SynVisitSchedule | 559 | 停诊同步 |
| SynReplaceVisitSchedule | SynVisitSchedule | 564 | 替诊同步 |
| GetInputObj | SelfRegPlulic | 575 | 获取入参对象 |
| GetOutputObj | SelfRegPlulic | 581 | 获取出参对象 |

**章节导航**：

| 章节 | 行号 | 内容 |
|------|------|------|
| 一 | 97 | RegManager 核心方法 |
| 二 | 260 | SelfRegMethods 自助机接口 |
| 三 | 545 | 排班同步接口 |
| 四 | 571 | 公共方法 |
| 五 | 589 | 执行计划参数转换对照表 |
| 六 | 642 | 支付方式代码对照 |
| 七 | 656 | 预约方式代码对照 |
| 八 | 670 | 证件类型代码对照 |
| 九 | 682 | 常用HIS数据表 |
| 十 | 696 | 返回码说明 |

---

## 一、RegManager 核心方法

### 1.1 预约挂号管理

#### UpdateNotifyStatus - 修改停诊通知状态
```cos
ClassMethod UpdateNotifyStatus(ApptID As %String = "", UserID As %String = "") As %String
```
| 参数 | 类型 | 说明 |
|------|------|------|
| ApptID | %String | 预约记录ID (格式: RBASID\|\|子ID) |
| UserID | %String | 操作用户ID |

**出参**: `ResultCode^ResultContent` (格式: "0^成功" 或 "-1^错误信息")

---

#### LockOrder - 锁号请求
```cos
ClassMethod LockOrder(RBASID As %String = "", PatientID As %String = "", UserID As %String = "") As %String
```
| 参数 | 类型 | 说明 |
|------|------|------|
| RBASID | %String | 排班资源ID (格式: RESID\|\|ScheduleID) |
| PatientID | %String | 病人ID |
| UserID | %String | 操作用户ID |

**入参实体**: `DTROrderMana.LockOrderRt`
**出参**: `ResultCode^ResultContent^LockQueueNo`

---

#### RemoveLockOrder - 解除锁号请求
```cos
ClassMethod RemoveLockOrder(RBASID As %String = "", PatientID As %String = "", UserID As %String = "", ExpStr As %String = "") As %String
```
| 参数 | 类型 | 说明 |
|------|------|------|
| RBASID | %String | 排班资源ID |
| PatientID | %String | 病人ID |
| UserID | %String | 操作用户ID |
| ExpStr | %String | 扩展参数(锁号队列号) |

**入参实体**: `DTROrderMana.RemoveLockOrderRt`

---

#### InToOut - HIS调用平台接口入口
```cos
ClassMethod InToOut(ApptID As %String = "", UserID As %String = "") As %String
```
根据预约记录状态自动选择:
- **BookService** (预约+支付): 调用外部预约服务
- **PaymentOrder** (仅支付): 调用支付确认接口

---

#### BookService - 预约挂号
```cos
ClassMethod BookService(ApptObj As User.RBAppointment, UserID As %String = "") As %String
```
| 参数 | 类型 | 说明 |
|------|------|------|
| ApptObj | User.RBAppointment | 预约对象 |
| UserID | %String | 操作用户ID |

**入参实体**: `DTRXTBSServiceAppointManage.ServiceBookRt`
**出参**: `ResultCode^ResultContent^OrderCode`

---

#### PaymentOrder - 支付确认
```cos
ClassMethod PaymentOrder(ApptObj As User.RBAppointment, UserID As %String = "") As %String
```
**入参实体**: `DTROrderMana.PaymentOrderRt`

---

#### RefundReg - 退号/取消预约
```cos
ClassMethod RefundReg(ApptID As %String = "", UserID As %String = "") As %String
```
| 参数 | 类型 | 说明 |
|------|------|------|
| ApptID | %String | 预约记录ID |
| UserID | %String | 操作用户ID |

**入参实体**:
- 未挂号: `DTROrderMana.CancelOrderRt` (TradeCode="1001")
- 已挂号: `DTROrderMana.RefundRegRt` (TradeCode="1003")

---

#### RegfeeRefund - 挂号退费通知
```cos
ClassMethod RegfeeRefund(ApptID As %String = "", ExpStr As %String = "") As %String
```
| 参数 | 类型 | 说明 |
|------|------|------|
| ApptID | %String | 预约记录ID |
| ExpStr | %String | 扩展串: `HospitalId^TransactionId^PayBankCode^PayCardNo^PayFee^PaidTransactionId` |

**入参实体**: `DHCExternalService.RegInterface.Entity.RegfeeRefund`

---

### 1.2 平台调用HIS接口

#### ImportApptToHIS - 平台预约入HIS
```cos
ClassMethod ImportApptToHIS(InputObj As DHCExternalService.RegInterface.Entity.ImportApptToHISRt) 
    As DHCExternalService.RegInterface.Entity.ImportApptToHISRp
```

**入参实体 - ImportApptToHISRt**:
| 属性 | 类型 | 说明 |
|------|------|------|
| ExtOrgCode | %String | 预约机构 |
| HospitalId | %String | 医院ID |
| PatientNo | %String | 病人主索引号 |
| CardNo | %String | 卡号 |
| RBASId | %String | 门诊排班标识 |
| ApptDate | %String | 预约日期(YYYY-MM-DD) |
| Method | %String | 预约方式 |
| CredTypeCode | %String | 证件类型代码 |
| IDCardNo | %String | 身份证号 |
| PatientName | %String | 姓名 |
| PayFlag | %String | 支付标记(Y/N) |
| PayModeCode | %String | 支付方式代码 |
| PayFee | %String | 支付费用 |
| OrderCode | %String | 预约单号 |

**出参实体 - ImportApptToHISRp**:
| 属性 | 类型 | 说明 |
|------|------|------|
| Result | %String | 结果代码 |
| ErrorMsg | %String | 错误信息 |
| ApptId | %String | HIS预约ID |
| SeqCode | %String | 挂号序号 |
| RegFee | %String | 挂号费 |
| AdmitRange | %String | 时段信息 |
| TransactionId | %String | 交易流水号 |

---

#### CancelOrderToHIS - 取消HIS预约
```cos
ClassMethod CancelOrderToHIS(InputObj As DHCExternalService.RegInterface.Entity.CancelOrderToHISRt) 
    As DHCExternalService.RegInterface.Entity.CancelOrderToHISRp
```

**入参实体 - CancelOrderToHISRt**:
| 属性 | 类型 | 说明 |
|------|------|------|
| HospitalId | %String | 医院ID |
| ExtUserID | %String | 操作员编码 |
| ApptId | %String | 预约挂号记录标识 |
| RefundType | %String | 退费类型(TH-当日退费, 其他-隔日退费) |
| TransactionId | %String | 交易流水号 |

---

## 二、SelfRegMethods 自助机/外部系统接口

### 2.1 交易代码与实体对照表

| TradeCode | 方法名 | 入参实体 | 出参实体 | 功能说明 |
|-----------|--------|----------|----------|----------|
| 3300 | GetPatInfo | GetPatInfoRq | GetPatInfoRp | 获取患者信息 |
| 3301 | QueryPatCard | QueryPatCardRq | QueryPatCardRp | 查询患者卡信息 |
| 1014 | QueryDepartmentGroup | QueryDepDocRq | QueryDepRp | 查询大科室/科室组 |
| 1012 | QueryDepartment | QueryDepDocRq | QueryDepRp | 查询科室 |
| 1013 | QueryDoctor | QueryDepDocRq | QueryDocRp | 查询医生 |
| 1004 | QueryAdmSchedule | QueryAdmScheduleRq | QueryAdmScheduleRp | 查询排班 |
| 10041 | QueryScheduleTimeInfo | QueryScheduleTimeInfoRq | QueryScheduleTimeInfoRp | 查询分时段信息 |
| 1101 | OPRegister | OPRegisterRq | OPRegisterRp | 挂号/取号 |
| 1104 | QueryAdmOPReg | QueryAdmOPRegRq | QueryAdmOPRegRp | 查询已挂号记录 |
| 1103 | - | - | - | 取消挂号 |
| 1003 | OPRegReturn | OPRegReturnRq | OPRegReturnRp | 退号 |
| 10015 | LockOrder | LockOrderRt | LockOrderRp | 锁号 |
| 10016 | UnLockOrder | LockOrderRt | LockOrderRp | 解锁号 |
| 1105 | GetInsuRegPara | GetInsuRegParaRq | GetInsuRegParaRp | 获取医保挂号参数 |
| 1107 | QueryStopDoctor | QueryStopDoctorRq | QueryStopDoctorRp | 查询停诊医生 |
| 1108 | QueryRegStatus | QueryRegStatusRq | QueryRegStatusRp | 查询挂号状态 |
| 1109 | QueryPatList | QueryPatListRq | QueryPatListRp | 查询患者列表 |

---

### 2.2 核心方法详情

#### GetPatInfo - 获取患者信息
```cos
ClassMethod GetPatInfo(XMLRequest As %String) As DHCExternalService.RegInterface.Entity.SelfReg.GetPatInfoRp
```

**入参 - GetPatInfoRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 3300 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| PatientCard | %String | 否 | 卡号 |
| CardType | %String | 否 | 卡类型 |
| PatientID | %String | 否 | 患者ID/登记号 |
| IDCardType | %String | 否 | 证件类型 |
| IDNo | %String | 否 | 证件号 |
| PatientName | %String | 否 | 患者姓名 |
| Phone | %String | 否 | 电话 |
| SecurityNo | %String | 否 | 安全码 |

**出参 - GetPatInfoRp**:
| 属性 | 类型 | 说明 |
|------|------|------|
| ResultCode | %String | 结果代码 |
| ResultContent | %String | 结果描述 |
| PatInfos | 列表 | 患者信息列表 |

**PatInfo子对象**:
| 属性 | 说明 |
|------|------|
| PatientID | 患者ID |
| PatientName | 姓名 |
| Sex | 性别 |
| DOB | 出生日期 |
| IDTypeCode | 证件类型代码 |
| IDNo | 证件号 |
| TelephoneNo | 电话 |
| Mobile | 手机 |
| PatientCard | 卡号 |
| AccInfo | 账户信息 |
| AccInfoBalance | 账户余额 |
| PatType | 患者类型 |

---

#### QueryAdmSchedule - 查询排班
```cos
ClassMethod QueryAdmSchedule(XMLRequest As %String, SeachType As %String = "") 
    As DHCExternalService.RegInterface.Entity.SelfReg.QueryAdmScheduleRp
```

**入参 - QueryAdmScheduleRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 1004 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| StartDate | %String | 否 | 开始日期(YYYY-MM-DD) |
| EndDate | %String | 否 | 结束日期(YYYY-MM-DD) |
| DepartmentCode | %String | 是 | 科室代码 |
| ServiceCode | %String | 否 | 专业代码 |
| DoctorCode | %String | 否 | 医生代码 |
| RBASSessionCode | %String | 否 | 出诊时段(S-上午/X-下午/Y-夜晚) |
| PatientID | %String | 否 | 患者ID |

**出参 - QueryAdmScheduleRp**:
| 属性 | 类型 | 说明 |
|------|------|------|
| ResultCode | %String | 结果代码 |
| ResultContent | %String | 结果描述 |
| RecordCount | %Integer | 记录数 |
| Schedules | 列表 | 排班信息列表 |

---

#### OPRegister - 挂号/取号
```cos
ClassMethod OPRegister(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.OPRegisterRp
```

**入参 - OPRegisterRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 1101 |
| TransactionId | %String | 否 | 交易流水号 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| ScheduleItemCode | %String | 是 | 排班ID (格式: RESID\|\|ScheduleID) |
| PatientCard | %String | 否 | 卡号 |
| CardType | %String | 否 | 卡类型 |
| PatientID | %String | 否 | 患者ID/登记号 |
| QueueNo | %String | 否 | 挂号序号 |
| PayModeCode | %String | 是 | 支付方式代码 |
| PayFee | %String | 是 | 支付金额 |
| PayBankCode | %String | 否 | 银行代码 |
| PayCardNo | %String | 否 | 银行卡号 |
| PayTradeNo | %String | 否 | 支付交易号 |
| PayOrderId | %String | 否 | 第三方订单号 |
| PayMRBookFlag | %String | 否 | 是否收病历本费 |
| PayInsuFeeStr | %String | 否 | 医保支付串 |
| BankTradeInfo | %String | 否 | 银行交易信息 |
| AppOrderCode | %String | 否 | 预约取号ID (预约取号时传入) |
| PayDetails | 对象 | 否 | 支付宝/微信支付详情 |

**出参 - OPRegisterRp**:
| 属性 | 类型 | 说明 |
|------|------|------|
| ResultCode | %String | 结果代码 |
| ResultContent | %String | 结果描述 |
| AdmNo | %String | 就诊号 |
| QueueNo | %String | 挂号序号 |
| RegFee | %String | 挂号费 |
| AdmitRange | %String | 时段信息 |
| AdmDate | %String | 就诊日期 |

---

#### LockOrder - 锁号
```cos
ClassMethod LockOrder(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.LockOrderRp
```

**入参 - LockOrderRt**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 10015 |
| HospitalID | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| PatientID | %String | 否 | 患者ID |
| ScheduleItemCode | %String | 是 | 排班ID |
| LockQueueNo | %String | 否 | 锁号队列号 |
| CardNo | %String | 否 | 卡号 |
| CardType | %String | 否 | 卡类型 |
| TransactionId | %String | 否 | 交易流水号 |
| PayOrderId | %String | 否 | 第三方订单号 |
| Mobile | %String | 否 | 手机号 |
| BeginTime | %String | 否 | 分时段开始时间 |
| EndTime | %String | 否 | 分时段结束时间 |
| BillTypeID | %String | 否 | 费别ID |

**出参 - LockOrderRp**:
| 属性 | 类型 | 说明 |
|------|------|------|
| ResultCode | %String | 结果代码 |
| ResultContent | %String | 结果描述 |
| TransactionId | %String | 交易流水号 |
| LockQueueNo | %String | 锁号队列号 |
| ScheduleItemCode | %String | 排班ID |
| AdmDoc | %String | 号别描述 |
| AdmDate | %String | 就诊日期 |
| AdmTime | %String | 就诊时间 |
| RegFee | %String | 挂号费 |

---

#### UnLockOrder - 解锁号
```cos
ClassMethod UnLockOrder(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.LockOrderRp
```

---

#### OPRegReturn - 退号
```cos
ClassMethod OPRegReturn(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.OPRegReturnRp
```

**入参 - OPRegReturnRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 1003 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| AdmNo | %String | 是 | 挂号ID |
| TransactionId | %String | 否 | 交易流水号 |
| BankNo | %String | 否 | 银行卡号 |
| BankTradeNo | %String | 否 | 银行流水号 |
| RefundType | %String | 否 | 退费类型(TF-退费/TH-退货) |
| PayOrderId | %String | 否 | 第三方订单号 |

---

#### CancelOPRegist - 取消挂号
```cos
ClassMethod CancelOPRegist(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.CancelOPRegistRp
```

**入参 - CancelOPRegistRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 1103 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| RegID | %String | 是 | 就诊号(1104接口获得) |

---

#### QueryDepartment - 查询科室
```cos
ClassMethod QueryDepartment(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.QueryDepRp
```

**入参 - QueryDepDocRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 1012 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| DepartmentCode | %String | 否 | 科室代码 |
| DepartmentGroupCode | %String | 否 | 科室组代码 |
| StartDate | %String | 否 | 开始日期 |
| EndDate | %String | 否 | 结束日期 |

---

#### QueryDoctor - 查询医生
```cos
ClassMethod QueryDoctor(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.QueryDocRp
```

**入参 - QueryDepDocRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 1013 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |
| DepartmentCode | %String | 是 | 科室代码 |

---

#### QueryScheduleTimeInfo - 查询分时段信息
```cos
ClassMethod QueryScheduleTimeInfo(XMLRequest As %String) 
    As DHCExternalService.RegInterface.Entity.SelfReg.QueryScheduleTimeInfoRp
```

**入参 - QueryScheduleTimeInfoRq**:
| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| TradeCode | %String | 是 | 交易代码: 10041 |
| ScheduleItemCode | %String | 否 | 排班ID |
| DepartmentCode | %String | 否 | 科室代码 |
| DoctorCode | %String | 否 | 医生代码 |
| RBASSessionCode | %String | 否 | 班别代码 |
| ServiceDate | %String | 否 | 出诊日期 |
| HospitalId | %String | 是 | 医院ID |
| ExtUserID | %String | 是 | 操作员ID |

---

## 三、排班同步接口 (SynVisitSchedule)

### 3.1 同步方法

#### SynVisitSchedule - 同步排班信息
```cos
ClassMethod SynVisitSchedule(StartDate As %String = "", EndDate As %String = "") As %String
```

#### SynRegCount - 同步预约总数
```cos
ClassMethod SynRegCount(RBASID As %String = "") As %String
```

#### SynStopVisitSchedule - 停诊同步
```cos
ClassMethod SynStopVisitSchedule(RBASID As %String = "") As %String
```

#### SynReplaceVisitSchedule - 替诊同步
```cos
ClassMethod SynReplaceVisitSchedule(RBASID As %String = "") As %String
```

---

## 四、公共方法

### SelfRegPlulic

#### GetInputObj - 获取入参对象
```cos
ClassMethod GetInputObj(TradeCode, XMLRequest) As %RegisteredObject
```
根据TradeCode动态创建入参实体对象。

#### GetOutputObj - 获取出参对象
```cos
ClassMethod GetOutputObj(TradeCode) As %RegisteredObject
```
根据TradeCode动态创建出参实体对象。

---

## 五、执行计划参数转换对照表

### 5.1 核心入参实体字段对照

#### ImportApptToHISRt (平台预约入HIS)
| XML标签 | 字段名 | 数据类型 | 说明 |
|---------|--------|----------|------|
| ExtOrgCode | ExtOrgCode | %String | 预约机构代码 |
| ClientType | ClientType | %String | 客户端类型 |
| HospitalId | HospitalId | %String | 医院ID |
| PatientNo | PatientNo | %String | 病人主索引号 |
| CardNo | CardNo | %String | 卡号 |
| RBASId | RBASId | %String | 排班ID |
| ApptDate | ApptDate | %String | 预约日期 |
| Method | Method | %String | 预约方式代码 |
| CredTypeCode | CredTypeCode | %String | 证件类型代码 |
| IDCardNo | IDCardNo | %String | 身份证号 |
| PatientName | PatientName | %String | 患者姓名 |
| PayFlag | PayFlag | %String | 是否支付(Y/N) |
| PayModeCode | PayModeCode | %String | 支付方式代码 |
| PayFee | PayFee | %String | 支付金额 |
| OrderCode | OrderCode | %String | 预约单号 |

#### OPRegisterRq (挂号请求)
| XML标签 | 字段名 | 数据类型 | 说明 |
|---------|--------|----------|------|
| TradeCode | TradeCode | %String | 交易代码 |
| TransactionId | TransactionId | %String | 交易流水号 |
| HospitalId | HospitalId | %String | 医院ID |
| ScheduleItemCode | ScheduleItemCode | %String | 排班ID |
| PatientCard | PatientCard | %String | 卡号 |
| PatientID | PatientID | %String | 患者ID |
| QueueNo | QueueNo | %String | 挂号序号 |
| PayModeCode | PayModeCode | %String | 支付方式代码 |
| PayFee | PayFee | %String | 支付金额 |
| PayBankCode | PayBankCode | %String | 银行代码 |
| PayTradeNo | PayTradeNo | %String | 支付交易号 |
| AppOrderCode | AppOrderCode | %String | 预约取号ID |

#### LockOrderRt (锁号请求)
| XML标签 | 字段名 | 数据类型 | 说明 |
|---------|--------|----------|------|
| PatientID | PatientID | %String | 患者ID |
| ScheduleItemCode | ScheduleItemCode | %String | 排班ID |
| LockQueueNo | LockQueueNo | %String | 锁号队列号 |
| CardNo | CardNo | %String | 卡号 |
| CardType | CardType | %String | 卡类型代码 |
| BeginTime | BeginTime | %String | 分时段开始时间 |
| EndTime | EndTime | %String | 分时段结束时间 |
| TransactionId | TransactionId | %String | 交易流水号 |

---

## 六、支付方式代码对照

| 代码 | 说明 |
|------|------|
| 1 | 现金 |
| 2 | 银医卡 |
| 3 | 银行卡 |
| 4 | 信用卡 |
| 5 | 微信支付 |
| 6 | 支付宝 |
| CPP | 预交金账户 |

---

## 七、预约方式代码对照

| 代码 | 说明 |
|------|------|
| WIN | 窗口预约 |
| TEL | 电话预约 |
| APP | APP预约 |
| WEB | 网页预约 |
| ATM | 自助机预约 |
| DOC | 医生站预约 |
| VIP | VIP预约 |

---

## 八、证件类型代码对照

| 代码 | 说明 |
|------|------|
| 01 | 身份证 |
| 02 | 军官证 |
| 03 | 护照 |
| 04 | 港澳通行证 |
| 05 | 台湾通行证 |

---

## 九、常用HIS数据表

| 表名 | 说明 |
|------|------|
| RBAppointment | 预约表 |
| RBApptSchedule | 排班表 |
| DHCRBApptSchedule | 排班扩展表 |
| PAPatMas | 患者主索引 |
| DHCRegistrationFee | 挂号费表 |
| DHCLockSchedule | 锁号表 |
| CTLCock | 卡类型定义 |

---

## 十、返回码说明

| 返回码 | 说明 |
|--------|------|
| 0 | 成功 |
| -1 | 系统错误 |
| -100 ~ -199 | 参数错误 |
| -200 ~ -299 | 患者信息错误 |
| -300 ~ -399 | 限额限制 |
| -1000 ~ | 业务错误 |

> 数据来源: DHCExternalService.RegInterface
