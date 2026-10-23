# 夜跑客户端生命周期预检修复（2026-10-23）

范围：根级共享客户端、Codex adapter、能力预检入口与监督 worker。沿现有能力回执和 checkpoint 增加可选证据，不另建调度/状态库，不改 RPC 格式、不自动重试，不修改业务项目 .agents、Codex 配置或原 rollout/数据库。已有未提交修改保持。根运行库不属于插件或独立 skill 的版本单元，本次不改 owner manifest 或新增插件发布记录；BOS 查询并行变化不属于本任务。

## 已修复行为

- 把原项目临时探针收敛到传入 preflight 的 probeClientLifecycle。明确授权、截止与持久回执可用后才创建两个固定无业务单轮端点，按 read-only sandbox 运行。
- turn/start ACK 后等待匹配的用户项完成或 turn 完成事件，再读取一次历史。启动、历史回读、中断 ACK、终态和进程退出分开归档；历史失败不能抹掉 ACK，也不能满足启动门禁。ACK 无终态、丢失启动响应或未退出进程均保留未知证据。
- 能力 CLI 在原输出内先写未完成快照并读回，随后按端点/ACK/终态/退出更新，完成前不可用；外部更改、既有回执或旧 run 不覆盖。
- 本地 stdin 结束后有界等待退出，超时才强制结束；退出不等于端点停止。worker checkpoint 保留 transport 证据，进程未证实退出时保留 lease。旧同步 dispose 仅作兼容的紧急关闭，不被当作退出证明。

## 验证结果

本轮在 Windows、Node 24.14.1 验证，总计 133 项通过、1 项真实浏览器用例因缺少锁定运行时跳过，无失败。测试只使用合成端点与本地假模型，不部署、不处理真实业务数据。

| 范围 | 结果与证据 |
|---|---|
| 客户端、监督、能力预检、夜跑入口 | 69 通过、1 浏览器跳过；覆盖事件早于 ACK、启动超时/取消、创建在途取消、RPC -32603、敏感字段过滤、未知端点保留、临时写入退出、旧回执与 PLAN 门禁 |
| 安装的真实 CLI 0.163.0-alpha.11.2 | 包含在上项；隔离 Codex home 与只读工作区、本地假模型，两端点的就绪/历史/ACK/终态/进程退出均通过，2 次模型请求只访问本机 loopback；不是线上模型验收 |
| 受管 PLAN、治理、集成、派发、契约、报告、周额度 | 最终实现上 63/63；双 Developer、独立 Review、冻结、预算及停止门禁保持 |
| 文档链接/入口、语法与格式 | 链接定向 1/1；变更 JS 语法、严格 UTF-8/BOM/换行及 diff 空白通过；共享文档的实施前内容按顺序保留 |
| 三平台 × Node 22.5.0/22/24 | 沿原 night-acceptance CI，未执行远端矩阵，不声明通过；真实 CLI 用例为显式环境变量启用，CI 默认只运行可移植夹具 |

专项测试位于 [客户端](../../scripts/tests/night-client.tests.js)、[能力预检](../../scripts/tests/night-capability.tests.js) 与[监督](../../scripts/tests/night-client-supervisor.tests.js)。缓存沿现有 validation-evidence 工具保存在源仓 .git/imedical-lifecycle-validation-20261023.json，记录实际命令与范围指纹；无须为本任务新增调度或记录库。初次真实 CLI 测试因缺少测试文件 fs 导入失败，修正后通过；该失败产生的空目录已精确核对并清理，不改写为首次即成功。

## 适用边界

已经证实的原故障是零字节 rollout 无法提供 session metadata，导致 thread/read 与 thread/turns/list 返回 -32603；原探针错误合并停止与回读阶段。本地早前九组对照未复现持续空文件，不能把快速中断认定为写入失败的根因。此次修复的是可验证的启动/回读时序和证据归类，不是 Codex 底层写入器；原未知端点不因此核销。

实际安装 Codex CLI 与本地假模型的测试只证明该版本的本机协议接入，不等同真实业务、模型遵循或其它平台通过。Windows/macOS/Linux × Node 22.5.0/22/24 沿既有 CI 取证，未取得结果的组合仍未验证。源仓变更需正常更新目标能力包后才能取得，现有或新项目重新生成能力预检时，profile 均按[接入示例](../../docs/night-governance.md#客户端生命周期预检)替换临时探针；旧已批准回执与 run 不自动迁移。

原理参考：[官方协议](https://learn.chatgpt.com/docs/app-server)、[同类空 rollout 报告](https://github.com/openai/codex/issues/25621)；相似上游报告不证明本地触发原因或已合并修复。
