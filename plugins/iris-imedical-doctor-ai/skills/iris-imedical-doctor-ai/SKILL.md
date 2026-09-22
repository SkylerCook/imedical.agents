---
name: iris-imedical-doctor-ai
description: 面向 IRIS imedical 医生站的 AI 集成开发。接入或扩展嵌入、外挂、旁路 AI 助手，开发诊断推荐与采纳、交互卡片、流式对话、病历联动和诊疗数据衔接，或改进相关集成框架时使用；根据当前需求和工程能力适配，不绑定固定原型、路径或接口。普通 HIS 开发和独立 AI 应用不触发。
---

# 医生站 AI 集成开发

## 核心原则

插件提供领域方法，工程提供现行能力，原型表达当次设计意图。原型、框架与业务服务均可持续演进；不得将某次实现冻结成插件强制规范。

## 开始工作

1. 读取目标工程入口、插件状态和已有 IRIS/context 配置，确认实际源码与 Git 边界。未启用时走同插件 init；只读分析不自动写配置。
2. 从用户需求和当前加载/调用关系识别相关 AI 入口、交互框架、业务服务与上下文传递。用户指出的文件是起点，不是假定所有工程都存在的固定目录。
3. 核对相关源码、未提交变更、调用者及必要的近期提交；只读取任务涉及的部分。具体接口和版本证据记录在目标项目，不写进通用插件。

## 按需参考

- 业务功能、菜单或历史实现定位：复用 coding-iris-plugin 的 [iris-imedical-knowledge](../../../coding-iris-plugin/skills/iris-imedical-knowledge/SKILL.md)。刷新目标项目菜单资料使用 [iris-menu-sync](../../../coding-iris-plugin/skills/iris-menu-sync/SKILL.md)，本插件不复制同步实现或工程快照。

- 原型、截图、视觉层次与容器布局：[prototype-integration.md](../../references/prototype-integration.md)。
- 框架扩展、卡片、对话、存储与接入方式：[workstation-contracts.md](../../references/workstation-contracts.md)。
- 诊断与共享业务服务：[diagnosis-flow.md](../../references/diagnosis-flow.md)。
- 验证：[verification.md](../../references/verification.md)。
- 资料与代码冲突：[source-baseline.md](../../references/source-baseline.md)。
- 需要落盘方案时使用 [集成分析模板](../../templates/integration-plan.md)，不生成固定基类代码。

## 实施与演进

先说明本次目标、当前能力、缺口和修改层，再执行授权范围内的实现。复用现有业务服务与必要校验；不足时可以改进框架并同步调用者、协议和测试，不以插件旧示例阻止合理修改。

IRIS 编码、HISUI、i18n、部署和提交继续复用原 owner，按其当前契约及启用状态处理。保留无关改动，区分建议、确认、执行与业务结果，检查上下文一致性及共享调用方影响。

只读元数据工具是可选辅助：只有目标代码采用其支持的字面量字段时才使用；不兼容表示工具不适用，不表示框架必须改回旧写法。

共享传统页面或业务服务时，必须兼容未启用 Chat 的宿主；AI 刷新通知是可选联动，缺失或失败不能阻断原业务。实施与验证按 [多宿主与无 Chat 兼容](../../references/workstation-contracts.md#多宿主与无-chat-兼容) 执行。

## 交付

记录实际变更、复用点、兼容影响、验证结果与未覆盖范围。项目产物遵循目标工程约定；没有约定时可用 docs/work/ai-integration/<task>/。通用插件不保存工程快照、原型数据或患者信息。远程动作按现有授权边界执行。
