# Demand Delivery Plugin

跨技术栈复用需求提交安全机制，入口为 [demand-commit](skills/demand-commit/SKILL.md)。支持数字需求号及 standard/project 格式，不要求 IRIS profile、MCP 或 BOS 凭据；这是组织需求交付约定，不是任意 Git 提交格式转换器。

`--plan` 只生成消息与计划；`--commit` 表达本地提交授权并执行 plan/apply/verify，均不包含 push。交付类型来自当前用户或项目约定，缺失时补问。

需要 Node.js >=22.5.0（Agent 工具链依赖）。新项目按项目上下文维护流程将本插件标为 enabled 后刷新 thin-index；没有初始化凭据或领域配置。旧入口迁移、数据协议和部署步骤见 [迁移说明](../../docs/demand-delivery-migration.md)。

运行 `node --test plugins/demand-delivery-plugin/tests/*.test.js` 验证隔离 Git 仓库与模拟 hook 行为；真实远端和其它平台结果另行取证。
