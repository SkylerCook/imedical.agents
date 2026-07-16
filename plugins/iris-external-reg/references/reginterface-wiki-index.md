# DHCExternalService.RegInterface 索引

## 核心类文件

| 文件 | 说明 |
|------|------|
| RegManager.cls | 核心预约挂号管理类 |
| SelfRegMethods.cls | 自助机/外部系统接口方法 |
| SelfRegQueryMetods.cls | 查询相关Query方法 |
| PatientManager.cls | 患者管理 |
| SelfRegPlulic.cls | 公共方法(入参/出参对象工厂) |
| InterfaceMethods.cls | 第三方服务接口调用 |
| SynVisitSchedule.cls | 排班同步服务 |
| GetRelate.cls | 外部代码对照转换 |

## 快速索引

### 一、RegManager 核心方法

| 方法 | 功能 |
|------|------|
| `UpdateNotifyStatus` | 修改停诊通知状态 (1.1) |
| `LockOrder` | 锁号请求 (1.1) |
| `RemoveLockOrder` | 解除锁号请求 (1.1) |
| `InToOut` | HIS调用平台接口入口 (1.1) |
| `BookService` | 预约挂号 (1.1) |
| `PaymentOrder` | 支付确认 (1.1) |
| `RefundReg` | 退号/取消预约 (1.1) |
| `RegfeeRefund` | 挂号退费通知 (1.1) |
| `ImportApptToHIS` | 平台预约入HIS (1.2) |
| `CancelOrderToHIS` | 取消HIS预约 (1.2) |

### 二、SelfRegMethods 自助机/外部系统接口

| TradeCode | 方法 | 功能 |
|-----------|------|------|
| 3300 | `GetPatInfo` | 获取患者信息 |
| 3301 | `QueryPatCard` | 查询患者卡信息 |
| 1014 | `QueryDepartmentGroup` | 查询大科室/科室组 |
| 1012 | `QueryDepartment` | 查询科室 |
| 1013 | `QueryDoctor` | 查询医生 |
| 1004 | `QueryAdmSchedule` | 查询排班 |
| 10041 | `QueryScheduleTimeInfo` | 查询分时段信息 |
| 1101 | `OPRegister` | 挂号/取号 |
| 1104 | `QueryAdmOPReg` | 查询已挂号记录 |
| 1103 | `CancelOPRegist` | 取消挂号 |
| 1003 | `OPRegReturn` | 退号 |
| 10015 | `LockOrder` | 锁号 |
| 10016 | `UnLockOrder` | 解锁号 |
| 1105 | `GetInsuRegPara` | 获取医保挂号参数 |
| 1107 | `QueryStopDoctor` | 查询停诊医生 |
| 1108 | `QueryRegStatus` | 查询挂号状态 |
| 1109 | `QueryPatList` | 查询患者列表 |

### 三、排班同步接口 (SynVisitSchedule)

| 方法 | 功能 |
|------|------|
| `SynVisitSchedule` | 同步排班信息 |
| `SynRegCount` | 同步预约总数 |
| `SynStopVisitSchedule` | 停诊同步 |
| `SynReplaceVisitSchedule` | 替诊同步 |

### 四、公共方法 (SelfRegPlulic)

| 方法 | 功能 |
|------|------|
| `GetInputObj` | 根据TradeCode获取入参对象 |
| `GetOutputObj` | 根据TradeCode获取出参对象 |

### 返回码

| 范围 | 说明 |
|------|------|
| 0 | 成功 |
| -1 | 系统错误 |
| -100 ~ -199 | 参数错误 |
| -200 ~ -299 | 患者信息错误 |
| -300 ~ -399 | 限额限制 |
| -1000 ~ | 业务错误 |

## 常用HIS数据表

| 表名 | 说明 |
|------|------|
| RBAppointment | 预约表 |
| RBApptSchedule | 排班表 |
| DHCRBApptSchedule | 排班扩展表 |
| PAPatMas | 患者主索引 |
| DHCRegistrationFee | 挂号费表 |
| DHCLockSchedule | 锁号表 |
| CTLCock | 卡类型定义 |

详细方法说明见 `reginterface-wiki.md`。
