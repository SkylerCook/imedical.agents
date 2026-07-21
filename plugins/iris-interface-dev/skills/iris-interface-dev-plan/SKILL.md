---
name: iris-interface-dev-plan
description: 当需要基于接口解析产物生成阶段化实施计划，并把 IRIS/ObjectScript 编码交给 coding-iris-plugin 时使用。
---

# IRIS 接口开发计划

用于把接口解析、字段诊断和人工确认项整理成可执行的开发计划。v1 不直接承诺生成可编译 ObjectScript。

## 必读

1. `../../rules/iris_interface_index.md`
2. `../../rules/iris_interface_workflow.md`
3. `../../rules/iris_interface_review.md`
4. 目标文档对应的 `parsed.json`、`fields.md`、`diagnostics.md`
5. 需要进入编码阶段时，读取目标项目 `coding-iris-plugin` 指南

## 计划内容

计划应包含：

- 接口目标和文档来源。
- 字段覆盖摘要。
- 字段歧义、缺口和必须人工确认的事项。
- 建议的报文形态、校验点和映射风险。
- 必须交给 `coding-iris-plugin` 的编码任务。
- 上传、编译、远程验证或部署之前的审查门禁。

## 硬边界

- v1 不生成最终 ObjectScript 实现。
- 不迁移来源工程的大生成器。
- 后续如进入 v2 代码生成，必须复用 `coding-iris-plugin` 审查，并拒绝 `.s`、`.f`、`..d` 等点号循环体。

## 输出

默认写入 `docs/interface/<doc-name>/implementation-plan.md`。用户指定其他目标项目本地路径时，以用户路径为准。
