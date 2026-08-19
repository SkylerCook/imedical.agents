# CA/CR 运行时与存储契约

## Map

`User.DHCDocAppBLMap` / `SQLUser.DHC_DocAppBLMap` / `^DHCDocAppBLMap`：

| global piece/node | 含义 |
|---|---|
| piece 1 | Map code |
| piece 2 | 名称 |
| piece 3 | 组成模板 RowID，以 `||` 分隔并保持顺序 |
| piece 4 | Active |
| piece 5-8 | Init、item master、save other、load other 函数配置 |
| piece 9 | `CA` 或 `CR`；空值和其他类型不属于本插件 |
| piece 10 | XML template name |
| `"ShowJS"` | Map JavaScript 资源 |

Map code 索引为 `^DHCDocAppBLMapi("MapCode",code,rowId)`。

## 组成模板

`User.DHCDocAppBLTemple` / `SQLUser.DHC_DocAppBLTemple` / `^DHCDocBLTem`：piece 1 为名称、2 为模板类型、3 为 APP ID、4 为 MapType、5 为 parent/last ID；`"ConT"` 保存 HTML，`"JSStr"` 保存 JavaScript。公共模板必须版本化克隆，不直接原地覆盖。

公共模板种子、优先 MapCode 和适用 CA/CR 类型属于目标工程事实，必须由 `cure-form-common-migration-config/v1` 配置或当前 Map 组成关系提供；插件 canonical 不保存业务 RowID。

## 缓存字段

`User.DHCDocAppBLItem` / `SQLUser.DHC_DocAppBLItem` / `^DHCDocAppBLItem`：piece 1-10 依次为字段 ID、名称、类型、必填、保存、模板 RowID、长度、控件类型、控件 ID、打印名；`"ShowJS"` 保存字段 JS，`"RA"` 保存关联评定量表。模板反向索引为 `^DHCDocAppBLItemi("BLTemp",templateRowId,itemRowId)`。

## 宿主运行时

- CA 宿主：`cure-ws/.../asstemp/assTempShow.js`，负责 Map、缓存字段、保存、重开、回显和打印编排。
- CR 宿主：`cure-ws/.../record.recordtemp.js`，负责 `SaveCureRecord`、`CureExpJsonStr`、`ServerObj.MapID`、回显和打印。
- 表单模块公开 `Init/OtherInfo/PrintInfo`，不得重新定义 CR 宿主保存入口。

`web.DHCDocAPPBL` 是现有维护和读取实现；自动部署只调用 `web.DHCDocAPPBLDeploy`，避免旧方法中的非事务更新与调试断点。
