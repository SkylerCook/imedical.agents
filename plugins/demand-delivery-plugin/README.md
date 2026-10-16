# Demand Delivery Plugin

跨插件阶段依赖以 manifest 的 availableDependencies 为事实源；触发时按[可用性依赖协议](../../docs/plugin-availability.md)检查，缺口仅阻塞对应阶段，显式 disabled 保留。

跨技术栈复用需求提交安全机制，入口为 [demand-commit](skills/demand-commit/SKILL.md)。支持数字需求号及 standard/project 格式，不要求 IRIS profile、MCP 或 BOS 凭据；这是组织需求交付约定，不是任意 Git 提交格式转换器。

连续验收使用 [demand-acceptance](skills/demand-acceptance/SKILL.md)：用户明确调用开展验收交付，即授权该批次通过项提交、补 BOS 日志并推送，无需额外开关或重复确认交付范围；明确“先登记、暂不交付”时遵从限制。用户逐号给出结论，Agent 持续接收、按目标仓库串行交付，报告可独立整理。仅查看技能、查询汇总或 Agent 自动加载不产生交付授权。人工通过和实际交付分别汇总；BOS 多需求号列表固定为数量在块外、`text` 块内单行升序去重、半角逗号无空格。优先复用已有台账，明确批次按需使用 [验收索引协议](references/acceptance-session.md)；不改变正式任务编排。BOS 日志阶段条件使用 bos-plugin，不增加通用提交的强制依赖。

`demand-acceptance` 新任务默认验收当前工作区修改；`demand-acceptance --worktree [路径]` 从已确认的来源接收变更，兼容 `-worktree`。这是技能层参数，索引脚本不接收该开关；接续与映射见技能“代码来源”，授权见“调用与授权”。已有工程正常更新能力包并刷新已启用索引，无配置迁移或旧文件清理；新调用采用完整交付契约，旧批次保留已确认的授权范围和暂停限制。

`demand-commit --plan` 只生成消息与计划；`demand-commit --commit` 表达本地提交授权并执行 plan/apply/verify，均不包含 push。交付类型来自当前用户或项目约定，缺失时补问。

需要 Node.js >=22.5.0（Agent 工具链依赖）。新项目按项目上下文维护流程将本插件标为 enabled 后刷新 thin-index；没有初始化凭据或领域配置。旧入口迁移、数据协议和部署步骤见 [迁移说明](../../docs/demand-delivery-migration.md)。

运行 `node --test plugins/demand-delivery-plugin/tests/*.test.js` 验证隔离 Git 仓库与模拟 hook 行为；真实远端和其它平台结果另行取证。
