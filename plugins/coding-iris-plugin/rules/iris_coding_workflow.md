---
name: iris_coding_workflow
description: Use when an IRIS task involves scripts, MCP access, upload, compile, deployment, or remote validation.
task-affinity: [iris, workflow, mcp, deploy, coding]
related:
  - iris_deploy_checklist.md
  - iris_gb2312_workflow.md
  - sftp_server.md
---

# IRIS 脚本、MCP 与部署工作流规则

本文只保留 IRIS 开发脚本、MCP 使用边界和部署主流程。部署逐项检查和 GB2312 提升细节已拆到独立规则，按任务需要读取，避免非部署任务加载过多上下文。

## 相关规则

- [IRIS 部署执行清单](iris_deploy_checklist.md)：当用户明确要求上传、编译、部署或验证远端结果时读取。
- [GB2312 提升流程](iris_gb2312_workflow.md)：当用户要求把 `{name}.gb2312.{ext}` 替换回原始文件名时读取。
- [sftp-server MCP](sftp_server.md)：当任务实际使用 SFTP MCP 时读取其能力边界和特有约束。

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

目标工程应先确认本地私密配置事实来源：

- 已有 `.mcp.json`：从 `.mcp.json` 反向生成或补齐 `.agents/config/project-env.json`，不得运行 `sync-env-config.js` 覆盖现有 `.mcp.json`。
- 没有 `.mcp.json`：复制模板并填写 `.agents/config/project-env.json`，再运行 `sync-env-config.js` 生成 `.mcp.json`。

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

`.agents/config/project-env.json` 和 `.mcp.json` 可能包含敏感信息，必须只保留在目标工程本地，不写入插件规则、模板或项目记忆。

## 脚本能力边界

以下能力以脚本当前源码为准，不要按文件名自行扩展能力。

| 脚本 | 实际能力 | 适用场景 | 明确不能做 |
|---|---|---|---|
| `sync-env-config.js` | 从 `.agents/config/project-env.json` 生成 `.mcp.json`；支持可选 `sftp.enabled=true` 生成 `sftp-server` MCP | 仅当 `project-env.json` 是事实来源时初始化或同步 MCP 配置 | 不反向读取 `.mcp.json`；不验证远端连通性；不上传文件；不编译；不把敏感值写入插件 |
| `export.js` | 通过 IRIS Atelier API 导出 IRIS 文档；可识别类名、`.cls`、`.js`、`.csp`；JS/CSP 路径前缀来自 `web.basePath` / `web.cspBasePath` | 本地缺少类、CSP、JS 上下文时导出远端源码 | 不上传；不编译；不做 SFTP；不做 GB2312 转换 |
| `compile.js` | 通过 MCP 调用 `iris_doc mode=put` 上传 IRIS 文档，再调用 `iris_compile` 编译 | `.cls` 等后端 IRIS 文档的小范围上传与编译 | 不支持 CSP；不支持 SFTP；不处理 GB2312；不适合持久化实体类带 Storage 原文直接上传 |
| `debugger.js` | 通过 HTTP/HTTPS POST 调用 Broker/API；支持命令行或交互输入 Token、ClassName、MethodName、参数、URL、Cookie | 验证后端 Broker 方法、调试业务接口返回 | 不上传；不编译；不执行 SQL；不替代单元测试或页面访问验证 |

脚本使用规则：

- 只有当 `.agents/config/project-env.json` 是配置事实来源时，修改后才运行 `sync-env-config.js` 同步 `.mcp.json`；若 `.mcp.json` 已是事实来源，不要用脚本覆盖它。
- 需要导出源码时优先 `export.js`，本地已有最新源码时不要从远端覆盖本地。
- 后端类小范围验证可用 `compile.js`；批量部署、有 Storage 的实体类、复杂依赖链，按部署清单先处理源码和依赖顺序，不要盲目逐个调用 `compile.js`。
- CSP 的正确链路是：编码转换或确认编码 -> 项目上传能力/SFTP 上传 -> `iris_execute` 执行 WebApp 虚拟路径 `$system.OBJ.Load` -> 验证生成类和 `CSPFILE/CSPURL`。
- 如果目标项目没有 `sftp-server` MCP，脚本体系仍可用于后端导出、编译、Broker 调试和环境同步；前端上传交给项目既有工具或用户手工处理。

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
- CSP/JS/CSS 通过 SFTP 上传到物理 Web 根；CSP 编译必须使用 WebApp 虚拟路径调用 `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`。
- 不要使用物理 Web 根路径调用 `$system.OBJ.Load("<physical-web-root>/csp/<file>.csp","c")`。
- `iris_execute` 外层 `success=true` 只表示 ObjectScript 执行成功，不代表 `$system.OBJ.Load` 内层编译成功；执行代码必须输出并检查 `$SYSTEM.Status.IsError(sc)` 和 `$SYSTEM.Status.GetErrorText(sc)`。
- 编译后的类名应包含 CSP 运行包和虚拟 URL 段，例如虚拟路径含 `/csp/` 时通常检查 `csp.csp.<page-name>`，并确认 `CSPFILE`、`CSPURL` 都包含 `/csp/`。
- GB2312 临时文件只用于上传内容，远端目标名必须映射回原始文件名；不要把 `*.gb2312.*` 作为 CSP 编译目标。

## 高风险操作

以下操作必须先说明影响并取得用户明确确认：

- 删除本地或远程文件。
- 批量覆盖、批量同步大量文件。
- 数据库 DDL/DML 变更。
- 修改 IRIS 安全资源、用户、角色、WebApp。
- 执行会改变远程状态的 shell 命令。
