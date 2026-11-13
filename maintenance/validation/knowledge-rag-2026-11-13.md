# 业务知识与 UI 轻量 RAG 实施记录

## 已落地

- 根 scripts 共享章节分块、中文 BM25、OpenAI embedding、本地 SQLite、RRF 和完整片段返回预算。知识 literal 接口保持兼容，UI skill 通过统一入口查找规范。
- 共享资料按 CapabilityRoot 索引，外发策略按 ContextRoot 生效。项目菜单复用已有校验快照及本地分块，保留来源与安全组；此次沿用既有快照持久化，减少项目目录的重复索引状态。
- API key 通过本机用户环境配置并只在进程内使用。授权目录、索引和向量保留在本机忽略缓存，未进入版本控制。
- 分块保留 YAML 文档标题、章节标题、表格表头、代码块及文档适用说明。BM25 纳入原来源路径，修复短技术栈资料缺少可检索标题的问题。
- 混合检索首轮发现语义概述挤出精确技术栈资料，保留前两条关键词命中后再使用 RRF，回归覆盖该问题。

使用方式见[检索指南](../../docs/guides/knowledge-retrieval.md)。

## 本机真实建库

Windows、Node 24.14.1。当前 3,707 个片段对应 3,704 个去重向量，1536 维，SQLite 中保存 JSON 数组；索引文件约 151.5 MiB。向量键包含模型、维度、分块版本及片段内容，索引 generation 切换与批次读回已运行。

两轮建库 API 回执累计 1,622,324 个输入 token，其中首次 1,597,461，标题补齐增量 24,863。按当前每百万 token 0.02 美元计算约 0.03245 美元。该值为 API 用量估算金额，组织实际扣款及赠送额度余额以账单为准。建库成功回执无 warnings。

## 检索对照

30 题各含 10 道业务、UI 和 HISUI 问题。评测源见 `scripts/tests/fixtures/knowledge-questions.json`，报告保留路径、期望条件、模式、耗时及返回字符数。

| 指标 | 本地关键词 | 真实混合检索 |
| --- | --- | --- |
| Top-6 预期出处命中 | 30/30 | 30/30 |
| 预期条件文本出现 | 30/30 | 30/30 |
| 平均耗时 | 176 ms | 663 ms |
| 平均返回字符 | 8,798 | 9,060 |
| 查询 embedding 输入 token | 0 | 337 |

报告见[关键词结果](knowledge-rag-2026-11-13.json)和[混合结果](knowledge-rag-semantic-2026-11-13.json)。字面全文问题对照命中 1/30，仅反映完整问题字符串匹配，原 Agent 的关键词提取、人工专题导航及多轮补查应另做完整任务对照。

评测过程中修正了两处人工标注，notTrans 的实际正文出处为 layout-lifecycle，技术栈短文的预期内容为 Node.js。文档适用说明和标题计入条件覆盖。这些修正完成后再运行两组最终对照，保留真实结果。题集与实现同轮开发，泛化效果仍需独立业务问题验证。

本题集没有显示语义召回相对增强关键词检索的额外收益。条件文本出现不能证明生成答案正确，完整任务输入/输出 token、补查次数与答案正确性尚未完成同模型对照，当前没有节省 80% 的证据。

## 回归与版本

- 新增检索专项 17/17，通过权限分流、撤回、无 key、HTTP 错误、批次恢复、互斥、过期资料、输出预算、表格、标题及固定题集。
- 既有知识/菜单专项 16/16，通过 standard／Overlay、Junction、Git sparse、重复刷新及 PowerShell 7/5.1 thin-index；新增真实 hybrid CLI 和项目菜单优先检查。
- UI 专项合计 30 项，首次 29 项通过，依赖上限同步后剩余兼容项定向复测通过。文档部署链接检查通过，JavaScript 语法与 git diff --check 通过。
- 根运行脚本分发由既有 sparse 白名单覆盖，并新增回归断言。CI 已纳入 Windows/macOS/Linux、Node22/24 的现有矩阵，本轮尚未取得远端矩阵执行结果。
- coding 0.30.0、imedical-ui 0.2.0；7 个直接依赖插件按兼容范围更新 patch 版本及发布记录。
- `validate-component-versions.js validate --worktree` 的本次依赖冲突已消除。全量校验仍报告既有 xc 问题，涉及业务理解插件内部 skill version，以及 extend-engineer 1.0.2/1.0.3/1.0.4 发布记录缺少有效 commit。

## 接续事项

- 取得三平台 Node22/24 矩阵实际结果。
- 用独立真实任务比较相同模型/提示下的完整 token、补查轮数和答案条件完整性。
- 按用户后续授权提交、推送与升级业务副本；本轮保持工作区待审。

测试夹具由各测试清理。本机缓存属于已建库运行态，保留用于日常查询与后续增量更新。

## 初版 OpenAI 分发验证（已由公司选装取代）

初版曾导出 vendor/knowledge-index/index.sqlite，约 51.2 MiB，包含 3,707 片段及 3,704 个 Float32 向量。导出表仅 chunks、vectors、state，本机授权、用量留在缓存。源仓缓存仍保留用于增量维护。

新增导出与新项目专项通过，干净项目无 policy、无本地 cache 可读取分发索引。隔离 Git 仓库完成 clone、实际 sparse 安装、索引 fast-forward 更新及项目 CLI 真实查询，返回 hybrid、vectorSources=bundle，API 仅处理查询的 8 token。测试临时仓库已清理。该证据覆盖隔离安装项目，具体既有业务副本升级仍需明确目标工程。

无 API 时项目可直接使用 BM25，文档向量暂不参与查询。语义检索需要查询 embedding；当前模型客户端通过 Node 工具调用接入。项目级本地 embedding 模型尚无交付范围。


## 公司默认提供方与可选分发

按用户确认，连接统一读取 KNOWLEDGE_RAG_CONFIG 指向的仓外 JSON，默认 company。公司、OpenAI 可以分别配置和建库，当前发布仅提供公司索引。公司接口选择已通过同文本对照，两个 BGE-M3 服务各 3 次、每次 2 条中文输入，均成功且返回 1024 维。耗时中位数分别为 163 ms 与 157 ms，同文本跨服务余弦相似度约 0.999999。样本量有限，继续采用先前已验证的公司默认接口，具体连接只保存在本机私有配置。

本机已配置公司与 OpenAI JSON 段，用户级环境仅新增配置路径绑定。网关采用 AppId/AppKey 获取 token，无签名和无加密配置已实际验证。公司接口签名、加密适配及本地 Embedding 模型未列入本轮实现。

公司首批 16 条向量写入后，在独立进程中读回维度与长度，再续建剩余 3,688 条。累计建库 usage 为 1,732,611 token，完成回执无 warnings。当前 company.sqlite 为 40,390,656 bytes，3,707 个片段、3,704 条去重向量。初版 OpenAI 分发文件已移出本轮交付，本机增量缓存保留。

公司 30 题真实混合检索均启用语义召回，Top-6 预期出处和条件文本覆盖各 30/30，查询 usage 共 355 token，平均耗时约 467 ms。[公司评测结果](knowledge-rag-company-2026-11-13.json)保留逐题证据。该结果延续固定题集的局限，完整任务节省比例仍待验证。

共享 sparse helper 默认排除向量数据库，通过 install-index/remove-index 明确选装并持久化 CapabilityRoot 的 Git 本地选择。隔离 file 协议服务启用 Git filter，partial clone 后验证数据库 blob 仍缺失；默认无配置、无库 CLI 返回本地结果。选装后模拟及真实公司查询成功，真实 CLI 返回 hybrid、vectorSources=bundle、8 查询 token；fast-forward 更新保留选装，移除后更新继续跳过数据库。远端不支持 filter、既有完整 clone 或历史对象占用仍需按 Git 行为判断。

提供方与 JSON 5 项、检索核心 19 项通过。共享 sparse 与项目菜单 36 项通过，包含 Windows PowerShell 5.1/PowerShell 7 调用。隔离分发专项的离线与真实 API 两轮均通过。文档部署链接、语法和差异空白检查通过。三平台 Node22/24 的 CI 已接入，本轮未取得远端执行结果。
