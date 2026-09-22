---
name: cure-form-fragment
description: 从完整 CA/CR HISUI HTML 中提取唯一根容器 div，生成可粘贴到 HIS 模板配置的纯片段；需要交付根 div 时使用。
---

# Cure Form Fragment

1. 输入必须是完整、可验证的 CA/CR HTML。
2. 提取唯一业务根 div，保留内部 DOM ID、缓存标签、radio `name/value` 和事件绑定。
3. 移除 `html/head/body`、样式与脚本加载标签；宿主负责预加载目标工程配置的公共基础和响应式 CSS，表单独立 CSS 由获批运行时加载契约处理。
4. 校验片段根 ID 与 `moduleId` 一致，且重新嵌入后功能无变化。
