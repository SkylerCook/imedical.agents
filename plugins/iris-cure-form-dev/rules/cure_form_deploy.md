# 治疗表单部署约束

- 产品侧事务入口固定为 `DHCDoc.Cure.AI.CureFormDeploy`；不从 target profile 解析类名，也不回退到旧部署类。
- 只允许调用 `InspectForm`、`ValidatePackage`、`ApplyPackage`、`VerifyOperation`、`RollbackOperation`。当前 MCP 没有 `iris_execute_method` 时，客户端使用 `iris_execute` 生成固定白名单 ClassMethod 调用，所有参数 Base64 编码；不得接受外部类名、方法名或任意 ObjectScript。
- 包内必须包含 `cure-form-package/v1`、CA/CR 类型、期望版本、期望内容哈希、操作者、原因和已批准规格哈希。
- 带 `changes` 的包必须包含通过的 `cure-form-preview-verification/v1`；客户端必须核对当前 gate 与 canonical Chromium runner、snapshot、预览源 changes、最终计划 changes、完整 HTML、六类资源、CSS 依赖清单及九档宽度哈希，并将凭证放入包内供服务端审计，旧 gate、缺少 runner 元数据、页面后改或任一失配凭证不得进入部署就绪状态。
- 新建表单以 package 的 `expectedVersion=NEW` 判定；必须额外包含通过的部署前 `cure-form-interaction-verification/v1`，并与当前 approved spec、snapshot、changes、preview verification 和 manifest 哈希一致。存量响应式改造不强制此凭证。
- 客户端只编排；服务端重新校验类型、版本、哈希、组成关系和包内容。
- 任一步失败时回滚整个业务事务，并记录前后快照、哈希、状态和回滚关联。
- 禁止将服务器快照或凭据写入插件目录；快照只允许位于 `.agents/work/`。
- `InspectForm` 等只读方法结果超过 MCP stdout 单次上限时，客户端先读取结果长度，再以固定大小 `$extract` 分块回读并重组；写入方法返回空结果时必须停止，禁止以分块或重试方式重复执行写事务。
- 现有服务器模板的响应式转换必须同时添加 `assess-form assess-form--responsive` 根契约、`assess-form-grid`/`assess-measurement-table` 表格契约和四列测量表 `colgroup`，并删除业务根节点固定 `min-width`；旧 `cure-form-responsive` 类只作为兼容标记保留。
- 响应式差异报告必须确认普通布局和表格单元格中的 HISUI radio DOM 配对未变：`input name/value`、原生 `label.radio`、`i-label-box` / `m-label-box` 均保留。公共 CSS 不得无条件隐藏 `label.radio`；不支持条件选择器的旧 WebView 必须回退到原生 HISUI 渲染。
- 公共响应式 CSS 与表单独立 CSS 都属于静态资源，实际路径从目标工程配置或页面资源引用解析，编码、上传和编译委托 `coding-iris-plugin`；治疗插件只携带部署资源声明和内容，不保存业务工程路径或服务器路径。
- 部署前必须验证公共响应式 CSS 不包含 moduleId、业务根 ID 或单表专属 class；表单独立 CSS 必须在 `resources[]` 中以 `kind=stylesheet` 声明，并由完整 HTML 或表单 JS 加载。
- 公共 CSS 含删除或 selector 迁移时，部署验收必须使用目标工程提供的已改造表单快照做依赖扫描。命中私有 selector 时停止，按“先独立 CSS/loader，后删除公共规则”的两阶段方案处理。
- 新建表单写入后必须完成部署后人工交互验证，覆盖保存、重开、回显和打印；CR 另验宿主保存运行时契约。失败时停止交付，回滚仍需用户明确要求。批量脚本化交互在执行前必须取得用户明确确认。
