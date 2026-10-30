# Demand Delivery Plugin

0.9.0：`demand-commit --plan|--commit --no-id` 显式支持 project 暂无需求号提交；标题省略需求号括号，修改说明及原提交校验保留。普通调用和 standard 仍要求数字需求号，不自动进入 BOS 或验收批次。正常更新完整能力包并刷新已启用索引，旧数字编号 v1 计划继续恢复；无配置迁移或旧文件清理，业务副本未自动更新。

0.8.1：验收默认先 commit/push，再按已保存的实仓 hash 补 BOS 日志；主子日志缺口或未知结果只暂停日志，Git 完成即释放发布权供后续需求继续。报告区分“代码已推送，BOS 待补”和完整交付。更新整个能力包并刷新已启用索引，旧 v1/v2 保留 schema、授权和回执，首次状态写入释放已完成的 Git 占有；旧顺序仍可续接，无配置迁移或旧文件清理。恢复接口见[批次协议](references/acceptance-session.md#回执与恢复)。

0.8.0：BOS 批次只登记最终实仓 commit，日志与推送前重核 root/ref/hash；worktree 仅作准备来源。parent 引用主实仓提交逐项日志，own 子项独立交付，none 跳过；JSON groupCompletion 按全部成员计算整组完成。完整更新两个 owner 与根 scripts/lib，日志选择补 ref；旧批次保留回执并重新核实，不自动重发。接口迁移见[验收协议](references/acceptance-session.md)，无私有配置或业务副本自动迁移。

本插件所有自有 skill 的帮助请求（`--help`、查看用法）先按[统一帮助协议](../../docs/guides/capability-help.md)展示帮助并结束，优先于插件启用、连接检查和业务前置。源定义随正常能力包更新分发，已有 thin-index 继续读取 source；帮助不自动启用插件。

0.6.0：新验收v2支持主子分组门禁、主提交及push回执继承、逐子项BOS日志和明确无代码阶段不适用，见[代码归属](../../docs/demand-code-ownership.md)。旧v1批次原样恢复，不自动迁移。取得完整能力包及根scripts/lib后刷新已启用索引，无新增项目配置或实际服务写入。

跨插件阶段依赖以 manifest 的 availableDependencies 为事实源；触发时按[可用性依赖协议](../../docs/plugin-availability.md)检查，缺口仅阻塞对应阶段，显式 disabled 保留。

跨技术栈复用需求提交安全机制，入口为 [demand-commit](skills/demand-commit/SKILL.md)。支持数字需求号及 standard/project 格式，project 暂无编号时可显式使用 `--no-id`；不要求 IRIS profile、MCP 或 BOS 凭据。这是组织需求交付约定，不是任意 Git 提交格式转换器。

连续验收使用 [demand-acceptance](skills/demand-acceptance/SKILL.md)：用户明确调用开展验收交付，即授权该批次通过项提交、补 BOS 日志并推送，无需额外开关或重复确认交付范围；明确“先登记、暂不交付”时遵从限制。用户逐号给出结论，Agent 持续接收、按目标仓库串行交付，报告可独立整理。仅查看技能、查询汇总或 Agent 自动加载不产生交付授权。人工通过和实际交付分别汇总；BOS 多需求号列表固定为数量在块外、`text` 块内单行升序去重、半角逗号无空格。普通单号复用已有台账，明确批次使用标准状态流和 [验收索引协议](references/acceptance-session.md)；不改变正式任务编排。BOS 日志阶段条件使用 bos-plugin，不增加通用提交的强制依赖。报告按[共享测试协议](../../agents/_shared/testing-protocol.md#结果与交接)分别统计人工补验与待用户验收结论，保留实际功能验证范围。处理报告固定包含本批全部需求号汇总（含基线已满足、无需新增代码项），状态分组另列；格式与完整性核对见 [编号汇总契约](skills/demand-acceptance/SKILL.md#编号汇总契约)。

`demand-acceptance` 默认定位当前工作区来源，最终实仓目标单独确认，来源为 worktree 时仍须合入实仓；`demand-acceptance --worktree [路径]` 从已确认的来源接收变更，兼容 `-worktree`。这是技能层参数，索引脚本不接收该开关；接续与映射见技能“代码来源”，授权见“调用与授权”。已有工程正常更新能力包并刷新已启用索引，无配置迁移或旧文件清理；新调用采用完整交付契约，旧批次保留已确认的授权范围和暂停限制。

`demand-acceptance --pass` 支持逗号编号列表和换行粘贴“需求号＋标题”；裸参数仅用于唯一待验收需求。推荐保留标题，按编号定位后用标题复核；解析、续接及歧义处理见技能“接收结论”，沿用原交付授权与暂停限制。

`demand-commit --plan` 只生成消息与计划；`demand-commit --commit` 表达本地提交授权并执行 plan/apply/verify，均不包含 push。交付类型来自当前用户或项目约定，缺失时补问。

上游前进且与本需求无交集、需求内容和消息未变时，Agent 复核后沿用已有授权自动重新 plan 并接续；边界与次数见[同步复核协议](references/commit-upstream-check.md)。同步由技能独立完成，有无 hook 均可使用；已部署项目正常更新能力包并刷新已启用索引即可，无配置迁移或旧文件清理，不需重装 hook。

需要 Node.js >=22.5.0（Agent 工具链依赖）。新项目按项目上下文维护流程将本插件标为 enabled 后刷新 thin-index；没有初始化凭据或领域配置。旧入口迁移、数据协议和部署步骤见 [迁移说明](../../docs/demand-delivery-migration.md)。

运行 `node --test plugins/demand-delivery-plugin/tests/*.test.js` 验证隔离 Git 仓库与模拟 hook 行为；真实远端和其它平台结果另行取证。
