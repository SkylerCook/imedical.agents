# imedical.agents 维护记忆

本文件记录 `imedical.agents` 能力包仓库的长期维护状态，帮助后续 Agent 快速接手。它不是业务项目 `.agents/memory/project-memory.md`，不部署到业务项目，不生成 thin-index。

## 当前状态

- 本仓库维护可复用 Agent 能力包，核心内容包括 `plugins/`、`skills/`、`rules/`、`docs/`、`scripts/` 和 `memory/`。
- `plugins/agent-context-kit/` 负责项目上下文维护，包括 AGENTS 入口、项目规则、项目记忆、项目配置和 thin-index。
- `plugins/coding-iris-plugin/` 负责 IRIS/ObjectScript/CSP/JavaScript/HISUI 编码能力。
- `plugins/i18n-iris-plugin/` 负责 IRIS/ObjectScript/CSP/HISUI 国际化能力。
- 当前重点维护方向是降低 rules 常驻上下文成本，明确 `rules/`、`references/`、`skills/`、`scripts/` 的职责边界。

## 已确认长期决策

- `rules/` 只放长期约束、工作流规则和任务路由，不放大体量查找表、API 目录或源码索引。
- `references/` 放按需查阅的参考资料，例如查找表、控件/API 目录和源码索引；默认不参与 rule thin-index 生成。
- `skills/` 负责任务流程编排，必要时按任务类型读取对应 rules 或 references。
- `scripts/` 放可复用自动化；插件专属脚本放在对应插件目录，不复制到共享脚本目录，除非插件初始化流程明确要求。
- 已部署业务工程的 `.agents/` 是独立能力包仓库；能力包更新后应先更新 `.agents`，再按启用插件重建 thin-index。
- 维护记忆只写摘要、状态、决策和下一步，不复制完整规则、长段脚本说明或一次性命令输出。

## 近期已完成

- 已将 coding 插件的 HISUI 控件索引从 rule 层迁移为 `references/hisui-widget-index.md`。
- 已更新 coding 插件入口、README、前端 coding skill 和规则索引，使 HISUI 控件参考只在控件选型或 API 不确定时按需读取。
- 已在 coding 插件 manifest 中声明 `references: references/`。
- 已增强 coding 插件 thin-index 脚本：重建时可识别并清理由本插件旧版本生成、但源文件已从 `rules/` 移走的 stale rule thin-index。
- 已在仓库 README 和 coding 插件 README 中补充已部署 `.agents` 的同步说明。
- 已拆分 `iris_coding_workflow.md`，新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md`，降低非部署任务加载成本。
- 已精简 `sftp-server.md` 的通用部署重复内容，并精简 `i18n_index.md` 的总原则。
- 已在 workspace kit 文档和 reusable packaging skill 中补充插件内 `references/` 约定。

## 下一步工作队列

1. 同步 thin-index 生成脚本行为。
   - 先判断 `plugins/agent-context-kit/scripts/generate-plugin-thin-index.ps1` 是否应成为 canonical 版本。
   - 再同步 stale rule thin-index 清理和未来 frontmatter 传播能力到 coding、i18n 插件副本。
   - 完成后立即进入 frontmatter/task-affinity，不再穿插新的大规模 rules 拆分，除非用户明确调整优先级。
2. frontmatter/task-affinity 是紧随其后的下一轮治理项。
   - 排序：必须在 thin-index canonical 行为统一、stale 清理策略同步到各插件脚本之后执行。
   - 内容：为 rule/reference 文件补充最小 frontmatter，并让 thin-index 传播任务亲和元数据。
   - 禁止：不要在 canonical 脚本统一前批量添加 metadata，避免三份脚本各自漂移。
3. 继续观察 rules 体量。
   - 若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。

## 跨插件一致性注意事项

- 修改 thin-index 生成行为时，先判断是否应从 `plugins/agent-context-kit/scripts/generate-plugin-thin-index.ps1` 形成 canonical 版本，再同步到 coding 和 i18n 插件脚本。
- 修改插件目录结构时，同步检查 `.agents-plugin/plugin.json`、插件 `AGENTS.md`、插件 README、仓库 README 和相关 docs。
- 任何新规则都要先判断是否应放入 `rules/`、`references/`、`skills/`、`templates/` 或 `scripts/`。
- 对已部署工程有影响的变更，必须在 README 或插件 README 中说明同步步骤和兼容清理策略。

## 已部署 .agents 同步注意事项

- 已部署业务工程应在业务项目根目录重新执行能力包部署脚本，让 `.agents/` 独立仓库拉取最新内容。
- 对启用的插件运行对应 `generate-plugin-thin-index.ps1 -Mode Write -Force` 重建浅层入口。
- stale 清理只应删除由插件生成、且源文件已失效的 thin-index；不得删除业务项目自定义 `.agents/rules/`。
- `.agents/.git/info/exclude` 应继续忽略 `/config/`、`/memory/`、`/rules/`、`/skills/` 和 `/scripts/` 这些本地生成层。
- 根目录 `memory/` 是维护者记忆，不得加入 `scripts/install-agents.ps1` 的 sparse checkout 路径。对手工 full clone 到 `.agents/` 的工程，必须重新执行安装脚本启用 sparse checkout；仅靠 `.git/info/exclude` 不能隐藏已跟踪的维护者记忆文件。

## 禁止写入内容

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不写完整 rules 正文、长段脚本说明、大段命令输出或一次性排障日志。
- 不把业务项目私有事实写入本仓库插件、规则或记忆。
- 不把短期待办无限追加到 memory；完成后应合并、替换或删除过期条目。

## 最近验证

- coding 插件 thin-index dry-run 已确认不再生成 HISUI 控件索引的 rule 入口。
- 构造旧版 HISUI rule thin-index 后，coding 插件脚本 dry-run 可标记 `stale`，Write 模式可移除旧入口。
- 搜索旧 HISUI rule 路径已无残留引用。
- coding 插件 thin-index dry-run 已确认新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md` 规则入口。
- 搜索确认 `references/` 规范已写入 workspace kit 文档和 reusable packaging skill。
- 后续完成每轮维护后，应更新本文件的近期已完成、下一步工作队列和最近验证摘要。
