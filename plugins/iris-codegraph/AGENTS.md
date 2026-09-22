# AGENTS.md

## 插件定位

`iris-codegraph` 提供 IRIS/ObjectScript 后端代码图谱的构建与查询能力。

- 输入：IRIS 命名空间中的 `.cls` 源码（通过 `coding-iris-plugin/scripts/iris-tools/export-batch.js` 批量导出到 `.iris-codegraph-cache/`）。
- 处理：通过 Atelier REST API 的 `iris_query` 拉取 `%Dictionary.*Definition` 元数据，并对源码做静态解析。
- 输出：`.iris-codegraph/iris-codegraph.db`（SQLite），结构与前端 CodeGraph 兼容。
- 查询：`scripts/icg-query.js` 提供只读 CLI，支持 stats/search/class/method/callers/callees/impact 等命令。

## 使用约束

- 插件只承载可复用能力；目标 IRIS 连接信息（host、port、namespace、账号、密码）必须来自目标工程 `.mcp.json`，不得在插件脚本中硬编码。
- 图谱构建是本地只读操作（从 IRIS 拉取元数据、解析本地缓存源码），不修改远端 IRIS 状态。
- 构建脚本需要 Python 3 用于 SQLite 写入；查询脚本在 Node.js 未内置 `node:sqlite` 时会自动降级为 Python 执行器。
- 默认不覆盖已有缓存和数据库；需要全量重建时使用 `--overwrite` 或删除 `.iris-codegraph-cache/` 与 `.iris-codegraph/` 后重新运行。
- 当前版本仅解析 `##class(Package.Class).Method()` 静态调用，动态分发、`$classmethod`、Global 读写、嵌入式 SQL、宏展开、CSP 路由等调用关系待后续版本补齐。

## 脚本入口

- `scripts/iris-codegraph-build.js`：构建图谱。读取 `.iris-codegraph-cache/` 缓存，写入 `.iris-codegraph/iris-codegraph.db`。
- `scripts/icg-query.js`：查询图谱 CLI。
- `scripts/icg-query-sql-runner.py`：`icg-query.js` 的 Python sqlite3 降级执行器，无需单独调用。
- `scripts/write-sqlite.py`：将 `graph-data.json` 写入 SQLite，由 `iris-codegraph-build.js` 内部调用。

## 规则与参考入口

- Schema 设计：`schema.md`
- 使用规则：`rules/iris_codegraph_usage.md`
- 统一 skill：`skills/iris-codegraph/SKILL.md`
- 建设结论与使用说明：`ai-coding-knowledge/IRISGraph-后端代码图谱建设结论.md`

## Thin-Index

本插件使用 `plugin-reference-thin-index`。启用插件后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/iris-codegraph/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/iris-codegraph `
  -ProjectRoot . `
  -Mode DryRun
```

确认无冲突后用 `-Mode Write` 生成浅层 `.agents/rules/` 和 `.agents/skills/` 入口。读到 thin-index 后必须继续读取本插件真实 rule/skill。

## 去项目化边界

本插件不保存服务器地址、namespace、账号、密码、token、远程路径、业务类名前缀或项目专属包过滤规则。目标工程如需固定模块过滤规则，应在调用 `export-batch.js` 时通过 `--module` / `--pattern` 参数指定，或在目标工程本地配置中维护。
