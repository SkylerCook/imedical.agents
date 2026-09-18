# imedical.agents 后续治理队列

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## P2 技能链接适配待验证

- Windows/macOS/Linux × Node 22/24 的 runtime-skills / skill-plugin-migration CI 实跑，以及 Claude Code 和非 Windows 宿主实际发现验证；CodeBuddy 的 Windows 项目 Skills 页面已有用户确认样本，实际任务调用仍独立取证。

## 治理优先级与执行顺序

优先级按当前阻塞、潜在写入风险和依赖关系确定，不以文档排列历史决定。下表是全队列的排序入口；同级按序号推进。外部条件未满足时标记等待，继续下一项可执行工作，不绕过授权或门禁。本轮框架交付已完成，下列均为独立后续治理。

- **P0：优先解除门禁阻塞、建立当前多人维护所需的准入机制。**
- **P1：下一批验证安全边界和核心能力，形成稳定性或提效结论前必须完成。**
- **P2：按可用环境安排兼容验证与质量改进，阻塞相应兼容声明，不阻塞已验证的 Windows 使用。**
- **P3：观察、候选和新增能力；出现实际需求或可复用证据后再启动。**

| 顺序 | 优先级 | 治理事项 | 启动条件 / 责任边界 | 完成标准 |
|---|---|---|---|---|
| 1 | P0 | 信创历史发布记录纠错 | 信创维护人及版本治理负责人确定纠错方式 | 不篡改历史、不绕过门禁，当前清单与版本比较均通过 |
| 2 | P0 | 多人提交准入与仓库一致性 | 框架维护者；可在第 1 项等待期间独立推进 | 短检查清单、责任边界和低误伤结构检查落地，正反例通过 |
| 3 | P1 | MCP v1.4.2 工具与权限语义审计 | coding-iris owner；依据实际 schema 与调用语义 | 新工具分类及旧门禁影响有证据，授权拒绝与允许路径回归通过 |
| 4 | P1 | 治疗表单事务链、统一前端部署及真实宿主验收 | 指定目标工程、测试数据和明确远程授权 | 写入、回读、引用切换及回滚恢复有真实证据；HIS/WebView/设备结果分别记录 |
| 5 | P1 | 跨模型、跨宿主的前后真实对照 | 可用前沿/较弱模型及两种宿主 | 固定样本、真实轨迹和同模型对照齐全；安全通过且无新增必需步骤遗漏 |
| 6 | P1 | 通用调度框架 beta 稳定化 | 复杂 i18n、非 i18n 和 multi-session 任务样本 | 三类样本完成；异常恢复、所有权和验证失效闭环，失败样本补测 |
| 7 | P2 | 已实现能力的非 Windows / 运行时矩阵 | CI runner 与目标运行时可用 | 框架演进、sparse、部署保护、SFTP、表单预览及 AI 插件取得相应矩阵实跑结果 |
| 8 | P2 | Question 宿主交互兼容验证 | 对应宿主及权限模式可用 | 选项限制、降级与写入授权实际验证，不仅通过协议测试 |
| 9 | P2 | AI 工作站真实业务集成验证 | 明确工程、获授权的 HIS 联动场景 | 诊断卡、取消/重试、历史恢复和传统录入兼容通过 |
| 10 | P2 | 代码质量 review 与反馈机制评估 | 有真实改动和团队反馈样本 | 报告模式验证误伤率和处理效果，再决定哪些规则适合门禁 |
| 11 | P2 | 电子健康卡项目侧验收 | 对应维护人与目标工程负责；本仓不代改信创插件 | 已部署入口清理和厂家协议、双向映射取得项目证据 |
| 12 | P3 | 新通道与上游协议演进 | 实际需求或上游能力变化 | 分别评估无 SFTP 上传、原生 write 参数、快照会话与 request-id；未验证前保持现有保守路径 |
| 13 | P3 | 新增跨平台能力、知识接入与资产治理 | 平台需求或领域样本证明收益 | 明确边界后小范围试点；有证据才扩大平台能力、知识接入或公共资产 |

## 治理事项与验收细节

### 框架演进后续验收

1. **P1 · 跨模型与跨宿主真实对照**：按 docs/validation/agent-evolution.md 的固定样本，在相同代码、需求与权限下，覆盖前沿模型、实际较弱模型及两种宿主，保留前后真实执行轨迹；核对正确性、遗漏、返工、读取量与重复流程。获得同模型对照证据后才报告提效，不能用关键词测试替代。
2. **P2 · 非 Windows 平台与运行时矩阵**：执行 macOS/Linux、Node 22/24 的框架演进和 sparse 更新矩阵，保留实际 CI 结果及不支持能力的降级证据；矩阵文件存在不等于验证通过。Windows 项目普通更新已经完成，不再作为待办。
3. **P0 · 信创历史发布记录纠错**：由信创插件维护人与版本治理负责人处理 imedicalxc-doctor-extend-engineer/1.0.2 缺少 commit 的既有问题，明确不可变发布记录的纠错机制，再运行当前清单及版本比较校验。不得擅自改写历史记录或绕过门禁；交接材料见 docs/validation/agent-evolution-maintainer-handoff.md。

- **P2 · Question 兼容**使用厂商无关协议与能力降级指引，未引入厂商 SDK；专项测试覆盖协议与写入门禁，不代表已在所有 Agent 产品交互界面实测。不同工具的权限、模式及选项上限以当前调用契约为准。


- **P2 · 部署保护矩阵**：本机专项与独立真实资源验证已通过；Windows/macOS/Linux、Node 22/24 矩阵已配置，待获取 CI 实跑结果。不同后端导出格式仍按逐环境确认，未知格式不自动归一化。本轮已完成目标工程普通能力包更新；该结果不替代实际部署链路与非 Windows 验收。无后台监控、远端锁与自动回滚，本期明确不建设。


- **P2 · SFTP 已实现能力的兼容验证**：CI 已声明 Windows/macOS/Linux 与 Python 3.10/3.13 矩阵，非本机平台需等待 CI 结果；无 SFTP 的通用前端上传通道仍未实现，按 P3 另行设计，不能将 vendor 纳入视为该能力已完成。

- **P3 · 上游 MCP 原生 write 参数支持跟踪**：固定 SQL 兼容层的授权样本已通过，不再列为本轮实写阻断。后续上游补齐参数绑定后须重新验证，不能静默切换；新增实例和正常 deploy 改内容全链路另按具体任务验收。服务器 operation 审计仍由完整事务通道提供。

- **P1 · `iris-agentic-dev` v1.4.2 工具体系审计**：本轮 exe 更新后 `--no-skills` 从 67 增至 70 个工具，新增 `iris_mirror_status`、`iris_reload_pool`、`iris_system_performance`。helper 对未分类工具保持 fail-closed，三者当前均需 `--allow-write`；后续单独审计 schema、读写语义、`web_prefix` 与 v1.4.2 之前 `iris_ws_exec` 门禁缺口的体系影响，再按组件版本治理更新 coding-iris-plugin。

### 治疗表单后续验证与协议演进

- **P1 · 事务链**：`iris-cure-form-dev` v0.6.0 的 consolidation/cleanup 客户端、离线包校验和传输白名单已落地；在宣称真实服务器事务链可用前，仍需在获授权的目标工程验证 `DHCDoc.Cure.AI.CureFormDeploy` 新增 Inspect/Validate/Apply/staged/Verify/Rollback 方法，覆盖正式 RowID 内容回归、全部 Map 引用切换、灰度模板/缓存删除及 operation 回滚恢复。

- **P3 · 新协议**：旧服务端没有 request-id 幂等查询时继续采用未知写入停止、只读核实；未来服务端增加稳定只读快照会话和 request-id 查询接口后，单独版本化升级，不以客户端重试冒充幂等。
- **P1 · 真实宿主**：真正 HIS、移动 WebView、粗指针 PAD、字体缩放和软键盘验收仍由具体业务工程提供；九档或扩展 Chromium 宽度不能声明覆盖全部设备。样本细节与 operation ID 只留项目 docs/work，不写入通用框架记忆。

### P0：多人协作提交准入与仓库一致性检查

- 背景：仓库权限已放开给多位同事，需要把“改能力包必须同步维护约束”的流程前置，减少实现、README、插件文档、维护记忆和部署边界之间的偏移。
- 交付 1：新增短小的提交/PR 检查清单，覆盖目录、thin-index、vendor、敏感信息、README/AGENTS/manifest、维护记忆、测试和已部署工程兼容说明。
- 交付 2：复用已独立落地的组件版本 validator，在现有测试入口继续增加低误伤的通用结构检查，至少覆盖 manifest 可解析、插件 README/AGENTS/manifest 齐全、thin-index wrapper 未复制 canonical 实现，并逐步覆盖跨目录 reference 路径、反馈模板/skill 字段一致性和插件拆分后的专项测试 owner 路径。
- 交付 3：明确 canonical、插件、脚本、vendor、memory 的维护责任和必须配套的验证证据。

### P1：通用调度框架 beta 真实验证与稳定化

- `#6097879` 已完成第一次真实 multi-agent i18n 实战，但模式在执行中途切换、阶段时间事后重构、文件所有权未进入 manifest，且 Verifier 后仍发生代码和远程翻译修改；该样本用于暴露缺口，不作为“样板已定型”。
- `#6097891` 已从 Step 0 采用 `multi-agent`，并暴露 MCP 瞬时失败误判、阶段暂停恢复和提前 Verifier 缺口；schema 1.2 与脱敏 fixture 已将异常恢复路径机械化。
- 通用 `standard-change`、六个角色、`iris-change-agent` / `iris-change` 和 schema 2.0 调度器已进入 beta；需完成复杂 i18n、复杂非 i18n、一个 `validationSample=true` 的简单 multi-session 样本后才标记稳定。
- 失败样本必须修复并补跑同类；简单 multi-session 样本不计入 fast-path 性能结论。
- skill 提效另取后续五个简单 `iris-coding` 需求，统计补丁耗时、无效 skill 加载、子 Agent 启动收益、返工和未验收 feedback 次数。
- 工具原生配置仍不作为 canonical；当前 `codex-session` 是宿主 action adapter contract，不承诺其它工具未验证的原生 API。

### P2：代码质量 review 与框架反馈演进

- 保持 `.agents/hooks/pre-commit` 和 `check-functional-diff.ps1` 为轻量、低误伤门禁。
- 评估第二层 `check-code-quality.ps1`，先由用户或 Agent 主动运行并输出报告，不直接作为 pre-commit 强阻断。
- 优先覆盖需求无关文件、敏感连接信息、明显硬编码路径、缺少必要验证入口及已启用领域插件中的高风险点；先验证误伤率，再决定是否提升少量规则为门禁。
- 团队开始使用框架反馈机制后，观察反馈质量和处理效率；积累样本后再评估自动化 diff 和应用工具。

### 持续观察与资产治理（按优先级索引执行）

- 继续观察 rules 体量；若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。
- 观察 `feedback/experience/deploy-com-exp.md` 与 `docs/deploy/*` 的复用频率，必要时抽象命名、敏感信息检查和部署工具模板。
- 明确 `demo/presentation/` 是否长期作为仓库展示资产；如需部署到业务项目，必须先更新安装/更新 sparse checkout 边界说明。
- **P3 · 新增跨平台能力**：暂缓扩大 macOS/Linux 能力覆盖；已实现能力的矩阵取证按 P2 执行，两者不混为同一事项。后续按“标准模式基础能力可用”的边界评估实施：优先覆盖安装、更新、plugin profile、thin-index 和通用 skill/agent；workspace overlay、Windows x64 IRIS MCP 等平台专属能力允许明确降级，不要求首阶段与 Windows 完全等价。已确认采用“JS-first、Node.js 为 `.agents` 工具链必装环境、OS 专属脚本例外”的策略；Node.js 不是 HIS 生产运行依赖，不整体重写现有 `.ps1`。正式启动时需完成安装器 Node.js 前置检查、经过完整回归的 Node 22 支持范围、根级 `scripts/*.js` sparse checkout、平台能力降级，以及 Windows/macOS/Linux 测试矩阵。
- **P2 · 表单预览平台验证**：`iris-cure-form-dev` 的 `preview-run` 已按 Windows/macOS/Linux Chromium 路径发现和 Linux root capability 降级实现，但当前只取得 Windows Chrome 实机证据；正式宣称 macOS/Linux 支持前，仍需在对应 runner 上执行九档 Network/Console/HISUI 集成矩阵。

- **P1 · 前端部署链路**：业务副本同步后仍需验证统一前端入口的实际单命令部署及非 Windows CI；提交状态见维护日志，源仓提交不等于副本生效。
- **P2 · 电子健康卡项目验收**：电子健康卡 v1.0.1 修复在源仓验证后，已部署工程仍需按更新指南同步并确认旧受管子入口清理；真实厂家协议和双向映射验收留目标工程。

## P2：AI 工作站插件后续验证

- 在明确指定的目标工程试点诊断卡扩展、取消/重试、历史恢复与传统录入页兼容；真实 HIS 联动尚待授权场景验证。
- 跨平台 CI 已声明 Windows/macOS/Linux，非本机结果待 CI 执行；不把测试矩阵声明当成已通过。

### P3：项目知识接入候选（待样本评估，尚未实现）

- 先评估菜单数据与 Qoder wiki 的诊断领域样本，验证业务功能到页面、服务及源码的关联价值；不默认全量迁移。
- 若试点有效，优先复用 agent-context-kit 与现有代码图谱能力，补来源版本、按需读取和变更后待复核机制；工程资料留目标工程，领域插件仅沉淀使用方法，不绑定 Qoder。

## 队列维护规则

- 新增事项必须指定优先级、启动条件和完成标准；风险、阻塞或依赖变化时调整排序，不把所有问题都升级为 P0。
- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。
