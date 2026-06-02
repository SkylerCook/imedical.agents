# IRIS 脚本、MCP 与部署工作流规则

## IRIS 部署执行清单（机器友好）

部署 IRIS 文件时优先按本清单执行。标题和字段名尽量稳定，便于低能力模型逐项检查。

### 0. 必需配置来源

- 读取目标项目 `AGENTS.md`、`.agents/config/iris_project_profile.md` 和 `.agents/config/project-env.json`。
- namespace 从 `project-env.json -> iris.namespace` 获取。
- Web 文档前缀从 `project-env.json -> web.basePath` 和 `web.cspBasePath` 获取。
- 可选 Broker Cookie 从 `project-env.json -> web.cookie` 或 `debugger.js --cookie` 获取。
- 不得臆造 namespace、Web 根、host、Cookie 或远端路径默认值。
- 必需配置缺失时停止执行，并报告缺失字段名。

### 1. 能力编排与优先级

实际开发和部署按以下优先级选择工具：

1. 本地代码与本地脚本优先。先读本地源码、配置和项目规则；需要导出、编译、Broker 调试、环境同步时，优先使用 `scripts/iris-tools/`。
2. `sync-env-config.js` 用于从 `.agents/config/project-env.json` 生成 `.mcp.json`。每次修改本地私有环境配置后先运行它。
3. `export.js` 用于从 IRIS 导出类、CSP、JS 等文件；路径前缀从 `project-env.json` 的 `web.*` 字段获取。
4. `compile.js` 用于 `.cls` 类文件上传与编译；它不作为 CSP 编译入口。
5. `debugger.js` 用于 Broker/API 调试；Token、Cookie、Broker 路径从运行参数或 `project-env.json` 获取。
6. 后端 MCP `iris-agentic-dev` 用于脚本未覆盖的能力：`check_config`、只读 SQL、类/宏/表结构 introspect、文档 head/get、低风险 compile 验证、`iris_execute` 执行 ObjectScript。
7. 前端 MCP `sftp-server` 是可选能力。只有目标项目 `.mcp.json` 或 `project-env.json` 明确启用时才使用。缺失时不要阻塞开发，应准备好转换后的文件和远端映射，由用户用项目既有 SFTP、IDE 或手工方式上传。
8. CSP 编译通过后端 MCP 的 `iris_execute` 调用 `$system.OBJ.Load`，但 CSP 文件上传本身走 SFTP/项目上传能力；不要用 `iris_doc` 上传 CSP。

决策规则：

- 能用脚本稳定完成的，不优先调用 MCP。
- MCP 只补脚本能力缺口、做远端只读验证，或在用户明确要求部署时执行上传/编译。
- 任何项目缺少 `sftp-server` 时，不得臆造 ftp 能力；只记录“前端上传能力不可用”，并输出待上传文件清单和目标映射。
- 涉及远端写入、批量同步、远端命令、Production、凭据或数据库变更时，必须先说明影响并取得明确确认。

### 2. `iris-tools` 实际能力矩阵

以下能力以脚本当前源码为准，不要按文件名自行扩展能力。

| 脚本 | 实际能力 | 主要依赖 | 适用场景 | 明确不能做 |
|---|---|---|---|---|
| `sync-env-config.js` | 从 `.agents/config/project-env.json` 生成 `.mcp.json`；支持可选 `sftp.enabled=true` 生成 `sftp-server` MCP | 本地 `project-env.json` | 初始化或修改本地私有环境配置后同步 MCP 配置 | 不验证远端连通性；不上传文件；不编译；不把敏感值写入插件 |
| `export.js` | 通过 IRIS Atelier API 导出 IRIS 文档；可识别类名、`.cls`、`.js`、`.csp`；JS/CSP 路径前缀来自 `web.basePath` / `web.cspBasePath` | `project-env.json` 的 `iris.*`、`web.*` | 本地缺少类、CSP、JS 上下文时导出远端源码 | 不上传；不编译；不做 SFTP；不做 GB2312 转换 |
| `compile.js` | 通过 MCP 调用 `iris_doc mode=put` 上传 IRIS 文档，再调用 `iris_compile` 编译 | `project-env.json` 的 `iris.*`、`mcp.serverPath` | `.cls` 等后端 IRIS 文档的快速上传与编译 | 不支持 CSP；不支持 SFTP；不处理 GB2312；不适合持久化实体类带 Storage 原文直接上传 |
| `debugger.js` | 通过 HTTP/HTTPS POST 调用 Broker/API；支持命令行或交互输入 Token、ClassName、MethodName、参数、URL、Cookie | `project-env.json` 的 `iris.*`、`web.basePath`、`web.brokerPath`、可选 `web.cookie` | 验证后端 Broker 方法、调试业务接口返回 | 不上传；不编译；不执行 SQL；不替代单元测试或页面访问验证 |

脚本使用规则：

- 每次修改 `.agents/config/project-env.json` 后，先运行 `sync-env-config.js`，再使用依赖 `.mcp.json` 的能力。
- 需要导出源码时优先 `export.js`，本地已有最新源码时不要从远端覆盖本地。
- 后端类小范围验证可用 `compile.js`；批量部署、有 Storage 的实体类、复杂依赖链，按部署清单先处理源码和依赖顺序，不要盲目逐个调用 `compile.js`。
- CSP 的正确链路是：编码转换或确认编码 → 项目上传能力/SFTP 上传 → `iris_execute` 执行 WebApp 虚拟路径 `$system.OBJ.Load` → 验证生成类和 `CSPFILE/CSPURL`。
- 如果目标项目没有 `sftp-server` MCP，脚本体系仍可用于后端导出、编译、Broker 调试和环境同步；前端上传交给项目既有工具或用户手工处理。

### 3. 后端类部署

- 持久化实体 `.cls` 如包含 `Storage Default`，执行 `iris_doc put` 前必须去掉整个 `Storage Default { ... }` 块。
- 不得上传“只删除 `Storage Default` 行但保留裸 Storage 内容”的类。
- 先上传完整依赖切片，再编译；不要上传一个类后立刻编译一个类。
- 推荐顺序：
  1. 实体类：字典、配置、业务
  2. 公共/基类
  3. 业务类：字典、配置、业务 SQL/DATA/BLH
  4. 集成类
  5. 前端文件
- 如编译错误提示关联类或短类名不存在，先上传缺失依赖切片，再按依赖顺序重新编译。

### 4. 前端上传

- 仅当目标项目配置要求时，才把前端源文件转换为目标编码。
- `*.gb2312.*` 只作为临时上传内容。
- 远端目标名必须是原始文件名，不能是临时 `*.gb2312.*` 文件名。
- 上传后清理本地临时 `*.gb2312.*` 文件。

### 5. CSP 编译

- CSP 文件通过 SFTP 上传到物理 Web 根。
- CSP 编译必须使用 WebApp 虚拟路径，不使用物理路径：
  `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`
- 不要使用：
  `$system.OBJ.Load("<physical-web-root>/csp/<file>.csp","c")`
- 不要把 `.gb2312.csp` 作为编译目标。
- 不要把 `iris_execute.success=true` 当成编译成功；它只表示 ObjectScript 外层包装执行过。
- ObjectScript 包装代码必须输出并检查：
  `$SYSTEM.Status.IsError(sc)` and `$SYSTEM.Status.GetErrorText(sc)`.

### 6. 验证

- 验证后端类存在且编译无错误。
- 验证 CSP 生成类名包含虚拟 URL 包名。虚拟 URL 含 `/csp/` 时，检查 `csp.csp.<page-name>`。
- 验证 CSP 生成类参数：
  - `CSPFILE` 包含 `/csp/`
  - `CSPURL` 包含 `/csp/`
- 验证代表性页面可加载，核心业务调用可用。
- 以上检查通过前，不得报告部署成功。

## GB2312 提升流程

当用户要求把转换后的 GB2312 输出文件替换回原始前端源文件时，使用 `iris-frontend-gb2312-promote`。

必需安全流程：

- 确认每个源文件存在，且不存在既有 `{name}.gb2312{ext}` 输出文件。
- 运行 `.agents/scripts/convert-gb2312-upload.ps1` 并展示 JSON 结果。
- `converted=false` 表示源文件已是 GB2312；不要删除或重命名源文件。
- `converted=true` 时，删除源文件并把转换结果改回原文件名前必须先征得确认；除非同一条用户请求已明确跳过确认。
- 删除或移动前，验证解析后的路径仍位于当前工作区或明确目标项目根目录内。
- 只使用 PowerShell 原生命令 `Remove-Item -LiteralPath` 和 `Move-Item -LiteralPath`；不要把删除或移动串到另一个 shell 中执行。
- 替换完成后，单独询问是否通过 MCP/SFTP 上传。
- 只上传恢复后的原始文件路径，不上传 `.gb2312` 临时文件名。
- 不自动编译 CSP；只有用户另行要求时才编译。

## 标准流程

1. 读取目标工程 `AGENTS.md`、`.agents/config/iris_project_profile.md` 和本插件规则索引。
2. 本地搜索定位现有实现和参考代码。
3. 导出、编译、Broker 调试和环境配置同步优先使用 `scripts/iris-tools/` 中的 IRIS 开发主力脚本。
4. 本地缺少必要上下文时，用 MCP 只读读取远程内容。
5. MCP 用于补上下文、只读 SQL/远程读取、脚本未覆盖的能力，或用户明确要求使用 MCP 的场景。
6. 在本地完成最小范围修改。
7. 仅当用户明确要求时，执行上传、编译、远程写入、Broker 调用或数据库变更。
8. 需要沉淀长期经验时，按目标工程自己的记忆规则维护。

## IRIS 开发主力脚本

目标工程应先由用户复制并填写本地私密配置：

```powershell
New-Item -ItemType Directory -Force .agents/config
Copy-Item .agents/plugins/coding-iris-plugin/templates/project-env.template.json .agents/config/project-env.json
notepad .agents/config/project-env.json
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
```

常用脚本：

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <文件标识符>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js <文件名或路径> [命名空间]
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class <ClassName> --method <MethodName>
```

`.agents/config/project-env.json` 和生成的 `.mcp.json` 可能包含敏感信息，必须只保留在目标工程本地，不写入插件规则、模板或项目记忆。

## 内置脚本初始化

`coding-iris-init` 初始化时必须确保目标工程存在 `.agents/scripts/`，并从插件复制编码转换脚本：

- `.agents/plugins/coding-iris-plugin/scripts/convert-gb2312-upload.ps1`

`generate-plugin-thin-index.ps1` 不复制到目标工程。生成或重建 thin-index 时直接调用插件内脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1
```

复制规则：

- 目标不存在：直接复制。
- 目标存在且内容相同：跳过并报告 unchanged。
- 目标存在且内容不同：报告 conflict，不静默覆盖。
- 用户明确要求覆盖时，才允许替换。

## MCP 使用

MCP 工具名称和连接参数以目标工程 `.mcp.json` 为准；插件只描述能力，不保存连接事实。

后端 MCP 常见能力：

- 读取本地缺失的 IRIS 类、例程、宏展开内容。
- 上传 `.cls` 并编译。
- 执行只读 SQL 验证字段、表名和数据形态。
- 调用类方法做逻辑验证。

前端 MCP 常见能力：

- 只读读取远程 `.csp` / `.js` / `.css` 文件。
- 用户明确要求时上传部署本地文件。

## 前端上传编码转换

源文件默认 UTF-8；服务器若要求 GB2312，上传前运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/convert-gb2312-upload.ps1 -Files @(
    "path/to/page.csp",
    "path/to/page.js"
)
```

脚本输出 JSON：

```json
[{"file":"...","encoding":"utf8|gb2312","converted":true,"uploadPath":"..."}]
```

上传策略：

- `converted=false`：上传源文件。
- `converted=true`：上传临时 GB2312 文件，但远端文件名应映射回原始目标文件名。
- 上传后清理本地临时 `*.gb2312.*` 文件。

## CSP 编译

- CSP 编译命令模板从目标工程 profile 读取。
- `.cls` 编译和 CSP 编译通常不是同一 MCP 能力，执行前确认目标工程工具支持范围。
- 用户未明确要求时，不执行远程编译。

### 后端类部署可靠性

- 持久化实体类如包含 `Storage Default`，通过 `iris_doc put` 上传前必须去掉整个 `Storage Default { ... }` 块，只保留类、属性、索引、Relationship、Trigger/Method 等源码；由 IRIS 编译重新生成 Storage。
- 不要把只删除 `Storage Default` 行、保留裸 `{ ... }` 的内容上传到 IRIS；这会破坏类定义并导致解析失败。
- 实体类按依赖层整组上传后再编译，避免父类先编译时因子表 Relationship 尚不存在而失败。
- 业务类也先上传完整依赖切片，再按依赖顺序编译；不要边上传边逐个编译依赖链中的类。
- 常见部署顺序：实体类（字典、配置、业务）→ 公共基类 → 业务类（字典、配置、业务主类）→ Inter → 前端资源。

### CSP 编译可靠性

- CSP/JS/CSS 通过 SFTP 上传到物理 Web 根；CSP 编译必须使用 WebApp 虚拟路径调用 `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`。
- 不要使用物理 Web 根路径调用 `$system.OBJ.Load("<physical-web-root>/csp/<file>.csp","c")`；部分环境会生成错误的 CSP 类名和错误的 `CSPFILE` / `CSPURL`。
- `iris_execute` 外层 `success=true` 只表示 ObjectScript 执行成功，不代表 `$system.OBJ.Load` 内层编译成功；执行代码必须输出并检查 `$SYSTEM.Status.IsError(sc)` 和 `$SYSTEM.Status.GetErrorText(sc)`。
- 不要只依赖 `$system.OBJ.Compile("<physical-path>.csp","cuk /checkuptodate=expandedonly")` 做批量部署主入口；未登记的 CSP 可能返回非错误但不生成目标类。
- 编译后的类名应包含 CSP 运行包和虚拟 URL 段，例如虚拟路径含 `/csp/` 时通常检查 `csp.csp.<page-name>`，并确认 `CSPFILE`、`CSPURL` 都包含 `/csp/`。
- GB2312 临时文件只用于上传内容，远端目标名必须映射回原始文件名；不要把 `*.gb2312.*` 作为 CSP 编译目标。

## 高风险操作

以下操作必须先说明影响并取得用户明确确认：

- 删除本地或远程文件。
- 批量覆盖、批量同步大量文件。
- 数据库 DDL/DML 变更。
- 修改 IRIS 安全资源、用户、角色、WebApp。
- 执行会改变远程状态的 shell 命令。
