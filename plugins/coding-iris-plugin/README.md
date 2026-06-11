# coding-iris-plugin

`coding-iris-plugin` 是面向 IRIS/ObjectScript/CSP/JavaScript/HISUI 工程的通用 Agent 编码能力包。

## 能力范围

- ObjectScript 后端编码规则：BLH/DATA/SQL 分层、SQL 返回约定、ObjectScript 语法风格、Broker 接口习惯。
- CSP/JavaScript/HISUI 前端编码规则：框架页/内容页拆分、HISUI 控件优先、JS 组织方式、前端数据回显。
- 工作流规则：本地优先；导出、编译、Broker 调试和配置同步优先使用 IRIS 开发主力脚本；MCP 作为辅助能力补上下文、只读验证或覆盖脚本未覆盖场景。
- 部署编排：`skills/iris-deploy/SKILL.md` 负责远端部署入口、清单生成、确认门禁和验证编排，上传、编译、部署和远端验证按 `rules/iris_deploy_checklist.md` 逐项执行。
- 前端编码保护：检查 `.csp/.js/.css` 实际编码，防止历史 GB2312/GBK 文件被 Agent 永久改成 UTF-8。
- 前端上传编码转换：按项目 profile 保持源文件编码，上传时按需转换为 GB2312 临时文件。
- 前端 GB2312 提升：确认后删除源文件，并将 `{name}.gb2312.{ext}` 更名回原文件名，可选 MCP/SFTP 上传。
- HISUI 控件参考：按需读取 `references/hisui-widget-index.md`，源码内置在 `.agents/vendor/hisui/`。
- IRIS 开发主力脚本：通过 `scripts/iris-tools/` 提供部署清单生成、导出、编译、Broker 调试和环境配置同步。
- MCP 能力说明：`rules/iris_agentic_dev.md` 记录 IRIS MCP 能力矩阵，`rules/sftp_server.md` 记录 SFTP MCP 能力矩阵和安全边界。

## 标准目录

```text
coding-iris-plugin/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- references/
|-- rules/
|-- skills/
|-- templates/
`-- scripts/
```

## 安装模式

默认使用 `plugin-reference-thin-index`：

1. 将本插件放到目标工程 `.agents/plugins/coding-iris-plugin/`。
2. 首次初始化时直接读取 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`。
3. 初始化流程复制 `convert-gb2312-upload.ps1` 和 `check-frontend-encoding.ps1` 到目标工程 `.agents/scripts/`。
4. 初始化流程直接调用插件内置 `scripts/generate-plugin-thin-index.ps1`；该脚本是 wrapper，实际委托根 `scripts/generate-plugin-thin-index.ps1`。
5. 初始化流程根据 `templates/iris_project_profile.template.md` 生成或提示创建 `.agents/config/iris_project_profile.md`。
6. 在浅层 `.agents/rules/` 和 `.agents/skills/` 生成 thin-index。

规则 thin-index 会传播源 rule 的 `description` 和 `task-affinity`，用于浅层发现和任务筛选。`task-affinity` 只是路由提示；匹配后仍必须继续读取 thin-index 中 `source` 指向的插件真实 rule。`references/` 只由真实 rule/skill 按需引用，不生成浅层 `.agents/rules/` 入口。

Skill thin-index 会传播真实 `SKILL.md` 的 `description`，用于浅层能力发现；匹配后仍必须继续读取 `source` 指向的插件真实 `SKILL.md`。

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

### 更新已部署工程

已部署过 `.agents/` 的业务工程，先在业务项目根目录重新执行 imedical.agents 一键部署脚本，使 `.agents/` 独立仓库拉取最新插件内容；再重建本插件 thin-index：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill coding-iris-init `
  -Force
```

重建脚本委托根 canonical thin-index 脚本执行：生成阶段只处理当前 `PluginPath`，stale 清理阶段会扫描 `.agents/rules/` 中所有指向 `.agents/plugins/*/rules/*.md` 的 thin-index，并移除源文件已不存在的旧 rule 入口，例如迁移到 `references/` 的 HISUI 控件参考入口。目标工程自定义规则不会被清理。

## 接入目标工程

1. 将 `templates/AGENTS.coding-iris-snippet.md` 合入目标工程 `AGENTS.md`。
2. 基于 `templates/iris_project_profile.template.md` 创建 `.agents/config/iris_project_profile.md`。
3. 检查目标工程 `.mcp.json` 是否包含实际需要的 IRIS/SFTP 能力。
4. 运行 thin-index dry-run，确认无冲突后再 write。
5. 普通编码任务优先使用 `iris-coding` 统一入口，由它按任务范围路由到后端、前端、工作流或 promote 流程。
6. 明确的纯后端任务可直接使用 `iris-backend-coding`，明确的纯前端任务可直接使用 `iris-frontend-coding`。
7. 明确要求部署、上传、编译、SFTP 同步、CSP 编译或远端部署验证时，使用 `iris-deploy`。
8. 需要把转换后的 GB2312 文件替换源文件时，使用 `iris-frontend-gb2312-promote`。

## IRIS 开发主力脚本

`scripts/iris-tools/` 中的 Node.js 脚本是 IRIS 工程的首选执行路径：

- `export.js`：从 IRIS 导出类、JS 或 CSP。
- `compile.js`：上传并编译本地类文件。
- `debugger.js`：调用 Web Broker 方法做快速调试。
- `sync-env-config.js`：仅当 `.agents/config/project-env.json` 是事实来源时，从它生成 `.mcp.json`。
- `prepare-deploy-manifest.js`：根据文件列表或 git diff 生成 IRIS 部署 JSON 清单；只做本地分析，不执行上传、编译或远端写入。

首次使用前先确认配置事实来源：

- 已有 `.mcp.json`：从 `.mcp.json` 反向生成或补齐 `.agents/config/project-env.json`，不要运行 `sync-env-config.js` 覆盖现有 `.mcp.json`。
- 没有 `.mcp.json`：复制模板并填写真实环境，再运行 `sync-env-config.js` 生成 `.mcp.json`。

```powershell
New-Item -ItemType Directory -Force .agents/config
Copy-Item .agents/plugins/coding-iris-plugin/templates/project-env.template.json .agents/config/project-env.json
notepad .agents/config/project-env.json
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
```

常用调用：

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <文件标识符>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js <文件名或路径> [命名空间]
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class <ClassName> --method <MethodName>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --files <path...>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --from-git --base HEAD
```

`.agents/config/project-env.json` 和 `.mcp.json` 可能包含账号、密码、服务器地址等敏感信息，应由目标工程本地维护，不提交到业务项目版本库。

## 前端 GB2312 提升流程

当需要把 UTF-8 前端源文件永久转换为 GB2312 时：

1. 使用 `iris-frontend-gb2312-promote`。
2. 该技能调用目标工程 `.agents/scripts/convert-gb2312-upload.ps1`。
3. 转换后先展示 JSON 结果。
4. 用户确认后，删除源文件并将 `{name}.gb2312.{ext}` 重命名为原文件名。
5. 用户再次确认后，才通过 MCP/SFTP 上传替换后的原文件。

## 前端编码保护

历史 HIS 前端 `.csp`、`.js`、`.css` 文件可能是 GB2312/GBK。普通前端修改必须保持源文件原编码，不得为了编辑方便永久保存为 UTF-8。

目标工程 profile 要求前端 GB2312 时，收尾检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/check-frontend-encoding.ps1 -Files @(
  "path/to/page.csp",
  "path/to/page.js"
) -ExpectedEncoding gb2312 -ErrorOnMismatch
```

上传转换脚本只生成临时上传产物，不代表源文件允许编码漂移。

## 去项目化边界

本插件不保存服务器地址、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。这些内容只能存在于目标工程 `.agents/config/iris_project_profile.md` 或 `.mcp.json`。
## 部署可靠性要点

- 持久化实体类上传前去掉整个 `Storage Default { ... }` 块，由 IRIS 编译重新生成 Storage。
- 类文件部署先整组上传依赖切片，再按依赖顺序编译；不要边上传边逐个编译。
- 前端 GB2312 转换文件只作为上传临时件，远端文件名映射回原始目标文件名。
- 前端 GB2312/GBK 源文件修改后仍保持原编码；上传转换不是源文件转码许可。
- CSP 编译使用 WebApp 虚拟路径 `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`，并检查内层 status、生成类、`CSPFILE`、`CSPURL`。
- 插件不保存服务器地址、账号、namespace、token、Cookie 或远端绝对路径。

## 脚本配置来源

脚本运行所需环境值统一来自目标工程本地私有文件 `.agents/config/project-env.json`：

- `iris.namespace`：类上传、编译、导出使用的 IRIS namespace；脚本不提供项目化默认值。
- `web.basePath`：IRIS Atelier doc API 下的 Web 根前缀，用于 JS/CSS/Broker 路径。
- `web.cspBasePath`：IRIS Atelier doc API 下的 CSP 前缀，通常是 `<web-root-prefix>/csp`。
- `web.brokerPath`：Broker 请求路径；未配置时仅在 `web.basePath` 已配置时使用 `csp/websys.Broker.cls`。
- `web.cookie`：可选 Broker 调试 Cookie；也可用 `debugger.js --cookie "<cookie>"` 临时传入。Cookie 属于敏感值，只能放在本地私有配置或命令行临时参数中。

缺少必要配置时脚本应直接报错，避免静默拼出错误路径。
