# imedicalxc-doctor-print-template-design

HIS 打印模板设计和生成插件。覆盖从 Word/docx 参考文档到可导入 `.xlsx` 模板文件的完整 11 步工作流。

## 入口

- **技能**：`skills/imedicalxc-doctor-print-template-design/SKILL.md` — 核心 11 步工作流
- **脚本**：`scripts/generate-plugin-thin-index.ps1` — thin-index 生成

## 前置条件

用户需提供：
1. 新模板布局参考（docx/png/设计稿等）
2. 已有参考模板（主模板管理 .xlsx，可选扩展模板 .xlsx）
3. 新模板编码和名称

## 触发条件

- "设计打印模板"、"生成打印模板"、"新建打印模板"
- "住院证打印"、"修改打印模板"、"打印模板适配"
- "生成.xlsx模板"、"导出模板"
