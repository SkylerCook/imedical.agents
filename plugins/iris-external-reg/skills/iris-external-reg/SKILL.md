---
name: iris-external-reg
description: 按照 HIS 标准自助机预约挂号程序规范开发第三方预约挂号接口。覆盖接口规范解析、执行计划编写、公共组件抽取、ObjectScript 接口实现、DHCExternalService.RegInterface 对接和测试验证。目标包为 DHCDoc.Interface.Outside.RegInterface，核心包为 DHCExternalService。Use when Codex needs to implement RegInterface methods, build provincial appointment-registration platform integrations, translate JSON/XML platform requests to HIS registration services, or when the user types the shortcut alias /external-reg.
---

# IRIS 第三方预约挂号接口开发

## 核心目标

在 `DHCDoc.Interface.Outside.RegInterface` 中实现第三方预约挂号接口。该包作为外部平台翻译层，将省平台或第三方平台请求转换为 `DHCExternalService` XML 调用，或从 HIS Global 读取业务数据后调用平台接口。

优先保持以下边界：

- 翻译层只做入参解析、校验、数据转换、核心服务调用和统一出参封装。
- 公共逻辑先沉淀到 `Public.cls`，再实现具体接口类。
- 不准猜测未确认的 Global 片段、状态码、院区归属或数据源关系。
- 多院区场景必须通过 `hospitalCode` 转换出的 `hospId` 做数据隔离。

## 必读

1. 目标项目 `AGENTS.md`
2. 目标项目 `.agents/config/iris_project_profile.md`
3. 本插件 `../../AGENTS.md`
4. 需要解析源文档时，读取 `extract-doc` 插件的 `skills/extract-doc-ingest/SKILL.md`
5. 进入 ObjectScript 编码、审查、上传、编译或部署时，读取 `coding-iris-plugin` 对应真实 skill 和规则

## 工作流

1. 确认输入资料。
   - 如果用户提供了已确认的执行计划 Markdown，直接读取计划并进入接口开发。
   - 如果没有执行计划，先确认接口规范文档路径；缺失时只询问文档路径。
   - 读取规范后提取接口清单、字段定义、请求/响应格式、调用模式和错误码。
   - 文档提取必须使用 `extract-doc`：
     ```powershell
     python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file <document-path> --strict
     python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
       --file <document-path> `
       --project-root . `
       --output-root docs/output/iris-external-reg `
       --schema-version iris-external-reg/v1
     ```
     对话中只汇报产物路径、字段数量、转换器和诊断摘要，不粘贴完整文档。

2. 编写执行计划。
   - 按 `../../references/execution-plan-guide.md` 生成执行计划和接口列表。
   - 区分模式 A（HIS 主动推送/上报）和模式 B（平台发起查询/操作）。
   - 在计划中列出公共入参、公共出参、公共业务逻辑、每个接口的详细设计、状态跟踪和待确认项。

3. 请求用户确认执行计划。
   - 展示完整计划，重点让用户确认接口清单、数据格式、核心层调用、公共抽取方案和详细设计。
   - 用户明确表示“没问题”“开始开发”等确认后再进入代码实现。
   - 用户提出修改意见时，先更新执行计划，再次确认。

4. 实现接口。
   - 按 `../../references/external-dev-rules.md` 开发 ObjectScript。
   - 开发顺序为公共组件、模式 B 查询/操作接口、模式 A 推送/上报接口，除非执行计划另有更合理顺序。
   - 需要 JSON 或 XML 对象互转时，分别读取 `../../references/json-to-obj.md`、`../../references/xml-to-obj.md`。
   - 需要 `DHCExternalService.RegInterface` 方法、Entity、TradeCode 对照时，先查 `../../references/reginterface-wiki-index.md`；索引不足时再按需读取 `../../references/reginterface-wiki.md`。
   - ObjectScript 编码、代码审查、上传、编译和远端验证必须按 `coding-iris-plugin` 与目标项目授权边界执行。

5. 测试和记录。
   - 使用每个方法注释中的 debugger 命令逐接口测试。
   - 覆盖必填参数缺失、格式错误、边界值、重复操作、并发冲突和跨院区访问。
   - 与 `DHCExternalService` 对应方法结果做对照，确认翻译层没有丢字段或错映射。
   - 更新执行计划的状态跟踪和接口列表 JSON。

## 强制约束

### 待确认数据源

遇到以下情况时，在执行计划中形成 TODO 列表并请求确认：

- Global 字段含义不明确，例如 `^OEORD` 的片段含义或状态码枚举。
- 同一业务存在多个候选数据源，例如 `^OEORD` 与 `^RBAS(..., "APPT")`。
- 无法从现有文档或代码直接确认数据结构、院区归属或状态含义。

TODO 未确认前，相关代码必须保留 `; TODO: 待确认 - ...` 注释，不得将接口标记为“已完成”或“测试通过”。

### 多院区隔离

所有接口默认必须接收并校验 `hospitalCode`。遍历或查询 HIS 数据时必须限制在目标院区内：

- 遍历科室使用 `^CTLOC(0, "Hosp", hospId, locId)`。
- 读取资源时校验 `^RB("RES", resId)` 关联科室属于目标院区。
- 遍历 `^RBAS` 时先通过资源或科室关系确认院区。
- 构建模式 B XML 请求对象时，将 `hospId` 传入 `HospitalId`。

详细规则见 `../../references/external-dev-rules.md` 的多院区数据隔离规范。

## 资源导航

| 文件 | 何时读取 |
|------|----------|
| `../../references/execution-plan-guide.md` | 需要从接口规范生成或修订执行计划时 |
| `../../references/external-dev-rules.md` | 开始 ObjectScript 编码、代码审查或测试修复时 |
| `../../references/json-to-obj.md` | 需要处理 JSON 与 `%DynamicObject` 互转时 |
| `../../references/xml-to-obj.md` | 需要处理 XML 与对象互转时 |
| `../../references/reginterface-wiki-index.md` | 需要快速确认核心类、方法、TradeCode、Entity 时 |
| `../../references/reginterface-wiki.md` | 索引不足，需要查看 `DHCExternalService.RegInterface` 详细方法说明时 |
