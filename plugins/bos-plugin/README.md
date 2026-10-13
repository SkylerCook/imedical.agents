# BOS Plugin

为不同技术栈提供 BOS 查询和需求处理入口。查询采用 Node.js 内置模块，需要 Node.js >=22.5.0；这是 Agent 工具链依赖，不是业务系统生产运行依赖。版本以 manifest 为准。

| 入口 | 用途 |
|---|---|
| [bos-init](skills/bos-init/SKILL.md) | 初始化个人身份，或接入项目并生成发现入口 |
| [bos-demand-query](skills/bos-demand-query/SKILL.md) | 查询待办、历史或指定编号详情 |
| [bos-demand-handle](skills/bos-demand-handle/SKILL.md) | 核对需求后使用项目领域能力实施、验证和交付 |

插件无 IRIS 强依赖。IRIS 项目按范围直达前端/后端技能，混合或边界不明时使用 iris-coding；其它项目沿用自己的规范。简单任务由当前 Agent 连续修改、自查和目标验证，正式协作资料按条件加载，具体分流见 [bos-demand workflow](../../workflows/bos-demand.workflow.md)。

已部署项目通过普通能力包更新取得本次流程修正，无配置迁移或旧文件清理；源仓修改不会自动同步业务工程。

首次接入从 bos-init 真实路径开始。查询必须配置 BOS_MCP_CONFIG 或已有连接环境变量；[使用说明](references/usage.md)定义优先级和错误行为。[接入与迁移](references/adoption.md)包含项目与用户级接入步骤。普通框架更新只分发能力，不启用插件、不修改个人配置或客户端。

示例：“查看 BOS 12345 的详情”“处理 BOS 12345”“处理 BOS 12345，验收通过后提交”。只要求查询时不会改代码；只说验收通过不会自动授权提交。

## 验证

运行 node --test plugins/bos-plugin/tests/*.tests.js；发现/流程集成见 scripts/tests/bos-plugin.tests.js，场景验收见 [需求场景](references/scenarios.md)。测试使用合成数据与隔离仓库，不连接真实 BOS。CI 配置不等于跨平台通过，真实宿主及项目试点另行取证。

框架是查询能力的唯一维护源，适用于组织统一分发、个人独立配置。新使用者从 [私有配置初始化](references/usage.md)开始；实例仅在仓外生成，真实凭据不进入框架。待办、项目待办、历史模式由脚本统一处理。已有本机技能按 [迁移步骤](references/adoption.md)改为引用，不维护第二份实现。

客户端原生工具是可选接入方式，服务来源、stdio 注册示例与验收见 [客户端 MCP](references/client-mcp.md)。
