# IRIS 脚本、MCP 与部署工作流规则

## GB2312 Promotion Workflow

Use `iris-frontend-gb2312-promote` when the user wants converted GB2312 output to replace the original frontend source files.

Required safety flow:

- Confirm every source file exists and no `{name}.gb2312{ext}` output already exists.
- Run `.agents/scripts/convert-gb2312-upload.ps1` and display the JSON results.
- Treat `converted=false` as already GB2312; do not delete or rename the source file.
- For `converted=true`, ask for confirmation before deleting the source and renaming the converted output back to the original file name, unless the same user request explicitly skipped confirmation.
- Before delete or move, verify resolved paths remain inside the current workspace or explicit target project root.
- Use only native PowerShell `Remove-Item -LiteralPath` and `Move-Item -LiteralPath`; do not chain deletion or moving through another shell.
- After replacement, ask separately whether to upload through MCP/SFTP.
- Upload only the restored original file path, never the `.gb2312` temporary file.
- Do not compile CSP automatically; compile only after a separate user request.

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

## 高风险操作

以下操作必须先说明影响并取得用户明确确认：

- 删除本地或远程文件。
- 批量覆盖、批量同步大量文件。
- 数据库 DDL/DML 变更。
- 修改 IRIS 安全资源、用户、角色、WebApp。
- 执行会改变远程状态的 shell 命令。
