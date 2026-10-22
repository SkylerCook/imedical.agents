# imedicalxc-doctor-data-extraction

帮助请求（`--help`、查看用法）先于业务前置检查，按[统一帮助协议](../../docs/guides/capability-help.md)展示后结束。源定义随正常能力包更新分发，既有 thin-index 继续指向源文件；查看帮助不自动启用插件。

HIS 数据抽取与第三方接口对照文档生成插件。核心能力是从 `@OpenApi` Controller 和现有 Feign/DTO/VO 源码提取接口事实，生成字段级对照、差异说明和映射文档；Feign 接口代码与 API 文档生成属于辅助能力。

## 能力入口

- 主 skill：`skills/imedicalxc-doctor-data-extraction/SKILL.md`
- 文档审计 skill：`skills/feign-api-doc-audit/SKILL.md` — 核对并修正已有 API 文档的服务地址、类型与字段
- 审计脚本：`scripts/feign-doc-audit.js` — `paths` / `fields` / `io` / `lint` / `all`
- 插件约束：`AGENTS.md`
- manifest：`.agents-plugin/plugin.json`
- thin-index wrapper：`scripts/generate-plugin-thin-index.ps1`

## 文档审计

```bash
node scripts/feign-doc-audit.js all \
  --doc path/to/Feign接口API文档-集成平台标准接口.md \
  --src-root path/to/his/doc
```

脚本仅使用 Node.js 内置模块；输出为候选问题，同名类型、`@JsonProperty` 别名和扁平包装需按 skill 规则人工复核。

## 使用前提

按任务提供以下材料：

1. 带 `@OpenApi` 注解的目标 Controller 目录。
2. 现有 Feign 接口及 DTO/VO 源码目录。
3. 第三方接口文档；仅做本地接口扫描时可不提供。
4. 已有 Feign API 文档；仅做文档审计时提供。

## 启用与更新

插件目录存在只表示能力 `available`。完成项目上下文维护和本插件实际验收后，再将目标项目 `.agents/config/plugin_profile.md` 中的插件状态更新为 `enabled`。已部署项目通过 `.agents/scripts/update-agents.ps1` 获取插件更新，并按 profile 重建 thin-index。

本插件不保存业务项目的接口地址、账号、token、私有字段样例或其它连接事实；这些信息只留在目标项目本地上下文中。
