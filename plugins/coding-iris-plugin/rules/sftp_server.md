---
name: sftp_server
description: Use when an IRIS task actually uses the SFTP MCP for remote read, upload, sync, or command execution.
task-affinity: [sftp, mcp, remote, upload, deploy]
related:
  - iris_coding_workflow.md
---

# sftp-server MCP 使用约束

本文记录通用 SFTP MCP 能力边界。不得把 `.mcp.json` 中的 host、用户名、密码、远端根目录、本地根目录或私有路径复制到本可复用插件文件。

## 能力矩阵

- `list_remote_directory`：只读列出远端目录。优先用于确认已配置远端根目录和目标子目录。
- `read_remote_file`：只读读取远端文件。大文件需使用 `max_size`、`offset`、`limit` 控制范围。
- `upload_file`：上传单个本地文件到单个远端路径。可能覆盖目标文件，必须先确认路径映射。
- `sync_directory`：从本地目录批量同步到远端目录，影响面大；仅在列出计划并得到用户明确要求后使用。
- `execute_remote_command`：通过 SSH 执行远端命令。除 `pwd`、`ls`、`test`、`head`、`tail`、`sed -n` 等明确只读命令外，一律按高风险处理。

## 冒烟测试结果：2026-06-01

已通过目标项目配置的 `sftp-server` 执行 JSON-RPC `tools/list` 和 `tools/call` 验证。

已通过：

- `list_remote_directory`：列出已配置远端根目录。
- `read_remote_file`：读取既有 CSP 文件。
- `execute_remote_command`：执行只读 `pwd`。
- `upload_file`：上传唯一临时探测文件。
- `read_remote_file`：读取该临时探测文件。
- `execute_remote_command`：只清理刚创建的探测文件。

## 部署规则

前端上传、GB2312 转换和 CSP 编译的完整规则见 `iris_coding_workflow.md`、`iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md`。本文只补充 SFTP MCP 特有约束：

- 执行 `upload_file` 前，必须显式比对源文件路径、转换后上传文件路径和远端目标路径。
- 执行 `sync_directory` 前，必须列出本地根目录、远端根目录并确认忽略规则。窄范围部署优先使用 `upload_file`，避免目录同步。
- 除非用户明确要求且命令范围受限，否则 `execute_remote_command` 不得用于 delete、move、chmod、service 等会改变远端状态的命令。
