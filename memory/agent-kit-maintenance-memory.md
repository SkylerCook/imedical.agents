# imedical.agents 维护记忆入口

- Overlay 读写范围分离：agent-context-kit 0.4.1 / coding-iris-plugin 0.13.7 允许按需只读调查已声明或项目注册表映射的源码仓库；默认写入仍受 SourceRoot 和任务授权约束。路径解析、工具写入门禁与 backend-only 身份不变；旧模块入口需授权定点迁移，见 docs/workspace-overlay.md。

- 文档分发已分层：docs/README.md 为项目入口，maintenance/README.md 为仅源仓入口；31 项路径迁移与旧工程收敛规则见 maintenance/governance/documentation-layout.md。旧受管文件随 Git 更新删除，私有残留保留、dirty 停止；不自动同步真实工程。

- 非 xc 能力目录与使用指南：docs/guides/capability-catalog.md、docs/guides/capability-guide.md，覆盖插件、skill、rule、接入和逐技能示例；README 提供入口。清单与行为变更同步核对，xc 手册列入 backlog P2；不改变插件、版本或部署行为。

- IRIS 编码入口按明确专项直达、混合/边界不明路由；部署基线前移，i18n 条件矩阵由前端规则维护。契约测试核对引用与执行时点，真实提效仍按既有基准验证。信创内容不在本轮变更范围。

- 纯 init 薄索引：7 个插件通过 manifest 统一排除，enabled 项目常规 Write 精准清理旧受管入口及历史遗留空目录，非空目录和链接保留；真实 init 和日常入口保留，available/disabled 不变。迁移见 docs/update-agents.md。

- agent-context-kit 0.4.0 新增 task-handoff：同机同工作区需求按需启用、关键节点维护；docs/handoff 本地保存，正文与机器现场分离，明确交接追加历史快照。直接接手不检查旧会话，用户避免并发写入。普通需求不建正式 run；当前 Codex 宿主的真实新会话接续已于 2026-09-19 经用户验收通过，其它 Agent 宿主和平台矩阵仍待验证；接入与验证见 docs/task-handoff.md。

- 提交性能：`validate --staged` 只校验暂存组件与直接依赖，批量读取 Git 对象并独立缓存版本证据；功能证据按实际内容复用，不绑定 HEAD。信创 1.0.2 缺少 commit 已登记为 `version-debt-xc-1.0.2-commit`，用户要求后续普通提交不重复处理或提醒；见 backlog 与 maintenance/governance/component-version-management.md。

- project-context-maintenance 区分初始化、事实维护和日常优化；去重保留约束，初始化与优化资料按需读取，普通维护不自动接入插件。模板与旧项目迁移说明已对齐，业务副本不自动同步。

- 标版需求闭环 iris-demand-entry，用户模式 --text/--bind/--plan/--commit/--help：实际 Git 补丁 → 默认文本/可选 Excel → 用户录 BOSS → 编号回填 → 复用需求提交。四个写入入口拒绝 `.agents/`、能力包源码及目录链接别名，旧输入可只读迁出；历史提交不自动改写，工作区漂移需复核。协议见 coding-iris-plugin/references/standard-demand-entry.md。

- 实测迁移修复：agent-context-kit 0.3.1 的 guidanceMode 缺省不落盘，显式值保留；迁移脚本补齐缺失辅助协议路由。普通更新与显式入口迁移仍分开。

- 治疗表单入口补充优化：按任务加载交付章节，复用范围内已有明确部署授权；服务端原子回滚与客户端 rollback 分开表达，运行时门禁不变。

本文件只服务能力包源仓维护，不部署到业务项目，不生成 thin-index。规则以根 `AGENTS.md` 为准；本文件保留接手摘要，历史过程不作为当前状态。

## 当前状态

- 技能归属迁移：coding-agent-adaptation 归 agent-context-kit 0.3.2；反馈与打包归基础插件 agent-framework-evolution；当前 0.1.2 收紧共享经验四项准入，局部观察留项目内，无合格项正常结束。项目旧技能名由薄索引保持，历史原文按哈希安全转换，显式插件状态保留。详见 docs/skill-plugin-migration.md。

- 跨 Agent 项目技能接入采用链接优先：coding-agent-adaptation 与独立 JS 执行器支持 CodeBuddy/ClaudeCode/Codex，安装/更新显式选择；旧目录和错误链接不覆盖。详见 docs/coding-agent-adaptation.md，非 Windows 与更多宿主验证仍待补齐。

- 框架演进：guidanceMode 与风险/协作独立，IRIS 入口共用风险分流；新 run 默认 on-signal 反馈，session 通用 adapter 保留旧别名。写入 run 最终验证绑定 scope 指纹，完成与 --final 共用门禁。项目入口须定点迁移，真实模型/宿主收益见 maintenance/validation/agent-evolution.md，未宣称实测通过。

- 部署保护固定 Git 基线，服务器差异仅合入隔离产物；首次合并后再次覆盖、冲突、未知结果必须人工决定。状态保存在用户私有目录，更新基线保留历史。Question 使用固定 code 和工具无关协议，按能力降级为文本；暂停/查看/无效决定不写入。详见 coding-iris-plugin/references/deployment-protection.md。

- 能力源分为厂商无关的 `agents/`、`workflows/`、可复用 `plugins/` 与根级 `skills/`；工具专属配置只作为 adapter。源仓 `.agents/skills/agent-kit-maintenance/` 是维护者专用入口。
- 当前有 15 个插件、0 个根级独立 skill。插件版本以 manifest 为准，独立 skill 版本以 frontmatter 为准；内部内容继承 owner 版本。发布记录不可变且不部署，版本 validator 不接入业务安装/更新/hook。
- `coding-iris-plugin` 当前 v0.13.6：保留共享知识检索、项目菜单同步及部署兼容；standard 需求录入输出增加路径硬门禁；前端 canonical 编码为 `utf8`，实际字节检测是最终门禁；真实 GB2312/mixed/unknown 不自动转码，明确 backend-only Overlay 为 `N/A (backend-only)`。CLS 仅提供最小改动提示与可选自检，不增加编译证据或提交门禁。
- CSP 编译固定到 `compile-csp.js` 的 Atelier 通道；`deploy-frontend.js` 统一上传、哈希回读与指定 CSP 编译，默认本地计划、显式执行，不自动重试或扩展父页面。SFTP vendor 新项目默认禁用，更新自动迁移可识别的既有标准启动参数，显式 custom/自定义参数保留，不创建服务或安装 Python 依赖。
- `iris-cure-form-dev` 当前 v0.7.7：兼容 coding-iris-plugin 0.13；任务产物与运行态统一归目标项目 `docs/work/cure-form/<task>/`，快照/敏感证据归同任务 private；配置/规则仍在 `.agents/`。自动/手动部署与版本化克隆/显式原 RowID 覆盖分别选择。新模板不使用灰度，采用克隆的既有模板按引用拓扑收尾，原 ID 覆盖不调用 consolidate。显式旧输出路径保持兼容，不迁移既有备份。
- 表单部署的 `transaction-package` / `lightweight-sql` 通道独立于 automatic/manual；轻量通道只服务已有独占单模板 content。固定 SQL 绑定兼容层保留单行事务门禁，授权样本验证不代表全部服务器/HIS 验收。
- `imedicalxc-doctor-extend-engineer` 本轮修复版本 v1.0.1：电子健康卡子 skill 经主编排器架构门禁加载，不固定参照厂家，不自动回补既有厂家；映射按协议语义、方向和明确主映射取值。wrapper 只暴露主入口，旧受管子入口精准清理，自定义文件和链接保留。
- `iris-imedical-doctor-ai` v0.3.0 依赖 coding-iris-plugin 0.13，提供医生站 AI 开发方法、迁移行为对照和可控异步测试辅助，补齐入口分层、共享页面等价性、运行时接入、摘要检查及 UI/状态交互验证；工程、原型与接口按任务核实，菜单/wiki 按需使用 vendor 参考，项目菜单刷新复用 iris-menu-sync。其余插件职责与入口见仓库 README，不在本摘要重复目录清单。
- 通用 AGENT 框架仍为 beta。schema 2.0 用互斥 `taskKind` 分开业务验收与框架维护生命周期；旧 schema 1.0–1.2 只读。业务验收后才执行只读 feedback 审查，任何写入逐项授权；框架维护不触发或提示 feedback。
- standard 更新器只对落后状态 fast-forward，领先/分叉停止；普通 DryRun 可更新 capability，严格不更新用 Check 或 DryRun -NoPull。Overlay 区分 Workspace/Context/Capability/Source/GitRoot，共享 capability 只更新一次，不扩大源码/Git 边界。

- sparse 刷新统一由根 JavaScript helper 执行，参数输入绕过 PS5.1 UTF-8 BOM，校验 index 中规则覆盖文件实际落盘；bootstrap 从 HEAD 读取 helper，失败停止。无业务副本自动同步。

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
