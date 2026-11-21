# coding-iris-plugin 初始化指南

> **定位**：本文件是人类参考手册，供人工手动初始化时查阅。Agent 执行初始化时应直接读取 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`，该文件包含判断逻辑和分支处理，是唯一权威执行指令。

## 最小接入步骤

1. 将插件目录放到目标工程：

```text
.agents/plugins/coding-iris-plugin/
```

2. 直接读取 bootstrap skill：

```text
.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md
```

3. 初始化前端编码 wrapper：

```text
.agents/scripts/convert-gb2312-upload.ps1
.agents/scripts/check-frontend-encoding.ps1
```

运行插件的 `migrate-frontend-encoding-profile.ps1`：已知历史版本自动替换为指向插件 canonical 实现的薄 wrapper，用户定制版只报告冲突。`generate-plugin-thin-index.ps1` 不复制到目标工程。

4. 创建项目 profile：

```text
.agents/config/iris_project_profile.md
```

内容从 `templates/iris_project_profile.template.md` 填写。

按[本地配置步骤](../skills/coding-iris-init/SKILL.md#本地配置初始化与已有项目补齐)运行 `source-sync.js configure` 的 Write/Check。开发方式写入 `irisDevelopment`，connected 加按需上下文时同时生成缺失的 `irisRemotePolicy`。连接和源码基线沿各自任务接入。

已启用项目也可直接走正常 Write 更新，现有配置迁移会自动补缺文件；旧模式缺省与已有字节保持，无法确认的模式/环境及资格集中报告，由 Agent 根据事实补齐。available/disabled、DryRun/Check 不写入；不要求使用者手改 JSON 或每次重跑初始化。

5. 准备 IRIS 开发主力脚本配置：

标准工程可在工作台「编辑工程连接」承接已有目标或录入新的连接，再读回生成的宿主入口。

命令行初始化时，参考 `templates/project-connections.template.jsonc`，把已核实的档案和绑定合入当前 `ContextRoot/config/project.jsonc`。通过本机私有配置入口设置档案所用凭据；主配置仅保存引用。已有 `.mcp.json` 先核对目标及受管字段。获授权生成后，运行 `sync-env-config.js --check-profile` 复查实际绑定。

XML 导出有两个准备选项：部署能力包 `templates/DHCDoc/Util/XmlPackage.cls`（有经验证安装 XML 时一并提供），或选用默认受管 WS terminal 的系统 Export 通道（IRIS 2023.2+／Atelier API v7+ 预检）；HTTP MCP 是接受其内部重试的显式资格选项。初始化时会提示选择；启用插件不会自动导入编译服务器类，未部署可选类也不阻断其它编码能力。目标已有同名类先比对接口和内容，具体步骤见 [XML 协议](../references/iris-xml-export.md)。

按版本清单采集当前实例代码使用 [iris-code-baseline](../skills/iris-code-baseline/SKILL.md)，图片预筛排除并统计。纯采集不强制项目提交状态机或自动建 Git；多会话必须取得当前目标资格后启用，不能仅按样例填写 verified。

6. 生成 thin-index：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode DryRun `
  -ExcludeSkill coding-iris-init
```

确认后：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill coding-iris-init
```

7. 将 `templates/AGENTS.coding-iris-snippet.md` 合入目标工程 `AGENTS.md`。

8. 确认 `.agents/.git/info/exclude` 已隐藏本地生成层：

```gitignore
/config/
/memory/
/rules/
/skills/
/scripts/
```

这些规则用于避免 VS Code 的 `.agents` Git 仓库显示 profile、project-env、thin-index 和本地辅助脚本。不要写入 `.agents/.gitignore`。

## 验证清单

- 插件目录存在。
- 本地配置 Check 为 `configurationReady: true`；远端资格 `pending` 单列待验证，服务器 before-edit 基线按任务建立，不能用空目录代替。
- `check-frontend-encoding.ps1` wrapper 已生成到 `.agents/scripts/`；`convert-gb2312-upload.ps1` wrapper 只保留给明确的历史工程兼容流程。
- 有 frontend SourceRoot 时，`.agents/config/iris_project_profile.md` 使用 canonical `utf8`，并已通过实际文件字节验证；旧 `project-utf8` 会规范化，真实 GB2312/mixed/unknown 会停止迁移。Overlay manifest 明确只有 `backend` 时使用 `N/A (backend-only)`。
- `generate-plugin-thin-index.ps1` 保持在插件 `scripts/` 内并可直接调用。
- `.agents/config/iris_project_profile.md` 已填写工程差异（多仓库工作区只填通用项）。
- `.agents/config/project-env.json` 已创建并填写（可从 `.mcp.json` 反向填充）。
- `.mcp.json` 保存实际 MCP 连接事实。
- `.agents/rules/` 和 `.agents/skills/` 的 thin-index 指向插件真实文件。
- `.agents/.git/info/exclude` 已包含生成层忽略规则。
- 插件规则中没有源工程服务器、namespace、远程路径、业务类名前缀或凭据。
