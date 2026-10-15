# 可重复测试运行时

入口为 [BOS workflow](../workflows/bos-demand.workflow.md) 和 [测试协议](../agents/_shared/testing-protocol.md)。实现位于 [test-session.js](../scripts/lib/test-session.js)、[test-evidence.js](../scripts/lib/test-evidence.js)，只用 Node 内置模块；不创建浏览器、不保存凭据、不新增服务端接口。Node 是能力包工具依赖，不是业务生产运行依赖。

## 接入顺序

项目 runner 在首导航前创建 collector；登录后复用同一 context。项目适配保留自己的角色、页面、请求效应 catalog、资源映射与数据 authority；通用工具不猜测 IRIS Broker 语义。已有 IRIS parser 只在已核实覆盖范围内复用，未知调用效应进入待复核，不能把监听器当写入防火墙。

1. 创建一个会话 owner，调用 `start()` 完成预检。
2. 开发期间准备用例；部署就绪后调用 `runTestCase()`，其 `ensureReady()` 先检查认证。
3. Coordinator 核验结果、证据引用与版本后进入既有验证入账。结果文件属于目标项目，工具不自动写台账。
4. 每个 case 关闭自身资源；整个批次 `finally` 中调用 session `stop()`。只有 `cleanupVerified=true` 才能声明会话工具清理完成，其它浏览器/数据资源独立确认。

## 会话接口

`createTestSession({adapter, policy, clock?})` 返回 `start/ensureReady/noteActivity/stop/snapshot`。clock 是可注入计时器，宿主不能可靠后台运行时禁用心跳，恢复前检查仍可用。

| 输入 | 契约 |
|---|---|
| adapter.check | 同会话检查，返回 `{status:'valid'|'expired'|'unknown'|'human-required'}` |
| adapter.heartbeat | 已验证无业务写入、能延续空闲计时的请求，成功返回 valid |
| adapter.reauthenticate | 正常重新认证，返回 valid 或 human-required/unknown |
| adapter.restore | 复核并恢复角色、页面、数据前置，成功返回 ready |
| policy | 必填未来 `deadlineAt`（毫秒时间戳）；`requestTimeoutMs` 默认 10000；启用心跳还需 `verifiedHeartbeat:true`、`backgroundTimers:true`、有限正数 `idleTimeoutMs`、小于空闲时限的 `heartbeatAfterMs` |

所有 adapter 接收 `{signal}`，必须响应取消、限定请求时间并管理自己的底层资源。框架超时会 abort，但未退出的 adapter 仍记为 pendingOperation，禁止新认证调用；不能声称已清理。原始错误由项目安全记录，接口只返回状态，避免输出凭据。HTTP 连接 keep-alive 不代表应用会话续期。

项目只有确认某次请求延续同一会话时，才调用 `noteActivity({verifiedExtendsSession:true})`。检查接口本身不假定续期；浏览器动画和无服务端请求的点击不算活动。业务请求并发由项目 runner 管理；重新认证前暂停该会话其它用例。多个进程使用不同会话或由一个持有者串行执行。

心跳未知结果先 check；确认过期才重新认证。无法确认则 blocked，要求先核实后重新建立 owner，不循环登录。stop 用于结束、暂停和取消，停止后不可复用；恢复批次前先核实旧 owner 已退出，再建立新实例。会话工具不接收保存/删除动作，不自动重放业务请求。

## 采集与用例接口

`createRequestCollector(source,{early,resourceKey})` 接受具有 on/off 的浏览器事件源（request/response/requestfailed）。项目在首导航前挂载才可声明 early；resourceKey 返回获准的资源逻辑标识或 null，不返回带凭据 URL。`setTarget(frame)` 可晚设置；`setPhase()` 标记阶段；`snapshot()` 返回脱敏归属、时间、失败、状态和资源摘要。`loaded(resource,sha256)` 核对目标 frame 最近实际响应，未早挂、响应缺失或哈希不符均不通过。`stop({timeoutMs:10000})` 解绑监听并限时等待已采集响应，返回 events、pendingBodies 和 cleanupVerified；pendingBodies 非零时由项目 owner 关闭对应资源并核实，不声明清理完成。浏览器由项目 owner 关闭。

`runTestCase({demandId,caseId,scope,version,adapter,session?,now?})` 输出 `imedical-test-result/v1`，仅内存返回。adapter 的 prepare/verifyVersion/sideEffects/close 仅严格 true 表示已确认；execute 运行一次；assert 返回非空 `{id,passed,evidenceRefs}` 数组。版本验证执行前后各一次。sideEffects 必须同时完成业务副作用及相关/未知网络事件复核，未完成返回 false；请求取消不自动豁免。

assert 的证据引用应指向已取得的可见界面/业务状态材料，不能填占位符。原生设备等未覆盖范围由 Coordinator 明确追加，不能归入 passed 的 scope。失败或未知结果仍调用 close，关闭未确认则 review-pending。工具不执行重试、不自动授予用户验收、不替代最终 scope 指纹门禁。

## 部署与验证边界

通过现有更新流程取得根 scripts/lib、agents、workflows、docs，无新配置迁移或旧文件清理；已有项目必须显式接入自身 runner，更新框架不会自动启用保活。新编排结果接口见 [编排协议](../agents/_shared/orchestration-protocol.md)。

本地模拟分别验证协议、失败出口和清理；Windows/macOS/Linux × Node 22/24 CI 是工具矩阵，宿主实际浏览器能力另验。真实项目需对照无心跳空闲超时、持续有效活动、心跳超过同一时限、停止心跳恢复超时及失效恢复，最后重复一条完整业务路径。没有对应授权/证据时标记“会话保活及真实业务闭环待验证”。
