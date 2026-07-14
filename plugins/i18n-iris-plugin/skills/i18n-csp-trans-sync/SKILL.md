
---
name: i18n-csp-trans-sync
description: Use when exporting, verifying, or explicitly syncing page-level translations between an IRIS server and the project-configured local page translation seed file.
---

# CSP Translation Sync — CSP 页面翻译导出与校验

## 触发条件

当需要以下任一操作时使用本 Skill：

- **导出**：从服务器获取指定页面在指定语言下的页面级翻译数据，按 project profile 配置重写本地种子文件中的同步方法体，生成标准种子文件用于迁移。
- **校验**：对比服务器翻译数据与本地种子文件中的对应条目，输出差异报告。
- **同步**：用户明确要求时，以服务器或本地为准更新另一侧。

典型触发语句：“从服务器导出某页面翻译”、“对比服务器翻译和本地种子文件”、“以服务器为准更新种子类”、“同步页面翻译”。

本 Skill 与 `i18n-page-trans-seed` 的关系：

| | i18n-csp-trans-sync | i18n-page-trans-seed |
|---|---|---|
| 数据来源 | 服务器页面级翻译存储 | 翻译表或用户提供的翻译条目 |
| 写入方式 | 按 profile 配置重写同步方法体 | 增量追加批次方法 |
| 用途 | 服务器间迁移、定期校验、补齐差异 | 新翻译内容首次录入 |

## 必读配置

1. `.agents/config/i18n_project_profile.md`
2. 页面翻译种子规则：优先读取目标工程 `.agents/rules/i18n_page_translation_seed.md`；引用插件时读取插件 `rules/i18n_page_translation_seed.md`
3. 语言目录规则：`i18n_language_catalog.md`
4. 工程根目录 `.mcp.json`

`.mcp.json` 是 MCP 连接配置唯一事实来源。Skill 不硬编码服务器、namespace、MCP server 名称或远程路径。

按条件继续读取：

- 只做差异报告时，不读取编码改造规则。
- 需要生成或调整种子写入代码时，继续按 `i18n_page_translation_seed.md` 的种子类约束执行。
- 需要部署、编译或加载时，先从 `.mcp.json` 判断可用能力，再读取目标工程对应部署规则。

## 参数

- `action`：必填。`export`、`verify`、`sync`。
- `pages` / `csp`：目标页面名。支持多个页面。传 `*` 或省略时使用 project profile 中的默认页面组。
- `pageGroup`：可选；使用 project profile 中定义的页面组。
- `language`：目标语言代码；默认使用 project profile 配置。
- `syncMode`：仅同步有效。默认 `report-only`；可选 `server-wins`、`local-wins`。

## MCP 能力映射

执行前读取 `.mcp.json`，再根据当前会话实际可用工具匹配以下抽象能力：

- `iris.executeCommand`：读取服务器页面级翻译、执行 ObjectScript 命令。
- `iris.compileDoc`：编译种子类。
- `iris.executeClassMethod`：执行加载/回滚方法。
- `iris.sqlExecute`：必要时校验语言目录或字典数据。
- `sftp.uploadFile`：部署本地种子文件到服务器。

如果 `.mcp.json` 声明的 server 与当前可用工具不一致，先输出不匹配说明，再选择等价工具或请求用户确认。

## Project Profile 依赖项

本 Skill 从 project profile 读取：

- 页面级翻译存储结构。
- 语言目录和兜底映射。
- 本地种子文件路径。
- 种子类全名。
- 单条写入/回滚方法名。
- 页面组列表。
- 同步方法组映射。
- 聚合加载/回滚方法。
- 备份目录。
- 条目过滤和排序规则。
- 部署链路偏好。

缺少上述关键配置时，先报告缺失项，不进行导出或同步。

## 工作流

### Verify 模式

目标：对比服务器与本地差异，默认只输出报告。

步骤：

1. 展开页面范围：从参数或 project profile 的页面组获取页面列表。
2. 解析语言：从语言目录或 profile 兜底映射获取页面级翻译语言标识。
3. 解析本地种子文件：从 profile 指定的方法组中提取写入调用，构建 `localMap[page][item] = translation`。
4. 查询服务器：使用 `iris.executeCommand` 抽象能力读取每个页面的翻译条目，构建 `serverMap[page][item] = translation`。
5. 过滤与排序：应用 profile 指定的过滤规则和排序规则。
6. 输出差异报告：按页面分组列出匹配、服务器仅有、本地仅有、冲突、服务器空值等分类。
7. 如果 `syncMode=report-only`，到此结束。

### Export 模式

目标：以服务器当前翻译数据为准，生成本地标准同步方法体。

步骤：

1. 执行 Verify 模式的页面展开、语言解析、服务器查询、过滤与排序。
2. 按 project profile 的页面组和方法组生成写入/回滚方法体。
3. 重写本地种子文件中 profile 指定的方法体内部代码，文件其余部分保持不变。
4. 重写前按 profile 指定备份目录保存方法体备份。
5. 输出变更摘要；不自动部署，除非用户明确要求。

### Sync 模式

目标：根据用户指定方向同步差异。

- `server-wins`：服务器为准，更新本地种子文件。
- `local-wins`：本地为准，生成服务器写入计划；当前 run manifest 的 `translation-data-write` scope 已覆盖页面、语言、上传、编译和加载动作时直接执行，不重复询问，否则执行前确认。
- `report-only`：只报告，不修改。

默认不得修改本地种子文件或服务器数据，除非用户明确要求同步方向。

## 差异分类

| 分类 | 条件 | server-wins 行为 | report-only 行为 |
| --- | --- | --- | --- |
| `[Match]` | 服务器与本地 key 和 value 完全一致 | 跳过 | 跳过 |
| `[Server-Only]` | key 仅在服务器存在 | 新增到本地 | 仅报告 |
| `[Local-Only]` | key 仅在本地存在 | 保留不删，报告提示 | 仅报告 |
| `[Conflict]` | key 在两边但 value 不同 | 以服务器值覆盖 | 仅报告 |
| `[Server-Empty]` | 服务器源语言 key 值为空，本地有非空值 | 保留本地值并标注 | 仅报告 |

## 差异报告格式

```text
=== Page Translation Diff: <pageCode> (<LANG>) ===

[Server-Only] (2 items)
  + "源文案A" => "Target A"

[Local-Only] (1 item)
  - "源文案B" => "Target B"

[Conflict] (1 item)
  ~ "源文案C"  Server: "Server Target" | Local: "Local Target"

[Server-Empty] (1 item)
  ? "源文案D"  Server: "" | Local: "Local Target"

=== Summary: ... ===
```

## 生成代码要求

- 写入调用必须使用 project profile 指定的全类名和方法名。
- 回滚只生成逐条删除，不生成整语言或整页面根节点删除。
- 页面分组注释使用页面代码，便于人工审查。
- 只重写 project profile 指定的方法体，文件其余部分保持不变。

## 部署

只有当前运行已有显式部署授权时才执行。授权应由 Coordinator 在需求启动时主动收集；manifest 已覆盖同一 scope 时不重复询问：

1. 使用 `.mcp.json` 对应的 SFTP 能力上传本地种子文件。
2. 使用 `.mcp.json` 对应的 IRIS 编译能力编译种子类。
3. 使用 `.mcp.json` 对应的 IRIS 类方法执行能力调用 profile 指定的加载方法。

部署时 namespace、远程路径等参数从 `.mcp.json` 解析或由用户明确提供，不在 skill 中硬编码。

## 关键注意事项

- 若某个 MCP 工具不会自动读取 `.mcp.json` 中的 namespace，执行时必须显式传入从 `.mcp.json` 解析到的 namespace。
- 若 global 读取工具对源语言下标不可靠，改用 `iris.executeCommand` 并输出可审查的命令。
- 若文档加载工具存在路径映射风险，优先使用 project profile 指定的部署链路。
- 修改本地种子文件前必须备份；需求启动时必须说明可能执行的上传、编译和加载动作。已有授权不覆盖冲突覆盖、删除、回滚、环境变化或 scope 扩大。
