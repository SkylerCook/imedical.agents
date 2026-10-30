---
name: mobile-dev-init
description: 按既有框架流程接入移动端开发插件，核对项目启用状态和入口。
---

# mobile-dev-init

帮助请求（`--help`、查看用法）先按[统一帮助](../../../../docs/guides/capability-help.md)展示后结束；Overlay 沿 `.agents/capability.json` 的 CapabilityRoot 定位协议。

1. 读取项目 AGENTS、插件 profile/注册表，确认 WorkspaceRoot、ContextRoot、CapabilityRoot 及 Android 模块；只记录可复用能力要求，不复制项目连接、签名或业务事实。
2. 按[更新流程](../../../../docs/update-agents.md)和适用的 [Overlay 流程](../../../../docs/workspace-overlay.md)接入；用户授权接入时将 mobile-dev 纳入既有启用集合，不覆盖显式 disabled 或冲突状态。
3. 通过原更新流程生成日常 skill 与 rule 薄索引，读回源映射和版本，确认真实宿主可发现。源仓尚未发布时说明分发待完成，不手工覆盖部署态。

仅接入能力，不自动连接设备、安装应用、修改业务源码或升级工具链。
