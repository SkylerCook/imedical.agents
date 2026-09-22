# iris-codegraph

`iris-codegraph` 是面向 InterSystems IRIS/ObjectScript 后端代码的图谱构建与查询插件，是 HIS 研发知识中台后端层（IRISGraph）的实现载体。

## 能力范围

- **批量导出**：基于 Atelier REST API 将 IRIS 命名空间中的类文件导出到本地缓存。
- **元数据抽取**：通过 `iris_query` 查询 `%Dictionary.ClassDefinition`、`%Dictionary.MethodDefinition`、`%Dictionary.PropertyDefinition`、`%Dictionary.ParameterDefinition`，获取类骨架、方法签名、属性类型、继承关系。
- **静态调用解析**：解析 `##class(Package.Class).Method()` 语法，生成类级 `calls` 边。
- **图谱持久化**：输出 SQLite 数据库 `.iris-codegraph/iris-codegraph.db`，复用前端 CodeGraph 的四表结构（`files` / `nodes` / `edges` / `project_metadata`）。
- **只读查询 CLI**：`icg-query.js` 提供 stats、search、class、method、callers、callees、impact 等命令。

## 标准目录

```text
iris-codegraph/
|-- AGENTS.md
|-- README.md
|-- schema.md
`-- scripts/
    |-- iris-codegraph-build.js
    |-- icg-query.js
    |-- icg-query-sql-runner.py
    `-- write-sqlite.py
```

## 前置依赖

- Node.js（构建与查询脚本）
- Python 3（因当前 Node 环境未内置 `node:sqlite`，SQLite 写入与查询降级依赖 Python `sqlite3`）
- 目标工程已配置 `.mcp.json`，且包含 `iris-dev` MCP 服务器连接信息

## 使用流程

### 1. 批量导出源码

由 `coding-iris-plugin` 提供：

```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export-batch.js --module epmi --categories CLS
```

导出后缓存位于 `.iris-codegraph-cache/`，包含 `manifest-<namespace>.json` 与 `.cls` 源码。

### 2. 构建图谱

```bash
node .agents/plugins/iris-codegraph/scripts/iris-codegraph-build.js
```

构建完成后输出：

- `.iris-codegraph/graph-data.json`：图谱中间数据
- `.iris-codegraph/iris-codegraph.db`：SQLite 图谱数据库

### 3. 查询图谱

```bash
# 统计
node .agents/plugins/iris-codegraph/scripts/icg-query.js stats

# 搜索节点
node .agents/plugins/iris-codegraph/scripts/icg-query.js search CardReg

# 类详情
node .agents/plugins/iris-codegraph/scripts/icg-query.js class DHCDoc.EPMI.SERV.CardReg

# 方法详情（全限定名：类名::方法名）
node .agents/plugins/iris-codegraph/scripts/icg-query.js method DHCDoc.EPMI.SERV.CardReg::getPatRegInfo

# 上游调用方
node .agents/plugins/iris-codegraph/scripts/icg-query.js callers DHCDoc.EPMI.SERV.CardReg

# 下游被调用方
node .agents/plugins/iris-codegraph/scripts/icg-query.js callees DHCDoc.EPMI.SERV.CardReg

# 变更影响分析
node .agents/plugins/iris-codegraph/scripts/icg-query.js impact DHCDoc.EPMI.SERV.CardReg
```

可通过环境变量 `ICG_DB` 指定其他数据库路径：

```bash
set ICG_DB=D:\\path\\to\\iris-codegraph.db
node .agents/plugins/iris-codegraph/scripts/icg-query.js stats
```

## 当前版本状态

- 节点类型：`class` / `method` / `property` / `parameter`
- 边类型：`contains` / `extends` / `calls`
- 首版构建范围：epmi 试点模块（35 个类）
- 当前规模示例：378 节点 / 755 边

## 已知限制

1. **调用解析不完整**：仅识别 `##class()` 静态调用，未覆盖 `do method^Routine`、`$$entry^Routine`、`$classmethod`、动态 `##class({var})`、宏展开、Global 读写、嵌入式 SQL、CSP `#server()` 等。
2. **方法级调用链为类级**：`calls` 边目前连接"类→类"，方法级上下游通过 `metadata.targetMethod` 二次过滤。
3. **源码编码**：部分 `.cls` 文件为 GB2312/GBK 编码，当前按 UTF-8 读取可能导致注释或字符串乱码。
4. **覆盖范围**：仅构建 epmi 模块，doc/cure 等大模块待扩展。

## 后续路线

- 阶段 1D：扩展静态解析器，补齐 Global 读写、嵌入式 SQL、宏、CSP 路由等边类型。
- 阶段 1E.2：实现基于文件 mtime 或 git diff 的增量更新。
- 阶段 1E.3：扩展至 doc/cure 等大模块并验证。
- 阶段 1F.2：已提供 `rules/iris_codegraph_usage.md`，后续按解析能力扩展持续维护。
- 阶段 2/3：与 HISGraph 业务知识图谱桥接，提供统一中台查询入口。

## 去项目化边界

本插件不保存服务器地址、namespace、账号、密码、token、远程路径、业务类名前缀或项目专属过滤规则。所有连接信息必须来自目标工程 `.mcp.json`。

## Plugin Mode

The plugin follows `plugin-reference-thin-index`:

1. Keep the plugin under `.agents/plugins/iris-codegraph/`.
2. Generate shallow entries under `.agents/rules/` and `.agents/skills/`.
3. Agents reading a thin-index must continue to the real source file under this plugin.

Generate entries after enabling the plugin:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/iris-codegraph/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/iris-codegraph `
  -ProjectRoot . `
  -Mode DryRun
```

Then rerun with `-Mode Write` when the dry-run has no conflicts.

Existing projects get this plugin by updating `.agents`. The directory being present means `available` only. Enable the plugin after `coding-iris-plugin` is enabled and rebuild the plugin thin-index to expose shallow entries.
