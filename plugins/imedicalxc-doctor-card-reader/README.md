# imedicalxc-doctor-card-reader

HIS 医生站读卡设备接入配置插件。核心能力是根据设备厂商、型号动态解析通用字典目录，生成厂商/型号字典数据和设备接口参数配置 SQL；当前仅覆盖 SQL 操作。

## 能力入口

- 主 skill：`skills/imedicalxc-doctor-card-reader/SKILL.md`
- SQL 模板：`references/card-device-sql-templates.md`
- 插件约束：`AGENTS.md`
- manifest：`.agents-plugin/plugin.json`
- thin-index wrapper：`scripts/generate-plugin-thin-index.ps1`

## 覆盖范围

| 对象 | 表 | 说明 |
|---|---|---|
| 厂商字典 | `ct_dic_commondict` | `dicttype_dr` 按 `ct_dic_commondicttype.code='manufacturer'` 解析 |
| 型号字典 | `ct_dic_commondict` | `dicttype_dr` 按 `ct_dic_commondicttype.code='model'` 解析 |
| 版本引用 | `ct_dic_commondict` | 按 `code='version'` + 版本编码（默认 `Dev1`）解析 |
| 设备接口参数配置 | `ct_pa_card_hard_manager` | `manufacturer`、`model`、`version` 存 `ct_dic_commondict.id` |
| 操作人 | `hos_user_account` | 按 `code='admin'` 动态获取，不写死用户 id |

## 使用前提

1. 目标库可访问 `ct_dic_commondicttype`、`ct_dic_commondict`、`ct_pa_card_hard_manager`、`hos_user_account`。
2. 用户提供厂商编码/名称、型号编码/名称、版本编码和备注。
3. 运行前缀默认 `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe`；目标库现状明确不同时先确认。
4. 连接信息来自目标工程本地配置，不随插件分发。

## 输出

- 只读现状核对结果：字典目录、重复数据、设备配置样例、admin 用户、表结构。
- 三段 SQL：厂商字典、型号字典、设备接口参数配置。
- 校验 SQL 和预期结果。
- 默认不执行写库；获得明确授权后才可执行。

## 扩展约定

后续新增读卡操作时，在 `skills/` 下新增独立 skill，并同步 manifest、AGENTS、README 和发布记录；SQL 模板继续放在 `references/`，非 SQL 操作单独建模，避免与设备配置写库流程耦合。

## 启用与更新

插件目录存在只表示能力 `available`。完成项目上下文维护和实际验收后，再将目标项目 `.agents/config/plugin_profile.md` 中的插件状态更新为 `enabled`。已部署项目通过 `.agents/scripts/update-agents.ps1` 获取插件更新，并按 profile 重建 thin-index。
