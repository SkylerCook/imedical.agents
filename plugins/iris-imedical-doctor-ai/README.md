# IRIS iMedical Doctor AI

面向医生站 AI 集成开发，支持嵌入、外挂、旁路接入的分析与适配，优先覆盖诊断等业务服务复用。依赖 coding-iris-plugin，不绑定某个工程、原型版本或 AI 框架实现。

## 使用

通过现有安装/更新流程取得插件，调用 iris-imedical-doctor-ai-init 核对能力并启用，再使用 iris-imedical-doctor-ai。目录存在仅表示 available。主 skill 按医生站 AI 接入、诊断推荐与采纳、卡片、流式对话、病历联动及相关框架改进的业务意图触发，普通 HIS 开发不触发。

## 内容

- 菜单/wiki 查询与刷新复用 coding-iris-plugin 的 iris-imedical-knowledge / iris-menu-sync。资料位于共享 vendor，实际项目快照留 ContextRoot；更新后由依赖插件 thin-index 暴露入口，不重复维护工具。

- [开发入口](skills/iris-imedical-doctor-ai/SKILL.md)：发现现行能力、补充缺口与验证。
- [原型集成方法](references/prototype-integration.md)：提取当次设计意图，不固定原型流程。
- [框架演进](references/workstation-contracts.md)：按当前代码识别扩展点，允许改进框架。
- [诊断集成](references/diagnosis-flow.md)：领域检查方向，不预填工程接口。
- [验证方向](references/verification.md) 与 [资料边界](references/source-baseline.md)。
- [集成分析模板](templates/integration-plan.md)：记录本次目标、实际能力与验证，不提供绑定旧基类的代码骨架。

## 可选元数据工具

`node <插件目录>/scripts/audit-card-metadata.js <文件> [更多文件]`

仅适用于显式使用字面量 ACTION_CODE/PERSIST 的代码；只采集字段并检查输入范围内动作码重复，不判断持久化策略是否合法。不兼容的动态定义或其它框架返回 incomplete，需要读当前源码或使用相应工具，不能据此阻断框架演进。它不证明注册、加载、业务或历史恢复正确，也不执行业务脚本或访问网络。

## 更新与验证

沿用现有 updater 和 context/capability 映射，不覆盖旧项目资料、不创建连接配置。未发布的讨论名称不声明 legacyNames。

源仓专项：`node --test scripts/tests/iris-imedical-doctor-ai.tests.js`。Windows 下含 PS7/PS5.1 thin-index 检查，跨平台结果以 CI 实际执行为准。项目验证产物遵循目标工程约定，真实 HIS 验收独立执行。

现有参考进一步覆盖快捷入口与业务校验分层、传统页面服务抽取等价性、配置驱动引入、主流程导航与辅助快捷入口分工、实际加载/控件事件验证和文书摘要语义；脱敏场景见 verification.md。场景是测试设计输入，不表示已有通用运行时测试器。升级仅更新指导资料，无基类、业务源码或连接配置迁移；已部署副本在发布后通过既有更新流程同步。

UI 指导同时覆盖视觉焦点、语义图标、同行按钮对齐、容器响应式和重复入口判断；状态按钮及组合动作见 workstation-contracts，运行态验收矩阵见 verification。无需新增工具或业务迁移；发布后通过既有更新流程同步已部署插件，本次不自动同步。
