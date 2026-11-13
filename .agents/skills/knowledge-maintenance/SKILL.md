---
name: knowledge-maintenance
description: 维护 imedical.agents 源仓共享知识资料与向量索引。用于更新业务知识、UI/HISUI 参考后同步索引，首次向量建库，或恢复中断构建。日常资料查询沿领域检索 skill。
---

# 知识库与向量索引维护

在能力包源仓执行，入口为根 AGENTS.md。从 [agent-kit-maintenance](../agent-kit-maintenance/SKILL.md) 转入时复用已经读取的规则、任务范围和有效授权，完成后回到其维护收尾流程。

帮助请求只说明本 skill 的用途、步骤和当前脚本入口。业务项目的查询、选装与连接配置按[检索指南](../../../docs/guides/knowledge-retrieval.md)执行。

## 1. 确定本次变化

核对当前任务、Git 工作区和已有维护记录，区分资料更新、首次建库和中断续建。资料覆盖范围从 [knowledge-sources.js](../../../scripts/lib/knowledge-sources.js) 的加载逻辑取得，列出本次涉及的资料及来源版本。

- 上游业务资料更新时，按[来源更新流程](../../../maintenance/governance/imedical-knowledge.md#更新来源资料)在固定提交的干净检出中导入到任务独立暂存目录。审查新增、修改、删除项与脱敏结果后替换受管资料，保留目录中的维护说明及属性约定。
- UI/HISUI 参考更新时，读取受影响 owner 的规范，核对适用主题、限制条件与图稿／源码引用。
- 仅恢复索引时，以当前已核验的资料继续构建。仅修改配置或维护说明时，按实际影响验证对应行为。

完成判据为每项资料变化均有来源、差异和处理结果，来源清单与实际字节一致，受影响引用可定位。

## 2. 核对提供方与外发范围

读取[检索指南](../../../docs/guides/knowledge-retrieval.md#维护者建库与导出)，查看 `node scripts/knowledge-query.js --help`，沿当前 CLI 执行 preview。采用任务明确选择的提供方，缺省沿项目／本机配置与公司默认值。

检查 KNOWLEDGE_RAG_CONFIG 路径及所选段的配置完整性，只报告字段是否已配置。将 preview 的资料范围与既有授权核对，分别确认文档建库和评测查询的接收方、内容范围；已有明确授权直接复用。范围扩大时只暂停依赖新增授权的外发工作。

完成判据为本次 provider、model、dimensions、资料量、允许外发范围及费用估算状态已明确。费用返回 null 时按未知记录。

## 3. 增量构建或续建

调用共用 build 入口，首次或策略变化时使用本轮 preview 返回的 snapshot。由脚本按内容与向量身份复用已有数据。已有缓存优先续建；新增大批任务先通过最小批次写入和独立读回验证恢复能力，再扩大处理。批次能力与断点字段按[实现](../../../scripts/lib/knowledge-retrieval.js)核对。

检查返回 JSON 的 complete、remainingVectors、embeddingTokens 和 warnings，不能仅按进程退出码判断成功。

- complete=true、remainingVectors=0 且无未解决 warnings 时，进入验证导出。
- API、额度或连接失败时，按具体错误修复可恢复的问题，复用原缓存续建；等待外部条件时报告已保存进度和恢复命令。资料与本地关键词检索可独立交付，向量状态明确标为待续建。

完成判据为全部当前应向量化片段完成，或已清楚交付部分结果、阻碍与可用断点。

## 4. 验证并导出

先用受影响问题核对本地检索的出处、行号、关键条件与引用。资料或向量发生变化时运行 [evaluate-knowledge.js](../../../scripts/tests/evaluate-knowledge.js) 的关键词评测，并在查询外发授权覆盖时运行所选提供方的语义评测。检查报告中的 hits、conditionsPresent、semanticCases 和逐题 warnings，与[最近基线](../../../maintenance/validation/knowledge-rag-2026-11-13.md)比较，解释并处理退步。条件文本出现仅作为覆盖证据，业务条件和引用需逐项核实。

范围对应的回归按[检索指南](../../../docs/guides/knowledge-retrieval.md#验证)选择；运行时或分发变更再覆盖配置、降级、选装与项目入口，复用仍有效的既有测试结果。

在构建完整、受影响问题核实通过后执行 export。检查返回的 provider、model、chunks、vectors 与目标路径，并核对数据库完整性及当前来源 generation。导出失败沿报错处理，保留原分发文件与续建缓存。

当前共享交付只提供公司库供选装；其它提供方的构建或导出按本次明确范围处理。完成判据为新分发索引与当前资料、模型匹配，验证结论与待验证边界明确。

## 5. 交付与维护收尾

汇总资料变化、向量更新量、实际 API 用量、检索验证及待办。沿 agent-kit-maintenance 更新受影响说明和维护记录，提交、推送、发布及业务副本升级按会话已有授权执行。任务临时目录按根规则清理，运行与续建缓存按实际用途保留。

任务以所请求的资料更新及索引状态交付完成；需要外部条件的部分明确列出恢复入口。该 skill 通过 Agent 在维护任务中调用，定时同步需另有已配置的执行入口。
