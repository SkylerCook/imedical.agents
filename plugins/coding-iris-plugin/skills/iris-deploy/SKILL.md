---
name: iris-deploy
description: Use when an IRIS project needs remote deployment planning, upload, compile, CSP compile, SFTP web asset deployment, or post-deploy verification for ObjectScript, CSP, JavaScript, CSS, or HISUI files.
---

# IRIS Deploy

## 核心边界

本 Skill 是 IRIS 项目部署编排入口。默认只做本地分析、部署清单生成和只读验证；上传、编译、SFTP 同步、远端命令、数据库变更或生产环境动作必须先说明影响并取得用户明确确认。

不要在插件内容中写入服务器地址、namespace、账号、密码、token、Cookie、远端绝对路径、业务页面清单、业务类名前缀或项目专属基类。这些事实只能来自目标工程本地配置和用户当次确认。

## 必读输入

1. 目标工程 `AGENTS.md`
2. 目标工程 `.agents/config/iris_project_profile.md`
3. 目标工程 `.agents/config/project-env.json`
4. 涉及 MCP、SFTP、上传、编译或远端验证时读取目标工程 `.mcp.json`
5. 插件规则 `rules/iris_deploy_checklist.md`

配置缺失时停止执行，并报告缺失字段名；不得臆造 namespace、Web 根、host、Cookie 或远端路径默认值。

## 部署清单

先生成或手工维护部署清单，再讨论执行动作。优先使用插件脚本：

```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --files <path...>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --from-git --base HEAD
```

脚本只输出 JSON 清单，不执行远端写入。用清单确认：

- `.cls/.mac/.inc` 对应 IRIS 文档名和是否需要 Storage Default 检查。
- `.csp` 对应 WebApp 虚拟编译路径。
- `.js/.css/.html` 对应 Web 资源路径。
- 是否存在无法分类或本地不存在的文件。

## 执行顺序

1. 读取配置和项目规则，确认目标环境事实来源。
2. 生成部署清单，并按清单拆分后端类、CSP、Web 资源和其它文件。
3. 说明即将发生的远端写入、编译、SFTP 上传或验证影响，等待用户确认。
4. 后端类按 `iris_deploy_checklist.md` 执行：实体类先处理 Storage Default 风险，完整依赖切片先上传，再按依赖顺序编译。
5. Web 资源按目标项目配置上传；GB2312 临时文件只作为上传内容，远端目标名保持原始文件名。
6. CSP 先上传到物理 Web 根，再用 `project-env.json -> web.cspBasePath` 拼出的虚拟路径执行 `$system.OBJ.Load(..., "c")`；不得用物理路径编译。
7. 执行远端只读验证，确认类编译状态、CSP 生成类参数、代表性页面加载和核心业务调用。

## 工具优先级

- 本地源码、项目规则和 `scripts/iris-tools/` 优先。
- `prepare-deploy-manifest.js` 用于清单生成。
- `compile.js` 仅用于 `.cls/.mac/.inc` 等 IRIS 文档类文件，不作为 CSP 编译入口。
- 后端 MCP 用于脚本未覆盖的只读验证、低风险 compile 验证和 `iris_execute`。
- `sftp-server` 仅在目标项目 `.mcp.json` 或 `project-env.json` 明确启用时使用。

## 完成标准

部署完成前必须逐项检查 `rules/iris_deploy_checklist.md` 的验证章节。没有完成验证时，只能报告“已执行上传/编译步骤，验证未完成”，不得报告部署成功。

部署过程中产生可跨场景复用的新经验时，按 `docs/deploy-com-exp.md` 的维护规则沉淀；不要写入敏感连接信息、完整命令输出或一次性排障流水。
