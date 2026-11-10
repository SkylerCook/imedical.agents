# 无人值守治理 v1 验证

源仓基线：35d8cb057bd710110df5e2af89961a94693b208f。实施仅修改框架源码与合成回归，保留本轮前的容量事件/复评边界和第三夜观察修改；没有暂存、提交、推送、同步业务副本、真实部署或真实夜跑。

## 已实现的链路

- 同一 batch/plan/run 的 executionPlan、周额度基线、双 Developer / 双 Tester、真实容量与错峰、独立工作区和角色上下文。
- 外层工作区/物理 Git 根的实体 PLAN、AGENTS 薄入口及源身份校验；原项目规则不被写穿，缺失/过期/伪造 context 阻断。
- 同类多 worktree 身份、固定基点集成、独立 post 后精确源码冻结、实际部署 targetId 对齐与共享目标窗口、前后差异及原测试层级证据复用。
- 有界浏览器 worker、跨预检/需求认证复用、接口等级与认证解耦、case/worker 分层资源、旧 owner 退出登记及恢复。
- 原生 Goal 预算回读/续轮恢复、受管客户端 token 原子分配和真实启动回执、状态/额度监督、实际 watcher challenge、源码缺失止损、分级成本报告及有意义变化提醒。
- 显式 Atelier 前端部署复用既有保护，SFTP 保留；部署只读冻结 bytes，Storage 回填需求保留源码复审。

入口与使用顺序见 [治理接入](../../docs/night-governance.md)，此处仅保留验证证据和局限。

## 验证口径

本机为 Windows、Node.js 24.14.1；部署清单另以 Windows PowerShell 5.1 执行。测试创建独立本地 Git worktree、回环 HTTP 和合成 host adapter，不连接业务系统。权限受限时使用正常宿主运行隔离夹具，测试按准确归属清理。

最终整合以 `node --test --test-concurrency=4` 运行 27 个相关测试文件，覆盖 `night-plan/governance/integration/report/quota/client/supervisor/browser-contract`、worker、旧夜跑/编排/授权/收敛、session/evidence/runner、BOS 入口及 Atelier/旧前端部署：**220 项，219 通过、0 失败、1 真实浏览器 opt-in 跳过**，约 153 秒。后续仅测试临时目录收敛，六个直接影响专项 58/58 通过。真实浏览器对照见下节，不将跳过算作通过。

收尾新增回执不可由 demand 更新伪造、固定基点/冻结旁路、反向 Tester 错峰及 worker PID 恢复绑定反例；新旧派发/冻结/工作区/分发 33/33，v2/worker 28/28 通过。报告补首个技术候选前后投入分列，成本无里程碑不推算、后续产出不抵销前期低效，报告 9/9 通过；`git diff --check` 通过。上述定向结果与整合回归有重叠，不累加为独立样本数。

Windows PowerShell 5.1 的 `scripts/tests/iris-deploy-manifest.tests.ps1` 通过；文档 `project links resolve` 1/1 通过。新测试优先 D 盘任务目录，仅权限不可用才回退系统 Codex 临时子目录，任务夹具自行核对归属并清理。

2026-10-20 提交前同步远端后，30 个受影响测试文件在 Windows / Node 24.14.1 下补验，显式启用本机真实 Playwright / Chrome：首轮 263 项中 262 通过、1 个旧部署测试失败、无跳过。失败来自旧模拟夜跑绑定缺少 manifest，未到达原本要核验的 Storage 复审分支；仅补齐该测试夹具，部署运行时代码未改。整个 deploy-direct 文件定向复验 23/23 通过，其余 29 文件的 240 项通过结果经内容指纹核验复用；不将首次失败改写为单次全绿。PowerShell 5.1 部署清单与文档链接定向检查通过。

提交验证缓存位于本仓库私有 `.git/imedical-validation-evidence.json`：保留首次失败、29 文件通过证据和部署文件复验，使用 validation-evidence 的显式 --evidence-file 读取。缓存不入仓；本轮暂存版本门禁核对 8 个变更 owner 及直接依赖，无新增问题。

已单独核实：

- 真脚本 init → 四个 worker materialize/check → next 两个 Developer 动作 → 两个独立进程实际重叠 → context ACK / completion → 事件重放 → 报告并发取证。
- 真实执行器/会话工具 → v2 预检 → API 受管 operation → 用例文件消费 → 版本/owner 校验 → stop 退出文件 → 完成门禁解除。
- 预算原子预留防双花，未知启动不能重放；启动回执/ACK 持久化失败先停止并保留归属，原生预算回读失败不启动业务 turn。
- 额度 80% drain / 100% closeout、过期/未来/倒退/窗口变化、治理预留、未知总成本、实际 Goal/turn 终态后释放未用分配。
- 新文件实际 sparse checkout，源仓测试依赖不部署；文档链接与组件依赖/版本递增。

## 真实宿主与当前限制

Codex CLI 0.163.0-alpha.10.2 的官方本机 schema 包含 Goal budget 接口；app-server stdio initialize 与 collaborationMode/list 实际握手成功。**没有执行真实 thread/start、Goal set 或模型 turn**，因此实际 token 停止、派生预算覆盖及长期监督仍待获授权项目取证。

本机已有 Playwright 1.62.1 的真实 UI 登录、导航、frame、弹窗、版本及 API 断言通过；首次 `browser.close()` 超时，独立于新 runner 的最小 Playwright 对照同样复现，Chrome/Edge 对照未消除。此前 cleanupVerified:false / pending operation 的失败事实保留。合成恢复测试证明底层操作结束后可追加新成功退出回执，不抹掉旧失败记录。后续本机原生等待链诊断及授权解除后的真实退出回归见下文。

### 浏览器关闭超时：本机共享锁阻塞已解除，原用例退出回归通过

2026-10-19 复测：Node 24.14.1 / Playwright 1.62.1，系统 Chrome/Edge 155 的最小脚本中，page/context 关闭在几十毫秒内完成，browser.close 超过 10 秒仍未完成。直接由 Windows 启动 Chrome 执行本地 dump-dom、经桌面 Shell 启动独立 Playwright，均复现退出等待；Node 立即退出对照通过。去掉 no-startup-window、禁用 GPU 均未消除。Crashpad 测试参数未实际阻止该子进程创建，不能据此排除或归因 Crashpad。

进一步临时下载官方固定 Chromium Headless Shell 151.0.7922.34（Playwright revision 1234），在 Node 24.14.1 复跑原 UI 用例，保留原 3 秒关闭断言：前置 UI/API/版本断言通过，仍在第 124 行最终 cleanupVerified 断言失败，failureStages=[browser-close]、pendingOperations=1。因此版本配套没有解决本次阻塞。日志没有进入 temporary directories cleanup，不支持将本次故障归因上游 #42109 的临时目录删除重试。

Windows 原生 GetThreadWaitChain 在两个独立测试 Chrome 的最后一个线程上返回相同等待链（IsCycle=false，未宣称循环死锁）：

```text
测试 Chrome 22244 / thread 12636，测试 Chrome 9460 / thread 46596
  -> Mutex: \Sessions\<session>\BaseNamedObjects\DictManager_DictSaveLocker
  -> git-credential-helper-selector.exe 25956 / thread 22176
  -> ALPC: \RPC Control\epmapper
  -> RPCSS 进程 1184（末端仅 PID 信息）
```

持锁者是另一客户端 WorkBuddy 的 PortableGit 凭据选择器遗留进程，本机创建于当日 10:59:54，父进程已不在；诊断时 CIM 仍可见一个等待线程，Get-Process 已无法取得该 PID。阻塞定位到本机跨进程共享锁及其外部持有者；Playwright 等不到进程关闭回执。锁的具体组件归属、持有者为何停在 RPC 仍未确定，不能仅凭 DictManager 名称认定某一输入法。[等待链字段定义](https://learn.microsoft.com/zh-cn/windows/win32/api/wct/ns-wct-waitchain_node_info)

用户随后明确授权仅终止该凭据选择器并复测。再次核对 PID 25956、可执行文件与创建时间后，通过 CIM Terminate 返回 0，并独立查询确认该进程消失；未处理输入法或 RPC 服务。保持 Node 24.14.1 / Playwright 1.62.1、系统浏览器版本及原超时标准，对照结果：

| 复测 | 结果 | 浏览器退出证据 |
|---|---|---|
| Chrome 最小脚本，两次独立启动 | 2/2 通过 | browser.close 分别 155、177 ms；原生 exitCode=0，close 事件完成 |
| Edge 最小脚本，两次独立启动 | 2/2 通过 | browser.close 分别 239、209 ms；原生 exitCode=0，close 事件完成 |
| 原 headless UI 完整用例，保留 3 秒关闭断言 | 1/1 通过，无跳过 | 登录、导航、frame、弹窗、版本、API 及最终 cleanupVerified 全部通过，受管浏览器实际退出；整条测试约 2.47 秒 |

仅解除持锁进程、保持原测试条件后恢复，完成本次直接阻塞原因的干预回归。该结果是本机合成站点的真实浏览器退出证据；不替代真实业务系统、长期 worker 或非 Windows 矩阵。早先 220 项整合回归中的 opt-in 跳过统计保持原样，本次专项结果单列。

诊断及复测创建的进程均已独立核对退出；临时下载、profile、脚本和日志均从两次独立 D 盘任务目录删除。框架运行时代码未因本次诊断改变，未放宽超时或断言。

Windows/macOS/Linux × Node 22.5.0/22/24 已加入现有 CI；本轮未取得远端 CI 或非 Windows 结果。真实 IRIS Atelier、SFTP/部署、native Goal 与最多 5 条业务试跑另按目标项目落盘 PLAN 授权，当前没有提效或订阅节省的真实对照结论。

后续明确的 P1 缺口：需求初筛后、详细 PLAN 前完成按需能力预检，浏览器路由应包含完整启停和真实进程退出；有效结果供评级、测试方案及预算引用，执行前只复核绑定、新鲜性和变化。现有 worker/v2 preflight 验证临时资源及保留 owner 的可控性，尚未自动执行独立浏览器完整启停探针；本次人工复测不宣称该启动门禁已接入。复用现有预检机制，每批一次，变化才补测，缺授权部分先记录并集中申请。

## 版本与兼容

BOS 0.10.3、coding-iris-plugin 0.20.0 及六个直接依赖 owner 的 patch/range 已同步，新增发布记录的 commit 字段标识实施源仓基线。既有安装/更新路径部署新运行时，旧 run 不迁移、无旧文件清理。全仓版本审计仍报告 xc 1.0.2/1.0.3/1.0.4 三份既有不可变历史记录缺 commit（共 6 条），本轮 8 个组件变化无新增版本/依赖问题；未修改历史记录或绕过门禁。
