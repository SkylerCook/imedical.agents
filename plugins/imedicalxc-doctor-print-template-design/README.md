# imedicalxc-doctor-print-template-design

HIS 打印模板设计和生成插件。它以 Word/docx、图片或既有 `.xlsx` 模板为参考，编排主模板与可选扩展模板的生成、UUID 重建和返回参数字段校正。

## 能力入口

- 主 skill：`skills/imedicalxc-doctor-print-template-design/SKILL.md`
- 插件约束：`AGENTS.md`
- manifest：`.agents-plugin/plugin.json`
- thin-index wrapper：`scripts/generate-plugin-thin-index.ps1`

## 使用前提

按任务提供以下材料：

1. 新模板布局参考，例如 docx、PNG 或设计稿。
2. 可复用的主模板 `.xlsx`，以及可选扩展模板 `.xlsx`。
3. 新模板编码、名称和业务侧验收要求。

## 启用与更新

插件目录存在只表示能力 `available`。完成项目上下文维护和本插件实际验收后，再将目标项目 `.agents/config/plugin_profile.md` 中的插件状态更新为 `enabled`。已部署项目通过 `.agents/scripts/update-agents.ps1` 获取插件更新，并按 profile 重建 thin-index。

参考文档和生成产物可能含业务数据，默认只在目标项目工作区处理，不回写本能力包仓库。
