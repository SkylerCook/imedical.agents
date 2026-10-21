---
name: iris-ui-init
description: 按框架更新流程接入并启用 iris-ui，复用目标工程已有 IRIS 能力和插件配置。
---

# 初始化 IRIS UI

1. 读取项目入口、现有 plugin/context 配置和本插件 manifest，确认 WorkspaceRoot、ContextRoot、CapabilityRoot 与源码边界。配置及连接仍由原 owner 管理。
2. 接入和部署先读取[框架更新 runbook](../../../../docs/update-agents.md)；Overlay 同时读取[两阶段更新流程](../../../../docs/workspace-overlay.md)。共享能力先在其所属根工作区更新一次，再通过项目既有模块管理入口刷新指定模块 Context，固定使用 `-NoPull`；按原流程预演、写入、检查及模块验证。
3. 核对更新后实际可读的 coding-iris-plugin 已启用且版本满足 manifest。源仓实现未发布、共享层更新受阻或仍是手工同步副本时，分别报告源码完成与正式部署待完成；保留现场，等待正常发布条件，不以拷贝文件、单独调用薄索引 wrapper 或改版本号代替框架更新。
4. 用户要求启用时，沿用项目既有注册及 plugin_profile 约定，仅登记本插件，保留其它配置；由框架更新流程生成受管入口。有模块注册表时同时核对启用集合，冲突按现有接入流程处理，不绕过验证器。
5. 读回确认 `iris-ui` 开发技能及 `iris_ui` 规则的源映射、运行版本和框架更新结果；初始化 skill 仅从插件内调用，不生成薄索引。若配置或目标冲突，停止该写入并报告具体差异。

完成后交付启用状态、实际薄索引位置和检查结果。启用插件不自动执行页面改造、浏览器操作、部署、提交或同步其它项目副本。
