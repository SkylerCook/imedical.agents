---
name: iris-frontend-gb2312-promote
description: Convert IRIS frontend files such as CSP, JavaScript, and CSS to GB2312 using convert-gb2312-upload.ps1, then with user confirmation replace the source files and optionally upload the replaced files through the target project's MCP/SFTP tooling.
---

# IRIS 前端 GB2312 提升

## 职责

当用户要求把前端源文件转换为 GB2312，并将转换后的 `{name}.gb2312.{ext}` 文件提升回原文件名时，使用本 skill。

本 skill 负责编排目标工程中已有的 `.agents/scripts/convert-gb2312-upload.ps1` 脚本。不要在 skill 内重写编码转换逻辑。

## 必读上下文

执行流程前先读取：

1. 目标工程 `.agents/config/iris_project_profile.md`。
2. `rules/iris_coding_workflow.md`。
3. `rules/iris_gb2312_workflow.md`。
4. 仅当用户要求上传或服务器部署时，读取目标工程 `.mcp.json`。

## 输入

- 一个或多个前端文件路径，通常是 `.csp`、`.js` 或 `.css`。
- 可选：用户明确要求跳过替换确认。
- 可选：用户明确要求替换后上传。

## 工作流

1. 文件预检查：
   - 解析每个源文件路径，并确认文件存在。
   - 确认 `.agents/scripts/convert-gb2312-upload.ps1` 存在；如果不存在，提示用户先运行 `coding-iris-init`。
   - 对每个源文件，在同一目录计算 `{name}.gb2312{ext}` 输出路径。
   - 如果任何计算出的 `.gb2312` 输出文件已经存在，立即停止并报告冲突，不得覆盖。
2. 转换：
   - 运行：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/convert-gb2312-upload.ps1 -Files @("path/to/file.csp")
     ```
   - 解析 JSON 输出。
   - 展示每个结果的 `file`、`encoding`、`converted` 和 `uploadPath`。
3. 确认替换：
   - 对 `converted=true` 的结果，询问用户是否确认删除源文件，并将 `uploadPath` 重命名为原源文件路径。
   - 如果用户在同一次请求中明确要求无需确认，可以跳过此确认。
   - 对 `converted=false` 的结果，不删除也不重命名任何文件，因为源文件已经被检测为 GB2312。
4. 确认后替换源文件：
   - 确认每个源文件路径和转换后路径都解析在当前工作区或明确的目标工程根目录内。
   - 只使用原生 PowerShell：
     - `Remove-Item -LiteralPath <source>`
     - `Move-Item -LiteralPath <converted> -Destination <source>`
   - 不要通过其它 shell 拼接删除或移动命令。
5. 确认上传：
   - 替换完成后，询问是否通过 MCP/SFTP 上传。
   - 只有用户确认后才上传。
   - 上传恢复为原文件名后的文件路径，不上传 `.gb2312` 临时路径。
   - 根据目标工程 `.mcp.json` 和当前可用的 MCP/SFTP 工具确定上传机制。
   - 不自动编译 CSP；只有用户另行要求时才编译。

## 安全规则

- 绝不静默删除源文件。
- 绝不覆盖已经存在的 `.gb2312` 输出文件。
- 用户未确认前不得上传，除非用户明确要求只上传。
- 不在本 skill 中保存服务器 host、namespace、凭据或远程路径。
- 如果任何文件转换或替换失败，立即停止，并报告已完成文件和待处理文件。

## 完成输出

报告：

- 已转换文件和检测到的编码。
- 已替换、已跳过或发生冲突的文件。
- 用户是否要求上传，以及上传是否已执行。
- 是否还存在遗留的 `.gb2312` 临时文件。
