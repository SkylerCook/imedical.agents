# 夜跑与分层验收接入

入口为 [夜跑 workflow](../workflows/bos-demand-unattended.workflow.md)，基础契约见 [测试运行时](testing-runtime.md)。本方案不是后台调度服务；Coordinator 负责阶段与授权，工具负责有限执行、会话和清理。

## 选择最小充分的验收层级

| level | 适用 | 完成证据 |
|---|---|---|
| internal-method | 内部计算、转换、校验 | 正常/边界/异常输入与输出 |
| external-api | Broker/REST/SOAP 等对外契约 | 实际入口、认证/参数/业务响应；写入独立回读、关联保护与重复请求 |
| ui | 交互、可见结果、前后端联动 | 正常用户路径、界面证据、实际加载版本与必要业务回读 |

纯后端不加载 Playwright；仅为取得认证使用浏览器时，结果仍标真实后端入口。内部方法成功不代表 HTTP/Broker 契约正确。返回格式改变须核对消费者，影响前端行为时补 UI 用例。原生打印/组件/设备按客观困难交接，不强行包装为 Web 验收。

## 批次与执行器

目标工程填写 [批次模板](templates/night-run-batch.template.json)，null/空项为待确认，模板不是授权。时间须明确时区且满足停止领取 ≤ 停止发布 ≤ 绝对停止。默认 maxInFlight=1，通知/数据处置引用当前批次策略；旧夜跑时点和业务资料不复制。

项目编写 JS profile，执行：

```text
node .agents/scripts/run-acceptance.js --profile <目标工程的profile模块>
```

模块导出 `{options,cases}` 或返回该对象的异步工厂。这是可信项目代码入口，需先按目标项目规则审查。CLI 只返回 `imedical-acceptance-batch/v1` JSON；一项非 passed 就停止后续用例，退出前清理。scope-passed 仅代表指定范围，不写入用户验收或业务台账，Coordinator 仍核验证据并消费既有 run。

options 必填 projectRoot 和未来的 deadlineAt（毫秒时间戳）；timeoutMs 默认 30000，closeTimeoutMs 默认 10000。UI 可提供 runtimeModule、executablePath、viewport 和 resourceKey。依赖解析优先显式模块，否则从项目解析 playwright；不会扫描其它工程、安装 npm 包或下载浏览器。CI 固定独立测试依赖，项目不要求 npm install。

每个 case 延续 `runTestCase` 的 demandId/caseId/scope/version，并明确 level、entry（脱敏入口名称）、role、coverage。createAdapter 接收 `{context,collector,apiRequest,signal,session}`，返回 prepare/verifyVersion/execute/assert/sideEffects/close；后端 case 的 context/collector/apiRequest 为 undefined。所有阶段有界；结果未知不自动重试，残留操作阻止下一用例。

runner 不强制创建会话：项目可传现有 test-session 实例，并在自己的认证适配中复用持有的 context。项目在确认有效业务活动后调用 session.noteActivity({verifiedExtendsSession:true})；心跳入口必须真实验证；没有后台能力时恢复前检查。单个执行者/角色复用 context，换角色先关闭旧 context。不同执行者账号、数据及共享设置未隔离时保持串行。

### 项目 profile 示例

以下展示契约衔接，project 模块由目标工程实现并从私有配置或内存获取认证；任何服务调用均需对应授权。

```js
const project = require('./project-acceptance-adapter');

module.exports = async () => ({
    options: {
        projectRoot: project.root,
        deadlineAt: project.batch.stopAt,
        runtimeModule: project.runtimeModule, // optional; backend never loads it
        session: project.session,
        resourceKey: request => project.resourceKey(request)
    },
    cases: [{
        demandId: project.demandId,
        caseId: 'service-contract',
        scope: project.backendScope,
        version: project.frozenVersion,
        level: 'external-api',
        entry: 'project-service-entry',
        role: project.role,
        coverage: ['normal', 'boundary', 'independent-readback'],
        createAdapter: ({ signal }) => project.backendCase({ signal })
    }, {
        demandId: project.demandId,
        caseId: 'visible-behavior',
        scope: project.frontendScope,
        version: project.frozenVersion,
        level: 'ui',
        entry: 'normal-menu',
        role: project.role,
        coverage: ['menu', 'visible-state', 'business-readback'],
        createAdapter: ({ context, collector, apiRequest, signal }) =>
            project.uiCase({ context, collector, apiRequest, signal })
    }]
});
```

纯后端 profile 只保留第一项，无需 runtimeModule。接口不是 Broker 时沿用实际 REST/SOAP 客户端。assert 必须引用已取得的证据，不使用示例路径作为正式材料。

## UI 与证据

Playwright 默认无头 Chromium；指定已安装 Chrome 等执行文件时记录其实际版本，不宣称与 bundled Chromium 相同。headed 仅按项目明确诊断需要开启。page 操作保留正常角色/菜单，不改页面内部变量制造通过。

collector 在首导航前挂载，项目 prepare 设置目标 frame，verifyVersion 对其实际资源响应检查。runner 自动记录 pageerror/console-error 的脱敏事件；具体原文按需由项目在受保护位置保存。上下文内所有页面（含 popup）纳入监听，但无法确认归属的请求保留待复核。

context.request 与页面请求分别采集；`apiRequest(url,options)` 返回原 Playwright response，项目核验业务正文并 dispose。API 摘要不包含 URL、参数或票据。页面/API 异常及未知 frame 归属会阻止自动通过；项目可提供 reviewObservations(observations)，仅在逐事件证据支持时返回 true。该复核结果及依据由项目保留，不用统一取消白名单。

项目 close 只关闭该 case 的页面和数据；runner stop 负责 collector、context、browser 和 session。仅 cleanupVerified=true 才声明执行器退出；卡住的回调或关闭失败交接为未清理，不杀用户其它浏览器进程。

## IRIS Broker 机器调用

使用 [debugger.js](../plugins/coding-iris-plugin/scripts/iris-tools/debugger.js) 导出的 callBroker，或 `debugger.js --json --stdin`。该模式不读本地配置、不提示交互，目标配置由调用者从工程既有机制解析。JSON 输入口上限 1 MiB、30 秒；输出不含原响应或认证。旧交互 CLI 仅保留人工调试兼容，不能用于无人值守验收。

输入必含 url（完整 Broker URL，无 query/嵌入认证）、className、methodName、role、effects（read-only/write）及 effectEvidence（同 className/methodName/role/effects 和核实 reference）。write 另需 authorization，明确 write=true、同一方法/角色及授权 reference。框架只核对契约一致性，引用真实性仍由 Coordinator 验证，Get 命名不授予只读性质。

params 是标量对象，不得覆盖 ClassName/MethodName。token、cookie、ca、requestPage 在内存或 stdin 提供；夜跑调用 TLS 始终验证证书，内网 CA 通过 ca 传入。timeoutMs 默认 30000、maxResponseBytes 默认 8 MiB，断连/超限/取消不重试，写结果先回读。

可导入 API 接收 assertBusiness(body)、classifyAuthentication(body)（已确认认证拒绝返回 rejected）和 inspectResponse(body)（项目受保护证据回调）。CLI 使用 assertions 数组，每项 `{path:["字段"],equals:预期值}`，只有实际 JSON 字段匹配才通过。没有断言时状态是 transport-ok；它不代表业务通过。HTTP 200 内的认证失败按项目 classifyAuthentication 识别，不按统一业务字段猜测。

结果分别包含 transport、httpStatus、authentication、business、outcome；超时/断连等为 review-pending/unknown。返回结构通过不代表写副作用合格，项目 sideEffects 仍需独立回读。CLI 退出码：0 为业务断言通过，2 为仅传输结果，1 为失败/拒绝/未知或输入问题。

## 验证与发布

源仓合成测试只访问 127.0.0.1。已配置三平台 Node 22/24 的工具与无头浏览器 CI，实际运行结果另记。测试锁定 playwright-core，使用上游 Apache-2.0 包，详情见源仓 maintenance/testing/playwright；该目录不部署。

通过现有更新流程取得 workflows、根 scripts/*.js/scripts/lib 和 owner 插件。不自动修改项目 profile、安装浏览器、迁移私有配置或启动夜跑；旧 debugger 参数兼容，--path 为 --url 别名。真实后端/UI 需求分别在授权项目验证并重复执行，再评估准备耗时和人工介入改善。
