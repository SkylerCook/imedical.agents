# BOS Plugin

为不同技术栈提供 BOS 查询、需求处理和代码更新日志补录入口。使用 Node.js 内置模块，需要 Node.js >=22.5.0；这是 Agent 工具链依赖，不是业务系统生产运行依赖。版本以 manifest 为准。

| 入口 | 用途 |
|---|---|
| [bos-init](skills/bos-init/SKILL.md) | 初始化个人身份，或接入项目并生成发现入口 |
| [bos-demand-entry](skills/bos-demand-entry/SKILL.md) | 从 Git 补丁生成标版文本/Excel，回填编号并衔接 demand-commit |
| [bos-demand-query](skills/bos-demand-query/SKILL.md) | 按发起/接受/当前人员或组查询待办、历史及编号详情 |
| [bos-demand-handle](skills/bos-demand-handle/SKILL.md) | 实施、验证和交付需求，提交校验成功后准备并按授权补录日志 |
| [bos-code-update-log](skills/bos-code-update-log/SKILL.md) | 预览并按授权将已有 Git 提交补录为代码更新日志 |

插件无 IRIS 强依赖。IRIS 项目按范围直达前端/后端技能，混合或边界不明时使用 iris-coding；其它项目沿用自己的规范。简单任务由当前 Agent 连续修改、自查和目标验证，正式协作资料按条件加载，具体分流见 [bos-demand workflow](../../workflows/bos-demand.workflow.md)。

0.3.0 接管标版需求补录，产品标识由项目约定或用户明确提供；本地文本/Excel 不要求查询凭据。提交按需复用 demand-delivery-plugin。旧入口由更新器迁移，已有数据协议继续兼容，更新和接入见 [迁移说明](../../docs/demand-delivery-migration.md)。源仓修改不会自动同步业务工程。

处理需求时主动读取影响理解、实现或验收的截图和附件，复用已有证据；关键资料无法读取时说明缺口并澄清后再实施依赖部分。仅查询详情仍按用户需要读取媒体，具体约定见上述 workflow。

首次接入从 bos-init 真实路径开始。个人初始化不启用项目；项目接入也不代替个人凭据填写。查询与代码更新日志共用 BOS_MCP_CONFIG 指向的仓外文件，按 skill 名分段且凭据独立；[使用说明](references/usage.md)定义优先级、TODO 填写与离线核对，defaults 成功不等于身份完整或真实连接可用。[接入与迁移](references/adoption.md)包含项目与用户级接入步骤。普通框架更新只分发能力，不启用插件、不修改个人配置或客户端。

示例：“查看 BOS 12345 的详情”“处理 BOS 12345”“处理 BOS 12345，验收通过后提交”。只要求查询时不会改代码；只说验收通过不会自动授权提交。

0.5.0 在需求处理的全部本地提交校验成功后，直接复用本次仓库与完整 hash 自动准备 BOS 日志计划；展示具体计划后复用明确的 BOS 补录预授权或请求一次授权。“验收后提交并把本次提交补录到 BOS 代码更新日志”可同时明确两个动作。缺少日志配置、拒绝或接口失败时保留本地已提交结果；未知结果先核对，已确认成功不重复写入。编排见 workflow，不改变通用 demand-commit 或需求状态；业务工程主动更新后生效，无新增配置迁移或旧文件清理。

0.4.0 统一分段配置，运行时不保留旧格式或编辑器设置回退；旧平铺配置须明确运行 migrate-config 原地转换，详见[配置与迁移](references/usage.md)。个人配置不会被项目更新器自动修改，日志缺失只阻塞日志技能。代码更新日志的 plan 不联网，submit 需明确 BOS 写入授权，字段与结果判定见[接口说明](references/code-update-log.md)。

## 验证

运行 node --test plugins/bos-plugin/tests/*.tests.js；发现/流程集成见 scripts/tests/bos-plugin.tests.js，场景验收见 [需求场景](references/scenarios.md)。测试使用合成数据与隔离仓库，不连接真实 BOS。CI 配置不等于跨平台通过，真实宿主及项目试点另行取证。

框架是 BOS 查询与日志能力的唯一维护源，适用于组织统一分发、个人独立配置。新使用者从 [私有配置初始化](references/usage.md)开始；实例仅在仓外生成，真实凭据不进入框架。待办、项目待办、历史模式由脚本统一处理。已有本机技能按 [迁移步骤](references/adoption.md)改为引用，不维护第二份实现。

客户端原生工具是可选接入方式，服务来源、stdio 注册示例与验收见 [客户端 MCP](references/client-mcp.md)。

0.5.1 补齐[查询参数契约](references/usage.md#查询参数契约)：区分上游 schema、本地开放字段、日期默认值与本地模式/排序，并限定标题报错样本的结论。运行接口和配置不变；已有业务工程主动更新能力包并刷新已启用插件索引后取得说明，无新增配置迁移或旧文件清理。

0.6.0 开放 suser / tuser / tgroup、explain 和可选 body，通过同一上游查询工具透传；列表支持任一人员/组条件，显式 cuser: "" 清除默认当前人，避免发起/接受维度被隐含交集裁剪。默认“我的待办”仍为本人＋所在组。旧空 cuser 调用需按[调用迁移](references/usage.md#060-调用迁移)改为省略字段才能继续继承本人；body 内部结构和非默认 explain 值由上游确认，本地合成测试不代表真实服务验收。已有工程主动更新能力包并刷新已启用插件索引后生效，无私有配置迁移或旧文件清理。
