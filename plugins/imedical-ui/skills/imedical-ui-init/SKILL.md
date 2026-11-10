---
name: imedical-ui-init
description: 按既有框架流程启用公司 UI 规范能力，核对项目插件状态与日常入口，不新增技术栈配置。
---

# 接入公司 UI 规范

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

1. 读取项目入口、插件 profile/注册表和本插件 manifest，确认 WorkspaceRoot、ContextRoot、CapabilityRoot。保留项目已有技术栈和配置。
2. 读取 [框架更新流程](../../../../docs/update-agents.md)；Overlay 同时按 [两阶段流程](../../../../docs/workspace-overlay.md)先更新共享能力一次，再由模块管理入口以 `-NoPull` 刷新与验证。源仓未发布时报告正式分发待完成，不手工覆盖部署态文件。
3. 用户要求接入时，在项目既有启用集合登记 `imedical-ui`；存在模块注册表时同步核对 profile。显式 disabled、身份或启用集合冲突按既有流程处理，不绕过验证器。
4. 通过原更新流程生成 `imedical-ui` 日常 skill 和 `imedical_ui` rule 薄索引，读回确认源映射及实际版本。纯 init 不生成薄索引；不复制全部参考正文到项目入口。

完成条件：项目启用集合一致、日常入口可达、检查结果明确。启用能力不授予业务修改、公共 CSS 修改、提交、推送或部署权限。
