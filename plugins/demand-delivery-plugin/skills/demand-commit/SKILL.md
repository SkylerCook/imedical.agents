---
name: demand-commit
description: Use after a standard or project demand is implemented and verified. Supports explicit --plan/-plan to generate repository-specific commit messages without committing, and --commit/-commit to create verified local commits after authorization; push remains separate.
---

# Demand Commit

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

本 skill 在用户要求生成提交信息、直接提交，或显式调用 `$demand-commit --plan|--commit` 时加载。commit 可以在 `acceptance-pending` 阶段独立执行，但不得把生命周期推进到 `accepted`，也不得触发 feedback 审查或写入。

适用于采用数字需求号及本技能 standard/project 提交格式的项目。项目提交规范与本格式冲突时先按项目规范处理，不强套此格式；不需要 IRIS、BOS 连接或领域初始化。新入口按项目 plugin profile 接入 demand-delivery-plugin；旧入口已移除，已部署项目由更新器迁移。

连续人工验收、多条交付排队或批次恢复时，由 [demand-acceptance](../demand-acceptance/SKILL.md) 接收结论与协调；本技能仍独立执行单号计划与提交。

## 使用时机

当编码需求已经完成本地修改和必要验证，需要生成或执行 Git 提交时使用本 Skill。它同时支持：

- `standard`：标版、标准版或通用产品需求。
- `project`：客户定制或项目实施需求。

“处理需求”“修复问题”“执行方案”不包含提交授权。用户明确要求“提交”或 `commit`，或具备下文“预先授权与裸调用”的有效授权，才允许进入 `apply`。本技能不授予 `push`、部署、上传或远程编译权限；这些动作复用已有明确授权或另行取得授权。

## 调用模式

支持自然语言意图和显式参数两种入口。显式参数优先于自然语言；单横线作为兼容别名，执行前统一规范化为双横线：

```text
$demand-commit --plan
$demand-commit --commit
```

- `--plan` / `-plan`：只生成提交计划和每个仓库的完整 commit message。只运行 `plan`，不得执行 `pull`、`git add`、`git commit` 或 `verify`，不得继续询问是否提交；完成时明确报告“未创建本地 commit”。
- `--commit` / `-commit`：视为用户对本次精确文件范围的本地 commit 明确授权。先运行 `plan` 并展示结果，再直接运行 `apply --confirm-commit --verify`，不得重复询问；该授权不包含 push。
- 未提供参数时，根据用户当前请求判断：只要求“生成提交信息”“生成 commit”“查看 commit message”时进入 `--plan`；明确要求“提交”“直接提交”或 `commit` 时进入 `--commit`。
- 同时出现两种模式、出现未知模式，或显式参数与自然语言意图冲突时停止，展示上述两种合法用法，不猜测执行模式。

调用参数只决定是否创建本地 commit，不改变 `standard/project` 需求类型、文件边界、pull 门禁和独立 push 授权。

## 预先授权与裸调用

用户已明确“处理并在验收后提交”时，保留原话、需求和已确认范围；用户验收通过后视为本需求的 --commit 授权，复用已有事实与有效证据，展示计划后直接 Apply。验收尚未发生则等待验收，不提前提交。上游无交集且本需求内容未变时，按[同步复核与自动接续协议](../../references/commit-upstream-check.md#head-前进后的自动接续)沿用已有授权；范围扩大、需要人工重新验收或业务取舍时再请用户决定。

由 [demand-acceptance](../demand-acceptance/SKILL.md) 转入时，复用其已确认的批次调用授权：本需求人工通过后展示计划并直接 Apply，不要求用户补说“提交”或添加 --commit；push 和 BOS 仍由验收技能协调。

没有有效预授权时，单独“验收通过”不授权提交。裸调用本技能且上下文没有明确模式或有效提交授权时，只说明“--plan 生成提交信息；--commit 创建本地提交”，一次请求选择；不先承诺提交、不执行 pull/add/commit。明确 --plan 仍按其既有规则结束，不追问提交。来自 BOS 流程的编号、标题、精确文件和每仓修改说明直接复用；发生漂移时定向重查。

## 必读上下文

转入 BOS 标版补录前，按[可用性依赖协议](../../../../docs/plugin-availability.md)检查 demand-delivery-plugin 的 bos-demand-entry 阶段；普通提交不触发此检查。

项目使用 BOS，标版代码已完成但尚无 BOSS 需求号时，用户要求补需求/闭环则先使用 `../../../bos-plugin/skills/bos-demand-entry/SKILL.md`：默认需求文本，可选 `--excel` / `--Excel`，由用户录入 BOSS。回填编号后复用草稿生成消息；worktree 来源通过 `demand-entry.js plan` 转交本脚本标准计划。历史提交来源只生成消息，不进入 Apply、不自动改写历史。此衔接不改变 project 流程及提交授权。

1. 目标工程 `AGENTS.md`。
2. 目标工程 AGENTS 或其指向的项目配置中已确认的默认需求交付类型；不要求 IRIS profile。
3. 当前开发流程已确认的需求号、需求标题、需求描述、修改文件和验证结果。
4. 各修改文件所属 Git 仓库的 `AGENTS.md` 与提交约束。

## 需求类型

按以下优先级确定当前需求类型：

1. 用户对当前需求明确指定的 `standard` 或 `project`。
2. 目标工程 AGENTS 或其明确指向的项目配置中合法的“默认需求交付类型”。迁移项目可读取 `.agents/config/demand_delivery_profile.md`；其中 TODO 仍需确认。
3. 若字段为 `TODO`、缺失或非法，暂停提交并提示：

```text
默认需求交付类型仍为 TODO，请确认该工程默认处理 standard（标版）还是 project（项目）需求。
```

用户回答的是当前需求类型时，只用于本次计划；用户确认的是工程默认类型时，按项目约定更新该配置后再继续。不得根据目录名、`contextMode`、remote、upstream 或代码量猜测类型。

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

标版首行优先使用用户可识别的菜单名或“菜单-功能”摘要，保持简短，不重复完整需求标题；完整原始需求只放在 `需求描述`。例如首行使用 `fix(7060431):模板维护-内容校验`，而不是复制包含操作步骤和报错现象的长需求标题。

项目需求使用两行格式：

```text
<type>(<requirement-id>):<完整需求标题>
修改说明:<方案型修改说明>
```

用户指定的 `type` 优先；否则按实际变更选择：新增能力用 `feat`，修复缺陷用 `fix`，无行为变化的结构调整用 `refactor`，纯文档用 `docs`，构建或配置维护用 `chore`。一个计划只处理一个需求号；独立需求不得合并提交。已确认主子需求的共享代码按[代码归属协议](../../../../docs/demand-code-ownership.md)唯一绑定主需求号，子需求引用该结果；不为子项重复提交或改写阶段历史。

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
node .agents/plugins/demand-delivery-plugin/scripts/commit-demand.js plan `
  --project-root <workspace-root> `
  --kind <standard|project> `
  --demand <requirement-id> `
  --subject <简短菜单或功能摘要> `
  --title <完整需求标题> `
  --type <type> `
  --file <path> `
  --modification <repo-root>::<方案型修改说明>
```

单仓库时 `--modification` 可以只传说明正文。计划记录仓库 HEAD、branch、upstream、精确文件、状态/diff 指纹和拟用消息，并带完整性摘要，保存在系统临时目录。不得手工编辑或伪造计划；任何漂移都必须重新 plan。向用户展示每个仓库的文件与完整提交信息。

- `--plan` 模式到此结束，不询问是否提交，不进入 Apply。
- `--commit` 模式已有明确授权，plan 成功后直接进入 Apply，不重复暂停确认。

### 2. Apply

只有已取得明确提交授权时执行：

```powershell
node .agents/plugins/demand-delivery-plugin/scripts/commit-demand.js apply `
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
- 任一 pull 改变 HEAD 时，本轮不创建 commit，脚本以退出码 `3` 返回 `refresh-required`。Agent 立即按[自动接续协议](../../references/commit-upstream-check.md#head-前进后的自动接续)复核；满足条件后重新 plan、展示复核结果并继续 Apply，无需再次取得相同提交授权。

pull 门禁全部通过后重新读取所有仓库快照，并在每仓暂存前再次校验现场；脚本只暂存和提交计划内路径。多仓库先完成全部 pull，再逐仓 commit；若并行修改或 hook 等原因造成部分成功，必须逐仓报告，不得伪装为原子成功。

### 3. Verify

```powershell
node .agents/plugins/demand-delivery-plugin/scripts/commit-demand.js verify --plan <plan.json>
```

核对每个计划仓库的 commit、完整消息和提交文件集合，并报告计划外工作区状态。Verify 通过只证明本地提交完成，不代表已 push 或部署。

## 完成输出

- 本次调用模式：`--plan` 或 `--commit`，以及自然语言或显式参数来源。
- 当前需求类型及其来源。
- 每个仓库的完整提交信息、精确文件和 pull 结果。
- `--plan`：明确说明未执行 pull、未创建本地 commit，且未执行 push。
- `--commit`：报告用户已通过明确请求或显式参数授权、本地 commit hash 或停止原因。
- 仍保留的计划外修改。
- 明确说明未执行 push、部署、上传或远程编译。

## upstream 钩子去重

见 [同步检查协议](../../references/commit-upstream-check.md)。成功 pull 且快照校验通过后，仅对 commit 使用临时 hooks.requireUpToDate=false，复用全局钩子的既有开关。其他钩子检查保持执行；无 upstream 时不设置，不改全局或仓库配置，不使用 --no-verify。
