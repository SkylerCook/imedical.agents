## IRIS 编码插件入口

本工程已接入 `coding-iris-plugin`。后续任务如涉及 IRIS ObjectScript、CSP、JavaScript、HISUI、MCP 上传编译或前端编码转换，先读取：

- 项目适配配置：`.agents/config/iris_project_profile.md`
- MCP 连接事实来源：`.mcp.json`
- 编码规则索引：`.agents/rules/iris_coding_index.md`
- 首次初始化：`.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`
- 统一编码入口：`.agents/skills/iris-coding/SKILL.md`
- 后端编码：`.agents/skills/iris-backend-coding/SKILL.md`
- 前端编码：`.agents/skills/iris-frontend-coding/SKILL.md`
- 前端 GB2312 转换后替换源文件：`.agents/skills/iris-frontend-gb2312-promote/SKILL.md`
- 远端部署、上传、编译、SFTP 同步或部署验证：`.agents/skills/iris-deploy/SKILL.md`

普通编码需求优先使用 `iris-coding`；明确的纯后端、纯前端、GB2312 promote 或远端部署任务可直接使用对应专项 skill。

`.agents/rules/` 和 `.agents/skills/` 中的 IRIS 编码文件可以是 thin-index；thin-index 应明确指向 `.agents/plugins/coding-iris-plugin/` 内真实 rules/skills。`coding-iris-init` 是 bootstrap skill，首次初始化不依赖 thin-index。

通用规则不得硬编码本工程服务器、namespace、远程路径、账号、密码、token、业务页面清单或业务类名前缀；这些差异以 `.agents/config/iris_project_profile.md` 和 `.mcp.json` 为准。
