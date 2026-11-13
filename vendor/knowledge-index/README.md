# 可选公司知识向量索引

`company.sqlite` 包含共享业务知识、公司 UI 与 HISUI 的 3,707 个片段和 3,704 条去重向量，约 38.5 MiB。模型为 BGE-M3，1024 维 Float32 小端 BLOB。表为 chunks、vectors、state，模型、维度与提供方身份随索引记录。原文权属及使用范围沿资料来源说明。

项目默认跳过本目录数据库，直接使用 Markdown 与本地 BM25。具备公司 Embedding 服务时运行 `knowledge-query.js --action install-index --provider company` 按需取得索引，再通过 KNOWLEDGE_RAG_CONFIG 指向的本机 JSON 配置访问服务。更新保留选装状态。新问题需要相同模型生成查询向量，服务不可用时回退本地检索。

当前分发仅提供公司索引。OpenAI 支持维护者按需建库，历史本机缓存继续复用。建库、选装、配置和 partial clone 的适用条件见[检索指南](../../docs/guides/knowledge-retrieval.md)。
