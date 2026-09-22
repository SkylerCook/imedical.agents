# IRIS iMedical Doctor AI

本插件提供 imedical 医生站 AI 工作站开发能力，以诊断推荐到诊断录入公共服务的链路为首要场景。

- 主入口：`skills/iris-imedical-doctor-ai/SKILL.md`。
- 菜单/wiki 定位及菜单资料刷新复用 coding-iris-plugin 的 iris-imedical-knowledge / iris-menu-sync；共享知识为上游参考，当前工程事实仍在项目内。
- 初始化：`skills/iris-imedical-doctor-ai-init/SKILL.md`。
- IRIS/ObjectScript/CSP/HISUI 编码、编码检测、部署与提交复用 `coding-iris-plugin`；i18n 按现有启用状态与触发条件路由。
- 不覆盖全 HIS 工程治理，不复制批量 Git、SFTP、MCP 或 BOS 工具。
- 产品共性契约可进入 references；医院配置、菜单快照、患者数据、连接信息和本地提交明细仅留目标工程。
- 文档是开发基线，修改前必须核对当前源码；不能把旧模板或提交标题当成现行实现。
- 本插件不授权服务器写入，不自动修改业务代码、安装副本或提交。

## 原型参考

收到原型/截图时按 references/prototype-integration.md 对照实际代码；只沉淀产品共性。原型的患者数据、演示保存、Agent 标签和签名效果不构成真实能力或操作授权。

## 维护

领域方法或辅助工具变更时同步主 skill、参考、模板、相关测试与 owner 版本。通用编码问题归原 owner，不在本插件维护第二份规则。

插件不得绑定特定工程、固定原型或框架版本。具体类名、字段、路径、枚举与加载机制均从当次目标工程核对；框架可以持续改进，插件不得强制退回历史实现。
