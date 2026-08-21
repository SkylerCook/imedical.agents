# cure-form-package/v1

部署包包含目标 Map、组成模板、缓存字段、资源、公共模板引用、期望版本、期望内容哈希、规格哈希、差异摘要、回滚前置快照标识和 `cure-form-preview-verification/v1`。新表单以 `expectedVersion=NEW` 判定，另须包含部署前 `cure-form-interaction-verification/v1`；凭证绑定 approved spec、snapshot、changes、preview verification 和 manifest。多模板规格的 `expectedTemplateCount`、`templates[]`、Map composition、changes templates 和 fragment 资源数量必须一致且顺序稳定。表单独立 CSS 使用 `resources[].kind=stylesheet` 声明；`stylesheets[].deploymentPath` 是目标工程静态资源根下的安全相对路径，不保存服务器绝对路径。本地预览 `path`、运行时 `runtimeHref` 和部署 `deploymentPath` 相互独立。只有带已确认 `changes` 且所需凭证均与当前 artifacts 一致的包才设置 `deploymentReady=true`；评审包不得执行。包本身不包含患者数据、服务器密码或任意 SQL。

已存在批准版本的公共模板必须以 `changes.templates[].referenceOnly=true` 和服务器 `rowId` 引用，禁止再次携带 `content/items` 创建同版本副本。客户端可通过 `plan --approved-clones` 按来源模板 RowID 机械替换，并在 `commonTemplateReferences[]` 记录来源与批准版本；未找到批准映射时继续保留版本化克隆，不得按 `appId` 猜测复用。

客户端 `plan` 只生成离线包；服务端 `ValidatePackage` 必须再次验证：

1. `formType` 是 CA 或 CR，且与服务器 Map 一致。
2. 当前版本和内容哈希等于包内期望值。
3. 所有组成模板、缓存字段和公共模板引用完整。
4. 操作者和原因非空，规格已批准且 `unresolved[]` 为空；新表单包含通过且与当前 artifacts 一致的部署前人工交互凭证。
5. 操作只涉及配置全局，不涉及患者评估或治疗记录数据。

当包体超过单次 ObjectScript 调用长度时，客户端必须使用部署类专用的分片暂存协议：随机 `StageID`、严格递增序号、单片和总量上限。只读校验也会产生短生命周期暂存写入，因此必须显式传入 `--confirm-staging-write`；实际 Apply 使用 `--confirm-write`。校验后立即清理，Apply 前单次消费，禁止通过通用 Global 写接口旁路。

所有字符串参数先按 UTF-8 编码并 Base64 传输，服务端参数表达式必须使用 `$zconvert(...,"I","UTF8")` 还原 Unicode；仅执行 Base64 解码会把中文按 Latin-1 字符写入模板，属于阻断部署的编码错误。

新开发表单与现有模板改造采用不同生命周期。`expectedVersion=NEW` 的新开发表单直接创建正式模板，不生成灰度，也不使用以下合并/清理包。只有现有模板改造才先部署响应式灰度 RowID，并在验收后按引用拓扑使用 `cure-form-consolidation/v1` 或 `cure-form-shared-consolidation/v1` 回归正式 RowID。

## cure-form-consolidation/v1

存量响应式灰度模板正式合并使用独立包，不复用普通 `changes`。包内按 Map 声明 `expectedVersion`、`expectedContentHash` 和 `mappings[]`；每项绑定灰度/正式 RowID、`APP_ID`、双方正文哈希、DOM/radio 契约哈希和缓存字段集合哈希。

服务端必须重新确认灰度模板由目标 Map 独占、正式模板尚未被其他 Map 引用、灰度 `APP_LastID` 指向正式 RowID，且双方 `APP_ID`、MapType、DOM/radio 与缓存字段集合一致。事务只把灰度 `APP_Content` 写入正式模板，保持正式名称、JS、`APP_LastID` 与缓存 RowID，随后原位替换 Map 引用并删除灰度模板及灰度缓存。审计前快照必须同时包含灰度和正式模板，使 `RollbackOperation` 能恢复双方、缓存和原 Map 组成。

## cure-form-cleanup/v1

已完成 Map 切换后清理全库零引用旧模板使用独立清理包。每项绑定旧模板 RowID、响应式替代 RowID、`APP_ID`、双方正文哈希和完整模板/缓存快照哈希；包还绑定整次 `InspectCleanup` 的检查哈希，避免检查后数据漂移。

该包不把响应式内容合并回旧 RowID，因此不具备“回归正式 RowID”语义，不能替代现有模板改造的 consolidation 收尾，也不用于新开发表单。

服务端必须重新确认旧模板存在、未响应式且没有任何 Map 引用，替代模板存在、已响应式、至少被一个 Map 引用，双方 `APP_ID` 与 MapType 一致。单一事务只删除旧模板的缓存项和模板行，不修改替代模板或 Map；事务内重新验证删除结果和替代模板哈希。审计记录保存双方完整快照，使 `RollbackOperation` 可按原 RowID 恢复被清理模板及其缓存。任一引用、内容或缓存快照发生漂移时整批停止。

## cure-form-shared-consolidation/v1

被多个 Map 共用的响应式灰度公共模板推广到原 RowID 时使用共享合并包。包绑定一对一灰度/正式 RowID、双方完整模板与缓存快照哈希、DOM/radio 契约、全部受影响 Map 的变更前后组成及整次检查哈希；简单标题、签名等公共片段只要求响应式根契约，不强制业务表格布局 class。

服务端在单一事务中仅把灰度 `APP_Content` 写入正式模板，保持正式名称、`APP_ID`、JS、`APP_LastID`、缓存 RowID 与其他字段不变；随后按原顺序切换全部引用 Map，确认灰度引用归零后删除灰度缓存和模板。任一 Map 数量、组成、模板、DOM/radio、缓存契约或哈希漂移时整批停止。审计保存双方模板和全部 Map 快照，使 `RollbackOperation` 能恢复正式正文、灰度原 RowID/缓存和所有 Map 引用。
