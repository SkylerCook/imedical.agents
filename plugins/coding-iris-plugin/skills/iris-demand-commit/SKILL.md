---
name: iris-demand-commit
description: Use after an IRIS standard or project demand is implemented and verified to prepare repository-specific commit messages, enforce the standard-demand pull gate, and commit only after explicit user authorization.
---

# IRIS Demand Commit

本 skill 只有在用户明确要求提交或确认正式提交计划时加载。commit 可以在 `acceptance-pending` 阶段独立执行，但不得把生命周期推进到 `accepted`，也不得触发 feedback 审查或写入。

## 使用时机

当 IRIS 编码需求已经完成本地修改和必要验证，需要生成或执行 Git 提交时使用本 Skill。它同时支持：

- `standard`：标版、标准版或通用产品需求。
- `project`：医院项目、客户定制或项目实施需求。

“处理需求”“修复问题”“执行方案”不包含提交授权。只有用户在当前任务中明确要求“提交”或 `commit`，才允许进入 `apply`。`push`、部署、上传和远程编译始终需要独立授权。

## 必读上下文

1. 目标工程 `AGENTS.md`。
2. `.agents/config/iris_project_profile.md`。
3. `iris-coding` 已确认的需求号、需求标题、需求描述、修改文件和验证结果。
4. 各修改文件所属 Git 仓库的 `AGENTS.md` 与提交约束。

## 需求类型

按以下优先级确定当前需求类型：

1. 用户对当前需求明确指定的 `standard` 或 `project`。
2. `iris_project_profile.md` 中合法的“默认需求交付类型”。
3. 若字段为 `TODO`、缺失或非法，暂停提交并提示：

```text
默认需求交付类型仍为 TODO，请确认该工程默认处理 standard（标版）还是 project（项目）需求。
```

用户回答的是当前需求类型时，只用于本次计划；用户确认的是工程默认类型时，更新 profile 后再继续。不得根据目录名、`contextMode`、remote、upstream 或代码量猜测类型。

## 修改说明质量

“修改说明”必须基于需求方案和实际 diff，至少说明：

- 修改对象或用户可见问题。
- 采用的关键实现或交互方案。
- 方案带来的行为结果。

禁止只写“优化功能”“修复问题”“调整代码”“修改逻辑”“完善页面”等泛化内容，也不要只罗列文件名。多仓库需求必须分别归纳每个仓库承担的方案。

用户已经提供修改说明时优先保留；若它与实际 diff 或验收结果矛盾，停止并请用户确认，不得静默改写。例如：

```text
修改说明:优化模板内容必填提示，使用必填标识替代易被弹窗边界裁切的校验气泡，并在空内容保存提示关闭后聚焦模板内容输入框
```

## 提交格式

标版需求使用三行格式：

```text
<type>(<requirement-id>):<简短菜单或功能摘要>
修改说明:<方案型修改说明>
需求描述:<requirement-id> <完整需求标题>
```

标版首行优先使用用户可识别的菜单名或“菜单-功能”摘要，保持简短，不重复完整需求标题；完整原始需求只放在 `需求描述`。例如首行使用 `fix(7060431):口腔技工单-模板维护`，而不是复制包含操作步骤和报错现象的长需求标题。

项目需求使用两行格式：

```text
<type>(<requirement-id>):<完整需求标题>
修改说明:<方案型修改说明>
```

用户指定的 `type` 优先；否则按实际变更选择：新增能力用 `feat`，修复缺陷用 `fix`，无行为变化的结构调整用 `refactor`，纯文档用 `docs`，构建或配置维护用 `chore`。一个计划只处理一个需求号；独立需求不得合并提交。

## 仓库与文件边界

- 以本次需求明确修改的文件为输入，通过文件路径解析 GitRoot。
- 可处理 WorkspaceRoot 内的根仓、初始化 submodule，以及 workspace-overlay manifest 明确声明的 GitRoot。
- 不扫描父目录或无关 sibling 仓库。
- 同一仓库只提交本次需求的精确路径；同一文件混有其它需求修改时停止，不能按整文件提交。
- 保留所有计划外 staged、unstaged 和 untracked 修改，不使用 `reset` 或隐式清理。

## 三阶段流程

### 1. Plan

调用提交脚本生成计划。必须传入需求文件；多仓库时为每个仓库提供独立修改说明。

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/commit-demand.js plan `
  --project-root <workspace-root> `
  --kind <standard|project> `
  --demand <requirement-id> `
  --subject <简短菜单或功能摘要> `
  --title <完整需求标题> `
  --type <type> `
  --file <path> `
  --modification <repo-root>::<方案型修改说明>
```

单仓库时 `--modification` 可以只传说明正文。计划记录仓库 HEAD、branch、upstream、精确文件、状态/diff 指纹和拟用消息，并带完整性摘要，保存在系统临时目录。不得手工编辑或伪造计划；任何漂移都必须重新 plan。向用户展示每个仓库的文件与完整提交信息；用户尚未授权 commit 时明确询问，当前请求已经明确要求“提交/commit”时不重复暂停确认，plan 成功后直接进入 apply。

### 2. Apply

只有已取得明确提交授权时执行：

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/commit-demand.js apply `
  --plan <plan.json> `
  --confirm-commit `
  --verify
```

`--verify` 在同一进程内完成提交后校验；仍保留独立 `verify` 命令用于恢复或复核。普通业务需求只运行 `plan`、获授权的 `apply --verify` 和必要业务检查，不运行本 Skill 的专项测试；只有修改 Skill 或提交脚本本身时才运行专项测试。

普通提交以 2 分钟为执行上限，主要时间只允许消耗在一次必要的 `git pull --ff-only`。脚本单轮达到上限必须停止并报告当前 Git 卡点，不得继续叠加多个 60 秒等待；Agent 也不得为了 Skill 自测延迟业务提交。

脚本先预检所有仓库，再执行 pull 门禁：

- `standard`：每个仓库必须存在 upstream，并执行 `git pull --ff-only`。
- `project`：存在 upstream 时执行 `git pull --ff-only`；没有 upstream 时记录 `local-only` 并允许本地提交。
- 禁止自动 `stash`、`rebase`、merge、reset 或丢弃修改。
- pull 失败、分支分叉或标版仓库缺少 upstream 时停止。
- 任一 pull 改变 HEAD 时，本轮不得创建任何 commit；重新 plan、展示新 diff 和消息并再次取得用户确认。

pull 门禁全部通过后，脚本只暂存和提交计划内路径。多仓库先完成全部 pull，再逐仓 commit；若 hook 等原因造成部分成功，必须逐仓报告，不得伪装为原子成功。

### 3. Verify

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/commit-demand.js verify --plan <plan.json>
```

核对每个计划仓库的 commit、完整消息和提交文件集合，并报告计划外工作区状态。Verify 通过只证明本地提交完成，不代表已 push 或部署。

## 完成输出

- 当前需求类型及其来源。
- 每个仓库的完整提交信息、精确文件和 pull 结果。
- 用户是否授权 commit。
- 本地 commit hash 或停止原因。
- 仍保留的计划外修改。
- 明确说明未执行 push、部署、上传或远程编译。
