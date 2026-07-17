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
3. HISUI 控件选型或 API 不确定时，读取 `references/hisui-widget-index.md` 并继续检查 `.agents/vendor/hisui/dist/js/jquery.hisui.js`；样式、图标或多语言资源不确定时，读取 `references/hisui-style-index.md` 并检查对应主题 CSS、locale CSS 和页面实际引入关系。
4. 仅当任务涉及上传、编码转换、远程读取或 CSP 编译时，再读取 `.mcp.json` 和 `rules/iris_coding_workflow.md`。
5. 本地搜索 HISUI 已有能力、现有页面和同类组件；控件、交互、状态、样式及视觉资源按“框架能力 → 目标工程公共能力 → 页面级最小实现”的顺序复用。
6. 内部解析目标路径对应的前端编码模式；`standard-gb2312` 保持 GB2312，`project-utf8` 保持 UTF-8。每个文件修改前后均执行字节检测，正常时静默，异常时停止并报告。
7. 默认只做本地修改；仅 `standard-gb2312` 可在部署链中使用 GB2312 转换，`project-utf8` 禁止调用转换器。
8. CSP 编译必须按工作流规则使用 WebApp 虚拟路径，并验证 `$system.OBJ.Load` 内层 status、生成类、`CSPFILE` 和 `CSPURL`。

## 完成检查

- 每个触碰的 `.csp` / `.js` / `.css` 修改前后均已通过目标模式对应的字节检查；正常完成只报告一行编码摘要。
- 控件、通用布局、交互、状态、图标、插图和视觉样式均已优先检查并复用 HISUI；没有框架能力时才使用目标工程公共能力或页面级最小实现。
- 自定义样式未复制或写死 HISUI 主题值，未用简写属性整体覆盖框架样式；涉及多主题或多语言资源时已核对目标页面实际加载的主题和 locale CSS。
- CSP 框架页、内容页和脚本职责清晰。
- JS 初始化、事件、数据加载、采集和工具函数分层明确。
- 表单值使用业务值，不用显示文案作为持久化值。
- 未引入源工程硬编码服务器、远程路径或业务页面清单。
