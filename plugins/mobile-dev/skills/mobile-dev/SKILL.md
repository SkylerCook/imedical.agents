---
name: mobile-dev
description: Android 原生 Java/Kotlin 开发、闪退、ANR、白屏、网络和设备异常排查；运行故障先主动读日志。
---

# mobile-dev

帮助请求（`--help`、查看用法）先按[统一帮助](../../../../docs/guides/capability-help.md)展示后结束；Overlay 沿 `.agents/capability.json` 的 CapabilityRoot 定位协议。

读取项目入口与插件状态，然后按[工作流](../../rules/mobile_dev.md)执行。运行故障先取日志，构建故障先看构建输出；明确只读请求不进入修改。输出证据、原因、授权内改动、验证和未覆盖项。

## 按任务加载

按当前问题选择下列参考，不全量加载；同一需求跨多个场景时按实际依赖串行执行。

| 触发场景 | 流程入口 |
|---|---|
| 首次进入工程、环境或构建问题 | [工程与环境检查](../../references/project-check.md) |
| 新增或修改页面、列表、表单、弹窗 | [页面开发](../../references/page-development.md) |
| 新增接口、响应解析、接口与页面状态不一致 | [接口接入与联调](../../references/api-integration.md) |
| WebView、H5 导航、PDA 扫码或广播 | [WebView 与 PDA](../../references/webview-pda.md) |
| 标准功能移入定制仓、跨仓适配 | [功能移植](../../references/feature-porting.md) |
| 完成改动、构建安装与交付核验 | [验证与交付](../../references/verification-delivery.md) |

运行故障仍先按[日志取证](../../references/android-logs.md)获取证据，再进入对应分支。跨仓移植先确认来源和目标身份；不能因排障指令而连接错误项目的设备。

项目建仓或旧工程回收请求转到 [mobile-project-repo](../mobile-project-repo/SKILL.md)，不套用功能移植的已知基线前置。
