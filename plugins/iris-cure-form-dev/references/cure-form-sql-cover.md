# 轻量 SQL 覆盖

`deployment-options` 显式展示自动/手动两种方式，以及完整事务包/轻量 SQL 覆盖两种通道。默认手动、完整事务包；不静默切换写入通道。

## 适用范围

`lightweight-sql` 仅覆盖一个已有、单 Map 独占的 CA/CR 模板 `APP_Content`，要求 `in-place-overwrite`。不清空、不新建、不灰度、不改 Map JS、模板元数据、缓存或组成，不接受任意 SQL。多目标、共享模板或配置变更走完整事务包。

仍使用通过规格、字段契约和预览验证的 package，并绑定原 snapshot。JS/CSS 可由用户自行上传，不要求 SFTP。

## 命令

在目标业务工作区执行，以下入口也可替换为 canonical 脚本的绝对路径：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js deployment-options
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js deploy --channel lightweight-sql --package <package.json> --snapshot <snapshot.json> --output-root <new-run> --deployment-mode manual
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js deploy --channel lightweight-sql --package <package.json> --snapshot <snapshot.json> --output-root <new-run> --deployment-mode automatic --confirm-write --confirm-remote-execution --operator <operator> --reason <reason>
```

手动模式不连接服务器，只交付纯 content HTML 和 README 配置点；不复制已有 JS/CSS。自动模式必须有本次写入授权，不能复用历史清空演练授权。

## 执行与失败边界

1. 本地验证 package/snapshot，先生成手动交付。
2. 单个持久 MCP 连接探测参数化读取和 `iris_execute` 固定 SQL 执行能力；不能绕过服务器角色或写权限。写入通过明确的 `mcp-fixed-sql-binding` 兼容层绑定参数，使用工具的自清理临时执行载体；不上传持久业务类，不开放任意 SQL/ObjectScript。真实写入授权须覆盖此临时执行方式。
3. 参数化读取模板与引用 Map，核对批准快照；把完整备份写到任务 `private/sql-cover/before.json` 并回读校验。
4. content 已相同则 `unchanged`，不 UPDATE。否则单次固定参数化条件 UPDATE，旧内容精确比较（大小写及长度）、Map 组成和 JS 比较、独占引用检查。兼容层在同一事务中先按相同条件 COUNT 并绑定对应参数，恰好一行才 UPDATE；实际影响行数不是 1 就回滚，绝不跳过行数检查。
5. 明确恰好影响一行后重新读取 content 和受保护元数据；一致才 `verified`。零行是并发冲突；影响行数不明或返回丢失是 `write-outcome-unknown`，禁止自动重试。已写入但无法回读为 `verification-unavailable`。

60 秒无进展或 120 秒总预算即停止；单次请求另有 30 秒限制。超时不代表未写入，须独立只读核实，不能立即人工覆盖。每次使用新的 output-root，拒绝覆盖已有审计。

这是本地审计通道：UUID `auditId`，`operationId=null`，不更新完整事务类的版本全局或服务器 operation 记录。不得拿本地 UUID 调用 `VerifyOperation`/`RollbackOperation`。恢复需另行授权并以当前值为并发基线；切回完整事务通道必须重新 Inspect、重新绑定快照和计划。真实 HIS 保存/回显/打印仍须验收。

支持状态与实测分开：工具 schema 可用不等于写权限可用；只读长文本探针耗时不等于 UPDATE 耗时。未完成目标服务器实写时必须明确标记未验证。

实测兼容限制：空字符串参数可能映射为 SQL NULL；content 与空 Map JS 的比较使用 NULL 安全的精确值及长度判断。已核对上游 v1.2.6/v1.4.1 的 `iris_query_write`：行数预检和 UPDATE 均遗漏 `%Execute` 参数，导致 `ROWS_CHECK_FAILED`。本兼容层修复参数绑定并保留/加强事务内单行保护，不使用 force/confirmed，不自动尝试其它写入路径。遇到权限拒绝或未知回执仍停止。

授权样本已完成固定绑定层的原内容 UPDATE、清空、恢复及三模板回读验证（单次约 9.94 秒），证据保留目标项目。该结果只证明本实例的底层 SQL 兼容通道；不将其冒充所有服务器、正常 deploy 命令全链路或真实 HIS 保存/打印验收。普通部署仍不允许清空，演练脚本不进入普通 deploy。
