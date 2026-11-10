---
name: imedicalxc-doctor-card-reader
description: |
  HIS 医生站读卡设备接入配置 SQL 生成。
  Use when 需要根据设备厂商、型号新增或调整读卡设备，生成 ct_dic_commondict 厂商/型号通用字典与 ct_pa_card_hard_manager 设备接口参数配置 SQL，并校验版本字典关联。
  当前仅支持 SQL 操作；后续读卡操作按新 skill 扩展。
  Triggers: "读卡设备接入"、"新增读卡厂商"、"新增读卡型号"、"设备接口参数配置"、"读卡器配置"、"厂商型号字典"、"ct_pa_card_hard_manager"。
---

# 读卡设备接入配置工作流

## 目标

根据用户提供的设备厂商、型号和版本，生成可跨项目复用的 SQL：

1. 在 `ct_dic_commondict` 新增厂商、型号两条通用字典数据。
2. 在 `ct_pa_card_hard_manager` 新增设备接口参数配置，关联厂商、型号和版本。
3. 生成校验 SQL，确认关联 id、激活状态、备注和时间字段。

默认只生成 SQL 并做只读核对；写库需用户明确授权。

## 数据模型

| 表 | 作用 | 关键字段 |
|---|---|---|
| `ct_dic_commondicttype` | 通用字典目录 | `id`、`code`、`displayname`、`is_deleted` |
| `ct_dic_commondict` | 通用字典数据 | `id`、`dicttype_dr`、`code`、`displayname`、`py_code`、`wb_code`、`activity`、`is_deleted` |
| `ct_pa_card_hard_manager` | 设备接口参数配置 | `id`、`manufacturer`、`model`、`version`、`active_flag`、`remarks`、`custom_js`、`js_function_name`、`run_prefix` |
| `hos_user_account` | 操作人 | `id`、`code` |

关联关系：

- `ct_dic_commondict.dicttype_dr = ct_dic_commondicttype.id`
- `ct_pa_card_hard_manager.manufacturer / model / version = ct_dic_commondict.id`
- 字典目录 code：`manufacturer`（厂商）、`model`（型号）、`version`（版本）
- 设备配置中的 `version` 必须指向 `version` 目录下已存在的字典数据（如 `Dev1`）

## 工作流总览

```
Phase 0 输入确认与安全边界
   ↓
Phase 1 只读现状核对（目录/重复/admin/表结构）
   ↓
Phase 2 生成厂商、型号字典 SQL
   ↓
Phase 3 生成设备接口参数配置 SQL
   ↓
Phase 4 校验、交付、按授权执行
```

## Phase 0：输入确认与安全边界

### 输入契约

| 参数 | 必填 | 默认 | 说明 |
|---|---:|---|---|
| `manufacturerCode` | 是 | — | 厂商字典 code，如 `JingLun` |
| `manufacturerName` | 是 | — | 厂商显示名，如 `精伦` |
| `modelCode` | 是 | — | 型号字典 code，如 `Idr` |
| `modelName` | 否 | 同 `modelCode` | 型号显示名 |
| `versionCode` | 否 | `Dev1` | 版本字典 code，必须已存在 |
| `remarks` | 是 | — | 设备能力备注，如 `支持身份证` |
| `activeFlag` | 否 | `true` | 设备配置是否默认激活 |
| `pyCode` / `wbCode` | 否 | 按规则推导 | 厂商、型号的拼音码/五笔码 |
| `runPrefix` | 否 | `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe` | 设备运行前缀；默认使用该 JDK 路径，目标库现状明确不同时先确认 |

### 输入处理

- 生成的 SQL 一律使用不带 schema 前缀的表名，依赖当前连接的 `search_path` 解析；禁止输出 `{schema}.table` 这类占位写法，数据库客户端无法识别。
- 缺少厂商/型号编码、名称或备注时，先向用户确认，不自行编造。
- 厂商/型号编码中的易混淆字符（如大写 `I` 与小写 `l`、`O` 与 `0`、`1` 与 `l`）必须在生成 SQL 前与用户逐字确认；输出时保留用户确认的原始大小写，禁止擅自转小写或用近似字符替换。确认后在事实表中单独列出编码的精确字符组成，例如 `Idr` = 大写 `I` + 小写 `d` + 小写 `r`，不是 `ldr`。
- 版本编码不存在时停止，提示用户先补充版本字典数据；不得把版本 id 写死。
- 目标库连接信息只从项目本地配置读取，不在输出、SQL 注释或 skill 中记录地址、账号、密码、token。

### 执行模式

- **默认模式**：只读查询 + 生成 SQL + 输出校验结果，不写库。
- **执行模式**：仅在用户明确授权后执行写库；建议使用事务，校验通过后再提交。
- 不在未确认的情况下更新或删除已有字典、设备配置。

## Phase 1：只读现状核对

完整 SQL 见插件根目录 `references/card-device-sql-templates.md` 的“查询模板”。至少完成：

1. 用 `select current_schema();` 确认连接已指向目标库（表名不带 schema 前缀），再按 code 查询字典目录 id，不写死 id。
2. 检查厂商/型号是否已存在（同目录下 code 或 displayname 重复即视为冲突）。
3. 查看 `ct_pa_card_hard_manager` 最近记录，读取 `custom_js`、`js_function_name`、`run_prefix` 的现状。
4. 查询 `hos_user_account.code='admin'` 的操作人 id。
5. 确认目标表列类型、可空性、默认值和序列。

输出事实表：

| 事实 | 值 |
|---|---|
| 当前 schema（仅确认连接） | ... |
| 厂商/型号编码逐字确认 | ...（如 `Idr` = 大写 `I` + `d` + `r`，非 `ldr`） |
| manufacturer 目录 id | ... |
| model 目录 id | ... |
| version 目录 id | ... |
| admin 用户 id | ... |
| 厂商重复检查 | 通过/冲突 |
| 型号重复检查 | 通过/冲突 |
| 设备配置现存 run_prefix | ...（与默认 JDK 路径比对） |
| 设备配置下一条 id | ... |

若重复检查冲突，停止生成插入 SQL，先和用户确认复用已有记录还是调整编码/名称。

## Phase 2：生成通用字典 SQL

### 厂商字典

在 `ct_dic_commondict` 插入一条厂商记录：

- `dicttype_dr`：通过 `ct_dic_commondicttype.code='manufacturer'` 子查询获取。
- `code` / `displayname`：用户输入。
- `start_date = CURRENT_DATE`，`end_date = NULL`，`activity = true`，`is_deleted = 0`。
- `create_datetime` / `update_datetime = CURRENT_TIMESTAMP`。
- `create_user_dr` / `update_user_dr`：通过 `hos_user_account.code='admin'` 动态获取。
- `py_code` / `wb_code`：按编码规则生成。
- 加 `NOT EXISTS`，且同时检查同目录下的 code 与 displayname，避免重复执行产生重复字典。

### 型号字典

与厂商字典相同，仅将目录 code 改为 `model`，code/displayname 使用型号输入。

### 编码规则

| 场景 | `py_code` | `wb_code` | 示例 |
|---|---|---|---|
| 中文显示名 | 各字拼音首字母拼接 | 各字五笔首字母拼接 | 精伦 → `JL` / `OW`；新中新 → `XZX` / `UKU` |
| 字母数字编码 | 编码大写 | 编码大写 | `Idr` → `IDR`；`F200` → `F200`；`Ss628` → `SS628` |

- 先查看同目录现有数据的编码风格，再决定使用哪种规则。
- 无法可靠推导时向用户确认；不要猜测后直接写库。

### 硬性规则

- 不得写死 `dicttype_dr` 或字典数据 id。
- 不得写死 admin 用户 id。
- 不插入已存在且未删除的同 code / 同 displayname 记录。
- 时间字段使用数据库当前时间，不使用硬编码日期。

## Phase 3：生成设备接口参数配置 SQL

在 `ct_pa_card_hard_manager` 插入一条设备配置：

- `manufacturer`：上一阶段新增的厂商字典 id。
- `model`：上一阶段新增的型号字典 id。
- `version`：`version` 目录下指定 code（默认 `Dev1`）的字典 id。
- `active_flag`：默认 `true`，按用户输入覆盖。
- `remarks`：用户提供的设备能力备注。
- `custom_js`：默认 `false`；若目标表现有记录不同，先与用户确认。
- `js_function_name`：默认 `NULL`。
- `run_prefix`：默认 `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe`；若目标表现有记录明确使用其他前缀，先与用户确认后按现状覆盖。
- `create_datetime` / `update_datetime = CURRENT_TIMESTAMP`。
- 加 `NOT EXISTS`，避免同一厂商 + 型号 + 版本重复配置；如果业务允许同组合多条，需用户显式确认后移除该保护。

### 关联解析

三个关联字段都通过字典 code 动态解析，不使用固定数字：

```
manufacturer → ct_dic_commondicttype.code='manufacturer' AND ct_dic_commondict.code=:manufacturerCode
model        → ct_dic_commondicttype.code='model'        AND ct_dic_commondict.code=:modelCode
version      → ct_dic_commondicttype.code='version'      AND ct_dic_commondict.code=:versionCode
```

任一关联解析为空时不得插入；先补字典数据或修正输入。

### 执行顺序

1. 厂商字典插入
2. 型号字典插入
3. 设备接口参数配置插入
4. 校验查询
5. 校验通过后提交事务；失败回滚

## Phase 4：校验与交付

### 校验 SQL

执行插件根目录 `references/card-device-sql-templates.md` 的“验证模板”，确认：

- 厂商、型号字典各 1 条，`dicttype_dr` 分别指向正确目录。
- 设备配置 1 条，三个关联字段都能 join 到对应字典 code。
- `active_flag`、`remarks`、`create_datetime`、`update_datetime` 符合输入和当前时间。
- 没有产生重复记录。

### 交付内容

1. 事实核对结果（目录 id、admin id、重复检查、现存默认值）。
2. 三段插入 SQL（厂商、型号、设备配置），带事务和 `NOT EXISTS`。
3. 验证 SQL 与预期结果。
4. 执行状态：默认“仅生成未执行”；若已授权执行，报告影响行数和校验结果。

### 完成条件

- [ ] 字典目录通过 code 动态解析，SQL 中无写死 id
- [ ] SQL 表名不带 schema 前缀，无 `{schema}` 占位
- [ ] admin 用户通过 `hos_user_account` 动态解析
- [ ] 厂商/型号无重复冲突
- [ ] 编码中的易混字符（`I`/`l`、`O`/`0`、`1`/`l`）已与用户逐字确认，SQL 保留原始大小写
- [ ] `py_code` / `wb_code` 已确认
- [ ] 设备配置三字段均能解析到有效字典 id
- [ ] `active_flag`、`remarks`、时间字段符合要求
- [ ] `NOT EXISTS` 防重复生效
- [ ] 校验 SQL 返回预期结果
- [ ] 未授权的写库操作未执行
- [ ] 输出中无连接信息或凭据

## 扩展：后续读卡操作

当前插件只覆盖 SQL 配置。新增读卡操作时：

1. 在 `skills/` 下新增独立 skill，例如设备初始化、读卡事务、错误码对照等。
2. 在 plugin.json 的 `description` / `defaultPrompt` 中补充触发条件，并递增插件版本。
3. 同步 AGENTS.md、README、release record 和维护记忆。
4. SQL 模板继续放在 `references/`；非 SQL 操作单独建模，不复用写库流程。
5. 不把新操作硬塞进本 skill，避免设备配置与运行时读卡逻辑耦合。

## 参考

- 插件根目录 `references/card-device-sql-templates.md`
- 表结构来源：`ct_dic_commondicttype`、`ct_dic_commondict`、`ct_pa_card_hard_manager`、`hos_user_account`
