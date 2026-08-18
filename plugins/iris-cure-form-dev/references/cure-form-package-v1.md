# cure-form-package/v1

部署包包含目标 Map、组成模板、缓存字段、资源、公共模板引用、期望版本、期望内容哈希、规格哈希、差异摘要、回滚前置快照标识和 `cure-form-preview-verification/v1`。多模板规格的 `expectedTemplateCount`、`templates[]`、Map composition、changes templates 和 fragment 资源数量必须一致且顺序稳定。表单独立 CSS 使用 `resources[].kind=stylesheet` 声明；`stylesheets[].deploymentPath` 是目标工程静态资源根下的安全相对路径，不保存服务器绝对路径。本地预览 `path`、运行时 `runtimeHref` 和部署 `deploymentPath` 相互独立。只有带已确认 `changes` 且预览凭证与 snapshot、预览源 changes、最终计划 changes、资源清单和九档宽度一致的包才设置 `deploymentReady=true`；评审包不得执行。包本身不包含患者数据、服务器密码或任意 SQL。

已存在批准版本的公共模板必须以 `changes.templates[].referenceOnly=true` 和服务器 `rowId` 引用，禁止再次携带 `content/items` 创建同版本副本。客户端可通过 `plan --approved-clones` 按来源模板 RowID 机械替换，并在 `commonTemplateReferences[]` 记录来源与批准版本；未找到批准映射时继续保留版本化克隆，不得按 `appId` 猜测复用。

客户端 `plan` 只生成离线包；服务端 `ValidatePackage` 必须再次验证：

1. `formType` 是 CA 或 CR，且与服务器 Map 一致。
2. 当前版本和内容哈希等于包内期望值。
3. 所有组成模板、缓存字段和公共模板引用完整。
4. 操作者和原因非空，规格已批准且 `unresolved[]` 为空。
5. 操作只涉及配置全局，不涉及患者评估或治疗记录数据。

当包体超过单次 ObjectScript 调用长度时，客户端必须使用部署类专用的分片暂存协议：随机 `StageID`、严格递增序号、单片和总量上限。只读校验也会产生短生命周期暂存写入，因此必须显式传入 `--confirm-staging-write`；实际 Apply 使用 `--confirm-write`。校验后立即清理，Apply 前单次消费，禁止通过通用 Global 写接口旁路。

所有字符串参数先按 UTF-8 编码并 Base64 传输，服务端参数表达式必须使用 `$zconvert(...,"I","UTF8")` 还原 Unicode；仅执行 Base64 解码会把中文按 Latin-1 字符写入模板，属于阻断部署的编码错误。
