# coding-iris-plugin

`coding-iris-plugin` 是面向 IRIS/ObjectScript/CSP/JavaScript/HISUI 工程的通用 Agent 编码能力包。

## 能力范围

- ObjectScript 后端编码规则：BLH/DATA/SQL 分层、SQL 返回约定、ObjectScript 语法风格、Broker 接口习惯。
- CSP/JavaScript/HISUI 前端编码规则：框架页/内容页拆分、HISUI 控件优先、JS 组织方式、前端数据回显。
- 工作流规则：本地优先、MCP 只读补上下文、用户明确要求时再上传/编译。
- 前端上传编码转换：UTF-8 源文件按需转换为 GB2312 临时文件后上传。
- 前端 GB2312 提升：确认后删除源文件，并将 `{name}.gb2312.{ext}` 更名回原文件名，可选 MCP/SFTP 上传。
- HISUI 控件源码索引：通过目标工程 profile 的 `HISUI_SRC` 定位源码。

## 标准目录

```text
coding-iris-plugin/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- rules/
|-- skills/
|-- templates/
`-- scripts/
```

## 安装模式

默认使用 `plugin-reference-thin-index`：

1. 将本插件放到目标工程 `.agents/plugins/coding-iris-plugin/`。
2. 首次初始化时直接读取 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`。
3. 初始化流程复制 `convert-gb2312-upload.ps1` 到目标工程 `.agents/scripts/`。
4. 初始化流程直接调用插件内置 `scripts/generate-plugin-thin-index.ps1`。
5. 初始化流程根据 `templates/iris_project_profile.template.md` 生成或提示创建 `.agents/config/iris_project_profile.md`。
6. 在浅层 `.agents/rules/` 和 `.agents/skills/` 生成 thin-index。

默认 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode DryRun `
  -ExcludeSkill coding-iris-init
```

确认后写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill coding-iris-init
```

`coding-iris-init` 是 bootstrap skill，默认从 thin-index 排除，避免安装完成后再次触发安装流程。

## 接入目标工程

1. 将 `templates/AGENTS.coding-iris-snippet.md` 合入目标工程 `AGENTS.md`。
2. 基于 `templates/iris_project_profile.template.md` 创建 `.agents/config/iris_project_profile.md`。
3. 检查目标工程 `.mcp.json` 是否包含实际需要的 IRIS/SFTP 能力。
4. 运行 thin-index dry-run，确认无冲突后再 write。
5. 后端任务使用 `iris-backend-coding`，前端任务使用 `iris-frontend-coding`。
6. 需要把转换后的 GB2312 文件替换源文件时，使用 `iris-frontend-gb2312-promote`。

## 前端 GB2312 提升流程

当需要把 UTF-8 前端源文件永久转换为 GB2312 时：

1. 使用 `iris-frontend-gb2312-promote`。
2. 该技能调用目标工程 `.agents/scripts/convert-gb2312-upload.ps1`。
3. 转换后先展示 JSON 结果。
4. 用户确认后，删除源文件并将 `{name}.gb2312.{ext}` 重命名为原文件名。
5. 用户再次确认后，才通过 MCP/SFTP 上传替换后的原文件。

## 去项目化边界

本插件不保存服务器地址、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。这些内容只能存在于目标工程 `.agents/config/iris_project_profile.md` 或 `.mcp.json`。
