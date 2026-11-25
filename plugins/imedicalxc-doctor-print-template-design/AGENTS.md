# imedicalxc-doctor-print-template-design

帮助请求（`--help`、查看用法）先于业务前置检查，按[统一帮助协议](../../docs/guides/capability-help.md)展示后结束。源定义随正常能力包更新分发，既有 thin-index 继续指向源文件；查看帮助不自动启用插件。

HIS 打印模板设计和改造插件。覆盖两条路径：路径 A 从布局参考生成可导入的主模板与扩展模板（11 步）；路径 B 在既有模板上补齐字段、按接口返回值重构返回参数、把编码与主键回退到目标模板以覆盖更新（8 步）。

## 入口

- **技能**：`skills/imedicalxc-doctor-print-template-design/SKILL.md` — 双路径工作流
- **参考**：`skills/imedicalxc-doctor-print-template-design/references/xlsx-template-anatomy.md` — xlsx 结构、Sheet4 列语义、元素 JSON、脚本与校验清单
- **脚本**：`scripts/generate-plugin-thin-index.ps1` — thin-index 生成

## 前置条件

用户需提供：
1. 布局参考（docx/png/设计稿等；路径 B 可只用现有模板）
2. 参考模板（主模板管理 `.xlsx`，可选扩展模板 `.xlsx`；路径 B 需目标模板原始导出）
3. 模板编码和名称

## 触发条件

- "设计打印模板"、"生成打印模板"、"新建打印模板"
- "修改打印模板"、"打印模板适配"、"模板编码回退"
- "返回参数重构"、"打印空白"、"字段对不上"
- "生成.xlsx模板"、"导出模板"
