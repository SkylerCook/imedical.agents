# 业务知识与 UI 混合检索

同一查询入口提供本地 BM25 与可选语义检索。默认提供方为公司，服务不可用、配置缺失或向量缺失时返回本地关键词结果及降级原因。Agent client 执行 Node 命令并读取片段，无需原生 Embedding 支持。业务结论继续核对当前源码。

## 项目默认使用

安装和更新默认取得 Markdown 资料、来源清单和检索脚本，跳过 `vendor/knowledge-index/*.sqlite`。中文分词、字符二元组、精确标识、BM25 排序、章节片段、出处及长度控制均可在无 API、无数据库的项目使用。

```powershell
node <CapabilityRoot>/scripts/knowledge-query.js --project-root <workspace> --query "PURE 查询区标签对齐" --domain ui --theme pure
node <CapabilityRoot>/scripts/knowledge-query.js --project-root <workspace> --query "多院区配置读取" --domain business
```

默认最多 6 条、序列化 JSON 最多 12,000 字符，使用 `--limit` 和 `--max-chars` 调整。结果包含正文、标题链、documentContext、路径、行号、来源版本、证据类型、主题、图稿或源码引用。引用相对结果 path 所在目录解析。原 `query-knowledge.js` 保留默认 literal 行为，通过 `--mode hybrid` 使用共用核心。

## 可选向量索引

当前发布提供公司 BGE-M3 的 1024 维索引，约 38.5 MiB。具备公司服务的项目显式选装一次，后续更新保留选择。

```powershell
node <CapabilityRoot>/scripts/knowledge-query.js --project-root <workspace> --action install-index --provider company
node <CapabilityRoot>/scripts/knowledge-query.js --project-root <workspace> --query "PURE 标签对齐" --domain ui --query-public
```

选装状态保存在 CapabilityRoot 的 Git 本地配置 `imedical.knowledgeVectors`。Overlay 项目共用同一个 CapabilityRoot 的选装结果，各 ContextRoot 的查询授权仍独立。`remove-index --provider company` 移除干净工作区中的选装索引，后续更新继续跳过。

安装器已使用 `--filter=blob:none`，远端支持 partial clone 时，默认跳过的数据库 blob 不会下载。全量 clone、已下载过的历史对象，以及不支持 filter 的远端仍可能保留或取得对象。移除选装只改变工作区检出范围，历史对象占用按 Git 自身管理。

维护者可自行构建 OpenAI 索引。`--provider openai` 显式选择 OpenAI，其本机索引可与公司索引共存。当前发布只提供公司索引。每次查询只访问所选提供方，服务失败回退本地 BM25。预先分发的向量仍需要相同模型生成查询向量。

## 本机 JSON 配置

沿 BOS 的路径绑定方式，`KNOWLEDGE_RAG_CONFIG` 指向仓外私有 JSON 的绝对路径。Windows 可使用 `%LOCALAPPDATA%/imedical-agents/knowledge/config.json`，其它平台选择用户私有目录。凭据、真实地址与接口标识在该文件管理，普通调用只读取当前进程中的路径变量。

```powershell
node <CapabilityRoot>/scripts/knowledge-query.js --action init-config --config-file <absolute-private-json-path>
```

初始化生成本机 TODO 实例并返回路径，已有文件保持原内容。填写完成后将 `KNOWLEDGE_RAG_CONFIG` 设为该路径。Windows 用户级变量修改后，重启终端或 Agent 使其继承新值。本机配置随使用者管理，普通项目更新复用已有配置。

| 字段 | 用途 |
| --- | --- |
| schema | `knowledge-rag-config/v1` |
| defaultProvider | 缺省为 `company` |
| providers.company | `type=gateway`、baseUrl、method、appId、appKey、model、dimensions，版本 version 缺省为 v1.0 |
| providers.openai | `type=openai`、apiKey、model、dimensions |
| 公司模型默认值 | `bge-m3`、1024 维 |
| OpenAI 模型默认值 | `text-embedding-3-small`、1536 维 |

公司网关通过 AppId/AppKey 获取 token，再封装 REST 业务请求，按有效期在当前进程复用 token。认证失效后最多刷新重试一次。本轮适配已验证无签名、无加密的应用配置，配置启用签名或加密时返回明确降级原因。

提供方选择顺序为 `--provider`、ContextRoot 策略中的 defaultProvider、本机 JSON 的 defaultProvider、company。不同提供方、模型、维度与公司接口标识生成独立向量身份，避免混用。修改接口或模型后需要建立对应索引。旧环境变量中的凭据可在显式迁移时导入私有 JSON，运行时连接配置统一读取 JSON。

## 查询与资料外发

`--query-public` 表示本次问题可以发送给选定提供方。默认本地查询，`--local-only` 明确禁用联网。策略显式 allowQuery=false 时尊重其禁用状态。带 `--source-id` 的项目菜单查询保持 ContextRoot 隔离并使用本地检索。

文档建库的目录授权保存于 `ContextRoot/.knowledge-cache/policy.json`，目录内 `.gitignore` 内容为 `*`。已有授权范围持续有效，新增目录先确认。无策略文件时文档外发范围为空。

```json
{
  "schema": "knowledge-policy/v1",
  "allowedDirectories": [],
  "allowQuery": false,
  "defaultProvider": "company"
}
```

BM25 使用标题、正文和来源路径。混合检索分别召回 30 条候选，保留前两条关键词证据，其余候选通过 RRF 合并，精确标识和当前项目菜单优先。返回结果的 mode、provider、model、vectorSources 和 warnings 表达实际检索情况。

## 维护者建库与导出

```powershell
node <CapabilityRoot>/scripts/knowledge-query.js --project-root <workspace> --action preview --provider company
node <CapabilityRoot>/scripts/knowledge-query.js --project-root <workspace> --action build --provider company --approve <snapshot>
node <CapabilityRoot>/scripts/knowledge-query.js --project-root <workspace> --action export --provider company
```

预览展示资料量、授权范围与 UTF-8 字节 token 上界。公司计费标准未知时 estimatedMaximumUsd 返回 null，实际 usage 取 API 回执。OpenAI 默认模型估算基线为 2026-11-13 每百万 token 0.02 美元。首次或策略变化需传当前 snapshot，相同策略的后续 build 增量处理变化片段。

公司缓存位于 `CapabilityRoot/.knowledge-cache/company.sqlite`，OpenAI 继续使用旧 `index.sqlite`。每套索引保存同源章节、词项和对应模型向量，原文及分块实现共用。构建按 16 个片段持久化并读回校验，中断后续建，完整后切换 generation。活跃构建锁阻止并发写入。过期来源不参与语义候选。

export 生成 `vendor/knowledge-index/company.sqlite`，仅包含 chunks、vectors、state，向量采用 Float32 小端 BLOB。授权配置与 API 用量留在本机。导出前校验当前资料的全部向量，原子替换分发文件。显式导出 OpenAI 时使用旧 `index.sqlite` 文件名，复用历史模型索引。

## 验证

```powershell
node --test scripts/tests/knowledge-embedding.tests.js scripts/tests/knowledge-retrieval.tests.js scripts/tests/knowledge-deployment.tests.js
node scripts/tests/evaluate-knowledge.js
node scripts/tests/evaluate-knowledge.js --semantic --provider company
```

最后一条将固定的 30 个通用评测问题发送给选定服务，需要对应查询外发授权。项目专项覆盖无配置、无索引、partial clone 缺失 blob、选装、查询、更新与移除。KNOWLEDGE_LIVE_SMOKE=1 配合私有 JSON 可运行真实公司查询。

Node.js 是 Agent 工具链前置依赖，最低版本要求 >=22.5.0。当前本机验证使用 Node 24，Windows/macOS/Linux 与 Node22/24 矩阵执行结果沿维护记录核对。完整任务 token、答案正确性和独立题集效果仍需实际业务验收。
