---
name: cure-form-lookup
description: 为 CA/CR 治疗表单创建或改造 HISUI Lookup HTML、JavaScript 与只读查询 SQL；用户明确要求治疗表单 Lookup 时使用。
---

# Cure Form Lookup

1. 明确返回值、显示文本、数据源、筛选条件、联动字段和空值策略。
2. 复用 `coding-iris-plugin` 的 HISUI 与 ObjectScript 规范。
3. SQL 只用于查询；部署插件不提供通用 SQL 写入口。
4. 保持字段 DOM ID、缓存标签和保存值契约稳定，并覆盖移动端浮层与键盘交互。
