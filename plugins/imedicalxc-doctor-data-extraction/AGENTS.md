# imedicalxc-doctor-data-extraction

HIS 数据抽取与第三方接口对照文档生成插件。覆盖从 @OpenApi Controller 扫描到字段级对照文档生成的完整工作流，支持 Feign 接口代码生成和 API 文档生成辅助功能。

## 入口

- **技能**：`skills/imedicalxc-doctor-data-extraction/SKILL.md` — 核心 3 阶段工作流（数据抽取 → 对照文档生成 → Feign接口生成）
- **脚本**：`scripts/generate-plugin-thin-index.ps1` — thin-index 生成

## 前置条件

用户需提供：
1. 目标 Controller 目录（含 @OpenApi 注解的 Controller）
2. Feign 接口目录和 DTO/VO 源码
3. 第三方接口文档（PDF/DOC，可选——仅生成对照文档时需要）

## 触发条件

- "数据抽取"、"接口对照"、"字段映射"、"对比文档"
- "Feign接口对照"、"第三方接口映射"、"生成Feign接口"
- "OpenApi接口改造"、"Feign化"、"API文档"
