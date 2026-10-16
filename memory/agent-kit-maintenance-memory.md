# imedical.agents 维护记忆入口

- bos-plugin 0.10.0：bos-demand-entry 默认代码，--work 显式工作记录（v3，代码 v2 兼容），目标/内容及可选预期成果或工作结果，不强制验收标准；编号只写草稿，无 Git 提交或自动来源写回。增加 --split 显式拆合审查，可与 --excel 组合，省略模式进入 --text；同一草稿渲染文本/Excel，共享文件限制保留。更新能力包并刷新已启用索引取得，真实 Agent 场景见既有 P2 队列。

- 2026-10-16 iris-agentic-dev vendor 已升级至 v1.5.0，官方资产摘要与本地版本一致；Windows helper/CLI/schema 验证通过，断连工具数仍为 70/81。既有 8 项 vendor skills 同步到 v1.5.0 固定提交，逐项 blob/许可证校验通过；响应兼容变化和业务副本更新步骤见 vendor/iris-agentic-dev/README.md，coding 插件 0.19.4 对齐响应契约，lookup 固定快照与发现专项在 PS7/PS5.1 通过；真实服务器/未分类工具审计仍在 P1 队列。

- MCP helper：tools/call 内置配置检查；按需使用 --names 与 --schema --json，规则见 coding-iris-plugin/rules/iris_agentic_dev.md。旧输出兼容，无跨会话缓存；本地 bundled schema 已实测，业务副本与非 Windows 验证分开。

- 需求迁移扫描按嵌套 Git/Agent 标记停止递归并报告 skippedWorkspaces，不按临时目录名称豁免；当前项目自定义链接仍冲突。独立工作区单独更新，见 docs/demand-delivery-migration.md。

- 夜跑决策策略：BOS 0.9 / coding 0.19 的新批次使用 2.1 单批次多仓 run、启动前集中授权和实际能力预检，受管部署/验收自动归档回执与分层计时；运行中异常分支挂起交接。旧 2.0 保持兼容；数据保留/重置/删除与资源退出分别核验。沿用两阶段评估、独立短审、13/30分钟复评、容量、三截止和20%/10%额度策略，不新增运行器。接口见 docs/night-policy.md；真实项目、三策略各三轮成本和跨平台/最低 Node 证据仍见日志与 backlog，源仓修改不代表副本升级。

- 阶段可用性依赖：BOS/Delivery 在 manifest 声明 availableDependencies，更新时提示、阶段执行前检查；保留强依赖 enabled 门禁及显式 disabled。入口为 docs/plugin-availability.md。

- 夜跑分层接入：`bos-demand-unattended` 复用单需求流程与现有证据；后端直接方法/实际接口分层，UI 延迟加载无头 Playwright。`run-acceptance.js`、Broker stdin 机器接口与项目适配见 docs/night-acceptance.md；本机合成链路已验证，真实项目及三平台矩阵待验，不启动批次或安装依赖。

- BOS 可重复验收与收尾：共享 testing-protocol 与 testing-runtime 已落地，项目适配认证/空闲心跳、版本与副作用；新编排 launch-result/v1 分开启动 ACK 和完成消费，修复事件 payload 别名污染。Windows 本地协议已验证；真实会话、业务接入与非本机矩阵仍待验证，不自动启用心跳或同步业务工程。

- 需求迁移外部编排：迁移器输出 stateChanges/enabledBefore/enabledAfter，更新器可用 ExpectedEnabledPlugin 校验预计完整集合；框架不读取私有注册表。Check 检查待迁移状态及已启用新 owner 的索引/实际源文件可达性，项目验证器仍负责注册表一致性，见 docs/demand-delivery-migration.md。

- 2026-10-14 HISUI：核心固定上游 `4c09319`（2026-10-12），26 个 Git 外分发资源单独固定摘要；coding-iris-plugin 0.17.1 同步控件/样式索引。源仓升级读取 vendor/hisui/AGENTS.md 与 maintenance/hisui-build/README.md；check/verify 只读，固定输入构建、完整性和回滚专项通过。真实 HIS/helper、已知资源缺项与非 Windows 矩阵分开验证；不自动改预览配置或同步业务工程。

- 2026-10-14 路由与预检修复：coding-iris 0.15.9、i18n 0.2.6；默认 direct 路由一致，verify 可重复且比较完整路径集合，更新/部署异常工作区前置停止，混合 CSP 按客户端区域与模板插值检查。验证范围见维护日志。

- Overlay 部署配置解析由 coding-iris-plugin/scripts/iris-tools/project-env.js 维护；模块本地优先、manifest.projectEnvFallback 显式回退，MCP 与源码边界仍归模块。

- 最近维护回看覆盖 `e964d0e..da28585`（2026-10-15）：需求交付拆分、BOS 查询/补录、HISUI 更新兼容、验收运行时与夜跑门禁；本轮补齐停止领新判据和 CI 路径覆盖，提交索引和验证范围见维护日志。
- `bos-plugin` 0.6.0：查询开放全部已声明字段，人员/组可切换口径；默认“我的待办”保留，旧空 cuser 的调用迁移及验证边界见 usage“查询参数契约”。需求处理的全部本地提交 verified 后，workflow 精确复用 repo/hash 自动准备代码日志计划，再复用明确 BOS 预授权或请求一次授权；失败保留本地提交，未知结果先核对，已确认成功不重复写入。个人配置沿用 BOS_MCP_CONFIG 的仓外文件，按 skill 分段、凭据独立，旧平铺格式仅显式 migrate-config 转换。处理时主动读取相关媒体；简单需求连续实施、自查和目标验证，IRIS 专项直达，正式协作条件加载。普通更新不修改个人配置或客户端；接入与配置核对见插件 usage/adoption，Windows 验证见维护日志，真实宿主/BOS 及非 Windows 矩阵分开取证。
- 编码规范：CLS 与前端分别以 coding-iris-plugin 的 `references/cls-coding-format.md`、`references/frontend-coding-format.md` 为事实源；只约束真正新增代码，原有代码的功能修改不附带格式化。注册类/DTO 与表类职责、成员标签、方法参数/返回结构及自然语言变量说明归 CLS 注释章节；非表类不填 Table，Param 按参数名区分，属性说明和索引注释按需，保留完整方法头/空参调试示例与历史兼容，Debug 不执行。由 Agent Review 核对，不新增文档生成器或脚本门禁。JS 页面组织模板可选，按实际容器能力选用；Review 对照修改前源码，不把 diff 的 + 行等同新增。
- 提交：成功 pull 后仅对 commit 临时关闭重复 upstream 检查，其余钩子保留；Junction/SourceRoot 物理归属及预授权规则见提交 skill。版本与功能证据按内容复用；已登记历史债务沿 backlog 处理，不重复阻断无关提交。
- 文档与能力手册：项目入口 `docs/README.md`，源仓入口 `maintenance/README.md`；非 xc 能力见 `docs/guides/capability-catalog.md`、`capability-guide.md`，xc 手册列入 P2。迁移与旧受管副本收敛见 `maintenance/governance/documentation-layout.md`。
- 项目上下文：Overlay 允许按需只读调查已声明或注册表映射的源码仓库，写入仍受 SourceRoot 和授权约束。初始化、事实维护、日常优化分别路由，普通更新不覆盖项目入口；知识库路由及旧入口迁移见 `docs/update-agents.md`。
- task-handoff：agent-context-kit 0.4.2 修复 Windows 长短路径身份判断；同机同工作区按需交接，正文与机器现场分离。当前 Codex 宿主的新会话接续于 2026-09-19 经用户验收，其它宿主仍待验证；见 `docs/task-handoff.md`。
- 需求交付：demand-delivery-plugin 0.5.0 的 demand-acceptance 明确调用即授权该批次通过项提交、BOS 日志及推送，无需交付开关；暂不交付等限制保留，自动加载/查询不产生授权，旧批次按原范围恢复。默认当前工作区，技能参数 --worktree [路径]（兼容 -worktree）明确变更来源；接续保留映射，连续接收人工结论、逐号交付与恢复；BOS 编号契约为单行升序去重、半角逗号无空格，数量在 text 块外。辅助索引可选、无远端执行；真实宿主与跨平台边界见维护日志。demand-commit 承接通用提交，bos-plugin 0.3.0 的 bos-demand-entry 承接补录。coding-iris-plugin 0.16.0 移除旧技能/CLI；更新器先验证新入口，再迁移项目 AGENTS、启用缺失 owner 和删除旧受管入口。显式状态或自定义内容冲突阻断；数据协议保留，见 docs/demand-delivery-migration.md。
- 纯 init 薄索引按 manifest 排除；enabled 常规 Write 精准清理旧受管入口，保留自定义文件、非空目录与链接。稀疏检出由根 JS helper 统一刷新并验证实际落盘；失败停止，不自动同步真实工程。

本文件只服务能力包源仓维护，不部署到业务项目，不生成 thin-index。规则以根 `AGENTS.md` 为准；本文件保留接手摘要，历史过程不作为当前状态。

## 当前状态

- 技能归属迁移：coding-agent-adaptation 归 agent-context-kit 0.3.2；反馈与打包归基础插件 agent-framework-evolution；当前 0.1.2 收紧共享经验四项准入，局部观察留项目内，无合格项正常结束。项目旧技能名由薄索引保持，历史原文按哈希安全转换，显式插件状态保留。详见 docs/skill-plugin-migration.md。

- 跨 Agent 项目技能接入采用链接优先：coding-agent-adaptation 与独立 JS 执行器支持 CodeBuddy/ClaudeCode/Codex，安装/更新显式选择；旧目录和错误链接不覆盖。详见 docs/coding-agent-adaptation.md，非 Windows 与更多宿主验证仍待补齐。

- 框架演进：guidanceMode 与风险/协作独立，IRIS 入口共用风险分流；新 run 默认 on-signal 反馈，session 通用 adapter 保留旧别名。写入 run 最终验证绑定 scope 指纹，完成与 --final 共用门禁。项目入口须定点迁移，真实模型/宿主收益见 maintenance/validation/agent-evolution.md，未宣称实测通过。

- 开发部署默认 direct，不要求需求号或 Git 会话，保留 Storage、并发变化、回读和编译检查。后端编译后整批核对并仅回填指定类的 Storage，本地源码只允许此例外；guarded 更新最近部署快照，回填失败分开报告远端编译与本地状态，夜跑源码指纹变化保持冻结版本复审门禁。显式 guarded 或旧 --demand 命令使用固定 Git 基线，服务器差异仅合入隔离产物；首次合并后再次覆盖、冲突、未知结果必须人工决定。状态保存在用户私有目录，更新基线保留历史。Question 使用固定 code 和工具无关协议，按能力降级为文本；暂停/查看/无效决定不写入。详见 coding-iris-plugin/references/deployment-protection.md。

- 能力源分为厂商无关的 `agents/`、`workflows/`、可复用 `plugins/` 与根级 `skills/`；工具专属配置只作为 adapter。源仓 `.agents/skills/agent-kit-maintenance/` 是维护者专用入口。
- 当前有 17 个插件、0 个根级独立 skill。插件版本以 manifest 为准，独立 skill 版本以 frontmatter 为准；内部内容继承 owner 版本。发布记录不可变且不部署，版本 validator 不接入业务安装/更新/hook。
- `coding-iris-plugin` 当前 v0.19.6：增加纯导入 Broker 客户端、严格 TLS/超时/授权与非交互 stdin 入口，旧人工 CLI 保留兼容；六个直接依赖 owner 仅扩大兼容范围并递增 patch。Windows 部署会话初始化对 Git 根目录长路径和 8.3 短路径按物理路径比较，既有会话状态不迁移；standard 需求录入使用简洁三段式与 v2 草稿，依赖兼容范围以各 owner manifest 为准。保留共享知识检索、项目菜单同步与产物路径门禁；前端 canonical 编码为 `utf8`，实际字节检测是最终门禁；真实 GB2312/mixed/unknown 不自动转码，明确 backend-only Overlay 为 `N/A (backend-only)`。新建类按 profile/同职责类/公共基类核对并适配 Extends，Review 检查继承依据；医生站注册类的指定继承要求归 doctor-dev 默认配置。CLS 共用清单检查提取后业务规则复用与稳定标识归属；Parameter 默认采用合法的 UpperCamelCase，可选自检提示非法声明及引用歧义，不替代 IRIS 编译；循环退出的 q 参数约束见规范后条件章节，由编码与 Review 核对，现有自检不作语法校验，不增加编译证据或提交门禁。
- CSP 编译固定到 `compile-csp.js` 的 Atelier 通道；`deploy-frontend.js` 的 direct/guarded 共用单连接传输、替换前复核、逐文件最终校验与完整结果，提供阶段进度/计数；保留 guarded 编译后检查，默认本地计划、显式执行，不自动重试或扩展父页面。竞争窗口、强杀恢复及耗时口径见工具 README；真实服务器性能仍待独立授权验证。SFTP vendor 新项目默认禁用，更新自动迁移可识别的既有标准启动参数，显式 custom/自定义参数保留，不创建服务或安装 Python 依赖。
- `iris-cure-form-dev`：当前版本和兼容范围以 owner manifest 为准；任务产物与运行态统一归目标项目 `docs/work/cure-form/<task>/`，快照/敏感证据归同任务 private；配置/规则仍在 `.agents/`。自动/手动部署与版本化克隆/显式原 RowID 覆盖分别选择。新模板不使用灰度，采用克隆的既有模板按引用拓扑收尾，原 ID 覆盖不调用 consolidate。显式旧输出路径保持兼容，不迁移既有备份。
- 表单部署的 `transaction-package` / `lightweight-sql` 通道独立于 automatic/manual；轻量通道只服务已有独占单模板 content。固定 SQL 绑定兼容层保留单行事务门禁，授权样本验证不代表全部服务器/HIS 验收。
- `imedicalxc-doctor-extend-engineer` 本轮修复版本 v1.0.1：电子健康卡子 skill 经主编排器架构门禁加载，不固定参照厂家，不自动回补既有厂家；映射按协议语义、方向和明确主映射取值。wrapper 只暴露主入口，旧受管子入口精准清理，自定义文件和链接保留。
- `iris-imedical-doctor-ai` 的当前版本和兼容范围以 owner manifest 为准，提供医生站 AI 开发方法、迁移行为对照和可控异步测试辅助，补齐入口分层、共享页面等价性、运行时接入、摘要检查及 UI/状态交互验证；工程、原型与接口按任务核实，菜单/wiki 按需使用 vendor 参考，项目菜单刷新复用 iris-menu-sync。其余插件职责与入口见仓库 README，不在本摘要重复目录清单。
- 通用 AGENT 框架仍为 beta。schema 2.0 用互斥 `taskKind` 分开业务验收与框架维护生命周期；旧 schema 1.0–1.2 只读。业务验收后才执行只读 feedback 审查，任何写入逐项授权；框架维护不触发或提示 feedback。
- standard 更新器只对落后状态 fast-forward，领先/分叉停止；普通 DryRun 可更新 capability，严格不更新用 Check 或 DryRun -NoPull。Overlay 区分 Workspace/Context/Capability/Source/GitRoot，共享 capability 只更新一次，不扩大源码/Git 边界。

- sparse 刷新统一由根 JavaScript helper 执行，参数输入绕过 PS5.1 UTF-8 BOM，校验规则覆盖文件实际落盘及 tracked `-text` 原始字节；bootstrap 从 HEAD 读取 helper。干净 checkout 的纯历史换行差异可安全收敛，自定义/二进制/链接差异保留并停止；Check、DryRun -NoPull 与 Overlay 只读，共享 capability 由所属 standard 项目修复。无业务副本自动同步。

## 必读路由

- 仓库维护：`.agents/skills/agent-kit-maintenance/SKILL.md`；按影响面选择验证，脚本变更核对平台矩阵，项目集成测试在目标工程执行，清理先确认任务归属，提交沿用明确授权。
- 长期决策：`agent-kit-maintenance-decisions.md`；近期提交与验证：`agent-kit-maintenance-log.md`；未完成事项：`agent-kit-maintenance-backlog.md`。
- 安装、更新、vendor、sparse 或 thin-index：`docs/update-agents.md` 与相关 canonical 脚本；plugin thin-index 只修改根生成器，插件脚本只转发。
- 插件变更：owner AGENTS、README、manifest、相关内容、专项测试及 `maintenance/governance/component-version-management.md`。
- Agent/workflow：`memory/plan/multi-agent-architecture.md`、两份 registry、共享协议及相关定义。
- 业务项目上下文：目标项目自己的入口与 `project-context-maintenance`，不用维护者记忆代替项目记忆。

## 当前治理重点

- 多人提交准入与通用结构检查；三类真实 AGENT 样本、五个简单 iris-coding 样本仍待验证。
- 非 Windows CI、真实 HIS/移动 WebView/PAD 与业务副本同步按具体任务取证；矩阵声明、源仓提交不等于平台验证或副本生效。
- 已完成事项移入维护日志；长期约束进入 decisions；本摘要合并替换过期状态，不无限追加历史版本。

- 知识库入口：agent-context-kit 0.3.5 在初始化/授权维护时按启用状态定点合并工程 AGENTS 简短路由；coding-iris-plugin 0.13.1 由模型自主选择查询。普通能力包更新不覆盖业务入口，迁移见 docs/update-agents.md。
