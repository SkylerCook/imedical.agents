# IRIS 会话治理减负实施与调度评估

## 交付范围

第一阶段基于现有 SessionManager、公共准入、恢复 CLI 与历史目录实现。coding owner 从实施时最新 0.28.4 升至 0.29.0，七个直接依赖更新兼容上界并递增 patch。xc 沿既有决定暂缓。

| 原有负担 | 本次行为 | 新增成本 |
|---|---|---|
| 旧 warning 容易被当成当前阻断 | admission/pool 共用 generation 与 historical，状态返回 blockingReasons/nextAction | 状态增加兼容字段，旧配置由运行时解释 |
| SERVER_ERROR、身份错误和发送阶段混在一起 | 保留安全底层码、beforeSend、真实 HTTP 状态，传输失败单独标记 | 有限白名单字段，无响应正文落盘 |
| 恢复先手工写退出证据文件 | 同代可靠关闭回执自动生成证据，空闲会话可由明确恢复请求关闭 | 复用既有恢复历史与互斥 |
| 单次运行时失败后手删 pool | 核实写效果后使用原恢复命令，记录成功持久化后解除相关保护 | 未知写继续明确选择结果与 ID |
| 注销 Cookie 变化误报活动请求身份错误 | 独立 logout reason/phase，保留 cleanupVerified=false | 保留真实资源未关闭保护 |
| GBK 无法表示字符到上传才发现 | confirm --files 在写 profile 前解码/试转换 | 可选文件范围，省略时给出指引 |

generation 表示资源生命周期。缺少 generation 的旧 warning 仅在核实时间足以证明过期时标为历史，否则返回 null。没有可靠服务器会话和 License 观测时保留现有 false 字段，并声明能力范围。

未知写仍要求显式核实结果。运行时报错可能发生在部分写入之后，临时类编译也有元数据效果。当前上游没有可靠 classCreated/classCleaned、executedCommandCount 或事务状态回执，协调层保留未知。执行位置用于定位，无法推导已执行语句数。只读探查复用现有 SELECT 和文档读取。

## 实施入口

- `scripts/lib/iris-operation-scope.js` 共用诊断、警告时效和本地退出证据判断。
- `scripts/lib/iris-session-manager.js` 维护代次与关闭回执，恢复写历史后更新状态，落盘失败恢复内存保护。
- `scripts/lib/iris-remote-operations.js` 维护 admission generation、失败阶段和自动证据恢复，保留状态 token 及并发互斥。
- `scripts/iris-remote.js` 从实际 CLI 查询与恢复，空闲关闭和最终恢复分别校验 token。status/sessions 使用纯读取路径。
- `scripts/lib/atelier-client.js` 区分 logout Cookie 变化，批量读取 checkpoint 保留每项失败阶段。仅注销观测未确认时保留已取得的读取结果，本地资源关闭失败仍准确报告。
- MCP host、原生 adapter 与 CLI JSON 透传有限诊断字段，业务响应仅沿原调用回执返回。

使用和升级步骤统一归 [会话指南](../../docs/guides/iris-managed-sessions.md)与[更新 runbook](../../docs/update-agents.md)。

## 第二阶段测量

测量脚本为 `scripts/tests/iris-session-scheduling-benchmark.js`。使用真实 SessionManager、公共准入锁和回环 HTTP 客户端。两种通道后端均以 Atelier 客户端模拟，响应延迟 10 ms，排队时间从入队统计到出队。以下是一次完整采样，Node 24.14.1、Windows x64，每组 12 个只读请求。故障组第 6 个响应断连，继续发起后续独立读取。

| 场景 | 故障 | 认证 | 注销 | 失败 | 锁冲突 | 人工动作 | 总耗时 ms | 排队累计/最大 ms |
|---|---|---|---|---|---|---|---|---|
| 同通道连续 | 无 | 1 | 1 | 0 | 0 | 0 | 233 | 2 / 1 |
| 交替通道 | 无 | 12 | 12 | 0 | 0 | 0 | 380 | 1 / 0 |
| 按通道各 6 个合批 | 无 | 2 | 2 | 0 | 0 | 0 | 215 | 1 / 0 |
| 同通道 12 个并发入队 | 无 | 1 | 1 | 0 | 0 | 0 | 200 | 1040 / 172 |
| daemon 持有资源与独立读取 owner 竞争 | 无 | 1 | 1 | 0 | 1 | 1 | 231 | 1 / 0 |
| 同通道连续 | 断连 | 2 | 2 | 1 | 0 | 0 | 216 | 1 / 0 |
| 交替通道 | 断连 | 12 | 11 | 1 | 0 | 0 | 357 | 1 / 0 |
| 按通道各 6 个合批 | 断连 | 2 | 2 | 1 | 0 | 0 | 203 | 1 / 0 |
| 同通道 12 个并发入队 | 断连 | 2 | 2 | 1 | 0 | 0 | 244 | 1370 / 217 |
| daemon 持有资源与独立读取 owner 竞争 | 断连 | 2 | 2 | 1 | 1 | 1 | 218 | 1 / 0 |

认证、注销由 HTTP 请求实际计数。独立批量竞争测量覆盖其共用 admission owner，批量 worker 的完整抓取另由 read-pool 回归覆盖。人工动作指竞争后显式关闭空闲 managed 会话，再申请独立 owner。故障交替组首次认证未得到 Cookie，因此该代无可注销 Cookie。

这些数字用于定位资源切换与锁竞争成本。单次回环样本和模拟后端限制了生产耗时推断，医院请求耗时另列如下。

### 授权真实只读试点

通过当前源码 host 与普通 IPC 入口，复用目标项目私有配置和 managed-sessions-v5 vendor。目标别名与连接事实留在用户侧，本记录不包含医院连接信息。

- 首轮 3 次 MCP SELECT 成功，同一 generation，耗时 1284、113、88 ms。
- 第二轮 3 次 MCP SELECT 成功，同一 generation，耗时 1190、57、61 ms。
- 第二轮使用不完整 SELECT 触发只读语法错误，收到 session-tool-failed、beforeSend=false、toolErrorCode=SQL_ERROR，未知写数量保持 0。
- 后续两次 MCP SELECT 成功，耗时 842、41 ms。前次失败 warning 在新代显示 historical=true。
- 第二轮 Atelier/MCP 交替四次均成功，耗时 964、1169、628、969 ms，每次切换更新 generation。该组使用 SELECT 与服务器元信息两种读取，不能据此归因全部耗时差异。
- 最终 processExited=true、logoutAcknowledged=true、cleanupVerified=true、blockingReasons 为空、nextAction=continue。试点自有 host 已退出。
- 此次使用源仓运行时，业务副本配置与部署版本沿原状态。真实注销旋转警告和有业务写效果的恢复未在医院侧人为制造，其边界由本地可控故障与实际 IPC 恢复测试覆盖。

### 候选方案与推荐顺序

| 候选 | 已测收益或缺口 | 兼容与恢复成本 | 建议 |
|---|---|---|---|
| 在业务依赖允许时合并相邻同通道操作 | 回环交替 12 次认证，合批后 2 次，减少 10 次建立与退出 | 要保留原依赖顺序和逐项回执，未知写按原范围核实 | 下一轮优先做调用编排，先选真实混合读取批次验证 |
| 普通小批读取进入现有 daemon 队列 | 同通道排队复用 1 次认证，独立 owner 路径出现 1 次冲突与 1 次人工关闭 | 需让 read-pool 保留 binary、逐项 checkpoint、取消、预算和资格特殊入口 | 下一轮做最小路由原型，完整用户路径通过后定稿 |
| 同实例同时保留 MCP 与 Atelier 两套后端 | 可能减少反复认证，当前测量仅证明切换次数增加 | 增加会话预算、双后端退出、身份与租约协调成本，实际收益尚未测定 | 暂缓实现，先验证前两项收益 |
| 普通多文档写精确 targets | 可减少确定范围操作间的冲突 | 需先证明每个入口副作用范围，保留历史宽范围风险 | 在明确业务调用上逐项评估，compile 保留生成逻辑与回调保护 |

下一轮调度改造根据上述测量另行定稿。跨通道复用必须保留 backend 协议、认证身份、资源预算与租约语义。

## 验证与发布状态

Node 会话、admission、IPC、vendor、read-pool、source-sync、编码确认与导出完整回归共 147 项，146 通过、1 跳过。其后状态 reason 与历史原因分离补验 36 项通过。Windows PowerShell 5.1 和 PowerShell 7 完整 update-agents 回归均通过，覆盖新建、普通更新、已有配置、Overlay、thin-index 与迁移链路。项目文档链接检查通过。

跨平台工作流沿既有 Windows/macOS/Linux × Node 22/24 矩阵执行，本机仅有 Windows 与 Node 24.14.1，WSL 无已安装发行版。当前未触发远程 CI，Linux、macOS 与 Node 22 的本轮结果待发布验证。

全工作区组件版本校验识别本轮八个组件升级，无新增组件问题。校验整体仍因既有 xc 内部 version 及历史 release 缺少 commit 返回失败，按用户范围保留该记录。

业务项目沿现有安装更新入口获取变更，旧配置自动兼容，保留已有风险与历史。源仓实现与真实试点分别取证，业务副本整包升级、提交与推送按对应授权执行。
