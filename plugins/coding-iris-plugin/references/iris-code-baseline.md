# IRIS 代码基线协议

本协议归 `coding-iris-plugin`。入口为 [iris-code-baseline](../skills/iris-code-baseline/SKILL.md)；离线清单由 `baseline-catalog.js` 管理，源码采集由 `code-baseline.js` 编排。各命令参数以实现的 `--help` 为准。

## 命令入口

先解析当前 `ContextRoot/config/iris-development.json` 的 developmentMode：offline 只做本地清单、状态和[离线交付](iris-offline-development.md)，不进入医院采集或资格检查；connected（含旧配置缺省）才继续远端分支，非法值停止。

现场完整源码 XML 带回后可按[本地 AI 修改与回包流程](iris-offline-development.md)处理；此分支不连接现场实例。人工 TXT/XML 清单导出独立归源仓 tools/iris-code-export/，交付无框架依赖的 ZIP，不属于下面的受管采集，也不自动建立项目开发基线。

```text
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/baseline-catalog.js build --project-root <WorkspaceRoot> --out <new-project-items.xml> --version <label> --source-ref <ref> --scope <description> --dry-run
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/baseline-catalog.js compare --left <older.xml> --right <newer.xml>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/code-baseline.js plan --project-root <WorkspaceRoot> --baseline <ProjectItem.xml> --out <source-snapshot-root> --sessions 1 --interval-ms 100
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/code-baseline.js capture --plan <plan.json>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/code-baseline.js status --plan <plan.json>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/code-baseline.js resume --plan <plan.json>
```

build 的 DryRun 核对范围后去掉 `--dry-run` 才写清单；可用 `--source-root`、`--web-base`、`--type`、`--prefix` 明确范围。plan、status 与 help 不联网；capture／resume 使用受管读取。plan 的 `--previous-plan` 绑定已有采集来源，`--sessions` 和 `--interval-ms` 必须满足目标资格限制，不能先提高参数再补 verified。

显式资格试验使用 `qualify --plan <plan.json> --confirm --budget-ms <milliseconds>`：先获得试验范围和固定预算授权，再对该计划准确对象进行受限读取；基础策略仍须 enabled。它会实际采集并在任务目录写 `qualification.pending.json`，其中 `resourceReturnVerified` 保持 false，不能自动登记 verified。先用最小范围核对退出、真实资源占用及回落，再审查资格证据；普通 capture 不使用资格试验豁免。

接受初始缺失时，先从 status 取得当前 acceptanceToken、审阅完整清单，再用 `accept-partial --plan <plan.json> --confirm --token <summary-token> --evidence <review-reference>` 保存真实接受结论。确认标志不替代有效授权，接受也不将缺失改成已取得。

已满足项目分支前提时，用 `project-plan --project-root <WorkspaceRoot> --baseline <ProjectItem.xml> --phase initial-baseline|before-edit|pre-deploy --environment-alias <alias> --environment-type test|production` 委托 source-sync 创建计划；日常阶段另传 `--demand <id>`。此命令不执行 apply、commit 或部署，后续按原 source-sync CLI 和授权接续。

source-sync 的初始 partial 与纯采集的接受入口分别处理：prepare 会保留 `excludedReadItems` 和 `partialAcceptanceToken`；存在成功子集时，审阅排除项后在有效提交授权下执行 `source-sync.js apply --plan <plan.json> --confirm-commit --accept-partial <partialAcceptanceToken>`，只应用成功集合。该 token 不与上面 code-baseline 的 acceptanceToken 互换，也不产生提交权限。

## 三个独立事实

| 对象 | 含义 | 不能据此推导 |
|---|---|---|
| 版本 XML | 该清单声明的文件集合、来源及口径 | 所取内容必然是历史版本源码 |
| 实例快照 | 指定实例在观察时间窗口内实际返回的源码 | 原子时点全库快照、所有请求同时一致 |
| 开发基线 | 绑定目标及内容摘要、可用于后续同步的已核对源码层 | 任意本地旧文件天然可信、后续服务器没有变化 |

公共版本清单来自能力包 `docs/reference/project-export-map/`；项目补充条目和实际实例内容留项目。缺少对应版本时明确核对候选清单范围，不自动套用较高版本。离线 build／compare 记录版本标签、来源 ref、类型和重复项，不自动提交或发布到框架。

## 只采集代码

采集 CLS、MAC、INC、INT、CSP、JS、CSS 及支持的文本 Web 类型。图片和其它二进制条目在网络请求前筛除，保留排除原因及数量；不按 UTF-8 写入图片，不将筛除项算成 404 或失败。XML 包需要图片时转 [XML 导出协议](iris-xml-export.md)。

代码清单经筛选后逐项分到 fetched、reused、missing、empty、failed 或 cancelled 等互斥结果；尚未完成的 pending 不计成功。排除项另列，回执保留 `excludedImageCount` 和 `excludedImages`，原清单、代码候选和最终结果数量可对账。返回内容为空是独立异常，不据两次复现断言服务器文件必为零字节。

## 初始采集与开发分支

纯采集与标版场景复用公共 reader、映射和持久快照，不要求 project 需求类型、不进入 project 专用提交状态机，也不自动初始化 Git。输出范围和路径仍限定在当前声明的工作区与明确选择的采集位置。

已确认 `project`＋`intent-first-on-demand-export` 时使用 [项目开发协议](project-demand-development.md) 的 `initial-baseline`／`before-edit`／`pre-deploy`。该分支已有本地 Git、环境声明及许可资格前提；提交、复审和部署沿原状态机。多个 GitRoot 分别计划、串行写入并组合回执，不声称跨仓原子性。

首次可全量或明确子集；日常只刷新准备修改的对象及必要上下游，部署前重新核对。mtime、Atelier 时间戳或文件大小仅是辅助信息，当前内容摘要是基线依据。

初始缺失允许形成 `partial`，保留完整缺失与异常报告；接受差异后仍注明部分基线，不能改报完整成功。日常已有服务器基线的必需对象返回 404 时停止核实；新对象原本没有服务器基线的情况按当前需求另行核对。未采集、404 和空内容不会直接转成文件删除或喂入可接受删除的三方合并；真实删除需要按需求核实来源与含义。

## 现场与恢复

写入前保护已有源码、只读属性、Git HEAD/index 和本地修改，先对比后写。没有可信基线且内容不同就停止核实，不解除只读后删除重写。采集授权不包含自动 commit；有本地提交授权时才沿对应状态机处理。

断点绑定工作区、真实 SourceRoot/GitRoot、环境及配置指纹、namespace、清单摘要、筛选范围、通道和内容表示。每个文件保存摘要并验证读回；同大小文件变化也必须检测。私有恢复资料归 ContextRoot，不能写共享 CapabilityRoot 或把含凭据配置复制进回执。

长任务先做最小批次，从新进程读回并恢复一次，再扩大。首次长采集可复用相同来源的已核验历史观测，但必须报告采集起止窗口；进入实际开发前按需求刷新。日常同步中断后仍重新观察整个需求集合，避免将旧完成项冒充当前实例状态。

## 会话、资格与停止

复用 `scripts/lib/atelier-client.js` 与 `iris-remote-operations.js`。同许可池的跨进程 operation 排他继续为 `maxConcurrent=1`；仅在一个受管只读批次内部使用独立 Cookie 会话池，写入和编译保持原边界。

source-sync 已使用同一 read-pool。超过 5 个文档需要新版 `readBatch.qualification` 证据；旧 bulkQualification 仅有文件或状态不再足够。这是 0.22.0 对既有调用的收紧，升级按 runbook 重验和绑定，不自动转换旧资格或伪造 verified。

多会话资格绑定实际目标、`channel=atelier`、配置指纹、读取运行时指纹、服务器版本、实例 id（字符串或 null）、会话上限、最小间隔与证据摘要；旧证据缺任一必需字段即无效。每批在受管 owner 内复用 worker 0 的 Cookie，只对 API 根执行一次 serverInfo 探测，核对版本和实例后才读取文档，避免升级服务器或更换客户端后沿用旧资格。接口为 `GET <pathPrefix>/api/atelier/`，版本来自 `result.content.version`、实例来自 `result.content.id`，见 [InterSystems GetServer 协议](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GSCF_tutorial)。此额外探测有准确路径和次数限制，不开放任意只读接口。

默认 balanced 请求 4 会话／100ms，safe 请求 1／200ms，fast 请求 10／50ms；请求值与实际值分开报告。没有多会话资格时降至已有基础资格的单会话；显式超出资格的会话数或更快间隔停止，隐式间隔可钳制到已验证下限。普通采集连基础资格也未具备时停止，仅上面的显式资格试验可在独立授权与预算内取证。用户样本的速度和 worker 数不构成跨环境默认性能或实际 License 单元证明。

任一 worker 遇到 503 即停止派发，收束在途请求、持久保存结果、逐一关闭自有会话并由公共层熔断；不自动重试、换路或解除活 owner。资格窗口实测占用与回落，日常记录自有会话退出和资格引用；`licenseReleaseVerified:false` 本身不把正常批次变成 unknown。退出失败、503 或结果不明保留阻断与恢复 token。

## 分发与验证边界

沿 [安装更新 runbook](../../../docs/update-agents.md#iris-xml-导出与代码基线coding-022) 取得 owner 和公共库；帮助、源文件、索引、宿主发现及真实采集分别核实。单元测试只证明覆盖的本地行为；跨平台矩阵、旧服务器兼容、目标许可资格及实际项目更新分别报告，不以文件存在代替已生效。
