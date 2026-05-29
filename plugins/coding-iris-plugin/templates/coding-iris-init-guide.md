# coding-iris-plugin 初始化指南

## 最小接入步骤

1. 将插件目录放到目标工程：

```text
.agents/plugins/coding-iris-plugin/
```

2. 直接读取 bootstrap skill：

```text
.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md
```

3. 复制编码转换脚本到目标工程：

```text
.agents/scripts/convert-gb2312-upload.ps1
```

若目标工程已有同名脚本且内容不同，不要静默覆盖，先报告冲突。`generate-plugin-thin-index.ps1` 不复制到目标工程，保持在插件内使用。

4. 创建项目 profile：

```text
.agents/config/iris_project_profile.md
```

内容从 `templates/iris_project_profile.template.md` 填写。

5. 准备 IRIS 开发主力脚本配置：

```powershell
New-Item -ItemType Directory -Force .agents/config
Copy-Item .agents/plugins/coding-iris-plugin/templates/project-env.template.json .agents/config/project-env.json
notepad .agents/config/project-env.json
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
```

`.agents/config/project-env.json` 用于保存目标工程本地 IRIS/MCP/VSCode 环境配置，可能包含账号、密码、服务器地址和本机路径，不应提交到业务项目版本库。

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

## 验证清单

- 插件目录存在。
- `convert-gb2312-upload.ps1` 已复制到 `.agents/scripts/`。
- `generate-plugin-thin-index.ps1` 保持在插件 `scripts/` 内并可直接调用。
- `.agents/config/iris_project_profile.md` 已填写工程差异。
- `.agents/config/project-env.json` 已由用户从模板复制并填写。
- `node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js` 可生成 `.mcp.json`。
- `.mcp.json` 保存实际 MCP 连接事实。
- `.agents/rules/` 和 `.agents/skills/` 的 thin-index 指向插件真实文件。
- 插件规则中没有源工程服务器、namespace、远程路径、业务类名前缀或凭据。
