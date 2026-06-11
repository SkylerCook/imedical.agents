# i18n-iris-plugin 初始化操作说明

## 职责边界

本文是 `i18n-iris-plugin` 的初始化说明和交付手册，用于解释目录结构、接入步骤和首次试运行顺序。

Agent 实际执行初始化时，以 `skills/i18n-project-init/SKILL.md` 为准。若本文与该 Skill 冲突，以 Skill 为准，并同步修正本文。

## 1. 准备插件包

标准插件结构：

```text
i18n-iris-plugin/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- rules/
|-- skills/
`-- templates/
```

插件包自身就是分发源，目标工程接入时以插件根目录为准。不要在插件外再维护一套同名模板源，避免两处漂移。

## 2. 安装模式

推荐默认使用 `plugin-reference-thin-index`：

- `plugin-reference-thin-index`：保留插件目录 `.agents/plugins/i18n-iris-plugin/`，通过插件内置脚本 `.agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1` 在目标工程 `.agents/rules/` 和 `.agents/skills/` 生成 thin-index。
- `copy`：兼容模式。将插件 rules/skills/templates 复制到目标工程 `.agents/`，适用于不支持插件发现的 Agent 或不保留插件目录的工程。
- `plugin-reference`：纯插件模式。只保留插件目录，不生成 thin-index；仅适用于 Agent 明确支持插件发现的场景。

首次初始化不依赖 shallow `.agents/skills/i18n-project-init/SKILL.md`。AI 应直接读取插件真实 bootstrap skill：

```text
.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md
```

安装完成后的日常 i18n 能力才通过 `.agents/rules/` 和 `.agents/skills/` 的 thin-index 触发。

thin-index 生成脚本先 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/i18n-iris-plugin `
  -ProjectRoot . `
  -Mode DryRun `
  -ExcludeSkill i18n-project-init
```

确认后写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/i18n-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill i18n-project-init
```

如果脚本不可用，才手工创建 thin-index。手工 thin-index 不复制规则全文，只写真实插件文件路径和“继续读取目标插件文件”的指令。

如需后续通过 shallow skill 重新检查、升级或重建索引，可以去掉 `-ExcludeSkill i18n-project-init`，为 bootstrap skill 也生成 thin-index。

当 `PluginPath` 使用相对路径时，脚本按 `ProjectRoot` 解析插件位置；如需引用工程外插件，应传入绝对路径。

## 3. 接入目标工程

1. 将插件放入目标工程 `.agents/plugins/i18n-iris-plugin/`。
2. 直接读取插件内 `skills/i18n-project-init/SKILL.md` 执行首次初始化。
3. 将插件 `templates/AGENTS.i18n-snippet.md` 合入目标工程 `AGENTS.md`。
4. 从插件 `templates/i18n_project_profile.template.md` 生成目标工程 `.agents/config/i18n_project_profile.md`。
5. 配置目标工程 `.mcp.json`。
6. 默认采用 `plugin-reference-thin-index` 生成 shallow `.agents/rules/`、`.agents/skills/` 日常入口，并默认排除 `i18n-project-init`。
7. 仅在兼容模式 `copy` 下复制插件 rules/skills/templates；仅在纯插件模式 `plugin-reference` 下省略 thin-index。
8. 确认 `.agents/.git/info/exclude` 已隐藏本地生成层：

   ```gitignore
   /config/
   /memory/
   /rules/
   /skills/
   /scripts/
   ```

   这些规则用于避免 VS Code 的 `.agents` Git 仓库显示 profile、thin-index 和本地辅助脚本。不要写入 `.agents/.gitignore`。

## 4. 初始化项目 profile

默认沿用当前 IRIS i18n 存储；只有目标工程确实不同时，才修改对应配置：

- 页面级翻译存储：默认 `^websys.TranslationD("PAGE", langId, pageCode, chineseSourceText)=targetText`。
- 字典翻译存储：默认 `BDP_Translation` 表及相关字段。

优先核对并填写：

- 源语言、源文案 key、默认目标语言。
- 语言目录事实来源。
- 前端/后端翻译 helper。
- HISUI 源码路径（内置在 `.agents/vendor/hisui/`）。
- 页面翻译种子类路径、类名、方法命名。
- CSP 翻译同步页面组、同步方法组、备份目录。
- 目标工程业务边界和生成文件是否入库。

不要在 profile 写：

- 服务器 IP、端口、服务器编号。
- 账号、密码、token。
- MCP server 的具体连接命令。
- SFTP 远程根路径。

这些连接信息统一放在目标工程 `.mcp.json` 或运行环境变量中。

## 5. 配置 `.mcp.json`

`.mcp.json` 是目标工程 MCP 连接唯一事实来源。

按目标工程实际情况配置：

- IRIS MCP server：用于执行命令、编译文档、执行类方法、SQL 查询。
- SFTP MCP server：需要部署源码到服务器时配置。
- 目标 namespace、远程路径、账号密码等环境参数。

插件不依赖固定 MCP server 名称，执行时只匹配能力。

## 6. 初始化校验

在目标工程执行静态搜索，确认通用 rules/skills 没有残留源工程硬编码：

```powershell
rg -n "旧服务器IP|固定namespace|旧工程页面前缀|旧种子类名|旧远程路径|固定MCP名称" .agents/rules .agents/skills .agents/plugins/i18n-iris-plugin/rules .agents/plugins/i18n-iris-plugin/skills
```

允许命中：

- `.agents/config/i18n_project_profile.md` 中的目标工程配置。
- `.mcp.json` 中的目标工程连接配置。
- 示例说明中明确标注为示例的内容。

## 7. 首次试运行顺序

按从只读到写入的顺序验证：

1. 使用 `i18n-text-extract` 对一个小页面或 JS 文件生成翻译表。
2. 使用 `i18n-page-trans-seed` 从一小份翻译表生成种子批次。
3. 使用 `i18n-csp-trans-sync` 的 `verify/report-only` 校验服务器翻译。
4. 只有用户明确要求后，才重写本地种子文件、SFTP 上传、编译、加载翻译。

## 8. 完成标准

- 通用 rules/skills 不需要为目标工程改代码。
- 目标工程差异集中在 `.agents/config/i18n_project_profile.md`。
- MCP 连接差异集中在 `.mcp.json`。
- 本地生成层由 `.agents/.git/info/exclude` 隐藏，不污染 `.agents` Git 列表。
- `AGENTS.md` 能告诉后续 agent 如何触发 i18n 能力。
- 至少完成一次只读提取或 report-only 校验。
