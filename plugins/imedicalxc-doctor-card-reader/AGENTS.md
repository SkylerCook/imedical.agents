# imedicalxc-doctor-card-reader

HIS 医生站读卡设备接入配置插件。当前能力：根据设备厂商、型号生成通用字典数据（厂商、型号）与设备接口参数配置 SQL，并校验关联的版本字典。

## 入口

- **技能**：`skills/imedicalxc-doctor-card-reader/SKILL.md` — 读卡设备接入配置 SQL 生成工作流
- **SQL 模板**：`references/card-device-sql-templates.md` — 查询、插入、验证 SQL 与字段映射
- **脚本**：`scripts/generate-plugin-thin-index.ps1` — thin-index 生成

## 前置条件

用户需提供：

1. 厂商编码和名称（如 `JingLun` / `精伦`）
2. 型号编码和名称（如 `Idr` / `Idr`）
3. 版本字典编码（默认 `Dev1`，必须已在 `ct_dic_commondict` 中存在）
4. 设备支持能力或备注（如 `支持身份证`）
5. 可用的目标数据库只读连接；连接信息由目标工程本地配置提供

## 触发条件

- "读卡设备接入"、"新增读卡厂商"、"新增读卡型号"
- "设备接口参数配置"、"读卡器配置SQL"、"厂商型号字典"
- 需要操作 `ct_dic_commondict`、`ct_pa_card_hard_manager` 的读卡设备配置任务

## 执行边界

- 默认只执行只读查询并生成 SQL，不直接写库；写库必须获得用户明确授权。
- SQL 表名不带 schema 前缀，依赖当前连接的 `search_path` 解析；不输出 `{schema}.table` 这类数据库客户端无法识别的占位写法。
- 厂商/型号编码中的易混字符（大写 `I` 与小写 `l`、`O` 与 `0`、`1` 与 `l`）必须与用户逐字确认，SQL 保留原始大小写；例如 `Idr` 不是 `ldr`。
- 不写死字典目录 id、字典数据 id 或 admin 用户 id，运行时按 code 动态解析。
- 不把服务器地址、账号、密码、token 或其它连接信息写入插件、规则、模板或输出。
- 运行前缀默认 `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe`；目标库现状明确不同时先确认后覆盖。其它字段默认值仍以目标库现状为准。
- 后续新增读卡操作时，在 `skills/` 下增加独立 skill；非 SQL 操作不得混入当前 skill。
