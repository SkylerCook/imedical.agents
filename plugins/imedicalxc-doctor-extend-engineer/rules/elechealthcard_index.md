---
name: elechealthcard_index
description: 电子健康卡模块规则索引。接入新厂家或维护既有厂家时作为规则路由入口。
task-affinity: [elechealthcard, routing, index]
related:
  - elechealthcard_coding_conventions.md
  - elechealthcard_integration.md
---

# 电子健康卡规则索引

本文件做电子健康卡模块的规则路由入口。接入新厂家或维护既有厂家代码时，先读本索引再按任务类型读取对应规则。

## 规则入口

- [编码规约（A~AO）](elechealthcard_coding_conventions.md)：异常处理、命名、DTO/VO 结构、数据对照、Javadoc、校验、加密决策等约束。**每次生成或修改电子健康卡代码前必读**。
- [第三方集成通用约束](elechealthcard_integration.md)：请求结构、字段来源严格性、数据对照 SQL 规范。适用于所有外部平台接口对接场景。

## 参考资料

参考资料位于 `skills/imedicalxc-doctor-elechealthcard-vendor/references/`：

- `register-elechealthcard-dataflow.md` — registerElecHealthCard 完整数据流（前端读卡 → 后端注册 → 持久化）、前端布线清单和 VO 必备字段。
- `guangdong-envelope-structure.md` — 广东省电子健康卡嵌套 body 信封结构示例（规约 AD 的具体实现参考）。

## 总原则

- 一切方法/DTO/VO/报文以**新厂家对接文档**为准，不得沿用模板厂家的报文。
- 结构镜像既有厂家，协议差异收敛在厂家私有包内。
- 无对接文档、无 esb 接口码时先索取，禁止臆造。
- 编码规约中的厂家专属示例（如广东省参数）仅作参考，新厂家按各自文档实现。
