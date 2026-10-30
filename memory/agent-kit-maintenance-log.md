# imedical.agents 维护日志

## 2026-10-30 VS Code 用户默认 PowerShell 7 自动配置

- 沿用户明确要求补独立configure-vscode入口，使用所选Code.exe的Node模式，目标为便携或普通用户settings.json；只增量维护默认／自动化终端及同名profile路径，保留其它配置和注释，冲突显式选择、预览后漂移停止、私有原件备份及增量恢复。默认Plan，不写当前电脑用户配置；不改PATH、AI规则或其它设置模板。
- 复用微软jsonc-parser 3.3.1最小UMD子集，固定npm官方SHA512、原文件摘要与MIT许可；无npm install，无额外Node前置。vendor仅在独立tools及ZIP，不加入框架sparse／thin-index；安装更新器、插件版本和部署手册无需变更，已有业务副本无迁移。
- JSONC／恢复／链接保护19项通过，PS5.1/7各完成无Node PATH的真实入口Plan/Apply/幂等/Rollback；真实用户设置与Machine PATH指纹不变。初次沙箱文件rename受限，隔离沙箱外复验通过；生产逻辑未削弱。ZIP回读及独立解压沿准备回执，GUI新终端、CodeBuddy实际shell和干净环境仍归原P2；用户随后授权本轮c+p，实际提交／推送以Git回执为准。

## 2026-10-29 BOS 工作量测试阶段漏计修复

- bos-plugin 0.18.1：按一次限定范围对照及用户确认，补“测试／发布测试”流转状态，测试分配允许当前人仍为本人；分配／修正且本人持有仍不计工作量。人员、执行日期、来源与终止状态边界保留，未知组合不扩大纳入。私有查询结果及身份未入仓。
- 保留原 unclassified，新增同序逐条原因；技能输出并列候选／计入／待核对，差异复核刷新原范围、比较编号集合与流转变化。同步 owner AGENTS／README／manifest、技能、usage、根 README、使用指南和维护入口；能力目录职责与入口未变，更新器及部署布局未变，无需改写 catalog、docs/update-agents.md 或安装更新脚本。正常能力更新及索引刷新取得，无配置迁移或旧文件清理；未自动更新业务副本或写 BOS。用户确认实测结果后授权本轮提交推送，实际状态以 Git 回执为准。
- 同窗口逐日结果合并与整段查询的编号集合一致、无重复和双向差集；仅证明本次窗口一致，不替代页面或上游分页证明。查询全程内存处理，未创建私有结果文件；专项验证指纹沿既有 evidence 缓存保存复用。
- Windows Node 24.14.1 专项 43/43、文档链接专项 1/1 及 diff 检查通过，覆盖测试／发布测试、本人测试分配、本人返工、他人接受、日期边界、未知组合原因与前后状态变化。用户另行指定日期窗口后，真实只读查询业务 code=200，新增测试阶段已纳入；私有数量及记录仅在对话展示。完整工作区版本校验识别本次 0.18.0→0.18.1，无本次组件错误，但被既有信创插件 1.0.2／1.0.3／1.0.4 发布记录缺少 commit 阻断，未改写不可变历史记录。其它平台／Node 22、真实宿主及上游未知边界仍沿现有 BOS P2 队列验证，限定窗口查询不证明全历史完整性。

## 2026-10-29 AI 开发基础工具离线物料

- 用户授权先准备离线包，随后明确 CodeBuddy 插件和从当前 settings.json 摘取模板。新增 `tools/ai-dev-offline/`，固定六项 Windows x64 官方原包与当前 CodeBuddy 4.12.39997873 VSIX；准备器持久断点、逐项校验，构建读回归档，正式 ZIP 仅进被忽略的 tools/dist。
- 三个 settings 模板按白名单提取通用终端、编辑器、CodeBuddy 与 ObjectScript 偏好；医院连接仅占位、active=false。随后补单 server 的 MCP/TOML 非敏感模板与 AI 优先 pwsh 片段，省去凭据，不改现用文件。PATH 工具按所选路径 Plan/Apply/Verify/Rollback，Machine 默认与 Process 隔离可选，保存原值类型并验证子 CMD；不扫描全机或改 ComSpec。源仓／tools README 与 P2 待验同步；tools 不属于插件／独立 skill，不改版本／releases、安装更新器／thin-index 或分发手册，已部署工程无需迁移或清理。
- PS5.1 与 PS7 各24项专项及一次真实Process/CMD集成通过：四命令、空格路径、重复配置、恢复及后来修改拒绝；Machine PATH未变。准备机 Node/npm/SQLite、Git临时仓库、Java编译运行、PowerShell和VS Code CLI通过，CodeBuddy隔离安装／列版通过，Python原包签名Valid。TOML标准解析与JSON/TOML字段一致；归档摘要、独立解压及Python测试夹具范围沿[准备回执](../tools/ai-dev-offline/PREPARATION-REPORT.md)。干净断网、Machine写入／通知、AI shell实际加载、GUI、扩展激活／AI登录、MCP宿主与真实依赖未验。没有本机正式安装、系统变量变更或医院部署；未执行提交／推送。
- 用户解除首版 ZIP 占用后，独占访问确认可用；复用已验 r2 原包、对齐说明后重建并统一回原正式包名，独立解压核对全部20文件后清理重复 r2 和任务暂存，保留最新交付摘要。
- 按用户要求扫描部署入口、canonical、插件／skills、docs、vendor及feedback：未发现框架运行代码依赖根 tools；实际路径引用仅为人工 ZIP 说明、源仓专项测试与 CI 构建，iris-tools 插件目录及 MCP tools 命令不属于该根目录。复用现有回归验证新增文件／本机 ZIP 均不入安装更新白名单，新装和升级 sparse 项目无 tools 仍可运行 XML／源码 helper，相关6项检查通过。用户随后授权 c+p，交付范围只含本轮源码、模板、说明、测试及维护记录，正式 ZIP 不入仓；实际提交／推送以 Git 回执为准。

## 2026-10-28 Windows 短路径兼容收尾

- `8434073` 已同步双远端。后续 Windows22.5 CI 的打包步骤实际失败于源码/独立工具测试：Node native realpath 与普通 realpath、PowerShell provider path 与 IO.GetFullPath 对 8.3 名称返回不同表示，产生路径归属或 source-path-outside-root 误拒绝，ZIP 构建本身成功。
- coding 0.24.2：共享 GitRoot 匹配声明目标及物理等价目标；交付薄入口的范围比较按物理位置，传给 PowerShell 的原路径仍接受链接检查；源码/XML和独立导出的根统一完整路径表示。原件/范围/链接、远端、锁及熔断保护保持，不改旧回执或医院副本。
- 最终实际 ZIP 在 PS5.1、PS7 各37通过/1非Windows项跳过，含真实8.3别名、只读TEMP别名及越界拒绝对照；共享工作区/IRIS上下文与分流11/11通过。其余未变化测试复用前轮证据，完整跨平台矩阵仍待新回执，既有3份xc发布记录的6条错误未改动；本轮不再扩展优化或等待无界CI。

## 2026-10-28 帮助优先与跨平台回归夹具修复

- `7128e17` 已推送双远端，首轮 Sparse CI 的帮助契约检查发现前后端专项 skill 的模式段落先于帮助。已恢复统一帮助优先，正常执行仍先分流 developmentMode；coding 升 patch 0.24.1，0.24.0 发布记录保持不可变，七个依赖的既有 <0.25.0 范围继续兼容。
- 按真实失败组补跑 sparse refresh、documentation layout/entry、capability-help，并联检 IRIS 路由和 fast path：Windows Node24 共42/42通过，覆盖全部自有帮助入口及新装/升级薄索引。只是文档顺序修复，源码助手/ZIP 字节和远端运行时未变，复用已匹配指纹的功能证据。
- 首轮 Deployment CI 的 Linux Node22.5/22/24均已成功，macOS22的在线回归组因系统临时目录别名触发 local-git-required、remote-coordination-link 等保护，其余5项被 fail-fast 取消。受影响夹具统一复用已有 temp-directory helper 的物理路径；新增实际别名对照，显式链接仍拒绝，不修改生产保护。新矩阵另以回执核对，真实宿主及医院验证沿原队列。
- 同因检查覆盖现有 Deployment 矩阵后续的 XML/基线、MCP 与部署夹具。主组最终105/105通过；后续组139项通过，读取池15项修正清理所有权断言后定向复验通过，另联检目录别名对照，共16/16。两处夹具清理钩子的遗留变量均已修正，失败夹具留在本任务临时根并于收尾精确清理；不把夹具问题推广为生产实现缺陷。测试组重叠不累计。

## 2026-10-28 IRIS 开发方式与离线交付闭环

- framework-maintenance：developmentMode 独立于 contextMode，由当前 ContextRoot/config/iris-development.json 唯一声明。共享解析与受管远端拦截先于连接读取，缺省旧行为和在线门禁保留；本地旧 plan status/verify 不读连接，恢复远端仍核对配置漂移与未知结果，切换不清锁。
- 按用户选择等待独立工具提交 adf2490 后，将源码助手迁入 coding owner 唯一实现，人工 ZIP 构建复用；支持无回执目录、明确批次/范围与真实源码 Git 绑定，原回执字节和未知字段保留。XML 对象进入源码 Git，原包与恢复快照私有保存；只交付已收到对象的实际修改，经 Review、本地检查、Pack 和独立 Verify 后待现场验收。
- coding 0.24.0、agent-context-kit 0.8.2 及七个直接依赖 patch/范围/发布记录同步。owner、规则索引、Agent/workflow、初始化模板、手册和更新说明已对齐；普通更新不切换业务配置、不迁移源码或旧任务，整个 tools 仍不部署。
- Windows Node24：在线两组 132 通过/1 浏览器跳过、109/109；最终旧 plan/发布复验 43/43，开发方式/远端 21/21，路由/分发 11/11，文档 1/1；最终实际 ZIP 的 PS5.1/PS7 各35/35，源码专项各9通过/1平台项跳过，更新器双宿主通过。组间重叠不累加；证据、ZIP 摘要及实际边界见[验证记录](../maintenance/validation/iris-offline-development-2026-10-28.md)。
- 完整版本审计对照 HEAD 无新增问题，保留三份旧 xc 发布记录的相同6条错误；提交按实际暂存区门禁。非 Windows/Node22 矩阵、真实宿主与医院验证沿既有P1/P2待验；源仓实现不代表业务副本已升级。用户随后明确“优化完c+p”，本轮精确提交并核对完整出站范围；实际提交/推送以Git回执为准。

## 2026-10-28 夜跑项目准备与逐用例预检

- framework-maintenance：在既有准备流程明确基础探测、原预算内补齐项目适配和新用例、定向复验后定稿 PLAN；保留已确认降级、原 run/预算/截止及未知资源，不新增调度器或准备状态库。共享源只记录通用契约，项目私有事实未带入。
- night-capability 兼容旧声明，新增可选 caseId/level/effects/authentication/rationale；从 UI、认证方式和写入副作用补必要能力。checks 按需求/用例/角色匹配，局部失败优先，必需项 not-applicable 不放行；回执和 CLI 输出 gaps、blockers、原因、owner 和复验引用，不把未尝试推断为环境失败。未知资源仍全局阻断。
- 同步治理、验收接入例子、workflow、README、使用指南和更新说明；能力名称/入口未新增，catalog 不需新增条目。根运行时不属于插件或独立 skill 版本单元，本轮不修改 owner manifest 或 releases。正常更新覆盖根 scripts 与 docs/workflows；旧 profile/回执/run 不迁移，无旧文件清理，业务副本未更新。
- Windows Node 24.14.1：四文件定向回归 37 通过、1 真实浏览器项因未配置运行时跳过；之后补空 scope 与 CLI 诊断持久化验证，能力专项最终 18 通过、1 跳过，与前项重叠不累加。文档链接 1/1 通过。首次沙箱执行受临时 Git、原子替换及 PowerShell 权限限制，沙箱外复验通过；测试夹具沿测试自身 cleanup 删除。最终唯一功能用例覆盖为 38 通过、1 跳过，并非真实业务夜跑验收。
- 现有三平台 Node 22.5.0/22/24 CI 已包含上述专项，本轮未运行远端矩阵。项目认证、只读/写入接入包和两需求正式停止恢复试点仍归既有 P1，跨平台证据沿 P2；实施阶段未提交、推送或执行真实业务试跑。用户随后授权本轮 c + p，提交阶段复用有效测试证据，仅纳入夜跑路径并补暂存版本门禁及双远端出站核对；并行 IRIS 与离线交付修改保留，实际提交及推送结果以 Git 回执为准。

## 2026-10-28 人工版本范围导出

- 按用户建议实施授权，在现有 ZIP 增加 export-version-baseline.ps1，复用 exporter 的计划、会话、落盘和恢复。五版清单来自 docs/reference/project-export-map/doctor 原 XML 与版本表，不改原件；v8.4/v8.5/v9.0 分别合并 75/74/82 个完全重复条目，保留 1296/1520/1745 个代码对象，v9.1 为 3295，v9.2 为 5352 且必须显式选 all-products。v9.1 的混合 Web 前缀保留并提示确认，不自动补前缀或猜医院版本。
- 补充 TXT 与前缀映射先合并并预览；完全相同对象去重，大小写/落盘冲突停止。VersionSelectionFile 将版本、范围、原清单、包内清单、补充和映射摘要写入新回执，Resume 绑定选择摘要；旧普通导出不增加前置，输出仍为同一 src/ 与 baseline-state.json，不新增可编辑源码树或自动 Git/部署。
- build-catalogs.js 仅在维护者构建时复用现有 XML parser/类型规则，build-package.ps1 检查 Node 基线并从仓库唯一 helper 位置取入，逐文件校验 ZIP、清理暂存；现场 ZIP 无 Node、框架和构建脚本。只维护原清单与工具源，生成清单仅在临时区/正式 ZIP。并行 coding owner 的助手迁移另行收口，本轮不提交该迁移或开发方式变更。
- Windows PowerShell 5.1/7 从最终 ZIP 各 26/26 通过，涵盖五版本 PlanOnly、医生站/全仓边界、显式路径确认/映射、补充去重、选择变更在网络前阻断，以及移除 Node 后的新进程恢复；原有源码/XML 与会话保护回归保持。Node 构建 3/3、文档及整个 tools 排除分发 2/2 通过。构建专项已加入既有三平台 Node 矩阵，非 Windows 与远端 CI 结果尚未取得，真实医院批次与 License 回落沿原 P1 队列。用户授权本轮 c + p；精确提交版本工具、构建、测试和说明片段，保留并行夜跑/开发方式/助手迁移修改，实际提交与双远端推送以 Git 回执为准。

## 2026-10-28 人工导出会话连续性与传输诊断

- 根据源码与本机三组对照定位风险后，按用户“优化”实施。首次响应须有可用于 Atelier 根入口的单一 CSP 会话 Cookie，后续读取保持相同身份；缺失、丢失、变化或歧义时停止，不反复认证。会话只在内存保留；连续性异常时保留已成功导出的文件，并分别尝试退出本次观察到的已知会话。响应头已到但正文超时的 Cookie 也纳入清理，不处理其它用户会话。
- 退出仅接受 2xx/401 作为预期 HTTP 响应，区分 requested、responseReceived、results 和 verified，licenseReleaseVerified 始终 false。403/404/重定向/服务错误或退出传输失败不再报告 complete；全部文件已取得但退出未核对时，Resume 在网络前停止，避免新进程空跑抹掉旧状态。强制结束、未收到 Cookie、真实许可宽限与外部客户端仍须现场核实，不承诺固定占用或即时回落。
- 原传输错误码保持，沿整条 .NET 异常链分类 TLS、DNS、连接、超时/取消和未分类传输；只持久化安全说明、异常类型和系统状态，原始异常消息、Cookie 与认证头不落盘。人工 README、工具入口和回执字段同步，源码/离线交付仍保持独立运行；本次不修改插件、业务分发或既有框架客户端的同类退出语义。
- 最终实际 ZIP 在 Windows PowerShell 5.1、PowerShell 7 各 23/23 通过，包含 48 文件单认证、缺 Cookie/亲和 Cookie/不兼容 Path、会话丢失与变化、已知会话无凭据退出、2xx/401 与 302/403/404/503 区分、旧退出状态保护、异常链分类及真实本机拒绝连接/正文超时；诊断敏感字面量隔离，原有 XML/源码离线交付回归保持。一次测试使用 1 秒截止先触发取消，改为给拒绝连接足够观测时间，分类逻辑未按测试硬改。文档/整个 tools 排除分发 2/2、语法/BOM 与 diff 检查通过；无真实医院操作、远端 CI、提交或推送。唯一正式 ZIP 已重建并保留原本机示例，功能证据按最终输入保存，任务暂存和夹具按归属清理。
- 用户随后在关联实施会话明确选择“先由独立工具会话完成提交，再迁移”；本地提交只固定上述已完成的源码助手、会话保护及必要测试/说明，供 coding owner 迁移唯一助手实现。排除尚未完成的版本入口和并行开发方式改动，不新增 push 授权；提交结果以 Git 回执为准。

## 2026-10-28 Overlay 支持工作区实体源码

- framework-maintenance，源仓实施；SourceRoot 规范化 path/target 相同时声明工作区实体源码，不同时沿用现有 Junction。实体目录验证 WorkspaceRoot 边界、ContextRoot/CapabilityRoot/Git 元数据隔离、父链及实际 GitRoot；文件映射拒绝越界/悬空链接与未声明嵌套 Git，保留新建和删除路径。初始化、更新和 Repair 不创建或迁移源码 Git、不替换未知实体目录。
- 根 PowerShell/Node resolver 与 initializer 同步；宿主技能适配、task-handoff、菜单同步复用共享 Node blocker，避免成功状态清单分叉。agent-context-kit 0.8.0→0.8.1、coding-iris-plugin 0.23.1→0.23.2；manifest、schema 描述、AGENTS/README、Overlay/更新 runbook、能力指南及维护入口同步。能力目录无新增技能或调用方式，既有目录条目保持。
- Windows、Node 24.14.1：源码/根解析/部署前置 7 项、交接/技能适配/菜单/UI/提交映射/目录 145 项均通过；文档链接 1/1 通过。PowerShell 7 与 Windows PowerShell 5.1 的 workspace-context、workspace-overlay、update-agents 完整回归均通过，覆盖实体源码 DryRun/Write、旧 Junction、多 GitRoot、源码字节和 Git 状态及项目规则保留。JSON/JS 语法、字节/BOM 和 diff 检查通过；首次沙箱拒绝夹具 Git/Junction，受控沙箱外执行；新增更新器断言改用既有 Assert-True 后两宿主全量通过。
- 工作区组件与 HEAD 基线诊断一致，无新增 owner 版本、依赖或发布记录问题；不修改历史记录。专项已接入 runtime-skills 的三平台 Node 22/24 矩阵，Windows 双 PowerShell 仍验证更新器；未运行远端 CI，非 Windows 与真实宿主接入归原 P2 队列。功能证据按实际输入 scope 保存并读回为 fingerprint-match；隔离夹具和任务日志已清理并核实。
- 已授权向医院目录设计会话反馈单实体 code、离线模式路由及 XML 编辑进入源码 Git 的建议。离线 XML 协议/工具自 coding 0.23.0 提供，本轮未修改或重验其实现；源仓存在不代表共享部署副本已更新。先完整更新 CapabilityRoot，再刷新 ContextRoot，实体目录迁移另行授权。用户后续授权本轮 c + p，按源仓双远端约定执行并以 Git 回执为准；不更新业务副本或迁移医院目录。

## 2026-10-28 人工源码带回开发与还回现场

- 按用户确认的最小闭环实施：新 baseline-state.json 增加可读 source.atelierUrl/namespace，URL 已含主机与端口，不重复收集；不保存凭据或 Cookie。独立 source-delivery.ps1 以 Prepare 保存原始字节，Pack 交付修改后的完整源码、对应原件、files.txt、实际说明及 manifest，Verify 支持独立核对和现场新快照比较。没有修改不生成空交付，有修改缺说明停止；不隐式新增、删除、重命名对象，不自动上传、编译或提交。
- 旧完整导出允许人工补来源并匹配原 target，原回执字节与 scriptHash 保持不变；partial 须显式接受且后续标明缺失。Prepare 后导出器阻止 Resume；可移动整个开发目录，保留回执和 .baseline。源码集合、UTF-8、类身份、原件、清单与交付摘要均核对，临时目录校验后原子发布；互斥与导出器共用输出锁。现场比较只证明与提供的新快照一致，不宣称实时锁定或业务验收完成。
- Windows PowerShell 5.1、PowerShell 7 直接解压实际 ZIP，各 17/17 通过：覆盖旧回执、移动目录、partial、原件/交付漂移、编码与身份错误，以及本机模拟 IRIS 导出→修改→增量/回退→重新读取→比较。现场内容变化、缺失、不同目标和当前文件被改均停止；离线操作无 HTTP 请求。文档链接与整个 tools/ 排除分发检查 2/2 通过，包含新文件与本机 ZIP；未运行远端 CI，真实导入/编译沿原 P1 队列。
- 人工 README、根工具入口、仓库总览与既有 Windows ZIP 构建步骤同步；只维护源文件和一个本机 ZIP，原有本机连接示例保留在被忽略的 ZIP 内，共享源无连接事实。没有修改本次功能对应的插件内容、安装更新算法或部署白名单，独立人工能力不加入随业务项目部署的能力手册。医院版本医生站全量基线编排本次只评估，未实施或启动采集。功能证据沿 validation-evidence 保存，任务打包暂存与测试夹具按归属清理；实施阶段未暂存、提交或推送。

## 2026-10-28 人工导出说明按现场操作重写

- 按用户本次远程电脑操作方式，将人工 README 统一为项目目录放 files.txt、从 iris-code-export 子目录调用脚本，使用单行 PowerShell 命令；补齐路径与扩展名、PlanOnly、证书、匿名/导出/退出三个位置的 401、Resume 和完成判据。现场排查只记录为一次案例，不推断所有传输错误均由证书导致。
- 经用户明确要求加入实际目录截图，README 使用相对图片引用，ZIP 与 CI 打包同步包含 images，独立验证入口检查图片与源文件一致。脚本逻辑、插件与版本、安装更新范围均未变化；本机 ZIP 中已有连接示例保留，ZIP 仍受 Git 忽略，未写入共享说明。
- ZIP 四个文件、相对图片引用、脚本/清单字节及六条单行命令语法核对通过；Windows PowerShell 5.1 的 UTF-8 text list 定向用例 1/1 通过，包含解压/图片检查并自动清理夹具。复用既有功能证据，不重跑无关 XML 回归。用户授权本批 c + p；提交前确认 master 与 Gitee/GitHub 均在 ed7e954，按本批精确路径执行，结果以 Git 回执为准。

## 2026-10-28 内网独立导出与 XML 离线编辑

- framework-maintenance，实施基点 `5698dd3da67a871a3115c58c2dca0a3f0e85b91b`。按用户明确选择补齐两条现场路径：独立 `export-iris-code.ps1` 按 UTF-8 TXT 或 ProjectItem XML 导出当前源码至指定目录；`edit-export-xml.ps1` 将完整源码 XML 拆分为单对象 XML，编辑后核对范围和身份回包。类保持完整 XML，不手工拼 UDL；两个脚本不依赖 Node.js、MCP、Agent 或外网，不自动导入、编译或提交。独立工具限 Windows，作为现场无 Node.js 的明确交付方式，不另建跨平台等价核心。
- coding-iris-plugin 0.23.0 与七个直接消费者 PATCH/兼容上界同步；owner 入口、基线/XML 协议、TXT 示例、能力手册、根总览和更新说明同步。用户随后明确区分人工导出和 AI XML 修改：人工工具源移至 tools/iris-code-export/，ZIP 只含导出脚本、README、TXT 示例；XML helper 继续随插件更新，不另打 XML 包。工具源码只维护一份，整个根 tools/（含以后新增工具、README、ZIP）不随 .agents 分发。安装/更新白名单已分别核对；实际 sparse 新装/更新夹具验证整个 tools 目录缺席，静态门禁同时检查当前新文件与未来路径。无安装/更新算法、配置、thin-index 迁移或旧文件清理。独立工具的同目标/输出互斥不替代公共准入，已知阻断不得绕过；项目开发仍沿 source-sync。
- Windows PowerShell 5.1、PowerShell 7 的同一 11 项回归均通过：实际本机 HTTP/Cookie、UTF-8 TXT 前后端四种例程/类与 Web 路径、分段编码、图片预筛、404/empty/503 零重试、独立进程恢复、局部改动保护、DTD/目录穿越/身份与范围漂移、XML 类元数据和二进制回包。新/旧 sparse 分发专项 1/1、project links resolve 1/1 通过；既有 CI 增加 Windows 双宿主专项，未运行远端 CI。
- 用户授权的一个真实内网目标以最终脚本完成 3 对象小样本（CLS、JS、CSP），先独立进程取得 1 项，再以新 Windows PowerShell 5.1 进程恢复剩余 2 项，全部摘要及严格 UTF-8 独立回读通过。该样本发现整条 Web 路径编码导致 404，改为逐段编码并保留斜杠后成功；退出接口返回 401，按既有 CacheLogout 契约记回执，`licenseReleaseVerified:false`，未验证真实许可回落。只读样本不代表所有医院旧版本兼容；未上传、编译、改配置或更新业务副本，未把目标连接/私有源码写入源仓。
- 版本工作区预检覆盖 8 个变更 owner，未出现本次版本或依赖新问题；全仓既有发布记录债保持原样。真实 XML 导入/编译、更多目标兼容及资源回落继续沿既有 P1 队列；实施阶段未暂存、提交或推送；用户随后授权本批 c + p，提交前核对 master 与两个远端均在实施基点，按本批精确范围及 README 双远端约定执行，结果以 Git 回执为准。测试临时目录按任务归属清理，功能证据供后续提交复用。

- 人工包最终只含导出脚本、README、TXT 示例，从带中文/空格的隔离解压目录运行；用户指定示例写入人工 README 与清单，真实连接示例只留本机 ZIP 的 README；打包暂存副本已与 ZIP 逐文件核对后删除，tools/dist 只保留 ZIP，测试直接从 ZIP 解压验证。最终 ZIP 在一个授权目标成功取得指定的 CLS、JS、CSP 三项，摘要/UTF-8 回读通过。实际验收发现并修复 PowerShell Set-Location 与 .NET 进程当前目录不同导致的相对路径问题，导出与 XML helper 共因修正，新增两宿主相对路径回归。XML helper 已收敛为 Unpack/Pack/Verify：混合 Project/源码包仅拆分源码，NotesFile 承载实际说明，原包不变；changes.xml 与 rollback.xml 只含一一对应的修改对象，说明/manifest 记录范围与前后摘要，四文件校验后原子发布到新目录。Verify 独立进程核对载荷和交付漂移；无修改不产空包，有修改缺说明停止，不隐式新增/删除/重命名顶层对象。本地复用 XML 工作/交付目录，无服务连接、导入或编译。最新双宿主 11 项、新旧 sparse 分发与文档链接各 1 项通过；真实项目 XML 导入编译及现场漂移仍沿 P1，不把合成混合包当现场验收。

## 2026-10-28 IRIS 部署有限恢复与重复确认收敛

- framework-maintenance，按用户确认实施部署失败分流；并行 XML/基线已在 `4960807` 独立提交，本次 coding-iris-plugin 0.22.0→0.22.1，新增独立发布记录并保持 0.22.0 不可变原文。用户随后明确授权本批 c + p，按 master 与 Gitee/GitHub 双远端约定执行，最终结果以 Git 回执为准；不更新业务副本或连接真实服务器。
- direct/guarded 逐文件入口共用 deploy-recovery，瞬时读取与确证未发出的上传共享 2 次额外尝试（250/1000ms）；本地字节、远端快照、原通道、冻结发布及夜跑准入每次复核。部分上传和编译后读取在当前步骤继续，不整批重放；上传前补一次本地字节核对，防止恢复等待期间的修改被上传。回执记录 recovery；SFTP 批量 worker 无充分错误证据时仍停止，不重启或换通道。
- guarded 明确编译失败返回 compile-failed 并保留已上传快照，原任务已授权修复时先诊断再走原入口，不强制 unknown resume。未知写入/编译、503、认证/TLS、并发、Storage 及生产冻结门禁保留；旧 unknown 的核实读取失败不会降级为普通 blocked。确证未发出的上传耗尽或写入前瞬时读取耗尽返回 blocked，避免把已知未执行误报为授权问题。
- 用户补充停止边界已写入 skill 和唯一恢复协议：首次执行之外最多重试两次，第二次仍失败立即停止本次部署并汇报原因、已完成及未执行步骤；不通过重跑命令、重建 adapter 或另建批次重置额度，不自动开启下一轮。实际范围/覆盖/权限/未知结果决策才提问，技术失败不自动使已有授权失效。
- Windows、Node 24.14.1 最终 10 个相邻测试文件 116/116 通过（恢复专项含子项 17 项）；覆盖有限调用次数/退避、共享额度、部分上传继续、编译不重放、等待期间本地/服务器修改、旧 unknown 不解锁、冻结/夜跑门禁、真实 127.0.0.1 Atelier 断连及原发布流程。功能证据沿 validation-evidence 绑定实际运行输入，停止文案单独经链接及语义核对；证据保存在测试运行器系统临时根的既有 imedical-agent-validation 缓存，并回读为 fingerprint-match。隔离 Git/本地 HTTP 测试需沙箱外；最终夹具位于 D:/tmp/Codex 任务目录，早期使用工具允许的系统临时目录，所有本任务夹具均已删除并核实。非 Windows/Node22 及真实项目仍归既有 P1/P2 队列，新增专项接入现有三平台 CI 矩阵，未执行远端 CI。
- owner AGENTS/README、skill、checklist、保护协议、脚本帮助、总览、能力手册、维护入口与既有 P1/P2 队列同步。部署链接定向 1/1、JavaScript 语法与 diff 检查通过；组件工作区与 HEAD 基线均为同一组 6 条历史发布记录诊断，无新增版本问题。安装/更新/sparse/thin-index 算法与配置未变，正常完整能力包更新取得，未改写更新 runbook 的既有并行内容；旧 unknown 状态不自动迁移，无旧文件清理。提交前复用内容指纹匹配的 116 项功能证据，只补独立版本记录、精确暂存、staged 组件门禁及差异复核。

## 2026-10-28 验收 Git 发布与 BOS 补录解耦

- framework-maintenance，基点 `5282be440f7048cd88b01aa7b2649bb69d973cbd`；用户明确要求先提交推送、BOS 后补，并授权本轮 c + p。demand-delivery-plugin 0.8.0→0.8.1，默认 commit→push→BOS，兼容日志先于 push 的旧顺序。主子日志 pending/failed/running/unknown 均不阻塞 Git；全部约定 Git 动作成功即释放 publication 和 checkout 写入占有，保留日志交付者与原 worktrees 取证，部分 push 仍保护全部目标。
- BOS 授权在自身 record 阶段校验；实仓 root/ref/hash、远端包含性、未知结果核对、成功不重发及全部适用回执才算完整交付的门禁保留。后续 Git 可继续，日志按原 hash 单独恢复，报告明确“代码已推送，BOS 待补”。旧 v1/v2 首次状态写入释放已完成 Git 的占有，不改 schema、scopeHash、授权或日志状态。
- owner AGENTS/README/manifest、skill、批次协议、共享代码归属、迁移/更新说明、总览与能力手册同步；既有 P2 连续验收队列补充真实宿主及业务副本观察，无新增治理队列。普通完整能力包更新并刷新已启用索引取得，无配置迁移、旧文件清理、安装/更新算法或 BOS owner 实现变化，未更新业务副本或操作真实 BOS。
- Windows、Node 24.14.1 最终三 suite 50/50 全过：`node --test --test-reporter=spec plugins/demand-delivery-plugin/tests/acceptance-session.test.js scripts/tests/demand-hierarchy.tests.js scripts/tests/real-repository-commit.tests.js`。覆盖四种待补日志、独立授权、旧占有释放、后续发布与原 hash 恢复、部分推送、主子迟到继承、无代码及实仓拒绝。隔离 Git 需沙箱外执行，提交计划限制使用系统临时目录；以实际路径消解 Windows 大小写断言差异。真实 BOS、其它宿主和非 Windows/Node22 矩阵仍沿原 P2 取证，现有两份 CI 已覆盖三平台 Node22/24。
- 文档 `project links resolve` 定向 1/1、JavaScript 语法及差异检查通过；staged 版本门禁只涉及本 owner，0.8.0→0.8.1 无新增问题。功能证据按实际源码范围保存供复用。仅暂存本轮 19 个路径及共享文档片段，保留并排除并行 IRIS XML/基线改动；提交推送沿 README 双远端约定，GitHub 镜像另含已在 Gitee 发布的 `5282be4` 文档提交，实际结果以 Git 回执为准。

## 2026-10-28 IRIS XML 与代码基线本地接入完成

- framework-maintenance，实施基点 `5282be440f7048cd88b01aa7b2649bb69d973cbd`，按[已确认计划](../maintenance/design/iris-xml-baseline-integration-plan.md)在源仓实施。新增 `iris-xml-export`、`iris-code-baseline` 归 coding owner；版本 XML 仅约束范围，源码及包内容来自确认实例当前状态。基线只代码、图片预筛并统计；XML 图片使用既有无损样本回归，去除 QTZ 及隐含业务辅助类依赖。
- owner 本地 manifest 与版本记录为 0.22.0，因 source-sync 新版批量资格、已知基线 404 阻断及 initial partial token 收紧标记 breaking／required Migration；七个直接消费者保留最低版本、扩展兼容上界并各升 patch。两个 skill、CLI 与专用类继承 owner 版本；单独协议标识不形成第二套版本。文档、init 提示、目录声明和版本记录与实现一并核对，本地记录不代表已发布。
- 本地实现阶段交付 canonical 专用类源与[验收步骤](../docs/guides/iris-xml-baseline-acceptance.md)，用户随后明确授权本批 c + p；仅暂存 XML／基线相关文件及共享文档片段，排除并保留同仓并行部署恢复改动，按 README 双远端约定提交推送，结果以 Git 回执为准。未更新业务副本或部署服务器，专用类未真实编译、安装 XML 未生成。可选类未部署不阻断其它 coding 能力；多会话只能在目标资格通过后启用；全局旧入口沿 `skills-sync` 单列迁移，删除源前盘点所有依赖端并保留恢复。
- 独立受管会话池专项 15/15 通过并按 pool/client/remote 实现及测试 scope 保存证据；覆盖真实本地并发、同 Cookie 单次 serverInfo、目标／版本／实例／配置／运行时绑定、503 持久熔断、资格只读范围与期限，fixture 清理通过。XML 执行默认同进程 WS terminal，HTTP MCP 为显式接受 vendor 内部最多 3 次尝试的选项；以上均为本地 mock／源码验证，未连接真实 IRIS。
- Windows 完整 `update-agents.tests.ps1` 分别在 PowerShell 7 与 Windows PowerShell 5.1 通过，`plugin-thin-index-refresh.tests.ps1` 在 PowerShell 7 通过。沿既有 validation-evidence 登记 `update-agents-ps7`、`update-agents-ps51`、`plugin-thin-index-refresh`，按测试实际读取的脚本、公共库、文档和 manifest 计算 scope，并回读为 fingerprint-match；只使用任务临时根下的隔离 Git／Overlay fixture，测试自动清理。此回归不代替未提交 XML 新资产的新装／旧装 sparse 验收或真实宿主加载证明。
- 本地共享与既有流程回归 74/74、新增组合回归 88/88、source-sync 差异回归 5/5 通过，结果分开记录，不合并计数或扩大为真实服务结果。新增组合包含当前工作树资产的新装／旧装 sparse 夹具 1/1，核对运行时、vendor、类源、两个 skill 与帮助入口；不代表实际项目已安装。跨平台矩阵只完成配置，未运行远端 CI。真实双通道、类编译及安装产物、资源资格、实际项目／宿主加载和旧全局入口迁移仍待验；缺口沿 backlog 既有 P1 第 4 项、P2 第 7 项及宿主适配队列推进。
- 最终 MCP／XML 组合 34/34（MCP 6、XML 28）通过，覆盖新 `markUnknown` 用例及 10 秒强杀后的 unknown 收尾；基线／清单／范围专项 31/31 针对公共运行库更新后补跑通过，两组均登记当前内容指纹并回读匹配。38 个候选的 JavaScript 语法／JSON 检查通过；验收指南复核补齐资格试验实际采集、未完成计划恢复及 Web 导入隔离。以上为本地 fixture／生成测试，不是服务端编译或真实 IRIS 验收。组件 HEAD 基线与工作区均为既有 6 条历史诊断，本轮 `newIssues: []`，没有改写不可变历史记录或执行 staged 门禁。
- 本轮本地实现交付完成，计划与 maintenance 导航已更新，下一步仅保留未完成的跨平台／真实试点、安装产物及另行授权的发布部署和旧入口迁移。源仓文件和本地回归不代表实际项目已更新。
- 文档定向验证通过：`documentation-layout.tests.js` 的 `project links resolve` 1/1（部署链接／锚点与非 xc 全部 skill/rule 覆盖）；`capability-help.tests.js` 的 `every owned skill` 1/1（全部自有帮助先行路由）。两个新 skill 纳入当前 15 插件／58 skill／37 rule 清单，新增四个 CLI 的本地 `--help` 可读。组件完整检查本轮新增记录与依赖未报问题，全仓仍保留既有不可变发布记录债；本地实现阶段未暂存或执行 staged 门禁。
- c + p 提交前补齐新文件差异检查，去除 saxes 发行包三个循环标签后的行尾空格并同步来源说明与摘要。Windows GitRoot 比较改用真实物理路径，覆盖同目录大小写变体及不同物理根拒绝；默认系统临时目录的新进程专项 11/11、最终新增能力组合 91/91 通过。暂存 72 个文件及精确片段，组件门禁检查 8 个变更 owner／11 个受影响组件通过；旧更新器证据在排除并行 README 段落后仍匹配，复用已有 PowerShell 7／5.1 结果。并行部署恢复文件和文档片段留工作树，不纳入本批提交。

## 2026-10-27 BOS 需求名称按产品交付目标区分标版标签

- framework-maintenance，基点 `2101310d10170afbe910ca9f6732e52260385765`，按已确认计划实施。IRIS 标版代码、产品配置或 UI 开发使用 `{IRIS}[标版] 标题`；会议、演示、造数据及临时脚本/环境准备沿非标版工作命名。计划与已完成开发共用同一规则，三类来源逐条判断，不以 source、kind 或 Git 文件类型代替业务目标。
- `bos-plugin` 0.17.0→0.18.0；复用 name，脚本仅扩展可选紧接标签的前缀校验。默认 title 只去产品标识、保留标签，显式 title 和 BOS 最终标题原样传递；文本/Excel 共用名称，“加入标准版”等分类、CLI、草稿 v2/v3/v4 和提交依赖不变。其它产品沿项目约定，旧草稿不自动改写。
- 同步 owner AGENTS/README、协议、根 README、两份能力手册和不可变发布记录；规则事实源集中在 skill，维护入口和原 P2 队列引用。正常更新能力包并刷新已启用索引取得，全局适配入口已指向源技能无需另改；安装、更新及 thin-index 机制未改变，无需修改对应脚本或更新 runbook。
- 本机 Windows、Node 24.14.1：`node --test --test-reporter=spec scripts/tests/standard-demand-entry.tests.js scripts/tests/demand-hierarchy.tests.js` 47/47 通过；审阅后新增 `work facts can describe standard development without relabeling another product`，按同名 pattern 定向补测 1/1 通过，共 48 个不同用例有通过结果，未机械重跑完整 48 例。覆盖三类来源、临时造数据 Git 脚本、新旧草稿、标题及 Excel 同源/分类保持。首次沙箱运行受隔离 Git 初始化权限限制，获批同命令重跑后通过；fixture 清理 hook 全部通过，无额外临时日志或脚本。
- 独立源码审阅无阻断问题，11 个合成场景规则试读符合计划；文档链接专项 1/1、新增发布记录链接、JavaScript 语法与差异检查通过。`validation-evidence` 已保存 `bos-standard-label` 的两条原始命令及内容指纹，独立 check 返回 fingerprint-match，保留本机缓存供提交复用；沙箱缓存原子替换失败留下的本任务临时文件已精确清理并核实不存在。只读工作树版本预检唯一变更 owner 为 bos-plugin，和 HEAD 基线相比新增问题 0；仍有 imedicalxc-doctor-extend-engineer 1.0.2–1.0.4 发布记录 commit 的既有 6 条诊断，未改写历史。
- 现有 standard-demand-entry / BOS CI 已覆盖本专项的 Windows/macOS/Linux × Node 22/24 矩阵；非本机结果、真实宿主逐条判断及 BOS 导入沿既有 P2 队列取证，不把规则试读或本机回归宣称为业务副本已生效。实施阶段未暂存、提交、推送、部署业务副本或操作真实 BOS；用户随后明确授权本批 c + p，提交前已核实功能指纹匹配、两端 master 均在实施基点，按本批 15 个路径精确暂存并执行 staged 版本门禁，随后按 README 约定同步 Gitee 与 GitHub；提交与推送结果以 Git 记录为准，业务副本升级仍独立授权。

## 2026-10-26 实仓提交门禁与主子需求闭环

- framework-maintenance，按已确认计划实施。BOS 日志以实仓 repo/ref/完整 hash 为前置条件，plan/submit/最终写入共用只读 Git 门禁，拒绝 worktree 来源及裸 payload；凭据在来源验证后读取。
- 验收绑定最终实仓提交；parent 引用主实仓提交逐项日志与共享 push，own 子项独立交付，none 保留原因跳过。整组完成按全部成员计算，共享 push 检查子项精确选择和成功码，旧回执恢复重核实仓。
- demand-delivery-plugin 0.8.0、bos-plugin 0.17.0 的 breaking 迁移、owner 入口、流程、手册和现有三平台 CI 同步。去重67项本机验证通过：BOS12、最终状态流/主子42、发现11、分发链接2；版本预检新增问题0，完整审计保留基线既有6条发布记录 commit 诊断。详见[验证记录](../maintenance/validation/real-repository-delivery-2026-10-26.md)。
- 实施阶段未暂存、提交、推送、修改真实 BOS 或更新业务副本。用户随后授权 c + p，按本批精确范围及 README 双远端约定提交并推送；提交前已核实两端 master 均在实施基点、功能验证指纹匹配。非 Windows/Node22 矩阵及真实宿主/服务取证沿既有 P2 队列，业务副本升级仍独立授权，未将本机回归宣称为实际业务已生效。

## 2026-10-26 项目目录说明与持续更新

- framework-maintenance，基点 d3e22de。复用 projectDirectories、documentation-layout.json.extensions 与普通更新器，补齐 owner 用途/示例/边界/生命周期；总导航、主要用途、扩展和本地 work 入口使用统一受管区。首次 setup/扩展登记纳入具体 README 变更；已存在无标记 README 通过 navigation-plan 精确评审后追加受管区，后续 Write 保留人工正文并刷新。缺失/过期说明、标记冲突与目录异常可见，不使用 Force。
- 目录默认值、显式 profile、旧任务和业务恢复位置不变；兼容区仅说明现有路径，不移动或清理。docs-layout-ok 的范围限定为声明目录、受管说明及生成导航，顶层归属提示不等同逐文件分类。项目特殊语义留本地扩展，不写入通用实现。
- agent-context-kit 0.8.0 与六个目录 owner PATCH、新发布记录、各 README、源仓/项目手册和治理队列同步；其它 owner AGENTS 与相关目录引用已核对，路径/业务契约未改变，无需新增第二套指引。现有 project-docs CI 和安装/更新 sparse 规则覆盖新 helper，无需改安装/更新实现或另建机制。
- 本机 Node 24.14.1 目录集成最终 92/92（说明与迁移专项 35 项）、文档分发/链接专项 2/2；PS5.1/PS7 更新器完整回归结果及边界见[验证记录](../maintenance/validation/project-docs-navigation-2026-10-26.md)。只读工作区版本预检覆盖 7 个变更 owner、11 项受影响组件，无新增问题；实际提交前仍须 staged 门禁。跨平台矩阵和真实项目接入沿原 P2 队列取证，未更新业务副本、迁移材料或操作真实服务。
- 用户已明确授权本批提交并推送 Gitee 和 GitHub；三项功能证据指纹匹配，41 个文件的精确暂存与差异检查、7 个变更 owner/11 项受影响组件的 staged 门禁通过。两个远端均在实施基点，仅本批新提交待推送，无额外历史；任务临时夹具与日志已清理，正式验证记录及本机证据缓存保留。项目升级、资料迁移与真实服务操作继续独立授权。

## 2026-10-24 IRIS 项目按需导出开发

- 用户随后授权 c + p；提交前复用有效验证证据，补正自定义 MCP serverName 的 status/reconcile 解析并通过 2 项定向回归；按 README 双远端约定同步 Gitee 主仓与 GitHub 镜像，业务服务器操作仍独立授权。

- framework-maintenance，仅已确认 project＋按需 contextMode 命中项目开发分支；standard 沿既有规则，公共机制及角色共用，skill/rule/IRIS agent/workflow 传递类型与来源而不复制正文。新增 source-sync 现场/基线恢复、逐需求层提交、移植接入、部署前同步复审及冻结产物发布。两环境独立本地 Git；无变化不建 export 或空提交，本地回滚追加新提交。
- 根共享库承接已接入 Atelier/Broker/MCP 的单实例或已确认共享许可池跨进程准入，默认串行、503 零重试，未知写保留核实断点；仅本人会话/子进程收尾。外部 IDE、原生 MCP 和其它独立客户端不自动受控，不承诺 1 LU 或即时释放。模板无连接凭据，私有状态不进入 Git。
- 本机 source-sync 25/25 全项＋最终身份/读取恢复 2/2 定向，事务 7/7，promotion 30/30 全项＋legacy/类型 2/2 定向；部署既有六 suite 70/70，类型/事务/CSP 组合 27/27，index flags 与 Storage 最终补测 16/16。远端联合 30/30、最终受限恢复 14/14；独立恢复 GET 仍保留原熔断和未知写，不清除业务结果。
- coding 0.21.0、context 0.7.0 与七个直接依赖 PATCH 已同步；工作树版本/兼容比较无新增问题，既存历史债务不改写。UTF-8、JSON、JavaScript 语法与 diff check 通过，CI 增加三平台 × Node 22.5/22/24，当前实跑仅 Windows Node 24.14.1。实际命令、范围和未部署边界见[本轮验证](../maintenance/validation/iris-project-demand-development-2026-10-24.md)。
- capability-help、documentation-entry/layout 共 17 项通过；fast-path 已改为沿现 owner 的有效授权指针核对，并修正同文件锚点读取，最终通过；不恢复过时的强制逐项询问规则。
- 本轮未连接业务服务器，未初始化业务 Git、部署、暂存、提交或推送。真实资格窗口、旧 Caché 兼容、其它平台与业务副本入口加载沿 backlog 原 P1/P2 队列推进；不新增守护平台或并行治理队列。

## 2026-10-24 项目知识库目录与授权归类

- framework-maintenance，基线467cf3f；实现通用骨架、owner目录声明、当前ContextRoot运行资料、首次接入/具体计划授权及备份恢复。更新可补已接入的空目录，未接入或待整理只提示；各工作区知识本地保留，扩展登记用途和导航。
- 同步i18n XML/术语/CSP恢复、交接新旧根、BOS正式文本与私有draft分离、表单新任务/旧恢复、文档摄取/接口及医生AI输出。脚本、profile/skill、owner版本/发布、部署说明与能力手册共同更新；现行契约只在[目录治理](../docs/guides/project-knowledge-layout.md)维护。
- 最终集成81/81；更新器、XML fallback及接口suite在PS7/PS5.1通过，BOS原有29项通过；编码/部署链接/补丁检查通过。本次8个owner版本变化无新增治理问题，历史发布欠项保持；完整证据和限制见[验证记录](../maintenance/validation/project-knowledge-layout-2026-10-24.md)。
- 实施阶段未部署业务项目、未迁移用户已有资料、未暂存/提交/推送。用户随后授权本次 c + p；提交前核对已推送的并行UI提交bf0904f，保留其正文并衔接agent-context-kit 0.5.4→0.6.0。提交前补跑81项集成全过，复用其它有效证据，补查受影响的模板/入口并执行暂存版本门禁；仅推送Gitee origin/master，业务部署与迁移继续独立授权。跨平台CI和真实宿主/项目迁移沿P2队列取证。


## 2026-10-23 UI 规范提炼与需求经验回归

- framework-maintenance，基点 ab39cb0，独立分支 codex/ui-framework-optimization；保留主工作区并行修改。改进有效图层与跨主题构件对照、前端 rule 唯一读取门禁、HISUI 参数组合、实施自检和明确授权的源仓隔离待审补丁模式；公开 collectUiMetrics 及生产样式不变。
- owner 版本、发布草稿、共享授权指针、能力手册和定向测试同步。项目模板为消除旧逐项授权冲突追加 agent-context-kit 0.5.4 PATCH；主仓并行0.5.3随后提交为467cf3f，隔离工作树接续该基点，完整保留已提交改动及不可变发布记录，实施阶段未创建本任务提交或合并到主仓。
- 11个匿名返工样本、实际测试、浏览器资源/状态及独立Agent使用结果统一见[验证记录](../maintenance/validation/ui-framework-optimization-2026-10-23.md)。第一轮未接入框架，不能认定为框架接入后漏执行；静态通过、实际使用和正式UI验收分开。
- 实施阶段未提交、推送、发布、部署或更新业务工程；用户随后明确授权本次 c + p，仅提交本次改动并推送 Gitee origin/master，实际结果以 Git 回执为准。其它平台/更多宿主及接入后效果沿原 UI P2 队列继续，业务工程更新另行安排。

## 2026-10-23 项目规则路由落地与完成判定

- 在同一未发布 agent-context-kit 0.5.3 PATCH 草稿中，按 writing-for-agents 收紧现有 `project-context-maintenance`：主 skill 集中维护入口定位、条件/读取时点、断链补齐、正文读取及代表场景走查，初始化/优化只引用该节，模板明确工程任务先读规则入口。未新增加载器、索引模板、配置项或客户端适配脚本。
- 补齐 AGENTS 引用总索引但初始化只明确创建 project.md 的指令缺口；复用等价索引或小工程直接路由，使用模板时按实际路径替换或去掉不适用的索引指针。仅维护本次受影响链，保留原约束和插件状态；未知目标只暂停依赖动作，Markdown 相对链接与 thin-index source 按各自约定解析，文件链证据与宿主加载/行为分别报告。
- owner AGENTS/README、总览、能力目录/指南、更新说明、维护入口/长期决策与既有 P2 第 7 项同步；0.5.3 草稿发布范围包含此前宿主 source.md 收敛，不重复递增或修改已提交 release。已有工程正常更新取得指导，路由在授权的上下文维护中定点调整；普通更新不重写业务入口，不同步业务副本或个人配置。
- 验证：文档链接/分发及能力清单定向 1/1、19 个当前新增/修改文件的严格 UTF-8/JSON/源码链接与部署模板引用检查、diff 检查通过。模板中的项目索引作为初始化实例目标单列，不冒称源仓已有或已在业务工程创建；组件校验器工作树 owner/直接依赖范围通过，识别 0.5.2→0.5.3 兼容 PATCH，未暂存，不代替提交前 index 门禁。
- 独立只读审查与另一 Agent 的四场景源码试读完成：缺失索引、等价索引/局部维护、小工程直接路由、未启用/未知项与独立工作并存。按审查收紧直接路由与固定模板路径两处措辞；每场景样本量 1，未运行实际客户端或宣称跨宿主行为通过，后续沿既有 P2 取证。未新增测试代码、临时文件，未暂存、提交或推送。
- 用户随后授权本轮 c + p；提交范围包含宿主依据收敛与规则路由补齐及对应 0.5.3 发布/维护说明。复用既有定向验证与四场景试读，精确暂存后补 index 组件版本门禁；刷新并核对 origin/master 完整出站范围后推送，实际结果以 Git 回执为准，业务副本未同步。

## 2026-10-23 宿主技能目录与项目 MD 依据收敛

- `framework-maintenance`，基线 `ab39cb0`；agent-context-kit 0.5.2→0.5.3 PATCH。`coding-agent-adaptation/references/source.md` 集中维护宿主形态、项目技能目录、项目规则 MD、适用条件和官方来源；复用用户提供的既有本机探索，只提取脱敏目录/格式与历史样本边界，不把用户级路径、目录存在或旧分发状态当作项目加载契约。
- 区分技能发现与规则加载，记录 CodeBuddy 回退、Claude 版本/设置条件、多宿主 MD 合并及 WorkBuddy 当前官方项目目录与命名 adapter 的差异。未知项由用户说明，MD 未知不阻塞已确认目录的独立适配；需不同目录时复用显式 Custom 入口，不自动移动旧链接。已有内容及配置保留，参考登记不扩大创建授权。
- skill、owner AGENTS/README、仓总览、runbook、更新说明与能力手册改为引用同一依据；维护路由、长期决策及既有 P2 第 7 项同步。脚本 CLI/默认映射、安装/更新器、thin-index 和个人配置均未改；正常能力包更新可取得参考，现有薄索引继续引用源 skill，无配置迁移或旧文件清理，未同步业务副本。
- 验证：项目文档链接/分发及能力清单定向 1/1 通过；新增与修改文件的严格 UTF-8、JSON 和本地引用检查通过，source 无个人绝对路径。复用组件版本校验器完成工作树 owner/直接依赖范围检查，识别兼容 PATCH、无问题；未暂存，不以工作树检查代替提交前 index 门禁。独立只读审查发现 MD 未知可能阻塞目录任务，已在 skill/runbook/source 明确消除；本轮只读复核已知用户级目录存在，未启动宿主或宣称完整加载/行为通过。
- 实施阶段未暂存、提交、推送或创建临时文件；用户提供的截图与个人配置仓保持原样。

## 2026-10-23 客户端生命周期预检与温和退出

- framework-maintenance，实施基线 a2ae955；仅维护根级运行库、能力预检/worker、工作流与指南，不改插件或独立 skill 版本。BOS 并行查询变更及原有文档修改保留；业务副本未更新，实施阶段未执行 Git 暂存、提交或推送。用户随后授权本次 c + p；仅暂存本次生命周期修复，实际提交与推送以 Git 回执为准。
- 通用 probeClientLifecycle 进入现有 preflight 上下文：明确授权/截止/持久回执可用后，创建两个固定无业务只读单轮端点，等待匹配事件后做一次历史回读，不增加 RPC 重试。项目整体 timeout 与批次截止取较早值，创建在途取消不再继续首次 turn/start。新预检不接受项目自行贴的生命周期/停止通过标签，旧批准 run/回执不迁移。
- 原回执逐阶段保存 launch 身份、启动事件、历史回读、中断请求/ACK、终态及本地退出。历史失败不能抹掉 ACK；ACK 无终态或未知进程均阻断。stdin 结束后有界等退出，超时才 force；worker 将 transport 证据写回原 checkpoint，未知退出保留 lease，不把本地关闭当端点停止。未改 RPC 请求格式、Goal 预算或双开发/独立审查门禁。
- 最终 Windows Node 24.14.1：直接链 69 通过、1 个真实浏览器用例因缺锁定运行时跳过，受管路径 63/63，文档链接定向 1/1，JS 语法/UTF-8/BOM/换行/diff 检查通过。安装的 CLI 0.163.0-alpha.11.2 在独立 home 与 loopback 假模型实测两端点全链通过；原始空 rollout 首次写入原因未证实，原未知端点不核销。真实业务、其它平台/Node 与宿主遵循沿原治理队列取证。
- 原 installer/sparse 已覆盖变更的全部根文件，现有 CI 已包含受影响测试，无依赖安装、schema/私有配置迁移或旧文件清理。版本治理仅针对实际 owner 目录变化，本轮没有此类路径，不以并行 BOS 版本变化作为本次发布。详细证据及下游 profile 接入见[验证记录](../maintenance/validation/night-client-lifecycle-2026-10-23.md)。

## 2026-10-23 BOS 待办创建日期与可选日期排序

- `framework-maintenance` 基线 `a2ae955`；BOS 0.14.0→0.15.0 MINOR，默认排序变化标记 breaking 并提供 Migration。所有个人待办默认创建日期升序，默认列表补创建时间；个人 CLI/skill 增加 --sort / --order，JSON/MCP 支持创建/预计完成/分配/执行/操作五类日期，显式排序覆盖默认，同日需求号升序，缺失或无效日期置后。筛选日期、归属/来源/状态分类与计数独立，工作量仍默认执行日期。
- 查询脚本、技能、reference、专项、owner AGENTS/README/manifest、根总览、能力手册、维护入口及既有 P2 队列同步。原到期顺序可显式指定预计完成时间恢复，正常更新及已启用索引刷新取得，无私有配置或数据迁移、旧文件清理，未同步业务副本。
- Windows Node 24.14.1：查询专项 41/41、文档链接定向 1/1、JS 语法和 diff 检查通过。合成用例覆盖三个来源口径默认值、五类日期双方向、同日/无效日期、CLI 参数任意顺序及筛选与排序独立；真实只读项目待办返回的 metadata 与创建日期排序一致，上游一次超时后按原条件有限重试成功。业务身份/编号/正文及条数未落仓，其它平台/宿主遵循沿既有 P2 队列验证。
- 工作树版本检查识别本轮 MINOR/breaking 与迁移说明，无本轮新增问题；全量仍被既有 xc 三份发布记录缺 commit 的六项问题阻断。实施阶段保留已有六份全局维护文档改动，未暂存、提交、推送、写回 BOS 或创建临时文件。用户随后授权本轮 c + p，复用 41 项查询测试、文档检查和真实只读验证，仅补精确暂存、staged 版本门禁及 origin/master 完整出站核对；本轮只提交日期列/排序及对应说明，其他文档与客户端并行改动保留，结果以 Git 记录为准。

## 2026-10-23 BOS 项目与产品非项目来源

- `framework-maintenance` 基线 `ccd16cd`；新增个人查询互斥 `--proj` / `--dev` 来源开关，未选模式默认 todo，可叠加已有工作量日期。项目精确 source，产品按所有非项目来源在本地分类；来源缺失单列待核对，不猜上游否定/多选语法，错误不删条件重查。JSON/MCP 使用本地 sourceScope，原无参数 serve、通用 list 默认值和详情分支兼容。
- 查询 skill/脚本/专项测试、owner AGENTS/README/manifest、源总览/能力目录/指南、维护路由/既有 P2 队列及 0.14.0 MINOR 草稿同步；源规则沿正常更新及已启用索引刷新取得，无配置迁移、旧文件清理或业务副本同步。来源口径归查询 reference，不复制完整分类规则到其它入口。
- Windows Node 24.14.1 查询专项 39/39、文档链接定向 1/1、语法与 diff 检查通过；真实只读验证项目待办、非项目待办及带日期工作量组合，业务数据仅在内存中核对，不落仓身份/编号/正文/计数。验证程序子进程未取得可用输出的两项改用同一模块直接调用核对，原因未证实，不归因服务端失败。其它平台/宿主和上游完整性沿既有 P2 队列核对，不将配置存在视为 CI 实跑。
- 实施时工作树版本校验识别 BOS 0.13.0→0.14.0，无本轮新增问题；全量仍为既有 xc 三份历史记录缺 commit 的六项问题。实施阶段未暂存、提交、推送或创建临时文件；用户随后授权本轮 c + p，复用 39 项查询测试及有效文档验证，仅补精确暂存、staged 版本门禁和 origin/master 完整出站核对。并行夜跑已先行提交为 `8e97a8a`，本轮据新 HEAD 将发布基线更新为 0.13.1→0.14.0，只提交来源查询及对应说明，保留其它全局文档修改；本轮验证不覆盖夜跑实现，结果以 Git 记录为准。

## 2026-10-23 夜跑退出与客户端诊断

- `framework-maintenance`，实施基线 `ccd16cd`；BOS 0.13.0→0.13.1 PATCH。退出夜跑后的单人实施沿普通流程，按唯一降级契约保留独立 worktree、固定基点、原预算/三截止/授权、未知资源与既有恢复记录；原 run 不删除、不改写为单人受管计划，双开发、独立审查和冻结门禁保持。已确认转换不因原 `--night` 再入夜跑。
- Codex stdio 按请求 ID 保存方法，诊断白名单只归档 provider/category/method/rpcCode/stage；拒绝、超时、退出和异常载荷分类，不记录参数及原始服务端消息、不自动重试。诊断进入能力预检、监督、JSONL 命令与恢复回执；修正监督将 interruptRequested 当作 ACK 的原有映射，终态及资源退出仍独立取证。
- 普通降级复用 Git/Overlay/交接工具，不新增执行器或状态库。现行双 Developer PLAN 模板及受管 schema 无需修改；无需配置迁移、安装器变动或旧 run 清理。根 scripts/lib/** 已在既有 sparse 路径，现有 CI 覆盖新增诊断 helper 与专项测试。
- Windows Node 24.14.1：客户端/监督/能力预检/入口专项 56 通过、1 个真实浏览器环境用例跳过；原受管 PLAN、治理、集成、分发、契约、报告和周额度 63/63；工作区套件 16/16，其中新增双仓退出与交接恢复演练在最终契约上单独复验通过；文档链接 1/1，diff 空白与严格 UTF-8/BOM/换行检查通过。stdio 测试验证真实解析链的乱序、拒绝、超时、退出、异常载荷及敏感字段隔离；工具演练使用真实隔离 Git/Overlay 与 task-handoff，不代表模型实际遵循。
- 工作树组件校验识别 BOS PATCH；与 HEAD 全量基线对照，本轮无新增问题。全量仍被既有 xc 三份不可变发布记录缺 commit 的六项问题阻断，实施阶段未改历史记录、未执行暂存门禁或宣称全仓通过。真实浏览器、Windows/macOS/Linux × Node 22.5/22/24 CI 及真实宿主遵循沿既有治理队列取证；本次未运行远端 CI。
- 业务副本未同步，无配置迁移或旧 run 清理。已核对能力目录：无新增能力名称或调用参数，目录无需改写；指南与入口已局部同步。保留实施前六个文档文件的既有修改；实施阶段未暂存、提交、推送或处理业务数据。专项证据沿现有 validation-evidence 工具保存于 `.git/imedical-night-exit-validation-20261023.json`，suite 为 `night-exit-client-20261023`；显式传入 --evidence-file，指纹匹配时可复用。

- 用户随后明确授权 `c + p`。提交阶段只纳入夜跑退出与诊断的路径/片段，BOS 发布 0.13.1；并行 0.14.0 查询专项及既有文档修改保留在工作区，不更新业务副本，实际提交与推送结果以 Git 回执为准。暂存组件版本门禁与空白检查通过；受并行 owner 文档变更影响的入口用例在暂存快照复验 3/3 通过，运行代码沿用实施阶段专项证据。

## 2026-10-23 菜单采集固定入口与月度补跑

- `framework-maintenance` 基线 `5bf0f40`；coding-iris-plugin 0.20.5→0.20.6。补齐 iris-menu-sync 原有全量采集步骤的稳定入口，复用 helper、resolver 和离线发布器；运行时 schema/源码摘要固定、启用组动态选择、物理分段解析、无 ID/重复节点、分页完整性、带校验和断点、异常删除/空组停止及证据原子发布形成同一流程。
- 新入口和 source skill、owner AGENTS/README/manifest、不可变发布草稿、能力目录/指南、知识说明、更新 runbook 及原三平台 Node22/24 CI 同步。支持按显式时区判断当月是否已有完整成功快照，无需 MCP 即可跳过，可由宿主平日检查补跑；平日不冒充法定调休或开机即时补跑。安装/更新器、thin-index、已有快照 schema 与 vendor 不变，不迁移/清理旧快照。
- Windows Node 24.14.1：新采集专项 11/11、原知识菜单回归 16/16（含 PS7/PS5.1 thin-index 与真实 sparse 刷新）、文档链接 1/1 通过。已授权目标工程完成固定入口登记、无人值守试跑、连接故障停止后的断点恢复、发布文档回读和同月无 MCP 跳过验证；实例配置、来源、范围和采集证据仅留目标工程，不写共享仓。长期调度、BDP 预设外覆盖和其它平台实跑继续沿既有 P2。
- 工作树版本比较识别一个兼容 PATCH，无本轮新增问题；完整审计仍受既有三份 xc 历史记录六项 commit 字段错误阻断，不修改历史记录或宣称全仓校验通过。实施阶段保留并行文档修改，未暂存、提交、推送或复制未提交文件到业务能力包 checkout；试跑从维护能力包入口显式指向目标工程。用户随后授权本轮 c + p，复用功能指纹，仅精确暂存本任务文件/片段并补 staged 版本门禁与完整出站核对，Git 结果以提交记录为准。成功 run 自清理，测试夹具由测试清理；历史 generation 与正式实例配置保留。

## 2026-10-23 BOS 个人开发待办与工作量

- `framework-maintenance` 基线 `882bc7e`；bos-plugin 0.12.1→0.13.0。新增 skill/CLI `--todo [日期或范围]` 与 `--workload 日期或范围`、等价 JSON/MCP 模式。无日期查全部开发待办，带日期按预计完成时间；工作量执行日期必填。接受人、当前人及状态组合集中在[查询协议](../plugins/bos-plugin/references/usage.md#个人待办与工作量口径)，未知组合单列；旧通用模式与配置保持兼容。
- owner AGENTS/README/manifest、查询 skill/reference/script/test、发布记录、根总览、能力手册和维护入口同步；已有 BOS 三平台 Node 22/24 CI 自动覆盖新增专项。安装/更新器与 thin-index 生成器不变，正常更新能力包并刷新已启用入口，无配置迁移或旧文件清理，未更新业务副本。
- 同轮补齐 Agent 展示契约：默认列表必含需求号/完整标题，模式默认日期列与状态，末尾追加发起人/发起组（明确自定义时按所选列），自定义其它列、单行编号串、零结果/异常编号/待核对集合及简明口径统一由查询 skill 的“输出格式”维护。自然语言选择格式，不增加脚本参数或重跑业务查询；本次未提交的 0.13.0 发布草稿同步扩展范围，复用有效运行测试，仅补文档链接与格式样例审阅。
- Windows Node 24.14.1：查询专项 35/35、发现/更新集成 11/11、文档链接/清单定向 1/1 通过；真实只读冒烟覆盖全部待办、单日待办及期间工作量，含新建、返工、已转他人的挂起与自己接受且已完成的组合。私有身份、编号、返回正文和计数未落仓。其它宿主/平台、状态演进、转派语义与服务端端点/总量完整性沿既有 P2 BOS 队列核对。
- 工作树版本校验识别本轮 MINOR，无本轮新增问题；完整审计仍受既有 xc 三份历史发布记录缺 commit 的六项问题阻断，未修改不可变历史记录或声称全仓校验通过。实施阶段保留原有并行文档修改，未暂存、提交、推送、写回 BOS；未生成业务产物或任务临时文件，发现测试自建隔离夹具由其清理逻辑回收。用户随后授权本轮 c + p，复用有效功能验证，仅补精确暂存、staged 版本门禁及 origin/master 完整出站核对；提交/推送结果以 Git 记录为准，原有全局维护文档改动不纳入本次提交。

## 2026-10-22 人工验收 --pass 快捷输入

- `framework-maintenance` 基线 `58b852b`；demand-delivery-plugin 0.6.1→0.7.0。`--pass` 由 Agent 解释，复用现有人工 `decide`/`passed` 与交付链，支持逗号列表、缩进/空行及多行“编号＋标题”；推荐编号定位后以标题复核，冲突/无法确认只暂停相关条目，验收会话中可省略技能名。业务示例仅用于格式讨论，未登记真实需求或交付。
- 裸参数唯一定位、逐号范围/标题冲突、重复结论恢复、显式暂停、主子门禁及帮助/讨论只读边界归技能“接收结论”；索引 CLI、v1/v2 schema、安装更新器和 thin-index 不变。owner AGENTS/README/reference、根 README、能力目录/指南及维护入口同步；backlog 复用现有 P2 连续验收队列，长期授权决策不变。
- Windows Node 24.14.1：文档链接/能力清单定向 1/1、主子/无代码入口契约定向 1/1 通过。版本工作树校验识别本轮 MINOR，无本轮新增问题；全量仅返回已登记的 xc 三份历史发布记录缺 commit 共6条问题，未将其记为通过。未改运行实现，不重跑完整 Git/BOS 回归。
- 源码试读核对多行标题含数字、单行去重、裸参数多候选、范围/标题冲突、重复通过恢复、暂停及 `--help --pass`，属于单 Agent 文本审阅，不等同真实宿主执行或跨模型实测。业务副本正常更新能力包并刷新已启用索引即可，无配置迁移或旧文件清理；本轮未执行副本更新。
- 实施阶段保留原有并行文档改动，未调用真实 BOS 或创建任务临时文件。用户随后授权本轮 c + p，复用有效定向验证，仅补精确暂存、staged 版本门禁及默认 origin/master 完整出站核对；提交/推送结果以 Git 记录为准，原有全局回看文档改动不纳入本次提交。


## 2026-10-22 统一 skill / Agent 帮助与正常更新分发

- `framework-maintenance` 基线 `9682193`；71 个项目 skill（含 init、xc）、8 个 Agent 及源仓维护 skill 接入[统一帮助协议](../docs/guides/capability-help.md)。帮助在业务步骤前结束，混合执行参数不产生执行授权，默认简明；参数继续归 owner，vendor 不改。
- 19 个 owner PATCH 与不可变发布记录、AGENTS/README、根与项目文档、维护入口和长期决策同步。源定义与协议走既有 sparse 路径，旧索引继续解引用；未改变索引模板、生产安装/更新器、启用集合、私有配置或维护目录分发边界。Overlay 无 docs 映射按 manifest CapabilityRoot 读取。
- Windows Node 24.14.1：新分发专项 PS7/PS5.1 各 4/4、文档布局 7/7、PS5.1 索引专项、两宿主更新器全套及最终静态检查通过。两处 xc 标题前声明/背景块移至帮助后；更新器测试夹具补齐当前运行时四个现有依赖，生产逻辑不变。无父历史 Agent 六场景帮助抽样仅仅读说明，完整范围及命令见[本轮记录](../maintenance/validation/capability-help-2026-10-22.md)。
- 工作树版本校验识别 19 个 PATCH，无本轮新增问题；全量检查仅受已登记历史发布记录问题阻断。成功功能证据记录并回读，未将版本失败标为通过；其它宿主、非 Windows/Node22 CI 及真实业务副本沿既有 P2 队列取得，不新增重复事项。
- 实施阶段未暂存、提交、推送或更新业务副本；用户随后授权本批 c + p，复用六项有效功能指纹，仅补精确暂存、staged 版本门禁及 origin/master 完整出站复核，结果以 Git 记录为准。源仓结果不代表下游已升级；任务临时目录已核实清理并独立确认不存在，正式证据留维护验证目录。

## 2026-10-22 UI 跨主题共性能力闭环

- `framework-maintenance` 基线 `925142a`；imedical-ui 0.1.1、iris-ui 0.2.2、coding-iris-plugin 0.20.4 补齐共性与皮肤归类、主题条件/共用调用者核对及已验收主题兼容证据。单主题材料不自动缩小业务适用范围，公司规范推广证据仍独立判断。任务模板复用既有记录，不新增台账或验收状态机。
- 新增显式文件只读主题候选扫描器，复用 Workspace/Overlay resolver；候选非违规，零候选非 UI 通过，动态及跨文件等限制明确。前端条件路由、评审入口、匿名正反例、版本依赖/发布记录、根与 owner 文档、能力手册及既有 P2 UI 队列同步，扫描器专项加入原三平台 CI；HISUI、生产 CSS、安装/更新器与业务源码未改。
- Windows/Node 24.14.1：扫描器 16/16、IRIS UI 9/9、公司 UI 10/10、文档链接/清单 1/1 通过，含 PS7/PS5.1 薄索引和更新器四态。无此前对话的独立 Agent 完成三场景试读；其指出的两处全状态措辞已按风险收窄。独立源码审查的词法边界问题已修正并补例。UTF-8/JSON/JS 语法、相关本地链接和 diff 检查通过。范围与原命令见[验证记录](../maintenance/validation/ui-cross-theme-2026-10-22.md)。
- 工作树版本比较识别三项 PATCH，无本轮新增问题；完整审计仍受已登记的三份历史发布记录六项 commit 错误阻断，不声称全仓门禁通过。功能指纹已记录/回读，D 盘任务证据暂留用于待提交复用；测试目录及失败临时片段已清理。
- 实施阶段未暂存、提交、推送或更新业务副本；用户随后授权本批 c + p，复用有效功能证据，仅补查精确暂存、版本门禁与 origin/master 出站范围，结果以 Git 记录为准。临时指纹在提交收尾后清理。后续业务更新沿 canonical-once/模块 NoPull 流程；源仓试读和 Windows 结果不替代跨平台 CI、真实宿主/业务渲染或用户 UI 验收，不新建重复验证队列。

## 2026-10-22 主子需求与共享提交记录

- framework-maintenance基线b40f4e8；bos-plugin 0.12.0和demand-delivery-plugin 0.6.0新增一级主子代码归属，按业务验收拆分，代码只归主需求；各自编号日志可引用同一主提交，明确none跳过代码阶段，证据不明保持待处理。规则归[共享协议](../docs/demand-code-ownership.md)，新草稿v4/验收v2不自动迁移旧数据。
- 同步技能正文、owner AGENTS/README、数据/日志/验收接口、BOS workflow、总览及能力手册、正常更新说明和两份发布记录；根scripts/lib校验沿既有分发，新专项纳入原三平台CI，不创建新插件、状态库或BOS页面操作器。
- Windows/Node24.14.1：新增12项及原59项唯一功能用例均通过，含官方提交结果→四目标mock BOS→本地bare单次push；验收最终代码相关30项复测通过，另BOS发现与迁移11/11通过（修正夹具漏复制docs目录，断言helper分发；生产更新器未改）。目录/链接定向检查及最终UTF-8/JSON/JS语法/diff通过，功能指纹已记录并回读，任务D盘临时根已核实清理。两个MINOR版本无本轮新增问题，完整版本校验仍受三份旧发布记录缺commit的6项错误阻断，未改历史债务。证据、命令及局限见[验证记录](../maintenance/validation/demand-code-ownership-2026-10-22.md)。
- 实施阶段未暂存、提交、推送、写真实BOS或更新业务副本；用户随后授权本轮c + p，复用有效功能证据，按精确范围、staged版本门禁及origin/master出站复核执行，结果以Git记录为准。正常更新及真实服务/宿主与非本机CI证据仍按现有队列和独立授权处理。共享脚本变化需完整更新能力包，模块保持NoPull刷新；无新增凭据配置或旧文件清理。

## 2026-10-22 demand-commit 无交集上游更新的自动接续

- 本轮 `framework-maintenance` 以 `5b58abe` 为实施基线，demand-delivery-plugin 0.5.2→0.5.3 PATCH。HEAD 前进仍返回退出码 3 / refresh-required，由 Agent 检查每个新增提交的路径与实际影响、原需求文件状态及完整消息；满足无交集和内容不变后正式重新 plan 并沿用已有授权，最多两次。CLI、计划 schema 和提交/BOS/推送各自授权保持。
- 条件、次数与停止行为集中在 owner 的同步复核协议；修改后又撤销、重命名两端、共享依赖影响及来源不明漂移均明确核查。同步由技能独立执行，复用现有进程级 hook 去重；无 hook 仍可用，local-only 遵守使用者自己的 hook。所有仓库同步后及每仓暂存前改为读取现场，保留多仓部分成功回执。
- owner AGENTS/README/skills、根总览、能力手册、维护入口及既有 P2 需求交付观察项同步；发布记录新增，不改全局 hook、安装/更新器、部署布局或薄索引生成器。长期条件归 owner 协议，不在长期决策复制正文；既有 CI 已覆盖插件专项，无需新增平行矩阵。
- Windows / Node 24.14.1：插件专项 59/59 通过，涵盖连续两次无交集更新、三文件指纹与消息保持、净差异隐藏的交集、hook 去重与其他检查拒绝、无 upstream 约束、实时漂移和刷新回执接入验收台账；文档部署链接与清单 1/1 通过，严格 UTF-8、JSON、Node 语法及 diff 检查通过。合成 Git 测试曾被沙箱阻止写 .git/config，随后仅对隔离测试使用沙箱外权限；系统临时目录与 D:\tmp\Codex 中本轮测试目录均已清理。
- 组件工作树校验识别本插件 PATCH，无本轮新增问题；全仓仍有已登记的历史发布记录问题，不声明完整门禁通过。提交前按授权精确暂存并执行 staged 门禁；功能证据按 owner 与共享 workspace-context 范围记录，指纹匹配时复用。
- 实施阶段未暂存、提交、推送；用户随后授权本轮 c + p，沿精确范围、功能证据和 staged 门禁执行，推送目标为当前上游 origin/master，结果以 Git 记录为准。未写 BOS 或同步业务副本。已有工程后续正常更新能力包并刷新已启用索引，无配置迁移或旧文件清理；Windows/macOS/Linux × Node 22/24 矩阵实跑及真实 Agent 自动复核、次数继承和停止轨迹沿既有 P2 队列取得，隔离脚本测试不替代宿主实际行为。

## 2026-10-22 Worktree 阶段恢复点与实际加载入口

- 通用机制集中在 `docs/guides/worktree-review.md`：创建/接续时核对提交策略，按有效授权保存阶段本地 commit，交付最后本任务 SHA 与剩余未提交范围；阶段提交、人工验收、合并、push、部署及清理分别核对，不扩大权限。
- 修复只在新建 worktree 时出现的弱路由：Coding Agent、协作协议与 standard-change workflow 覆盖创建、接续、阶段完成和交接；普通 IRIS 前后端必读的通用规则直接触发同一规范。agent-context-kit 项目模板及初始化说明补条件入口，现有项目仅在授权上下文维护时合并，普通更新不覆盖 AGENTS 或写入持续提交权限。
- coding-iris-plugin 0.20.3、agent-context-kit 0.5.1 为兼容 PATCH；未改 UI 插件、提交脚本、安装/更新器、钩子或业务文件。角色/流程身份及 bindings 无变化，registry 不需改写；维护入口、长期归属、README 与能力手册同步。
- 验证：文档部署链接与能力清单专项 1/1 通过；19 个当时已改/新增文件的严格 UTF-8、JSON 和本地链接检查通过，diff 检查通过。一轮独立差异审查及四场景试读通过：仅创建授权、阶段提交预授权但视觉待验、明确验收后提交、同文件存在并行修改。静态路由和试读不代表真实宿主已执行；后续沿既有 P2 worktree 队列取证。
- 用户已授权本轮精确提交与推送，沿 staged 版本门禁执行，结果以 Git 记录为准。未同步业务副本、修改项目授权或提交原业务 worktree；未创建任务临时文件。

## UI 使用复盘与验证范围纠偏（2026-10-22）

- 本轮 `framework-maintenance` 以 `c8c885b` 为实施基线，按用户要求汇总 UI 技能实际使用并回归 canonical 源仓；原有 DOC:HEAD/body、主题、首屏/侧栏和部署保护内容复用，未重复新增规则。范围与证据见[匿名复盘](../maintenance/validation/ui-skill-usage-2026-10-22.md)。
- 共享测试协议明确已知局部调整的必要检查、按剩余风险升级、有效证据复用及停止条件；工具故障与产品缺陷区分。iris-ui 0.2.1 引用同一规则并补模板预览/实际打印隔离及空工具栏案例；coding-iris-plugin 0.20.2 条件化控件状态检查，UI 依赖下限同步。静态交付不冒充运行通过，夜跑最低层级与部署核验保持。
- README、能力指南、维护入口/索引、既有 P2 观察项及两份 PATCH 发布记录同步；公司规范原件与可分发证据边界不变。未改生产 CSS/JS、HISUI、运行器、安装更新器或项目配置，无需迁移或清理旧入口；已有工程后续沿正常根/模块更新取得，不手工补写部署态。
- 三个现有定向专项各1项通过（项目链接/归属、UI 条件路由、夜跑最低层级），diff 检查通过；独立只读审查和四场景试读符合预期。只记录本轮覆盖，不启动浏览器或完整回归，不把试读记为跨模型提效。
- 组件工作树检查识别 coding 0.20.1→0.20.2、iris-ui 0.2.0→0.2.1；仅返回已登记的三份 xc 历史发布记录缺 commit 的6条错误，无本轮新增问题，不声明全仓门禁通过。未修改历史发布记录，后续提交仍需精确暂存并检查 index。
- 实施阶段未暂存、提交、推送、更新业务副本或操作真实服务；未创建临时文件。用户后续授权 c + p，复用本轮定向验证和试读证据，仅补查精确暂存、版本门禁与默认 origin/master 出站范围；提交和推送结果以 Git 记录为准。真实宿主按范围停止及必要风险覆盖仍沿既有 P2 UI 观察取得，不另建平行治理队列。

## 全局回看覆盖点

2026-10-28：以上轮实际审计终点 `c233704` 为基线，逐提交回看 `c233704..9a8996f` 共 8 个提交；`f9a60cf` 是上轮文档收尾，其覆盖范围仍截至 c233704。按实际文件核对 owner AGENTS/README/manifest、规则/协议/脚本、Agent/workflow、手册、分发与更新入口及测试。下轮从 `9a8996f` 之后继续。

| 变更族 | 提交 | 当前事实源与核对边界 |
|---|---|---|
| 上轮全局上下文收尾 | `f9a60cf` | 仅修复原 XML 导航与交付说明，未提前覆盖后续功能 |
| Overlay 实体源码 | `8e37ca8` | workspace-context 与 Overlay runbook；path/target 相同允许实体源码，真实 Git 归属和隔离保持，先更新共享 capability 再授权接入 |
| 人工源码交付与会话保护 | `adf2490` | 独立导出器及交付 helper；原件、会话连续性、退出响应与许可实际回落分别核验，助手后续唯一实现以 coding owner 为准 |
| 版本范围人工导出 | `b09de95` | tools/iris-code-export；版本限定对象范围，内容来自当前实例，补充/映射与选择摘要绑定 Resume，v9.2 显式全仓 |
| 夜跑项目准备与逐用例能力 | `189d017` | night-capability 与治理/验收协议；原预算内补齐与定向复验先于详细 PLAN，逐用例认证/副作用取证，共享退出未知仍阻断 |
| 独立开发方式与离线源码闭环 | `7128e17` | coding 离线协议、远端 operation gate 及 source-delivery；模式唯一配置、源码 Git 与私有原件分离，人工 ZIP 取同一核心，Verify 不代表现场验收 |
| 帮助优先与跨平台夹具 | `8434073` | 帮助先于模式/业务前置；夹具沿物理临时目录并保留显式链接拒绝，源码回归与远端矩阵结果分开 |
| Windows 短路径一致性 | `9a8996f` | 共享 GitRoot 匹配及源码/XML helper；8.3 与物理等价路径不扩大归属，既有链接、范围和远端保护保持 |

本轮修正（framework-maintenance）：

- 根 README、项目文档首页、能力目录/指南和维护路由遗留的项目同步条件未显式限定 connected；补齐 developmentMode 先行、离线材料交付和 Windows 打包边界，并删除 README 已过时的“当前维护修复”流水。owner 源定义已覆盖该顺序，无需再次修改插件、版本或发布记录。
- 能力目录及长期决策补齐夜跑“基础探测→原预算内补齐→定向复验→详细 PLAN”的路由；维护摘要合并重复状态，保留实体 SourceRoot、唯一 helper 与实际分发边界。更新 runbook、owner AGENTS/README、Agent/workflow、目录契约和 sparse 已与功能提交一致，本轮无算法、配置迁移、旧文件清理或业务副本更新。
- 读取最新 [Agent evolution CI](https://github.com/SkylerCook/imedical.agents/actions/runs/40718533104) 确认 Windows/macOS/Linux × Node22/24 六作业共同失败于旧“逐项授权”断言，本机单测复现相同位置。测试改为检查共享生命周期指向唯一授权段，并在该段核对默认只读、人类明确授权、动作/自动待审两分支、源仓身份/owner 范围/独立 worktree 和外部动作各自授权；不为通过测试改写当前协议。该漂移来自更早的 feedback 协议演进，本次通过实际 CI 发现并收口。
- CI 同组六文件本机回归最终 8/8 通过；首次沙箱运行受夹具 Git 配置写权限限制，受控沙箱外同组复验通过。文档 project links resolve 定向 1/1 通过；近期与本批共 62 份 Markdown 的 892 个源仓链接/锚点、5 个项目模板引用、严格 UTF-8 与 8 提交索引覆盖/去重核对通过，模板引用按部署根及初始化契约解析。逐提交结构检查确认 9 个 owner 的 14 次版本变化各有对应新增发布记录，当前 19 个 manifest 的 13 项直接依赖范围兼容；不替代历史完整发布审计。
- 读取 9a8996f 的 GitHub 回执时 Deployment/Sparse 等仍排队，不能宣称短路径修正后的完整矩阵通过；沿 P2 第 7 项取得后续结果，真实医院/宿主验证仍沿 P1/P2 原队列。独立 ZIP、双 PowerShell、Overlay 和夜跑的功能结果保留实施记录范围，不计为本轮重跑。用户已授权完成后 c + p，精确暂存本批全局文档与测试后执行 staged 门禁、双远端出站核对；实际提交/推送以 Git 回执为准。

### 上轮全局回看（2026-10-28，覆盖至 c233704）

2026-10-28：以上轮实际审计终点 `0984232` 为基线，逐提交回看 `0984232..c233704` 共 3 个提交；`5698dd3` 是上轮文档收尾，不把其提交时间视为后续功能已审计。核对实际文件、owner 协议/脚本、人工工具源、分发白名单、手册、版本与维护记录。下轮从 `c233704` 之后继续。

| 变更族 | 提交 | 当前事实源与核对边界 |
|---|---|---|
| 上轮全局上下文收尾 | `5698dd3` | 覆盖范围仍截至 0984232；核对本轮新分支是否需要调整既有路由，不重计旧功能测试 |
| 人工独立导出与离线 XML 交付 | `ed7e954` | tools/iris-code-export 与 coding 离线协议分开；前者独立 ZIP 不部署，后者使用完整源码 XML，按对象编辑并独立校验增量/回退交付，不自动导入编译 |
| 人工操作与现场排查说明 | `c233704` | 工具就近 README、相对截图和实际脚本参数；路径/清单/401/恢复按现场核实，单目标证书及退出样本不推广为通用结论，本机 ZIP 示例不进入共享源 |

本轮修正（framework-maintenance）：

- 27 份近期变更 Markdown 的导航检查发现 XML 导出协议引用了已不存在的离线章节；修正为当前固定处理路径。coding-iris-plugin 0.23.0→0.23.1，仅修复 reference 链接并同步 README/manifest 与新发布记录，AGENTS、skill、脚本、人工 ZIP 及目录契约已核对，无需改动；七个直接消费者的现有范围仍兼容。
- 项目文档首页补齐完整 XML 带回后的离线入口，明确 ProjectItem 清单不是源码、回退包不是现场即时备份；根 README 的三层结构限定为核心协作能力，tools 为另行携带的独立源。长期决策补 tools 整体不分发、本机 ZIP 与共享源分开及离线交付授权/验证边界，维护摘要按受管/人工场景分流。
- 修正能力使用指南中遗留的“全部 BOS 日志后再 push”示例，按当前默认先 Git 推送、再各自补录，完整交付仍要求全部适用回执。未改变兼容旧顺序的 owner 状态机；能力目录和更新说明已覆盖新增路径，无需重复改写。
- 治理队列沿原第 4/7 项 P1/P2 合并 XML 受管试点、人工小样本与离线验证边界，补真实材料、现场并行修改、导入/编译及回退前漂移核对；没有新增序列或调整优先级。不改脚本、安装/更新算法、sparse、thin-index、既有发布记录或业务副本，不生成/覆盖本机人工 ZIP，不连接真实服务。
- 验证：文档 `project links resolve` 定向 1/1 通过；近期与本批合计 28 份 Markdown 的 702 个本地链接/锚点、严格 UTF-8 及 3 个提交的索引覆盖/去重通过。逐提交结构检查确认 8 个 owner 的 8 次版本变化各有新发布记录，当前 13 项直接依赖范围兼容；该检查不替代历史完整发布审计。人工双宿主/ZIP 及现场小样本保留原记录的证据范围，不计为本轮重跑或通用兼容证明。
- 本轮共 11 个路径，用户已授权完成后 c + p；提交前精确暂存并执行 staged 组件/差异门禁，沿 README 双远端约定核对完整出站范围。未创建任务临时文件，未更改本机 ZIP 或接触真实服务器；实际提交/推送以 Git 回执为准。

### 上轮全局回看（2026-10-28，覆盖至 0984232）

2026-10-28：以上轮实际审计终点 `16a5b6f` 为基线，逐提交回看 `16a5b6f..0984232` 共 8 个提交；`d3e22de` 为上轮文档收尾，后续各功能已有维护记录仍需纳入全局一致性检查。核对实际变更路径、当前 owner 入口/协议/脚本、手册、版本发布与验证边界。下轮从 `0984232` 之后继续，不能用本轮文档提交时间扩张功能覆盖范围。

| 变更族 | 提交 | 当前事实源与核对边界 |
|---|---|---|
| 上轮全局文档收尾 | `d3e22de` | 上轮审计范围仍截至 16a5b6f；保留其有效文档验证，不推导后续功能已审计 |
| 持续目录用途与导航 | `3b1c5bc` | owner projectDirectories、本地 extensions、project-docs 受管区；旧说明接管与普通更新、逐文件分类及恢复数据分别处理 |
| 实仓提交与主子日志 | `2101310` | real-repository-commit、代码归属及两 owner 的收尾协议；开发 worktree 来源与最终实仓 ref/hash 分开，parent 复用、none 跳过 |
| 需求名称产品标签 | `16b760c` | BOS entry skill 与实际生成器；Git/主题/工作来源共用逐条产品交付判据，流程名称与有无代码不直接决定标签 |
| v9.2 全仓对象清单 | `5282be4` | doctor 稳定参考路径保留，v9.2 是离线全仓 10 产品范围；版本/来源/实例当前内容分开，不自动扩大导出或访问服务器 |
| Git 发布与 BOS 补录解耦 | `a7f7762` | acceptance-session、代码归属及迁移契约；Git 完成释放发布权，BOS 单独恢复，全部适用回执齐备才算完整交付 |
| XML 双通道与代码基线 | `4960807` | coding 两 skill/reference、read-pool、source-sync 与固定 XML parser；图片包/代码预筛、纯采集/项目状态机、类源/安装产物与真实资格分别核验 |
| 部署有限安全恢复 | `0984232` | deploy-recovery 与部署保护；安全步骤共享有限额外尝试，额度耗尽停止；原授权不因技术失败自动失效，未知写与 503 不重放 |

本轮修正（framework-maintenance）：

- 总览为 XML 包／代码基线补齐协议入口和范围区分，项目文档首页纠正“全是医生站历史清单”的概括；保留 doctor 资产路径，不改原清单。更新 runbook 的交接段按实际目录解析和 Git 归属表达，区分空父目录与具体交接档案。
- 长期决策纠正 HEAD 前进后一律重新确认的陈旧表述，复用 owner 的有限自动复核；补齐 Git/BOS 完成与完整交付、受管只读池与跨进程排他、XML 通道和一般原生 MCP 优先规则的边界。安全部署恢复不推广为所有入口的统一重试策略。
- 维护摘要合并过期的实施／待提交流水，保留当前覆盖点与条件路由；backlog 的混合 XML 导入补齐 Web 应用及物理目录隔离，部署恢复补共享额度耗尽停止取证。均沿既有第 4/7 项 P1/P2，未新增队列或调整优先级。
- 当前能力目录与指南的 15 个非 xc 插件、58 个 skill、37 个 rule，以及 XML/基线、交付、产品标签和恢复条目已对照 owner；相关功能变更已同步，无需为本轮重复改写手册。只修改全局文档和维护记忆，不改插件（含 xc）、运行时、组件版本、不可变发布记录或业务副本，不重跑无关业务／完整运行时测试。
- 验证：文档 `project links resolve` 定向 1/1、7 份变更 Markdown 的 253 个本地链接/锚点与严格 UTF-8 检查通过，8 个提交的表格覆盖及去重通过；维护摘要由 5012 压缩为 4331 字符。逐提交结构检查确认 12 个 owner 的 20 次版本变化均有对应新发布记录，当前 19 个插件的 13 项直接依赖范围兼容；该检查不替代历史完整发布审计。`git diff --check` 通过，未创建任务临时文件、未同步业务副本或执行真实服务操作。
- 用户已明确授权完成后 c + p；提交前精确核对本批 7 个文档及双远端完整出站范围，执行 staged 版本门禁和暂存差异检查，复用有效文档验证。此前各功能的本机测试仅作历史证据，不将本轮文档检查计为新平台或业务验收；实际提交/推送以 Git 回执为准。

### 上轮全局回看（2026-10-24）

2026-10-24：以 `58b852b` 为上轮实际审计终点，回看 `58b852b..16a5b6f` 共 12 个提交，补齐此前明确未审计的 7 笔变更；`ab39cb0` 是上轮文档收尾，不把其提交时间误当功能审计覆盖点。本轮逐提交检查实际文件、owner 当前定义、共享协议、手册、维护记录和测试入口。下轮从 `16a5b6f` 之后的提交继续，历史版本与实施阶段的未提交状态只表达当时范围，当前源码状态以 Git 为准。

| 变更族 | 提交 | 当前事实源与核对边界 |
|---|---|---|
| 人工验收快捷输入 | `882bc7e` | demand-acceptance 的 --pass、编号/标题复核；不将帮助、查询或源码参数自动当交付授权 |
| BOS 查询口径与排序 | `5bf0f40`、`a2ae955`、`4e0c75d` | BOS 查询 skill、usage 与真实脚本；todo/workload、项目/产品来源及日期排序均有 owner 契约，参数透传不冒充服务端验收 |
| 菜单固定采集与补跑 | `ccd16cd` | menu-knowledge-sync 与 refresh/sync 脚本；项目快照、宿主月度触发、来源 fingerprint 与中断恢复分开，无自动调度授权 |
| 夜跑退出与客户端生命周期 | `8e97a8a`、`11cecf5` | 夜跑 workflow、诊断/监督共享库；退出后受监督串行与原 run 分开，ACK/终态/进程退出不互相替代，真实宿主效果沿原队列 |
| 上轮全局文档收尾 | `ab39cb0` | 六份上下文说明及覆盖索引；保留其有效验证，接续当时明确尚未审计的功能范围 |
| 宿主依据与规则路由 | `467cf3f` | context owner 的 source.md / 规则路由维护；项目与用户级观察、目录接入与实际加载分别取证，未知项不扩大扫描或创建授权 |
| UI 提炼与业务经验回归 | `bf0904f` | UI 两层与 coding 各有 owner，feedback 写入授权归唯一 skill；源仓隔离待审补丁可复用明确预授权，不代表业务副本更新或接入后提效 |
| 项目知识库目录治理 | `2073a97` | projectDirectories、目录治理与解析器；首次接入、空目录补齐、具体迁移批准和备份恢复分开，旧任务/显式路径保持 |
| IRIS 项目按需开发与发布 | `16a5b6f` | project-demand-development、source-sync 与公共远端库；project/上下文模式条件分支，分层基线、source plan、复审/发布及远端资格分别核验，不承诺外部客户端受控或即时 License 回落 |

本轮修正（framework-maintenance）：

- README 与使用指南消除独立 CSP 编译/默认 direct 的无条件表述，明确项目按需分支优先及准确触发条件。长期决策的 feedback 写入回归 owner 有效授权契约，Storage 复审/finish 与普通分支区分，不扩大当前授权。
- 按 owner 目录契约修正表单、交接及接口解析的全局示例；运行根解析移到编排 CLI 示例之前，保留稳定锚点。源仓维护 skill 只修正同一处产物目录说明，不分发到业务项目、不新增组件版本。
- 维护摘要移除历史未提交/隔离实施流水，按任务保留知识库治理、项目同步发布、查询/交付及业务验收后经验的指针。backlog 分开已在源仓实现的项目分支真实验证与普通 direct 增量保护缺口，沿既有第 4/7 项补齐范围，优先级与责任不变。
- 本轮仅修正全局文档及维护 skill，无插件（含 xc）、运行时、生产安装/更新器、版本记录或业务副本变更。能力目录、项目文档首页、owner 版本/依赖及更新说明已核对，无需为同步清单重复改写。
- 验证：`node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js` 1/1 通过；9 份文档的 313 个本地链接/锚点、严格 UTF-8、12 个提交覆盖及去重通过。维护 skill 的 frontmatter/调用方式不变，运行根说明先于 CLI 示例；摘要约 4725→3885 字符。逐提交结构检查确认 14 个 owner 的 29 次版本变化均有对应新发布记录，当前 19 个插件的 13 项直接依赖范围兼容；该检查不替代完整历史版本审计。修正迁移段落后的 EOF 空行后 `git diff --check` 通过，暂存区为空、无新增未跟踪文件；不重跑无关运行时或业务集成测试。
- 用户已授权完成后 c + p，提交阶段精确暂存并核对双远端出站范围；不将源码审计、文档检查或本机历史结果当成新业务部署、真实 License 或跨平台证据。未创建临时文件，未同步业务副本，实际提交/推送以 Git 回执为准。

### 上轮全局回看（2026-10-22）

2026-10-22：以已交付的 `c8c885b` 为基线，回看 `c8c885b..58b852b` 共 6 个提交。逐提交核对实际变更路径，并对照 owner 的当前定义、共享协议、手册、维护记录与测试入口；本轮修正只涉及全局文档，未重跑各功能的完整回归，也不把前轮记录的结果算作本轮实测。下轮从 `58b852b` 之后的提交继续。

| 提交 | 变更与当前事实源 | 本轮核对 |
|---|---|---|
| `3ea6242` | UI 局部验证范围与停止条件，testing-protocol、iris-ui 与 coding-iris | 规范已有单一来源；局部通过不扩大为实际打印/业务验收，保留原 P2 观察 |
| `5b58abe` | worktree 阶段恢复点，worktree-review、Coding Agent、通用规则与项目模板 | 创建/接续/阶段/交接均有条件入口；提交授权与验收/合入分开，registry 与角色身份不变 |
| `b40f4e8` | 上游无交集时重新 plan 接续，demand-delivery owner 同步复核协议 | 每次核对实际新增提交及内容/消息，最多两次；无交集不自动产生授权，不改 hook |
| `925142a` | 主子需求 v4、验收 v2 及共享日志，demand-code-ownership 与两 owner | 纠正全局交付示例与队列中残留的独立提交口径；区分 own/parent/none，旧数据不自动迁移 |
| `9682193` | 跨主题共性及只读主题候选扫描，imedical-ui/iris-ui/coding-iris | 手册已反映对象语义、主题兼容与扫描限制；不把候选或零候选作为 UI 通过 |
| `58b852b` | 统一 skill/Agent 帮助，capability-help 与全部自有源定义 | 帮助覆盖 init/xc/Agent，手册仍为非 xc；帮助与实际执行分流，旧索引和 Overlay 路径沿原更新协议 |

本轮修正（framework-maintenance）：

- README 与使用指南把独立逐号交付、主子共享交付和明确无代码分开路由；共享组不能因单个子项通过提前提交，代码证据未知不能按 none 跳过，帮助只展示说明。详细条件继续归代码归属/帮助协议，不复制到规则或插件。
- 维护摘要合并近期流水为当前覆盖点及任务路由，主子归属、提交漂移、统一帮助分别指向事实源；长期决策补共享协议归属。backlog 区分独立需求无法隔离与合法主子复用，在既有第 7 项索引补齐主子交付/统一帮助取证范围，不新增或提升治理优先级。
- 根 AGENTS、维护 skill、能力目录、文档首页、安装/更新说明、owner 与 registry 已核对；现有职责、入口、路径和分发说明仍适用，除本轮列明内容外无需为同步清单改写。未改插件（含 xc）、组件版本、发布记录、运行时、测试实现或部署布局，不同步业务副本。
- 验证：`node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js` 1/1 通过；本轮 6 份文档的 261 个本地链接/锚点、严格 UTF-8 读取及 6 个提交的覆盖/去重核对通过。逐提交结构检查确认 19 个 owner 的 29 次版本变化均有对应新增发布记录；71 个项目 skill 的帮助引用和 8 个 Agent 的协议入口可达。该检查不替代完整组件版本门禁或宿主行为验证；维护入口约 3854→3174 字符。`git diff --check` 通过，暂存区为空，无新增未跟踪文件。不因文档维护重跑更新器、UI/浏览器或 Git/BOS 全链路；本轮未暂存、提交、推送或创建临时文件。
- 2026-10-23 提交收尾：用户授权本批 c + p；当前基线已前进至 `11cecf5`，逐项复核仍仅本批 6 份文档差异，保留后续 `--pass`、BOS 查询、菜单及夜跑路由。当前文档定向检查 1/1 与 280 个本地链接/锚点通过；原审计覆盖仍截至 `58b852b`，不将后续 7 个提交计入已审计范围。提交前精确暂存并执行 staged 门禁，沿 README 双远端约定复核出站范围；GitHub 的 7 笔既有框架提交无新增 vendor 原件，随本次同步，结果以 Git 记录为准。未改插件或业务副本，不重跑无关完整测试。

### 上轮全局回看（2026-10-21）

2026-10-21：本轮以 `087511d`（上轮 `e964d0e..da28585` 回看收尾）为基线，审计 `087511d..c7e828d` 共 34 个提交。逐提交检查实际文件清单，按能力族对照当前 owner、README、手册、共享协议、维护记录与测试入口；以下是上下文覆盖索引，不表示重新执行全部功能测试或业务链路。下轮从 `c7e828d` 之后的提交继续。

| 变更族 | 提交 | 当前事实源与边界 |
|---|---|---|
| 需求交付、人工复验、worktree | `d756c73`、`a1350ae`、`c91accb`、`2fd37a6`、`ddd9dcf`、`8ffd035` | demand-delivery-plugin、testing-protocol、worktree-review；代码来源、明确调用授权、完整编号、用户结论与数据/资源收尾分别核验 |
| 更新、发现与项目导航 | `546cba4`、`c70d057`、`be25069`、`d5eab95`、`8c3faca`、`0faa992`、`43a4b06` | 更新/迁移/技能适配 runbook；嵌套边界、受管索引刷新、导航追加、原生发现与额外目录链接分开，普通更新不执行项目适配清单 |
| IRIS 编码、Storage 与 vendor MCP | `b1f69c9`、`ecfcd45`、`fc1413c`、`ff14958`、`8b93a3f`、`6994042` | coding-iris-plugin 与 vendor；规范、部署和 helper 各用 owner 契约，不从历史 patch 推断当前版本或真实服务器验收 |
| BOS 录入与跨栈处理 | `03dc921`、`195eea0`、`d07087c` | bos-plugin；Git 代码 v2、工作/主题 v3、拆分/导出/编号回填及完成备注，接收组不推断产品与指派，不自动发送 |
| 夜跑执行、收敛与成本 | `2a0c509`、`40d690d`、`35d8cb0`、`dd22d74`、`227a44d` | night-governance/night-policy/night-acceptance、workflow 与根运行时；新 2.1 计划/能力探针/监督及联合源码保护，旧 run 保留，真实试点沿 P1 |
| UI 规范、适配与资料分层 | `a37ea2d`、`1e74b62`、`c7e828d` | imedical-ui、iris-ui 与 vendor；通用层/IRIS 强依赖、完整本地原件/可分发证据、规则审查/实际 UI 验收分开 |
| Feign 文档审计 | `fd95083` | imedicalxc-doctor-data-extraction；主入口与 feign-api-doc-audit 两入口，xc 手册仍按既有 P2 范围治理 |
| 展示页 | `cfc44dc`、`8c73ff8`、`ebe62b6` | index.html 与 Pages 配置仅供源仓展示；成果快照不替代当前能力/部署事实，不进入项目分发 |

本轮修正（framework-maintenance）：

- 维护入口从历史版本流水收敛为当前接手与任务路由，移除过期 owner 版本、重复状态及失效“首条”引用；长期决策将依赖/夜跑归回对应概念，提交校验改为当前 staged 内容门禁。
- README 先说明工程用途，近期夜跑/测试/worktree 内容归回使用位置；能力目录与指南修正需求提交 owner，删除“旧 iris-demand-* 仍可调用”的误述，合并重复交付章节；Feign 总览补齐两个薄索引入口，公司完整原件与已提交证据的分发区别对齐 vendor。
- backlog 的 MCP 索引统一为 v1.5.0；Atelier 前端通道由“待建设”改为“已实现待真实/矩阵验证”，增量保护独立保留；历史发布债务详情与既有三份记录范围一致，不新增普通提交阻断。未完成项保持原 P0–P3 顺序，本轮不启动独立治理或扩编 xc 手册。
- 验证：`node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js` 1/1 通过；本轮 7 份文档的 440 个本地链接/锚点、UTF-8 读取、34 个提交覆盖无遗漏/重复、单一交付章节及 skill owner 归属核对通过。当前清单为 19 个插件，非 xc 的 15 个插件/56 个 skill/37 个 rule 与手册一致，暂存区为空；`git diff --check` 通过。既有功能测试仅作历史证据，本轮未重跑业务或完整运行时测试，也未取得新跨平台结果。根 AGENTS、维护 skill、owner manifest/版本及部署规则已核对，无需为本次纯文档修正改动实现、组件版本、不可变发布记录或更新器。
- 本轮只改全局说明、能力手册及维护上下文；实施阶段未暂存/提交/推送，未同步业务副本或操作真实服务。用户后续授权 c + p，复用既有文档证据，补查精确暂存、适用门禁及 origin/github 出站范围；提交复核同步去除 README 尾部过期的“当前 v0.15.8”断言，版本回归 manifest、前端通道说明回归工具文档。提交与双远端推送结果以 Git 记录为准；未创建临时文件。

## 维护流水（按记录时间）

- 2026-10-21（完整UI原件本地集中管理，framework-maintenance）：将用户整理好的iHOS、PURE、手机端活力蓝三个完整资料目录复制到vendor/imedical-ui-standards/originals/2026-10-21，只保留展开内容/PDF，共2650文件、266900286字节；源目录及源ZIP保留，本地不重复保存压缩包。逐项核对源/副本SHA及字节数，本地冻结清单记录来源/文件摘要，Git目录索引只含批次/总量/目录摘要。
  - 目录内gitignore忽略/originals/，完整原件不提交、不随项目分发；已有规则与64文件证据子集保持原样，后续升级仍可按授权提交和正常框架流程分发。更新顺序为新本地批次→核对标注→更新受影响规则/证据/插件版本→标准框架分发，不重写历史或改通用更新器。
  - 已撤回本轮误将64证据迁出Git的修改及其测试/发布草稿，现有manifest/插件/测试与实施基线1e74b62一致。64原件摘要与规则引用专项2/2、文档目录1/1、diff检查通过；临时复制检查点和误迁移副本已按归属清理，正式本地原件与清单保留。未修改业务代码或部署态能力，当前仅资料管理入口与索引变更，无插件接口/版本变化。

- 2026-10-21（公司UI规范与评审，framework-maintenance）：新增imedical-ui 0.1.0，面向技术栈无关的IHOS海蓝/PURE天蓝规范提炼，提供共性rule、五类场景参考、风格差异、来源目录及截图/浏览器评审。30画板与PDF的64个原文件形成61.62MiB证据子集，逐文件摘要校验；原文权限保留，不复制查看器或其它配色，不生成生产CSS/查询CLI。iris-ui 0.2.0正式依赖通用层，定位为IRIS CSP＋HISUI适配；保留短名，展示名明确职责，未来Java/HTML适配直接依赖通用层。
  - 新专项9/9、既有iris-ui专项8/8、文档链接/目录1/1通过；PS7/PS5.1生成两日常入口并排除纯init；官方更新器隔离fixture确认依赖missing/available/disabled实际阻断iris入口，enabled才生成，不依赖退出0。两UI owner版本/迁移/精确breaking授权比较issues=0，未做全仓发布审计。验证与边界见 maintenance/validation/imedical-ui-2026-10-21.md。
  - 一个独立Agent进行两类源码场景试读与一张PURE基准原图试评，能按实际布局选择规则，保留IHOS单方条款与双family依据边界，不将样例、截图状态或源码当作真实页面验收。据此收敛源码/视觉评审路由及材料来源身份。工程细节留项目，本源仓仅保留匿名结论；无对照实验，不推广提效结论。
  - 既有更新器、部署器及业务/公共CSS未改；源仓本批代码与资料不等同业务副本已更新。正式分发按共享能力更新→模块NoPull完整刷新及注册/profile验证执行，真实双基准浏览器评审和非Windows矩阵沿P2补证。测试D临时根受权限限制使用系统临时目录回退，全部本任务fixture已核实删除。提交/推送按各自授权，未自动推公开镜像。

- 2026-10-21（iris-ui 首版，framework-maintenance）：新增 iris-ui 0.1.0，提供标注还原、布局/主题/生命周期诊断的单一日常入口、纯 init、增量 rule、按需参考、匿名案例、任务模板与只读 collectUiMetrics。编码插件 0.20.1 仅补 enabled + UI 信号条件规则路由；沿用编码/HISUI vendor/部署/测试协议，不新建 profile、运行器、状态机或传输实现。同步两 owner 发布记录、根与插件说明、两份手册、维护入口及 P1 部署缺口/P2 扩展验证队列。
  - Windows 专项 8/8，含 PS7/PS5.1 薄索引预演、幂等、纯 init 排除、自定义规则保护及跨 realm 函数源码调用；文档目录 1/1。真实 HISUI 匿名夹具三主题 × 两宽度 × 四阶段共 24 阶段通过，6 次目标主题资源实际响应 200、失败请求 0、Console error 0。独立审查后修正主题资源等待和动画最终状态取样；完整证据及边界见 maintenance/validation/iris-ui-2026-10-21.md。
  - 首次单工程试点仅完成共享层 DryRun 快进、精确手工同步及模块 -Plugin iris-ui 定向刷新，逐文件哈希与 PS7/PS5.1 各 23 项结构检查通过；这只是本地开发版试接，未执行共享 Context Write，不能作为正式完整部署。用户随后明确模块部署走框架更新流程并授权先提交、推送；已纠正 init/README/指南，正式接入依原 runbook 与项目模块管理入口执行，结果以 Git 和目标工程更新回执核对。业务源码与原验收状态保留，真实宿主路由和 UI 验收仍独立取证。
  - UTF-8、新文件及 tracked diff 检查通过。版本比较本批两 owner 无新增问题；完整工作区仍有三份历史 xc 发布记录缺 commit 的六条既有错误，不改历史、不称全仓通过。首次临时目录权限与夹具停止调用异常均已处理，隔离目录、测试标签和本任务服务已核实退出；UI 专项加入既有三平台 Node 22/24 CI，非 Windows/最低 Node 结果沿现有 P2，增量部署保护留原 coding owner 的 P1 独立建设。

- 2026-10-20（夜跑六处成本与交付缺口修复，framework-maintenance）：共享目标增加相关需求联合源码复审绑定，整个版本/环境/配置/目标及依赖一致才共享一次实际发布回执；source-integrate 复用下游重排并保留跨仓来源、旧证据。增加实际 JSONL client worker、定时观察、PID 租约、断点与原截止恢复；新模板严格启动 ACK 核预留、实际宿主身份/预算回执及监督进程。初筛能力探针先于详细 PLAN，回执落盘读回并绑定可执行子集、配置和有效期，正式 run 保留原授权门禁。报告分开最低自检/可交接/证据等级，停滞按最近新增有效交付计时，重复观测不刷新。未增插件或独立 skill，无组件版本变化；README、治理/手册/workflow、模板、维护摘要、P1 未完成真实试点及 CI 已同步。
  - Windows Node 24.14.1 最终 13 文件直接影响链 115/115 通过；随后浏览器认证 API 的早期依赖边界仅定向补验能力/计划两文件 13/13 通过，范围重叠不累加。Playwright 1.62.1 / 已安装 Chrome 155.0.8059.85 的新早期探针实测完整启停通过，pendingOperations=0；既有项目文档链接 1/1、diff check 与新增 CLI/module 语法检查通过。首轮可变历史对象引用及后续严格 ACK 测试夹具缺 JSON 序列化的失败均已修正，不抹掉过程；实际业务、真实模型 Goal/停止、非 Windows/最低 Node 仍待取证，见 maintenance/validation/night-cost-regression-2026-10-20.md。临时测试仓、探针及本轮浏览器由用例按归属退出和清理。

- 2026-10-20（主题提需与完成备注，framework-maintenance）：bos-plugin 0.11.0 扩展 bos-demand-entry，通过自然语言主题、接收组及可选资料选 v3 source=request，无 Git/提交依赖；复用既有 bug/change、prepare/render/deliver/bind 与 Excel。共用非代码校验，接收组仅作交接元数据，不推断 BOS 产品组/指派人，产品标识未知时主题名称可不加前缀；三类来源分批，主题/工作无代码提交对象，原代码 v2/工作 v3 兼容。合并本轮未提交的完成备注规则：按上下文与事实判断，已完成条目用原 remarks 追加【备注】已完成，已有备注保留，文本写完不代表待解决问题完成；原 0.10.4 未发布草稿合并到 0.11.0，不改已提交记录。
  - 同步 owner AGENTS/README/manifest、技能/协议、根 README、两份能力手册、维护摘要和发布记录，沿既有 P2 补充主题路由与真实录入样本。无新增 CLI、依赖、安装/更新或 thin-index 逻辑；正常更新完整能力包并刷新已启用索引，新 request 草稿需新脚本；无实例迁移或旧文件清理，未同步业务副本。
  - Windows Node 24.14.1 专项 29/29 通过，覆盖 Git/工作兼容、无 Git 主题 bug/change、资料/接收组保留、文本/Excel/CLI 回填、混合来源和提交/输出保护。初轮 28/29，新夹具同时触发多个校验，隔离后整组 29/29；已记录 standard-demand-entry 内容证据。文档链接 1/1、canonical/本机入口 skill 格式与 diff check 通过，版本比较无新增问题（仅既有 xc 历史 6 条）。测试目录已清理；非 Windows、Node 22 和真实 BOS 仍待现有 CI/P2 取证。用户真实例子仅在内存验证正文，未写入仓库或模拟系统修复。
  - 当前已安装全局入口沿既有 Junction 指向本源；按 skills-sync 同步共享入口缓存的发现描述及本机原登记段落，保留其他会话修改。既有三端链接、源路径、格式及对齐检查通过；未新增端点，宿主刷新后的自动发现和真实路由仍待观察。未执行 BOS 写入或对外发送；Git 提交与推送状态以 Git 记录为准。

- 2026-10-20（保留测试数据供用户快速验收，framework-maintenance）：收紧共享 testing-protocol 与 Testing Agent 入口，明确开发测试库中本批获准创建的验收样本可保留；事前计划写清范围、授权和交接，按需求交付样本标识、入口与复验步骤，沿用已有授权及项目处置约定。夜跑文档复用既有 dataRetention/evidenceRefs，并消除 case 收尾误删保留数据的歧义；README 与维护摘要同步。未改运行时、插件、schema 或安装更新器，已有项目正常更新取得；真实数据标识继续留目标项目受保护记录。能力手册和既有 backlog 观察项已核对，本次无需新增条目；文档链接定向检查 1/1 及 diff check 通过，真实宿主行为沿既有观察队列，不以规则修改宣称已生效。

- 2026-10-19–20（无人值守事前与联合交付治理，framework-maintenance）：按批准 PLAN 在原 schema 2.1 run 接入 executionPlan、周额度落盘基线、角色/需求分片上下文及双 Developer / 双 Tester 容量与错峰；两种启动位置 materialize 实体 PLAN/AGENTS 薄入口，保留原规则及链接目标。加入跨 worktree 同类身份、既有 Developer 集成、独立 post 后冻结材料、实际目标发布窗口、真实前后差异与原层级回执复用。持续 worker/v2 分需求与批次资源，预检及两需求复用一次认证，旧 owner 不得被换预检丢弃。
  - Codex adapter 复用本机 app-server 协议，原生 Goal set/get 回读、续轮与恢复、停止 ACK/终态分开；受管 wrapper 在原锁内预留 token，落盘真实 launch receipt 并消费 ACK。观察失效时停止可核实端点，未知端点保留；无 Goal 要求真实 watcher PID/新鲜心跳/控制通道 challenge。主会话治理 token 缺实读时预留预算且总成本 unknown，周额度仍覆盖全部会话。
  - coding-iris-plugin 0.20.0 显式 Atelier 前端通道复用 conditional write/回读/编译，SFTP 保持明确选择；冻结 bytes 保留原源码身份，支持继续编辑/删除原文件，Storage 新块需要回填则停止并交独立复审。BOS 0.10.3 入口、六个依赖 owner patch/range、发布记录、角色/workflow/registry、模板、更新兼容、能力手册和专项 CI 同步；不改安装/更新脚本，不增加生产依赖或文件锁服务。
  - 验证命令、最终结果与限制集中于 maintenance/validation/night-governance-2026-10-19.md。真实 Codex 仅 schema 与 initialize/collaborationMode 握手，无真实会话/Goal/业务执行；首次真实浏览器行为通过但关闭超时，独立基线及配套 Chromium 151 同样复现，失败事实保留。原生等待链将退出阻塞定位到外部凭据选择器持有的共享 DictManager 锁；经用户授权核对身份并仅终止持锁者后，原 Node/Playwright/超时下 Chrome、Edge 各两次退出通过（155–239 ms），原 UI 用例含最终资源退出 1/1 通过；诊断及复测资源已清理，框架运行时代码未因诊断改变。真实项目最多 5 条试跑、native Goal 实际预算及非 Windows/最低 Node 结果留既有 P1/P2；详细 PLAN 前按需预检、浏览器完整启停探针已明确登记为待补，不宣称当前 worker 已具备。保留进入本轮前的容量/复评修改及第三夜观察文档，随本轮治理提交。
  - Windows 整合回归 220 项（219 通过、1 真实 UI opt-in 跳过），PowerShell 5.1 部署清单、文档链接与 diff check 通过；收尾定向 33/33、28/28、报告 9/9 通过（范围重叠不累加）。版本全仓审计仅余三份 xc 历史发布记录缺 commit 的 6 条既有错误，本轮 8 个组件变化无新增问题；不改不可变历史、不声称全仓门禁通过。新夹具 D 盘优先、受限时系统临时回退，按归属清理。
  - 提交前已同步远端 Feign 审计提交，摘要冲突保留双方内容。30 文件补验首轮 262/263（含真实 UI，无跳过）；补齐旧部署模拟绑定的 manifest 字段后，该文件 23/23 通过，其余 29 文件 240 项经指纹复用，缓存保留首次失败。暂存 8 个 owner 及直接依赖版本门禁、PowerShell 5.1 与文档链接通过；缓存归本仓库私有 Git 元数据，不入仓。

- 2026-10-18（夜跑容量事件与探索复评，framework-maintenance，随本轮治理提交）：在既有night-record加入仅增长maxInFlight的policy-update，要求用户事实引用、真实无活动写入边界、原值匹配和原preflight仍有效；逐一校验所有会重绑的授权，包含未被work使用者，拒绝过期/撤销/来源或环境变化。原事件锁与回放保留历史，重算planHash后仅移动有效scopeHash，不重建授权元数据，默认容量仍1。探索复评只要求实际计费的preparation/diagnosis段闭合，保留正常execute计时及精确重评字段。
  - 在现有night-convergence/v1基线上局部适配，保留其接口与实现；新增16项针对测试、原三平台Node矩阵入口、夜跑接口/能力手册/README及维护摘要。该阶段根运行时变更无插件或独立skill owner版本变化，未修改插件、安装更新器、账号或真实run。保留既有观察文档与maintenance导航修改，后续随事前治理实现一并提交。
  - Windows Node 24.14.1：11个夜跑/调度/授权/额度/收敛专项89/89通过；最终新增专项16/16、文档链接1/1及diff check通过。测试临时目录限定D盘，夹具自行清理。受管事件集成覆盖旧日志前缀、候选/回执/权限元数据保留、hash重绑、锁竞争和回放；未使用grant的失效/替换反例均拒绝。已准备旧基线3文件最小候选并在旧依赖上16/16，通过不表示已部署真实业务副本；实际应用与运行事件由对应工程另行取证。非Windows/最低Node/真实运行边界沿既有P1/P2队列。

- 2026-10-18（夜跑精简收敛，framework-maintenance）：按用户收窄后的范围，复用现有 run 增加可选 night-convergence/v1，问题及尝试事件幂等、默认 4 次硬上限、显式总时间与区间去重；有依赖才增加版本/范围绑定及组合回执，相关或传递变化撤销通过结论。受管验收用例边界复查、部署 adapter 限制剩余等待；超时不证明远端停止，保留未知写与收尾。Coordinator 集成补协议，不建立交付组状态机、资源锁或自动合并器。
  - 收尾复验：重绑定/返修重新排队且事件重放不重复排队，真实消费者 worktree 内容核验；相关夜跑/CLI/回执回归 41/41。随后将用例开始前的门禁停止与执行未知分开，避免误占容量；最终 convergence + playwright-runner 共 21 项，20 通过、1 完整 UI 缺运行时跳过，其中新增收敛专项 15/15。跨平台配置已接入，非本机与真实环境未执行。
  - 可复用本地证据保存在当前仓 `.git/night-convergence-validation.json`（suite: night-convergence-and-runner，含 UI 跳过限制）；使用 validation-evidence check 的 --evidence-file 显式读取。工具先写默认 C 盘临时缓存后已精准移除本任务条目，其它缓存保留，D 盘证据供后续验收/提交复用。
  - 同步根运行时、专项测试、三平台 Node 22.5/22/24 CI、共享协议、夜跑 workflow、策略模板、接口/更新说明与能力手册；BOS 0.10.2 和 coding 0.19.7 的 owner 入口、README、manifest、发布记录同步。技能入口已引用同一 workflow，registry/bindings 与能力目录职责不变，不增加角色或重复技能。正常更新后仅新批次启用，未修改安装/更新脚本或真实业务副本。
  - 验证：Windows Node 24.14.1 首轮夜跑专项 46/46；扩展调度/验收/部署回归 127 项中 125 通过、1 UI 因缺 Playwright 跳过、1 旧部署最小绑定夹具失败。修复未启用扩展时缺 manifest 的兼容后，新增专项、分发与部署复验 37/37（含新增 4 个场景）；文档链接定向 1/1 通过，diff check 通过。新运行时纳入 sparse 实际检出测试，测试文件仍不部署。合成测试包含未知写单次执行、截止、环境依赖前后变化、第四次成功/第五次阻断、独立容量及传递失效；未宣称真实夜跑提效。
  - 工作区组件版本审计无本轮新增问题，全仓仍被既有 xc 1.0.2/1.0.3/1.0.4 发布记录缺 commit 阻断，未修改历史。独立夹具由测试清理；存量测试按其系统临时目录运行并自行清理，未保留调试文件。保留既有观察记录及 maintenance 导航改动；实施阶段未暂存/提交/推送，后续获用户 c+p 授权按本次范围提交并推送 origin/master，结果以 Git 记录为准。非 Windows/最低 Node 实跑、完整 UI 和真实 profile 接入沿既有队列。

- 2026-10-17（技能适配说明澄清）：适配 runbook 将五个原生支持 `.agents/skills` 的宿主移出链接适配表，前置“无需适配”说明；命令示例只列需要目录接入的宿主，保留显式覆盖的兼容说明。仅调整文档，不改变脚本、插件或配置契约，无需版本递增及新增治理项；文档链接定向检查与 diff check 通过。

- 2026-10-17（扩展项目技能适配，framework-maintenance）：agent-context-kit 0.5.0 将命名宿主从 3 个扩展至 10 个，增加 WorkBuddy/WorkBuddyDonghua/Qoder 目录链接、OpenCode/Cursor/GeminiCLI/GitHubCopilot 通用层复用；Node 支持 Custom 与显式项目发现目录，保留冲突并拒绝越界、Git 元数据和上下文重叠。安装/更新入口参数同步，个人全局技能分发保持独立。项目配置新增可选“技能适配目录”章节和三目录示例，由 skill 读取逐行清单并调用原执行器补缺；不新增解析器或普通更新自动执行。
  - 同步 owner 入口、README、skill、发布记录、适配与更新文档、能力指南和维护队列；能力目录原职责不变，无需改写。Windows 专项 21/21 通过，含 Qoder 链接及 PS5.1/PS7 参数接受、链接实时可见、Custom CLI、冲突/越界、Overlay 与 legacy 防写穿；文档链接 1/1 通过。首轮沙箱 Junction 被 EPERM 阻止，转沙箱外 D 盘隔离夹具通过；系统临时回退夹具与 D 盘测试夹具由测试清理，D 盘任务空目录已删除并复核。工作区版本审计识别 0.4.3→0.5.0，无本轮新增问题；全仓仍由已登记 xc 三份历史发布记录缺 commit 阻断，不修改历史。非 Windows CI 与真实宿主发现/执行仍待验，未同步业务副本，提交推送沿本轮用户 c + p 授权执行，结果以 Git 记录为准。

- 2026-10-17（本批全部需求号汇总，framework-maintenance）：demand-delivery-plugin 0.5.2 补齐处理报告完整批次集合，覆盖基线已满足、无需新增代码与待处理项；沿用编号格式，状态分组不能替代。普通 workflow 与夜跑引用同一契约，不扩大交付授权。同步 README、能力指南、发布记录和维护入口；AGENTS 与能力目录入口仍准确，无需修改，真实宿主观察合入既有 P2 队列。文档链接定向检查 1/1 通过，git diff --check 通过；工作区版本校验无本轮新增问题，全仓仅既有 xc 三份发布记录缺 commit 导致退出 1。后续获用户 c + p 授权，按本次范围提交并推送 origin/master；未同步业务副本。本轮无临时文件。

- 2026-10-17（项目文档导航，framework-maintenance）：agent-context-kit 0.4.3 模板增加按任务读取 docs 首页；根更新器在既有项目入口缺失时追加导航，DryRun 预览、Check 检出、Write 幂等写入并回读。Overlay 未映射 docs 时解析 CapabilityRoot；链接、编码、Markdown 未闭合及并发变化停止，缺少 AGENTS 仍交初始化。普通更新不覆盖正文、配置与规则的边界保留。验证：Windows PowerShell 5.1 完整更新器回归通过，文档入口与布局分发 13/13 通过；覆盖旧项目追加、DryRun 不写、Check 失败/通过、重复更新、BOM/CRLF、无效编码、链接保护、未闭合 Markdown、Overlay 与旧 sparse 恢复。工作区版本审计仅报告既有 xc 三份历史发布记录缺 commit，无本轮新增问题；未修改历史记录。新专项加入 Windows/macOS/Linux × Node 22/24 CI，非本机与真实宿主仍待验证；未部署真实业务项目。本轮经用户授权提交并推送，提交前复核既有测试指纹。

- 2026-10-17（连接配置查看指南，framework-maintenance）：新增 docs/guides/connection-configuration.md，提供使用者可查的字段位置、读取顺序、常见异常及 Agent 自主定位步骤，避免要求使用者解释目录。覆盖 BOS 私有分段与公司默认地址组合、进程环境继承、客户端注册独立性、IRIS/Overlay 配置来源；不保存个人连接事实，不新增配置中心、图形面板或自动扫描器。
  - 同步仓库 README、docs 首页、能力使用指南与维护摘要；现有 /docs/** 分发已覆盖，无插件或根级 skill 变化，不递增组件版本，无配置迁移或兼容清理。能力目录、backlog 与长期决策无需调整，未扩展运行时能力或产生新的必做治理事项。
  - 验证：对照 BOS personal-config.js、usage/client-mcp 与 IRIS project-env.js、工具说明、诊断规则；包含新增文档的 project links resolve 定向测试 1/1 通过，diff check 通过。未测试真实远端或宿主自动发现，未同步业务副本；无临时产物，未暂存、提交或推送。

- 2026-10-17（BOS 按需复用项目能力，framework-maintenance）：bos-plugin 0.10.1 将普通与夜跑的领域选择集中在 BOS workflow，复用项目已启用插件并按当前需求加载，支持不同与混合技术栈。IRIS 专项直达、查询和部署路径保留；不新增配置、全仓扫描、启动审计或预检轮次。夜跑仅列计划所需能力，复用原 worktree 上下文及真实预检，运行时未改。
  - 同步 owner 入口/README、场景清单、能力手册、仓库 README、摘要、P2 真实宿主队列及 patch 发布记录。正常更新并刷新已启用薄索引取得，无配置迁移或旧文件清理；未同步业务副本。
  - 验证：BOS workflow 2/2、夜跑入口与共享路由链接 2/2、IRIS fast-path、部署文档链接 1/1 通过；worktree 上下文/技能正文/脚本/规则与范围预检定向 3/3 通过。首轮因沙箱拒绝 D 盘临时目录失败，获准后隔离运行通过且夹具自行验证清理。工作树组件版本检查识别 0.10.0→0.10.1，仍被 HEAD 已存在的 imedicalxc-doctor-extend-engineer 1.0.2/1.0.3/1.0.4 发布记录缺少 commit 阻断，本次未修改历史记录。未宣称真实 Agent 路由或夜跑耗时已验证，未暂存、提交或推送。


- 2026-10-17（worktree 审阅交付，framework-maintenance）：新增 docs/guides/worktree-review.md，将真实 GitRoot、双打开入口、固定创建 SHA、未提交/worktree/集成提交归属和界面验证限制纳入创建交付。工作区配置局部合并，保留 JSONC 与原设置；夜跑复用已存 revision，不新增创建器、状态字段或默认提交。此次容器打开漏配是用户提供的单次案例，规则不将其推广为所有 VS Code 仓库发现故障的根因。
  - 同步：共享协作协议、standard workflow、Overlay/夜跑接入、docs 入口、能力指南、README、摘要和 P2 真实双入口验证队列。插件及根级 skill 无变化，不触发组件版本递增；registry/bindings、能力目录、安装/更新和长期目录决策仍适用。正常更新分发指南，已有业务 worktree 按授权任务补齐，无自动迁移或清理。
  - 验证：VS Code 官方 Git 扩展实现/设置定义核对相对扫描路径与检测开关；两个 JSON 示例解析及路径映射一致性通过，Git 查看命令在当前仓只读冒烟通过，部署文档链接 1/1、diff check 通过。未创建业务 worktree、未改本机 VS Code 设置或验证界面；未新增临时文件，保留前轮测试数据规则改动，未暂存/提交/推送。

- 2026-10-17（人工复验数据交付，framework-maintenance）：共享 testing-protocol 固化开发测试库既有新增/保留授权的沿用、批次/ID/入口/场景登记、正常及边界回归样本保留、删除用例实际执行，以及获准保留不阻塞交付、临时资源独立退出。交付包含代码、证据和适用的可复验数据入口；分页例子泛化为超过单页阈值，不保存业务私有事实或据此授权造数。
  - 同步：Testing Agent 增加场景入口，夜跑接入复用 evidenceRefs 并消除 close 删除保留数据的歧义；README、维护摘要及既有 P2 观察队列同步。原有 workflow 已引用共享协议，registry/bindings、插件内容、版本、运行时 schema、安装/更新机制和长期目录决策不变；正常更新能力包取得，无配置迁移或旧文件清理，未同步业务副本。
  - 验证：部署文档链接专项 1/1 通过；逐项核对授权未变、范围变化、保留样本、实际删除、数据状态未知和临时资源退出的语义边界，diff check 通过。未运行真实业务造数或宣称宿主行为已验证；无新增临时文件，未暂存、提交或推送。

- 2026-10-16（插件薄索引描述刷新，framework-maintenance）：根生成器普通 Write 比较并刷新受管 skill/rule 的生成字段，一致时 unchanged、不重写；Check 对 thin-index-stale 失败，DryRun 只报告。来源/正文/未知字段冲突与链接保留，Force 不再绕过插件索引归属保护；迁移原文哈希与预演状态保留，迁移后索引可继续刷新。agent/vendor 独立生成器不变，无插件目录修改或版本升级。同步 README、更新契约、摘要与 P2 下游/跨平台队列。
  - 验证：Windows PowerShell 7/5.1 专项及完整更新器回归通过，技能归属迁移 8/8 通过；覆盖原有索引描述变更、多行字段、规则元数据、BOM/CRLF、标准/Overlay、重复更新不改时间戳、只读预演、Check 失败、自定义内容及链接保护。修复测试夹具漏带夜跑运行时、缺失 Git 基线及 BOS init 清单过期，未改这些领域实现。专项纳入三平台 Node 22/24 CI，非 Windows 实跑与真实业务发现层仍待取证。用户授权自测后提交推送；本轮未同步业务副本。

- 2026-10-16（夜跑 worktree 忽略门禁，framework-maintenance）：根 night-workspace.js 在 plan/check 对 worktreeRoot 的祖先 Git 仓执行目录忽略检查；未覆盖则停止并提示共享忽略、本地 exclude 或仓外落点，不自动写业务配置。覆盖未创建目录、自定义路径、反向规则、恢复时规则失效及 linked worktree 的 gitfile；保留原 detached/Overlay 设计。同步 README、夜跑契约、更新说明、摘要及既有 P1 项目试点验收项，无插件目录变更或版本升级。
  - 验证：Windows 本地专项 10/10 通过，随后新增 gitfile 用例定向 1/1 通过；node --check 与 git diff --check 通过。夹具自动清理并验证目录移除；首轮沙箱因 D 盘临时目录权限失败，获准沙箱外重跑。现有 night-acceptance CI 已覆盖本专项，macOS/Linux 与真实业务副本尚未验证，未启动夜跑或同步业务工程。

- 2026-10-16（工作记录需求，framework-maintenance）：并入未提交 bos-plugin 0.10.0，--work 明确选择非代码来源，默认 Git 不变，与 split/excel 组合，来源由自然语言明确，首版不混合。工作格式为目标/内容及可选预期成果或工作结果，进度如实保留，不强加验收标准或 BOS 分类。来源必要摘要与 locator 保留在私有 v3 草稿；口述无文件不回填，bind 只保存编号，另行明确来源回填才由 Agent 回读定位。
  - 实现：同一 prepare/render/Excel/bind 链路支持 work，跳过 Git/提交依赖；工作条目禁止 changes/type/subject，message/plan 在任何提交依赖或 Git 操作前停止。代码 v2 保持读写兼容，无旧草稿迁移。同步 skill、协议/场景、manifest 阶段触发、两级 README、能力指南/目录、更新说明、摘要/队列及未提交发布记录；无私人日记读取或原文入仓，长期决策和安装/索引算法不变。
  - 验证：Windows Node 24 需求专项 24/24（旧代码 19 项与工作 5 项）通过，覆盖非 Git 目录 CLI 全流程、可选成果、Excel 正文同源/分类不默认、进度保留、混合拒绝、编号回填与来源不变、提交提前阻断。既有三平台 Node 22/24 CI 已覆盖本测试文件，非 Windows/真实 Agent/BOS 导入仍待证据。Windows PowerShell 5.1 薄索引实生成验证 --work、split/excel 及 canonical source 通过；文档链接 1/1 与 diff check 通过。工作区版本审计无本轮新增问题，完整审计仅既有 xc 历史问题退出 1。测试目录已清理，未暂存、提交、推送或更新真实下游；保留并行改动。

- 2026-10-16（标版需求显式拆合审查，framework-maintenance）：bos-plugin 0.10.0 为 bos-demand-entry 增加 --split，支持与 --excel/--Excel 独立组合，无模式时进入 --text；help、参数表、description 和示例同步。取证后按独立价值与验收判断拆合，展示范围/归属/依赖/理由，不强拆、不虚构工作量；共享文件保留 prepare 阻断，先交候选文本，不能伪称 draft/Excel 已生成。CLI、schema、三段式渲染不变。
  - 同步：owner AGENTS/README、协议与 Agent 场景、根 README、能力指南、更新 Runbook、摘要/队列和 minor 发布记录同步。能力目录入口/职责及长期决策仍适用，无需更改；索引生成器原样保留 description，无新安装依赖或配置迁移，正常更新并刷新已启用索引取得。
  - 验证：Windows Node 24 定向回归 5/5（共享文件阻断、29 列 Excel 同源正文/字段校验/别名、CLI prepare/render 文本与 Excel 一致）；Windows PowerShell 5.1 在隔离项目真实生成薄索引，split/excel 描述和 canonical source 可达验证通过；文档链接 1/1、diff check 通过。参数组合、单目的不强拆及公共能力依赖按场景表做静态语义复核，真实 Agent 输出与跨平台结果仍在 P2 队列，不把脚本回归当作模型验收。版本审计确认 0.9.0→0.10.0，无本轮新增问题，仅既有 xc 历史问题使完整审计退出 1。隔离目录已清理，未暂存、提交、推送或同步业务副本，保留并行验收报告修改。

- 2026-10-16（下游分发补验）：安装/更新 sparse 覆盖和文档链接专项 2/2 通过；后端规则新增已确认 doctor-dev 项目的运行时读取入口，旧 profile 未抄入要求也会加载，显式冲突须澄清。更新 Runbook 已说明文件、索引及 Agent 行为三层核对；真实根工程与模块刷新由用户指定的 R200 更新任务负责。本轮获 c + p 授权，只暂存本任务内容并推送 origin/github；保留并行验收报告修改。

- 2026-10-16（新增类继承执行检查，framework-maintenance）：并入尚未提交的 coding-iris-plugin 0.19.6。沿后端既有基类规则补齐建类前 profile/同职责类/公共基类核对、模板 Extends 适配及 Review 依据传递；通用模板保留语言示例，新增使用前适配提示，不增加重复原则或静态继承推断器。用户明确的医生站组注册类继承要求落在 doctor-dev 领域默认配置，覆盖直接或间接继承，不自行豁免基础设施类；通用规则不绑定业务类，既有业务源码与 profile 未修改。
  - 同步与验证：后端 skill/rule、CLS Review、类模板、领域默认值、两级 README、使用指南、维护摘要/队列及未提交 release 草稿同步；owner AGENTS 和能力目录已有入口仍适用。模板 LF/CRLF 1/1、部署链接 1/1 通过；沿用前轮检查器 13/13 证据，脚本未变，无新增测试或临时文件。普通能力包更新取得流程，已有医生站项目需按明确领域要求定点合并 profile，不由更新器覆盖或批量改变继承；未提交、未推送、未连接 IRIS，真实项目执行观察沿既有 P2。

- 2026-10-16（Parameter 命名与复用审查，framework-maintenance）：coding-iris-plugin 0.19.6 修正 CLS 常量命名，语言合法性优先，Parameter 默认 UpperCamelCase 并保留合法全大写/既有契约；编码与 Review 共用清单补查提取后的规则重复、稳定业务标识的必要性与归属，不推广为全部抽象或全部常量化。依据为单任务漏检反馈及官方语言文档，无 IRIS 编译失败证据。
  - 实现与同步：沿用 check-cls-format CLI 和 cls-format 词法扫描；非法未限定 ASCII 声明提示，拼接/限定名/非 ASCII/动态引用人工核对，忽略注释和字符串，复杂结构保守降级。同步 owner AGENTS/README/rule/reference、根 README、使用指南、维护摘要/队列、patch 发布记录及既有三平台 Node 22/24 CI。技能已经指向同一清单，能力目录、长期决策、安装/更新/索引机制无需改变；普通更新取得，无迁移或旧文件清理，不同步业务副本。
  - 验证：Windows Node CLS 专项 13/13（含 LF/CRLF、声明/三类引用、字符串/注释、变更范围、新文件 CLI 只读 advisory）、文档链接 1/1 与 diff check 通过。沙箱内 Git 临时配置写入被限制后，在 D 盘隔离目录完成 CLI 测试，测试目录已自动删除。工作区版本审计确认 0.19.5→0.19.6，无本次新增问题，退出 1 仅为既有 xc 六项历史问题；未暂存/提交。真实 IRIS 与非 Windows 矩阵沿 P2 队列取证；保留并行验收报告任务改动。

- 2026-10-16（验收报告语义，framework-maintenance）：demand-delivery-plugin 0.5.1 将 pending 的 Markdown 文案改为“待用户验收结论”，既有筛选/JSON/CSV/授权不变。共享 testing-protocol 统一功能验证、人工补验、用户结论和业务澄清的报告口径；夜跑/单需求 workflow 与验收技能引用同一事实源，补验和未反馈分别统计，空 gaps 不证明覆盖完整，人工通过不自动抹除技术缺口。
  - 同步：owner README/manifest/技能/协议、仓库 README、能力指南、维护摘要/队列和发布记录对齐；owner AGENTS、能力目录、长期决策与安装/更新机制仍适用。正常更新并刷新已启用索引，无配置迁移或旧文件清理；未提交或同步业务副本。
  - 验证：Windows 本地隔离验收索引 17/17、部署文档链接 1/1 通过。沙箱阻止临时目录/原子重命名后，经提权在 D 盘隔离目录完成测试。工作区组件版本校验识别 0.5.0→0.5.1；当时全仓报告既有 xc 六项历史问题及并行 coding-iris-plugin 未完成版本同步；后者已由对应会话提交，本轮不修改其文件。真实宿主输出和非 Windows 证据留既有 P2 队列。任务临时目录已清理；用户后续授权 c + p，复用测试证据并补查精确暂存和版本门禁，按仓库约定推送 origin/github，结果以 Git 记录为准。

- 2026-10-16（注册类、方法与变量注释，framework-maintenance）：coding-iris-plugin 0.19.5 重整 CLS 注释章节，明确非表注册类/DTO 的 Name/Description、表类 Table 与实际投影、ClassMethod/Method 的参数/返回/副作用与结构引用，以及自然语言变量说明。按已确认新稿将属性 Description 和索引注释改为按需，Param 按参数名重复，其余标签单次声明；保留完整方法头的空参、返回状态及 Debug 调用形式，用通用类名承载，示例错误码不提升为通用契约。
  - 同步：注册类模板只补注释，原类声明/签名/方法体保持；后端规则/skill、owner AGENTS/README、根 README、能力手册、维护摘要/队列及新 patch 发布记录对齐。既有循环退出约束保留；未实现标签解析器或文档生成器，Debug 不执行，真实宿主执行观察沿原 P2 队列。长期决策、安装/更新/索引机制不变；正常更新能力包及已启用入口，无配置迁移或旧文件清理。未提交、未同步业务副本或执行远程调用。
  - 验证：注册类模板 LF/CRLF 专项 1/1、部署文档链接/入口清单 1/1 及嵌入表类示例边界检查通过；去除文档注释后逐字对比模板与 HEAD，类声明/签名/方法体不变，CLS 注释章节之前的规范（含循环退出约束）完全保持。按注册类/表类分类、方法参数去重/续行、返回结构引用、变量说明位置及完整 Debug 不执行进行语义复核；未运行 IRIS 编译或新增注释解析器测试。工作区组件审计识别 0.19.4→0.19.5，无本次新增问题；退出 1 仅来自已登记且未修改的 xc 发布记录历史债务。未暂存或提交，真实宿主执行仍在既有 P2 队列，本轮无临时文件。 用户后续授权 c + p，复用本轮模板/示例与文档验证，补查精确暂存及组件版本门禁，按仓库 README 同步 origin/github；实际提交和推送结果以 Git 记录为准。

- 2026-10-16（iris-agentic-dev v1.5.0 升级与偏差收敛，framework-maintenance）：Windows x64 exe 从 v1.4.2 升级至 v1.5.0，官方资产大小 52344832 字节及 SHA-256 `6aee62484c7bb557466778889ba3520aa5ddbb470d99b10803a489f60be9e213` 匹配。既有 8 项 ObjectScript vendor skills 同步至固定提交 `2b3e017b7fc73d6370fc1e89e7fa03f3de49a1a1`，逐项 Git blob SHA 和 MIT LICENSE 校验通过，保留上游原文及 optional 加载。
  - 同步：coding-iris-plugin 0.19.4 对齐 AGENTS/README、能力矩阵、查询/文档路由及 v1.5.0 响应、截断、会话与退出契约；原生工具语义变化不混同 MCP 外层或 Atelier 响应。根 README、UPSTREAM、更新说明、使用指南、维护摘要/队列及 patch 发布记录同步，目录清单入口不变。用户级已有技能仅复用，不自动刷新或覆盖；项目部署/Storage/远程授权优先于上游示例。
  - 验证：PS7/Windows PowerShell 5.1 helper 与 lookup 专项均通过；lookup 覆盖固定技能 blob、manifest optional 解析及 thin-index DryRun，已移除旧插件 0.4.0 断言并更新固定来源。Node CLI/schema 3/3、部署文档链接 1/1 通过；断连工具数为默认 70、opt-in 81。六个直接依赖范围均接纳 0.19.4。工作区组件审计识别本次合法 patch，无新增问题，仅报告既有 xc 1.0.2–1.0.4 缺 commit 的六项历史问题，未修改不可变发布记录。
  - 边界：helper 保留 v1.2.6 分类基线及三个未分类工具 fail-closed；完整语义、真实服务器/资源释放和非 Windows 验证仍留既有 P1/P2 队列。安装/更新/同步脚本未变，未机械重跑全量更新器测试。已部署工程正常更新并刷新已启用索引、重启 MCP，无配置迁移或旧文件清理；用户后续授权 c + p，复用验证证据并补查精确暂存、组件门禁和双远端出站范围，提交与推送结果以 Git 记录为准；未同步业务/用户级副本。两轮下载临时目录均已清理，本轮未生成业务产物。

- 2026-10-16（MCP helper 准备流程优化，framework-maintenance）：根 iris-mcp.js 增加 tools --names 精确筛选、去重及未知工具报错，check/tools/call --json 输出单个对象；旧标签格式兼容，写入门禁保持。coding-iris-plugin 0.19.3 修正规则和示例，正常调用复用内置 check_config，参数已知直接调用，不建立跨会话缓存或常驻服务。
  - 验证：Windows Node 24.14.1 CLI/schema 3 项通过；实际启动 bundled v1.4.2，三个目标工具 schema 可直接解析；模拟进程覆盖请求次数、参数文件、namespace、错误输出、旧格式、未授权阻断和显式授权转发。PS5.1 helper 既有政策与 bundled 默认/opt-in 测试通过，文档链接检查通过。所有真实 vendor 调用仅配置/目录读取，无业务调用。CLI 临时目录使用沙箱可写系统临时路径，测试 finally 删除并验证；既有 PS 测试亦清理自身目录。
  - 检查局限：lookup 旧测试在写死插件 0.4.0 的断言处失败（基线 manifest 已为 0.19.2），本轮未扩大修复；worktree 版本审计仅报告已登记 xc 1.0.2–1.0.4 缺 commit 的六项历史错误，无本轮新增错误。新 CLI 已纳入既有三平台 Node 22.5/22/24 CI，未取得远端矩阵结果。
  - 同步：README、owner 使用规则、手册、维护入口/队列及发布草稿对齐；owner AGENTS、lookup skill、能力目录、长期决策与安装更新协议无需改变。已部署工程正常更新能力包与规则，无配置迁移或旧文件清理；未同步业务副本；用户后续授权提交并推送，复用本轮有效测试并补查暂存版本门禁与双远端状态，提交和推送结果以 Git 记录为准。


- 2026-10-16（循环退出语法约束，framework-maintenance）：coding-iris-plugin 0.19.2 在 CLS 规范后条件章节补充循环内 q/quit 必须无返回值参数，区分后条件与返回值，提供正反例及官方 QUIT 依据；编码与 Review 共用唯一规则源，现有可选格式脚本不增加语法检查。
  - 同步核对：owner AGENTS/README、后端 rule/skill、仓库 README 和能力手册的既有规范引用与检查边界仍准确，无需重复正文；维护摘要和新发布记录同步，长期决策、安装/更新及 thin-index 行为不变。backlog 无新增治理事项，真实宿主执行观察沿用既有 P2 队列。已部署工程正常更新能力包即可取得，无配置迁移或旧文件清理；未同步业务副本。用户后续授权 c + p，复用已有验证并补查精确暂存、组件版本门禁与出站范围，按仓库约定推送 origin/github；提交及推送结果以 Git 记录为准。
  - 验证：文档部署链接/技能规则清单 1/1 与 diff check 通过；正反例和现有入口引用经审查。工作区版本校验识别 0.19.1→0.19.2，无本次新增问题；全仓仍返回已登记 xc 1.0.2–1.0.4 缺 commit 的六项历史问题，未修改历史记录。本轮仅规则文档变更，不执行远端 IRIS 编译，不将文档审查作为编译证据；未创建临时文件。

- 2026-10-16（表类注释规范接入，framework-maintenance）：按现有 CLS 命名、格式、适用顺序和新增代码范围，将持久化表类/属性/索引注释整合到 cls-coding-format 的注释章节；新增代码使用业务标签和纯文本说明，保留历史别名、多行说明及 SQL 投影未知时的报告边界。示例使用通用类与 lowerCamelCase，不写入需求方业务表事实；注释改动保护声明、SQL 映射及 Storage。
  - 同步：后端 rule/skill、owner AGENTS/README、根 README、能力手册、维护摘要/队列和当前未提交的 0.19.1 发布草稿对齐；不额外维护一份项目规则，不修改通用 RegisteredObject 模板或格式脚本，不宣称自动文档生成/标签校验已实现。正常能力包更新分发，无业务迁移或旧文件清理；不改变此前 Storage 实现及其有效测试证据，无提交或业务副本同步。
  - 验证：部署文档链接/技能规则清单 1/1、嵌入示例的现有 CLS 成员分隔与 EOF 检查（LF/CRLF）及 diff check 通过。按新增表类、已有类新增属性/索引、仅修改历史实现、工具类、中英文标签别名/说明续行及 SQL 投影未知分支复核契约；这属于 Agent 文档审查，不作为解析器行为测试。工作区版本校验无本次新增问题；此前部署专项 81 项的内容指纹仍匹配，未机械重跑运行时测试。真实团队/宿主规范执行观察留原 P2 队列；本轮未创建临时文件。 用户后续授权 c + p，复用有效测试证据并补查精确暂存、组件版本门禁与出站范围，按仓库 README 同步 origin/github；提交及推送结果以 Git 记录为准。

- 2026-10-16（编译后 Storage 回填，framework-maintenance）：coding-iris-plugin 0.19.1 为 direct/guarded 增加编译后整批回读核对，只将指定类的 Storage 回填到本地，保留业务代码、BOM/换行、暂存区；guarded 保存编译后部署与本地快照，后续检查复用最近部署映射。并发修改、非 Storage 变化、映射删除/重排与未知格式停止；编译已成功但回填未完成单独报告，部分本地回填可见且不自动重试。受管夜跑源码指纹变化保持冻结版本复审门禁并交接，不修改编排器。
  - 同步：owner AGENTS/README/manifest、部署技能/规则/契约、脚本说明、仓库 README、能力手册、维护摘要/决策/队列及发布记录对齐；六个直接依赖范围可接纳 0.19.1，无需版本调整。正常能力包更新即可取得，无配置迁移、会话重建或旧文件清理；未同步业务副本、未连接业务服务器、未提交。
  - 验证：Windows Node 24.14.1 的最终部署/夜跑专项 81/81 通过（含回环真实 compile CLI、生成与追加字段、重复部署、混合产物隔离、并发修改、原子替换失败、部分同步、无 Storage 的非 XML XData 兼容及前端原字节哈希），JavaScript 语法检查通过；文档部署链接 1/1、diff check 通过。工作区组件校验识别 0.19.0→0.19.1，无本次新增版本问题，既有历史债务按队列处理。真实 IRIS 和非 Windows/Node 22 矩阵留既有 P1/P2 队列。 本任务临时目录及原子替换中间文件已清理；成功测试的内容指纹保留在 .git/validation-evidence/iris-storage-sync.json，可在后续提交前复用。

- 2026-10-16（需求迁移嵌套工作区边界，framework-maintenance）：扫描器在子目录的 Git 元数据、独立 Agent 部署/Overlay 标记或链接 Agent 上下文处停止递归，通过 skippedWorkspaces / demand-workspace-skipped 报告；不按目录名豁免，不读取或修改嵌套入口，当前项目自定义链接仍阻断。覆盖任意目录名、自动化目录、普通同名目录继续迁移、迁移后无旧名称及链接保持。
  - 验证：Windows Node 的迁移专项 6 项和 standard/Overlay 更新集成 2 项在 PowerShell 7、Windows PowerShell 5.1 均通过；部署文档链接 1 项、UTF-8 BOM 与 diff check 通过。修复版 helper 对反馈工作区只读 Check 无冲突、无迁移写入；未同步业务副本，完整部署更新及非 Windows CI 待目标侧复验。仅根脚本/测试/说明变化，无插件版本变更；按用户后续授权提交并推送，隔离测试产物已清理，内容证据保留在源仓 Git 本地元数据。

- 2026-10-16（验收调用授权收敛，framework-maintenance）：demand-delivery-plugin 0.5.0 将用户明确调用 demand-acceptance 开展验收交付定义为该批次通过项 commit＋BOS 日志＋push 的授权，无需交付参数或重复选择范围；非 BOS 项目跳过日志。保留暂不交付限制和旧批次原授权，查看/维护技能、查询汇总与自动加载不产生授权。demand-commit 显式承接批次授权，索引 authorize 保存真实调用原话，执行脚本和索引格式不变。
  - 验证：两份技能 quick_validate 在 Python UTF-8 模式通过（首次默认 GBK 读取失败，未改文件编码）；文档部署链接/清单 1/1 通过。逐项核对明确调用后通过、暂停、纯查询/自动加载、旧批次恢复和下游授权传递；纯技能契约变更未重跑 Git/BOS 执行测试，真实宿主行为仍在既有 P2 队列。工作区版本校验识别 0.4.0→0.5.0 breaking minor，无本次新增问题；全仓仍仅有已登记 xc 1.0.2–1.0.4 缺 commit 的六项历史问题，未修改历史记录。
  - 同步：owner AGENTS/README/manifest、两份技能、索引协议、仓库 README、能力手册、维护摘要/队列及新发布记录对齐；长期决策与安装/更新机制未改变。已部署工程按正常更新刷新已启用索引，新调用采用新契约，旧批次不自动扩权；无配置迁移或旧文件清理。用户后续授权 c + p，复用已有验证并补查精确暂存与组件版本门禁，按既有约定推送 origin/github，结果以 Git 记录为准；未同步业务副本，无任务临时文件。

- 2026-10-16（BOS 夜跑 2.1 闭环，framework-maintenance）：BOS 0.9.0 / coding 0.19.0 在既有编排器、Overlay、部署与验收执行器上增加启动前集中授权/真实预检、单批次多仓、受管执行回执与分层计时；运行中异常项挂起交接，不新增授权问题。保留独立审查与 acceptance-pending，旧 2.0 不迁移；数据处置与资源退出独立核验，CLS 文档名共用 Class 声明解析，Windows 大小写、阶段跳过依赖及重叠计时有回归。
  - 验证：Windows Node 24.14.1 兼容/部署/Broker/额度/会话回归 103 项、新契约/实际 Overlay/无头 UI/稀疏分发 28 项、版本治理 17 项、文档链接 1 项通过；PS5.1 部署清单及前项失败不被末项成功掩盖的示例通过。两个需求在回环 Atelier 合成服务上走真实受管 compile CLI，断言只一次 PUT/编译；前后端写入的联合证据与重复验收自动归档，最终 acceptance-pending。额外收尾定向 22 项通过；改变文件的 JavaScript 语法检查通过。已有 Chrome 无头与本地页面不代表真实 HIS 或 bundled Chromium 矩阵。
  - 同步：六个直接依赖仅补 patch、兼容范围接纳 coding <0.20.0；检查其 owner 说明仍适用，无需重复规则正文。owner AGENTS/README/skill、脚本说明、共享协议、根 README、使用手册、更新/Overlay runbook、schema、模板、发布草稿与维护入口/队列对齐。CI 补最低 22.5.0 和 PS5.1；未修改安装/更新器或实际业务副本，无配置迁移或额外兼容清理。
  - 局限：完整组件审计识别本轮八项合法升级，仅保留已登记 xc 1.0.2–1.0.4 缺 commit 的六项历史错误，未篡改发布历史；非 Windows/Node 22/最低基线、真实后端/UI/跨仓重复夜跑，以及三种数据策略各三轮真实成本仍在既有 backlog。源仓验证与真实无人值守完成分开；详见 maintenance/validation/bos-night-framework-v2.1.md。用户后续授权提交并推送，复用已有测试并补查精确暂存、版本及远端门禁，结果以 Git 记录为准；未同步业务副本或执行真实业务写入。最终单项闭环补验通过，任务临时目录已核实清除。

- 2026-10-16（验收代码来源入口，framework-maintenance）：demand-delivery-plugin 0.4.0 在 demand-acceptance 增加技能层 `--worktree [路径]`，兼容 `-worktree`；新任务默认当前工作区，自然语言可指定来源，恢复批次保留映射。核对来源与目标后按需合入，冲突或实质变化补验证，人工结论与交付授权保持独立。复用现有索引与提交能力，脚本接口和索引格式不变。
  - 验证：文档部署链接/清单 1/1 通过；逐项核对默认、裸参数、指定路径/空格、别名、自然语言、映射冲突、恢复及补验契约，diff check 通过。工作区组件校验识别 0.3.0→0.4.0，无本轮新增问题，仅返回已登记 xc 1.0.2–1.0.4 发布记录缺 commit 的六项历史问题。纯技能与文档变更未重跑 Git/BOS 运行时测试；真实 Agent 路由效果仍待既有 P2 队列取证。
  - 同步：owner AGENTS/README、仓库 README、能力手册、维护摘要/队列及新发布记录已对齐；长期决策、验收索引协议和安装/更新机制仍适用，无需修改。已部署工程正常更新能力包并刷新已启用索引，无配置迁移或旧文件清理。用户后续授权提交并推送，复用上述验证并补查暂存版本门禁，按仓库约定同步 origin/github；结果以 Git 记录为准。未同步业务副本，无任务临时文件。

- 2026-10-15（近期提交回看与夜跑截止修复，framework-maintenance）：回看 e964d0e..da28585 的提交范围、维护记录和部署边界，重点核查新增夜跑派发逻辑。发现停止领新门禁将仅生成动作误判为已开始，改为复用额度门禁的工作状态/attempt 判据；补齐 night-acceptance CI 对工作区预检、共享来源指纹及会话/证据测试的路径触发。同步 README、接口说明、维护覆盖点和过时版本路由，将夜跑真实接入纳入既有 P1 排序。未修改插件目录或版本记录，无需组件递增；能力手册的入口与调用方式未变，无需改写。
  - 验证：新增截止回归在原实现失败，修复后 Windows Node 24.14.1 夜跑策略/派发/工作区/编排及 MCP schema 共 53 项通过，文档部署链接 1 项通过；暂存组件门禁与差异检查在提交前执行。沙箱目录创建/原子重命名受限后改用授权的本地隔离测试。非 Windows 矩阵和真实宿主连续夜跑仍留原队列，不以本地测试替代。
  - 同步边界：现有业务工程通过正常能力包更新取得根脚本修复，无配置迁移或旧文件清理；本轮未更新业务副本或启动业务夜跑。提交和双远端推送按本次用户明确授权执行，结果以 Git 记录为准。

- 2026-10-15（夜跑入口、工作区与额度门禁，framework-maintenance）：bos-plugin 0.8.0 增加 `bos-demand-handle --night` 技能路由，Agent 生成显式策略批次，普通需求与历史批次保持兼容。worktree 默认在业务工作区 `.worktrees/<batch>/<role>/repos/`，只读 plan/check 复用 Git/Overlay，从真实 cwd 校验项目入口、上下文、技能正文和脚本；身份错配与失效能力阻派发，正常修改和后代提交可继续。Codex 可配置真实额度快照门禁，默认20%停新领、10%仅收尾、300秒过期，其他宿主可关闭；不增加运行器/守护进程，不把额度换算成费用。
  - 验证：Windows Node 24 本轮首组35项、额度集成及真实工作区13项、BOS/既有编排74项分别通过（入口测试有重叠，不合并为独立样本数）。三平台 Node 22/24 CI 已扩展，非本机矩阵尚未运行。全仓版本审计识别 bos-plugin 0.7.0→0.8.0，仅报告既有 xc 1.0.2–1.0.4 发布记录缺 commit 的六项问题；未修改历史记录。任务夹具清理按测试归属验证。
  - 部署边界：按用户 c + p 授权提交并推送，结果以 Git 记录为准；未覆盖业务项目旧 `.agents`。发布后按既有更新入口刷新能力包及技能索引；源仓/Overlay 检查不代表已安装入口生效，真实宿主连续派发和额度刷新仍待项目验证。提交前移除维护日志中的项目私有事实，项目证据留归属工程。

- 2026-10-15（BOS 夜跑分级与投入控制，framework-maintenance）：显式采用 decisionPolicyReference 的批次在既有编排入口执行派发前评估、独立修改后复评、真实范围版本绑定、13 分钟探索/30 分钟共用准备复评、6 分钟每候选人工参考、容量预留和固定 20% 抽验。旧批次不启用时沿用原行为；静态/人工待验不产生运行通过。真实 runner 回执记录分阶段耗时与单用例范围，整需求通过仍须独立核验完整最低检查；后续失败撤销旧汇总，未知写和残留资源不能被其他用例成功掩盖。
  - 验证：Windows Node 24 的策略 11 项、调度 13 项、CLI 1 项通过；既有编排 3 项、session 9 项、证据 8 项及相关契约通过。MCP schema 修复 2 项和既有 helper 检查在 PowerShell 5.1/7 通过。三平台 Node 22/24 已纳入 CI，未取得非本机实跑。根脚本/协议/角色/文档修改无所属插件版本递增；同仓并行插件版本变化不属于本项。
  - 通用验证边界：历史回放不能作为新策略有效性的独立证明，后端范围通过不能替代 UI 或完整业务验收。项目编号、环境、部署及候选提交状态只记录在归属项目。包装器按实际 tools/list schema 注入 namespace，修复 check_config UNKNOWN_PARAMETER，保留写入门禁；未覆盖业务安装副本。框架建设与试点运行分账，实际用量未知时不反推。
  - 收尾范围：框架提交与项目交付独立；不以单需求局部验证通过宣称无人值守业务闭环完成。

- 2026-10-15（阶段可用性依赖，framework-maintenance）：bos-plugin 0.7.0、demand-delivery-plugin 0.3.0 在 manifest 声明 availableDependencies 的目标、阶段、触发条件与入口。根检查器复用 workspace-context，更新器只报告 ready/warning，阶段检查缺失或显式 disabled 时停止；不改变强依赖 enabled 门禁，不递归启用或改写依赖 profile。补录脚本延迟加载提交模块，prepare/message 支持显式项目根，取证/回填/渲染不受 Delivery 缺失影响。
  - 验证：Windows Node 24.14.1 可用性专项 8/8、标版补录 19/19；BOS 发现/更新专项在 PowerShell 7 与 Windows PowerShell 5.1 分别 11/11，通过 standard、Overlay、单共享目录、状态保留、升级迁移与警告不阻断查询。修复实测中文 JSON 经 Windows 控制台编码破坏的问题，机器输出采用 Unicode 转义。部署文档链接 1/1、PS1 UTF-8 BOM 与两个 owner 的只读版本比较通过。
  - 收尾：同步说明、技能触发指针、手册、维护入口与发布记录；既有三平台 Node 22/24 CI 纳入专项，非本机实跑和真实宿主仍列 P2。完整能力包更新后生效，无私有配置迁移或旧文件清理；任务专属临时目录已清理并复核；未同步业务工程，保留并行夜跑修改；提交与双远端推送按用户后续 c + p 授权执行，结果以 Git 记录为准。


- 2026-10-15（连续人工验收，framework-maintenance）：demand-delivery-plugin 0.2.0 新增 demand-acceptance，固化连续接收结论、精确逐号交付、授权复用、独立报告与断点恢复。人工通过、自动证据和交付阶段分别记录；BOS 多需求号输出为数量在块外、text 块内单行升序去重、半角逗号无空格。复用 demand-commit 与可选 bos-code-update-log，不增加第二套 Git/BOS 执行器；普通单需求沿用原入口，批次索引按需使用。
  - 验证：Windows Node 24.14.1 的验收专项 16/16 通过，包含官方 commit-demand 真实隔离 Git 提交结果对接、多仓完整回执、范围漂移、交付者/发布排他、未知 BOS 不重放、部分 push 恢复及精确编号格式。独立 Agent 场景演练先实际发现 BOS 自行核对仍需人工确认、commit+BOS 恢复未释放占有两处问题；修正为权威回读证据可登记成功、完成后释放，并经内存复演和新增回归确认。脚本只校验元数据/回执，不证明真实 BOS 结果或服务端幂等。
  - 发现与治理：技能 quick_validate、部署文档链接/目录覆盖通过；Windows PowerShell 5.1 在隔离项目实际生成新 thin-index，确认描述保留且 source 指向真实技能。README、目录/指南、workflow 条件入口、插件 manifest、不可变发布记录及维护摘要/队列同步；定向版本检查无问题（0.1.0→0.2.0 minor），全仓仍仅有已登记 xc 1.0.2–1.0.4 缺 commit 的六项历史问题。现有 standard-demand-entry 的三平台 Node 22/24 矩阵自动覆盖新增测试，非本机实跑和真实宿主接入仍待验证。
  - 收尾：严格 UTF-8、语法及最终差异检查通过；任务临时夹具与官方计划临时文件已清理。提交与双远端推送按本轮用户 c + p 授权执行，结果以 Git 记录为准；未操作真实 BOS 或更新业务工程副本，技能需正常能力包更新并刷新 thin-index 后在业务宿主发现。纯框架维护不创建自反馈。

- 2026-10-15（夜跑分层验收，framework-maintenance）：新增按需加载的夜跑 workflow、批次模板和项目接入说明。纯后端不加载浏览器，UI 使用延迟加载 Playwright 的薄 runner，复用 session/evidence；独占 context、API 独立采集、有限执行与关闭、失败停止后续用例。Broker 抽取纯导入客户端，stdin 非交互调用区分传输/认证/业务/未知结果，精确方法角色授权、严格 TLS、响应上限、不重放未知写。旧 CLI 移入兼容模块，--path/--url 同义。
  - 验证：Windows Node 24.14.1 新增及基础专项 30 项、既有编排结果 2 项、框架契约 1 项通过；实际复用宿主 Playwright 1.62.1 与已安装 Chrome 155.0.8059.40，无头登录、正常导航、iframe/popup、截图/API 回读、版本失效及恢复通过；合成 HTTP 空闲/有效活动/心跳/认证恢复/停止对照使用可控服务时钟，不代表真实服务器时限。Overlay 配置专项通过；首次发现旧静态测试把 compile 薄入口误判为未调用 workspace resolver，改为核验入口委托及实现解析，并复测通过。文档部署链接通过。
  - 治理：coding-iris-plugin 0.18.0 与六个依赖 patch/发布记录同步，新增 CI 三平台 Node 22/24 和源仓隔离依赖锁；未安装依赖，矩阵尚未执行。版本校验仅剩既有 xc 1.0.2–1.0.4 缺 commit 的六项历史问题，不改历史记录。正式 run 仍由 Coordinator 核验并消费既有结果，不另建台账；真实项目和宿主持续运行能力留 backlog。最终定向复测 14/14，部署文档链接及 diff check 通过；任务截图、临时配置、合成服务与浏览器均已退出/清理。未启动夜跑、同步业务副本或操作真实服务；提交与推送按用户后续 c + p 授权执行，结果以 Git 记录为准。

- 2026-10-15（BOS 验收、会话维护与编排基础修复，framework-maintenance）：补齐共享测试契约、Testing Agent/BOS workflow 路由和项目适配指南；新增无依赖 test-session/test-evidence 模块，按有效活动延后心跳、认证恢复串行化、未知结果阻断、限时收尾，实际资源响应哈希及 request-time frame 归属可复用。编排事件 payload 深拷贝消除 ACK 投影污染，新 launch-result/v1 区分启动与 result 消费；旧 run 不补造历史完成证据。
  - 验证：Windows Node 24.14.1 新增专项 19/19、既有编排/验证指纹测试、框架 contract/evolution（含 PS5.1/PS7）与 BOS 9/9 通过；BOS 测试夹具补 HEAD 初始提交以符合现有运行时预检。文档链接通过，三平台 Node 22/24 CI 已接入新增专项，未取得非本机实跑。组件版本检查保留已登记 xc 1.0.2–1.0.4 发布记录缺 commit 的六项历史问题；本轮不修改插件目录，无组件递增。
  - 边界：仅框架本地实现与模拟验证，真实保活端点/空闲时限及完整业务路径仍待授权接入。未提交、推送、同步业务副本或访问真实业务服务；通知和数据保留沿批次策略。

- 2026-10-14（BOS 查询能力补齐，framework-maintenance）：bos-plugin 0.6.0 通过既有 CLI / stdio 和同一上游工具开放全部已声明参数，新增 suser / tuser / tgroup、可覆盖 explain 和不透明 body。列表接受任一人员/组条件，显式空 cuser / cgroup 分别清除默认条件，多项明确条件保留组合；默认“我的待办”继续本人＋所在组，默认本人缺失且无其它明确口径时停止。body 不推断内部协议，字段说明返回不做本地列表处理。空 cuser 从回落本人变为显式清除，按 0.x breaking minor 提供调用迁移；继承本人应省略该字段，私有配置不迁移。
  - 验证：Windows Node 24.14.1 查询专项 29/29，通过合成传输与 stdio 覆盖六种人员/组独立及组合、默认保留和显式清除、空/空白/TODO 阻断、body 对象校验与透传、字段说明原返回和既有待办过滤；首次回归发现个人待办缺少本人时可能退化为整组，已补齐停止条件并复测通过。workflow 契约 2/2、部署文档链接/清单 1/1、skill 格式及受影响文档链接通过。版本工具 owner/直接依赖范围的只读工作区比较确认 0.5.1→0.6.0 breaking minor、Migration 和不可变记录无问题；diff check 通过。现有三平台 Node 22/24 CI 自动纳入新增测试，未取得非 Windows / Node 22 或真实 BOS 验证。
  - 收尾：同步 owner、技能/usage、README、能力手册、场景、维护摘要/决策、P2 验证队列及发布记录；安装/更新和 thin-index 机制不变，已有业务工程主动更新并刷新已启用索引，旧空 cuser 调用按 usage 调整，无文件清理。查询证据保存在 `.git/agent-validation/bos-query-role-0.6.0.json`，suite 为 bos-query-role，内容指纹匹配可复用；工具默认系统临时缓存中的本次条目已移除，其它共享记录保留，无任务临时产物。未连接真实 BOS、未改个人配置、未同步业务副本；按用户后续授权提交并推送，精确暂存 16 个文件，复用查询证据，暂存组件版本门禁通过，结果以 Git 记录为准。

- 2026-10-14（BOS 查询参数说明，framework-maintenance）：bos-plugin 0.5.1 为查询技能增加按条件读取参数契约的路由，完整字段表集中到既有 usage，区分上游 18 项必填字符串与可选 body、本地开放范围、身份要求、日期默认值和本地模式/排序。上游声明注明维护时提供的 tools/list 快照来源与日期；标题 HTTP 500 保留单样本及无标题对照的结论边界，错误不自动移除筛选。运行脚本和配置不变，不开放额外参数。
  - 验证：Windows Node 24.14.1 查询专项 22/22、部署文档链接/清单 1/1、skill-creator 格式校验通过；直接调用参数转换核对 18 个 string 字段、筛选透传、未开放字段拒绝、本地选项不透传及个人身份要求。6 份受影响正式文档的本地链接/锚点可达，包含新发布记录。复用组件版本工具进行 owner 与直接依赖范围的只读工作区比较，确认 0.5.0→0.5.1 非 breaking patch，无版本、发布记录或依赖问题；diff check 通过。合成验证不替代真实 BOS、宿主或非 Windows 验收。
  - 收尾：同步插件/仓库 README、使用指南、维护摘要及发布记录；owner AGENTS、能力目录、长期决策、安装/更新说明与测试入口仍准确，无机制变更。未确认的真实查询边界并入现有 P2 BOS 队列，不新增前置门禁。已有业务工程通过既有主动更新取得说明，无配置迁移或旧文件清理；本轮未连接真实 BOS、未改个人配置、未同步业务副本。按用户后续授权提交并推送，复用上述功能证据并补查暂存版本门禁，结果以 Git 记录为准。

- 2026-10-14（HISUI 部署字节收敛，framework-maintenance）：补齐根 sparse helper 对 tracked `-text` 且无 filter/working-tree-encoding 资产的 HEAD blob 校验。旧 Windows autocrlf checkout 在新增属性的快进后可能 Git 状态干净而字节仍为 CRLF；安装/正常升级与 standard Write -NoPull 仅在干净 checkout、完整计划都是 CRLF→LF 差异时按原 blob 收敛，复核 HEAD/实际字节并以相同 index mode/blob 重置旧 stat，不暂存新内容。自定义/二进制/链接差异保留并停止；Check、DryRun -NoPull 和 Overlay 只读验证并在生成层前阻断。共享 capability 由所属 standard 项目修复，不直接修改业务副本。
  - 验证：Windows Node 24.14.1 的 sparse/字节专项 20 项与部署文档回归 6 项全部通过，包含完整 HISUI 1262 文件摘要、Git 状态/暂存内容、幂等、隐藏自定义改动、完整计划阻断、Junction，以及 PS5.1/PS7 实际 Check 与 bootstrap。更新器全套在 Windows PowerShell 5.1 与 PowerShell 7 均通过；旧删除夹具改为模拟已提交的上游删除，不以缺失 HEAD 文件绕过门禁。既有三平台 Node 22/24 CI 自动纳入专项，非本机矩阵与真实项目升级复验仍待对应入口执行。
  - 收尾：同步 README、更新 runbook、长期决策与治理队列；仅根脚本/测试/维护说明变化，不递增插件或改写不可变发布记录。功能证据保存在 Git 本地元数据，按内容指纹复用；本轮按用户授权提交并推送，不包含并行任务改动。

- 2026-10-14（需求迁移编排契约补齐，framework-maintenance）：根迁移器输出 demand-ownership-plan/v1、实际新增启用差异及迁移前后完整启用集合；更新器 ExpectedEnabledPlugin 可在需求生成/写入前阻断外部预期不一致，并在自更新续跑时保留参数。普通 Check 对待迁移旧入口返回非零；无旧入口时仍检查已启用 successor 的薄索引、逻辑路径、canonical skill 和需求 CLI 文件，Apply 复用同一可达性校验。框架不读取或改写私有注册表，不跨工作区提供原子事务。
  - 验证：Windows Node 24 的迁移专项 5 项、standard/Overlay 更新集成 2 项在 PowerShell 7 和 Windows PowerShell 5.1 均通过，覆盖预期集合不符阻断、完整数组传入成功、迁移待办 Check、入口删除/改指/源文件缺失及幂等；部署文档链接检查 1 项、UTF-8 BOM 与 diff check 通过。未重跑无关提交/补录全套；非 Windows 矩阵与私有注册表适配/项目验证仍待对应工程执行。仅根脚本/文档/测试变化，无插件版本变化；本轮按后续用户授权提交并推送，未同步真实业务副本。

- 2026-10-14（BOS 提交后日志编排，framework-maintenance）：bos-plugin 0.5.0 将 bos-code-update-log 衔接到 bos-demand-handle 的共享 workflow；全部提交 verified 后精确复用 root/完整 hash，自动准备计划，再复用明确 BOS 预授权或请求一次授权。配置缺失、拒绝及接口失败保留本地提交，未知结果先核对，已确认成功不重复写入；通用提交脚本和配置结构不变，不另建普通需求状态库。同步 owner、路由、指南、workflow registry、场景、版本与发布记录；业务工程通过既有更新取得，无新增迁移或旧文件清理。
  - 验证：Windows Node 24 插件全套 51/51 通过，新增四项覆盖单仓/多仓 verified 结果到日志计划与模拟提交、HEAD 后续变化不扩选、配置缺失及后续仓提交失败的结果边界。PowerShell 7 与 Windows PowerShell 5.1 的标准/Overlay/单共享目录发现及 workflow 契约分别 5/5 通过；部署文档链接/清单 1/1 通过。工具检查与静态契约不替代真实 Agent 的预授权/拒绝、部分失败阶段选择及交接去重轨迹，沿既有 BOS P2 队列取证；现有三平台 Node 22/24 CI 自动纳入新增测试，未取得非 Windows/Node 22 实跑。
  - 收尾：组件 owner 定向比较确认非 breaking 的 0.4.0→0.5.0 minor 递增，无问题；diff check 通过，隔离夹具自清理后本任务临时目录已删除并复核。功能证据存于源仓 Git 本地元数据，可按内容指纹复用，不部署。本轮不修改个人配置，不同步业务副本或用户级入口，不执行真实 BOS；提交与推送按本轮后续授权执行，结果以 Git 记录为准。

- 2026-10-14（BOS 日志回归与共享配置，framework-maintenance）：bos-plugin 0.4.0 新增 bos-code-update-log，已有 Git 提交先预览、明确授权后补录，跨仓聚合保留不同菜单和说明。查询与日志共用 BOS_MCP_CONFIG，按 skill 名分段且凭据独立；移除运行时旧格式/连接变量/编辑器回退，显式 migrate-config 原地保留查询字段并增加日志 TODO。沿用更新器按启用状态分发四个日常索引，未修改安装/更新核心，未自动同步业务工程或新增用户级入口。
  - 验证：Windows Node 24 最终插件回归 47/47 通过；PowerShell 7 与 Windows PowerShell 5.1 的 standard/Overlay/单共享目录发现及 workflow 各 4/4 通过，文档部署链接/技能清单 1/1 通过。组件 owner 定向比较接受已授权 breaking 0.3.0→0.4.0，无问题；完整 worktree 审计仅保留已登记 xc 1.0.2–1.0.4 发布记录缺 commit 的 6 项历史问题。现有三平台 Node 22/24 CI 纳入新增测试，未取得非 Windows/Node 22 实跑，不声称真实 BOS 验收。
  - 本机配置：正常 Windows 宿主完成显式迁移，查询字段等值、既有入口新进程离线校验、路径绑定与重复迁移均验证；日志字段待使用者独立填写。补充临时文件落盘后物理路径检查，阻止 MSIX 将新文件写入隔离层，对应模拟回归通过。任务生成的隔离副本已按归属核实并删除，不在共享资料记录个人值或路径。功能证据记录于源仓 Git 本地元数据，不部署；提交与推送按本轮后续授权执行，结果以 Git 记录为准；真实 BOS 写入未执行。

- 2026-10-14（HISUI 资产升级，framework-maintenance）：核心固定 wanghc/hisui 的 `4c09319c2daa09a25813c6e6af349e2791d79944`（2026-10-12），按上游组件顺序与 Less 配方、锁定工具重建主/压缩 JS、五个主题及 locale；保留来源与许可证。对照 HISUI 0.1.0 打包目录（主 JS 文件时间 2026-09-22），补充 26 个 Git 未跟踪分发资源并单独固定摘要，不用较旧主库覆盖新源码。1262 个受管文件有完整摘要，62 个 jQuery 入口有源码索引；14 个生效 CSS 资源缺项如实报告，排除注释 URL。coding-iris-plugin 0.17.1 同步控件/样式行号与运行版本/helper 边界。源仓具备 check/verify、固定输入构建、并发修改保护与失败回滚；正常能力包更新分发 vendor，维护工具/依赖不部署，不改项目预览配置。用户选择的每月只读检查在当前聊天设置为每月 1 日 09:00，有变化才提醒，不自动升级、提交或同步工程。
  - 验证：Windows Node 24 最终专项 12/12 通过，无跳过，包含固定源码与分发输入逐文件复现、篡改/新增/缺失、索引、分发摘要漂移、资源缺项门禁、回滚/恢复保留、链接边界及两种真实 JS 的 DataGrid editor 取值保存；部署文档链接 1/1 通过。本机浏览器默认主库与 pure 压缩库均编辑保存成功，pure 冒烟资源请求全部 200、Console 无错误；未注入 getValue shim，当前主库与参考包均未提供 $.fn.getValue。PS7 及真实 Windows PowerShell 5.1 的新增更新文档断言、5.1 脚本 BOM/语法检查通过，安装器未变化，不机械重跑更新器全套。最终 check 与上游 master 一致，离线 verify 与自有文档差异检查通过。组件 worktree 校验识别 0.17.0→0.17.1，无本轮新增问题，全量仍被已登记 xc 历史记录缺 commit 阻塞；未改历史记录。三平台 Node 22/24 CI 已配置，实跑与真实 HIS/WebView/PAD 沿既有队列取证。
  - 收尾：本地内容证据记录在 `.git/hisui-vendor-validation.json`，指纹匹配可复用。浏览器验收页关闭、回环服务停止；本任务临时 clone、构建 tools/cache 与诊断脚本已删除并复核。使用者的原始打包目录保留；提交与推送按本轮后续授权执行，结果以 Git 记录为准；没有业务工程同步或服务器操作。
  - 差异边界：自有实现/文档的 diff check 通过；HISUI 生成 JS 保留构建器输出，单独 diff check 报告 5 处末尾空格，不将第三方生成代码的格式调整混入资产升级。

- 2026-10-14（需求交付归属迁移）：demand-delivery-plugin 0.1.0 接管通用提交，bos-plugin 0.3.0 接管标版补录；coding-iris-plugin 0.16.0 删除旧技能、CLI 和引用别名，六个直接依赖插件递增 patch 并扩大兼容范围。根更新器独立识别旧部署，先检查显式状态、自定义内容、链接、目标和过滤冲突，再生成验证新入口、迁移项目 AGENTS/本地文档与配置、启用缺失 owner、删除旧受管入口。迁移 product/default-kind 配置，保留草稿与计划数据协议；不初始化 BOS 个人凭据、不访问外部服务、不自动更新业务副本。
  - 验证：Windows Node 24 联合回归 52/52 通过（提交/hook 21、BOS 发现/更新 8、补录 19、迁移专项 4）；最终迁移规则定向复验通过。PS7 / PS5.1 均验证了 standard/Overlay 的 DryRun、接入启用、删除旧入口和幂等更新。PS5.1 更新器首轮已通过前半段，在 legacy sparse 夹具漏打包新增 helper 处停止；补齐 helper/resolver 与实际落盘断言后，从该场景续跑至末尾全部通过。技能 frontmatter、路由与部署文档链接检查、diff check 通过；版本检查无本轮新增问题，保留已登记 xc 历史记录债务。非 Windows CI、真实宿主与业务副本尚未验证。验证证据更新至 D:/tmp/Codex/demand-ownership-20261014/validation-evidence.json；测试产物收尾清理后只保留此文件。本轮按用户授权提交并推送，未同步真实业务项目；工作区并行的部署配置改动保留，不纳入本轮验证结论。

- 2026-10-14（路由、预检、混合 CSP 与提交复核）：coding-iris 0.15.9 对齐默认 direct/可选 guarded 索引，verify 支持重复执行并按 NUL 路径集合核对缺少/额外文件；部署、CSP 编译和 SFTP 配置统一消费 workspace 校验结果。更新器统一报告/停止状态，缺少独立 .agents Git 时在任何 exclude/索引生成前失败，Overlay 复用 initializer 的阻断结论。i18n 0.2.6 修正四技能 frontmatter，helper 扫描区分客户端区域、服务端表达式及模板插值，事件实体位置映射回源码。同步 owner、README、更新说明与发布记录；无配置/会话迁移，无旧文件清理，不同步业务副本。
  - 验证：Windows Node 24 下提交 15 项（全套 14 项及修正完整性夹具后的负例复测）、direct/编译 19 项、前端/SFTP/resolver 18 项、helper/预检 12 项及路由契约 4 项通过；Windows PowerShell 5.1 更新器全套通过，PowerShell 7 新增发现/停止回归通过，暂存版本门禁验证 7 个相关组件通过。更新器全套测试的旧后条件断言已对齐 canonical CLS 引用，无业务规范变更。提交钩子命中的两处历史合成密码改为运行时随机值，保留值不变断言；PowerShell 5.1 两段受影响夹具及原凭据扫描器复验通过。新增混合语法与工作区检查纳入既有三平台 Node 22/24 矩阵；非 Windows 本机无法执行，不能视为已通过。测试只用合成 Git/本机回环服务，无业务服务器操作；最终提交和推送以 Git 记录为准。

- 2026-10-14 framework-maintenance：增加 Overlay 部署配置继承与目标一致性门禁；本轮不涉及业务验收或 feedback；提交与推送按用户授权执行。部署首轮 33 项、最终解析/CSP 13 项及上下文门禁 2 项通过，文档链接检查通过；模块脚手架 PowerShell 7 与 Windows PowerShell 5.1 均通过。先前直接同步的部署态改动已全部撤销，业务工程后续只通过正常上游框架更新取得能力。版本审计受无关 xc 历史发布记录缺少 commit 字段阻塞。

- 2026-10-14（BOS 需求媒体读取）：bos-plugin 0.2.2 明确处理时主动读取影响理解、实现或验收的截图和附件；workflow 统一事实来源，handle 路由、query 区分仅查询与处理调用，覆盖纯图片正文、相关性不明、关键内容缺失及证据复用。同步 README、能力指南、摘要、场景与发布记录；owner AGENTS、能力目录、usage 的既有边界仍准确，安装更新机制不变，无配置迁移或清理。
  - 验证：BOS workflow 契约 1 项、部署文档链接/清单 1 项及 diff 检查通过；逐项核对两技能与 workflow 的读取条件，无真实 BOS 或宿主验收，场景验证沿既有 backlog 跟踪。未改运行脚本，无临时产物，未同步业务副本；提交门禁与推送结果以 Git 记录为准。

- 2026-10-13（BOS 文档语义补充核对）：纠正上一轮将“文档有更新、链接通过”视为语义同步完成的判断。README 将 BOS 三个技能纳入插件概览，删除文末重复介绍，修正“所有连接只放项目 .mcp.json”与 BOS 仓外个人配置的冲突；使用指南补齐个人查询例外、初始化/查询/处理场景和已有需求路线，docs 入口补配置说明。对照 loadConfig/main/personal.initialize 修正 defaults 的离线校验、身份 TODO 独立核对及配置路径优先级，需求技能区分 BOS 与其它领域插件初始化入口。bos-plugin 0.2.0 → 0.2.1，新增不可变发布记录草稿；不改运行脚本。owner AGENTS、能力目录、更新器及 docs/update-agents.md 的现行契约仍适用，无部署机制、配置迁移或旧文件清理变化；backlog 继续保留真实宿主与跨平台验收。
  - 验证：文档部署链接/清单 1 项、配置优先级与 TODO 边界 3 项、BOS workflow 契约 1 项及两个修改 skill 的格式校验通过；版本 worktree 校验仅识别 BOS patch，无新增版本/依赖问题，全量结果仍保留既有发布记录债务。逐项对照 README 路由、技能分支和脚本条件，未运行真实 BOS 查询或业务部署。根展示页的 9 月统计为注明日期的历史快照，本轮不改成当前计数。无临时产物；本次补充修改的提交与推送以 Git 记录为准。

- 2026-10-13（近期提交维护回看）：核对 `c459149`、`01ba99e`、`26570ac`、`d81fa6f` 的实际变更路径与既有记录；BOS 当前 0.2.0、coding-iris 当前 0.15.8，工作区开始时干净。当时仅确认 README、owner 资料、能力手册和测试入口存在更新，未充分核对语义一致性；“已同步”的结论已由下述补充核对纠正。入口摘要合并历史版本条目、保留现行边界和协议路由；BOS backlog 移除已有日志证明完成的本机配置迁移待办，保留使用者验收、其它用户迁移、业务试点及跨平台矩阵。长期决策与治理优先级不变，未启动独立治理项目。
  - 本轮验证：文档部署链接与 skill/rule 清单定向检查 1/1 通过，16 个插件 manifest 目录计数与摘要一致，`git diff --check` 通过。仅维护文档变化，未重跑 BOS/SFTP 功能全量测试，既有功能结果仍归对应日志；未取得新的真实服务、宿主或非 Windows 证据。无临时产物；未同步业务副本，提交与推送以 Git 记录为准。

- 2026-10-13（BOS 组织分发与个人配置）：合并原自建查询模式、排序与计数，增加 Windows 标准私有配置生成、用户环境绑定、公司地址管理与 TODO 门禁；完整旧连接错误不回退。框架为唯一维护源，个人配置独立于项目分发。Windows Node 24 合成查询/配置测试 31 项通过，覆盖新进程、部署副本/Junction、拒绝覆盖及仓内写入；新增 Windows 应用包重定向防护 2 项定向测试通过；本机标准目录迁移已在正常桌面宿主核实物理路径与连接等价性，未代替使用者视觉验收。跨平台 CI 沿用既有矩阵，实际非 Windows 未执行。不部署业务工程，提交与推送以 Git 记录为准。

- 2026-10-13（BOS 简单需求流程收敛）：明确前端/后端直达专项技能，混合或边界不明再进入 iris-coding；普通需求由当前 Agent 连续实施、最终 diff 自查和目标验证，正式协作资料条件加载，回归按行为变化选择。安全、领域与授权门禁保留。同步 skill、workflow、README、能力指南与四类场景；owner AGENTS 和能力目录的入口/职责仍准确，无需扩写；安装、更新及 thin-index 机制未变，无额外迁移或清理。BOS 流程契约 1 项、文档链接 1 项、skill-creator 格式校验及 diff 检查通过；未运行真实需求，提效对照沿现有 P1 队列。工作区并行的查询/初始化修改保留，本轮不计作其实现或验证；按后续提交授权将本轮独立为 0.1.1，仅暂存流程及配套文档；0.2.0 查询/初始化草稿留在工作区，previousVersion 衔接 0.1.1。未同步业务工程，提交与推送以 Git 记录为准。

- 2026-10-13（SFTP 部署治理）：coding-iris-plugin 0.15.7 → 0.15.8，整合已有 direct 批处理改动，direct/guarded 共用 deployment.py 与原子传输；每次执行一个 Python 进程/一条连接，替换前复核、逐文件立即校验最终目标、失败停止，保留 guarded 基线/合并/持久化/编译后检查及远端 UTF-8 预检。结果每文件一条，保留有效证据并区分失败/不明/未执行；增加 CLI 总耗时、阶段进度、读写计数与临时路径恢复证据。摘要检查与 rename 仍非原子条件写入，强杀不承诺 finally 清理。将未提交的部署说明从已发布 0.15.7 移至新记录，旧记录恢复原文；无业务副本同步、真实服务器操作、提交或推送。
  - Windows 本地验证：Python 完整 37 项通过；Node 部署/direct/guarded/Question/worker 43 项覆盖通过（其中既有 Git 5 秒初始化超时，隔离时清理 EPERM；调整该测试预算至运行时一致的 60 秒后，定向复测通过并增加冲突文件定位断言）；真实 CLI 内存 SFTP 场景 3 项通过，涵盖 direct 三种变化比例/首文件校验失败，以及 guarded 基线流程与单连接。最终阶段证据改动定向 Node 6 项和 Python 完整回归通过，文档链接 1 项通过。测试进程/临时 Git 耗时不用于推断服务器提速。
  - 文档与分发：README、owner 协议、工具/vendor README、维护摘要与现有 P1 验收队列同步；AGENTS、部署 skill、能力目录/指南仍正确指向相同入口，无需复制协议。普通更新同时分发插件和完整 vendor src，无配置/状态迁移或旧文件清理；安装/更新/thin-index 机制不变。版本工作区检查仅识别本 owner patch，未新增版本或依赖问题；历史债务沿既有队列。三平台 CI 已扩展 worker/真实 CLI 离线测试，非本机实跑与真实同环境重复性能对照仍待验，不以业务文件部署成功代替工具验收。

- 2026-10-13（BOS 需求框架）：新增独立 bos-plugin 0.1.0（bos-init、bos-demand-query、bos-demand-handle），默认 available、bootstrap 排除 thin-index；查询保留现有 CLI/SSE/stdio 和脱敏，改用显式仓外配置或环境变量。注册 bos-demand workflow，复用 Coordinator、领域技能与业务交付协议，明确事实复用、预授权、分层证据、按需交接及非 IRIS 路由。coding-iris-plugin 0.15.6 → 0.15.7 修复提交路径物理归属、Junction/真实路径等价、新增与删除文件和 Apply 重检；WorkspaceContext.psm1 修复单共享目录数组被展开后误拒绝 Overlay 的问题。同步插件说明、能力目录/指南、更新说明、发布记录及三平台 Node 22/24 CI。查询/配置/合成 BOS 到 IRIS 提交计划与既有钩子专项 22 项、初轮真实 Git 提交回归 11 项通过；插件发现专项在 PowerShell 7 与 Windows PowerShell 5.1 各 4 项通过，Workspace Context 在两种 PowerShell 及 Node 均通过，协作契约与文档链接通过。最终祖先链接/Overlay/越界/pull 定向复测 7 项、钩子与 Node Context 6 项、BOS 到 IRIS 计划复测 1 项通过；既有 standard-demand-entry 18 项通过（与初轮提交 11 项合跑，共 29/29）。Windows Node 24.14.1；内容指纹保存在源仓 Git 本地验证证据中，本任务临时隔离现场已清理并独立复核不存在。版本检查仅识别本次两个 owner 变更，无新增版本或依赖问题，全量审计仍有既有组件发布记录债务。真实宿主/Agent 语言场景、macOS/Linux、Node 22 和真实 BOS 查询尚未验收，沿现有 P2 兼容队列跟踪。原用户级四个来源文件哈希未变；未改个人配置/客户端、业务 .agents 或已提交需求；框架提交与推送以 Git 记录为准。另一个任务的部署相关修改保留，不计作本次实现或验证。

- 2026-10-12（格式化仅限新增代码）：coding-iris-plugin 0.15.5 → 0.15.6，前后端规范、编码入口与通用 Review 明确原有代码即使因功能需求被修改，也不附带调整风格；对照任务开始时源码判定新增，移动/复制及 diff + 行不单独作为新增依据。新代码分隔空行不扩展为历史空白/EOF 整理；功能、语法与兼容性审查继续覆盖需求 diff。既有 CLS 检查器保持只读变更区间提示，Agent 排除历史格式项，不新增解析器或门禁。同步 README、能力指南与发布记录；模板、registry、bindings、能力目录和更新器核对后保持不变。Node 24：CLS 7 项、编码入口 1 项、i18n 路由 3 项、角色契约 1 项、文档链接 1 项通过；CLI 首次因沙箱临时 Git 写入失败，在 D 盘隔离目录补跑通过并确认清理。版本 worktree 校验唯一 coding owner 变化，无新增依赖/发布问题，非零退出来自既有其它组件发布记录债务。文档/静态验证不证明真实 Agent 或业务运行效果。普通更新分发，无业务迁移，未同步真实工程；未暂存、提交或推送。

- 2026-10-10（可选 JS 页面组织模板）：以 3e7f84b 为基线，coding-iris-plugin 0.15.4 → 0.15.5；参考用户指定的 code.template.js 组织约定，整理普通 ready 与闭包显式调用两种可选模板，明确依赖、唯一初始化方、私有事件绑定及按需生命周期，不将历史命名/现代语法提升为全局要求。前端规则、格式规范和 CSP 模板按场景引用，复用既有 Review；AGENTS、skill 与能力目录核对后不扩写，入口已可达且能力归属不变。Node 24.14.1 下模板模拟 3/3、编码入口 1/1、i18n 路由 3/3、文档链接 1/1 通过；模拟覆盖初始化时点、事件绑定、状态变更及依赖缺失，不证明真实页面、目标 helper 或旧浏览器已生效。版本 worktree 校验仅识别 coding 插件变化，无新增版本/依赖问题，既有发布债务保持原范围。普通更新分发，无业务迁移或旧文件清理，未修改业务模板、未同步真实工程；无临时文件，提交推送以 Git 记录为准。

- 2026-10-10（前端命名与格式规范）：以 abe2a1f 为基线，coding-iris-plugin 0.15.3 → 0.15.4；新增 frontend-coding-format 唯一事实源，明确 ES5、4 空格、双引号默认值和项目覆盖，前端/混合入口与 Review 共用。整理 CSP/JS/CSS 模板，纠正 ##(expression)## 是编译期表达式而非 HTML 转义，移除固定业务路径与 Broker 假设；补充 HEAD 按目标工程 CSR 匹配规则及依赖判定、无实现时保留基础 HTML，不凭版本推断能力；不改通用 review-agent 协议，不新增 formatter、配置或门禁。Windows Node 24.14.1：CLS 7/7、角色契约 1/1、i18n 路由 3/3、编码入口 1/1、文档链接 1/1 通过；两项测试初次因首个“最终 diff”定位及标题标点归一化误报，修正定位后定向复跑通过。六类当前 Agent 串行样例见 maintenance/validation/agent-evolution.md；5 个 JS 语法检查、2 项历史保留断言、i18n 正反例通过；Windows PowerShell 5.1 下 9 个样例均 UTF-8 或 ASCII 兼容，退出 0。未做独立 Reviewer、真实浏览器或 IRIS 编译验收。版本 worktree 校验识别唯一 coding 插件变化，无新增版本/依赖问题；退出非零来自已登记的其它组件历史发布记录债务。任务专属临时样例已核对清理。普通更新分发，无业务迁移或旧文件清理，未同步真实工程；提交推送以 Git 记录为准。

- 2026-10-10（CLS 规范与 Review 接入）：以 `1f5a12c` 为基线，coding-iris-plugin 0.15.2 → 0.15.3；扩展 cls-coding-format 为命名与格式唯一事实源，编码入口改为业务/契约复用、明确规范优先，修正后条件空白断言并更新模板。参考 iris-code-formatter 3.1.0，以自有表述整理，不 vendor、不依赖全局 skill。删除 `1f5a12c` 引入的 provisional §3.4，撤回反复询问风格和内部一律无空格要求；通用 review-agent、Coordinator 与 standard-change 传递规范及覆盖范围，区分功能缺陷、规范项和可选建议，不新增门禁。Windows Node 24.14.1：CLS 专项 7/7、角色/工作流契约 1/1、编码入口契约 1/1、文档部署链接 1/1 通过；入口测试初次正则遗漏同目录链接，修正后定向复跑通过。四类当前 Agent 合成输出及串行复核见 maintenance/validation/agent-evolution.md，不声称独立 Agent 或 IRIS 编译通过。版本 worktree 校验仅识别本次 coding 插件变化，无新增版本/依赖问题；退出非零来自已登记的其它组件历史发布记录问题。普通更新分发，无业务迁移或旧文件清理，未同步真实工程；未暂存、提交或推送。

- 2026-10-09（HISUI 弹窗布局指导）：coding-iris-plugin 0.15.1 在现有前端规则及样式参考补充留白、宽度、局部盒模型、fit/resize 和滚动层排查；保留构建、主题及真实客户端验证边界，不收录业务案例清单或固定尺寸。同步 owner/仓库 README、使用指南与发布记录；AGENTS、skill、能力目录、backlog 和更新器入口核对后保持不变：归属、调用方式、部署机制未变，无新增治理项。文档链接定向检查 1/1、diff 检查通过；工作区版本校验识别 0.15.0 → 0.15.1，仅报告已登记的其它组件历史发布记录缺少 commit，未新增依赖或发布问题。未运行真实客户端布局验收；未同步业务工程，提交与推送状态以 Git 记录为准。

- 2026-10-04（默认精简开发部署）：经用户明确授权，coding-iris-plugin 0.15.0 的后端/前端入口默认 direct，无需需求号、Git 会话、fetch/pull 或三方合并；复用既有 Atelier/SFTP 适配器，保留整批预检、Storage、并发变化、回读及编译诊断，失败不自动重试。guarded 显式可选，旧 --demand 命令保留原行为。同步 skill、规则、指南、发布记录及 6 个依赖插件的兼容上限与 patch 版本；未同步业务工程副本；提交与推送状态以 Git 记录为准。Windows Node 24 的 direct 12 项测试（含真实 CLI + 本地模拟 Atelier）、Question 7 项、编码路由及文档链接检查通过；既有部署回归首次有 1 项临时 Git 目录清理 EPERM，清理该目录后定向重跑通过。版本工作区校验无新增依赖/发布问题，仍报告已登记的 xc 插件 1.0.2–1.0.4 缺失 commit 历史问题。三平台 CI 配置已纳入 direct 测试，尚未取得远端矩阵和真实环境的 direct 部署证据。

- 2026-09-28（Windows Runtime skill links 收敛）：CI 诊断确认 `check-functional-diff.ps1` 含中文但无 UTF-8 BOM，Windows PowerShell 5.1 在 Overlay 初始化读取时解析失败，因而未生成更新适配脚本；补 BOM 后保留正文不变。更新器测试的旧式稀疏检出改为直接传模式并检查更新脚本保留，Git hook 断言只看仓库本地配置，避免把用户全局 `core.hooksPath` 误判为自动启用。Windows Overlay 定向回归 1/1、PowerShell 5.1 完整 `update-agents` 回归通过；三平台 CI 结果以本次推送后运行记录为准。未修改业务工程或用户全局 Git 配置。

- 2026-09-28（Runtime skill links Windows 回归）：工作流恢复启动后，Windows job 暴露技能迁移测试用 8.3 临时路径调用 PowerShell 5.1 脚本失败，以及更新器测试断言的固定词句已与 owner 当前正文不一致。迁移样本改从真实临时目录建立，断言改为现行「不通过扫描父目录」表述；Windows Overlay 定向回归 1/1。后续 CI 显示 Overlay 初始化未生成更新适配脚本，测试在调用前增加状态断言以报告实际阻断原因；升级样本的嵌套 `.agents` 仓库补齐独立 Git 身份。三平台 CI 最终结果以推送后的运行记录为准。未改变技能、更新器和业务副本。

- 2026-09-28（跨平台路径别名回归）：coding-iris-plugin 0.14.1 修复 deploy-guard 初始化时 Windows Git 根目录长路径与系统短路径误判，保留既有会话状态位置；macOS 文档布局与菜单同步测试从物理临时目录创建隔离样本，不削弱菜单快照的链接拒绝门禁。插件 README 和发布记录同步，使用入口、依赖范围和业务部署流程不变；定向测试与三平台 Node 22/24 CI 结果以本轮实际运行记录为准。源仓更新不自动同步业务工程；历史 xc 发布记录的版本门禁问题仍独立存在。

- 2026-09-28（Windows 路径别名修复）：agent-context-kit 0.4.2 修复 task-handoff 在 Git 返回长路径、Node 使用 8.3 短路径时误算 `docs/handoff` 仓库相对位置；Git status 过滤和 Overlay GitRoot、共享 Junction 比较按各自协议统一路径表示。增加嵌套项目排除规则与状态回归，workspace-context 测试复用短路径临时目录。Windows 本地首轮交接与 workspace-context 专项 22/22，后续定向回归 4/4，语法与差异检查通过。组件版本工作区校验识别 0.4.1 → 0.4.2，仅报告其他插件既有发布记录 `commit` 字段问题；新版本三平台 Node 22/24 CI 以推送后的实际运行结果为准。使用入口、安装/更新和薄索引行为未变，现有交接不迁移；提交与推送状态以 Git 记录为准；未同步业务副本。

- 2026-09-28（标版需求简洁模板）：coding-iris-plugin 0.14.0 将 iris-demand-entry 改为 `{IRIS}` 名称和三段式描述，缺陷按操作/预期/实际、功能改进按说明/操作/预期；用户、安全组、科室可选，仅问题依赖时补齐，备注仅保留验收限制。渲染器与文本/Excel 同源，草稿使用 v2，按用户决定直接替换旧格式，不保留旧草稿兼容。六个依赖插件仅递增 patch 并扩展范围至 0.14.x，未使用需求草稿接口；其 AGENTS/README 职责与调用未变，无需复制模板规则。同步 owner、协议、能力手册、摘要、P2 验收队列与发布记录；安装/更新与 thin-index 行为未变，部署方式在 owner README 和协议说明，无需修改更新器。skill 格式、文档链接与差异检查通过，版本比较无新增问题；Windows Node 24 专项回归 18/18 通过，覆盖两种模板、文本/Excel 同源、缺失字段、取证、回填和提交计划；macOS/Linux 与 Node 22 矩阵、BOSS 真实录入及测试交接继续沿 P2 跟踪。提交与推送状态以 Git 记录为准；未同步业务副本。

- 2026-09-25（Overlay 只读调查）：agent-context-kit 0.4.1 / coding-iris-plugin 0.13.7 分离真实仓库只读参考和模块默认写入范围，同步 owner、技能、README、共同契约与发布记录。旧项目入口按授权定点迁移，manifest、工具写入门禁和 backend-only 身份不变；能力手册已引用 Overlay 契约，无需复制规则。workspace-read-scope、workspace-context Node 测试及文档链接检查通过；两项版本迁移对比 HEAD 无新增问题，全量版本校验保留既有发布记录字段问题。iris-workspace-context.tests.js 仍以 compile.js 直接包含 resolveWorkspaceContext 为断言，当前 HEAD 已改为转发 deploy-protected；这两个文件与 HEAD 一致，本轮未调整该既有测试。源仓变更经校验后原样同步授权的共享部署副本，模块通过既有共享链接读取；未提交或推送。

- 2026-09-25（共享经验准入）：agent-framework-evolution 0.1.2 将经验筛选收紧为新增价值、复用依据、验证与边界、沉淀收益四项同时满足；局部观察留项目内，单次有机制证据的高价值发现可准入，有效命中按独立场景去重，提升要求成熟证据。同步 owner、共享协议、经验维护规则、能力手册和发布记录；项目模板已有按信号只读路由，无需改动，安装/更新行为不变。框架契约、IRIS fast-path、部署文档链接检查通过；版本全量检查仅报告既有 xc 发布记录字段问题，本轮无新增报错。正反例已人工核对，真实模型执行效果沿既有 P2 反馈评估跟踪，不以静态测试代替；未改历史经验正文、未提交或同步业务副本。

- 2026-09-23（兼容入口误报修复）：根 `check-agent-entrypoints.ps1` 与 `repair-agent-entrypoints.ps1` 统一按链接解析后的目标比较，`AGENTS.md` 与 `.\AGENTS.md` 等价；正确链接不再误报或被备份重建，真正指向其他文件的链接仍报告并在显式修复时备份。新增隔离回归并接入 Windows CI；定向回归在 PowerShell 7/5.1 通过，完整 `update-agents.tests.ps1` 在 PowerShell 7/5.1 通过，文档链接定向检查 1/1，通过真实 imedical 链接核对。源仓修复不自动更新业务 `.agents`，提交、推送与部署状态以当次 Git/更新结果为准。

- 2026-09-23（标版需求产物边界）：coding-iris-plugin 0.13.6 为需求录入四个写入入口增加 `.agents/`、能力包源码和目录链接别名的硬门禁，保留旧输入只读迁出能力；同步 owner 协议、更新说明、根总览与发布记录。标准工程临时目录和 `docs/work/standard-demand/` 保持可写；最终专项回归 15/15、文档链接 1/1、暂存组件版本门禁及差异检查通过，功能证据指纹匹配。真实业务副本在源仓提交推送后按用户授权更新。

- 2026-09-22（能力手册持续同步）：本地 agent-kit-maintenance skill 明确能力目录与使用指南的同步触发条件、源事实优先级和完成标准，覆盖框架变更回看；复用现有文档清单/链接定向检查，并要求按差异核对说明与示例语义。xc 沿用 P2 待治理范围。本次仅维护 skill 与日志，不改变能力实现或业务部署内容。

- 2026-09-20（文档目录与部署边界）：docs/README.md 作为项目使用入口，maintenance/README.md 作为源仓维护入口；31 项准确路径迁移，稳定 runbook/schema 保留原位。分离医生站 AI、知识接入、交接等文档中的源仓验证说明；按用户授权删除旧部署样本四个文件，不留副本。安装/更新继续复用 /docs/** 和 Git 安全快进，不新增清理脚本。新增文档专项覆盖新装、旧文件/空目录收敛、维护区排除、自定义残留及 dirty 保护；六项已分批验证，首次链接检查误含 Git 忽略的本机交接，限定分发文件后通过。导出 XML 与历史 run JSON 的 checkout 字节保持一致，原本机交接和历史 feedback 保留。PowerShell 7/Windows PowerShell 5.1 更新器完整回归均通过，覆盖实际安全快进、Check/DryRun -NoPull、旧路径/空目录清除、维护区不落盘、自定义保留及既有 Overlay 流程；PS5.1 使用原生模块环境启动。证据已记录，任务测试目录已清理。非 Windows 矩阵已接入既有 CI，未实跑。未提交、推送或更新真实业务副本。

- 2026-09-20（非 xc 能力手册）：新增 docs/guides/capability-catalog.md 与 docs/guides/capability-guide.md，README 提供统一入口；按当前 manifest 与源文件核对 11 插件、46 skill、35 rule，提供逐技能请求示例、前提、产物和主要使用路线，明确初始化/日常/兼容入口、插件状态、条件加载及操作范围。按用户要求将四个 xc 插件手册补齐登记为 P2，并同步队列排序与验收标准。仅根文档与维护记忆变更，无插件内容或版本变更；清单覆盖、源链接与章节锚点检查通过，最终差异检查见本轮验证；未提交、推送或同步业务副本。

- 2026-09-20（纯 init 空目录清理）：根生成器补齐删除受管索引后的空目录清理，并兼容上一版本仅删除文件后留下的空目录；限定排除项和 ContextRoot/skills，检查隐藏项与祖先链接，使用非递归删除防止误删新增内容。PowerShell 7/Windows PowerShell 5.1 各 8 项迁移专项和 update-agents 完整回归通过，覆盖历史空目录、删除索引后空目录、隐藏文件、空子目录、目录/祖先链接、standard/Overlay 及 Check/DryRun 只读。真实工程 DryRun 已识别截图对应两个空目录，未执行写入。验证证据已记录；非 Windows 矩阵沿用 P2 待验收，未同步业务副本；提交与推送状态以 Git 记录为准。

- 2026-09-19（IRIS 编码入口优化）：coding-iris-plugin 0.13.5 收窄统一入口触发，明确专项直达；部署基线前移，i18n 矩阵归前端规则，修正默认转换编码表述。路由/引用/前置顺序及既有框架契约 5 项通过，含坏路径、坏章节和错误顺序反例。五份主链文档静态字符减少 18.9%，不是模型提效结论；真实对照沿既有 P1 队列。基线 e92a5c6，信创内容保持，源仓改动未提交、推送或同步业务副本；验证详情见 maintenance/validation/agent-evolution.md。

- 2026-09-19（纯 init 薄索引清理）：7 个插件以 manifest excludeSkills 统一初始化与更新策略，复用根生成器精准删除历史受管入口；同步初始化验收、README 与迁移说明。PowerShell 7/Windows PowerShell 5.1 的 update-agents 全量回归、各 7 项迁移专项及性能分析专项通过，医生站 AI 10 项专项通过；覆盖 Check/DryRun 只读、Write 删除、幂等、standard/Overlay、旧更新器升级、状态保留及自定义/链接保护。7 个真实 manifest 排除与 canonical 可达检查通过，版本校验无本次新增问题；quick_validate 因缺 PyYAML 不可运行，改用 frontmatter 静态检查与真实生成器验证。非 Windows 矩阵仍列 P2。验证证据已记录；未同步真实业务副本或推送，提交状态以 Git 历史为准。

- 2026-09-19（task-handoff 新会话验收）：无原聊天历史的新会话仅依据项目规则、交接入口和仓库材料恢复目标、授权、现场、证据及下一步；先执行 inspect，确认 master/178da9f、工作区无改动、交接无漂移且 task-handoff-v1 证据指纹匹配，再维护本机交接记录。用户明确确认本次当前 Codex 宿主的新会话接续验收通过。其它 Agent 宿主以及 macOS/Linux、Node 22/24 矩阵继续保留为 P2 待验证；本次未扩大到实现修改、提交、推送、业务副本同步、远程 CI 或服务器访问。

- 2026-09-19（通用需求接续）：agent-context-kit 0.4.0 新增 task-handoff skill、Markdown 模板和 Node 内置模块工具，项目 docs/handoff 按需启用、关键节点更新、显式交接留历史；正文摘要绑定现场，检查工作区/暂存内容变化与既有证据，默认本机 exclude，不扩展授权或调度会话。自然语言路由仅在授权初始化/维护时定点合并，普通更新不覆盖项目入口，旧 run/个人 handoff 不迁移。Windows Node 24 的 21 个专项场景分批通过：首轮 16/18，通过修正测试调用到 canonical 生成器补齐 PS7/PS5.1 两项；新增 3 项和路径补测通过，覆盖 sparse 依赖、链接快照和入口条件。框架契约/演进行为两组通过，语法与差异检查通过。工作区版本校验识别 0.3.5→0.4.0，无本次新增问题；全量仍保留已登记历史债务。框架源仓生成仅本机保留的交接样本，真实无历史新会话、其它宿主及完整三平台 Node22/24 矩阵转入 P2；业务副本未同步；提交与推送状态以 Git 记录为准。

- 2026-09-18（主流程入口配置，未提交）：按用户授权补充卡片加载、主流程导航、辅助快捷按钮的职责与映射检查；快捷入口规则仅在入口存在或明确新增时适用，不硬编码补回已移除按钮，不将显示顺序当业务门槛。纳入现有待发布 AI v0.2.1，保留其它未提交修改；仅文档，未改业务公共框架、工程副本或服务器配置。

- 2026-09-18（医生站 AI 多宿主兼容，未提交）：主 skill 引用 workstation-contracts 的无 Chat 兼容约束；共享业务不依赖 Chat，刷新通知可选且失败不改变提交结果，传统回调保留，跨窗口按同源与就诊归属核对。verification 增补无 Chat、跨窗口和共享调用方隔离场景。仅指导文档变更，合入当前未提交的插件更新；未发布或同步业务副本。

- 2026-09-18（上下文偏差修复）：agent-context-kit 0.3.5 统一 contextMode 判定触发条件，已有模式的维护与优化不重复判定或落盘；coding-iris-plugin 0.13.2 在指定来源无菜单快照时返回 project-menu-missing 警告并回退共享参考，损坏/链接/完整性失败仍阻断，不触发同步。Windows Node 24 专项 16/16 通过（含新增缺失/空结果/损坏快照、standard/Overlay、sparse 和 PS7/PS5.1 thin-index），文案一致性及差异检查通过；工作区版本校验识别两项 PATCH，无新增版本问题。非 Windows/Node22 验证沿用 backlog 的 P2 矩阵事项，未宣称通过；正常更新取得修复，无配置迁移或兼容清理，未提交、推送或部署业务副本。

- 2026-09-18（待治理项优先级）：根 AGENTS 与本地维护 skill 明确每个待治理项必须标注 P0–P3，复用 backlog 既有定义，新增或调整事项时核对执行顺序、排序入口与详情一致性。本次仅补充维护规则，不调整既有事项优先级或业务部署内容。

- 2026-09-18（知识检索自主选择）：coding-iris-plugin 0.13.1 将查询选择集中到通用规则，skill 描述支持模型按信息缺口自主使用，不要求用户点名、不局限菜单定位、不固定每次必查；现有 Agent/前后端入口复用，平台 API 查询和业务知识参考分开。更新后刷新薄索引，不自动改写项目 AGENTS.md，不扩大远端授权。本轮仅修改路由文案与版本，未部署业务副本。

- 2026-09-18（知识资料并入与菜单刷新）：coding-iris-plugin 0.13.0 接收 218 份脱敏上游参考（164 份 wiki/目录、40 份菜单/安全组、14 份技术文档），记录固定来源与双 hash，排除生成器缓存。新增 iris-imedical-knowledge / iris-menu-sync，MCP 采集与离线 plan/apply 分离，项目快照原子发布、全量/部分刷新、指纹漂移阻断和历史恢复；AI 0.2.0 按需路由，五个其它依赖插件仅扩展兼容范围。资料短 ID 与 vendor .gitattributes 解决 Windows 长路径及换行校验问题。14 项专项通过，包含真实 sparse 初装/快进刷新、项目快照保留、standard/Overlay、PS7/PS5.1 thin-index；入口链接及简单 frontmatter 检查通过，通用 Python validator 缺 PyYAML。真实 IRIS 采集与非 Windows CI 待验证；未部署真实业务副本，未提交或推送。

- 2026-09-18（项目上下文编程体验优化）：agent-context-kit 0.3.3 修正 project-context-maintenance 的初始化/维护/日常优化混用，允许授权范围内语义去重与重组，初始化及优化细节改为按需 references；按工程实际开发入口、参考实现和有效验证路径选择信息，保留维护分工及配置值。同步五份上下文模板、owner 文档、更新说明与发布记录，不自动扫描插件或同步业务副本。契约检查、演进行为测试（含 Windows PowerShell 5.1 / PowerShell 7 配置合并）、薄索引 DryRun、UTF-8/引用/差异检查通过。通用 quick_validate 缺 PyYAML，使用静态 frontmatter 与实际薄索引解析检查；这不证明模型效率收益。组件版本校验识别本次 0.3.2 → 0.3.3，失败项仅为既有信创插件 1.0.2 发布记录缺少合法 commit，未改历史记录；未提交、推送或处理业务工程。

- 2026-09-17 本轮框架演进交付完成：a529e78 与 6128127 已推送；0.3.1 补丁通过真实主工程及 10 个模块普通更新复测，guidanceMode 不再追加，11 个入口迁移零变更，50 个受保护文件与 37 份配置哈希不变。用户确认本次目标完成；跨模型/宿主对照、非 Windows 矩阵及信创历史版本门禁转入独立待治理事项，不宣称这些验收已经通过。

- 2026-09-17 实测修复：profile 的 guidanceMode 改为合法可选键且不自动生成默认配置，入口迁移补齐缺失路由并保留 BOM/换行与自定义正文；agent-context-kit 0.3.1。验证结果见 maintenance/validation/agent-evolution.md。

- 治疗表单入口补充优化：按任务加载交付章节，复用范围内已有明确部署授权；服务端原子回滚与客户端 rollback 分开表达，运行时门禁不变。演进行为补充回归通过，迁移拒写保护、文档引用与 diff 检查通过；版本检查仍仅有既有 xc 发布字段阻塞。

本文件记录近期维护流水摘要和验证结论。长期决策见 `agent-kit-maintenance-decisions.md`，后续治理队列见 `agent-kit-maintenance-backlog.md`，入口摘要见 `agent-kit-maintenance-memory.md`。

## 历史维护摘要（保留当时状态）

- 2026-09-20（工作区待提交）：imedicalxc-doctor-extend-engineer v1.0.4 编码规约新增 AO：必填项必须有值（来源缺失立即抛 rpcException，不允许空值上送，空值常被平台以"数据签名不正确"等不直观原因拒绝）；多值逗号分隔且无对照的扩展设定取值（如备案设备码）每次调用随机取一个。源于冠新科技 getPersonInfoByQrCode 的 terminalCode 必填未赋值问题（文档 6.5，识读终端编码 Y 必填）。字母范围引用同步 A~AN→A~AO（4 处）；plugin.json 递增 1.0.3→1.0.4（patch，非 breaking），新增 releases 1.0.4.md。本轮未提交、未推送；HIS 业务工程 `.agents` 副本经 `git pull` 同步（待推送后）。

- 2026-09-20（工作区待提交）：imedicalxc-doctor-extend-engineer v1.0.3 编码规约新增 AN：响应各节点类型按第三方文档逐一确认，JSON 对象单独处理（声明 Object/专用 VO 并写专属解析），禁止未确认文档就把对象节点声明为 String（Jackson 对象→String 抛 MismatchedInputException 被上游吞后表现为"接口成功但数据未落库"）。插件 AGENTS.md、elechealthcard_index.md、子 skill SKILL.md 及规约 frontmatter 字母范围同步 A~AM→A~AN；新增 releases/plugin/imedicalxc-doctor-extend-engineer/1.0.3.md，plugin.json 递增 1.0.2→1.0.3（patch，非 breaking）。worktree 组件版本校验识别 1.0.2→1.0.3 变更；release record 的 commit 字段沿用仓内既有惯例待提交后回填（1.0.2.md 同样缺该字段，属存量缺口）。本轮未提交、未推送；5 个变更文件已按精确文件同步至 HIS 业务工程 `.agents/plugins/` 副本。

- 2026-09-18（提交检查提速）：定位 078867b 提交轮次中版本校验耗时 548.6 秒、实际 commit 含钩子 22.9 秒。维护工具新增 `validate --staged`、独立版本证据、60 秒共享预算和阶段输出；按暂存 owner 与直接依赖校验，Git 对象改为 cat-file 批量读取并缓存。功能指纹改为 scope 实际内容，不再绑定 HEAD；隔离样本覆盖无关 HEAD、文案、实现、依赖和历史问题，以及未暂存修复与超时不放行。18/18 专项及 agent-evolution 兼容测试通过（含 PS5.1/PS7 分支），语法和差异检查通过，已记录可复用功能证据。隔离 index 重放原提交的七个 owner，加直接依赖共九个组件，首次 16.2 秒、复用 17.7 秒，均为 7 个 Git 进程；完整 ref 审计降至 13.2 秒、5 个 Git 进程，仍准确报告已登记的信创历史问题。原版耗时来自原任务日志，与本轮负载不同，不作为严格性能基准。已知问题登记为 version-debt-xc-1.0.2-commit，按用户要求普通提交不重复处理；未改历史记录和提交钩子。隔离测试及性能样本已清理，证据缓存按用途保留。Windows Node 24 已验证；三平台 Node 22/24 CI 矩阵已配置但未实跑。本轮仅本地提交，未推送或部署业务副本；agent-context-kit 变更由独立提交 e464b07 承载。

- 2026-09-18（标版需求录入闭环）：coding-iris-plugin 0.12.0 新增 iris-demand-entry 与 Node 内置模块脚本，支持实际 Git 补丁取证、默认文本、可选 --excel/--Excel、BOSS 需求号/最终标题回填及复用需求提交计划。补齐用户模式 --text/--bind/--plan/--commit/--help，--rev 区分历史来源，--same-title 显式确认原题；纳入 0.12.0 发布记录。历史来源不改写历史；不同历史提交可分别提报同一文件，工作区漂移和重复范围阻断。六个依赖插件仅递增补丁版本并扩展兼容上限至 <0.13.0。Windows Node 24 完整专项 12/12 与历史归属定向补测 2/2 通过；CLI 转交原 plan 后 HEAD/index 不变。Excel 经独立 openpyxl 读取核对原模板 29 个表头、正文、指派人对齐、文字公式安全和 ZIP CRC；thin-index DryRun、仓库 frontmatter/引用检查与 diff 检查通过。隔离测试及中断测试的遗留临时目录均已核实清理。通用 skill 校验器缺 PyYAML，未安装全局依赖。版本门禁已识别本次七个组件变更，剩余问题仅为既有信创 1.0.2 发布记录缺少合法 commit。非 Windows CI 与 BOSS 实际导入待验证；提交阶段已确认测试指纹匹配并复用，不重复运行完整回归。未推送、更新业务副本或修改个人 requirement-entry。

- 2026-09-18（技能插件化，工作区未提交）：coding-agent-adaptation 迁入 agent-context-kit 0.3.2；agent-framework-feedback 与 reusable-content-packaging 迁入新基础插件 agent-framework-evolution 0.1.0。三个原技能名的项目薄索引及运行时目录链接保持稳定，历史原文按归一化哈希迁移，自定义内容、链接及显式 available/disabled 保留；首次须执行不带插件筛选的完整 Write/Check。PS5.1 迁移专项 5/5、PS7 迁移专项 5/5 及后续自定义失效索引保护补测通过，两宿主更新器完整回归通过，运行时/演进专项 12/12、框架/编码路由专项 2/2 通过。隔离 Git fixture 验证旧更新器拉取并续跑、干净工作树、CodeBuddy 链接保留和 Overlay 本地索引；非 Windows CI 与真实宿主任务尚未验收。版本门禁识别本轮 5 个组件迁移，仍受历史 imedicalxc-doctor-extend-engineer 1.0.2 缺少 commit，以及工作区其它任务的 coding-iris-plugin 新增文件未升版本阻断；未修改这些内容，未改历史发布记录。更新说明、版本记录和维护入口同步，未提交、推送或写入业务副本。

- 2026-09-18（链接优先的技能适配）：新增根级 coding-agent-adaptation 0.1.0 与 sync-runtime-skills.js；CodeBuddy/Claude Code 项目目录链接到 ContextRoot/skills，Codex 复用通用层。安装/更新显式 RuntimeAdapter 接入，Overlay 转发到 canonical 脚本；普通目录、错误链接和越界父链均保留并阻断，legacy Claude 复制入口拒绝写入已链接目标。11 项 Node 专项、PS5.1/PS7 更新器完整回归及 Overlay 回归通过，已记录可复用指纹证据；现有项目链接只读 Check 返回 unchanged。源码、runbook、版本记录与迁移边界同步；非 Windows CI 与更多真实宿主验证仍待补齐。版本差异检查已识别新增 skill，修正本轮 release 草稿后当前清单仅剩既有 imedicalxc-doctor-extend-engineer 1.0.2 缺少 commit 的门禁，不修改不可变记录。通用 skill-creator 校验器缺少 PyYAML，且不接受本仓必需 version 字段，已改用仓库 frontmatter 与版本校验。未推送或批量部署业务副本。

- 2026-09-17（按需辅助与开放方法，本地未提交）：IRIS 入口统一按风险分流，新增 guidanceMode 的共享底线/默认方法/按需辅助；反馈 on-signal 保留用户验收和独立写入授权。调度器完成与 --final 共用门禁，写入验证绑定既有 scope 指纹和计划仓库身份；补 session 别名、未知 adapter 降级和 blocked 结果恢复。i18n 新运行协议与 bindings 对齐 2.0，旧 fixture 只读。项目入口提供默认只报告的精确句子迁移，保留用户内容与 profile；未改安装/更新算法。Node 主回归 8 项及新增恢复补测通过，PS5.1/PS7 新旧 run 回归通过；PS5.1 更新器完整回归补齐 fixture 依赖后通过，显式私有快照指纹补测通过。详见 maintenance/validation/agent-evolution.md。九项组件版本/依赖变更已记录，版本校验仅被既有 1.0.2 发布记录缺失 commit 阻断，不修改不可变记录。Claude 只读路由冒烟 API unknown 重试后停止，未取得模型结果；弱模型、跨宿主性能和非 Windows 矩阵未验证。未提交、推送、部署或同步业务副本。

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

## 历史提交索引（保留原记录）

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

## 历史验证摘要（保留当时范围）

- 2026-08-04：迁入 `codegraph-query` 和 `iris-codegraph` 插件；补齐 manifest、AGENTS、README、usage rule、skill 和 thin-index wrapper，并同步仓库 README、runbook、维护记忆和 update-agents 测试。已验证 `.codegraph` 状态 complete，`cg-query.js help`、`icg-query.js help`、`node --check` 均通过；`iris-codegraph` 构建因当前项目缺少 `.mcp.json` 未执行。后续确认 `codegraph-query` 依赖 `iris-codegraph`，并把该前置关系写回 manifest、plugin_profile 和回归断言。

- 2026-07-18：`scripts/tests/update-agents.tests.ps1` 与 `scripts/tests/iris-interface-plugin.tests.ps1` 已通过；后者统一使用 `python -B`，不再在 owner 脚本目录遗留 `__pycache__`。`coding-iris-plugin`、`extract-doc`、`iris-external-reg` thin-index DryRun 均成功，反馈 `260718022936` 的 8 个 owner 副本与 canonical 逐文件一致，`git diff --check` 通过。
- 2026-07-13：`plugins/agent-context-kit/scripts/tests/validate-agent-run.Tests.ps1` 已覆盖合法串行/多智能体运行、未授权多智能体、缺失报告、同签名重试超限、未授权远程写入、阶段依赖、并行效率和敏感内容门禁；`maintenance/validation/i18n-agent-p1/retrospective-6096150` 已通过校验。
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

- 后续完成每轮维护后，更新本文件的近期维护结果、全局回看覆盖点和对应验证摘要；历史记录保留当时范围，不作为当前状态。
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

- 2026-09-18：coding-iris-plugin 0.13.3 将 HISUI 原生控件状态复用细化为通用前端约束，覆盖冲突排查与状态组合验证；同步 frontend skill、README 和发布说明。纯指导资料变化，业务副本未同步。

## 2026-09-23 医生站 AI 迁移验证增强（实施记录）

iris-imedical-doctor-ai 0.3.0 新增迁移行为契约、入口对照模板与 async-contract-probe 测试辅助。同步主入口、使用指南、发布记录及三平台 Node 22/24 CI。Windows Node 24 源仓专项 14/14 通过（含 PS7/PS5.1 thin-index）；工具支持可控回调、事件记录和隔离旧缺陷反例，不定义业务完成策略。目标工程独立记录实际实现回归，源仓无业务数据。版本审计识别本次 0.2.2→0.3.0，无本次组件报错；完整审计仍受其它组件既有发布记录问题影响。非 Windows/Node22 CI 与真实设备验证沿用 P2 队列；未同步业务插件副本、提交或推送。

## 2026-10-09 提交 upstream 检查去重

coding-iris-plugin 0.15.2 在成功 pull 及快照校验后，仅向 commit 传入 hooks.requireUpToDate=false；其他全局检查保持，local-only 不设置。通过5项定向流程测试及2项既有消息测试。Windows 验证；macOS/Linux 待执行。未改安装器或全局钩子；插件入口与范围不变，能力手册无新增条目。

本轮工作区版本检查识别0.15.1→0.15.2，无本插件错误；完整检查仍被未改动组件的既有发布记录问题阻断，不宣称全仓通过。当前授权工程已定点同步实现及协议，未提交或发布。

## 2026-10-19 Feign 文档审计能力

imedicalxc-doctor-data-extraction 1.1.0 新增 `feign-api-doc-audit` skill 与 `feign-doc-audit.js`，覆盖已有 API 文档的服务地址、入参/出参类型、字段表、JSON 示例和格式基线检查。类型解析按 import、package、scope、module 顺序消歧；无显式类型的嵌套子表支持从父表行（如 `records`、`waitData`、`cureList`）推导类型。

真实文档与源码全量验证：`paths=0`、`fields=0`、`io=0`、`lint=0`；负向样例可检出错误地址与虚构字段。thin-index dry-run 已识别并生成两个 skill 入口；组件版本校验识别 1.0.0→1.1.0，本插件无报错，完整审计仍被 `imedicalxc-doctor-extend-engineer` 既有发布记录问题阻断。能力手册未收录该插件，沿既有 P2 补齐，不将未收录等同本轮已完成手册；未同步业务副本。实现已随 `fd95083` 提交，当前版本仍以 manifest 为准。
