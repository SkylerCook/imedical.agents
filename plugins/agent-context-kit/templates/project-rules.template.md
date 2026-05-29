# 项目规则

稳定的项目工程规则、架构事实、命名约定和工作流。

## 项目事实

- TODO: 补充稳定的项目用途和工作方式。
- TODO: 如果 `contextMode` 为 `codebase-complete`，补充已验证的技术栈和核心架构。
- TODO: 如果 `contextMode` 为 `intent-first-on-demand-export`，明确本地代码不代表完整工程，后续需求处理按需从服务器导出相关文件。

## 上下文模式

- contextMode：TODO: `codebase-complete` 或 `intent-first-on-demand-export`。
- 本地文件完整性：TODO: 完整工程 / 零散文件 / 空壳工程 / 按需导出工作区。
- 事实来源：以用户确认、已导出文件、项目文档和 `.agents/config/project_context_profile.md` 为准。
- 保守默认：无法证明本地代码代表完整工程时，按 `intent-first-on-demand-export` 处理。

## 关键路径

| 用途 | 路径 |
|---|---|
| TODO | TODO |

## 命名约定

- TODO: 补充长期有效的命名约定。

## 工作流

- TODO: 补充稳定工作流和必读引用。
- 按需导出工程处理需求时：
  1. 先根据用户需求确认目标页面、类、JS、CSP 或业务对象。
  2. 导出相关服务端文件后再阅读、分析和修改。
  3. 修改完成后，如形成长期事实，再更新 memory、rules 或 config。

## 约束

- TODO: 补充后续 Agent 必须遵守的约束和反复踩坑点。
- 不得基于单个文件或少量零散文件推断整体架构、主模块边界或完整调用链。
- 按需导出工程中，本地已有文件最多列为“当前已导出/已存在文件”，不得写成系统组成或核心模块。
- 不把服务器地址、账号、密码、token、namespace、远程路径写入规则、记忆或插件。
