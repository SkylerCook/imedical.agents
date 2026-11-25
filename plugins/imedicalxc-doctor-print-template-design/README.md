# imedicalxc-doctor-print-template-design

帮助请求（`--help`、查看用法）先于业务前置检查，按[统一帮助协议](../../docs/guides/capability-help.md)展示后结束。源定义随正常能力包更新分发，既有 thin-index 继续指向源文件；查看帮助不自动启用插件。

HIS 打印模板设计与改造插件。新建场景从 Word/docx、图片或既有 `.xlsx` 模板生成可导入的主模板与扩展模板；改造场景在既有模板上补齐字段、按接口返回值重构返回参数、把编码与主键回退到目标模板以覆盖更新，并重新打包校验。

## 入口

- **技能**：`skills/imedicalxc-doctor-print-template-design/SKILL.md` — 新建 11 步 + 改造 8 步双路径工作流
- **参考**：`skills/imedicalxc-doctor-print-template-design/references/xlsx-template-anatomy.md` — 包结构、Sheet 列语义、元素 JSON、脚本片段、校验清单
- **脚本**：`scripts/generate-plugin-thin-index.ps1` — thin-index 生成

## 路径

| 路径 | 适用 | 核心 |
|------|------|------|
| A 新建模板 | 新编码、新布局 | UUID 全量新建，主/扩展双模板同步 |
| B 改造已有模板 | 加字段、重建返回参数、编码回退、覆盖更新 | 复用目标模板编码/主键/参数 id，只补差异 |

## 前置条件

用户需提供：
1. 布局参考（docx/png/设计稿等；路径 B 可只用现有模板）
2. 参考模板（主模板 `.xlsx`，可选扩展模板 `.xlsx`；路径 B 需目标模板原始导出）
3. 模板编码和名称

## 启用与更新

插件目录存在只表示能力 `available`。完成项目上下文维护和本插件实际验收后，再将目标项目 `.agents/config/project.jsonc` 的 `plugins` 节中的插件状态更新为 `enabled`。已部署项目通过 `.agents/scripts/update-agents.ps1` 获取插件更新，并按 profile 重建 thin-index。

参考文档和生成产物可能含业务数据，默认只在目标项目工作区处理，不回写本能力包仓库。

## 触发条件

- "设计打印模板"、"生成打印模板"、"新建打印模板"
- "修改打印模板"、"打印模板适配"、"模板编码回退"
- "返回参数重构"、"打印空白"、"字段对不上"
- "生成.xlsx模板"、"导出模板"
