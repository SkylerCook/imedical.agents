# imedical.agents 维护日志

本文件记录近期维护流水摘要和验证结论。长期决策见 `agent-kit-maintenance-decisions.md`，后续治理队列见 `agent-kit-maintenance-backlog.md`，入口摘要见 `agent-kit-maintenance-memory.md`。

## 近期已完成

- 已新增多智能体架构设计 `memory/plan/multi-agent-architecture.md`，明确厂商无关 canonical `agents/` / `workflows/`、工具 adapter 边界、模型档位、生成层、本地定制、版本演进和新增智能体 checklist。
- 已新增顶层 `agents/` 与 `workflows/` 首批 canonical 样板：`agents/agent-registry.md`、`agents/_shared/handoff-protocol.md`、`agents/i18n-agent/AGENT.md`、`agents/i18n-agent/bindings.yaml`、`workflows/workflow-registry.md`、`workflows/i18n-change.workflow.md`。
- 已新增交接报告模板：事实报告、分类清单、变更摘要、验证报告，用于阶段化或多智能体交接。
- 已将 `i18n-workflow-decompose.md` 的五阶段愿景落地为 `i18n-agent` 和 `i18n-change.workflow.md` 样板，阶段为 Explorer、Classifier、Coder、Template/Seed、Verifier。
- 已明确 `agents/` 和 `workflows/` 是能力包正式内容，不属于 `.agents/.git/info/exclude` 生成层；后续需要纳入安装/更新脚本 sparse checkout。
- 已新增 coding 插件统一编码入口 `iris-coding`，并同步更新插件入口、README、目标工程 snippet 和 manifest prompt；后端、前端和 GB2312 promote 专项 skill 保持兼容。
- 已新建 i18n 链路定位规则 `rules/i18n_link_tracing.md`、数据分类规则 `rules/i18n_field_classification.md`、验证规则 `rules/i18n_verify.md`，补全五阶段工作流的规则缺口。
- 已更新 `i18n-coding` skill 为阶段化入口，新增阶段化执行引导和必读规则引用，并在产出段落增加需求完成后的经验沉淀引导。
- 已优化 `docs/demand-com-exp.md`：新增领域标签和需求索引维护规则，在文档末尾追加需求索引章节，支持锚点跳转。
- 已修正 `i18n_coding_print_backend.md` 入口措辞，从"打印 JSON"收敛为"实际打印返回数据"，并引用链路定位规则。
- 已补充 `i18n-xml-print-template-sync` 的触发前置约束：必须先通过链路定位确认存在 XML 模板记录。
- 已补齐 `i18n-iris-plugin/AGENTS.md` 的 Skill 路由和规则入口。
- 已在 `docs/demand-com-exp.md` 中标记被提升的经验条目和反哺规则。
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

## 近期提交索引

- `02d7e84`：新增 AI Coding 外骨骼架构可视化页面。
- `d61ea96`：将架构可视化页面重命名为根目录 `index.html`。
- `c2281ef`：新增 GitHub Pages workflow 和 `.nojekyll`。
- `4956e7b`：启用 GitHub Pages 权限。
- `95e596b`：README 补充双远端同步说明。
- `1cc1ac7`：新增统一更新脚本 `scripts/update-agents.ps1`。
- `6ae4277`：新增托管更新 runbook 和 `update-agents` 摘要视图。
- `0a932d7`：收敛唯一主入口、可选兼容入口和 stale thin-index 清理。

## 最近验证

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

## 维护要求

- 后续完成每轮维护后，更新本文件的近期已完成、提交索引和最近验证摘要。
- 不记录一次性命令输出、短期失败日志或可从 Git 历史直接恢复的完整流水。
