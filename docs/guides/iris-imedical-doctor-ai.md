# 医生站 AI 插件接入

组件为 iris-imedical-doctor-ai，依赖 coding-iris-plugin。按[安装更新手册](../update-agents.md)取得能力包；目录存在只代表 available，明确接入时使用[初始化技能](../../plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai-init/SKILL.md)。

## 接入与使用

1. 读取目标工程 AGENTS 和现有 IRIS、插件配置。standard 和 Overlay 均按实际 ContextRoot/CapabilityRoot 定位。
2. 确认 coding-iris-plugin 已启用且依赖兼容；复用现有配置，不创建固定工程连接、目录或原型。
3. 初始化仅维护本插件状态和日常技能薄索引；纯 init 直接读取插件真实 SKILL.md，不生成日常 init 薄索引。保留已有自定义入口。
4. 用[开发技能](../../plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai/SKILL.md)处理医生站 AI 嵌入、交互卡片、诊断采纳与业务联动，按当前工程能力适配。

## 项目验证

按[验证说明](../../plugins/iris-imedical-doctor-ai/references/verification.md)检查入口权限、参数、数据范围、控件事件与运行依赖。共享页面还要覆盖未启用 Chat 的传统入口，AI 通知缺失或失败不能阻断原业务。编译、部署与远端验证沿用 IRIS owner 和既有授权范围。

业务产物遵循目标工程约定。插件不自动复制原型、覆盖项目 docs 或同步业务源码；本地检查与目标工程实际验收分别报告。
