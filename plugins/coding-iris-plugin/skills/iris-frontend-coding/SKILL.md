---
name: iris-frontend-coding
description: Implement or modify IRIS CSP, JavaScript, CSS, or HISUI frontend code. Use directly for clearly scoped frontend tasks; mixed or unclear frontend/backend requests start with iris-coding.
---

# IRIS Frontend Coding

修改 CSP、HTML、JS、CSS 前读取[前端命名与格式规范](../../references/frontend-coding-format.md)，最终 diff 后按同一规范复核。明确项目覆盖与 JS 兼容基线；格式规范只用于本次新增代码，原有代码的功能修改不附带格式化，历史代码不自动成为风格标准。

## Legacy GB2312 Promotion Routing

- Do not route current standard frontend work to GB2312 conversion; source, upload, and server runtime encoding are UTF-8.
- Only if the user explicitly identifies a historical GB2312 project and asks to delete the source file and rename `{name}.gb2312.{ext}` back to `{name}.{ext}`, switch to `iris-frontend-gb2312-promote`.
- The promote workflow requires a replacement confirmation unless the same user request explicitly says to skip confirmation.

## 使用时机

当任务涉及 CSP、HTML、JavaScript、CSS、HISUI 控件、页面布局、前端数据回显或前端 SFTP 上传时使用本 Skill。

## 路由与默认方法

执行路径统一由 rules/iris_coding_general.md 判定；guidanceMode 按共享 execution-guidance 协议解析。步骤可合并、重排，硬约束不变；不因文件数自动升级、不因 full/guarded 自动建 run。

## 部署方式

日常开发部署默认 direct，不要求需求号或 Git 基线会话；已有修改不触发基线确认。仅在用户或项目要求 guarded 时，在第一次修改前读取[建立会话要求](../../references/deployment-protection.md#建立会话)。完整模式与保护范围见[部署契约](../../references/deployment-protection.md)。上传、编译仍需明确授权。

## 流程

1. 先读取目标工程 `.agents/config/iris_project_profile.md` 和 `.agents/config/plugin_profile.md`。修改前与最终 diff 后，均仅当 `iris-ui` 状态为 `enabled`，且任务或最终 diff 涉及标注/原型还原、布局/滚动/尺寸、操作图标、按主题切换控件、弹窗适配、主题条件变更、主题兼容或首屏闪烁时，追加读取 [UI 专项规则](../../../iris-ui/rules/iris_ui.md)；普通前端任务及 `available`/`disabled` 状态保持原流程。已启用但规则入口缺失时报告能力包不完整，暂停依赖该规则的 UI 阶段。此处只加载规则，后续继续当前编码流程。
2. 再读取 `rules/iris_coding_index.md`、`rules/iris_coding_general.md`、`rules/iris_coding_frontend.md`。
3. 修改前执行[条件 i18n 门禁](../../rules/iris_coding_frontend.md#条件-i18n-门禁)；启用状态、文案/helper 信号、缺失配置处理及专项路由只按该节判定。
4. HISUI 控件选型或 API 不确定时，读取 `references/hisui-widget-index.md` 并继续检查 `.agents/vendor/hisui/dist/js/jquery.hisui.js`；样式、图标或多语言资源不确定时，读取 `references/hisui-style-index.md` 并检查对应主题 CSS、locale CSS 和页面实际引入关系。
5. 仅当任务涉及上传、编码转换、远程读取或 CSP 编译时，再读取 `.mcp.json` 和 `rules/iris_coding_workflow.md`。
6. 本地搜索 HISUI 已有能力、现有页面和同类组件；控件、交互、状态、样式及视觉资源按“框架能力 → 目标工程公共能力 → 页面级最小实现”的顺序复用。
7. 内部解析目标路径对应的前端编码模式；canonical `utf8` 与兼容别名 `project-utf8` 都保持 UTF-8。每个文件修改前后均执行字节检测，正常时静默，异常时停止并报告。
8. 最终 diff 后再次执行同一条件 i18n 门禁；命中时完成该节要求的 helper 静态检查，失败必须停止。
9. 默认只做本地修改；当前部署链直接上传通过门禁的 UTF-8 源文件。只有用户明确指定历史 `standard-gb2312` 工程时才允许调用 legacy 转换器。
10. 用户已授权的 CSP 上传后，按[前端验证规则](../../rules/iris_coding_frontend.md#验证)执行指定目标编译及页面验证。

## 完成检查

- 最终 diff 的命名、格式、混合语言边界及历史契约已按前端规范复核；新文件检查完整内容。调用 review-agent 时传入冻结 diff、需求、范围、规范路径、项目覆盖、兼容基线和已有检查结果及覆盖项；无独立 Agent 时报告串行自审。

- 每个触碰的 `.csp` / `.js` / `.css` 修改前后均已通过目标模式对应的字节检查；正常完成只报告一行编码摘要。
- 控件、通用布局、交互、状态、图标、插图和视觉样式均已优先检查并复用 HISUI；没有框架能力时才使用目标工程公共能力或页面级最小实现。
- 自定义样式未复制或写死 HISUI 主题值，未用简写属性整体覆盖框架样式；涉及多主题或多语言资源时已核对目标页面实际加载的主题和 locale CSS。
- 按钮与状态标签遵循前端规则的控件视觉归属；悬浮、焦点、禁用或等待异常优先消除业务覆盖，并在实际 HISUI 主题验证状态组合。
- CSP 框架页、内容页和脚本职责清晰。
- JS 初始化、事件、数据加载、采集和工具函数分层明确。
- 表单值使用业务值，不用显示文案作为持久化值。
- 两次条件 i18n 门禁已完成；命中时翻译 helper key 已通过稳定字面量检查。
- 未引入源工程硬编码服务器、远程路径或业务页面清单。
