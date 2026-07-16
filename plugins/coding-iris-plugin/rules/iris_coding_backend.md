---
name: iris_coding_backend
description: Use when implementing or modifying IRIS ObjectScript backend code.
task-affinity: [iris, objectscript, backend, coding]
related:
  - iris_coding_general.md
  - iris_coding_workflow.md
---

# 后端 ObjectScript 编码规则

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

基类继承链从目标工程 profile 读取，不在通用规则中写死。

## ObjectScript 风格

- 命令后条件语法中，命令、冒号和完整条件表达式必须连续书写：`q:((cond="")&&(cond1=""))`，不要写 `q: cond=""`。
- 使用缩写：`s`、`d`、`q`、`$g`、`$p`、`$o`、`$d`。
- 不使用长命令：`set`、`do`、`quit`、`$get`、`$piece`、`$order`。
- 方法大括号换行显示，缩进 4 个空格。
- 条件分支必须保持同一种语法结构：单行命令式使用配对的 `i ...` / `e ...`；花括号块统一使用 `if ... { ... } else { ... }`。不要在 `i condition { ... }` 块结束后继续使用独立的 `e s ...`。
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
- 检查 `q:`、`d:`、`s:`、`continue:` 等命令的完整后条件表达式，确认冒号后直到条件结束没有空格分隔；尤其禁止 `continue:(cond1) && (cond2)` 这类写法。
- 新增或重构条件分支后，检查完整 `if/else` 结构和缩进，避免命令式 `i/e` 与花括号块混用；`git diff --check` 只检查空白问题，不能作为 ObjectScript 语法编译结果。
- `%Persistent` 新增字段时，检查新属性位于末尾，Storage 未被手工重排，相关 Insert/Update/Import 写入路径已同步。
- 用户明确要求编译时，按 `.mcp.json` 选择 IRIS 上传/编译 MCP。
- 上传 `.cls` 时使用完整包路径文件名，不只传短名。
