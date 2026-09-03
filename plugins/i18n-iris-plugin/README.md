# i18n-iris-plugin

`i18n-iris-plugin` 是面向 IRIS/ObjectScript/CSP/HISUI 工程的通用 i18n Agent 能力包，覆盖：

- 前后端 i18n 编码改造。
- 前端复用 coding-iris 的 canonical `utf8` 与字节检测门禁，不单独按标版、医院项目或目录角色推断编码；旧模式只按兼容边界读取。
- 前端翻译 helper 稳定 key 门禁：静态 helper 只接收字面量，运行时值通过占位符 helper 参数传入，并由只读 Node.js 检查器阻断动态 key。
- 用户可见文本提取和翻译表生成。
- 页面级非字典翻译种子生成。
- 页面翻译种子默认收敛到 canonical `DHCDoc.I18n.PageTranslationSeed`，并保留目标工程 profile 覆盖。
- 字典/表字段展示值翻译 SQL 生成。
- XML 打印模板翻译。
- 已确认 XML 模板链路的打印模板导出、校验和同步。
- XML 打印模板远端保存遇到临时类 `Execute+...<SYNTAX>` 时，复用既有本地产物并自动切换 Base64 分块 fallback，避免重复导出和翻译。
- CSP 页面翻译导出、校验和同步。
- 新工程 i18n 初始化。
- i18n 任务 Step 0 启动契约：开工即确定运行模式、创建 manifest、声明文件所有权，并分别确认翻译数据写入与业务代码部署授权。

## 设计原则

- 插件包只提供通用能力，不绑定具体工程。
- 目标工程差异写入 `.agents/config/i18n_project_profile.md`。
- MCP 连接信息以目标工程 `.mcp.json` 为唯一事实来源。
- 页面级翻译默认沿用 `^websys.TranslationD("PAGE",...)`。
- 页面翻译种子默认类为 `DHCDoc.I18n.PageTranslationSeed`，默认相对源码路径为 `DHCDoc/I18n/PageTranslationSeed.cls`；本地完整路径从项目 backend SourceRoot 解析。稳定公共方法为 `SetPageTrans` / `KillPageTrans`，语言聚合方法为 `Load{LANG}Translation` / `Kill{LANG}Translation`。
- 插件携带 `templates/DHCDoc/I18n/PageTranslationSeed.cls` canonical 源模板；页面翻译种子任务可在目标类缺失时据此创建，但初始化和能力包更新不得覆盖业务源码。
- 字典翻译默认沿用 `BDP_Translation`。
- 固定默认类不合并字典翻译 SQL 或 XML 模板同步；目标工程已有不同页面翻译机制时，通过 `.agents/config/i18n_project_profile.md` 覆盖，不修改通用 skill/rule。

## 已部署项目兼容

- 更新能力包只更新插件 canonical 内容，不覆盖目标项目已有 `.agents/config/i18n_project_profile.md`。
- 旧 profile 若仍包含 `TODO: Package.UploadPageTrans.cls` 或其它未确认占位值，应在下一次页面翻译任务开始前改为 `DHCDoc.I18n.PageTranslationSeed`，并将相对源码路径收敛为 `DHCDoc/I18n/PageTranslationSeed.cls`。
- 已验证存在其它兼容种子类的项目继续保留原 profile 覆盖；不得仅为命名统一迁移业务类。
- 能力包更新、profile 调整均不授权上传、编译或加载翻译；这些远程动作仍按当前任务单独确认。
- 已部署项目若目标类缺失，先在本地页面翻译种子任务中从 canonical 模板创建并完成 diff/依赖检查；不得把“插件已有模板”解释为已部署、已编译或已加载。
- 更新后，只有 `plugin_profile.md` 中 `i18n-iris-plugin` 为 `enabled` 且任务或 diff 命中 i18n 信号时，coding-iris 前端路由才追加 i18n 规则；普通前端需求不会自动进入完整 i18n workflow。

## 标准目录

```text
i18n-iris-plugin/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- rules/
|-- skills/
|-- scripts/
`-- templates/
```

## 安装模式

默认使用 `plugin-reference-thin-index`：

- 插件保留在 `.agents/plugins/i18n-iris-plugin/`。
- 使用插件内置脚本生成浅层 thin-index；该脚本是 wrapper，实际委托根 `scripts/generate-plugin-thin-index.ps1`。
- 目标工程 `.agents/rules/` 和 `.agents/skills/` 只放 thin-index，指向插件内真实 rules/skills。
- 首次初始化入口不依赖 thin-index；AI 应直接读取 `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`。

规则 thin-index 会传播源 rule 的 `description` 和 `task-affinity`，用于浅层发现和任务筛选。`task-affinity` 只是路由提示；匹配后仍必须继续读取 thin-index 中 `source` 指向的插件真实 rule。`references/` 只由真实 rule/skill 按需引用，不生成浅层 `.agents/rules/` 入口。

Skill thin-index 会传播真实 `SKILL.md` 的 `description`，用于浅层能力发现；匹配后仍必须继续读取 `source` 指向的插件真实 `SKILL.md`。

`i18n-project-init` 是 bootstrap skill，负责安装、检查、生成 profile 和调用 thin-index 脚本。安装完成后的日常能力入口才通过浅层 thin-index 触发。

生成前先 dry-run：

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

如需后续通过浅层入口重新检查、升级或重建索引，可以去掉 `-ExcludeSkill i18n-project-init`，为 bootstrap skill 也生成 thin-index。

同时支持：

- `copy`：兼容模式，复制 rules/skills/templates 到目标工程 `.agents/`。
- `plugin-reference`：纯插件模式，只保留插件目录，不生成 thin-index；仅适用于 Agent 明确支持插件发现的场景。

## 接入目标工程

1. 将本插件放到目标工程 `.agents/plugins/i18n-iris-plugin/`。
2. 确保插件内置 thin-index 脚本存在：`.agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1`。
3. 首次初始化时直接读取 `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`。
4. 将 `templates/AGENTS.i18n-snippet.md` 合入目标工程 `AGENTS.md`。
5. 从 `templates/i18n_project_profile.template.md` 生成目标工程 `.agents/config/i18n_project_profile.md`。
6. 配置目标工程 `.mcp.json`。
7. 使用 `i18n-project-init` 或 thin-index 脚本做初始化检查。

更多步骤见 `templates/i18n-init-guide.md`。

## 前端 helper 静态检查

根据目标工程 `.agents/config/i18n_project_profile.md` 中的 helper 名称，对本次触碰的 JS/CSP 文件执行：

```powershell
node .agents/plugins/i18n-iris-plugin/scripts/check-i18n-helper-usage.js `
  --file path/to/page.js `
  --file path/to/page.csp `
  --static-helper '$g' `
  --placeholder-helper '$trans'
```

检查器只读文件且仅使用 Node.js 内置模块。退出码 `0` 表示通过，`1` 表示发现动态翻译 key，`2` 表示参数或文件读取错误；错误包含文件、行、列和规则代码。
