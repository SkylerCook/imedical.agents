# imedicalxc-doctor-data-extraction

HIS 数据抽取与第三方接口对照文档生成插件。核心能力是从 `@OpenApi` Controller 和现有 Feign/DTO/VO 源码提取接口事实，生成字段级对照、差异说明和映射文档；Feign 接口代码与 API 文档生成属于辅助能力。

## 能力入口

- 主 skill：`skills/imedicalxc-doctor-data-extraction/SKILL.md`
- 插件约束：`AGENTS.md`
- manifest：`.agents-plugin/plugin.json`
- thin-index wrapper：`scripts/generate-plugin-thin-index.ps1`

## 使用前提

按任务提供以下材料：

1. 带 `@OpenApi` 注解的目标 Controller 目录。
2. 现有 Feign 接口及 DTO/VO 源码目录。
3. 第三方接口文档；仅做本地接口扫描时可不提供。

## 启用与更新

插件目录存在只表示能力 `available`。完成项目上下文维护和本插件实际验收后，再将目标项目 `.agents/config/plugin_profile.md` 中的插件状态更新为 `enabled`。已部署项目通过 `.agents/scripts/update-agents.ps1` 获取插件更新，并按 profile 重建 thin-index。

本插件不保存业务项目的接口地址、账号、token、私有字段样例或其它连接事实；这些信息只留在目标项目本地上下文中。
