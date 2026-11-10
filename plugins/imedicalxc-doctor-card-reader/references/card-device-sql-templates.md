# 读卡设备接入 SQL 模板

本文件提供查询、插入和验证模板。模板中的 `:parameter` 为占位：

- 表名一律不带 schema 前缀，依赖当前数据库连接的 `search_path` 解析。执行前用 `select current_schema();` 确认连接已指向目标库，不要把 schema 拼进 SQL（如 `sm_his.ct_dic_commondict`），带前缀的占位写法无法被数据库客户端识别。
- `:parameter`：由数据库客户端或 Agent 按实际输入替换，不要原样执行。
- 编码中的易混字符（大写 `I` 与小写 `l`、`O` 与 `0`、`1` 与 `l`）必须与用户逐字确认；如型号 `Idr` 首字符是大写 `I`，不是小写 `l`。SQL 中一律保留用户确认的原始大小写。
- 模板只描述 SQL 结构；连接信息由目标工程本地配置提供，不写入本文件。

## 1. 查询模板

### 1.1 确认当前 schema（仅确认连接，不拼接到 SQL）

```sql
select current_schema() as schema;
```

期望：返回目标 schema。后续 SQL 直接使用不带前缀的表名，由连接的 `search_path` 解析。

### 1.2 查询厂商、型号、版本字典目录

```sql
select id, code, displayname, activity, is_deleted
from ct_dic_commondicttype
where code in ('manufacturer', 'model', 'version')
order by code, id desc;
```

期望：三个 code 各存在一条有效目录。若版本目录缺失，停止并先补目录。

### 1.3 检查厂商/型号是否重复

分别用 `manufacturer`、`model` 替换 `:typeCode`，用目标编码/名称替换 `:code`、`:displayname`：

```sql
select d.id, t.code as type_code, d.code, d.displayname,
       d.py_code, d.wb_code, d.activity, d.is_deleted, d.create_datetime
from ct_dic_commondict d
join ct_dic_commondicttype t on t.id = d.dicttype_dr
where t.code = :typeCode
  and (lower(d.code) = lower(:code) or d.displayname = :displayname)
order by d.id desc;
```

判定规则：同一目录下 code 或 displayname 任一命中，即视为重复，停止插入并与用户确认。

### 1.4 读取设备接口参数配置现状

```sql
select id, version, custom_js, active_flag,
       create_datetime, update_datetime,
       manufacturer, model, remarks, js_function_name, run_prefix
from ct_pa_card_hard_manager
order by id desc
limit 100;
```

用途：

- 读取 `custom_js`、`js_function_name`、`run_prefix` 的现有取值，用于与默认值比对。
- 检查是否已存在相同厂商 + 型号 + 版本组合。
- 确认 `manufacturer`、`model`、`version` 存的是 `ct_dic_commondict.id`（bigint），不是编码字符串。

### 1.5 查询 admin 操作人

```sql
select id, code, name
from hos_user_account
where code = 'admin'
  and is_deleted = 0
order by id desc
limit 1;
```

若查不到，停止生成插入 SQL；不要写死用户 id。

### 1.6 查询表结构与序列

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = current_schema()
  and table_name in ('ct_dic_commondict', 'ct_pa_card_hard_manager')
order by table_name, ordinal_position;

select pg_get_serial_sequence(current_schema() || '.ct_pa_card_hard_manager', 'id') as id_sequence;
```

若 `id` 有序列默认值，插入时省略 `id`。

## 2. 插入模板

执行顺序：厂商字典 → 型号字典 → 设备接口参数配置。建议放在同一事务中，校验通过后提交。

### 2.1 厂商字典

```sql
INSERT INTO ct_dic_commondict (
    dicttype_dr, code, displayname,
    start_date, end_date, activity,
    create_datetime, create_user_dr, update_datetime, update_user_dr,
    py_code, wb_code, mark, is_deleted
)
SELECT
    dt.id, :manufacturerCode, :manufacturerName,
    CURRENT_DATE, NULL, true,
    CURRENT_TIMESTAMP, ua.id,
    CURRENT_TIMESTAMP, ua.id,
    :manufacturerPyCode, :manufacturerWbCode, NULL, 0
FROM ct_dic_commondicttype dt
CROSS JOIN (
    SELECT id
    FROM hos_user_account
    WHERE code = 'admin'
      AND is_deleted = 0
    ORDER BY id DESC
    LIMIT 1
) ua
WHERE dt.code = 'manufacturer'
  AND dt.is_deleted = 0
  AND NOT EXISTS (
      SELECT 1
      FROM ct_dic_commondict d
      WHERE d.dicttype_dr = dt.id
        AND d.is_deleted = 0
        AND (d.code = :manufacturerCode OR d.displayname = :manufacturerName)
  )
ORDER BY dt.id DESC
LIMIT 1;
```

### 2.2 型号字典

```sql
INSERT INTO ct_dic_commondict (
    dicttype_dr, code, displayname,
    start_date, end_date, activity,
    create_datetime, create_user_dr, update_datetime, update_user_dr,
    py_code, wb_code, mark, is_deleted
)
SELECT
    dt.id, :modelCode, :modelName,
    CURRENT_DATE, NULL, true,
    CURRENT_TIMESTAMP, ua.id,
    CURRENT_TIMESTAMP, ua.id,
    :modelPyCode, :modelWbCode, NULL, 0
FROM ct_dic_commondicttype dt
CROSS JOIN (
    SELECT id
    FROM hos_user_account
    WHERE code = 'admin'
      AND is_deleted = 0
    ORDER BY id DESC
    LIMIT 1
) ua
WHERE dt.code = 'model'
  AND dt.is_deleted = 0
  AND NOT EXISTS (
      SELECT 1
      FROM ct_dic_commondict d
      WHERE d.dicttype_dr = dt.id
        AND d.is_deleted = 0
        AND (d.code = :modelCode OR d.displayname = :modelName)
  )
ORDER BY dt.id DESC
LIMIT 1;
```

### 2.3 设备接口参数配置

```sql
WITH ref AS (
    SELECT
        (SELECT d.id
         FROM ct_dic_commondict d
         JOIN ct_dic_commondicttype t ON t.id = d.dicttype_dr
         WHERE t.code = 'manufacturer'
           AND t.is_deleted = 0
           AND d.code = :manufacturerCode
           AND d.is_deleted = 0
         ORDER BY d.id DESC
         LIMIT 1) AS manufacturer_id,
        (SELECT d.id
         FROM ct_dic_commondict d
         JOIN ct_dic_commondicttype t ON t.id = d.dicttype_dr
         WHERE t.code = 'model'
           AND t.is_deleted = 0
           AND d.code = :modelCode
           AND d.is_deleted = 0
         ORDER BY d.id DESC
         LIMIT 1) AS model_id,
        (SELECT d.id
         FROM ct_dic_commondict d
         JOIN ct_dic_commondicttype t ON t.id = d.dicttype_dr
         WHERE t.code = 'version'
           AND t.is_deleted = 0
           AND d.code = :versionCode
           AND d.is_deleted = 0
         ORDER BY d.id DESC
         LIMIT 1) AS version_id
)
INSERT INTO ct_pa_card_hard_manager (
    version, custom_js, active_flag,
    create_datetime, update_datetime,
    manufacturer, model, remarks, js_function_name, run_prefix
)
SELECT
    ref.version_id, false, :activeFlag,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
    ref.manufacturer_id, ref.model_id, :remarks, NULL, :runPrefix
FROM ref
WHERE ref.manufacturer_id IS NOT NULL
  AND ref.model_id IS NOT NULL
  AND ref.version_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM ct_pa_card_hard_manager h
      WHERE h.manufacturer = ref.manufacturer_id
        AND h.model = ref.model_id
        AND h.version = ref.version_id
  );
```

参数说明：

- `:activeFlag`：默认 `true`，按业务要求覆盖。
- `:remarks`：设备能力备注，如 `支持身份证`。
- `:runPrefix`：默认 `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe`；若 1.4 查到的现状明确使用其他前缀，先与用户确认后覆盖。
- `custom_js`、`js_function_name`：默认 `false` / `NULL`；目标表现状不同时先确认。

## 3. 验证模板

### 3.1 字典数据校验

```sql
SELECT t.code AS type_code,
       d.id, d.code, d.displayname, d.py_code, d.wb_code,
       d.activity, d.create_datetime, d.create_user_dr
FROM ct_dic_commondict d
JOIN ct_dic_commondicttype t ON t.id = d.dicttype_dr
WHERE (t.code = 'manufacturer' AND d.code = :manufacturerCode)
   OR (t.code = 'model' AND d.code = :modelCode)
ORDER BY t.code, d.id;
```

期望：厂商、型号各返回 1 条；`type_code` 正确；`activity = true`；`create_datetime` 为当日。

### 3.2 设备配置校验

```sql
SELECT h.id,
       h.manufacturer,
       mf.code AS manufacturer_code,
       mf.displayname AS manufacturer_name,
       h.model,
       md.code AS model_code,
       md.displayname AS model_name,
       h.version,
       ver.code AS version_code,
       h.active_flag,
       h.remarks,
       h.custom_js,
       h.js_function_name,
       h.run_prefix,
       h.create_datetime,
       h.update_datetime
FROM ct_pa_card_hard_manager h
LEFT JOIN ct_dic_commondict mf ON mf.id = h.manufacturer
LEFT JOIN ct_dic_commondict md ON md.id = h.model
LEFT JOIN ct_dic_commondict ver ON ver.id = h.version
WHERE mf.code = :manufacturerCode
  AND md.code = :modelCode
  AND ver.code = :versionCode
ORDER BY h.id DESC;
```

期望：返回 1 条；三个 code 均匹配；`active_flag` 符合输入；`remarks` 正确；时间字段为当前时间。

## 4. 字段与默认值

| 字段 | 取值规则 |
|---|---|
| `ct_dic_commondict.dicttype_dr` | 按目录 code 动态查询，不写死 id |
| `ct_dic_commondict.start_date` | `CURRENT_DATE` |
| `ct_dic_commondict.end_date` | `NULL` |
| `ct_dic_commondict.activity` | `true` |
| `ct_dic_commondict.is_deleted` | `0` |
| `ct_dic_commondict.create_datetime` / `update_datetime` | `CURRENT_TIMESTAMP` |
| `ct_dic_commondict.create_user_dr` / `update_user_dr` | `hos_user_account.code='admin'` 的 id |
| `ct_dic_commondict.py_code` / `wb_code` | 中文名取拼音/五笔首字母；字母数字编码取大写编码 |
| `ct_pa_card_hard_manager.manufacturer` / `model` / `version` | 对应 `ct_dic_commondict.id` |
| `ct_pa_card_hard_manager.active_flag` | 默认 `true` |
| `ct_pa_card_hard_manager.custom_js` | 默认 `false` |
| `ct_pa_card_hard_manager.js_function_name` | 默认 `NULL` |
| `ct_pa_card_hard_manager.run_prefix` | 默认 `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe`；现状不同时先确认 |
| `ct_pa_card_hard_manager.create_datetime` / `update_datetime` | `CURRENT_TIMESTAMP` |

## 5. 已验证示例

以下示例来自实际验证环境，仅用于对照字段和编码规则；执行时必须重新查询目录 id、admin id，并确认 `run_prefix` 是否采用默认 JDK 路径。

| 输入/字段 | 值 |
|---|---|
| 厂商 | `JingLun` / `精伦` |
| 厂商 py/wb | `JL` / `OW` |
| 型号 | `Idr` / `Idr` |
| 型号 py/wb | `IDR` / `IDR` |
| 版本 | `Dev1` |
| 备注 | `支持身份证` |
| 激活 | `true` |
| 设备配置关联 | `manufacturer`、`model`、`version` 均存字典 id |

对照要点：

- `ct_pa_card_hard_manager.version` 存的是版本字典 id，不是 `Dev1` 字符串。
- 厂商字典、型号字典插入成功后，才能插入设备配置；设备配置 SQL 通过 code 反查两条新字典的 id。
- 验证查询必须同时 join 厂商、型号、版本三个字典，确认 code 与备注、激活状态一致。

## 6. 跨项目适配

1. 用 `current_schema()` 确认连接已指向目标库；SQL 表名不带 schema 前缀，直接执行，不要拼接 `{schema}` 之类的占位符。
2. 重新查询 `manufacturer`、`model`、`version` 三个目录 id，不复制其它项目的数字 id。
3. 重新查询 admin 用户 id；不要复制用户 id。
4. 确认 `ct_pa_card_hard_manager` 的 `run_prefix`：默认 `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe`；目标项目现状明确不同时先确认，不要盲目沿用其它项目的路径。`custom_js`、`js_function_name` 仍按目标表现状确认。
5. 重新执行重复检查；不同项目的字典数据可能不同。
6. 如果目标项目缺少 `version` 目录或 `Dev1` 数据，先补版本字典，再生成设备配置。
