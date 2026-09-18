# imedical.agents 维护日志

- 2026-09-18（主流程入口配置，未提交）：按用户授权补充卡片加载、主流程导航、辅助快捷按钮的职责与映射检查；快捷入口规则仅在入口存在或明确新增时适用，不硬编码补回已移除按钮，不将显示顺序当业务门槛。纳入现有待发布 AI v0.2.1，保留其它未提交修改；仅文档，未改业务公共框架、工程副本或服务器配置。

- 2026-09-18（医生站 AI 多宿主兼容，未提交）：主 skill 引用 workstation-contracts 的无 Chat 兼容约束；共享业务不依赖 Chat，刷新通知可选且失败不改变提交结果，传统回调保留，跨窗口按同源与就诊归属核对。verification 增补无 Chat、跨窗口和共享调用方隔离场景。仅指导文档变更，合入当前未提交的插件更新；未发布或同步业务副本。

- 2026-09-18（上下文偏差修复）：agent-context-kit 0.3.5 统一 contextMode 判定触发条件，已有模式的维护与优化不重复判定或落盘；coding-iris-plugin 0.13.2 在指定来源无菜单快照时返回 project-menu-missing 警告并回退共享参考，损坏/链接/完整性失败仍阻断，不触发同步。Windows Node 24 专项 16/16 通过（含新增缺失/空结果/损坏快照、standard/Overlay、sparse 和 PS7/PS5.1 thin-index），文案一致性及差异检查通过；工作区版本校验识别两项 PATCH，无新增版本问题。非 Windows/Node22 验证沿用 backlog 的 P2 矩阵事项，未宣称通过；正常更新取得修复，无配置迁移或兼容清理，未提交、推送或部署业务副本。

- 2026-09-18（待治理项优先级）：根 AGENTS 与本地维护 skill 明确每个待治理项必须标注 P0–P3，复用 backlog 既有定义，新增或调整事项时核对执行顺序、排序入口与详情一致性。本次仅补充维护规则，不调整既有事项优先级或业务部署内容。

- 2026-09-18（知识检索自主选择）：coding-iris-plugin 0.13.1 将查询选择集中到通用规则，skill 描述支持模型按信息缺口自主使用，不要求用户点名、不局限菜单定位、不固定每次必查；现有 Agent/前后端入口复用，平台 API 查询和业务知识参考分开。更新后刷新薄索引，不自动改写项目 AGENTS.md，不扩大远端授权。本轮仅修改路由文案与版本，未部署业务副本。

- 2026-09-18（知识资料并入与菜单刷新）：coding-iris-plugin 0.13.0 接收 218 份脱敏上游参考（164 份 wiki/目录、40 份菜单/安全组、14 份技术文档），记录固定来源与双 hash，排除生成器缓存。新增 iris-imedical-knowledge / iris-menu-sync，MCP 采集与离线 plan/apply 分离，项目快照原子发布、全量/部分刷新、指纹漂移阻断和历史恢复；AI 0.2.0 按需路由，五个其它依赖插件仅扩展兼容范围。资料短 ID 与 vendor .gitattributes 解决 Windows 长路径及换行校验问题。14 项专项通过，包含真实 sparse 初装/快进刷新、项目快照保留、standard/Overlay、PS7/PS5.1 thin-index；入口链接及简单 frontmatter 检查通过，通用 Python validator 缺 PyYAML。真实 IRIS 采集与非 Windows CI 待验证；未部署真实业务副本，未提交或推送。

- 2026-09-18（项目上下文编程体验优化）：agent-context-kit 0.3.3 修正 project-context-maintenance 的初始化/维护/日常优化混用，允许授权范围内语义去重与重组，初始化及优化细节改为按需 references；按工程实际开发入口、参考实现和有效验证路径选择信息，保留维护分工及配置值。同步五份上下文模板、owner 文档、更新说明与发布记录，不自动扫描插件或同步业务副本。契约检查、演进行为测试（含 Windows PowerShell 5.1 / PowerShell 7 配置合并）、薄索引 DryRun、UTF-8/引用/差异检查通过。通用 quick_validate 缺 PyYAML，使用静态 frontmatter 与实际薄索引解析检查；这不证明模型效率收益。组件版本校验识别本次 0.3.2 → 0.3.3，失败项仅为既有信创插件 1.0.2 发布记录缺少合法 commit，未改历史记录；未提交、推送或处理业务工程。

- 2026-09-17 本轮框架演进交付完成：a529e78 与 6128127 已推送；0.3.1 补丁通过真实主工程及 10 个模块普通更新复测，guidanceMode 不再追加，11 个入口迁移零变更，50 个受保护文件与 37 份配置哈希不变。用户确认本次目标完成；跨模型/宿主对照、非 Windows 矩阵及信创历史版本门禁转入独立待治理事项，不宣称这些验收已经通过。

- 2026-09-17 实测修复：profile 的 guidanceMode 改为合法可选键且不自动生成默认配置，入口迁移补齐缺失路由并保留 BOM/换行与自定义正文；agent-context-kit 0.3.1。验证结果见 docs/validation/agent-evolution.md。

- 治疗表单入口补充优化：按任务加载交付章节，复用范围内已有明确部署授权；服务端原子回滚与客户端 rollback 分开表达，运行时门禁不变。演进行为补充回归通过，迁移拒写保护、文档引用与 diff 检查通过；版本检查仍仅有既有 xc 发布字段阻塞。

本文件记录近期维护流水摘要和验证结论。长期决策见 `agent-kit-maintenance-decisions.md`，后续治理队列见 `agent-kit-maintenance-backlog.md`，入口摘要见 `agent-kit-maintenance-memory.md`。

## 近期已完成

- 2026-09-18（提交检查提速）：定位 078867b 提交轮次中版本校验耗时 548.6 秒、实际 commit 含钩子 22.9 秒。维护工具新增 `validate --staged`、独立版本证据、60 秒共享预算和阶段输出；按暂存 owner 与直接依赖校验，Git 对象改为 cat-file 批量读取并缓存。功能指纹改为 scope 实际内容，不再绑定 HEAD；隔离样本覆盖无关 HEAD、文案、实现、依赖和历史问题，以及未暂存修复与超时不放行。18/18 专项及 agent-evolution 兼容测试通过（含 PS5.1/PS7 分支），语法和差异检查通过，已记录可复用功能证据。隔离 index 重放原提交的七个 owner，加直接依赖共九个组件，首次 16.2 秒、复用 17.7 秒，均为 7 个 Git 进程；完整 ref 审计降至 13.2 秒、5 个 Git 进程，仍准确报告已登记的信创历史问题。原版耗时来自原任务日志，与本轮负载不同，不作为严格性能基准。已知问题登记为 version-debt-xc-1.0.2-commit，按用户要求普通提交不重复处理；未改历史记录和提交钩子。隔离测试及性能样本已清理，证据缓存按用途保留。Windows Node 24 已验证；三平台 Node 22/24 CI 矩阵已配置但未实跑。本轮仅本地提交，未推送或部署业务副本；agent-context-kit 变更由独立提交 e464b07 承载。

- 2026-09-18（标版需求录入闭环）：coding-iris-plugin 0.12.0 新增 iris-demand-entry 与 Node 内置模块脚本，支持实际 Git 补丁取证、默认文本、可选 --excel/--Excel、BOSS 需求号/最终标题回填及复用需求提交计划。补齐用户模式 --text/--bind/--plan/--commit/--help，--rev 区分历史来源，--same-title 显式确认原题；纳入 0.12.0 发布记录。历史来源不改写历史；不同历史提交可分别提报同一文件，工作区漂移和重复范围阻断。六个依赖插件仅递增补丁版本并扩展兼容上限至 <0.13.0。Windows Node 24 完整专项 12/12 与历史归属定向补测 2/2 通过；CLI 转交原 plan 后 HEAD/index 不变。Excel 经独立 openpyxl 读取核对原模板 29 个表头、正文、指派人对齐、文字公式安全和 ZIP CRC；thin-index DryRun、仓库 frontmatter/引用检查与 diff 检查通过。隔离测试及中断测试的遗留临时目录均已核实清理。通用 skill 校验器缺 PyYAML，未安装全局依赖。版本门禁已识别本次七个组件变更，剩余问题仅为既有信创 1.0.2 发布记录缺少合法 commit。非 Windows CI 与 BOSS 实际导入待验证；提交阶段已确认测试指纹匹配并复用，不重复运行完整回归。未推送、更新业务副本或修改个人 requirement-entry。

- 2026-09-18（技能插件化，工作区未提交）：coding-agent-adaptation 迁入 agent-context-kit 0.3.2；agent-framework-feedback 与 reusable-content-packaging 迁入新基础插件 agent-framework-evolution 0.1.0。三个原技能名的项目薄索引及运行时目录链接保持稳定，历史原文按归一化哈希迁移，自定义内容、链接及显式 available/disabled 保留；首次须执行不带插件筛选的完整 Write/Check。PS5.1 迁移专项 5/5、PS7 迁移专项 5/5 及后续自定义失效索引保护补测通过，两宿主更新器完整回归通过，运行时/演进专项 12/12、框架/编码路由专项 2/2 通过。隔离 Git fixture 验证旧更新器拉取并续跑、干净工作树、CodeBuddy 链接保留和 Overlay 本地索引；非 Windows CI 与真实宿主任务尚未验收。版本门禁识别本轮 5 个组件迁移，仍受历史 imedicalxc-doctor-extend-engineer 1.0.2 缺少 commit，以及工作区其它任务的 coding-iris-plugin 新增文件未升版本阻断；未修改这些内容，未改历史发布记录。更新说明、版本记录和维护入口同步，未提交、推送或写入业务副本。

- 2026-09-18（链接优先的技能适配）：新增根级 coding-agent-adaptation 0.1.0 与 sync-runtime-skills.js；CodeBuddy/Claude Code 项目目录链接到 ContextRoot/skills，Codex 复用通用层。安装/更新显式 RuntimeAdapter 接入，Overlay 转发到 canonical 脚本；普通目录、错误链接和越界父链均保留并阻断，legacy Claude 复制入口拒绝写入已链接目标。11 项 Node 专项、PS5.1/PS7 更新器完整回归及 Overlay 回归通过，已记录可复用指纹证据；现有项目链接只读 Check 返回 unchanged。源码、runbook、版本记录与迁移边界同步；非 Windows CI 与更多真实宿主验证仍待补齐。版本差异检查已识别新增 skill，修正本轮 release 草稿后当前清单仅剩既有 imedicalxc-doctor-extend-engineer 1.0.2 缺少 commit 的门禁，不修改不可变记录。通用 skill-creator 校验器缺少 PyYAML，且不接受本仓必需 version 字段，已改用仓库 frontmatter 与版本校验。未推送或批量部署业务副本。

- 2026-09-17（按需辅助与开放方法，本地未提交）：IRIS 入口统一按风险分流，新增 guidanceMode 的共享底线/默认方法/按需辅助；反馈 on-signal 保留用户验收和独立写入授权。调度器完成与 --final 共用门禁，写入验证绑定既有 scope 指纹和计划仓库身份；补 session 别名、未知 adapter 降级和 blocked 结果恢复。i18n 新运行协议与 bindings 对齐 2.0，旧 fixture 只读。项目入口提供默认只报告的精确句子迁移，保留用户内容与 profile；未改安装/更新算法。Node 主回归 8 项及新增恢复补测通过，PS5.1/PS7 新旧 run 回归通过；PS5.1 更新器完整回归补齐 fixture 依赖后通过，显式私有快照指纹补测通过。详见 docs/validation/agent-evolution.md。九项组件版本/依赖变更已记录，版本校验仅被既有 1.0.2 发布记录缺失 commit 阻断，不修改不可变记录。Claude 只读路由冒烟 API unknown 重试后停止，未取得模型结果；弱模型、跨宿主性能和非 Windows 矩阵未验证。未提交、推送、部署或同步业务副本。

- 2026-09-17（提交效率约定）：根 `AGENTS.md` 补充提交阶段复用审查与有效测试证据、批量独立只读检查、避免重复加载规范及按原因处理钩子失败的规则。与维护 skill 既有证据复用要求一致；仅文档改动，差异和规则一致性检查通过，不运行完整测试；本次仅本地提交，未推送。

- 2026-09-16（`iris-agentic-dev` exe 更新）：按 vendor runbook 将内置 Windows x64 可执行文件从 v1.2.6 更新到 v1.4.2；上游稳定 tag、Release 元数据、`--version`、资产长度 `51398656` 和官方 SHA-256 `BC7F41C7D0675EB8B2F481A2D276AFD98F620CDF4C409F9CB53BA7882BC90D52` 一致。同步 vendor/root README 和更新 runbook 基线；断连 `tools/list` 复核为默认 70、开启内置 skill 81 个工具，新增的 3 个未分类工具由 helper fail-closed 门禁保护，完整体系适配留入 backlog。helper 与 update-agents 回归均通过 PowerShell 7 / Windows PowerShell 5.1，版本文档一致性和 `git diff --check` 通过；组件版本校验被 HEAD 中既有 `imedicalxc-doctor-extend-engineer` v1.0.2 release record 缺少合法 `commit` 字段阻断，本轮未修改任何组件目录或 release record。

- 2026-09-16（sparse 刷新修复）：定位 Windows PowerShell 5.1 UTF-8 BOM stdin 首项模式遗漏；PS7 与 PS5.1 无 BOM 对照正常。安装、更新、旧 runtime 恢复共用 JavaScript 参数输入与落盘校验，安装器补齐 dirty 和 Git 失败停止。9 项 sparse 专项、PS7/Windows PowerShell 5.1 更新器完整回归通过并记录复用证据；同步修正 4 条过期依赖范围断言，16 组件版本校验与差异检查通过，临时文件已清理。非 Windows CI 待运行。本次提交仅包含框架修复，未推送或同步业务副本。

- 2026-09-16（维护 skill 对齐）：优化仓库本地 `agent-kit-maintenance`，按影响面选择验证，补齐脚本运行时/跨平台矩阵、canonical 降级和目标项目集成测试产物归属检查；临时清理须证明任务归属，提交须沿用明确授权并检查提交正文。同步入口摘要与长期决策；README 和 backlog 已复核，无需变更。现有 `agent-framework-contract.tests.js` 与差异格式检查通过；skill frontmatter 未改，通用 `quick_validate.py` 因本机及 bundled Python 均缺少 PyYAML 未运行成功。此次仅维护文案，不涉及组件版本、部署副本或运行逻辑，未运行完整组件测试，未提交或推送。

- 2026-09-16（本轮维护）：经用户授权直接维护 canonical：Doctor AI v0.1.2 补充入口分层、旧页面复用边界、运行时加载与控件事件、摘要语义及十类脱敏回归场景（含配置获取、生效过滤、加载与注册分层）；Coding IRIS v0.10.2 补充旧请求迁移契约检查。仅更新指导资料，不新增固定业务接口或通用测试执行器。26 项既有专项通过（含 PS7/PS5.1 thin-index），场景清单不是目标工程运行验收证据；16 组件版本校验、15 文件 UTF-8、20 相对链接与差异检查通过。本轮仅提交 canonical，未推送或同步业务副本，发布后沿既有更新流程取得资料，无配置迁移。

- 2026-09-16（工作区待提交）：coding-iris-plugin v0.10.1 修正部署 Question 兼容。新增工具无关 question 结果，统一 pause/inspect/merge/overwrite/resume 代码，明确选项/文本/普通对话/异步/非交互降级；暂停、查看、无效及过期决定保持停止。旧 action/token 兼容，未增加厂商 SDK。32 项部署与协议测试、16 项组件版本测试、16 组件治理校验及 UTF-8/语法/差异检查通过；10 个插件运行时文件同步至现有工程副本并核对一致。未暂存、提交、推送或执行远端业务部署。不同 Agent 产品的实际提问界面不在本轮实测范围。


- 2026-09-16（7a75f9b）：coding-iris-plugin v0.10.0 增加前后端共享部署保护：需求 Git 基线、隔离三方合并、跨进程覆盖记录、绑定快照的人工决定、写前复核及写后回读；源码与索引不接收服务器差异。旧后端位置参数改为显式需求/文件/执行参数，更新六个依赖插件版本范围及 patch 版本。25 项 Node 部署测试、26 项 Python vendor 测试、16 项组件版本测试及 16 组件版本校验通过，UTF-8/差异检查通过。获授权独立前端文件条件上传与后端测试类合并/回读/编译/再次覆盖停止已验证，测试资源已清理。工程运行时副本按精确文件同步并逐字节核对；更新器与薄索引 DryRun 验证，未改既有私有配置及无关提示。已本地提交，未推送或部署业务文件；跨平台 CI 尚未执行。


- 2026-09-15（本轮修复）：修正近期内容偏移。imedicalxc-doctor-extend-engineer v1.0.1 收敛电子健康卡范围、模板选择与方向映射，经主编排器架构门禁加载；manifest 的 thinIndex.excludeSkills 统一常规更新与 wrapper 的子 skill 排除策略，canonical 生成器只清理标记/来源精确匹配的受管旧入口，保留自定义文件和链接。同步插件/仓库说明、兼容步骤、短摘要与专项检查。业务副本未更新。26 项 Node 专项通过，包含 PS5.1/PS7 wrapper 与 canonical 实际调用路径；16 组件 worktree 审计通过，v1.0.0 → v1.0.1。新增 Windows CI 入口（未在本轮运行远端 CI）；组件测试临时目录改为任务隔离并自动清理，两轮已确认归属的 60 个旧测试目录经内容/边界/Git 来源校验后清理。

- 2026-09-15 状态核对：1da1b20 已提交 coding-iris-plugin v0.8.0 的 SFTP vendor、compile-csp 与统一前端部署入口，02930f5 已提交 v0.9.0 自动迁移标准 SFTP 参数；iris-cure-form-dev 当前 v0.7.2。早期日志中的“未提交/待发布”仅表示当时状态。已提交的 releases/plugin/coding-iris-plugin/0.8.0.md 含“尚未提交发布”历史文字，本次通过日志纠正，不改写不可变记录。源仓提交不代表业务副本同步或真实 HIS 验收。

- 2026-09-11（7ce2517）：CLS 能力按用户纠正收敛为 Agent 最小改动提示、模板和可选非阻断自检，撤销未提交的编译证据、回读与提交门禁；6 项格式与 CLI 自检通过。

- 2026-09-10：清理源仓 `.agents/work` 中 28 个和 `docs/work/cure-form` 中 135 个模拟测试残留，共 163 个文件移入系统临时归档以便恢复。表单集成测试增加源仓执行拒绝门禁，改为从目标项目执行，运行目录归项目 `docs/work/cure-form/framework-tests`；apply 的手动交付显式绑定该测试目录。不改业务备份、其它工作树修改或 Git index。

- 2026-09-09—10（已于 d4aa9f5 提交）：iris-cure-form-dev v0.7.0 统一项目 docs/work 产物与运行态，分离自动/手动部署和克隆/原 ID 覆盖策略，补齐预览、字段契约、独占文件集成检查及受控传输。完整 Node、PS7/PS5.1 与版本门禁通过；业务凭证留目标工程，不代表全部 HIS/设备验收。

- 2026-09-09（已于 d4aa9f5 提交）：新增显式 lightweight-sql 单模板 content 通道及 mcp-fixed-sql-binding 固定参数兼容层。NULL 安全比较、COUNT/UPDATE 同一事务及单行回滚门禁通过；最终授权样本完成原内容 UPDATE、清空、恢复及独立哈希/元数据核对。此前清空后回读失败、回滚响应丢失和 ROWS_CHECK_FAILED 是真实异常经历，已通过独立核实与专项修复收口，不改写为一次直通成功；新增实例和正常 deploy 改内容全链路仍按具体任务验收。
- 2026-09-04：补充 Windows 可选 Agent 兼容入口说明。实测开发人员模式开启时，PowerShell 7 可通过 `New-Item -ItemType SymbolicLink` 创建链接，Windows PowerShell 5.1 `5.1.26100.9168` 仍可能报 `Administrator privilege required for this operation.`，同环境 `cmd /c mklink` 成功；更新 Runbook 现优先引导使用会备份既有文件并自动回退 `cmd.exe` 的 `repair-agent-entrypoints.ps1`，同时给出仅适用于目标路径不存在时的手工 `mklink` 和验收命令，避免用 `del` / `Remove-Item` 误删独立规则文件。Windows PowerShell 5.1 下的普通文件备份、双入口创建与链接目标验证通过；PowerShell 7 / Windows PowerShell 5.1 更新器回归、15 组件 worktree 校验、16 项组件版本专项均通过。

- 2026-09-04：修正 standard 更新器的 Git 同步状态语义。fetch 后按 `HEAD...@{upstream}` 区分无更新、仅落后、仅领先和分叉：无更新报告 `agents-up-to-date`、跳过 pull 但继续 sparse 与本地生成层检查；仅落后才 fast-forward 并以 `oldHash` / `newHash` / `upstreamHash` 报告 `agents-updated`；领先、分叉、upstream 缺失或比较失败均明确停止。普通 `DryRun` 继续保持可更新 capability、只预演项目生成层的兼容契约，`Check` 与显式 `DryRun -NoPull` 用于保持 capability 不变。同步更新 README、runbook 和 PowerShell 7 / Windows PowerShell 5.1 回归。

- 2026-09-04：`coding-iris-plugin` v0.7.1 将 `iris-demand-commit` 的既有 plan/apply 能力暴露为显式 `$iris-demand-commit --plan|--commit`，并兼容 `-plan/-commit`。`--plan` 固定只生成计划和完整 commit message，不执行 pull、暂存、提交、verify 或继续追问；`--commit` 视为本地 commit 明确授权，plan 展示后直接 apply/verify，push、部署、上传和远程编译仍需独立授权。自然语言调用保持兼容，冲突或未知模式停止。同步更新 owner skill、`iris-coding` 路由、插件/根 README、AGENTS 模板、manifest 默认提示、长期决策和发布记录；未修改业务工程 `.agents`。提交状态机专项 7 项（含 plan-only HEAD/index/worktree 零修改）、组件版本专项 16 项、15 组件 worktree 校验、fast-path 静态契约、JSON/Node 语法、coding 插件 thin-index 源仓 DryRun 和 `git diff --check` 均通过。

- 2026-09-04：完成 IRIS 提效与通用 AGENT 协作调度 beta 的实现、回归和当前 `Doctor-Iris/imedical/.agents` 本地同步。schema 2.0 以互斥 `taskKind` 将业务需求与框架维护彻底分流：业务需求使用验收及只读 feedback 分支，框架维护使用 `maintaining -> locally-verified -> maintenance-complete`，`acceptance` 和 feedback 均为不适用；运行时与静态契约测试阻断跨生命周期操作。清除 `i18n-coding`、`iris-deploy` 的验收前经验直写路径。`iris-coding` 增加 fast/full/guarded 与最多两个临时只读子 Agent 的 `parallelAssessment`，fast 仍强制适用 rules、编码、测试和 diff 门禁，本地验证后不再自动加载 `iris-demand-commit`。事件/action 调度 CLI 覆盖 DAG、幂等重试、投影恢复、中心消息、独立授权、稳定 Codex 任务标题、可写 worktree owner 和待授权集成计划；六个通用角色、`standard-change`、`iris-change-agent` / `iris-change` 落地，i18n 复用同一内核，旧 schema 1.0–1.2 只读。核心 Node 合约、临时 Git 双 worktree 集成、组件治理及 PowerShell 7 / Windows PowerShell 5.1 更新与校验回归通过；部署文件与 canonical SHA-256 一致，8 个 Agent thin-index 已生成。新增 `validation-evidence.js`，按 suite/scope 记录验证证据和 worktree 指纹，提交阶段只在受测 scope 变化时补跑测试。未执行 merge、push、远程编译或部署；真实三类 AGENT 样本与五个简单 skill 样本继续进入 backlog。

- 2026-09-03：`coding-iris-plugin` v0.6.2 优化 `iris-demand-commit` 日常提交性能与消息可读性。标版提交首行新增独立 `--subject` 菜单/功能摘要，第三行继续保留完整需求；新计划用单次 porcelain v2 状态读取获得 HEAD、branch、upstream、index blob、文件模式和状态，并结合工作区字节哈希生成防漂移指纹，避免逐文件重复调用 Git。用户已明确授权时不重复暂停，`apply --verify` 可在同一进程完成提交与验证；旧计划继续按原指纹方式兼容校验，pull、精确文件提交、无关改动保留和无 push 边界不变。同一 `project local-only` 集成场景在当前 Windows 环境由超过 60 秒降至 10 秒内。

- 2026-09-03：`coding-iris-plugin` v0.6.1 与 `i18n-iris-plugin` v0.1.6 修复普通 IRIS 前端任务的跨插件 i18n 路由缺口。`iris-coding`、`iris-frontend-coding` 和前端规则以目标工程 `plugin_profile.md` 为启用事实，在修改前与最终 diff 后识别翻译 helper/key、用户可见文案及相关 HTML 属性；只有 i18n 为 `enabled` 且命中信号时才追加 i18n profile/rules，明确 i18n 需求才进入完整流程。新增只读 Node.js helper 检查器，稳定字面量 `$g` 与占位符 `$trans` 通过，动态 key、拼接与插值模板阻断；普通任务和未启用插件不额外加载 i18n。Node.js 路由/helper/i18n/组件治理 25 项、两组既有 i18n XML 专项、15 组件 worktree 版本校验、PowerShell 7 与 Windows PowerShell 5.1 完整更新回归、双插件 thin-index DryRun、JSON/Node 语法、差异格式及临时路径污染检查均通过。

- 2026-09-03：`coding-iris-plugin` v0.6.0 新增 `iris-demand-commit` 标版/项目需求提交状态机，并接入 `iris-coding` 收尾路由。计划按需求文件解析受控 GitRoot，校验方案型修改说明、HEAD/upstream/diff 指纹和计划完整性；用户明确授权后先完成全部仓库 `pull --ff-only` 门禁，HEAD 快进则停止并要求重新确认，未变化才提交精确路径，保留无关暂存/未暂存/未跟踪修改且不执行 push。标版采用三行消息，项目采用两行消息并兼容纯本地仓库。新增 `demand-delivery-type-v1`，已部署工程从明确上下文填充 `standard/project`，无法确定时写 `TODO` 并提示补全。五个依赖插件扩展到 coding v0.6.x 并做 patch 发布。提交状态机 6 项、需求类型迁移 PowerShell 7/Windows PowerShell 5.1、组件治理 16 项、两宿主完整更新回归和 coding thin-index DryRun 均通过；Skill 结构、Node/JSON 语法与 `git diff --check` 通过。

- 2026-09-02：`i18n-iris-plugin` v0.1.4 将已在医生站业务源码验证的 `DHCDoc.I18n.PageTranslationSeed` 提升为页面翻译种子 canonical 默认类，固定 `SetPageTrans` / `KillPageTrans` 单条接口与 `Load{LANG}Translation` / `Kill{LANG}Translation` 聚合命名，批次方法继续按需求编号；随插件提供 canonical ObjectScript 源模板，目标类缺失时由明确的种子实现任务创建，初始化和更新不覆盖业务源码。本地完整路径从已声明 backend SourceRoot 解析，现有兼容项目保留 profile 覆盖；旧占位值移除，字典翻译 SQL 与 XML 模板同步保持独立，远端授权边界不变。新增 canonical 默认契约专项测试通过，组件版本治理 16 项与 worktree 15 组件校验通过，i18n 插件 thin-index DryRun、JSON/Node 语法和 `git diff --check` 通过。

- 2026-09-02：复核并加固 `ea5b246` 引入的 DEV→PRD 需求移植能力。`coding-iris-plugin` v0.5.2 以 PRD 服务器导出为目标基线、DEV Git patch 为需求来源，计划目录加入 DEV/PRD 绝对路径身份避免同名仓库覆盖，冲突 `continue` 重新校验双方 HEAD 并拒绝未暂存或未跟踪状态；专项 CLI 子进程增加超时与错误收敛。补齐 v0.5.1/v0.5.2 发布记录、根总览、owner 文档和维护记忆；`i18n-iris-plugin`、`iris-codegraph`、`iris-cure-form-dev`、`iris-external-reg`、`iris-interface-dev` patch 升级并扩展 `coding-iris-plugin` v0.5.x 兼容范围。该能力只读访问 PRD 基线并修改本地 PRD Git，上传、编译、SFTP、数据库和生产部署仍需单独授权。需求移植专项 15 项、既有 export/workspace-context 2 项、组件版本治理 16 项、current/worktree 版本校验、coding 插件 thin-index DryRun，以及 `update-agents` PowerShell 7 / Windows PowerShell 5.1 回归均通过。

- 2026-08-28：安装/更新流程新增 Windows x64 `iris-agentic-dev` vendor 运行时优先收敛。`prefer-vendor-iris-mcp.ps1` 在内置 exe 存在且项目已有配置时，只更新 `.mcp.json` 中唯一识别的 IRIS MCP `command` 与既有 `project-env.json` 的 `mcp.serverPath`，保留其它 server、args、env 和全部连接字段；DryRun/Check 只报告，Write 原子替换、写后重读两份目标、失败按原始字节回滚且支持幂等，非 Windows、无配置、vendor 缺失、JSON 无效或候选歧义均保守降级。专项通过本地 Git 远端模拟已部署项目从不含收敛逻辑的旧脚本升级到新版，证明受支持更新器一次 Write 可自更新并修改两份配置、第二次 Write 字节级幂等；standard/overlay 两种部署形态均覆盖两份配置与敏感/无关字段保护。PowerShell 7 与 Windows PowerShell 5.1 完整更新回归均通过；安装器、更新器、README、更新 runbook 和长期决策已同步。

- 2026-08-28：新增 `demo/presentation/imedical-agents-team-sharing/` 组内分享 HTML 演示文稿，按“体系框架、现有能力、部署与使用实演”组织 21 页内容，并以当前 13 个插件、47 个插件 Skill、15 个受治理组件为事实快照；页面沿用根展示页的青蓝/橙色视觉语言，支持键盘、触控、URL hash、总览、讲者备注、全屏与命令复制，附带本地静态验证器。根据分享反馈，正文中的抽象术语已统一补充简短中文职责注释，附录 C 改为八项术语表，并移除封面、行动清单的整页深色变体，统一为浅底、深青文字、橙色强调的主视觉；定义页的大字号荧光底色也收敛为细橙色下划线，避免形成遮挡文字的横向色块。已在 1920×1080 全量检查 21 页布局，并在 1366×768、1280×720 抽查关键页面；浏览器 Console 无错误/警告，Network 仅请求本地 HTML。一次性临时目录中的真实 Gitee 联网安装、Windows PowerShell 5.1 `DryRun -NoPull -Detailed` 与 `Check -NoPull` 彩排通过，临时目录已清理。该演示仍是源仓展示资产，不进入业务项目 sparse checkout。

- 2026-08-27：修复 frontend encoding v3 对 backend-only Overlay 的边界遗漏。manifest 明确至少声明一个 `backend` SourceRoot 且没有 `frontend` SourceRoot 时，迁移器不再返回“缺少 frontend”阻断，而是将旧 `TODO` 双模式提示及兼容值规范化为 `N/A (backend-only)`；无法证明 backend-only 的缺失声明仍保持停止，不扫描父目录或 sibling，前端导出入口识别 N/A 后也明确停止且不写 source/staging。新增 DryRun/Write、v2 marker 替换、幂等、后续新增 frontend 后回归 `utf8`、未知角色继续阻断及导出拒绝的专项样例；模板、init skill、README、Overlay/更新 runbook 和长期决策同步，`coding-iris-plugin` 升级为 v0.4.2。PowerShell 7 与 Windows PowerShell 5.1 的迁移、编码、更新器和 thin-index DryRun 均通过，16 项组件版本专项与 15 组件 worktree 校验通过。

- 2026-08-26：按标版前端编码正式变更，将 coding-iris 前端源码、上传内容和服务器运行编码统一为 canonical `utf8`。frontend encoding v3 迁移在实际字节为 UTF-8 或纯 ASCII 时，将旧 `project-utf8` / `standard-gb2312` profile 规范化为 `utf8`；真实 GB2312、mixed、UTF-16 或 unknown 保持阻塞，不自动转码业务源码。当前导出与部署直接使用 UTF-8 源文件，GB2312 检查、转换和 promote 仅保留为用户明确指定历史工程的兼容路径；coding/i18n rules、skills、模板、README、更新 runbook、展示页和专项测试同步更新。`coding-iris-plugin` 升级为 v0.4.1，`i18n-iris-plugin` 升级为 v0.1.2。PowerShell 7 与 Windows PowerShell 5.1 的编码、迁移、更新器和双插件 thin-index DryRun 均通过；Node 导出测试、16 项版本治理专项、15 组件 worktree 校验、manifest JSON、语法、差异格式和临时路径污染检查通过。

- 2026-08-25：完成 `iris-agentic-dev` v1.2.6 体系适配。根 helper 显式分类断连 `tools/list` 复核的完整 78 工具集，默认 `--no-skills` 暴露 67 个工具，并保留 `IRIS_NO_SKILLS=false` 显式开启路径；新增多实例、跨环境比较、持久会话、Global preview/kill、namespace/database、journal/audit、HL7、Mermaid 和 Storage 等安全边界，`check_config` 摘要补齐 server/IRIS 版本和破坏性工具状态。官方 vendor skills 刷新到上游 tag v1.2.6 固定提交 `c54ae583eddc36350e5a155246153dadf843cfc7`，8 个 `SKILL.md` 与 MIT LICENSE 逐个匹配上游 Git blob，新增 optional `objectscript-tdd` 并由本地规则约束编译、测试和 session fallback。`coding-iris-plugin` 升级为 v0.4.0；5 个依赖插件只扩展 v0.4.x 兼容范围并做 patch 发布。PowerShell 7 与 Windows PowerShell 5.1 下的 MCP helper、lookup、update-agents、治疗表单和接口专项均通过；workspace 配置双向 skill 开关、16 项组件版本测试、worktree 版本校验、vendor/插件 thin-index DryRun、Node 语法、`git diff --check` 和临时路径污染检查通过。

- 2026-08-25：按 vendor 更新 runbook 将内置 Windows x64 `iris-agentic-dev.exe` 从 v0.9.3 更新到 v1.2.6；GitHub Release 资产大小为 `50178048` 字节，仓库目标 SHA-256 为 `BACE5848F29A6AEAE585D813669FEBDF60A4EBC5ED3FC8ADE1F60BCC6C65BB09`，与官方 digest 一致。同步更新 vendor README、根 README 和 runbook 基线示例；MCP helper 在 PowerShell 7 与 Windows PowerShell 5.1 下均通过，`update-agents` 两种宿主回归通过，组件版本治理 15 项校验与 16 项专项测试通过。v1.2.6 完整 MCP 工具/参数/协议变化不在本次 exe 更新范围内，已进入治理队列。

- 2026-08-21：`iris-cure-form-dev` 升级为 v0.6.0，明确新开发表单直接创建正式模板且不进入灰度流程；只有现有模板改造使用灰度，单 Map 独占模板通过 `consolidate`、多 Map 共用模板通过 `consolidate-shared` 回归正式 RowID，完成门禁要求 `VerifyOperation`、全部 Map 回读、灰度引用数为 0 及灰度模板/缓存不存在，`cleanup` 仅处理零引用孤儿模板。客户端补齐共享合并包的一对一、RowID 集合不重叠、Map 唯一、组成精确替换和灰度来源覆盖校验。`coding-iris-plugin` 升级为 v0.3.1，将 Overlay 编译路径解析抽离为可测试模块，修复 `backend/src/...` 被错误编译为 `src.*.cls`；README、AGENTS、owner skill/rule/reference、manifest、release record、根总览和专项测试同步。治疗表单、Overlay 部署清单与 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，Node 语法、16 项组件版本专项、worktree 版本校验、两个插件 thin-index DryRun、差异格式、BOM 和临时路径污染检查通过；真实 IRIS 服务端事务与回滚验证仍需在目标工程获得单独远端授权后执行。

- 2026-08-20：`iris-cure-form-dev` 升级为 v0.5.0，将主执行链和 persistent staged transport 的固定事务类迁移到 `DHCDoc.Cure.AI.CureFormDeploy`，不新增 profile 类名配置，也不保留旧类 fallback；README、owner 文档、部署 rule/skill/reference、更新 Runbook、根总览、breaking 发布记录和类名防回归门禁同步。目标实例只读审计确认新旧类均已编译、服务器源码从方法体起完全一致，新类服务器源码与本地文件一致；`InspectInventory` 及四组无写入错误路径返回逐字相同的合法 JSON。Node 语法、插件专项和 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，组件版本治理 16 项专项与 breaking worktree validator、两种宿主 thin-index DryRun、旧类残留、差异格式和临时路径污染检查通过；删除旧类仍须等待业务项目更新到 v0.5.0 并确认无旧调用方。

- 2026-08-19：修复 standard 工作区从旧 sparse checkout 跨版本更新时的 `WorkspaceContext.psm1` 自举死锁：旧进程即使拉取了新版脚本，仍可能用内存中的 `/scripts/*.ps1` 清单遗漏 `scripts/lib/**`；新版更新器现会在自更新恢复、`Write` 或允许拉取的 `DryRun` 中，先验证干净的独立 capability Git checkout 并收敛当前完整运行时 sparse 清单，再加载 resolver。`Check` 与显式 `DryRun -NoPull` 保持只读，失败状态明确停止。新增真实 Git sparse 回归覆盖“只读不修复、恢复后模块落盘及规则持久化”，README 与更新 Runbook 同步；`update-agents` 回归通过 PowerShell 7 和 Windows PowerShell 5.1，组件版本治理 15 项检查、16 项 Node 专项、差异格式与临时路径污染检查通过。

- 2026-08-19：完成插件与根级独立 skill 的源仓版本治理基线：13 个插件保留现有严格 SemVer，2 个独立 skill 从 `0.1.0` 起步，插件内部内容统一继承 owner 版本；新增不可变 `releases/plugin|skill/<name>/<version>.md`、旁路 `dependencyVersions` 和维护者专用 Node inventory/validate/compare 工具。`iris-cure-form-dev 0.4.0` 以 `c79055e` 建立真实 breaking minor 记录，其余组件建立一次 baseline。版本工具不接入 install/update、thin-index、业务 hook 或 sparse checkout；16 项 Node 专项、真实仓库 15 组件 bootstrap 校验以及 `update-agents` PowerShell 7/Windows PowerShell 5.1 回归通过，三个现有部署/更新入口保持无差异。

- 2026-08-19：`iris-cure-form-dev` 升级为 v0.4.0，新增 `interaction-prepare` / `interaction-check` 的新表单人工交互门禁：部署前清单从 numberbox、选择控件、计算与显隐规则生成必测骨架，并固定覆盖单位/左右侧去重；`user-attested` 接受用户明确总体通过，`agent-manual` 强制逐项实际结果，`automated` v1 直接拒绝。`expectedVersion=NEW` 的 package 必须携带与 approved spec、snapshot、changes、preview verification/manifest 哈希绑定的交互凭证，存量响应式改造保持兼容；部署后清单绑定 package/operation ID 并覆盖 CA/CR 保存、重开、回显、打印及 CR 运行时契约，失败不自动回滚。专项和 `update-agents` 回归通过 PowerShell 7/Windows PowerShell 5.1，Node 语法、两种宿主 thin-index DryRun 与差异检查通过；测试只验证报告和门禁，不执行自动浏览器交互。

- 2026-08-19：`iris-cure-form-dev` 升级为 v0.3.2，将完整预览提升为 gate v2：新增 Node 内置模块实现的跨平台 `preview-run`，通过仅绑定 `127.0.0.1` 的临时服务和 Chromium CDP 自动采集九档 Network、Console、HISUI panel/radio 与溢出结果；`preview-check` 拒绝旧 gate、缺少 canonical runner 来源或 manifest 后编辑完整 HTML 的凭证。六类资源和递归 CSS `url(...)`/`@import` 依赖现均复制、记录 SHA-256 并纳入部署凭证，新 profile 默认从 `.agents/vendor/hisui/` 解析 HISUI/jQuery/locale。`common-migrate` 的优先 MapCode 与公共模板 RowID 已迁入目标工程 `cure-form-common-migration-config/v1` 并绑定配置哈希，canonical 不再保存业务种子。插件专项与 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，五个变更 skill 通过 UTF-8 validator，两种宿主 thin-index DryRun、真实 Chrome 九档 gate 与 Playwright 独立 Network/Console/探针核验通过；macOS/Linux 实机矩阵仍留在 backlog。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.3.1，将旧 WebView radio 拆行故障回归 canonical：完整配对明确为 `input.hisui-radio.radio-f + label.radio + label.i-label-box/m-label-box` 且 `for/id` 一致；缺少 `:has()` 的旧内核可在目标工程内做包含 input 的幂等原子包装，以保持 HISUI 邻接、事件和保存协议。插件仅固化兼容契约与完整配对机器门禁，不携带业务 CSS/函数实现；现代 Chromium 与旧 WebView/真实触控证据继续分开验收。插件专项和 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，skill、Node 语法及两种宿主的 thin-index DryRun 通过。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.3.0，新增 canonical `preview` 与 `preview-check`：从目标 profile 或现有页面解析并复制 HISUI CSS、jQuery、HISUI JavaScript、中文 locale、`asscom.css`、`adaptation.css` 六类资源，完整 HTML 缺资源立即停止；页面内置浏览器探针，九档结果验证资源请求、`jQuery`/`$.parser`、panel、radio、溢出和运行时错误，并形成与 snapshot、changes 和资源清单哈希绑定的凭证。任何带 changes 的 `plan` 现在必须提供通过的 `preview-verification`，最终包另校验计划 changes 哈希；README、owner 文档、profile 模板、更新 runbook 和专项测试同步。

- 2026-08-18：补记根 `scripts/iris-mcp.js` 的大体积工具参数能力：`call` 支持以 `--json-file` 读取最多 8 MiB 的 UTF-8/BOM JSON，并继续复用既有默认拒绝写入与 `--allow-write` 授权门禁；`iris-mcp-helper.tests.ps1` 已覆盖文件参数解析和帮助入口。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.2.5，新增显式 `aggregateTemplateInit=true` 宿主兼容模式：当目标 HIS 不可靠调用分模板 `Init` 时，由 Map 总入口在 DOM ready 和宿主缓存恢复之后延迟、幂等调度实际存在的业务模板模块；默认模式仍保留宿主生命周期所有权，无逻辑模板不生成也不调用空壳 JS。专项回归覆盖仅调用业务模块、跳过空模板及延迟初始化门禁。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.2.4，文档驱动的新表单默认从业务项目 `docs/` 发现医院 Word/PDF/Excel 需求，并将规格、摄取报告和生成源码写入 `docs/cure-form/<moduleId>/`，废弃插件内 `src-iris` 默认约定；多个候选文件必须显式传入 `--source`。服务器快照与部署临时数据继续隔离在 `.agents/work/`，专项测试覆盖默认目录与多候选停止门禁。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.2.3，补齐表单总入口的运行时与部署双路径契约：`scriptHref` 写入 Map“引用JS”，`scriptDeploymentPath` 仅描述静态资源落盘位置，二者 basename 必须一致；`loadMode=host` 缺少任一路径时停止。模板继续仅在确有业务逻辑时保存各自 `javascriptHref`，无逻辑模板清空旧内联引用，专项测试覆盖 Map 外部入口与模板外链分离。

- 2026-08-18：将真实手机/PDA 已验证的 HISUI radio 响应式兼容约束回归 `iris-cure-form-dev`：同时覆盖原生 `label.radio` 与业务 `i-label-box` / `m-label-box` 配对、普通布局和表格单元格、点击同步、选中态及旧 WebView 原生 fallback；插件只保存兼容契约与离线回归，不复制业务工程公共 CSS。专项测试继续验证响应式转换不改变 radio DOM/`name/value`，部署保持默认 dry-run，远端校验只走 `ValidatePackage`，写入仍需显式确认后调用 `ApplyPackage`。

- 2026-08-17：`iris-cure-form-dev` 升级为 v0.2.2，部署计划新增 `--approved-clones` 公共模板幂等复用：按来源 RowID 将已批准版本转换为 `referenceOnly`，并记录 `commonTemplateReferences[]`，防止多个 CA/CR Map 重复克隆同一公共模板；创建流程支持获批 `fragmentHtml`/`javascript` 覆盖，强制校验根容器、响应式 class、字段 ID/缓存标签、模块接口和语法，独立预览按序加载并初始化全部子模板。专项测试覆盖上述复杂多模板生成、已批准模板复用与未批准模板继续版本化克隆。

- 2026-08-17：`iris-cure-form-dev` 升级为 v0.2.1，新增 `cure-form-template-boundaries/v1` Excel 多模板摄取：保留格式化/非空范围、合并层级、公式、单位维度与规则候选，范围重叠进入 `TEMPLATE_RANGE_OVERLAP`，合并单元格被边界截断进入 `TEMPLATE_MERGE_SPLIT`；审批后按顺序生成独立 fragment、JavaScript 和 Map composition changes。同步补齐候选字段/标识符审批门禁、`common-responsive` 快照版本化克隆实现、插件文档，以及 PowerShell 7/Windows PowerShell 5.1 的插件专项、业务孵化和 `update-agents` 回归。

- 2026-08-14：新增 canonical `iris-cure-form-dev` v0.1.0，限定 CA 治疗评估与 CR 治疗记录，空 `MapType`/病理模板强制排除；复用 `extract-doc/structure-v1` 和 `coding-iris-plugin`，提供规格适配、CA/CR 生成、现有与公共模板响应式改造、人工批准门禁、dry-run 部署包、验证及回滚编排。`extract-doc` v0.2.0 增加通用 `--emit-structure`，保留原 `extract-doc/v1` 输出兼容；专项测试覆盖 CA/CR、响应式契约、扫描 PDF 门禁、病理排除和 Windows PowerShell 5.1。
- 2026-08-14：修复 workspace overlay 未生成模块本地 `.agents/scripts/iris-mcp.js` 的部署缺口。initializer 新增 manifest-aware JS runtime adapter，从 `capability.json` 解析 `CapabilityRoot`，保留调用工作目录、参数和退出码并转发到 canonical helper，不复制实现或写死绝对路径；更新 README、overlay/update Runbook、长期决策和维护摘要，并为 adapter 生成、路径独立性与 `--help` 转发补充回归测试。
- 2026-08-12：完成 workspace overlay framework：新增 schema 与 PowerShell/Node context resolver、安全 Junction initializer、standard/overlay 双模式安装更新、ContextRoot/CapabilityRoot 分离的 plugin/agent/vendor thin-index 和 runtime adapter；manifest 强制 `workspace-overlay` 模式并限制 ContextRoot、SourceRoot、shared/local 路径边界，ContextRoot 既有父链不得经过 reparse point，`-Repair` 仅处理 ContextRoot 内受管 Junction，模块 adapter 补齐 Claude Code skill 同步、Git hooks 安装和 Agent 入口修复。coding-iris 前端编码迁移限制到声明的 frontend SourceRoot，IRIS 工具统一读取 workspace context，部署清单支持多 GitRoot 并保留逻辑路径来源。README、overlay/update Runbook、agent-context-kit、coding-iris owner 文档和专项测试同步；PowerShell 7 五组、Windows PowerShell 5.1 四组、Node 两组框架门禁均通过。
- 2026-07-24：收敛 `iris-interface-dev` 唯一实现路径为 `iris-interface-dev-plan -> iris-interface-build -> coding-iris-plugin 编码规则/部署能力`；同步修正 dev-plan、init skill、接口 profile 模板并增加专项防回归断言。插件 canonical 名称仅使用 `iris-interface-dev`，不保留旧名称兼容契约。
- 2026-07-23：审计并修复 `608fe86`、`e94fe48` 引入的框架偏差。`iris-interface-dev` manifest 增加旧名称迁移，更新器保留旧 plugin profile 状态并支持旧名称显式选择，plugin thin-index 增加 stale skill 清理，接口 profile 仅迁移旧默认输出目录；README、runbook、owner 文档和专项测试同步。性能分析插件移除 Graylog 私有环境标识和 Claude Code 专属权限配置，统一为“只读 MCP 优先、HTTP 需用户明确授权、Web UI 人工兜底”。`iris-interface-plugin.tests.ps1`、`perf-analysis-plugin.tests.ps1`、`update-agents.tests.ps1` 均通过 PowerShell 7 与 Windows PowerShell 5.1；两个插件的 thin-index 在 Windows PowerShell 5.1 下 `DryRun` 通过，10 个 plugin manifest 可解析，敏感环境标识扫描和 `git diff --check` 通过。
- 2026-07-23：将维护者专用 `agent-kit-maintenance` 从根 `skills/` 迁入源仓 `.agents/skills/`，正式区分“随能力包部署的通用 skill”与“只服务源仓维护的本地 skill”；根 `.agents/` 现仅承载受版本控制的仓库本地 Agent 上下文，不加入业务项目 sparse checkout。安装/更新脚本移除已无必要的专项目录排除，继续兼容清理业务项目历史残留，并保护从源仓根脚本执行时的本地维护 skill。
- 2026-07-23：完成 `iris-agentic-dev` v0.9.3 MCP 体系跟进：根 `iris-mcp.js` 改为按工具 `mode` / `action` 精确区分读取与状态变更，补齐 `iris_doc insert/delete_lines`、`iris_query write/force`、`iris_global set/kill`、`iris_execute_method`、容器/SCM/Production/lookup/skill/KB、`iris_test` 和 `iris_coverage` 等授权门禁；`check_config` 摘要新增 connection source、workspace hint、fallback warning 和 capabilities，并取消仅凭 `USER` / `52773` 阻断工具发现。coding-iris 规则、README、更新 runbook、长期决策和专项测试同步；`iris-mcp-helper.tests.ps1`、`iris-mcp-lookup.tests.ps1`、`update-agents.tests.ps1` 均通过 PowerShell 7 与 Windows PowerShell 5.1，plugin thin-index 在两种宿主下 DryRun 通过，Node 语法、`git diff --check` 和字面 `%SystemDrive%` 路径污染检查通过。
- 2026-07-23：为 `coding-iris-plugin` 新增 `iris-mcp-lookup` skill、`iris_knowledge_lookup.md` rule 和官方文档路由 reference，统一当前实例元数据、本地源码、官方文档三类知识源；明确 MCP 只走 `iris-agentic-dev`、默认只读、工具可用性先以 `tools/list` 为准，并支持直接 `Fetch` DocBook URL。
- 2026-07-23：从 `intersystems-community/iris-agentic-dev` v0.9.4 固定提交 `568a0e03cb5bdfae6870973a73d1d4d86ae42ab9` 引入 `objectscript-review`、`objectscript-guardrails`、`objectscript-sql-patterns`、`objectscript-list-patterns`、`objectscript-navigation`、`objectscript-unit-test`、`objectscript-debugging` 七个官方 skill；保留 MIT LICENSE 和上游原文，manifest 声明为 optional vendor 依赖，避免默认 thin-index 污染。官方 `iris-docs` 因内含固定 Algolia key 且与本次 URL Fetch 路由冲突未原样引入，由本地安全适配入口承接。
- 2026-07-23：验证 `iris-mcp-lookup` canonical skill 通过 `quick_validate.py`；专项测试和 `update-agents.tests.ps1` 均通过 PowerShell 7 与 Windows PowerShell 5.1。内置 v0.9.3 本地 `tools/list` 返回 52 个工具并包含 `iris_doc_search`；给定 `GGBL_structure` DocBook URL 已实际读取到 “Formal Rules about Globals” 页面和 IRIS 2026.2 版本信息；7 个 vendor skill 逐个匹配固定上游 Git blob，敏感 key 扫描和 `git diff --check` 通过。
- 2026-07-23：已将内置 Windows x64 `iris-agentic-dev.exe` 从 v0.6.20 更新到 v0.9.3，并同步 vendor 更新 runbook 示例、`vendor/iris-agentic-dev/README.md` 的当前版本、官方 Release 下载地址和仓库 README 版本引用；业务项目仍通过 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe` 获取可执行文件，连接事实继续只保留在目标工程本地配置。
- 2026-07-18：审计并闭环 `ca310db` 及其基线中的框架上下文偏差：将 HISUI 控件/API 与样式/资源索引同步到仓库总览和维护入口，修正 reference 跨目录路径及源仓/部署态 vendor 路径；反馈 `260718022936` 已标记为“已应用”并补齐问题发现过程和处理记录，根反馈模板与共享协议保持一致。
- 2026-07-18：修复 `extract-doc` 拆分后的专项测试 owner 漂移：`iris-interface-plugin.tests.ps1` 现从 `plugins/extract-doc/` 读取 requirements、环境检查和 parser，并显式传入接口输出目录及 `iris-interface-doc-ingest/v2` schema；同时恢复 ObjectScript 复合后条件正反例，使 `update-agents.tests.ps1` 与 owner rule/skill 一致。
- 2026-07-18：补齐 `e1e5761`、`621b633` 后遗漏的能力说明。`extract-doc` 承接通用文档解析，现名 `iris-interface-dev` 保留接口语义适配；`iris-external-reg` 提供第三方预约挂号接口开发编排并显式依赖 `extract-doc`、`coding-iris-plugin`。README、更新 runbook、插件接入说明和 targeted 回归已同步。
- 2026-07-15：基于 `#6097891` 将 agent-run contract 升级到 schema 1.2：新增 stage attempts、MCP capability matrix、远程动作终态、finalization 门禁和限定 verification scope；validator 保持 1.0/1.1 兼容，并新增暂停恢复、终态冲突、非终态远程动作、attempt 重叠及验证范围回归。同步修正 MCP 判定为 `check_config` 后执行 `SELECT 1 AS Probe`，自动发现成功时不因 `config_file=null` 阻塞，单次 404 不再扩大为整个 MCP 不可用；`iris-mcp.js` 已纳入安装/更新 sparse checkout。
- 2026-07-14：审计最近两次 feedback 提交。确认 `3131d97` 的 `FRAMEWORK_ROOT` 部署态路径修复已同步 canonical；将 `fc50477` 仅保存在反馈包中的 i18n Step 0、manifest schema 1.1、文件所有权、stale verifier、分类远程授权和 Windows PowerShell 5 兼容规则回归 canonical，并同步 owner 文档、P1 验证说明和专项测试。
- 2026-07-13：完成 `#6097879` 首次真实 multi-agent i18n 实战复盘。实战覆盖前后端、页面翻译、XML 模板、独立 Verifier 和运行 manifest，但发现模式中途切换、阶段时间事后重构、所有权未入 manifest、Verifier 后继续修改、远程授权询问过晚及 Windows PowerShell 5 环境变量兼容问题；P1 保持开放，不据此新增通用 workflow/Agent。
- 2026-07-13：`12e8539` 建立 `i18n-agent` P1 多模式运行协议：统一 `retrospective` / `serial` / `multi-agent`、编号 handoff、运行 manifest、授权和失败收敛规则；新增 `validate-agent-run.ps1` 及离线测试，并完成 `#6096150` 脱敏串行回溯。该回溯只证明串行与事后校验链路，真实多智能体实战仍留在 backlog。
- 2026-07-13：`98b09e6` 为 XML 打印模板同步补充临时类 `Execute+...<SYNTAX>` 自动识别与 Base64 分块 fallback，复用既有本地产物并在成功或失败时清理临时节点；专项离线测试覆盖内联成功、单次收敛、分块计数和失败清理。
- 2026-07-13：`7478f85` 将 `agent-framework-feedback` 升级为统一收尾 skill，分流需求经验与独立框架修正，并将收尾入口写入项目 AGENTS 模板；本轮维护同时修正共享反馈协议仍默认提交/推送的旧表述，统一为仅在用户明确要求时执行 Git 写操作。
- 2026-07-13：完成全仓维护体检：8 个插件 manifest 均可解析，现有 7 组专项测试全部通过；补齐 `imedicalxc-doctor-data-extraction` 和 `imedicalxc-doctor-print-template-design` 插件 README，修正维护记忆分层，并将后续治理队列重排为 P0-P3。
- 2026-07-13：修复 `update-agents.ps1 -Mode Check` 将不受支持的 `Check` 直接传给插件配置迁移脚本的问题；顶层 `Check` 现按只读语义映射为迁移 `DryRun`，并补充 `DryRun/Write/Check` 参数传递、unchanged 状态及 Check 不写 profile/thin-index 的回归覆盖。
- 2026-07-13：已将 vendor skill 链路改为按 enabled 插件 capability 解析：新增通用依赖 resolver，`imedicalxc-doctor-extend-engineer` 声明四个 required superpowers skill 和 DOC/DOCX 触发的 optional `word-reader`；安装/更新停止全量写用户目录，项目层只生成 required thin-index。更新器支持自身更新后安全重启、legacy profile 保守识别和显式 cleanup；Claude/Codex 用户级同步改为必须指定 runtime/skill，其他 Agent 工具通过 `.agents/skills` 或直接 vendor 源串行降级。
- 2026-07-11：已实现 coding-iris 前端编码 v2：新增 `standard-gb2312` / `project-utf8` 双模式和可选路径覆盖，实际文件字节检测作为最终门禁；新增 profile 自动迁移、已部署编码脚本 wrapper 迁移、严格 GB2312 转换、医院 UTF-8 直接导出与标版 staging 流程，并将插件迁移钩子接入 `update-agents.ps1`。coding/i18n rules、profile 模板、README、更新 runbook 和专项测试同步更新。
- 2026-07-09：已同步 2026-07-07 五个提交后的 vendor/skill 发现链路维护说明：`README.md` 和入口维护记忆已将“vendor 不参与 thin-index”旧表述替换为当前真实行为，即 `sync-vendor-skills.ps1` 同步 vendor skill 到 Claude Code 运行时目录并在存在 Codex skill 目录时覆盖 Codex，`generate-vendor-thin-index.ps1` 为 vendor skill 生成 `.agents/skills/<name>/SKILL.md`，`sync-claudecode-skills.ps1` 将项目 `.agents/skills/` 同步到项目 `.claude/skills/`。本轮同时修复 `generate-vendor-thin-index.ps1` 在 Windows PowerShell 下中文字符串解析失败的问题，并将 `scripts/tests/update-agents.tests.ps1` 改为复制真实脚本、覆盖 vendor thin-index 生成与 stale 清理、vendor runtime skill 三层去重和 Claude Code skill 同步阶段。该链路属于 skill 发现层适配；完整 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/` 等工具原生 agent adapter 仍未实现。

- 2026-07-08：已新增提交前差异降噪 Git hook 分发链路：新增 `hooks/pre-commit`、`scripts/check-functional-diff.ps1` 和 `scripts/install-git-hooks.ps1`，安装/更新 sparse checkout 纳入 `/hooks/**`，`update-agents.ps1` 仅报告 `git-hooks-not-enabled` / `git-hooks-enabled` / `git-hooks-unavailable`，不自动修改业务项目 `core.hooksPath`。`docs/update-agents.md`、README、`project-context-maintenance` 和测试已同步。

- 2026-07-08：已修正维护者专用 `skills/agent-kit-maintenance/` 实际部署残留问题：`install-agents.ps1` 和 `update-agents.ps1` 的 sparse checkout 同时排除目录和目录内容；`update-agents.ps1 -Mode Write` 会兼容清理已部署项目中的 `.agents/skills/agent-kit-maintenance/` 并报告 `maintenance-only-skill-removed`。`docs/update-agents.md` 和 `scripts/tests/update-agents.tests.ps1` 已同步，更新脚本回归测试已通过。

- 2026-07-13：已修正 `coding-iris-plugin` 对 ObjectScript 命令后条件的空格约束：明确命令、冒号和完整复合条件必须连续书写，新增 `continue:(cond1)&&(cond2)` 正例与 `continue:(cond1) && (cond2)` 的 `#1012` 反例，并将检查项同步到后端 skill、插件 README 和专项回归测试。

- 2026-07-01：已修正 AI 落地项目安装入口闭环：README 不再要求首次安装前读取尚不存在的 `.agents/docs/update-agents.md`，而是先按 `.agents/` 状态分流并给出明确网络安装命令；`install-agents.ps1` 在业务项目缺少 `AGENTS.md` 时改为提示而非阻塞，`update-agents.ps1` 将 `agents-entry-missing` 降为后续项目上下文维护提示；`docs/update-agents.md` 和 `scripts/tests/update-agents.tests.ps1` 已同步。

- 2026-07-01：已补齐近期医生站能力插件维护记录和仓库 README 总览：新增 `imedicalxc-doctor-perf-analysis-engineer`、`imedicalxc-doctor-data-extraction`、`imedicalxc-doctor-print-template-design` 三个插件的能力摘要、入口和部署边界说明；同步记录 install/update Git 版本前置校验。上述插件仍遵循 `.agents/plugins/**` 全量拉取但以 `plugin_profile.md` 控制启用的边界。

- 2026-07-01：已新增维护者专用 `skills/agent-kit-maintenance/SKILL.md`，用于本仓库维护、插件提交同步、维护记忆更新和部署边界检查；该 skill 位于根 `skills/` 下，但安装/更新 sparse checkout 已排除 `skills/agent-kit-maintenance/`，不部署到业务项目 `.agents/`，不参与 thin-index。根 `AGENTS.md`、README、维护入口摘要和长期决策已同步说明。

- 2026-06-30：已完成近期提交文档同步：维护记忆、长期决策、backlog、仓库 README、`imedicalxc-doctor-extend-engineer` README/AGENTS 和主编排器 superpowers 缺失指引已同步到当前实际内容；补齐 `scripts/tests/update-agents.tests.ps1` 对 `sync-vendor-skills.ps1` 的测试夹具复制，避免 vendor skill 同步脚本缺失误触发 Action required。

- 2026-06-29：已完成 `imedicalxc-doctor-dbdata` 精简治理：`SKILL.md` 从大体量数据库查询规范收敛为核心领域知识入口，删除通用编码规范、输出模板和反模式长文，保留并强化医保对照、基础数据统一对照和合并查询（Merge Query）；医生站扩展主编排器补充合并查询快速参考，架构 skill 同步配置数据和合并查询引用。
- 2026-06-26：已完成 vendor skill 运行时同步链路与医生站扩展插件标准化：新增 `scripts/sync-vendor-skills.ps1`，`install-agents.ps1` / `update-agents.ps1` 可把 `vendor/superpowers/`、`vendor/word-reader/` 等 vendor skill 同步到运行时 skill 目录；`imedicalxc-doctor-extend-engineer` 迁入标准插件结构并补充 `AGENTS.md`、README、manifest 和 thin-index wrapper。
- 2026-06-26：已收敛 `imedicalxc-doctor-extend-engineer` thin-index 策略：wrapper 默认排除 8 个子 skill，只暴露 `imedicalxc-doctor-extend-engineer` 主编排器入口；子 skill 由主编排器通过插件内相对路径按需读取，避免浅层 skill 路由噪声。
- 2026-06-25：已新增信创版本医生站第三方接口开发智能体资料，后续重构为 `imedicalxc-doctor-extend-engineer` 插件标准目录。
- 2026-06-24：已更新内置 Windows x64 `iris-agentic-dev.exe` 到 v0.6.17，业务项目仍通过 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe` 获取可执行文件，连接事实仍只允许留在目标工程本地配置。
- 2026-06-24：已完成当时名为 `iris-interface-dev` 的 v1.2 格式接入稳定化回归：XLS/XLSX 多 sheet、DOC 转 DOCX 降级路径、DOCX 入参/出参分段与字段契约、PDF 轻量抽查均已验证；长期路线图现为 `memory/plan/iris-interface-dev-roadmap.md`，替代旧 `iris-interface-v1-summary-v2-plan.md` 作为后续会话入口。真实样本和解析产物仍只保留在 `tmp/iris-interface-file/`，不入库。
- 2026-06-24：已完成 `iris-interface-dev` v2.0 Task 0 字段匹配闭环：新增 `iris-interface-field-match.py`，从 `parsed.json` 生成 `field-match.json` 和 `field-match.md`；匹配来源区分 `builtin-rule`、`local-feedback`、`low-confidence-candidate` 和 `unmatched`，并限制控制台只输出路径与数量。`--feedback` 只读取目标项目本地 JSON，不写回插件仓库；插件专项测试已新增 synthetic fixture 覆盖四类匹配结果和控制台不泄漏字段明细。
- 2026-06-24：已完成 `iris-interface-dev` v2.0 Task 0 接口文档解析经验回归提升：`feedback/experience/iris-interface-dev-com-exp.md` 新增 XLS/XLSX 多 sheet、DOCX 入参/出参、PDF 混合表、PDF 跨页续表、错误码/修订记录/JSON 示例过滤和 DOC 转 DOCX 优先级经验条目，并标记已提升到 `scripts/tests/iris-interface-plugin.tests.ps1`；解析器补强 JSON 示例行过滤 synthetic 回归。已通过插件专项测试、仓库更新回归和插件敏感词扫描；真实工程默认输出路径仍为 `docs/output/iris-interface/<doc-name>/`，本地 `tmp/iris-interface-file/` 仅作维护回归证据且不入库。
- 2026-06-24：已完成 `iris-interface-dev` v2.0 Task 0 字段契约追溯模型：`parsed.json` 升级为 `iris-interface-doc-ingest/v2`，字段新增 `rawColumns`、`sourceLocation`、`classification`、`confidence`、`warnings`、`requiredReason` 和 `jsonPathReason`；`fields.md`/`diagnostics.md` 增加追溯摘要与统计。已通过插件专项测试、仓库更新回归和真实接口文档本地回归；真实摘要保留在 `tmp/iris-interface-file/test-results/iris-interface-v2-task0-real-doc-test-summary.md`，真实文档与解析产物不入库。
- 2026-06-23：根据三份样本文档验证结果，补强 `iris-interface-dev` 解析前环境引导：新增 `iris-interface-env-check.py`，把缺依赖/缺转换器从“失败告知”改为可执行安装建议；`requirements-optional.txt` 新增 `xlrd`，`.xls` 安装 `xlrd` 后可直接解析，XLSX/XLS 多 sheet 按 sheet 拆成独立字段视图。
- 2026-06-22：已完成 `iris-interface-dev` v1.1 PDF 解析质量补丁：收紧表头匹配，过滤修订记录和错误码表，支持 PDF 跨页续表继承上一字段表表头。真实样本 `综合药房 HIS 处方推送接口使用说明_5000.pdf` 重新解析后为 9 个视图、79 个字段，Page 17/18/19 续表缺失字段已补回。
- 2026-06-22：已完成 `iris-interface-dev` v1 基线并入，来源工程审计基线为 `https://gitee.com/soneakeko/agent-architecture.git` commit `43e12b345c58ba11a48980828503daf29ae309ec`。插件采用解析审计优先边界，提供接口文档落盘解析、字段结构化、字段诊断、开发计划和离线审查入口；IRIS/ObjectScript 编码、上传、编译、部署和远端验证继续复用 `coding-iris-plugin`。
- 2026-06-22：`iris-interface-dev` v1 明确不迁移来源大生成器和大体量规则库；`rules/` 仅放路由、流程、审查门禁和轻量规则，来源规则/wiki 资产先进入审计清单或 `references/` 候选。新增 `requirements-optional.txt` 只声明 `python-docx`、`pdfplumber`、`openpyxl`、`markitdown` 可选依赖，不 vendor、不自动安装。
- 2026-06-17：已将 Windows x64 `iris-agentic-dev.exe` 内置到仓库根 `vendor/iris-agentic-dev/windows-x64/`，业务项目通过既有 `/vendor/**` sparse checkout 自动获得 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。coding-iris 插件 README、AGENTS、初始化模板、`project-env.template.json`、MCP 规则和脚本说明已同步默认路径；连接事实仍只允许留在目标工程 `.mcp.json`、`.iris-agentic-dev.toml` 或环境变量。
- 已新增 IRIS 远端部署编排入口 `plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md`，将部署、上传、编译、SFTP 同步、CSP 编译和部署验证统一路由到部署 skill，并继续以 `rules/iris_deploy_checklist.md` 作为逐项执行清单。
- 已新增薄通用脚本 `plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js`，用于根据文件列表或 git diff 生成 IRIS 部署 JSON 清单；脚本只做本地分析，不执行上传、编译或远端写入。coding 插件 README、AGENTS、目标工程 snippet、manifest prompt 和 `iris_coding_workflow.md` 已同步更新。
- 已继续回归 `feedback/experience/demand-com-exp.md` 中建议提升的需求经验：`iris_coding_backend.md` 新增 `%Persistent` 字段追加、Storage 不手改和 Insert/Update/Import SQL 同步规则；`iris_coding_frontend.md` 新增 HisUI DataGrid 插列后 editor/列下标检查规则；`i18n_verify.md` 新增字典展示值验证必须覆盖主方法调用子方法的检查项。对应经验条目已追加“已回归/已提升”标记。
- IRIS/HIS 前端编码保护当前统一为 canonical `utf8`；标版与医院项目源码、上传内容和服务器运行编码均为 UTF-8。旧模式仅按迁移兼容边界读取，实际文件字节检测仍是最终门禁，i18n 规则复用同一检查脚本。
- 已将 HISUI 源码内置到仓库根 `vendor/hisui/dist/`，消除 `${HISUI_SRC}` 变量间接层；所有插件规则、skill 和模板统一指向 `.agents/vendor/hisui/`，删除两套 profile 模板中的 `HISUI_SRC` 字段。`install-agents.ps1` 和 `update-agents.ps1` 的 sparse checkout 新增 `/vendor/**`。coding-iris-plugin 和 i18n-iris-plugin 共约 12 个文件已同步更新。
- 已增强 plugin skill thin-index：`scripts/generate-plugin-thin-index.ps1` 生成 `.agents/skills/<skill>/SKILL.md` 时会传播真实 `SKILL.md` 的 `name` 和 `description`，并写入 `thin-index: true` 与 `source`。浅层 skill description 用于能力发现，匹配后仍必须继续读取插件真实 `SKILL.md`。
- 已完成 `SKILL.md` 渐进式披露轻量约束治理：真实 `SKILL.md` 的 frontmatter `description` 已收敛为 `Use when...` 触发条件句；正文补充基础入口优先、按条件继续读取 rules/references/config/MCP 的路由说明。本轮未给 skill 引入 `task-affinity`，仍保持 skill 发现依赖 `description` 与正文路由。
- 已完成 frontmatter/task-affinity 最小治理：为插件 `rules/` 和 `references/` Markdown 补充最小 frontmatter 与 `task-affinity`；`scripts/generate-plugin-thin-index.ps1` 可从源 rule 传播 `name`、`description`、`task-affinity`、`related`，并在 rule thin-index 中写入 `thin-index: true` 和 `source`。本轮不把 `skills` 纳入 `task-affinity` 元数据体系。
- 已新增框架验证反馈机制：`feedback/framework/` 反馈目录、反馈模板、`agents/_shared/feedback-protocol.md` Agent 反馈行为指引；`i18n-agent` 和 `i18n-change.workflow.md` 在完成条件中引用反馈协议；新增 `skills/agent-framework-feedback/SKILL.md` 通用反馈 skill，支持 plugin 直接使用场景。Agent 处理 HIS 需求时如对框架文件做了修正，自动生成反馈条目；维护者定期读取反馈、diff 后应用到 master。
- 已新增 `feedback/experience/deploy-com-exp.md` 和 `docs/deploy/dental-ta-159/` 首个部署经验/工具样例，用于沉淀全量部署流程、前后端部署脚本和专项计划；维护记忆只记录边界，不复制业务细节或连接信息。
- 已新增 `demo/presentation/` 演示页，包括 i18n 能力摘要、多智能体架构预览和演示首页，用于展示能力包思路；该目录当前不在安装/更新 sparse checkout 运行边界说明内。
- 已修复 `sync-xml-print-template.ps1` JsonLine framing 中文编码问题，并新增/保留相关语言测试，避免中文输出在跨进程传递时损坏。
- 已新增多智能体架构设计 `memory/plan/multi-agent-architecture.md`，明确厂商无关 canonical `agents/` / `workflows/`、工具 adapter 边界、模型档位、生成层、本地定制、版本演进和新增智能体 checklist。
- 已新增顶层 `agents/` 与 `workflows/` 首批 canonical 样板：`agents/agent-registry.md`、`agents/_shared/handoff-protocol.md`、`agents/i18n-agent/AGENT.md`、`agents/i18n-agent/bindings.yaml`、`workflows/workflow-registry.md`、`workflows/i18n-change.workflow.md`。
- 已新增交接报告模板：事实报告、分类清单、变更摘要、验证报告，用于阶段化或多智能体交接。
- 已将 `i18n-workflow-decompose.md` 的五阶段愿景落地为 `i18n-agent` 和 `i18n-change.workflow.md` 样板，阶段为 Explorer、Classifier、Coder、Template/Seed、Verifier。
- 已明确 `agents/` 和 `workflows/` 是能力包正式内容，不属于 `.agents/.git/info/exclude` 生成层；后续需要纳入安装/更新脚本 sparse checkout。
- 已新增 coding 插件统一编码入口 `iris-coding`，并同步更新插件入口、README、目标工程 snippet 和 manifest prompt；后端、前端和 GB2312 promote 专项 skill 保持兼容。
- 已新建 i18n 链路定位规则 `rules/i18n_link_tracing.md`、数据分类规则 `rules/i18n_field_classification.md`、验证规则 `rules/i18n_verify.md`，补全五阶段工作流的规则缺口。
- 已更新 `i18n-coding` skill 为阶段化入口，新增阶段化执行引导和必读规则引用，并在产出段落增加需求完成后的经验沉淀引导。
- 已优化 `feedback/experience/demand-com-exp.md`：新增领域标签和需求索引维护规则，在文档末尾追加需求索引章节，支持锚点跳转。
- 已修正 `i18n_coding_print_backend.md` 入口措辞，从"打印 JSON"收敛为"实际打印返回数据"，并引用链路定位规则。
- 已补充 `i18n-xml-print-template-sync` 的触发前置约束：必须先通过链路定位确认存在 XML 模板记录。
- 已补齐 `i18n-iris-plugin/AGENTS.md` 的 Skill 路由和规则入口。
- 已在 `feedback/experience/demand-com-exp.md` 中标记被提升的经验条目和反哺规则。
- 已将 coding 插件的 HISUI 控件索引从 rule 层迁移为 `references/hisui-widget-index.md`。
- 已更新 coding 插件入口、README、前端 coding skill 和规则索引，使 HISUI 控件参考只在控件选型或 API 不确定时按需读取。
- 已在 coding 插件 manifest 中声明 `references: references/`。
- 已增强 coding 和 i18n 插件 thin-index 脚本：重建时可识别并清理由本插件旧版本生成、但源文件已从 `rules/` 移走或被重命名的 stale rule thin-index。
- 已在仓库 README 和 coding 插件 README 中补充已部署 `.agents` 的同步说明。
- 已拆分 `iris_coding_workflow.md`，新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md`，降低非部署任务加载成本。
- 已精简 `sftp_server.md` 的通用部署重复内容，并精简 `i18n_index.md` 的总原则。
- 已在 workspace kit 文档和 reusable packaging skill 中补充插件内 `references/` 约定。
- 已在 workspace kit 文档、reusable packaging skill、仓库 README 和维护记忆中明确 rules/skills/references/scripts 命名约定。
- 已将历史异常 rule 文件名统一为 snake_case：`iris_agentic_dev.md`、`sftp_server.md`、`i18n_hisui_widget_index.md`，并更新相关 AGENTS、README、rules、templates 引用。
- 已将 thin-index 生成逻辑收敛到根 `scripts/generate-plugin-thin-index.ps1`；各插件同名脚本只作为 wrapper 转发参数，避免插件之间运行时绑定。
- 已确认边界：插件之间不应互相依赖；独立分发单个插件时，若使用 `plugin-reference-thin-index`，必须同时携带根 canonical 脚本，否则选择 `copy` 或手工 thin-index。
- 已新增根目录 `index.html` 作为 AI Coding 外骨骼架构可视化展示页，并通过 `.github/workflows/pages.yml` 和 `.nojekyll` 发布到 GitHub Pages。
- 已明确双远端维护约定：`origin` 为 Gitee 主仓库，日常维护、业务项目 `.agents` 部署和安装脚本以此为准；`github` 为 GitHub 镜像仓库，主要用于 GitHub Pages 展示页发布。
- 根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务展示页和 GitHub Pages；当前安装脚本 sparse checkout 只检出 `docs/`、`rules/`、`skills/`、`plugins/`、`scripts/`，不会把展示页文件部署到业务项目 `.agents/`。
- 已新增统一更新脚本 `scripts/update-agents.ps1` 和托管更新 runbook `docs/update-agents.md`，用于已部署业务工程更新 `.agents` 能力包、维护生成层 ignore、重建 plugin thin-index 和合并明确缺失的 config 项。
- 已更新 `project-context-maintenance`：安装或更新 `.agents` 时优先读取 `docs/update-agents.md`；更新脚本不得自动重写 `AGENTS.md`、项目 memory、项目 rules 或已有 config 值。
- 已将 `AGENTS.md` 规范调整为必须唯一主入口；`CLAUDE.md`、`CODEBUDDY.md` 只作为可选兼容入口，缺失或异常只报告，不自动修复或复制第二份规则。
- 已增强 canonical thin-index stale 清理：支持识别插件源规则重命名、移走或删除后遗留的浅层入口，避免目标工程 `.agents/rules/` 长期残留过期索引。
- 已完成多 Agent v0.2.0 最小部署闭环：安装/更新 sparse checkout 包含 `agents/` 和 `workflows/`，`i18n-agent` 明确插件初始化前置，通用 Agent 和 adapter 生成器顺延为后续阶段。
- 已实施插件状态分流：`.agents/plugins/**` 全量拉取用于能力发现，`update-agents.ps1` 按 `plugin_profile.md` 将 `available`、`enabled`、`disabled` 分流处理，默认只处理 `agent-context-kit`；旧 `initialized` 兼容读取为 `enabled`，旧 `indexed` 兼容读取为 `available`。
- 已新增 `scripts/update-plugin-profile.ps1`，供插件 init skill 在验收通过后机械反写 `plugin_profile.md`，避免不同模型手工编辑表格。
- 已在插件 manifest 中补充 `initSkill`，并为 `i18n-iris-plugin` 声明对 `coding-iris-plugin` 的依赖；`update-agents.ps1` 对未初始化依赖输出 `plugin-dependency-missing`。
- 已新增独立 `scripts/generate-agent-thin-index.ps1`，并接入 `scripts/update-agents.ps1` 的 `agent-thin-index` 阶段；已部署业务项目常规 DryRun/Write 可生成 `.agents/skills/<agent-name>/SKILL.md`，当前用于把 `i18n-agent` 暴露给只发现浅层 skill 的 Agent。
- 已明确本轮不做工具专属 adapter；Codex、Claude Code、OpenCode、CodeBuddy 原生入口仍暂缓，agent thin-index 只做 canonical 路由，不复制插件规则全文。

## 近期提交索引

- `ca310db`：增强 HISUI 样式优先复用规则，拆分控件/API 与 CSS 样式/资源索引。
- `621b633`：新增 `iris-external-reg` 第三方预约挂号接口开发插件，并继续完善 `extract-doc`。
- `e1e5761`：将通用文档解析拆分为 `extract-doc`，`iris-interface-dev` 改为接口语义适配层，并新增 coding-iris CSP 模板。
- `12e8539`：建立 i18n-agent P1 多模式运行协议、运行 manifest、事后校验器和脱敏回溯产物。
- `98b09e6`：XML 打印模板同步新增临时 `<SYNTAX>` 自动分块 fallback 与离线回归。
- `7478f85`：升级 `agent-framework-feedback` 为统一收尾 skill，并沉淀条件分支经验。
- `58339ee`：新增维护者专用 `agent-kit-maintenance` skill，并排除业务项目部署。
- `364f594`：`install-agents.ps1` / `update-agents.ps1` 新增 Git 版本前置校验，并同步 runbook 与测试。
- `3e0f580`：新增 `imedicalxc-doctor-print-template-design` 插件，提供打印模板设计与 `.xlsx` 模板生成工作流。
- `b655c1a`：新增 `imedicalxc-doctor-data-extraction` 插件，提供数据抽取与第三方接口对照文档生成工作流。
- `05bfa75`：新增 `imedicalxc-doctor-perf-analysis-engineer` 插件，提供接口性能分析、Graylog 诊断、前后端优化和报告输出能力。
- `b802ac9`：同步 vendor skill 运行时链路与医生站扩展插件文档到当前状态。
- `5ea2910`：精简 `imedicalxc-doctor-dbdata` skill，并同步医生站扩展主编排器和架构引用。
- `3512d7c`：迁移 superpowers skills v6.0.3 到 `vendor/superpowers/`。
- `920e75b`：`imedicalxc-doctor-extend-engineer` thin-index 只暴露主编排器入口。
- `9647f86`：补充 `imedicalxc-doctor-extend-engineer` 插件 thin-index wrapper。
- `6bbb95e`：清理医生站扩展插件旧版目录文件。
- `cd57f56`：新增 vendor skill 运行时同步脚本，并重构医生站扩展插件标准结构。
- `045eecf`：新增信创版本医生站第三方接口开发智能体资料。
- `16bc2d6`：更新内置 `iris-agentic-dev.exe` 到 v0.6.17。
- `6dcccca`：完成 `iris-interface-dev` 字段匹配闭环文档归档与测试补强。
- `4731854`：新增 agent skill thin-index 生成脚本，并集成到 `update-agents.ps1` 流水线。
- `3cc5616`：新增首个部署经验文档和专项部署工具目录。
- `8e4cfca`：新增 `demo/presentation/` 演示展示页面。
- `ccc96bf`：新增 `agent-framework-feedback` 通用反馈 skill。
- `b796f13`：补充字典翻译检查需覆盖被调用子方法经验。
- `e1876cd`：新增 i18n 前端编码与字典翻译经验条目。
- `ee4d08f`：为 GitHub Pages 展示页添加 inline SVG favicon。
- `c6f2508`：升级展示页视觉体验与内容结构。
- `9694509`：新增框架验证反馈机制。
- `f7e14c7`：修复 XML 打印模板同步脚本 JsonLine 中文编码问题。
- `38f0aed`：实施插件状态分流与 `plugin_profile` 机制。
- `02d7e84`：新增 AI Coding 外骨骼架构可视化页面。
- `d61ea96`：将架构可视化页面重命名为根目录 `index.html`。
- `c2281ef`：新增 GitHub Pages workflow 和 `.nojekyll`。
- `4956e7b`：启用 GitHub Pages 权限。
- `95e596b`：README 补充双远端同步说明。
- `1cc1ac7`：新增统一更新脚本 `scripts/update-agents.ps1`。
- `6ae4277`：新增托管更新 runbook 和 `update-agents` 摘要视图。
- `0a932d7`：收敛唯一主入口、可选兼容入口和 stale thin-index 清理。

## 最近验证

- 2026-08-04：迁入 `codegraph-query` 和 `iris-codegraph` 插件；补齐 manifest、AGENTS、README、usage rule、skill 和 thin-index wrapper，并同步仓库 README、runbook、维护记忆和 update-agents 测试。已验证 `.codegraph` 状态 complete，`cg-query.js help`、`icg-query.js help`、`node --check` 均通过；`iris-codegraph` 构建因当前项目缺少 `.mcp.json` 未执行。后续确认 `codegraph-query` 依赖 `iris-codegraph`，并把该前置关系写回 manifest、plugin_profile 和回归断言。

- 2026-07-18：`scripts/tests/update-agents.tests.ps1` 与 `scripts/tests/iris-interface-plugin.tests.ps1` 已通过；后者统一使用 `python -B`，不再在 owner 脚本目录遗留 `__pycache__`。`coding-iris-plugin`、`extract-doc`、`iris-external-reg` thin-index DryRun 均成功，反馈 `260718022936` 的 8 个 owner 副本与 canonical 逐文件一致，`git diff --check` 通过。
- 2026-07-13：`plugins/agent-context-kit/scripts/tests/validate-agent-run.Tests.ps1` 已覆盖合法串行/多智能体运行、未授权多智能体、缺失报告、同签名重试超限、未授权远程写入、阶段依赖、并行效率和敏感内容门禁；`docs/validation/i18n-agent-p1/retrospective-6096150` 已通过校验。
- 2026-07-13：`plugins/i18n-iris-plugin/scripts/tests/sync-xml-print-template.Tests.ps1` 已覆盖内联保存、临时 `Execute+...<SYNTAX>` 识别、分块 fallback 和成功/失败清理。
- 2026-07-01：已检查近期提交 `05bfa75`、`b655c1a`、`3e0f580`、`364f594`、`58339ee` 的变更范围；确认三个新增医生站插件均包含 `.agents-plugin/plugin.json`、`AGENTS.md`、主 `SKILL.md` 和 thin-index wrapper，其中性能分析插件额外包含 README、init skill、脚本和 references。已通过 `rg` 检查 README 与维护记忆中的旧插件总览缺口，并完成摘要同步；本轮不复制大段插件正文或业务私有事实。

- 2026-06-30：本轮文档同步已执行一致性搜索，确认 `README.md`、`plugins/imedicalxc-doctor-extend-engineer`、`memory` 和 `docs` 下不再残留旧版 superpowers 安装方式和旧子 skill 暴露数量等过期表述；路径检查确认 `vendor/superpowers/skills/brainstorming/SKILL.md`、`vendor/word-reader/SKILL.md` 和医生站扩展插件 thin-index wrapper 均存在；`scripts/sync-vendor-skills.ps1 -AgentsRoot . -Mode DryRun` 可枚举 superpowers 与 word-reader vendor skill；`scripts/tests/update-agents.tests.ps1` 已通过。仓库根误产物 `%SystemDrive%/` 已确认位于 workspace 内并清理。

- `scripts/tests/iris-interface-plugin.tests.ps1` 与 `scripts/tests/update-agents.tests.ps1` 已验证：`iris-interface-doc-ingest.py` 支持 PDF 表内请求/响应分段、嵌入表头、空首列参数名识别、签名字段 `signature.*` 归属和 JSON 示例行过滤；真实 `移动APP接口对接文档（光华口腔）v1.1.3.pdf` 回归为 `ViewCount=16`、`TotalFields=81`、`JsonPathCount=80`、`request=18`、`response=55`、`signature=4`，Page 7-14 可按 `n_type` 标识区分请求/返回视图。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：环境自检脚本、可选依赖清单 `xlrd`、XLSX 多 sheet 解析、字段续表/JSON 路径回归和点号循环审查门禁正常。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：v1.1 解析器回归覆盖修订记录过滤、错误码表过滤和续表继承字段表头；真实 PDF 样本手动验证 Page 17/18/19 缺失字段已补回。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：`iris-interface-dev` manifest、skill/rule 入口、可选依赖清单、thin-index dry-run、XLSX 标准库解析落盘、输出目录迁移、`references/` 排除和点号循环审查门禁正常。
- `scripts/tests/update-agents.tests.ps1` 已验证：插件 legacy name 状态迁移、stale rule/skill thin-index 清理、安装/更新、插件状态和 agent thin-index 流程正常。
- `scripts/tests/iris-deploy-manifest.tests.ps1` 已验证：`prepare-deploy-manifest.js` 可从目标项目 `project-env.json` 读取 namespace/web 路径，按 `.cls`、`.csp`、`.js` 生成稳定 JSON 清单，并兼容 PowerShell UTF-8 BOM 配置文件。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun` 已验证：新增 `iris-deploy` skill 可生成 `.agents/skills/iris-deploy/SKILL.md` thin-index 计划。
- `scripts/tests/update-agents.tests.ps1` 已验证：新增部署 skill 和脚本说明未破坏现有更新、thin-index、插件状态和 agent thin-index 流程。
- `scripts/tests/frontend-encoding.tests.ps1` 已验证：GB2312 中文前端文件在 `-ExpectedEncoding gb2312` 下通过；UTF-8 中文文件在同一策略下返回错误退出码，用于拦截编码漂移。
- `scripts/tests/update-agents.tests.ps1` 已验证：现有更新、thin-index、插件状态和 agent thin-index 流程未受前端编码护栏变更影响。
- `scripts/tests/update-agents.tests.ps1` 已验证：skill thin-index 会传播真实 skill `description`，写入 `thin-index: true` 和 `source`，且仍不传播 rule `task-affinity`。
- 已检查 16 个真实 `SKILL.md`：frontmatter `description` 均以 `Use when` 开头，正文均包含按条件读取或渐进式读取提示。
- 已搜索确认 `plugins/` 和 `skills/` 下的 `SKILL.md` 未新增 `task-affinity`。
- `scripts/tests/update-agents.tests.ps1` 已验证：rule thin-index 可传播源 frontmatter 中的 `task-affinity`、`description` 和 `source`，无 frontmatter 的 legacy rule 仍兼容生成，skill thin-index 不传播 rule 任务亲和元数据。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun` 已验证 coding 插件 rule/skill thin-index 生成计划正常。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/i18n-iris-plugin -ProjectRoot . -Mode DryRun` 已验证 i18n 插件 rule/skill thin-index 生成计划正常。
- 已检查 `i18n-agent` / `i18n-change.workflow.md` 引用的 i18n 插件 rules 和 skills 均存在。
- 已检查新增 `agents/`、`workflows/` 文件无 `TODO` / `TBD` 占位；`待确认` 仅作为交接协议和 config 合并策略术语出现。
- 已确认 `memory/plan/multi-agent-architecture.md` 与实际新增报告模板命名一致。
- coding 插件 thin-index dry-run 已确认不再生成 HISUI 控件索引的 rule 入口。
- 构造旧版 HISUI rule thin-index 后，coding 插件脚本 dry-run 可标记 `stale`，Write 模式可移除旧入口。
- 搜索旧 HISUI rule 路径已无残留引用。
- coding 插件 thin-index dry-run 已确认新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md` 规则入口。
- 搜索确认 `references/` 规范已写入 workspace kit 文档和 reusable packaging skill。
- 搜索确认 rules/skills/references/scripts 命名约定已写入 workspace kit 文档、reusable packaging skill、仓库 README 和维护记忆。
- 搜索确认 thin-index canonical/wrapper 约定已写入 workspace kit 文档、reusable packaging skill、插件 README 和维护记忆。
- `scripts/tests/update-agents.tests.ps1` 已验证：默认只处理 `agent-context-kit`，未启用插件只列为 available，显式插件可处理，i18n 在 coding 未初始化时阻塞，安装/更新 sparse checkout 包含 `agents/` 和 `workflows/`。
- 已验证三个插件 manifest 均可被 PowerShell `ConvertFrom-Json` 正常解析。
- `scripts/tests/update-agents.tests.ps1` 已验证：`update-agents.ps1` 可调用 agent thin-index 阶段，Write 模式生成 `.agents/skills/i18n-agent/SKILL.md`，入口指向 canonical `AGENT.md`、`bindings.yaml` 和 `i18n-change.workflow.md`，且不生成工具 adapter 内容。

## 维护要求

- 后续完成每轮维护后，更新本文件的近期已完成、提交索引和最近验证摘要。
- 不记录一次性命令输出、短期失败日志或可从 Git 历史直接恢复的完整流水。

## 2026-09-15 前端确定性部署入口

补齐 deploy-frontend.js、upload-batch.py 与显式指纹校验；固定上传回读后编译，失败不重试。专项 Node 21 项、Python 25 项通过；未执行本轮服务器写入，业务副本尚未同步。

2026-09-15：更新自动刷新既有标准 SFTP 启动参数为 vendor，不要求 runtime opt-in；保留解释器、env、disabled 和其它服务。显式 custom 或自定义参数不覆盖，不创建缺失服务，不安装 Python 依赖。SFTP 迁移专项 8 项、组件版本治理 16 项和完整 `update-agents.tests.ps1` 均通过，工作区版本校验覆盖 15 个组件。

## 2026-09-15 医生站 AI 集成插件

本地提交 `e88ea62` 新增 iris-imedical-doctor-ai 0.1.0，提供初始化/开发入口、现行能力发现、诊断与共享业务服务集成方法、可变原型映射、集成分析模板及可选只读元数据检查。复用 coding-iris-plugin，不固定工程路径、框架接口、持久化枚举或原型流程。

专项测试 10 项、组件版本测试 16 项通过，专项包含 PS7/PS5.1 thin-index；两份 skill 与引用检查通过。非本机平台 CI 和真实 HIS 联动验收仍待执行。未安装或部署业务副本。

### 同日维护同步复核

复核 `e88ea62`：原提交已包含插件说明、发布记录、接入文档、三份维护记录与专项测试，但 README 入口分散、维护摘要组件数量过期，更新指南缺少初始化路由。现将插件纳入 README 概览和接入列表，校正为 14 个插件及 2 个独立 skill，补齐更新指南、长期资料边界和提交索引；菜单/wiki 接入列为待样本评估，不记作已实现。仅维护文档，无插件内容、版本、安装器或业务副本变更。

本次复核：文档入口链接与差异格式检查通过，组件版本快照校验覆盖 16 个组件，组件治理 16 项测试通过并记录可复用证据；本轮生成的 30 个测试目录已核实内容并清理。
相对 HEAD 的 worktree 版本差异校验通过（16 个组件）。

- 2026-09-18 知识库发现入口补齐：agent-context-kit 0.3.4 模板与维护流程按 enabled/入口可达条件合并工程 AGENTS 简短指引；与 coding-iris-plugin 0.13.1 自主查询规则一同交付。普通更新不覆盖业务入口，本轮未部署业务副本。

- 2026-09-18：iris-imedical-doctor-ai 0.2.1 补充通用 UI 布局、图标对齐、状态按钮与组合动作语义，扩充运行态验证矩阵；项目动作码、具体布局和业务决定不进入插件。文档变更，无运行器或安装机制变化，业务副本未同步。
