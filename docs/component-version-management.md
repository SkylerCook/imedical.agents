# 组件版本管理

本规范只管理 `imedical.agents` 源仓中的插件和根级独立 skill。它不接入业务项目安装器、更新器、thin-index 或 Git hook，不改变 `docs/update-agents.md` 规定的部署与更新流程。

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

# 提交前比较工作区
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate `
  --repo-root . `
  --base-ref HEAD `
  --worktree

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

## 明确边界

- 不创建业务项目 `.agents/config/component_versions.json`。
- 不修改或调用 `scripts/install-agents.ps1`、`scripts/update-agents.ps1`。
- 不改变 sparse checkout、plugin profile、thin-index、standard 或 workspace-overlay 流程。
- 不把 `releases/`、维护工具或维护者记忆部署到业务项目。
- 将来如需把版本检查接入更新器，必须单独设计、验证和授权。
