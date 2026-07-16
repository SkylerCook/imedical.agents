---
name: iris-frontend-coding
description: Use when working on CSP, JavaScript, CSS, or HISUI frontend code with coding-iris-plugin frontend rules and the target project's profile.
---

# IRIS Frontend Coding

## GB2312 Promotion Routing

- If GB2312 conversion is only needed as a temporary upload artifact, keep using the normal frontend workflow and `rules/iris_coding_workflow.md`.
- If the user asks to delete the source file and rename `{name}.gb2312.{ext}` back to `{name}.{ext}`, switch to `iris-frontend-gb2312-promote`.
- The promote workflow requires a replacement confirmation unless the same user request explicitly says to skip confirmation.

## 使用时机

当任务涉及 CSP、HTML、JavaScript、CSS、HISUI 控件、页面布局、前端数据回显或前端 SFTP 上传时使用本 Skill。

## 流程

1. 先读取目标工程 `.agents/config/iris_project_profile.md`。
2. 再读取 `rules/iris_coding_index.md`、`rules/iris_coding_general.md`、`rules/iris_coding_frontend.md`。
3. 仅当 HISUI 控件选型或 API 不确定时，读取 `references/hisui-widget-index.md`，再读 `.agents/vendor/hisui/dist/js/jquery.hisui.js` 查看源码。
4. 仅当任务涉及上传、编码转换、远程读取或 CSP 编译时，再读取 `.mcp.json` 和 `rules/iris_coding_workflow.md`。
5. 本地搜索现有页面和同类组件，优先沿用目标工程页面结构和公共样式。
6. 内部解析目标路径对应的前端编码模式；`standard-gb2312` 保持 GB2312，`project-utf8` 保持 UTF-8。每个文件修改前后均执行字节检测，正常时静默，异常时停止并报告。
7. 默认只做本地修改；仅 `standard-gb2312` 可在部署链中使用 GB2312 转换，`project-utf8` 禁止调用转换器。
8. CSP 编译必须按工作流规则使用 WebApp 虚拟路径，并验证 `$system.OBJ.Load` 内层 status、生成类、`CSPFILE` 和 `CSPURL`。

## 完成检查

- 每个触碰的 `.csp` / `.js` / `.css` 修改前后均已通过目标模式对应的字节检查；正常完成只报告一行编码摘要。
- 优先使用 HISUI 控件，不自造弹窗、按钮、面板或表单控件。
- CSP 框架页、内容页和脚本职责清晰。
- JS 初始化、事件、数据加载、采集和工具函数分层明确。
- 表单值使用业务值，不用显示文案作为持久化值。
- 未引入源工程硬编码服务器、远程路径或业务页面清单。
