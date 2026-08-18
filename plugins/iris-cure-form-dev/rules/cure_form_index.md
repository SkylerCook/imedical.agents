# 治疗表单能力索引

- 新建 CA：`cure-assess-form-dev`
- 新建 CR：`cure-record-form-dev`
- 医院文档适配：`cure-form-requirement-adapter`
- 现有模板响应式改造：`cure-form-responsive`
- 旧入口兼容：`make-assess-form-responsive`
- Lookup：`cure-form-lookup`
- HIS 根片段：`cure-form-fragment`
- 部署、回读与回滚：`cure-form-deploy`
- 初始化：`cure-form-init`

DOCX、PDF、XLS/XLSX 的物理解析一律路由到 `extract-doc`；ObjectScript/HISUI 和远端资源操作路由到 `coding-iris-plugin`。

涉及 Map、组成模板、缓存字段或 CA/CR 宿主行为时，读取 `references/cure-form-runtime-storage.md`。
