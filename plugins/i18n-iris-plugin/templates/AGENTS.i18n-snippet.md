## i18n 支持入口

本工程已接入 `i18n-iris-plugin`。后续任务如果涉及多语言编码、文本提取、翻译种子、字典翻译、XML 模板翻译或服务器翻译同步，先读取：

- 项目适配配置：`.agents/config/i18n_project_profile.md`
- MCP 连接事实来源：`.mcp.json`
- i18n 规则索引：`.agents/rules/i18n_index.md`
- i18n 首次初始化：`.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`
- i18n 编码改造：`.agents/skills/i18n-coding/SKILL.md`
- i18n 文本提取：`.agents/skills/i18n-text-extract/SKILL.md`
- 页面翻译种子：`.agents/skills/i18n-page-trans-seed/SKILL.md`
- 字典翻译种子：`.agents/skills/i18n-bdp-trans-seed/SKILL.md`
- XML 模板翻译：`.agents/skills/i18n-xml-template/SKILL.md`
- CSP 翻译同步：`.agents/skills/i18n-csp-trans-sync/SKILL.md`


`.agents/rules/` 和 `.agents/skills/` 中的 i18n 文件可以是薄索引；薄索引应明确指向 `.agents/plugins/i18n-iris-plugin/` 内的真实 rules/skills。若目标工程采用纯插件模式且没有薄索引，则直接读取插件内对应文件。
`i18n-project-init` 是 bootstrap skill，首次初始化不依赖薄索引；安装后的日常 i18n 能力才通过浅层 rules/skills 入口触发。
只读取与当前任务匹配的 i18n skill，不要泛读 `.agents/skills/*/SKILL.md`，避免与目标工程自有业务 skill 混淆。

i18n 通用 rules/skills 必须保持去工程化：不硬编码当前服务器、MCP server 名称、IRIS namespace、远程路径、业务页面清单或固定种子方法名。项目差异写入 `.agents/config/i18n_project_profile.md`，MCP 连接信息以 `.mcp.json` 为准。

页面级翻译默认沿用 `^websys.TranslationD("PAGE",...)`，字典翻译默认沿用 `BDP_Translation`；只有目标工程已有不同机制时才覆盖 profile。
