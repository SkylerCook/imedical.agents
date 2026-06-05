# imedical.agents 长期维护决策

本文件记录 `imedical.agents` 能力包仓库的长期决策和稳定边界。当前状态摘要见 `agent-kit-maintenance-memory.md`，近期维护流水见 `agent-kit-maintenance-log.md`，后续计划见 `agent-kit-maintenance-backlog.md`。

## 内容分层

- `rules/` 只放长期约束、工作流规则和任务路由，不放大体量查找表、API 目录或源码索引。
- `references/` 放按需查阅的参考资料，例如查找表、控件/API 目录和源码索引；默认不参与 rule thin-index 生成。
- `skills/` 负责任务流程编排，必要时按任务类型读取对应 rules 或 references。
- `scripts/` 放可复用自动化；插件专属脚本放在对应插件目录，不复制到共享脚本目录，除非插件初始化流程明确要求。
- 维护记忆只写摘要、状态、决策和下一步，不复制完整规则、长段脚本说明或一次性命令输出。

## 命名约定

- skill 目录使用 kebab-case。
- rule 文件使用 snake_case。
- reference 文件使用 kebab-case。
- script 文件使用 kebab-case。
- 历史文件不为风格统一单独重命名；只有在明确迁移窗口中才同步 thin-index stale 清理、README、AGENTS 和 skill 引用。

## Thin-Index 决策

- thin-index 生成逻辑只维护根 `scripts/generate-plugin-thin-index.ps1`。
- 各插件同名脚本只能作为 wrapper 转发参数，避免插件之间产生运行时依赖和脚本副本漂移。
- stale 清理只应删除由插件生成、且源文件已失效的 thin-index；不得删除业务项目自定义 `.agents/rules/`。
- 独立分发单个插件时，若仍使用 `plugin-reference-thin-index`，必须同时带上根 canonical 脚本，否则选择 `copy` 或手工 thin-index。

## 部署边界

- 已部署业务工程的 `.agents/` 是独立能力包仓库；能力包更新后应先更新 `.agents`，再按启用插件重建 thin-index。
- 根目录 `memory/` 是维护者记忆，不得加入 `scripts/install-agents.ps1` 或 `scripts/update-agents.ps1` 的 sparse checkout 路径。
- 根目录 `AGENTS.md` 只服务本仓库维护，不部署到业务项目 `.agents/`。
- 根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务展示页和 GitHub Pages，不部署到业务项目 `.agents/`。
- `scripts/tests/` 只服务能力包仓库自测，不部署到业务项目 `.agents/`。
- `.agents/.git/info/exclude` 应继续忽略 `/config/`、`/memory/`、`/rules/`、`/skills/` 和 `/scripts/` 这些本地生成层。
- 对手工 full clone 到 `.agents/` 的工程，必须重新执行安装脚本启用 sparse checkout；仅靠 `.git/info/exclude` 不能隐藏已跟踪的维护者记忆文件。

## 入口决策

- `AGENTS.md` 是工程级唯一主入口，必须存在。
- `CLAUDE.md`、`CODEBUDDY.md` 是可选兼容入口；如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 安装和更新脚本只报告兼容入口状态，不自动创建、复制或修复兼容入口。
- 禁止把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`，也禁止在兼容入口维护第二份规则。

## 跨插件一致性

- 修改插件目录结构时，同步检查 `.agents-plugin/plugin.json`、插件 `AGENTS.md`、插件 README、仓库 README 和相关 docs。
- 任何新规则都要先判断是否应放入 `rules/`、`references/`、`skills/`、`templates/` 或 `scripts/`。
- 如需重命名历史 rule/skill/reference，必须同步 thin-index stale 清理、README、AGENTS、skills 引用和已部署工程兼容说明。
- 对已部署工程有影响的变更，必须在 README 或插件 README 中说明同步步骤和兼容清理策略。

## 安全边界

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不把业务项目私有事实写入本仓库插件、规则或记忆。
- `.mcp.json` 是连接事实来源；不要把其中的 host、账号、密码、token、namespace 或远程路径复制到 rules、memory、config 或插件。
