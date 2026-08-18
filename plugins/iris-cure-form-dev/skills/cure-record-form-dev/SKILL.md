---
name: cure-record-form-dev
description: 从已批准 cure-form-spec/v1 新建或重构 CR 治疗记录表单，生成 HISUI HTML、JavaScript、根片段和可选 SQL，并验证 CR 保存回显打印契约。
---

# Cure Record Form Dev

1. 只接受 `formType=CR` 且已批准、`unresolved[]` 为空的规格。
2. 默认在项目 `docs/cure-form/<moduleId>/` 生成 `<moduleId>.html`、`.js`、`.fragment.html` 和 `cure-form-spec.json`；显式 `--output-root` 可覆盖开发目录。
3. 保持 DOM ID、缓存标签、radio `name/value`、`Init/OtherInfo/PrintInfo`。
4. 必须保持宿主 `record.recordtemp.js` 的 `SaveCureRecord`、`CureExpJsonStr`、`MapID` 及回显和打印行为；表单模块不得重新定义这些宿主入口。
5. 默认满足手机/PDA、常规 PAD、宽屏 PAD 横屏和 PC 响应式契约。
6. 公共响应式 CSS 路径从目标工程解析且只保存跨表单规则；CR 专属样式进入独立业务 CSS。表单配置只能加载 JS 时同时声明运行时 `scriptHref` 与落盘 `scriptDeploymentPath`，Map“引用JS”保存前者并由总入口幂等加载外部文件。
7. 模板仅在确有业务逻辑时配置独立外部 JS；“引用JS”保存路径而非源码，无逻辑模板不生成空壳脚本。新增部署静态资源 basename 必须语义明确、使用 camelCase 且不超过 24 个字符；业务标识过长时只缩短资源名，并保持引用路径与部署 basename 一致。
8. 生成部署包前完成 CR 保存、重开、回显和打印验证。
