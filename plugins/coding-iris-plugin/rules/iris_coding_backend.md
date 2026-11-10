---
name: iris_coding_backend
description: Use when implementing or modifying IRIS ObjectScript backend code.
task-affinity: [iris, objectscript, backend, coding]
related:
  - iris_coding_general.md
  - iris_coding_workflow.md
---

# 后端 ObjectScript 编码规则

修改前读取[CLS 命名与格式规范](../references/cls-coding-format.md)，最终 diff 后按其中清单复核；编码与 Review 共用该事实源。已有类仅规范本次新增代码，原有代码的功能修改不附带格式化，可选自检只提示，不作为提交门禁。

## 技术栈

- 后端语言：InterSystems IRIS ObjectScript。
- Web 入口：CSP / Broker。
- 业务包前缀、namespace、基类和目录映射以 `.agents/config/iris_project_profile.md` 为准。
- 上传和编译只在用户明确要求时执行，具体 MCP 能力以 `.mcp.json` 为准。

## 三层架构

```text
{BusinessPackage}.{Entity}BLH    业务逻辑层
{BusinessPackage}.{Entity}DATA   数据查询层
{BusinessPackage}.{Entity}SQL    SQL 执行层
```

| 层 | 职责 |
|---|---|
| `BLH` | 接收前端参数，校验参数，编排事务，调用 DATA/SQL |
| `DATA` | Query 查询、分页数据、单条 JSON、列表组装 |
| `SQL` | Insert/Update/Delete，返回 `"0^RowID"` 或 `"SQLCODE^错误信息"` |

新建类前核对目标工程 profile 的基类要求、同职责类的实际继承链及公共基类提供的能力，按类职责和项目契约确定 `Extends`。模板只提供结构示例，必须完成目标项目适配；在任务说明或 Review 上下文中给出所选基类及对应 profile/源码依据。profile 未明确时以已核实的项目代码和类职责判断；影响选择的冲突或缺失事实未解决时报告缺口，不把模板作为默认依据。具体业务基类只在项目配置或显式选择的领域默认值中维护。

目标项目的 AGENTS/profile 或用户已明确选择 `doctor-dev`（医生站组）时，建类与 Review 还须读取[医生站后端约定](../templates/profile-defaults/doctor-dev.md#后端约定)，核对注册类继承要求。此入口同时适用于已部署项目，不能因旧 profile 未抄入该要求而跳过；与项目显式规则冲突时报告并澄清，不静默覆盖配置。不根据目录名或类名前缀推断项目类型，未明确类型的工程沿通用核对流程执行。

## ObjectScript 风格

- 命名、缩写、缩进、控制结构和后条件空白统一遵循[CLS 规范](../references/cls-coding-format.md)，历史风格不自动覆盖规范。
- 新增注册类/非表模型、类方法、实例方法及变量时，按同一规范的[注释约定](../references/cls-coding-format.md#注释与空行) 核对职责、参数/返回契约、结构引用及自然语言变量说明；按实际填写适用标签，Debug 在文档提取或 Review 时不执行。
- 必填参数校验优先用 `$g(param)=""`，避免未传参时报 `<UNDEFINED>`。
- `%DynamicObject` 属性不能用 `$g()`，直接点号访问并按对象语义判断。

## BLH 约定

- BLH 只做参数校验、事务编排、权限或业务流程协调。
- 涉及写操作时使用事务边界；错误返回需明确可诊断。
- 不在 BLH 中堆叠复杂 SQL，查询放 DATA，写入放 SQL。
- session 获取、登录用户、科室、院区等公共能力从目标工程基类或 profile 指定工具读取。

## DATA 约定

- DATA 负责查询和数据组装，不做写入。
- 分页查询优先复用目标工程已有 Broker/Query 模式。
- 获取关联描述数据时优先复用目标工程已有公共查询或字典能力。
- 返回前端的数据结构应稳定，字段增删集中处理。

## 持久化类字段变更

- 新增持久化表类、属性或索引时，按 [CLS 表类注释约定](../references/cls-coding-format.md#持久化表类注释) 核对业务名称和 SQL 投影，属性的补充说明及索引注释按实际需要填写；非表类不套用 Table 标签，历史代码范围和编译授权沿用原边界。
- `%Persistent` 类新增 `Property` 时必须追加到已有属性末尾，不得插入历史字段中间。
- 不要手工改写或重排 `Storage Default` 的 `<Value>` 节点；Storage 由 IRIS 编译器按类定义重新生成。
- 历史数据按 `$lg(global(id), position)` 等位置语义存储时，中间插入字段会造成旧数据错位；无法确认存储结构时，先停下来核对 Storage 和已有数据形态。
- `SqlColumnNumber` 如需保留文档标注，使用当前最大值 + 1；不要把手工列号当作实际 SQL 映射控制手段。

## SQL 约定

- Insert/Update/Delete 返回 `"0^RowID"` 或 `"SQLCODE^error"`。
- SQL 执行失败判断优先使用目标工程公共方法；无公共方法时明确处理 `SQLCODE`。
- 新增表访问或字段访问时，必要时用 MCP 只读 SQL 验证字段、表名和数据形态。
- 持久化类新增字段后，所有涉及该表或实体的写入路径必须同步检查字段列表和参数列表，至少包括 `Insert`、`Update`、导入/批量导入、模板导入和手写 SQL Query。
- 同步 SQL 字段时，保持字段顺序、参数顺序和值绑定顺序一致；不要只改 `INSERT` 字段清单而漏改 values 或参数采集。
- 不在通用代码中写死目标工程表前缀或业务状态枚举。

## Broker 约定

- `DataType=Grid` 通常返回 `{total, rows}`，用于 datagrid/lookup 分页加载。
- `DataType=Combo` 通常返回 `[{value,text},...]`，用于 combobox。
- 无分页的小数组接口需避免加载大数据量字典。
- 查询参数名、QueryName、MethodName 以目标工程已有模式为准。

## 验证

- 修改 `.cls` 后，默认只做本地检查。
- 对最终 diff 执行 CLS 规范中的编码与 Review 检查，区分语言语法、明确规范和可选建议；补查提取后规则重复、业务标识归属和 Parameter 声明/引用；不能把本地自检当作完整格式或编译验证。
- 新增或重构条件分支后，检查完整 `if/else` 结构和缩进，避免命令式 `i/e` 与花括号块混用；`git diff --check` 只检查空白问题，不能作为 ObjectScript 语法编译结果。
- `%Persistent` 新增字段时，检查新属性位于末尾，Storage 未被手工重排，相关 Insert/Update/Import 写入路径已同步。
- 用户明确要求编译时，按 `.mcp.json` 选择 IRIS 上传/编译 MCP。
- 上传 `.cls` 时使用完整包路径文件名，不只传短名。

## 入参字段与业务校验

涉及数量、金额或状态的拦截时，先沿实际调用链核对页面赋值、计算后清空或替换、序列化位置、后端读取字段及历史存储字段，记录字段含义与单位；不能凭参数名称或另一入口的同名字段推断。分隔串的位置应以真实生产者为准。上行与批量审核是两个调用路径，验证需分别由实际序列化契约构造输入，覆盖字段为空但另一业务字段有效、零、小数及编辑/复制；只模拟单个后端方法不能证明提交链路正确。缺少项目调用方时先补齐材料，参考标版不覆盖项目事实。
