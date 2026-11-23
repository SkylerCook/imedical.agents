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

## CLS 落笔前检查

首次新建、修改或生成 ObjectScript 实现前，先读整份 [CLS 命名与格式规范](../references/cls-coding-format.md)，对照原始方法、字段声明及项目显式约定确定本次新增范围。以下索引用于在构思实现时选定写法。任务中途新增后端改动、接手其他 Agent 的实现或从离线材料开始时，在第一次写入该范围前完成同一检查；已读且仍在当前上下文的原文可复用。

| 准备写什么 | 落笔前核对 |
|---|---|
| 带复合条件的命令 | [OS001](../references/iris-offline-development.md#cls-源码出包门禁) 将完整判断放入后置条件括号，例如 `Quit:((a) || (b))`。 |
| 新类、新方法或调整过程块 | [OS002](../references/cls-coding-format.md#objectscript-变量作用域os002) 核对有效作用域，特别是旧类中新增的方法；[OS003](../references/cls-coding-format.md#新方法使用花括号块os003) 新方法使用花括号。 |
| 读取当前科室、用户 | [OS004](../references/cls-coding-format.md#登录科室和用户os004) 从前端传入的 sessionStr 或统一方法取值。 |
| 新增标版业务数据或配置 | [OS005](#标版业务数据与业务配置存储os005) 先确定用途、读取方和生命周期，再设计表与字段。临时结果和排障日志按原规则判断。 |
| 声明类、表、字段或方法 | [OS006](../references/cls-coding-format.md#注释与空行) 在设计签名和字段时一起确定职责、参数、返回值及适用说明。 |
| 修改传统错误陷阱 | [OS007](#传统错误处理os007) 先确定原始错误的保存时点及陷阱收尾。 |
| 临时切换命名空间 | [OS008](#命名空间切换os008) 先确定独立调用层、保护生效的编译分支和各退出路径。 |
| 给时间戳属性或 SQL 列赋值 | [OS009](#时间戳写入os009) 先核对目标类型、值的来源、转换与精度，再写赋值或绑定。 |

实现者直接按命中条款写代码。交给其他 Agent 时，把本节、CLS 规范路径和命中的条款随现有任务说明传给实际写代码的人。正式 Review 使用同一组规范和冻结 diff，在已有结论中写明核对的适用项；发现违规时给出文件位置与条款，脚本结果单独说明。

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

## 传统错误处理（OS007）

新增或修改通过 `$ZT`（`$ZTRAP`）安装的错误处理入口时，进入处理标签先用局部变量保存 `$ZE`（`$ZERROR`），再执行可能产生新错误的回滚、日志或清理操作。后续记录或返回使用保存的原始错误，遵守调用方已有返回契约。处理完本层错误、准备恢复业务执行或返回时，按该陷阱的作用域清除安装的关联（`Set $ZT=""`）；有外层处理或显式向上传播时，核对原处理链能正确接续。

涉及事务时核对本层开始的事务在成功和错误路径均有对应收尾；嵌套调用须保留调用方的事务和锁。仅凭 `$TLEVEL>0` 无法判定归属。普通 `Try/Catch` 优先使用捕获的异常对象，单纯读取 `$ZE` 不触发清空 `$ZT` 的要求。Review 确认原始错误被覆盖、陷阱遗留或错误路径误处理外层资源时返修。[官方传统错误处理](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=ALEGERR)

## 命名空间切换（OS008）

业务代码优先在当前命名空间完成操作。新增或修改切换时，先核对是否确有跨空间需求。临时切换由外层方法进入可独立返回的局部调用层，例如 `Do 标签` 或带返回值的 `$$标签(参数)`。核对实际调用和返回路径，避免从外层顺序落入切换逻辑；`Goto` 本身不会建立调用层。[官方调用栈说明](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_vestack) 子例程内先 `New $Namespace`，再 `Set $Namespace=target`；所有到达切换的路径都须先保存上下文，正常返回或异常退出该层时由运行时恢复。只读当前 `$Namespace` 无需保存。只有调用契约明确要求返回后继续留在目标空间时才使用 `ZN`（`ZNSPACE`）做持久切换。新增或改动的此类命令进入正式 Review，记录调用方为何需要保留目标空间。

禁止将当前空间保存到普通变量、用 `ZN` 切出，再依赖末尾 `ZN` 切回的临时切换写法。切换成功后的查询、调用或其他操作若抛错，末尾恢复语句可能被跳过。Review 核对调用方返回后的预期空间，检查打开的对象或 SQL 游标是否跨切换点继续使用。临时切换缺少栈保护、异常路径遗留目标空间或跨空间误用资源，确认后返修。静态检查按分支核对保护，并区分 Set 顶层赋值与表达式中的比较。同一标签同时经局部调用和直接跳转进入时，按违规处理。间接入口或方法调用边界待确认时，正式 Review 要求核实各退出路径。受管 Pack 校验当前源码对应的复核结论。[官方命名空间说明](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_vnamespace)

OS008 按目标编译分支核对保护。整数常量条件与嵌套分支可静态判断。保护只出现在被排除的分支时，切换行报违规。保护依赖未解析的宏或表达式时，按目标构建核对生效代码并记录复核依据。[InterSystems 条件编译说明](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_macros_mpp_lbIf)

## 标版业务数据与业务配置存储（OS005）

标版需求（`standard`）新增或扩展业务记录、业务配置的持久化写入时，统一通过有表结构的模型保存。先核对已有表的业务含义与字段，适合时复用；需要新模型时建立表类，声明字段、类型和记录含义。禁止业务代码直接用 Global 下标或拼接串定义并保存这些数据。历史 Global 增加新的业务配置键或业务记录写入口，同样适用。

最终 diff 出现新增 Global 写入时，结合需求、写入值、读取方及数据生命周期判定用途。用于后续读取的业务记录、业务开关、阈值或业务默认值，确认命中即返修。请求、进程、查询或报表的临时结果放行。用于排障的参数、调用栈和异常日志也放行，包括跨请求保存并按保留期清理的日志。若业务流程从同一节点读取业务状态或配置来决定后续行为，该用途仍按业务数据或配置核查。Global 名称、下标中有 `$J` 或单条写入语句均不足以单独判定用途。仅兼容读取历史数据、清理临时结果、表类自身的 Storage 映射，以及项目需求（`project`）不触发本条。无需为本条迁移存量。

## 持久化类字段变更

- 新增持久化表类、属性或索引时，按 [CLS 表类注释约定](../references/cls-coding-format.md#持久化表类注释) 核对业务名称和 SQL 投影，属性的补充说明及索引注释按实际需要填写；非表类不套用 Table 标签，历史代码范围和编译授权沿用原边界。
- `%Persistent` 类新增 `Property` 时必须追加到已有属性末尾，不得插入历史字段中间。
- 默认存储的新增属性由编译器扩展。新增持久化属性使用显式 SQL Storage 时，按目标类契约同步写入 `SQLMap`，以有效 SQL 字段名建立映射并保留历史段号。受管部署条件见[显式 SQL Storage 新增字段](../references/deployment-protection.md#显式-sql-storage-新增字段)。
- 历史数据按位置存储时，重排实际存储位置会使旧数据错位；核对 Storage 和已有数据形态，不能仅凭属性声明位置判断映射已经变化。
- `SqlColumnNumber` 控制 SQL 投影列顺序，影响 `SELECT *` 以及省略列清单的写入。新增属性时核对既有列号、Storage 映射与调用方契约，保留历史映射；属性声明顺序、Storage 位置和 SQL 列序分别检查。[官方定义](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=ROBJ_property_sqlcolumnnumber)

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

## 时间戳写入（OS009）

新增或修改对象赋值、嵌入式 SQL INSERT / UPDATE 时，从绑定值追到实际属性类型。向 `%DateTime` 或 `%TimeStamp` 写入逻辑值；已知依赖界面或地区格式的日期时间须先按其来源转换。生成当前本地时间可用 `$zdt($h,3)`；已有事件时间须保留原值及所需精度。页面、打印和查询结果可按展示约定格式化。 标准 %DateTime 的 DATEFORMAT 参数用于解析 Display 或 ODBC 输入中的数值日期顺序，逻辑值采用 YYYY-MM-DD HH:MM:SS（可带小数秒）。写入当前本地时间且只需秒精度时，直接使用上述原生表达式；接收外部日期串时须核对来源约定与目标属性的实际转换参数。[DateTime 类型参数](https://docs.intersystems.com/irislatest/csp/documatic/%25CSP.Documatic.cls?CLASSNAME=%25Library.DateTime&LIBRARY=%25SYS)

Review 核对 helper 的实现、格式参数及其覆盖方法。原生 `$ZDATETIME($H,3)` 默认按 ODBC 格式输出日期和时间；显式指定 localeopt=0 时须核对区域设置。自定义日期 helper 的参数 3 不能证明独立时间 helper 的输出格式或精度。[官方参数说明](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_fzdatetime)受管源码门禁根据本类声明和冻结任务范围内可识别的持久类映射检查 SQL 列及属性；确认展示值直写时间戳时报 OS009。写入来源未明，或展示值的目标类型、SQL 参数映射无法解析时，核对实际声明及转换并通过正式 Review 的 `--reason` 记录依据。动态 SQL、宏展开和跨方法数据流由 Reviewer 沿实际调用链核查。
