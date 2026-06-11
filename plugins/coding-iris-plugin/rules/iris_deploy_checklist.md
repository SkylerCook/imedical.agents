---
name: iris_deploy_checklist
description: Use when the user explicitly asks to upload, compile, deploy, or verify IRIS files remotely.
task-affinity: [iris, deploy, upload, compile, verify]
related:
  - iris_coding_workflow.md
---

# IRIS 部署执行清单

部署 IRIS 文件时优先按本清单执行。标题和字段名尽量稳定，便于低能力模型逐项检查。

## 必需配置来源

- 读取目标项目 `AGENTS.md`、`.agents/config/iris_project_profile.md` 和 `.agents/config/project-env.json`。
- namespace 从 `project-env.json -> iris.namespace` 获取。
- Web 文档前缀从 `project-env.json -> web.basePath` 和 `web.cspBasePath` 获取。
- 可选 Broker Cookie 从 `project-env.json -> web.cookie` 或 `debugger.js --cookie` 获取。
- 不得臆造 namespace、Web 根、host、Cookie 或远端路径默认值。
- 必需配置缺失时停止执行，并报告缺失字段名。

## 能力编排与优先级

1. 本地代码与本地脚本优先。先读本地源码、配置和项目规则；需要导出、编译、Broker 调试、环境同步时，优先使用 `scripts/iris-tools/`。
2. `sync-env-config.js` 用于从 `.agents/config/project-env.json` 生成 `.mcp.json`。
3. `export.js` 用于从 IRIS 导出类、CSP、JS 等文件；路径前缀从 `project-env.json` 的 `web.*` 字段获取。
4. `compile.js` 用于 `.cls` 类文件上传与编译；它不作为 CSP 编译入口。
5. `debugger.js` 用于 Broker/API 调试；Token、Cookie、Broker 路径从运行参数或 `project-env.json` 获取。
6. 后端 MCP `iris-agentic-dev` 用于脚本未覆盖的能力，例如 `check_config`、只读 SQL、类/宏/表结构 introspect、文档 head/get、低风险 compile 验证和 `iris_execute`。
7. 前端 MCP `sftp-server` 是可选能力。只有目标项目 `.mcp.json` 或 `project-env.json` 明确启用时才使用。
8. CSP 编译通过后端 MCP 的 `iris_execute` 调用 `$system.OBJ.Load`，但 CSP 文件上传本身走 SFTP/项目上传能力；不要用 `iris_doc` 上传 CSP。

决策规则：

- 能用脚本稳定完成的，不优先调用 MCP。
- MCP 只补脚本能力缺口、做远端只读验证，或在用户明确要求部署时执行上传/编译。
- 任何项目缺少 `sftp-server` 时，不得臆造 ftp 能力；只记录“前端上传能力不可用”，并输出待上传文件清单和目标映射。
- 涉及远端写入、批量同步、远端命令、Production、凭据或数据库变更时，必须先说明影响并取得明确确认。

## 后端类部署

- 持久化实体 `.cls` 如包含 `Storage Default`，执行 `iris_doc put` 前必须去掉整个 `Storage Default { ... }` 块。
- 不得上传“只删除 `Storage Default` 行但保留裸 Storage 内容”的类。
- 先上传完整依赖切片，再编译；不要上传一个类后立刻编译一个类。
- 推荐顺序：实体类（字典、配置、业务） -> 公共/基类 -> 业务类（字典、配置、业务 SQL/DATA/BLH） -> 集成类 -> 前端文件。
- 如编译错误提示关联类或短类名不存在，先上传缺失依赖切片，再按依赖顺序重新编译。

## 前端上传

- 仅当目标项目配置要求时，才把前端源文件转换为目标编码。
- `*.gb2312.*` 只作为临时上传内容。
- 远端目标名必须是原始文件名，不能是临时 `*.gb2312.*` 文件名。
- 上传后清理本地临时 `*.gb2312.*` 文件。

## CSP 编译

- CSP 文件通过 SFTP 上传到物理 Web 根。
- CSP 编译必须使用 WebApp 虚拟路径，不使用物理路径：`$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`。
- 不要使用：`$system.OBJ.Load("<physical-web-root>/csp/<file>.csp","c")`。
- 不要把 `.gb2312.csp` 作为编译目标。
- 不要把 `iris_execute.success=true` 当成编译成功；它只表示 ObjectScript 外层包装执行过。
- ObjectScript 包装代码必须输出并检查 `$SYSTEM.Status.IsError(sc)` 和 `$SYSTEM.Status.GetErrorText(sc)`。

## 验证

- 验证后端类存在且编译无错误。
- 验证 CSP 生成类名包含虚拟 URL 包名。虚拟 URL 含 `/csp/` 时，检查 `csp.csp.<page-name>`。
- 验证 CSP 生成类参数：`CSPFILE` 包含 `/csp/`，`CSPURL` 包含 `/csp/`。
- 验证代表性页面可加载，核心业务调用可用。
- 以上检查通过前，不得报告部署成功。
