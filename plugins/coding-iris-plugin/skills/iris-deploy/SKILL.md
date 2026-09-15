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

## 前端上传加编译

优先直接调用 `scripts/iris-tools/deploy-frontend.js --source-root <frontend-root> --files <project-relative-file...> --execute`，参数与失败语义见 `scripts/iris-tools/README.md`。已有明确授权、目标和有效配置时使用一条命令，不再单独生成临时脚本、重复预检或逐工具确认。固定完成上传、哈希回读和指定 CSP 编译；无 `--execute` 只生成本地计划。失败停止，不自动重试或扩大文件范围。

## 执行顺序

仅编译 CSP 的固定入口（路径取部署清单中的 virtualPath）：

```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile-csp.js --documents <virtualPath.csp...>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile-csp.js --documents <virtualPath.csp...> --execute
```

第一条仅本地计划；第二条在上传完成且用户已明确授权部署后执行一次批量编译。直接编译明确指定的 show.csp，不自动编译父页面。禁止把已授权部署机械拆成逐工具重复确认。输出 `elapsedMs` 为编译请求及回包耗时，不能当作包含检查/上传/验收的总耗时。失败或结果不明时不自动重试，也不回退到 `iris_execute`。

1. 读取配置和项目规则，确认目标环境事实来源。
2. 生成部署清单，并按清单拆分后端类、CSP、Web 资源和其它文件。
3. 说明即将发生的远端写入、编译、SFTP 上传或验证影响，等待用户确认。
4. 后端类按 `iris_deploy_checklist.md` 执行：实体类先处理 Storage Default 风险，完整依赖切片先上传，再按依赖顺序编译。
5. Web 资源通过 UTF-8 字节门禁后直接上传原始源文件；只有用户明确指定历史 `standard-gb2312` 工程时，GB2312 临时文件才可作为上传内容，远端目标名仍保持原始文件名。
6. CSP 上传后使用 `scripts/iris-tools/compile-csp.js --documents <WebApp虚拟路径.csp> --execute`，通过 Atelier `action/compile` 编译明确目标；检查顶层及逐文档错误。默认直接编译指定 show.csp，不自动扩展父页面；生成类参数和页面功能另行验证。
7. 执行远端只读验证，确认类编译状态、CSP 生成类参数、代表性页面加载和核心业务调用。

## 工具优先级

- 项目选择 `sftp.runtime=vendor` 时，使用 CapabilityRoot 下的 `vendor/sftp-server/src/main.py`；运行前按 vendor README 检查解释器依赖、可信主机密钥、LOCAL_PATH/REMOTE_PATH 映射。旧的个人目录工具不视为 vendor 实现。
- vendor 单文件上传先回读 SHA-256 再原子替换；不支持 `posix-rename` 时停止，不降级为直接覆盖。目录同步先用 `dry_run: true` 生成实际差异，再按明确授权范围执行。MCP `isError` 或结果 `partial-failure` 均不是成功。

- 本地源码、项目规则和 `scripts/iris-tools/` 优先。
- `prepare-deploy-manifest.js` 用于清单生成。
- `compile.js` 仅用于 `.cls/.mac/.inc` 等 IRIS 文档类文件，不作为 CSP 编译入口。
- 后端 MCP 用于脚本未覆盖的只读验证、低风险 compile 验证和 `iris_execute`。
- `sftp-server` 仅在目标项目 `.mcp.json` 或 `project-env.json` 明确启用时使用。

## 完成标准

部署完成前必须逐项检查 `rules/iris_deploy_checklist.md` 的验证章节。没有完成验证时，只能报告“已执行上传/编译步骤，验证未完成”，不得报告部署成功。

部署和本地验证完成后仍停在 `acceptance-pending`。部署过程中产生可跨场景复用的新经验时，也必须遵循 `.agents/agents/_shared/delivery-lifecycle.md` 和 `agent-framework-feedback`：用户明确验收后先做只读审查，只有逐项授权后才按 `feedback/experience/deploy-com-exp.md` 维护；不要写入敏感连接信息、完整命令输出或一次性排障流水。
