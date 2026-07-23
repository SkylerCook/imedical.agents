# medStepCode 值域说明（框架A 接入管理）

`medStepCode` 是 `dhcdoc.interface.accessmanage.csp` 中"业务中间层（Product）"关联的一个维度，标识**诊疗环节**。CSP 通过 `DHCDoc.Interface.AccessManage.LoadJS(SessionStr, ProductDomain, medStepCode)` 按该值动态加载对应的中间件 JS（`scripts/dhcdoc/interface/<厂家代码>/<模块代码>.js`）。

> **关键边界**：`medStepCode` 决定"在哪一诊疗环节注入第三方能力"，而具体的生命周期钩子（BeforeUpdate 等）由各厂家/模块的中间件 JS **文件头"钩子清单表"** 定义，并不由 medStepCode 本身穷举。下表给出取值与含义、典型业务环节、常用触发事件，具体可用事件以对应中间件 JS 为准。

---

## 1. 值域表

| 取值 | 业务含义 | 典型业务环节 | 常用触发事件 |
|------|----------|--------------|--------------|
| `Reg` | 挂号 / 患者登记 | 挂号登记、建卡 | BeforeUpdate / AfterUpdate |
| `Diag` | 诊断录入 | 诊断保存 / 删除 | BeforeUpdate / AfterUpdate / AfterDelete |
| `Order` | 医嘱（开立 / 处置） | 医嘱录入、审核、停嘱 | BeforeUpdate / AfterUpdate / BeforeStop / AfterStop |
| `Disp` | 发药 / 摆药 | 药房发药、摆药 | BeforeUpdate / AfterUpdate |
| `Exam` | 检查 / 检验 | 检查检验申请、结果查看 | BeforeUpdate / AfterUpdate |
| `Opera` | 手术 | 手术申请、排程 | BeforeUpdate / AfterUpdate |
| `Bill` | 计费 / 收费 | 收费、结算 | BeforeUpdate / AfterUpdate |
| `Other` | 其他未归类环节 | 自定义非标准环节 | 视中间件定义 |

取值规则：
- 必须取自上表，不得自造未列值；若业务无法归类，使用 `Other` 并在关联扩展中说明。
- 一个 厂家+模块 中间件 JS 可以同时挂多个 `medStepCode` 的钩子（如同时有 `Diag` 与 `Order`）。
- `medStepCode` 只用于**框架A**（accessmanage 中间件注入）。

---

## 2. 生命周期事件（钩子）说明

中间件通过 `ProductObj.<medStepCode>.<Event>` 注册钩子，框架在对应时机回调。

| 事件 | 触发时机 | 是否常用 | 用途 |
|------|----------|----------|------|
| `Init` | 页面初始化 | 是 | 初始化、加载配置 |
| `xhrRefresh` | 患者切换 | 否 | 刷新患者相关数据 |
| `BeforeUpdate` | 数据保存前 | 是（最常用） | 校验 / 拦截 / 修改数据 |
| `AfterUpdate` | 数据保存后 | 是 | 同步 / 通知 / 打印 |
| `AfterAdd` | 添加数据行后 | 否 | 行级处理 |
| `BeforeDelete` | 删除记录前 | 否 | 删除前校验 |
| `AfterDelete` | 删除记录后 | 否 | 同步删除结果 |
| `BeforePrint` | 打印前 | 否 | 打印前处理 |
| `BeforeStop` / `AfterStop` | 停止前 / 后 | 否 | 停嘱前校验 / 同步停止结果 |

> 不同中间件支持的钩子集合不同（例如有的支持 BeforeStop/AfterStop，有的支持 BeforeDelete/AfterDelete）。**以各中间件 JS 文件头的"钩子清单表"为准，禁止自行假设对象 key 或参数名。** 参数通过名称匹配（类似 `AnalysisArg`），因此参数名必须与中间件定义精确一致。

---

## 3. 与框架B 的关系

`medStepCode` **只用于框架A**（accessmanage 中间件注入）。框架B（`dhcdocinterfaceregister` 方法注册）按 `interfaceType`(HIS/SOAP/HTTP) 与 `methodType`(ClassMethod/Query/Sql) 统一分发，**不依赖 medStepCode**。

二者组合时：
- 中间件 JS（A）内部用 `$.cm({ClassName, MethodName, ...})` 调后端类；
- 该类可同时是 B 中注册的接口方法（在 `User.DocInterfaceMethod` 登记），从而既能被中间件调用，也能被 SOAP/HTTP/HIS 统一调度。

---

## 4. 在需求澄清中的用法

需求澄清（门禁）阶段必须确认：
1. 是否走 A：若是，必须给出 `medStepCode` 取值（可多选）与每个环节要用的 `Event`。
2. `medStepCode` 与 `Event` 组合决定了中间件 JS 的 `ProductObj` 结构骨架。
3. 具体钩子签名（参数名、返回格式）以对应中间件 JS 文件头的 JSDoc / 钩子清单表为权威基线，不得脑补。
