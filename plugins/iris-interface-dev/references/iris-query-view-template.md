# IRIS 对外数据视图 Query 模板

用于实现由外部系统通过 `SqlProc` 拉取数据的只读 IRIS/ObjectScript Query。使用前必须从目标项目已导出的源码确认返回字段、业务时间节点、Global 索引、节点、piece、字典映射和关联键；禁止根据模板猜测工程事实。

## 实现约束

1. Query 名、Execute 方法名和参数严格对应：`<QueryName>` / `<QueryName>Execute`。
2. 有业务时间节点的视图统一声明 `stDate/endDate`；空参数默认当天。
3. 外层循环只按已验证索引定位业务 ID；每条记录通过 `d <rowLabel>` 进入标签取值。
4. 标签只读取 ROWSPEC 当前需要的字段，通过无返回值 `q:condition` 跳过记录。
5. `$lb(...)` 的字段数、语义和顺序必须与 ROWSPEC 完全一致。
6. `qHandle` 在遍历前初始化，输出行写入 `^CacheTemp(repid,ind)`。
7. 日期入参用 `$zdh(value,3)`；日期时间输出用 `$zd(date,3)_" "_$zt(time,1)`。
8. 使用 `websys.Query` 时复用其 Fetch/Close；改用 `%Query` 时实现同名 Fetch/Close 并清理临时结果。
9. Query 只读：不执行 DDL/DML，不写业务 Global，不保留调试 `^TEMP` 数据。
10. 禁止 `.s/.f/.i/.q/.d`、`..s/..f/..i/..q/..d` 等点号循环体。

## 时间索引选择

| 场景 | 应使用的业务时间 | 索引形态示例 |
|---|---|---|
| 就诊或入院 | 就诊日期、入院日期 | `^<ADM_INDEX>("<DATE_INDEX>",date,id)` |
| 处方或医嘱开立 | 开嘱日期、开始日期 | `^<ORDER_INDEX>(0,"<ORDER_DATE_INDEX>",date,orderId,itemSub)` |
| 医嘱执行 | 实际执行日期 | `^<ORDER_INDEX>(0,"<EXEC_DATE_INDEX>",date,orderId,itemSub,execSub)` |
| 检查申请 | 申请创建日期 | `^<APP_INDEX>(0,"<CREATE_DATE_INDEX>",date,applicationId)` |
| 患者主数据 | 已验证的登记或就诊索引 | 遍历索引并用 `seen(id)` 去重 |

接口字段要求执行时间时，不得用入院日期代替；要求申请时间时，不得用医嘱开始时间代替。

## 日期范围模板

将 `{{...}}` 占位符替换为目标项目中已验证的值。

```objectscript
/// {{VIEW_DESCRIPTION}}
/// call {{SQL_SCHEMA}}.{{SQL_PROC_NAME}}("2026-01-01","2026-01-01")
Query {{QUERY_NAME}}(stDate = "", endDate = "") As websys.Query(ROWSPEC = "{{COLUMN_1}},{{COLUMN_2}},{{COLUMN_N}}") [ SqlName = {{SQL_PROC_NAME}}, SqlProc ]
{
}

ClassMethod {{QUERY_NAME}}Execute(ByRef qHandle As %Binary, stDate = "", endDate = "") As %Status
{
    s stDate=$s(stDate'="":$zdh(stDate,3),1:+$h)
    s endDate=$s(endDate'="":$zdh(endDate,3),1:+$h)
    s repid=$i(^CacheTemp),qHandle=$lb(0,repid,0),ind=1
    for bizDate=stDate:1:endDate {
        s bizId=""
        for {
            s bizId=$o(^{{INDEX_GLOBAL}}({{INDEX_PREFIX}},bizDate,bizId))
            q:bizId=""
            d {{ROW_LABEL}}
        }
    }
    q $$$OK
{{ROW_LABEL}}
    s sourceData=$g(^{{DATA_GLOBAL}}(bizId))
    q:sourceData=""
    s column1={{COLUMN_1_EXPRESSION}}
    s column2={{COLUMN_2_EXPRESSION}}
    s columnN={{COLUMN_N_EXPRESSION}}
    s ^CacheTemp(repid,ind)=$lb(column1,column2,columnN),ind=ind+1
    q
}
```

## 多层索引模板

复合明细或执行记录必须遍历实际存在的所有索引层级，不得固定某个子节点。

```objectscript
for bizDate=stDate:1:endDate {
    s parentId=""
    for {
        s parentId=$o(^{{INDEX_GLOBAL}}({{INDEX_PREFIX}},bizDate,parentId))
        q:parentId=""
        s itemSub=""
        for {
            s itemSub=$o(^{{INDEX_GLOBAL}}({{INDEX_PREFIX}},bizDate,parentId,itemSub))
            q:itemSub=""
            s execSub=""
            for {
                s execSub=$o(^{{INDEX_GLOBAL}}({{INDEX_PREFIX}},bizDate,parentId,itemSub,execSub))
                q:execSub=""
                d {{ROW_LABEL}}
            }
        }
    }
}
```

## 全量去重模板

用于患者等主数据。无业务含义的参数应删除。

```objectscript
ClassMethod {{QUERY_NAME}}Execute(ByRef qHandle As %Binary) As %Status
{
    s repid=$i(^CacheTemp),qHandle=$lb(0,repid,0),ind=1
    s bizDate=""
    for {
        s bizDate=$o(^{{INDEX_GLOBAL}}({{INDEX_PREFIX}},bizDate))
        q:bizDate=""
        s bizId=""
        for {
            s bizId=$o(^{{INDEX_GLOBAL}}({{INDEX_PREFIX}},bizDate,bizId))
            q:bizId=""
            d {{ROW_LABEL}}
        }
    }
    q $$$OK
{{ROW_LABEL}}
    s entityId={{ENTITY_ID_EXPRESSION}}
    q:entityId=""
    q:$d(seen(entityId))
    s seen(entityId)=1
    s column1={{COLUMN_1_EXPRESSION}}
    s columnN={{COLUMN_N_EXPRESSION}}
    s ^CacheTemp(repid,ind)=$lb(column1,columnN),ind=ind+1
    q
}
```

## 交付检查

- Query 与 Execute 的参数名、顺序和默认值一致。
- 时间范围命中需求指定的业务索引，起止日期均包含。
- 循环体只推进索引并调用标签；标签按需读取字段。
- 必填字段、枚举、空值和时间格式符合接口文档。
- `$lb` 列数与 ROWSPEC 列数一致。
- 无固定测试日期、测试患者、固定执行子节点或调试 Global。
- 离线接口审查通过；仅在用户明确授权后上传、编译或执行远端验证。
