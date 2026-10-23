# .agents 安装与更新 Runbook

## 统一 skill / Agent 帮助

全部自有 skill（含 init、xc）和 Agent 的源定义接入[统一帮助协议](guides/capability-help.md)。`--help` 或“查看用法”只展示说明，不检查业务配置、连接或插件现场状态，不初始化或启动任务；附带执行参数也不执行。实际任务继续沿各自原流程与授权。

standard 已有工程按本 runbook 的正常 DryRun → Write → Check 更新能力包和已启用入口。公共协议、技能源定义和 Agent 源定义分别沿既有 `/docs/**`、`/plugins/**`、`/agents/**` 下发；薄索引模板不变，旧入口继续读取更新后的真实定义，无帮助专项索引迁移或旧文件清理。新安装沿“安装 → 项目及所需插件初始化 → 更新并检查”，不自动增加 init 的日常入口或启用插件。

Overlay 先更新共享 CapabilityRoot 一次，再由模块原完整流程以 `-NoPull` 刷新 ContextRoot。模块未映射 docs 时，从 `.agents/capability.json` 显式定位 CapabilityRoot 下的协议与指南，不复制文档或新增映射。宿主通过 Junction/symlink 读取同一项目技能集合时可直接看到新源路由，必要时刷新宿主发现或开启新会话；用户级独立复制副本沿原分发流程更新。

验收时分别核对协议和源定义实际落盘、旧索引 source 可达，以及真实帮助调用是否在业务步骤前结束；仅看更新退出码或源仓测试不代表业务副本及宿主已验收。源仓维护 skill 继续不部署，vendor 契约、项目 AGENTS、插件状态、私有配置、安装器和更新器实现保持。

## 公司 UI 规范与 IRIS 适配层

`imedical-ui` 0.1.0 提供公司 BS 端 IHOS 海蓝/PURE 天蓝的共性规则、按需参考及截图/浏览器评审；`iris-ui` 0.2.0 专注 IRIS CSP＋HISUI 落地，正式依赖 `imedical-ui` 与 `coding-iris-plugin`。通用层无需 IRIS profile，既有 IRIS 配置仍由 coding owner 管理。

已有 `iris-ui` 0.1.0 工程需迁移启用集合：先核对项目 profile/注册表，在本次已获授权接入范围内启用 `imedical-ui`，再依原标准更新流程预演、写入、检查。Overlay 共享 capability 更新一次，再由项目模块管理入口 `-NoPull` 完整刷新并验证；注册表与 profile 必须一致。显式 disabled、身份或自定义冲突先报告，不用 setter 强行覆盖。

新插件默认 available；更新器不会因依赖声明自动启用它。依赖未 enabled 时会报告 `plugin-dependency-missing` 并跳过依赖方入口，整体退出码仍可能为0；应核对状态、依赖集合和实际映射，不能只看退出码。保留自定义文件和旧记录，无本批旧文件删除。

插件与必要证据沿现有 `plugins/**`、`vendor/**` sparse 路径分发，无安装器或更新器代码变更。vendor目录落盘不等于已启用；纯init不生成日常索引。公司资料版权/分发条件保持原状，源码接收、远端推送与正式分发分别按授权处理，不自动推公开镜像。框架源仓修改不代表业务副本已经升级。

`imedical-ui` 0.1.1、`iris-ui` 0.2.2 与 `coding-iris-plugin` 0.20.4 补齐业务共性的主题条件核对；依赖下限以 iris-ui manifest 为准。沿上述正常流程一次更新共享 capability，再以 `-NoPull` 刷新模块 Context，核对新规则和 `plugins/iris-ui/scripts/check-theme-scope.js` 实际可读。扫描器随现有插件路径分发，只读显式源码并给出候选，不加入业务页面或 Git hook。此批无启用集合迁移、公共 CSS、更新器逻辑或旧文件清理变化；源仓验证不代表业务副本已更新。

完整公司材料另存源仓 `vendor/imedical-ui-standards/originals/<批次>/`，由目录内 `.gitignore` 忽略，仅本地集中管理，不提交、不随项目更新分发。用户整理好展开目录和 PDF 后按新批次复制、校验并保留本地清单；随后根据标注变化升级规则、提炼证据及插件版本，后者继续按正常流程提交和分发。现有已入 Git 的证据子集保持，资料管理及升级路径见 [vendor 说明](../vendor/imedical-ui-standards/README.md#完整公司原件仅本地)。

## 无人值守治理 v1

按正常更新流程同步根 scripts/*.js、scripts/lib/**、agents/workflows/docs 及已启用 coding-iris-plugin，再执行 Check。新批次探测 `night-execution-plan/v1`、`browser-worker/v1`、`night-frozen-sources/v1` 和 `night-weekly-quota/v1`；从 [治理接入](night-governance.md) 先取基线、填写并批准 executionPlan，再为独立 worktree materialize 实体 PLAN。普通更新不修改业务 AGENTS、不启动任务、不安装浏览器、不创建 Goal；旧 run/既有工作区不自动迁移，无旧文件删除。

coding-iris-plugin 的 `web.frontendTransport:atelier` 为明确项目能力选择，复用既有保护/回读/编译；省略仍沿旧 SFTP，失败不自动换通道。依赖 owner 只扩大兼容范围；项目连接和认证配置仍私有。分发专项覆盖新增文件实际稀疏落盘，真实业务副本和各平台结果仍单独核验。本轮未修改安装/更新脚本。

## 夜跑收敛扩展

正常更新根 scripts/lib、验收入口、共享协议和已启用插件薄索引后，新批次检查 `capabilities.features` 含 `night-convergence/v1`，从策略模板填写明确总时限；null 不可执行。旧 run 不迁移或补造记录，无旧文件删除。环境依赖的验收 profile 需实现真实 `verifyDependencies` 后再启用该依赖；其它需求复用原 profile。合成回归在 night-convergence/night-contract-v2 专项与现有三平台 CI，真实业务验证另按授权执行。本轮未改安装/更新脚本，部署布局沿既有 scripts/lib/** 与 scripts/*.js。

## 文档导航补齐

更新器在 Write 模式为已有项目 `AGENTS.md` 补齐缺失的按需文档导航，指向 `.agents/docs/README.md`；已有有效导航保留，重复执行不重复添加。Overlay 未映射 docs 时，入口改为按 `.agents/capability.json` 解析 CapabilityRoot 并读取其 docs/README.md，不修改共享目录或 manifest。

DryRun 报告 `docs-entry-missing` 且不写项目入口；Check 对缺失导航返回失败，Write 追加后回读验证。缺少 AGENTS.md 时仍由 project-context-maintenance 初始化，不生成空白项目规则。缺少文档、失效路径、非 UTF-8、文件链接/硬链接、未闭合 Markdown 或并发变化时停止并保留原文；按提示修复后重跑。只补导航，不覆盖项目正文、配置、规则或记忆；这是普通更新保护边界的限定例外。临时写入文件在项目入口旁创建并在结束时清理，兼容入口不另写副本。

已有项目使用正常更新流程获取新版脚本与 docs，先 DryRun，再 Write，最后 Check；严格离线预演使用 `-NoPull`。此修改不自动扫描或更新其它工程，无旧文件清理。新项目初始化使用相同入口；链接检查证明可达，实际宿主是否按任务读取仍需在目标工程观察。


BOS 0.10.0 还支持显式 `--work` 工作记录来源，默认仍为 Git；代码 v2 保持可用，工作 v3 需新版脚本读取，旧版本不支持，不自动转换或覆盖草稿。工作来源不依赖提交插件，编号只回填草稿。

BOS 0.10.0 新增 Agent 层 `bos-demand-entry --split` 和 `--split --excel` 用法。普通更新能力包并刷新已启用 bos-plugin 薄索引，核对 description 展示短参数且 source 指向最新 SKILL；技能正文与脚本随原插件路径分发。无需配置/草稿 schema 迁移或旧文件清理，未启用项目不自动启用，底层 CLI 不接受 --split。

## CLS 检查与医生站继承要求更新（coding-iris-plugin 0.19.6）

按正常更新流程拉取能力包、刷新已启用的 coding-iris-plugin 薄索引并执行 Check。本轮 CLS 规范、后端 skill/rule、类模板、doctor-dev 默认配置及 check-cls-format.js/cls-format.js 均沿既有插件 sparse 路径分发，无新增安装依赖或旧文件清理。

更新后核对插件 manifest 版本不低于 0.19.6、后端薄索引指向当前插件源文件，并在新建类/Review 时加载最新后端规则。项目 AGENTS/profile 或用户已明确为医生站组时，规则会继续读取 doctor-dev 后端约定；旧 profile 未抄入该约定不阻断此加载入口。有显式冲突须先澄清，不自动重写 profile 或已有类；项目类型未明确时不得按路径猜测。

验收分别核对文件落盘、索引可达和 Agent 是否实际按依据选择继承。可选 CLS 检查器只提供静态提示，不替代 IRIS 编译。源码仓分发测试不代表真实项目已更新；根工程与模块工作区由其更新任务执行既有 DryRun/Write/Check 并保留本地改动。

需求迁移扫描在独立嵌套 Git/Agent 工作区边界停止，报告 `demand-workspace-skipped`；不越界检查或改写活动 worktree 的链接入口，也不按目录名整体豁免。边界标记与单独更新要求见 [需求迁移](demand-delivery-migration.md)。

夜跑分层验收沿既有 workflows、scripts/*.js、scripts/lib 与 coding-iris-plugin 分发；更新不会启动批次或安装 Playwright。BOS 0.9 / coding 0.19 的新夜跑显式接入 schema 2.1、单批次多仓绑定和启动前实际预检；六个直接依赖 owner 的范围同步接纳 coding 0.19。正常更新能力包并刷新 enabled 索引后再探测 capabilities；旧 2.0 run 和普通 CLI 保持兼容，无私有配置迁移或额外旧文件清理，见 [接入说明](night-acceptance.md)。 夜跑工作区忽略门禁随根 scripts 更新生效：已有仓内落点须先配置对应目录忽略规则（共享 `.gitignore` 或本地 Git exclude），再重跑 plan/check；也可为新批次指定仓外 worktreeRoot。不自动移动或清理已有 worktree。

可重复测试与会话维护通过既有 scripts/lib、agents、workflows、docs 分发，无新迁移或旧文件清理；项目 runner 显式接入后才可启用经核实的心跳。异步编排启动与结果消费有新契约，旧 run 不自动升级，见 [测试运行时](testing-runtime.md) 与 [编排手册](agent-orchestration.md)。

需求迁移由外部插件注册表编排时，先消费迁移器 JSON 的 `stateChanges` / `enabledAfter`，再通过 `-ExpectedEnabledPlugin` 传入完整预期集合；不一致在需求迁移写入前停止。普通 Check 会检测待迁移旧入口及已启用新入口的实际可达性。编排顺序和边界见 [外部编排契约](demand-delivery-migration.md#外部编排与-check)。

## HISUI 资产更新

HISUI 快照通过既有 `/vendor/**` 分发，coding-iris-plugin 0.17.1 同步控件/样式参考。源仓的固定提交、构建工具和完整文件摘要见 [vendor 说明](../vendor/hisui/README.md)；维护区升级脚本不部署，不在业务项目安装 npm 或现场构建 HISUI。上游升级按 [维护入口](../vendor/hisui/AGENTS.md) 执行，普通安装/更新不访问 HISUI 上游。

已部署项目沿本 runbook 正常更新能力包，再刷新 enabled 插件入口；Overlay 只更新共享 CapabilityRoot 一次。旧受管资产随能力包 Git 快进收敛，不自动删除项目自定义资产、改写 cure_form_profile.md 的显式预览路径或替换服务器文件。版本身份取 upstream.json，行号取 source-index.json；CSS 的已知缺项见 resource-warnings.json，真实 HIS 页面使用的主库/主题/locale/helper 需按任务核对。

IRIS 部署配置继承更新：先同步经过验证的 coding-iris-plugin 部署脚本（含 project-env.js）与规则，再由项目创建器声明模块 manifest 的 projectEnvFallback。保留本地配置与 MCP，不复制凭据，不为回退切换 project-root；没有声明的已有项目保持原行为。


## 文档目录迁移与旧文件清理

项目文档从 [docs/README.md](README.md) 按用途阅读；新增指南归 guides/，导出参考归 reference/。源仓维护材料已移出 docs，沿现有 /docs/** 分发规则不会下发。稳定 runbook 路径保持。

维护者提交发布后，已有工程正常更新 capability：安全快进删除旧受管文件、生成新路径，并刷新 sparse；旧目录为空时由 Git 清除，不保留旧文档跳转壳。具体业务部署样本已获源仓用户授权删除，项目自己的部署材料不属于清理范围。

更新前核对能力包 Git 状态。受管旧文件有本地修改时停止；未忽略自定义文件会触发 dirty 保护。已忽略的自定义文件可能保留在旧目录中，此时保留并报告路径，不能递归删除目录。新路径冲突、无远端或手工复制的历史文件均先核实归属，不按同名判断可删除。Git 历史不在本次清理范围。

Check 和 DryRun -NoPull 保持只读；普通 DryRun 允许更新 capability，遵循下文原语义。Overlay 只迁移共享 CapabilityRoot 中的受管文档，随后按原流程刷新各 ContextRoot；不扫描模块业务 docs 或相邻工程。源仓整理完成不等于业务工程已更新。


## iMedical 知识资料与菜单同步

0.20.6 为已有菜单刷新流程补齐固定采集入口 `refresh-menu.js`，新增源端读取适配和采集证据原子发布，不改变 sparse、thin-index 或旧快照 schema。已部署工程正常更新能力包与入口后，按[无人值守协议](../plugins/coding-iris-plugin/references/menu-knowledge-sync.md#无人值守刷新)审阅并登记项目私有实例配置，再由宿主调度。配置与 work/menu-sync 保持 Git 忽略，原快照和历史 generation 无需迁移或清理；首次登记和实际环境权限独立核验，不自动创建任务或部署服务端。

0.13.1 将知识检索的选择统一到 IRIS 通用规则，由模型自主决定是否查询，不要求用户点名或每次必查。已部署工程正常更新并重建 coding-iris-plugin thin-index，刷新后的 skill 描述与通用规则即可生效；不新增连接、迁移资料或自动刷新菜单。具体模型实际选用行为仍需任务观察。

coding-iris-plugin 0.13 提供 iris-imedical-knowledge / iris-menu-sync；共享资料随已有 `/vendor/**`、入口与工具随 `/plugins/**` 分发，未改变安装/更新 sparse 范围。不把普通资料声明成 vendor skill，不自动安装 Qoder 或新增连接。

新装项目启用 coding-iris-plugin 后由 canonical thin-index 生成两个入口。已有工程按本 runbook 正常更新能力包并刷新 enabled 插件入口；coding-iris wrapper 支持 ContextRoot/CapabilityRoot，Overlay 仍只更新共享 capability 一次，在每个项目 ContextRoot 重建入口。维护者导入脚本在源仓 `.agents/skills`，不部署业务工程。

项目菜单写入 `ContextRoot/work/menu-sync/<sourceId>`，与 vendor 参考隔离；更新和索引重建不得覆盖、清理或重新生成它。旧 `.agents/data` 不自动迁移或删除。当前资料读取跟随 current.json，历史 generation 有意保留用于恢复。首次同步需按项目工具/服务实际能力采集，缺失不自动部署服务。完整用法与验证范围见 [知识接入](guides/imedical-knowledge.md)。

## 标版需求录入入口

BOS 0.12.0及需求交付0.6.0新增[主子代码归属](demand-code-ownership.md)。沿既有完整更新取得两个owner和根scripts/lib后刷新enabled索引；Overlay只更新共享能力一次，再按项目流程NoPull刷新模块。新层级草稿v4/验收v2使用新工具，旧v2/v3草稿及验收v1保持原语义，不自动转换、清理或改授权；无私有配置迁移，不调用真实BOS或启动验收批次。安装器/更新器实现和部署目录不变。

需求提交和补录已迁出 IRIS，完整更新会定向迁移旧技能、项目 AGENTS 与启用状态；冲突阻断，详见 [需求交付迁移](demand-delivery-migration.md)。

coding-iris-plugin 0.13.6 起，需求录入输出路径拒绝 `.agents/`、能力包源码和指向它们的目录链接。更新器不会自动移动此前误放的私有 `facts.json`、`spec.json` 或草稿；先核对准确文件与内容，将它们迁到工程任务临时目录或正式需求目录，再处理 `.agents` dirty checkout 并更新。旧输入仍可只读访问，不能为了通过更新而直接删除用户产物。

agent-context-kit v0.3.1 修复普通更新把 guidanceMode 默认值追加到待确认区的问题：模板使用 `agents-update:optional-key` 声明合法可选键，缺省不写入，已有明确配置保留且不误报废弃。项目入口迁移脚本现会报告并补齐缺失的执行辅助路由；仍需显式 `--write`，该上下文维护步骤不随普通更新执行；需求入口删除的定向引用迁移是例外，见需求交付迁移说明。历史误追加项只有能确认由本次更新生成且未被用户修改时才定点移除，不按字段值 auto 批量删除。

coding-iris-plugin 0.10.0 的部署保护随既有 plugins 与 vendor 分发。必须一并更新 deploy-guard.js、deploy-protected.js、前后端入口与 protected-file.py；不新增连接配置。用户私有 .iris-deploy-state 不属于更新/清理范围。旧后端位置参数须迁移为 --demand/--files/--execute，先建立 Git 基线会话。未提交的 canonical 开发版可在核对目标无分歧后同步精确运行时文件，再用更新器 -NoPull 刷新生成层；此状态是本地待发布副本，不能声称已从远端发布。


`compile-csp.js` 随 coding-iris-plugin 既有 scripts 路径分发，无新增依赖或配置迁移。CSP 编译的连接来自项目 `.mcp.json`，虚拟根取 `project-env.json` 的 `web.cspBasePath`；更新后使用部署技能的新入口。源仓实现不代表业务副本已更新。

## Sparse 刷新与落盘验证

安装、standard 更新及旧版 runtime 恢复共用 `scripts/refresh-agents-sparse.js`。PowerShell bootstrap 从当前 `HEAD` 读取 helper，因此旧 sparse 清单未检出根 JavaScript 时也能执行；helper 随 `/scripts/*.js` 正常部署，不下载额外依赖。Node.js >=22.5.0 必须在 Git 更新前就绪，仅用于能力包工具链，不自动安装。

规则以命令参数传递，不经过 `$OutputEncoding` 管道。Windows PowerShell 5.1 + UTF-8 BOM 的 stdin 在本机 Git 2.54.0 下可复现首项路径遗漏；不能据此声称 Git `set` 不更新工作区。刷新后检查正向规则覆盖的所有 index 文件是否存在、是否仍带 skip-worktree；失败返回 `sparse-refresh-failed`，旧版恢复沿用 `workspace-context-resolver-restore-failed`。不以追加 `reapply` 掩盖输入问题。

对受版本控制的 `-text` 资产，helper 还会读取 index 属性并将工作区实际字节与 `HEAD` blob 比较；声明 filter 或 working-tree-encoding 的文件不参与原始字节比较。旧 Windows checkout 即使 Git 状态干净，也可能在新增 `-text` 后保留未变化文件的 CRLF。普通安装/升级的 sparse 刷新及 standard `Write -NoPull` 会在 Git 状态干净、全部差异仅为 CRLF→LF 时按 blob 安全收敛，保留 `core.autocrlf`；发现自定义内容、二进制差异或链接时整个修复计划停止，已有内容保留。替换前复核目标与 HEAD，写后重新校验。

`Check`、`DryRun -NoPull` 与 Overlay 只校验，不修复资产；不一致报告 `runtime-assets-invalid` 并在配置和索引生成前停止。Overlay 的共享 CapabilityRoot 应先由其所属 standard 项目完成更新或 `Write -NoPull` 修复，再逐模块刷新。不要用 `reset --hard`、强制 checkout 或更改全局换行配置处理此问题。

已有部署发布后按原 DryRun/Write 流程升级，不需清理用户配置或手改 sparse 文件。安装器更新现有副本时也拒绝 dirty checkout，fetch/pull/clone 或刷新失败立即停止。`Check`、`DryRun -NoPull` 与 Overlay 的只读/不拉取边界保持原样。本机 Windows PS5.1/PS7 验证结果见维护日志；非 Windows 矩阵由 `.github/workflows/sparse-refresh.yml` 执行，配置存在不代表已通过。

## SFTP vendor 运行时接入

`coding-iris-plugin` 的 SFTP 源码随既有 `/vendor/**` sparse 规则分发，无需扩大全局部署清单。新项目默认禁用 SFTP；依赖按 `vendor/sftp-server/requirements.lock` 安装到独立 Python 环境，更新器不安装解释器或依赖。

已有项目正常更新时自动刷新可识别的 SFTP 启动路径到 vendor，无需预先设置 runtime 或 enabled；即使 project-env.json 缺失也可根据既有 .mcp.json 迁移。DryRun 仅报告，Write 执行；显式 runtime: custom 保留。`sftp-vendor-v1` 只替换既有单参数 `sftp-server/src/main.py` 启动路径，保留解释器、env、凭据、disabled 状态及其它 MCP 服务；自定义参数报告 review-required。workspace-overlay 从 CapabilityRoot 定位工具，配置只属于 ContextRoot/WorkspaceRoot。

本次源仓维护不自动迁移业务副本。服务器不支持原子 `posix-rename` 时停止，不静默降级覆盖；无 SFTP 环境仍保留项目其它上传通道。详细迁移及验证见 [SFTP runtime](../vendor/sftp-server/README.md)。

本文是给大模型 Agent 执行的操作手册。目标是在业务项目中安装或更新 `.agents` 能力包，尽量减少人工参与。

本文件必须按步骤执行。不要凭经验改流程。不要覆盖业务项目已有上下文。

## 使用前提

- 当前目录必须是业务项目根目录。
- Git 必须是 `2.25.0` 或更新版本；`install-agents.ps1` 和 `update-agents.ps1` 使用 `git sparse-checkout` 子命令，不兼容 Git 2.21.0。
- `AGENTS.md` 是工程级唯一主入口，但缺失时不阻塞 `.agents` 首次安装；安装后通过 `project-context-maintenance` 补齐或维护。`CLAUDE.md`、`CODEBUDDY.md` 只是可选兼容 symlink。
- 所有命令示例默认从 PowerShell 执行；Windows PowerShell 5.1 创建 symlink 失败时，可在 PowerShell 中通过 `cmd.exe /c mklink` 使用 Windows 原生命令作为兼容路径。
- `.agents/config/` 默认只允许合并，不覆盖已有值；唯一的运行时路径例外是 Windows x64 上将既有 `project-env.json` 的 `mcp.serverPath` 收敛到随能力包部署的 `iris-agentic-dev.exe`，其它字段保持不变。
- `.agents/config/plugin_profile.md` 是插件启用状态事实来源；插件目录存在只表示 `available`，不表示已启用。
- `.mcp.json` 是连接事实来源。不要把 host、账号、密码、token、namespace 或远程路径写入 `AGENTS.md`、rules、memory、config 或插件。
- 安装/更新会部署 `.agents/scripts/iris-mcp.js`。standard 项目直接使用 sparse checkout 中的 canonical helper；workspace overlay 会在 `ContextRoot/scripts/` 生成 manifest-aware JS adapter，并转发到 `CapabilityRoot/scripts/iris-mcp.js`。原生 MCP 工具优先；只有运行器未暴露原生工具时才使用该 helper，不得把 helper 当成 canonical 规则源。更新后的 helper 会消费 `check_config` 版本和 capabilities，显式分类 v1.2.6 基线工具，尚未分类的后续版本工具默认进入 `--allow-write` 授权门禁，并按已知工具的 `mode` / `action` 拦截远端状态变化；默认通过 `--no-skills` 避免与能力包 vendor skills 重复。Windows x64 安装/更新在确认 vendor exe 已存在后，只收敛 `.mcp.json` 的 IRIS MCP `command` 和既有 `project-env.json` 的 `mcp.serverPath`；不创建连接配置，不修改 `.iris-agentic-dev.toml`，也不改 host、账号、密码、namespace、args、env 或其它 MCP server。
- 如果输出中出现停止条件，先停止并向用户汇报，不要继续执行破坏性操作。
- 若 `WorkspaceRoot/.agents/capability.json` 存在，按 workspace overlay 处理；`ContextRoot` 无 `.git` 是合法状态。完整两阶段流程和恢复门禁见 `docs/workspace-overlay.md`。

## Agent 执行原则

1. 先判断状态，再选择安装或更新流程。
2. 默认先 `DryRun`，确认摘要后再 `Write`。
3. 日常只看摘要；需要排障时再加 `-Detailed`。
4. 普通提示不要打断用户。只有停止条件需要用户确认。
5. 不依赖特定模型或工具的 `@文件` 语法。只要能读取本文件，就按本文件执行。

`Check` 是更新器的只读验收模式。调用插件配置迁移时，更新器会把 `Check` 映射为迁移契约中的 `DryRun`；插件迁移脚本仍只需支持 `DryRun` 和 `Write`。

standard 模式下，普通 `DryRun` 是“更新 capability 后预演本地生成层”：它会执行 `fetch --prune`，仅在本地落后 upstream 时执行 `pull --ff-only`，并刷新 sparse checkout；配置迁移、thin-index 和 adapter 等项目本地生成层仍只报告计划、不写入。需要保持 capability checkout 不变时，使用 `Check`，或显式使用 `DryRun -NoPull`。workspace overlay 无论是否传 `-NoPull` 都不会访问 CapabilityRoot 远端。

## 状态判定

在业务项目根目录检查：

```powershell
Test-Path .agents
Test-Path .agents/.git
Test-Path .agents/scripts/install-agents.ps1
Test-Path .agents/scripts/update-agents.ps1
```

按以下规则选择流程：

| 状态 | 处理 |
|---|---|
| `.agents/` 不存在 | 执行“首次安装”。 |
| `.agents/.git` 存在 | 执行“更新已安装 .agents”。 |
| `.agents/` 存在、`.agents/.git` 不存在且 `capability.json` 有效 | 执行 workspace overlay 刷新；不要求 ContextRoot 是 Git 仓库。 |
| `.agents/` 存在但 `.agents/.git` 和有效 `capability.json` 都不存在 | 停止。报告“非标准 .agents 目录”，请用户确认是否备份或删除后重新安装。 |
| 用户已经手工 `git clone` 到 `.agents/` | 视为 `.agents/.git` 存在，执行“手工 clone 后收敛”。 |
| `.agents/` 是 full clone，包含 README、LICENSE、memory 或 scripts/tests | 执行安装脚本或更新脚本刷新 sparse checkout。 |

## 首次安装

默认使用网络安装：

```powershell
iwr -UseBasicParsing https://gitee.com/skyler-cook/imedical.agents/raw/master/scripts/install-agents.ps1 | iex
```

安装后继续执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

首次安装后的更新默认处理两个基础插件 `agent-context-kit` 和 `agent-framework-evolution`；后者承接原默认根级反馈与打包技能，不自动执行反馈。`coding-iris-plugin`、`codegraph-query`、`iris-codegraph`、`extract-doc`、`i18n-iris-plugin`、`iris-interface-dev`、`iris-cure-form-dev`、`iris-external-reg` 等插件代码会随 `.agents/plugins/` 拉取，但状态为 `available` 时不会合并配置或生成 thin-index。

如果摘要没有停止条件，继续执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
```

## 安装后的上下文维护

安装或更新 `.agents` 成功后，不要直接启用领域插件。先引导用户或用户当前使用的大模型执行项目上下文维护：

```text
/project-context-maintenance
```

如果当前 Agent 工具不支持 slash command，则直接读取并执行真实 skill：

```text
.agents/plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md
```

该步骤负责维护 `AGENTS.md`、`.agents/config/project_context_profile.md`、`.agents/config/plugin_profile.md`、`.agents/rules/` 和 `.agents/memory/project-memory.md`。上下文维护完成后，再根据项目需要选择插件。选择插件时必须先读取 `.agents/plugins/<plugin>/.agents-plugin/plugin.json`：

- `initSkill` 指向该插件首次接入必须读取的真实初始化 skill。
- `dependencies`、`dependsOn` 或 `depends_on` 是依赖插件列表。
- 若依赖插件尚未在 `plugin_profile.md` 中标记为 `enabled`，先初始化依赖插件；依赖插件验收并写入 `enabled` 后，再初始化目标插件。
- 插件初始化闭环验收通过后，使用 `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin <plugin-name> -Status enabled` 机械维护状态。

脚本不会自动把依赖插件标记为 `enabled`。`enabled` 表示该插件已经完成项目上下文、配置、thin-index、脚本和入口路由的初始化闭环，不只是插件目录已存在。

医生站 AI 集成插件 `iris-imedical-doctor-ai` 复用已启用的 `coding-iris-plugin`；同步代码后仍须执行初始化，不会因更新自动启用。接入、兼容边界与专项验证见 [AI 工作站插件接入](guides/iris-imedical-doctor-ai.md)。

常见插件初始化入口：

```text
.agents/plugins/codegraph-query/skills/codegraph-query/SKILL.md
.agents/plugins/iris-codegraph/skills/iris-codegraph/SKILL.md
.agents/plugins/extract-doc/skills/extract-doc-ingest/SKILL.md
.agents/plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md
.agents/plugins/iris-cure-form-dev/skills/cure-form-init/SKILL.md
.agents/plugins/iris-external-reg/skills/iris-external-reg/SKILL.md
.agents/plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai-init/SKILL.md
```

`iris-cure-form-dev` v0.3.0 起，已初始化项目需要在本地 `.agents/config/cure_form_profile.md` 补齐 `PreviewHisuiCss`、`PreviewJqueryJs`、`PreviewHisuiJs`、`PreviewHisuiLocaleJs`、`PreviewAsscomCss`、`PreviewAdaptationCss`。v0.3.2 的新 profile 模板默认将前四项指向随能力包部署的 `.agents/vendor/hisui/`；这些字段仍是目标工程本地路径，也可在执行 `preview` 时通过 `--page-html` 从目标现有完整页面解析。更新脚本不会猜测或覆盖既有项目配置。v0.3.2 可选填写 `PreviewBrowserCommand` 固定 Chromium；使用 `common-migrate` 的项目还需从插件模板创建本地 `cure-form-common-migration-config/v1`，并填写 `CommonMigrationConfig`，业务 MapCode/RowID 不再由插件内置。

已有治疗表单部署流程还需调整为：先运行 `preview` 生成完整页面和 manifest，再运行 canonical `preview-run` 自动采集九档 Chromium Network、Console 与页面探针结果，最后运行 `preview-check` 生成 `preview-verification.json`。任何 `plan --changes` 都必须传入 `--preview-verification`；v0.3.2 的 gate v2 不接受旧 preview 凭证或人工结果，旧 changes 文件可继续使用，但必须重新生成资源、CSS 依赖、HISUI 初始化和 runner 哈希证据。

`iris-cure-form-dev` v0.4.0 为 `expectedVersion=NEW` 的新建表单增加人工交互门禁。更新不会改写现有项目 profile，也不影响存量响应式改造；新建表单在 `plan` 前必须运行 `interaction-prepare --stage pre-deploy`，由用户明确确认整体通过或由 Agent 逐项记录后运行 `interaction-check`，并将生成的 `--interaction-verification` 传给 `plan`。部署后还需生成绑定 package/operation ID 的人工清单，完成保存、重开、回显、打印和 CR 运行时契约验证。v1 不接受自动交互结果；批量脚本化点击、输入或选择必须先取得用户明确确认。

`iris-cure-form-dev` v0.5.0 将服务端事务入口固定迁移为 `DHCDoc.Cure.AI.CureFormDeploy`，不再调用或回退到旧部署类，也不新增 profile 配置项。已部署项目必须先在目标 IRIS namespace 上传并编译新类，再更新 `.agents`、重建已启用插件 thin-index，并确认所有调用方都已切换到 v0.5.0；完成这些检查后才可删除旧类。

## Windows 可选兼容入口

`CLAUDE.md`、`CODEBUDDY.md` 仅在用户明确需要对应工具兼容入口时创建。安装器和更新器只报告入口状态，不自动创建、覆盖或修复。不要复制 `AGENTS.md`，也不要直接用 `del` 或 `Remove-Item` 删除现有同名文件；现有文件可能包含尚未归并的独立规则。

是否需要兼容入口，先按 [source.md](../plugins/agent-context-kit/skills/coding-agent-adaptation/references/source.md) 核对实际宿主、版本/配置与规则加载方式；可选入口 `missing` 不等于宿主未读取 `AGENTS.md`。用户级规则路径与项目 MD 分开判断，不因目录适配成功就推断规则加载成功。

优先运行能力包自带修复脚本：

```powershell
& .\.agents\scripts\repair-agent-entrypoints.ps1 -ProjectRoot .
```

脚本会按链接解析后的路径判断目标，保留已经正确指向 `AGENTS.md` 的 symlink；`AGENTS.md` 与 `.\AGENTS.md` 等价，不会因写法不同而备份重建。遇到普通文件或真正指向其他文件的链接时，先将其依次备份为 `.bak`、`.bak.1` 等，再创建 symlink。在 Windows 上，脚本会先尝试 `New-Item -ItemType SymbolicLink`，失败后自动回退到 `cmd.exe /c mklink`。

如果需要手工创建，只能在确认同名路径不存在后，从业务项目根目录运行：

```powershell
Test-Path -LiteralPath .\CODEBUDDY.md
Test-Path -LiteralPath .\CLAUDE.md

# 仅当上面两项都返回 False 时执行
cmd /c mklink CODEBUDDY.md AGENTS.md
cmd /c mklink CLAUDE.md AGENTS.md
```

Windows PowerShell 5.1 即使已开启 Windows“开发人员模式”，`New-Item -ItemType SymbolicLink` 仍可能报告 `Administrator privilege required for this operation.`；这不表示开发人员模式未生效。此时优先使用上述修复脚本或 `cmd /c mklink`。如果 `mklink` 仍报告权限不足，再检查开发人员模式是否开启，或在获得用户明确许可后使用管理员终端。

创建后验证链接类型和目标：

```powershell
Get-Item -Force .\CLAUDE.md, .\CODEBUDDY.md |
  Select-Object Name, LinkType, Target
```

两项的 `LinkType` 都应为 `SymbolicLink`，`Target` 应指向 `AGENTS.md`。随后重新运行 `update-agents.ps1 -Mode Check`，对应入口应报告 `entrypoint-ok`。

## 手工 clone 后收敛

有些用户习惯先手工克隆仓库：

```powershell
git clone https://gitee.com/skyler-cook/imedical.agents.git .agents
```

克隆后不要手工移动文件。直接运行安装脚本收敛 sparse checkout、ignore 和入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/install-agents.ps1
```

然后运行 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

如果摘要没有停止条件，继续执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
```

## 更新已安装 .agents

先运行 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

如果摘要没有停止条件，自动继续运行 write：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
```

如果需要查看明细，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun -Detailed
```

从只部署 `/scripts/*.ps1` 的旧版 sparse checkout 跨版本更新时，旧进程可能先拉取新版脚本、再以旧 sparse 清单遗漏 `scripts/lib/**` 或根 `scripts/*.js`。新版更新器在自更新恢复、`Write`，或允许拉取的 `DryRun` 中发现 `WorkspaceContext.psm1` 缺失时，会先以当前完整运行时清单收敛 sparse checkout，并报告 `workspace-context-resolver-restored`；随后继续原更新流程。`Check` 与显式 `DryRun -NoPull` 不执行该修复，只报告 `workspace-context-resolver-missing`。若恢复失败则报告 `workspace-context-resolver-restore-failed`，此时停止并检查 `.agents` Git 状态、Git 版本和 sparse checkout。workspace overlay 会在 ContextRoot 为 `iris-mcp.js` 和 `agent-orchestrator.js` 生成 manifest-aware Node adapter，实际 canonical 仍位于 CapabilityRoot。

## Workspace overlay 两阶段更新

多个模块共享 capability 时，先在 canonical 标版根执行一次标准 DryRun/Write；再从 canonical `.agents/scripts/update-agents.ps1` 对每个模块执行 `-Mode DryRun -NoPull`，无停止条件后执行 `-Mode Write -NoPull`。overlay 阶段只刷新模块 `ContextRoot`，不会 fetch/pull capability Git。

不得颠倒顺序，也不得从模块 ContextRoot 猜测父目录 capability。命令、Junction/本地目录判定、停止条件和恢复步骤见 [Workspace Overlay 部署与恢复 Runbook](workspace-overlay.md)。

## 输出判读

以下状态通常正常，不需要用户参与：

| 状态 | 含义 |
|---|---|
| `agents-up-to-date` | fetch 后本地 `HEAD` 与 upstream 一致；跳过 pull，但仍完成 sparse checkout 刷新并继续后续本地生成层检查。结果包含 `oldHash`、`newHash` 和 `upstreamHash`。 |
| `agents-updated` | `.agents` 原本仅落后 upstream，已完成 fast-forward pull 和 sparse checkout 刷新；结果包含更新前后的 hash。 |
| `capability-pull-skipped-overlay` | 当前为 workspace overlay；按契约跳过 capability fetch/pull，只刷新 ContextRoot。 |
| `workspace-context-resolved` | 已解析 standard 或 workspace-overlay 的五类根。 |
| `junction-ok` / `local-path-ok` | overlay 的共享/源码 Junction 与本地物理目录符合 manifest。 |
| `exclude-ok` | `.agents/.git/info/exclude` 已包含生成层忽略规则。 |
| `entrypoint-ok` | `CLAUDE.md`、`CODEBUDDY.md` 等可选兼容入口正常。 |
| `entrypoint-missing` / `entrypoint-not-symlink` / `entrypoint-wrong-target` | 可选兼容入口缺失或异常；不阻塞安装/更新，脚本不会自动修复或复制。 |
| `git-hooks-not-enabled` | `.agents/hooks/pre-commit` 和安装脚本已可用，但业务项目尚未显式启用 Git hook；不会自动修改 `core.hooksPath`。 |
| `git-hooks-enabled` | 业务项目已显式将 `core.hooksPath` 指向 `.agents/hooks`。 |
| `git-hooks-unavailable` | 当前 `.agents` 中缺少 hook 模板或安装脚本；先更新 `.agents` 能力包。 |
| `plugin-found` | 已发现插件。 |
| `plugin-available` | 插件代码存在但未启用；只展示能力，不合并配置、不生成 thin-index。 |
| `plugin-init-required` | 用户显式选择了未启用插件；停止并读取真实 init skill。 |
| `plugin-selected` | 本次通过 `-Plugin` 显式选择处理的插件。 |
| `plugin-disabled` | 插件被项目显式禁用；默认跳过。 |
| `plugin-profile-written` | 已写入或刷新 `.agents/config/plugin_profile.md`。 |
| `plugin-profile-name-migration-planned` | DryRun/Check 发现 manifest 声明的旧插件名；将保留原状态并写回 canonical 名称。 |
| `plugin-profile-name-migrated` | Write 已把旧插件名的状态迁移到 canonical 名称。 |
| `generated` | dry-run 发现将生成 thin-index，或 write 已生成。 |
| `unchanged` | 生成物内容已是最新，不需要写入。 |
| `removed` | write 已清理 stale thin-index；清理阶段扫描所有指向已删除 `.agents/plugins/*/rules/*.md` 或 `.agents/plugins/*/skills/*/SKILL.md` 的受管入口，不受当前 `PluginPath` 限制。 |
|
| `vendor-thin-index-generated` | vendor thin-index 已生成或 dry-run 报告将生成。 |
| `vendor-thin-index-unchanged` | vendor thin-index 内容已是最新，不需要写入。 |
| `vendor-thin-index-stale` | vendor 源 SKILL.md 已变更或被删除，thin-index 需要更新；write 时将自动重新生成或清理。 |
| `vendor-thin-index-removed` | write 已清理过期的 stale vendor thin-index。 |
| `vendor-skill-synced` | vendor skill 已同步到运行时 skill 目录。 |
| `skill-dependency-required` | enabled/显式插件声明的 required capability，进入项目发现层。 |
| `skill-dependency-optional` | optional capability，仅记录 trigger，不在更新时安装。 |
| `legacy-runtime-skill-detected` | 在已验证工具用户目录发现历史 vendor skill；只报告，不删除。 |
| `runtime-adapter-skipped` | 未显式启用工具 adapter，继续使用 `.agents/skills` 通用层。 |
| `vendor-missing` | `.agents/vendor/` 不存在，跳过 vendor skill 同步。 |
| `skipped` 且 reason 包含 `target exists` | 目标 thin-index 已存在，默认不覆盖。 |
| `config-missing-key` | 模板有新增字段，当前项目 config 没有；dry-run 只提示。 |
| `config-merged-key` | write 已把缺失配置项追加到待确认区块。 |
| `config-deprecated-candidate` | 当前项目 config 有模板没有的字段；只提示，不删除。 |
| `config-migration-planned` | 插件迁移脚本已确认可安全生成新配置，例如通过字节校验、从 Overlay manifest 判定 backend-only，或从明确项目语义判定需求交付类型。 |
| `config-migration-applied` | write 已应用插件配置迁移。 |
| `config-migration-unchanged` | 插件迁移配置已是最新。 |
| `script-wrapper-planned` / `script-wrapper-applied` | 编码脚本将要或已经替换为指向插件 canonical 实现的薄 wrapper。 |

以下状态是停止条件：

| 状态 | Agent 行为 |
|---|---|
| `Action required` | 查看摘要下的阻塞项。必要时运行 `-Detailed` 后向用户汇报。 |
| `conflict` | 停止。报告冲突文件和来源。 |
| `config-review-required` | 停止。说明配置语义需要人工确认。 |
| `config-migration-review-required` | 停止。配置无法安全规范化，例如编码证据异常、无法判定 backend-only，或“默认需求交付类型”为 `TODO`/存在语义冲突；按 reason 提示人工补全。 |
| `config-migration-conflict` | 停止。目标应为 canonical UTF-8，但实际字节仍是 GB2312 或与 UTF-8 门禁冲突。 |
| `config-migration-failed` | 停止。插件迁移脚本缺失、异常退出或输出无效。 |
| `submodule-init-required` | 停止。前端 submodule 未初始化，无法做字节检测。 |
| `script-conflict` | 停止。目标工程编码脚本是未知或用户定制版本，更新器不覆盖。 |
| `pull-blocked-dirty` | 停止。说明 `.agents` 仓库存在本地改动，需要用户决定提交、暂存或放弃。 |
| `pull-blocked-ahead` | 停止。本地 `.agents` 分支含 upstream 没有的提交，不把它误报为远端可用更新。 |
| `pull-blocked-diverged` | 停止。本地 `.agents` 与 upstream 已分叉，需要人工处理。 |
| `agents-git-missing` | 返回非零退出码并停止。Check、DryRun、Write（含 -NoPull）均不进入 exclude 写入或后续生成；先恢复标准独立 Git 部署，不能靠创建空 .git 目录修复。 |
| `git-status-failed` / `git-head-resolve-failed` | 停止。无法确认本地工作区或 `HEAD`，不能安全判断更新状态。 |
| `git-upstream-missing` | 停止。当前分支没有可解析的 upstream，不能判断是否存在可用更新。 |
| `git-divergence-check-failed` | 停止。fetch 后无法比较本地 `HEAD` 与 upstream。 |
| `manifest-invalid` / `schema-version-unsupported` | 停止。修复 `capability.json` 后重新 DryRun。 |
| `capability-root-missing` / `capability-git-missing` | 停止。共享 capability 根缺失或不是 Git 部署。 |
| `junction-target-mismatch` / `shared-path-not-junction` / `source-path-not-junction` | 停止。只允许在确认 manifest 后显式安全修复 Junction；普通目录不得覆盖。 |
| `local-path-is-link` / `local-path-not-directory` | 停止。ContextRoot 本地层必须是物理目录。 |
| `source-root-missing` / `git-root-missing` | 停止。声明的业务源码或真实 Git 根不存在。 |
| `plugin-explicit-selection-disabled` | 停止。不得绕过项目显式 disabled 状态。 |
| `git-version-unsupported` | 停止。说明当前 Git 低于 `2.25.0`，先升级 Git for Windows 后重试。 |
| `fetch-failed` | 停止。报告网络或远端拉取失败。 |
| `pull-failed` | 停止。报告无法 fast-forward。 |
| `sparse-refresh-failed` | 停止。报告 sparse checkout 刷新失败。 |
| `runtime-assets-invalid` | 停止。运行时文件缺失或 `-text` 资产实际字节与 HEAD 不符；先核对自定义改动，仅确认的历史换行差异可由所属 standard 项目的 Write 修复。 |
| `runtime-assets-verified` | 运行时文件已落盘，参与原始字节校验的资产与 HEAD 一致。 |
| `workspace-context-resolver-missing` | 停止。只读模式发现 `scripts/lib/WorkspaceContext.psm1` 缺失；改用允许拉取的 DryRun 或经确认的 Write 触发旧 sparse checkout 恢复。 |
| `workspace-context-resolver-restore-failed` | 停止。旧 sparse checkout 自动恢复失败；检查 `.agents` 是否为干净的独立 Git checkout、Git 版本和 sparse 状态。 |
| `thin-index-script-missing` | 停止。报告插件缺少 thin-index 脚本。 |
| `agent-thin-index-script-missing` | 停止。报告 `.agents/scripts/generate-agent-thin-index.ps1` 缺失；先更新 `.agents` 能力包。 |
| `vendor-skill-sync-script-missing` | 停止。报告 `.agents/scripts/sync-vendor-skills.ps1` 缺失；先更新 `.agents` 能力包。 |
 | `vendor-thin-index-script-missing` | 停止。报告 `.agents/scripts/generate-vendor-thin-index.ps1` 缺失；先更新 `.agents` 能力包。 |
| `sync-claudecode-skills-script-missing` | 停止。报告 `.agents/scripts/sync-claudecode-skills.ps1` 缺失；先更新 `.agents` 能力包。 |
 | `agents-entry-missing` | 提示。项目主入口缺失；安装或更新 `.agents` 后，通过 `project-context-maintenance` 补齐或维护，不要复制本仓库根 `AGENTS.md`。 |
| `plugin-init-required` | 停止。读取该插件真实 init skill，完成初始化闭环后用脚本标记为 enabled。 |
| `plugin-dependency-missing` | 停止。先初始化依赖插件，不要只因插件目录存在就继续。 |

## coding-iris 前端编码 v3 迁移

当前标版与医院项目的前端源码、上传内容和服务器运行编码统一使用 canonical `utf8`。旧 `project-utf8` 是兼容读取别名；旧 `standard-gb2312` 只服务用户明确指定的历史工程，不再由组合仓库名称、目录结构或 Git 角色自动推断。实际文件字节检测始终是最终门禁。

workspace-overlay 的 manifest 若明确至少声明一个 `backend` SourceRoot 且没有 `frontend` SourceRoot，迁移器将旧 `TODO`、`utf8` 或兼容模式规范化为 `N/A (backend-only)`，并写入 v3 managed marker；它不会扫描父目录或 sibling。空 SourceRoot、只有未知角色或其它无法证明 backend-only 的声明仍返回 `config-migration-review-required`。后续新增 `frontend` SourceRoot 时，重新运行迁移并通过 UTF-8 字节门禁后，N/A 会规范化为 `utf8`。

旧版 `update-agents.ps1` 在第一次运行过程中即使拉取了新版脚本，也不会在同一 PowerShell 进程中执行新迁移钩子。已部署工程按以下两阶段流程处理：

```powershell
# 第一阶段：拉取新版能力包和更新器
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write

# 第二阶段：用新版更新器预览并应用 coding 插件迁移
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun -NoPull -Detailed -Plugin coding-iris-plugin
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write -NoPull -Detailed -Plugin coding-iris-plugin
```

迁移器只在标准工作区已发现的前端根或 workspace-overlay 明确声明的 `sourceRoots[name=frontend]` 中抽检字节：UTF-8 或纯 ASCII 根可将旧 profile 安全规范化为 `utf8`；GB2312、mixed、UTF-16 或 unknown 会阻塞，不自动批量转码业务源码。任何 review-required/conflict 未处理前，Agent 不得继续前端写入或部署。

迁移继续生成 `check-frontend-encoding.ps1` wrapper；`convert-gb2312-upload.ps1` wrapper 仅为历史工程兼容保留。当前 UTF-8 部署直接上传通过门禁的原始源文件，不生成 `*.gb2312.*` 临时件。

## coding-iris 需求交付类型 v1 迁移

`coding-iris-plugin` v0.6.0 起，`iris_project_profile.md` 使用 `默认需求交付类型：standard | project | TODO` 控制普通需求的提交收尾策略。`standard` 表示标版、标准版或通用产品需求；`project` 表示医院项目、客户定制或项目实施需求。

已部署工程更新时，`demand-delivery-type-v1` 迁移器读取 `iris_project_profile.md`、`project_context_profile.md` 和项目 `AGENTS.md` 的非敏感语义：只有明确出现“标版/标准版/通用产品/通用多产品”等语义时写入 `standard`，只有明确出现“医院需求/医院项目/客户定制/项目版/项目实施”等语义时写入 `project`。合法现值始终优先；目录名、`contextMode`、remote、upstream 和代码量不作为推断依据。

没有明确证据或两类语义冲突时，Write 会补入 `TODO` 并返回 `config-migration-review-required`：

```text
默认需求交付类型仍为 TODO，请确认该工程默认处理 standard（标版）还是 project（项目）需求。
```

处理该停止项时，只修改目标工程本地 `.agents/config/iris_project_profile.md` 的该字段，保留其它配置。补全前，`iris-coding` 可以继续普通编码，但 `demand-commit` 不得生成可执行提交计划或执行 commit。

## Agent thin-index

更新脚本会在插件处理之外独立运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/generate-agent-thin-index.ps1 `
  -ProjectRoot . `
  -Mode DryRun
```

`Write` 模式会为 `.agents/agents/*-agent/AGENT.md` 生成浅层入口：

```text
.agents/skills/<agent-name>/SKILL.md
```

这些文件只做路由：要求继续读取 canonical `AGENT.md`、`bindings.yaml`、默认 workflow、agent registry 和 workflow registry。它们不是 Codex、Claude Code、OpenCode 或 CodeBuddy 的工具 adapter，也不复制插件规则全文。

已部署项目不需要重新安装；常规 `update-agents.ps1 -Mode DryRun` 会报告缺失的 agent thin-index，确认无停止条件后执行 `-Mode Write` 即可补齐。若 canonical agent 被删除，脚本只清理带有 agent thin-index 标记且指向 `.agents/agents/*/AGENT.md` 的过期入口，不会删除插件 skill thin-index 或项目自定义 skill。

## Vendor skill 按依赖发现

enabled 插件的 availableDependencies 复用只读检查，输出 plugin-availability-ready / plugin-availability-warning；警告不阻断独立能力，实际阶段检查失败才停止。此关系不加入 vendor 依赖递归或自动启用。声明、命令与升级方式见[可用性依赖](plugin-availability.md)。

`vendor/` 是随能力包部署的 fallback 源，不是默认安装列表。`update-agents.ps1` 调用 `resolve-plugin-skill-dependencies.ps1`，递归汇总 enabled 插件、显式选择插件及其插件依赖；manifest 中 `skillDependencies.required` 自动进入项目发现层，`optional` 只在任务命中 trigger 后按需读取。

`coding-iris-plugin` 引入的 `iris-agentic-dev-skills` 属于 optional vendor skill：更新脚本会把 v1.5.0 固定提交的 8 个 skill 快照同步到 `.agents/vendor/iris-agentic-dev-skills/`，但不会自动生成 `.agents/skills` thin-index。需要直接使用这些官方 skill 时，可从 vendor 路径读取，或由目标 runtime 的显式同步选项生成入口；`objectscript-tdd` 仍受任务级编译/测试授权约束，`iris-mcp-lookup` 本身仍由插件 canonical skill 提供。

新建目标工程从 `project-env.template.json` 生成 `.mcp.json` 时默认写入 `--no-skills` / `IRIS_NO_SKILLS=true`。已有工程更新能力包时，仅按下节规则收敛 MCP server 路径；其它 `.mcp.json` 和 `project-env.json` 字段保持不变。如需采用该默认值，应人工在本地 `mcp.includeBuiltInSkills=false` 后重新生成，或在既有 MCP 配置中显式加入 `--no-skills`。确需上游 skill registry、KB 或学习工具时可本地设置 `mcp.includeBuiltInSkills=true`，不得把连接事实一并提交。

用户级目录已有同名 SKILL.md 时，同步器报告 vendor-skill-reused 并保留原内容，不比较版本或覆盖旧副本。需要新版时优先直接读取项目 vendor；确需替换用户级副本，应先核对来源和用户修改，再单独执行明确授权的更新。

## iris-agentic-dev vendor 运行时优先

Windows x64 安装或更新完成后，`scripts/prefer-vendor-iris-mcp.ps1` 优先使用：

```text
.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe
```

行为边界：

- `.mcp.json` 已存在且能唯一识别 IRIS MCP server 时，只把该 server 的 `command` 改为上述项目相对路径；其它 server、`args` 和 `env` 原样保留。
- `.agents/config/project-env.json` 已存在 `mcp` 配置时，同时收敛 `mcp.serverPath`，避免以后重新生成 `.mcp.json` 时回退到外部 exe。
- 没有 `.mcp.json` 和 `project-env.json` 时报告 `mcp-vendor-command-not-configured`，不猜测或创建连接配置。
- DryRun/Check 报告 `mcp-vendor-command-planned` 但不写文件；Write 成功报告 `mcp-vendor-command-applied`；已经一致报告 `mcp-vendor-command-unchanged`。
- Write 在返回 `mcp-vendor-command-applied` 前会重新读取并校验两份实际落盘文件；任一目标未写成预期路径时返回 `mcp-vendor-command-write-failed`，并尽力按原始字节回滚本轮涉及的配置文件。
- vendor exe 缺失、JSON 无法解析或存在多个候选时保留原配置，并分别报告 `mcp-vendor-executable-missing`、`mcp-vendor-config-invalid` 或 `mcp-vendor-command-ambiguous` 作为停止条件。
- 非 Windows 平台保留项目现有命令并报告 `mcp-vendor-command-skipped-platform`，因为当前内置二进制仅支持 Windows x64。

当前受支持的已部署更新器会在拉取到新版 `update-agents.ps1` 后自重启，因此一次 Write 即可继续执行 vendor 路径收敛。回归测试使用本地 Git 远端模拟“项目仍运行不含此能力的旧脚本、远端已发布新版脚本”的升级过程，并验证同一次 Write 更新 `.mcp.json` 和 `.agents/config/project-env.json`，第二次 Write 保持字节级不变。

无法给任意历史版本的已加载 PowerShell 进程追加它启动时并不存在的逻辑。若项目中的更新器早于自重启机制，使用以下两次 Write 作为确定性兼容流程：第一轮只需确保拉取新版能力包，第二轮明确使用已落盘的新更新器完成配置收敛；第二轮不再联网。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write -NoPull -Detailed
```

第二轮应报告 `mcp-vendor-command-applied` 或 `mcp-vendor-command-unchanged`；其它 `mcp-vendor-*` 状态必须按上面的停止条件处理，不能宣称配置已成功更新。

`mcp-vendor-command-applied` 后应重启或重新加载当前 MCP session，让运行器按新 `command` 启动 vendor exe。回退时可手工恢复项目命令，但后续 Windows Write 更新仍会再次收敛到 vendor；若 vendor 不可用，更新器不会删除项目原有 fallback。

核心解析和 manifest 不包含 Claude Code、Codex、OpenCode、CodeBuddy、WorkBuddy 或 Hermes 的用户目录与调用语法。`.agents/skills/` 是跨工具通用层；工具不能发现 thin-index 时，按入口说明直接读取其 `source`。工具没有 skill 或 subagent 能力时，按 canonical Markdown 串行执行。

`update-agents.ps1` 只为解析出的 required skill 调用：

```powershell
.agents/scripts/generate-vendor-thin-index.ps1 -AgentsRoot .agents -ProjectRoot . -Skill <required-skill[]> -Mode DryRun|Write
```

该脚本只为显式 `-Skill` 集合生成或维护 thin-index。普通 Write 不清理历史入口，避免把旧工程中新生成的默认 `available` 状态误判为“从未使用”。

- `vendor/<vendor-name>/skills/<skill-name>/SKILL.md` → `.agents/skills/<skill-name>/SKILL.md`
- `vendor/<vendor-name>/SKILL.md` → `.agents/skills/<vendor-name>/SKILL.md`

生成的 thin-index 保留原始 SKILL.md 的 `name` 和 `description`，补充 `thin-index: true` 和 `source` 指向 vendor 真实路径。Agent 匹配后必须继续读取 `source` 指向的真实 SKILL.md。

只有显式传入 `-CleanupLegacyVendorSkills` 时，才清理不在 required 集合中的受管 vendor thin-index。清理只识别同时包含 `thin-index: true` 且 `source` 指向 `.agents/vendor/` 的项目入口；不会删除项目自定义、插件或 agent thin-index，也不会删除任何工具的用户级 skill。

配置生效方式：

- DryRun 只输出摘要，不写入文件、不清理过期项。
- Write 只补齐 required 入口。
- `-CleanupLegacyVendorSkills` 的 DryRun/Write 单独报告或执行兼容清理。

## 工具运行时显式同步

常规安装和更新不再写入用户级 skill 目录。只有明确需要 Claude Code 或 Codex 用户级副本时才执行：

```powershell
.agents/scripts/sync-vendor-skills.ps1 -AgentsRoot .agents -ProjectRoot . -Skill brainstorming -Runtime ClaudeCode -Mode DryRun
.agents/scripts/sync-vendor-skills.ps1 -AgentsRoot .agents -ProjectRoot . -Skill brainstorming -Runtime ClaudeCode -Mode Write
```

`Write` 必须显式提供 `-Skill`；无参数全量同步会以 `vendor-skill-selection-required` 拒绝。目标已有 canonical skill 时报告 `vendor-skill-reused`，不覆盖。用户级 vendor 同步不为 CodeBuddy、OpenCode 等工具生成额外目录；CodeBuddy 的项目级链接接入见下文。

项目级 Claude Code 发现层同样改为显式启用：常规更新默认不修改 `.claude/skills`；确有需要时向 `update-agents.ps1` 传入 `-RuntimeAdapter ClaudeCode`。未指定 adapter 时报告 `runtime-adapter-skipped`。

## 已部署工程迁移

旧工程无需重装。更新器拉取到自身新版本时会带防循环标记自动重启新版脚本，再执行后续阶段，避免旧进程继续执行全量 vendor 同步。

1. 先运行常规 DryRun；无 `plugin_profile.md` 且存在历史 vendor thin-index 时会报告 `legacy-vendor-profile-review-required`，历史入口保持不变。
2. 使用 `update-plugin-profile.ps1` 确认实际使用插件为 `enabled`；自动发现的新插件仍保持 `available`。
3. 普通 Write 停止继续全量扩散并补齐 required 入口，不清理历史入口或用户级副本。
4. 验证 required skill 可加载后，单独运行带 `-CleanupLegacyVendorSkills` 的 DryRun；确认清单后再执行对应 Write。

用户级历史副本可能被多个项目共享，更新器永不自动删除。项目 `AGENTS.md`、memory/rules、已有 config 值和工具配置也不因本迁移被覆盖。

## Git hook 可选启用

`.agents` 会随安装或更新分发提交前差异降噪能力，但不会自动启用：

- `.agents/hooks/pre-commit`
- `.agents/scripts/check-functional-diff.ps1`
- `.agents/scripts/install-git-hooks.ps1`

启用必须由业务项目用户显式执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/install-git-hooks.ps1 -ProjectRoot .
```

该命令只在当前业务项目 Git 仓库写入：

```powershell
git config core.hooksPath .agents/hooks
```

验证：

```powershell
git config --get core.hooksPath
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/check-functional-diff.ps1 -ProjectRoot . -Staged
```

禁用或回退：

```powershell
git config --unset core.hooksPath
```

`check-functional-diff.ps1` 只检查 staged diff。它允许正常代码编写产生的局部缩进、空行和对齐；会阻断纯空白变更、`git diff --cached --check` 失败，以及疑似整文件格式化噪音。真实格式化需求应拆成独立提交；手动检查时可使用 `-AllowFormatting` 明确豁免，默认 pre-commit 不放行混合功能和格式化提交。


## 跨 Agent skills 链接适配

`-RuntimeAdapter <宿主>` 统一调用 `sync-runtime-skills.js`，保留既有命名映射；宿主真实项目目录、项目 MD 与映射差异统一查 [source.md](../plugins/agent-context-kit/skills/coding-agent-adaptation/references/source.md)。先核对目标版本与执行器实际目标，不从用户级目录推导项目路径；需要不同目录时使用 Node 入口的 `--runtime Custom --skills-dir`，不传给 PowerShell 更新器。普通目录、错误或失效链接保留并阻断适配，更新器以失败结束，已完成的其它更新步骤不回滚。Check 只读检查技能目录，缺失技能链接不算目录接入通过，不检查项目 MD 加载。首次安装脚本也支持同名参数；完整命令、平台证据与旧目录迁移见 [技能适配](coding-agent-adaptation.md)。

## Claude Code legacy 复制入口

以下旧复制入口仅为历史调用保留；统一更新器已使用链接，不再调用它。旧目录不会自动迁移，已有链接拒绝复制。只有明确需要旧复制模式时运行：

```powershell
.agents/scripts/sync-claudecode-skills.ps1 -ProjectRoot . -Mode DryRun|Write
```

脚本自动去重，按优先级跳过已存在的 skill：

1. **用户级插件**：`~/.claude/plugins/**/skills/<skill>/SKILL.md`（插件作为 skill 提供者优先）
2. **用户级 skill**：`~/.claude/skills/<skill>/SKILL.md`
3. **项目级 skill**：`.claude/skills/<skill>/SKILL.md`（已同步的）

对于需要同步的 skill，脚本自动将其 `source` 路径从相对路径替换为项目绝对路径，确保 Agent 能定位到真实 skill 文件。

输出状态：
- `skipped` — 已由去重源提供，不覆盖
- `unchanged` — 内容一致，不需要写入
- `generated` — dry-run 报告将生成，write 已同步

## Rule task-affinity

插件 rule thin-index 可带 YAML frontmatter，用于浅层发现和任务筛选：

```yaml
---
name: iris_coding_frontend
description: Use when implementing or modifying CSP, JavaScript, CSS, or HISUI frontend code.
task-affinity: [iris, csp, javascript, frontend, hisui, coding]
thin-index: true
source: .agents/plugins/coding-iris-plugin/rules/iris_coding_frontend.md
---
```

`task-affinity` 只是路由提示，不是常驻读取要求。Agent 认为任务匹配后，仍必须继续读取 `source` 指向的插件真实 rule；不匹配时不要为了“保险”加载全部规则。插件 `references/` 仍由真实 rule 或 skill 按需引用，不生成 `.agents/rules/` 浅层入口。

## Skill thin-index description

已启用插件的 skill/rule 薄索引在普通 `Write` 中自动刷新生成的元数据，无需 `-ForceThinIndex`。内容一致报告 `unchanged`，受管内容变化报告 `updated`；`DryRun` / `Check` 报告 `thin-index-stale` 且不写文件，其中 `Check` 以失败结束，需执行 `Write` 后重新验收。不存在的入口仍按原流程生成。

受管识别要求来源、标记及生成正文匹配，且不存在额外 frontmatter 字段；只有生成字段（skill 的 `name` / `description`，rule 另含 `task-affinity` / `related`）允许变化。直接修改这些生成字段会在更新时被源文件覆盖；项目定制应放在项目独立规则或配置。正文定制、来源不符、未知结构及目标或父目录链接保留并报告 `thin-index-conflict`，更新器以失败结束。`-ForceThinIndex` 对插件索引保留参数兼容，但不再越过归属保护；agent/vendor 独立生成器的既有语义不变。历史 root skill 迁移继续允许已知原文哈希，迁移后的受管索引可正常刷新。

已部署工程先更新能力包，再执行原有 `Write` / `Check`；无需删除旧索引。Overlay 先更新共享 CapabilityRoot，再逐 ContextRoot 执行 `Write -NoPull`。本行为只覆盖插件 skill/rule 通用生成器，不自动同步用户级技能副本。历史无 frontmatter 的 rule 若内容完全一致仍保留，无法确认归属的差异须人工核对。

插件 skill thin-index 会传播真实 `SKILL.md` 的 `name` 和 `description`，并补充：

```yaml
thin-index: true
source: .agents/plugins/<plugin>/skills/<skill>/SKILL.md
```

浅层 `.agents/skills/<skill>/SKILL.md` 的 `description` 用于能力发现和触发判断。匹配后仍必须继续读取 `source` 指向的插件真实 `SKILL.md`，因为 thin-index 不复制完整流程、规则路由或安全约束。

## 插件状态分流

`.agents/plugins/**` 全量拉取用于能力发现，但更新脚本按 `.agents/config/plugin_profile.md` 分流：

| 状态 | 更新行为 |
|---|---|
| `available` | 只报告，不合并 templates，不生成 thin-index，不修改 `AGENTS.md`。 |
| `enabled` | 项目已接入且初始化闭环已完成，参与常规更新：合并缺失 config key，校验或重建 thin-index。 |
| `disabled` | 默认跳过；旧 thin-index 只报告，不自动删除。 |

无 `plugin_profile.md` 时，默认把 `agent-context-kit` 和 `agent-framework-evolution` 视为基础 `enabled` 插件，其它插件视为 `available`。

启用领域插件时，不要直接运行全量 update。先读取插件真实 init skill：

```text
.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md
.agents/plugins/codegraph-query/skills/codegraph-query/SKILL.md
.agents/plugins/iris-codegraph/skills/iris-codegraph/SKILL.md
.agents/plugins/extract-doc/skills/extract-doc-ingest/SKILL.md
.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md
.agents/plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md
.agents/plugins/iris-cure-form-dev/skills/cure-form-init/SKILL.md
.agents/plugins/iris-external-reg/skills/iris-external-reg/SKILL.md
```

按 manifest `dependencies` 顺序初始化依赖：`codegraph-query` 依赖 `iris-codegraph`，`iris-codegraph` 和 `i18n-iris-plugin` 依赖 `coding-iris-plugin`；`iris-interface-dev`、`iris-cure-form-dev` 和 `iris-external-reg` 依赖 `extract-doc`、`coding-iris-plugin`。依赖未启用时，目标插件初始化必须停止；不能只因插件目录存在就继续。

更新到 `iris-cure-form-dev` v0.3.2 后，检查本地 `cure_form_profile.md` 的六个资源字段；按需追加 `PreviewBrowserCommand` 和 `CommonMigrationConfig`，不要覆盖既有项目配置。下一次带 changes 的部署计划前必须按 `preview` → `preview-run` → `preview-check` 重新生成 gate v2 凭证；该凭证不会跨 snapshot、changes、资源、CSS 依赖、runner 或 gate 变更复用。

更新到 v0.4.0 后，存量表单流程保持兼容；只有 `expectedVersion=NEW` 的新建表单必须在 `plan` 前追加 `interaction-prepare` → 人工测试 → `interaction-check`，并传入 `--interaction-verification`。用户明确反馈测试通过可形成总体确认，Agent 自测必须逐项记录；部署后人工验证未通过时不得宣告任务完成，也不得自动回滚。

更新到 v0.5.0 前，先确认目标 IRIS namespace 已编译 `DHCDoc.Cure.AI.CureFormDeploy`。更新和 thin-index 重建完成、全部调用方均不再使用旧插件后，才删除旧部署类；canonical 不提供旧类 fallback。

插件 init skill 验收通过后，用统一脚本反写状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-plugin-profile.ps1 `
  -ProjectRoot . `
  -Plugin coding-iris-plugin `
  -Status enabled
```

## config 合并规则

- 已存在字段以业务项目当前值为准。
- 模板新增字段只追加到配置文件末尾的待确认区块。
- 疑似废弃字段只报告，不删除。
- 字段语义变化只报告 `config-review-required`，等待用户确认。
- 不要把敏感连接信息写入 `.agents/config/`。

## 何时自动继续

满足以下全部条件时，Agent 可以从 `DryRun` 自动继续到 `Write`：

- 没有 `Action required`。
- 没有 `conflict`。
- 没有 `config-review-required`。
- 没有 `pull-blocked-dirty`。
- 没有 `pull-blocked-ahead` 或 `pull-blocked-diverged`。
- 没有 `git-status-failed`、`git-head-resolve-failed`、`git-upstream-missing` 或 `git-divergence-check-failed`。
- 没有 `agents-git-missing`。
- 没有 `git-version-unsupported`。
- 没有 `fetch-failed`、`pull-failed` 或 `sparse-refresh-failed`。

兼容入口提示不属于停止条件。不要为了消除 `entrypoint-missing`、`entrypoint-not-symlink` 或 `entrypoint-wrong-target` 而复制 `AGENTS.md`；只有用户明确需要时，才运行 `repair-agent-entrypoints.ps1` 创建 symlink。

如果不满足，停止并汇报阻塞状态。不要猜测用户意图。

## 验收标准

完成安装或更新后，检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Check
```

验收结果应满足：

- `.agents` 是独立 Git 仓库。
- `.agents/scripts/lib/WorkspaceContext.psm1` 存在；跨旧版 sparse checkout 更新时可出现一次 `workspace-context-resolver-restored`，后续 Check 不应再报告缺失。
- `.agents/agents/agent-registry.md` 存在。
- `.agents/workflows/workflow-registry.md` 存在。
- `.agents/skills/<agent-name>/SKILL.md` 中的 agent thin-index 存在或 dry-run 明确报告将生成；至少验证 `i18n-agent`、`iris-change-agent` 和 `coordinator-agent` 分别指向对应 canonical `AGENT.md`、`bindings.yaml` 与默认 workflow。
- `.agents/scripts/agent-orchestrator.js` 已部署，`node .agents/scripts/agent-orchestrator.js help` 可运行；它只生成 adapter actions，不直接执行产品 API。
- 业务项目 `.agents/skills/agent-kit-maintenance/` 不存在；该维护者专用 skill 只保留在能力包源仓根 `.agents/skills/agent-kit-maintenance/`，源仓 `.agents/` 不在 sparse checkout 部署清单内。若历史部署或手工 full clone 已遗留该目录，执行 `update-agents.ps1 -Mode Write` 会继续清理并报告 `maintenance-only-skill-removed`。
- enabled 插件 required vendor thin-index 已存在或 DryRun 明确报告生成计划；optional 只显示 trigger。
- 普通更新没有写用户级 skill 目录；历史副本只报告 `legacy-runtime-skill-detected`。
- 未指定工具 adapter 时报告 `runtime-adapter-skipped`；显式选择目录链接 adapter 时，目录链接结果为 `runtime-adapter-planned` / `runtime-adapter-linked` / `runtime-adapter-unchanged`；冲突保留并停止。
- `.agents/.git/info/exclude` 包含 `/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`、`/work/`。
- `.agents/config/plugin_profile.md` 存在或 dry-run 明确报告默认插件状态。
- 如果业务项目有 `AGENTS.md`，兼容入口可以是 `entrypoint-ok`，也可以缺失；缺失或异常只作为可选提示，不应在 write 中自动修复。
- 插件能被扫描到；未启用插件只应显示为 `available`，不应生成 thin-index。
- 没有停止条件。

最后向用户汇报：

- 是否完成安装或更新。
- 是否执行了 `Write`。
- 是否存在需要人工确认的配置项。
- 是否存在未处理的阻塞项。

## 电子健康卡入口兼容修复

`imedicalxc-doctor-extend-engineer` v1.0.1 恢复只暴露主编排器的约定。常规更新直接调用 canonical 生成器，读取 manifest 的 `thinIndex.excludeSkills` 后，电子健康卡领域子 skill 不再独立生成浅层入口。canonical 生成器对被排除 skill 的旧文件执行精准清理：仅处理 `thin-index: true` 且来源与当前子 skill 精确匹配的受管 `SKILL.md`，DryRun 报告 stale，Write 删除该文件；自定义文件、其它文件、非空目录与链接保留；当前生成器也清理排除项的历史空目录，详见下文纯初始化 skill 薄索引迁移。后续从主编排器加载该子 skill，架构前置条件仍须通过。

项目侧检查技能发现、旧入口清理及自定义内容保留；源仓专项测试由框架维护者执行。源仓更新不代表业务项目副本已同步。

`coding-iris-plugin` 当前 v0.9.0 包含 v0.8.0 引入的统一前端部署入口，默认本地计划、显式执行。用法见 `plugins/coding-iris-plugin/scripts/iris-tools/README.md`。

## 框架演进的项目入口迁移

能力包更新会带来新的 shared 协议、规则和模板，不会自动重写项目自有 AGENTS.md、rules/project.md 或 project_context_profile.md。不要把源仓维护者 AGENTS.md 部署到项目。

在已授权目标项目执行既有更新流程后，用 project-context-maintenance 定点合并：

1. 保留项目业务事实、自定义约束和用户修改；将第三个文件强制 full 改为引用 iris_coding_general 的风险判断。
2. 将每次编码后加载上下文维护改为：稳定项目事实变化、入口失效、配置变化或用户要求时才加载。
3. 保留 acceptance-pending 与用户验收，将验收后无条件 feedback 改为发现框架缺陷、规则冲突、可复用新经验或用户要求时只读审查；写入按 [feedback skill 的统一授权契约](../plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md#写入授权与自动待审补丁)核对当前有效授权。普通更新不新增自动待审补丁权限，项目明确批准该模式后在其范围执行。
4. 增加 .agents/agents/_shared/execution-guidance.md 路由。profile 缺少 guidanceMode 按 auto 读取，只有用户明确选择时才落盘 auto/concise/assisted；不按模型名称自动改配置。
5. 检查共享协议和 thin-index source 实际存在；通用/前端/后端/i18n 入口均引用同一分流。无关项目内容逐字保留，有自定义冲突时列明差异，不整体替换。

迁移辅助脚本位于 agent-context-kit/scripts/migrate-execution-entry.js，默认报告精确已知句子的替换和缺失的辅助协议路由，--write 仅在授权目标项目使用；无法识别的自定义表述报告人工检查。它不接入安装器/更新器，不写 profile，不删除文件，不扫描其它工程。项目入口迁移与能力包更新分别验收。真实业务副本本次不自动同步。

## 根级技能归属迁移

三个原根级技能迁入 owner 插件，项目原名路径不变。普通 Write 会生成薄索引；已知历史原文（BOM/CRLF 归一化后 SHA-256）自动转换，自定义文件或链接报告 `skill-owner-migration-conflict` 并以失败结束。禁用状态不覆盖；CodeBuddy/Claude Code 的技能目录链接不重建。完整步骤、标准/Overlay 边界与验证见 [技能归属迁移](skill-plugin-migration.md)。

## 已有上下文的日常优化

能力包更新与项目内容优化分别执行。用户授权目标项目优化后，用 `project-context-maintenance` 的日常优化路径，按实际内容合并重复入口、按需拆分领域记忆、标记旧快照及清理无信息占位；保留自定义约束、有效配置与技能路由。初始化仍完成对应闭环，事实维护只更新相关 owner。无需重新初始化、扫描候选插件或生成新的模式字段；更新器不自动重写业务 AGENTS/rules/memory。仅授权 canonical 更新时不处理任何业务副本。

规则入口缺失、断链或读取路径变化时，在授权的项目维护中按[规则路由维护](../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md#规则路由维护)补齐并走查到真实正文；沿用已有等价索引或直接路由。普通更新只取得新版指导与生成层刷新，不自动补建项目总索引，不修改客户端配置；文件链通过与宿主实际加载分别报告。

### 知识库工程入口迁移

agent-context-kit 0.3.4 补齐 AGENTS 模板与定点维护流程。更新能力包并重建已启用插件 thin-index 后，在授权的项目上下文维护中核对 coding-iris-plugin 为 enabled、`.agents/skills/iris-imedical-knowledge/SKILL.md` 可达，再将模板“知识资料”一条合并到工程 AGENTS 的按任务读取部分；已有等价入口不重复添加。未启用则跳过，standard/Overlay 使用相同本地入口。保留自定义内容，不复制完整知识索引；普通 update-agents 不自动重写业务 AGENTS。

## task-handoff 0.4 接入补充

`agent-context-kit` 0.4.0 增加通用需求接续入口，具体使用见 [task-handoff](task-handoff.md)。能力包更新沿用现有流程，enabled 插件刷新薄索引后可显式调用；available/disabled 保留，不因目录存在自动启用。无需更改安装器、更新器或 sparse 规则：实现和模板属于既有 plugins 范围，共享 helper 属于既有 scripts/lib 与根 scripts/*.js 范围。

项目自然语言发现路由仅在已授权初始化/上下文维护中按模板定点合并，普通更新不重写 AGENTS。具体需求首次启用时才建立项目 docs/handoff，并在管理该目录的业务 Git 仓库本地 exclude 精确排除；不是能力仓库生成层，不加入 `.agents` sparse。旧交接、正式 run 与个人 skill 不迁移、不清理，业务工程不自动同步。

## 纯初始化 skill 薄索引迁移

纯 bootstrap/init skill 由 owner manifest 的 `thinIndex.excludeSkills` 显式排除，初始化 wrapper 与常规更新均复用根生成器。`initSkill` 仍用于发现真实初始化入口；不能据此字段或技能名后缀自动排除：project-context-maintenance、codegraph-query、extract-doc-ingest 等兼任日常能力的入口继续生成薄索引。

本次覆盖 coding-iris-init、i18n-project-init、cure-form-init、iris-interface-init、iris-imedical-doctor-ai-init、imedicalxc-doctor-perf-analysis-engineer-init、agent-framework-evolution-init。

已部署项目先取得本次能力包版本，再沿原更新入口执行 Check 或 DryRun -NoPull 检查，随后 Write -NoPull 应用；无需 Force 或另加清理开关。对 enabled 插件，Check/DryRun 报告 stale 且不改文件，Write 删除 YAML frontmatter 中 thin-index: true、source 与当前排除 skill 精确匹配的受管 SKILL.md，重复更新不再生成。删除受管索引后若目录完全为空（含隐藏项检查），同时删除该目录；上次更新已留下的空目录也按排除清单定点清理。仅删除目标 ContextRoot/skills 下的排除项空目录，不递归删除；非空目录、其它文件、非受管文件、来源不匹配文件及链接均保留；保留项如仍需移除须单独核实归属。available/disabled 插件继续按原状态跳过，不借迁移自动启用或删除其入口。

standard 与 Overlay 均在目标 ContextRoot 清理，不删除 CapabilityRoot 的真实 init skill。后续初始化或检查直接读取 manifest 指向的插件真实 SKILL.md。运行时技能目录采用链接接入时随之生效；历史独立复制到工具目录或用户目录的文件不在本次自动清理范围。

## BOS 插件接入

bos-plugin 随既有 /plugins/** 与 workflow 分发，默认 available；仅明确接入后通过 [bos-init](../plugins/bos-plugin/skills/bos-init/SKILL.md) 启用。enabled 生成 bos-demand-query、bos-demand-handle、bos-demand-entry、bos-code-update-log 四个项目 thin-index；bos-init 按 manifest 排除。available/disabled 不生成新入口；已有定制内容沿用冲突保护，不强行覆盖。

项目主动执行既有更新流程取得能力。Overlay 共享 CapabilityRoot 只更新一次，各 ContextRoot 用 -NoPull 刷新生成层。不需要更改安装器/更新器核心；源仓维护不自动同步工程或用户级入口。

0.5.0 的需求处理流程在全部本地提交校验成功后自动准备代码日志计划，BOS 写入仍需当前需求与提交范围的明确授权。已有工程按上述更新步骤取得 workflow 与刷新后的 handle 索引；配置格式沿用 0.4.0，无新增迁移或旧文件清理。日志配置未完成只保留补录待办，不撤销本地提交；具体流程见 [提交后日志编排](../workflows/bos-demand.workflow.md#提交后的-bos-代码更新日志)。

### BOS 0.4.0 共享配置迁移（breaking）

查询与日志共用 BOS_MCP_CONFIG 指向的仓外 JSON，顶层按 bos-demand-query 与 bos-code-update-log 分段，凭据分别填写。新版本不再读取旧平铺/mcpServers/仅身份配置、连接环境变量回退或编辑器设置；查询参数与人员/组显式覆盖不变，客户端 stdio 注册仍只需传共享文件路径。

已有有效平铺文件由使用者明确执行新版查询脚本 migrate-config <原文件绝对路径>，原地保留查询对象并增加日志 TODO 段；包装结构或未知额外字段停止并提示人工核对。运行时不自动迁移，普通 Write 不修改私有文件。新初始化创建两段，Windows 默认位置为 LOCALAPPDATA/imedical-agents/bos/config.json，仅绑定 BOS_MCP_CONFIG。非 Windows 显式配置新结构，自动初始化/迁移明确停止。

更新后以新进程分别调用需要使用的技能 defaults 离线核对。日志 token/linkProject 未填写只阻塞日志，不影响查询；真实查询、BOS 写入及宿主发现分别取证。历史业务副本在主动更新前仍使用旧实现，不能宣称源仓修改已生效。完整操作与失败恢复见 [配置说明](../plugins/bos-plugin/references/usage.md)与[日志协议](../plugins/bos-plugin/references/code-update-log.md)。

### 2026-10-14 路由与工作区预检收敛

正常更新能力包后先 Check，再 Write 刷新已启用插件索引；四个 i18n 技能恢复真实 description。Overlay 先更新共享 CapabilityRoot，再逐 ContextRoot 用原有 -NoPull 流程刷新。无需配置/会话迁移或额外清理，用户自定义入口按既有冲突机制处理。部署入口将 workspace 校验失败前置；异常目录先修复部署结构，direct 不新增业务 Git 基线要求。

需求交付拆分与兼容更新见 [需求交付迁移](demand-delivery-migration.md)：新入口 demand-commit / bos-demand-entry，旧 IRIS 入口已删除，更新器定向迁移项目引用并接入缺失 owner；显式状态冲突阻断，旧数据格式保留。

项目技能目录也可在 `ContextRoot/config/project_context_profile.md` 的“技能适配目录”章节逐行填写，再执行 `coding-agent-adaptation` 补齐缺失链接；普通更新不自动执行此清单。示例见 [技能适配](coding-agent-adaptation.md)。
