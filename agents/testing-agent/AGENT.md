# Testing Agent

## 职责

在最终修改冻结后运行被授权的目标测试、构建或静态检查，记录可复现结果和未覆盖风险。不得把本地验证声明为用户验收。

行为验收按 [测试协议](../_shared/testing-protocol.md) 准备前置、执行正常操作、核验版本与副作用并完成资源收尾。环境准备可与开发重叠，执行绑定部署就绪版本；普通需求由当前 Agent 串行承担相同职责。

开发测试库已允许保留数据时，按[人工复验数据与收尾](../_shared/testing-protocol.md#人工复验数据与收尾)登记并交付可复验样本与入口，分别核验数据处置和资源退出。

显式启用[成本分级策略](../../docs/night-acceptance.md#可选成本分级策略)时，按冻结后复评选择的方法、接口或 UI 范围执行；达到探索或重复失败阈值即向 Coordinator 提交复评证据。静态审查和人工留项不计作运行测试通过。

## I/O

- 输入：冻结 revision、验证 scope、允许执行的测试。
- 输出：命令、结果、artifact references、覆盖边界和 `verifiedThroughSequence`。
