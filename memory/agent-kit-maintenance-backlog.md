# imedical.agents 后续治理队列

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## 下一步工作队列

### P0：多人协作提交准入与仓库一致性检查

- 背景：仓库权限已放开给多位同事，需要把“改能力包必须同步维护约束”的流程前置，减少实现、README、插件文档、维护记忆和部署边界之间的偏移。
- 交付 1：新增短小的提交/PR 检查清单，覆盖目录、thin-index、vendor、敏感信息、README/AGENTS/manifest、维护记忆、测试和已部署工程兼容说明。
- 交付 2：复用已独立落地的组件版本 validator，在现有测试入口继续增加低误伤的通用结构检查，至少覆盖 manifest 可解析、插件 README/AGENTS/manifest 齐全、thin-index wrapper 未复制 canonical 实现，并逐步覆盖跨目录 reference 路径、反馈模板/skill 字段一致性和插件拆分后的专项测试 owner 路径。
- 交付 3：明确 canonical、插件、脚本、vendor、memory 的维护责任和必须配套的验证证据。
- `iris-cure-form-dev` v0.6.0 的 consolidation/cleanup 客户端、离线包校验和传输白名单已落地；在宣称真实服务器事务链可用前，仍需在获授权的目标工程验证 `DHCDoc.Cure.AI.CureFormDeploy` 新增 Inspect/Validate/Apply/staged/Verify/Rollback 方法，覆盖正式 RowID 内容回归、全部 Map 引用切换、灰度模板/缓存删除及 operation 回滚恢复。

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

### P3：持续观察与资产治理

- 继续观察 rules 体量；若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。
- 观察 `feedback/experience/deploy-com-exp.md` 与 `docs/deploy/*` 的复用频率，必要时抽象命名、敏感信息检查和部署工具模板。
- 明确 `demo/presentation/` 是否长期作为仓库展示资产；如需部署到业务项目，必须先更新安装/更新 sparse checkout 边界说明。
- 暂缓 macOS/Linux 跨平台支持，当前优先级为低。后续按“标准模式基础能力可用”的边界评估实施：优先覆盖安装、更新、plugin profile、thin-index 和通用 skill/agent；workspace overlay、Windows x64 IRIS MCP 等平台专属能力允许明确降级，不要求首阶段与 Windows 完全等价。已确认采用“JS-first、Node.js 为 `.agents` 工具链必装环境、OS 专属脚本例外”的策略；Node.js 不是 HIS 生产运行依赖，不整体重写现有 `.ps1`。正式启动时需完成安装器 Node.js 前置检查、经过完整回归的 Node 22 支持范围、根级 `scripts/*.js` sparse checkout、平台能力降级，以及 Windows/macOS/Linux 测试矩阵。
- `iris-cure-form-dev` 的 `preview-run` 已按 Windows/macOS/Linux Chromium 路径发现和 Linux root capability 降级实现，但当前只取得 Windows Chrome 实机证据；正式宣称 macOS/Linux 支持前，仍需在对应 runner 上执行九档 Network/Console/HISUI 集成矩阵。

## 队列维护规则

- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。
