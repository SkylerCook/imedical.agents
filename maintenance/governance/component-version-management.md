# 组件版本管理

本规范只管理 `imedical.agents` 源仓中的插件和根级独立 skill。它不接入业务项目安装器、更新器、thin-index 或 Git hook，不改变 `docs/update-agents.md` 规定的部署与更新流程。

## 同步内容的事实来源

同步检查不要求每份文档都产生修改。版本事实只写 manifest（根级独立 skill 用 frontmatter）；操作约束由 owner 的 rule/reference 维护，skill 与 README 保留触发条件和引用；项目迁移说明归 docs/update-agents.md，发布记录描述本次兼容影响。维护摘要只留当前状态与入口，日志记录本轮结果，backlog 只留未完成事项。

变更时核对这些入口是否仍准确：事实变化才改正文，路径变化检查引用可达；不要为满足同步清单复制同一段规则。已提交发布记录保持不可变，未提交的本轮发布草稿随最终范围更新。

## 版本单元

- 插件以 `plugins/<name>/.agents-plugin/plugin.json` 的 `version` 为事实来源。
- 根级独立 skill 以 `skills/<name>/SKILL.md` frontmatter 的 `version` 为事实来源。
- 插件内部 skill、rule、reference、template 和 script 继承 owner 插件版本，不得声明独立 `version`。
- 版本必须是严格 `MAJOR.MINOR.PATCH`；不接受 `v` 前缀、预发布或 build metadata。

## 版本递增

| 变化 | 版本要求 |
|---|---|
| 向后兼容修复 | PATCH，且必须只增加 1 |
| 向后兼容能力 | MINOR，minor 只增加 1、patch 归零 |
| `0.x` breaking 变化 | MINOR，`breaking: true`、`migration: required` |
| `1.x+` breaking 变化 | MAJOR，major 只增加 1、minor/patch 归零 |

插件目录中的任意文件发生变化都要求插件版本递增；根级独立 skill 目录变化要求自身版本递增。新组件使用 `level: initial`。`level: baseline` 只允许用于 2026-08-19 的首次治理接入，不用于后续发布。

canonical 重命名必须保留 `legacyNames`，并提供 breaking 发布记录与迁移说明。删除组件必须保留 `status: removed` 的下一版本 tombstone 发布记录，且不能再被其它插件依赖。

## 发布记录

发布记录位于：

```text
releases/plugin/<name>/<version>.md
releases/skill/<name>/<version>.md
```

frontmatter schema：

```yaml
---
schema: imedical-component-release/v1
component: plugin
name: sample-plugin
version: 0.2.0
previousVersion: 0.1.0
level: minor
breaking: true
status: active
date: 2026-08-19
migration: required
commit: 0123456
---
```

`migration: required` 时正文必须包含非空 `## Migration`。发布记录一旦提交便不可修改或删除。v1 不强制 Git tag，release record 与对应 Git commit 是审计事实。

## 依赖版本

现有 `dependencies` 名称数组继续供更新器使用，不得改为对象。源仓版本治理另用更新器会忽略的 `dependencyVersions`：

```json
{
  "dependencies": ["coding-iris-plugin"],
  "dependencyVersions": {
    "coding-iris-plugin": {
      "minVersion": "0.3.0",
      "maxVersionExclusive": "0.4.0"
    }
  }
}
```

两者必须一一对应。`0.x` 默认只兼容同一 minor，`1.x+` 默认只兼容同一 major；当前依赖版本必须落在半开区间 `[minVersion, maxVersionExclusive)` 内，并且依赖图不得成环。

## 维护命令

工具位于源仓维护 skill，不随业务项目部署：

```powershell
# 当前清单与结构校验
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js inventory --repo-root .
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root .

# 提交前只检查暂存组件（先精确暂存本次文件）
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate `
  --repo-root . `
  --staged --budget-ms 60000

# CI、发布或明确要求的完整工作区审计
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate `
  --repo-root . --base-ref HEAD --worktree

# 两个 Git ref 的只读兼容审计
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js compare `
  --repo-root . `
  --from-ref <old-ref> `
  --to-ref <new-ref>
```

breaking 比较默认失败。仅在明确批准目标组件和版本后追加精确授权：

```powershell
--accept-breaking plugin:sample-plugin@0.2.0
```

不接受通配符，错误版本和未消费授权同样失败。版本倒退、依赖不兼容和发布记录缺失不能通过 breaking 授权绕过。`--format json` 输出 `imedical-component-version-result/v1`；退出码 `0` 表示通过，`1` 表示治理失败，`2` 表示参数或运行错误。

## 提交证据与耗时

提交固定使用 `validate --staged`：一次取得暂存变更清单，校验这些 owner 的版本递增、发布记录不可变性，并检查直接依赖及直接反向依赖。全部 manifest 只作为依赖图输入；不会逐文件调用 `git show`，历史对象通过 `git cat-file --batch` 批量读取并在本次调用内缓存。只认 index，未暂存修复不能使错误的暂存内容通过。组件外文件不会触发全仓发布记录扫描。

版本证据自动独立保存到系统临时目录 `imedical-agent-validation/*-versions.json`（可用 `--evidence-file` 指定）。指纹绑定校验器、变更组件文件名、前后版本元数据、发布记录和依赖图；不绑定 HEAD 标识，也不绑定与版本规则无关的文案正文。同一变更集的纯文案编辑、无关提交可复用；新增组件路径、版本、发布记录或依赖元数据变化则重新校验。失败、超时不记录通过证据；命中缓存仍输出原有历史问题。

功能证据用 `scripts/validation-evidence.js record|check` 单独管理，内容指纹只绑定明确受测的 scope、文件内容、文件类型和可执行位；HEAD 仅作来源信息。scope 应覆盖实现、测试、运行配置及测试实际读取的协议文件，普通说明文案不混入功能 scope。不能仅凭 `.md` 后缀排除运行协议。旧版 HEAD 指纹不自动升级为有效证据；首次需重新验证。`record` 是维护者对成功测试的记录，不代替执行测试，也不能用来覆盖失败。

暂存门禁在 stderr 输出阶段、组件数、耗时，JSON 留在 stdout；默认总预算 60 秒，`--budget-ms` 可调整。Git 子进程共享剩余预算，超时返回 2 并停止，不视为通过。全仓审计仍使用原命令，CI 在 Windows/macOS/Linux × Node 22/24 执行工具测试和完整版本检查。

## 历史问题规则

已登记的 `version-debt-xc-1.0.2-commit`（信创 1.0.2 缺少 commit）见 `memory/agent-kit-maintenance-backlog.md`。按用户约定，后续普通提交不重复排查、提醒或请求确认；仅相关记录发生新变化或明确开展治理/发布审计时处理。

暂存门禁只将以下发现列为 `historicalIssues`：基线中已经存在、问题完全相同、对应已提交发布记录内容未变的结构问题。它们明确报告并保留在治理队列，不阻断无新增问题的局部提交；新增或修改的错误、依赖不兼容、版本未递增、历史记录被篡改始终阻断。未涉及组件的历史记录不扫描，不能据局部门禁通过宣称全仓无问题。CI、发布和完整审计继续报告并阻断所有历史问题；历史发布记录纠错仍按 owner 治理方案处理，不修改不可变记录。

## 明确边界

- 不创建业务项目 `.agents/config/component_versions.json`。
- 不修改或调用 `scripts/install-agents.ps1`、`scripts/update-agents.ps1`。
- 不改变 sparse checkout、plugin profile、thin-index、standard 或 workspace-overlay 流程。
- 不把 `releases/`、维护工具或维护者记忆部署到业务项目。
- 将来如需把版本检查接入更新器，必须单独设计、验证和授权。
