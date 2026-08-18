---
name: cure-assess-form-dev
description: 从已批准 cure-form-spec/v1 新建或重构 CA 治疗评估表单，生成 HISUI HTML、JavaScript、根片段和可选 SQL，并验证响应式与保存回显打印契约。
---

# Cure Assess Form Dev

1. 只接受 `formType=CA` 且已批准、`unresolved[]` 为空的规格。
2. 默认在项目 `docs/cure-form/<moduleId>/` 生成 `<moduleId>.html`、`.js`、`.fragment.html` 和 `cure-form-spec.json`；显式 `--output-root` 可覆盖开发目录。
   - 多模板规格按顺序生成全部 `*.fragment.html`；只有确有计算、联动或初始化逻辑的模板才生成独立 `*.js`，无逻辑模板不得生成空壳脚本。
   - 复杂业务布局可在获批模板中提供 `fragmentHtml` 与 `javascript`；生成前验证根容器、响应式 class、字段 ID/缓存标签以及模块接口，不允许用覆盖项绕过规格门禁。
   - 模板“引用JS”只保存规格声明的外部路径，不保存源码。独立预览 HTML 可初始化实际存在的子模块。默认由宿主管理分模板生命周期；仅在已验证宿主不会可靠执行分模板 `Init` 时，才在规格中设置 `aggregateTemplateInit=true`，并确保各业务模块 `Init` 可重复调用或自行幂等。
3. 完整 HTML 加载公共基础样式、公共响应式样式和规格声明的独立业务 CSS；片段只包含根 div。
   - 公共响应式样式路径从目标工程配置或现有资源引用解析，不得写死。
   - 个性化配色、业务矩阵和字段特例禁止写入公共响应式样式。
   - 表单配置只能加载 JS 时，规格同时声明运行时 `scriptHref` 和落盘 `scriptDeploymentPath`；Map“引用JS”保存前者，由表单总入口幂等加载外部 CSS。模板脚本不重复加载，也不注入 CSS 文本。
4. 保持稳定 DOM ID、缓存标签、radio `name/value` 和 `Init/OtherInfo/PrintInfo`。
5. 按 `360/390/430/768/810/1024/1080/1194/1280` 验证双向重排。
6. 生成部署包前验证 CA 保存、重开、回显和打印。
7. `expectedTemplateCount` 存在时，生成的 fragment、部署模板和 Map composition 数量必须全部严格相等；JavaScript 数量按实际业务逻辑计算，不得强制等于模板数。
8. 规格声明 `stylesheets[]` 时，生成对应 CSS、独立预览静态 link、表单级 JS 加载器及 `stylesheet` 部署资源，并验证内容哈希缓存版本。
9. 新增部署静态资源 basename 必须语义明确、使用 camelCase 且不超过 24 个字符。业务 `moduleId` / `moduleName` 超长时保留稳定业务标识，另行声明短资源名；引用路径和部署 basename 必须一致。允许 `Struct`、`Func`、`Assess` 及公认临床缩写，禁止点分命名和 `ass` 等含糊缩写。
