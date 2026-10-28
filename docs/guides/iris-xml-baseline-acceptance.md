# IRIS XML 导出与代码基线验收

先在测试环境完成小样本，再扩大读取范围。本指南用于验收框架接入和升级；连接、namespace、服务器目录及业务对象名单留目标工程私有配置和任务中。操作参数以两个 CLI 的 `--help` 为准，完整协议见 [XML 导出](../../plugins/coding-iris-plugin/references/iris-xml-export.md)和[代码基线](../../plugins/coding-iris-plugin/references/iris-code-baseline.md)。

## 核对本地交付

1. 核对 `coding-iris-plugin` manifest 为 `0.22.0` 或后续兼容版本。确认两个新 skill 源、`scripts/iris-tools/` CLI、`vendor/xml-parser/` 和专用类源均已取得。更新按[安装更新 runbook](../update-agents.md#iris-xml-导出与代码基线coding-022)执行；源码交付不等于实际项目已经更新。
2. 明确 WorkspaceRoot、ContextRoot 和 CapabilityRoot。standard 从本项目 `.agents` 解析；Overlay 从既有 manifest 解析，不能猜父目录或写共享能力包的任务状态。
3. 直接运行框架路径下 `xml-export.js --help`、`xml-scope.js --help`、`code-baseline.js --help` 和 `baseline-catalog.js --help`。帮助应在连接、配置检测和写入之前结束。
4. 宿主中仍有旧全局同名 skill 时，先以真实框架路径验证；用户级旧源及 Junction 沿 `skills-sync` 单列迁移，不由项目更新器删除。

专用类源为 [XmlPackage.cls](../../plugins/coding-iris-plugin/templates/DHCDoc/Util/XmlPackage.cls)。本地交付时未真实编译的类须保持待验；安装 XML 必须由该源码编译后原生 Export 生成，不提供手工拼装的安装包。

## 准备连接与资格

核对本项目既有 `.mcp.json` 和 `project-env.json`，保持原凭据及配置来源；冲突先处理。为当前目标准备受忽略的 `iris-remote-policy.json`，参考 owner 的模板；正常更新不替用户填入真实目标或把 pending 改为 verified。

先选择 3–5 个已知存在的代码对象组成小清单，明确授权本次读取和时限。用单会话生成计划，再运行受限试验；以下变量均须先解析为当前项目的实际值：

```powershell
$tools = Join-Path $capabilityRoot 'plugins/coding-iris-plugin/scripts/iris-tools'
$localPlan = node (Join-Path $tools 'code-baseline.js') plan --project-root $projectRoot --baseline $smallCatalog --out $baselineOut --sessions 1
if ($LASTEXITCODE -ne 0) { throw 'Baseline plan failed' }
$baselinePlan = ($localPlan | ConvertFrom-Json).planPath
node (Join-Path $tools 'code-baseline.js') qualify --plan $baselinePlan --confirm --budget-ms 60000
if ($LASTEXITCODE -ne 0) { throw 'Baseline qualification trial failed' }
```

`--confirm` 接收已取得的任务授权。`qualify` 会实际采集文件并推进计划状态，资格回执维持 pending：从新进程读回文件与断点，独立观察真实资源占用及回落，核对自有会话退出后，才能审查形成相匹配的资格证据并登记其摘要。基础 `qualification.status/reference` 和 `readBatch.qualification.status/reference/sha256` 均须有效，不能只修改 pending 回执的状态。缺少资源观测时保留待验。

多会话按同样方式逐档验证，不用单会话小样本批准全库或 4／10 会话。证据的 `maxDocuments` 仅覆盖已验证上限；扩大到中批、全量前须另做对应范围的受限试验并复核资源。

日常批量证据须匹配通道、实例、namespace/API 路径、服务器版本、配置／运行时指纹，以及会话数、最小间隔和文档上限。每批先用同一 Cookie 探测服务器身份，变化时停止核对。会话数不等于实际 License 单元。

## 验收代码基线

1. 选一个独立、可保留的源码快照目录作为 `$baselineOut`，不要复用含未知本地改动的目录。首次纯采集不要求建 Git，也不会自动 commit。
2. 通过对应资格后，对新的小范围计划执行 `capture --plan <plan.json>`；用 `status` 检查逐项结果和实际会话数。同目录更新时通过 `plan --previous-plan <old-plan.json>` 证明旧文件归属，先核对已有快照。图片应在请求前排除并有完整数量／名单，源码只收代码。
3. 新开进程读回文件并抽查声明、内容摘要。对未完成计划用 `resume` 验证中断接续；已完成计划应创建新计划。同长度本地改写、换环境或换清单应在读取／覆盖前停止。
4. 对缺失项核对完整明细。允许的部分结果通过当前 token 和复核证据执行 `accept-partial`，结果仍为 `accepted-partial`；失败、取消或退出不明不能冒充完整基线。
5. 日常开发刷新准备修改的文件及必要上下游。只有明确 `project`＋按需开发模式才进入 `source-sync`；已有服务器基线返回 404 时核实，不自动删除本地代码。初始 partial 只应用成功子集，写回及提交沿有效授权。
6. 完成小样本、中批验证后才读完整版本清单，逐项对账范围、成功／复用／缺失／空／失败／取消、排除图片及最终文件摘要。记录采集起止窗口，不将它当成历史版本源码。

## 验收 XML 两条通道

先用 `xml-scope` 形成候选，再由 Agent 与用户核对最终清单。最小清单为 `{"items":[{"name":"Example.Sample","type":"CLS"}]}`；Web／图片使用已确认的完整文档名，类型为 CSP。验收混合包至少包括类、例程、CSP、JS、CSS 和一张原图，图片在本地保留原始字节摘要作对照。

选择以下一种准备方式。两条通道均验收时，先在未部署专用类的测试 namespace 验证执行通道，再导入、编译类源验证类通道，保留同一清单作对照：

- **类通道**：核对目标现有同名类和调用方，将 canonical `.cls` 按工程既有类导入／部署流程导入明确的测试 namespace 并编译；有差异先审查，不覆盖未知实现。新接口是 Dispatch／GetExportInfo，旧外部 ExportDocs／ImportFiles 不能直接沿用。
- **执行通道**：先在未部署专用类的测试 namespace 验证。默认 WS terminal 需要 IRIS 2023.2+／Atelier API v7+ 和对应资源资格；命令超过 32KiB 时选择类通道。显式 HTTP MCP 执行须另外接受并验证该 vendor 的内部重试，不能自动降级过去。

计划参数中的 namespace、通道、受控服务器任务根和 Web 应用均须核实；仅包含代码对象时可省略 `--web-application`，含 Web／图片时必须核对其映射。根目录无需公开 HTTP 下载。按真实 CLI 依次执行：

```text
xml-export.js plan --project-root <WorkspaceRoot> --manifest <confirmed-items.json> --namespace <NS> --channel class --server-root <private-server-task-root> --web-application </verified/webapp> --name <package.xml>
xml-export.js preflight --plan <plan.json>
xml-export.js export --plan <plan.json> --confirm-export
xml-export.js download --plan <plan.json>
xml-export.js verify --plan <plan.json>
xml-export.js cleanup --plan <plan.json>
```

执行通道把计划的 `--channel class` 改为 `--channel execute`；其余目标和清单保持一致。所有连接和远端临时写入须有当前任务授权。

验收通过条件：实际 namespace 和 Web 映射一致；对象身份与名单严格相等；图片 CSPBase64 解码后与原图摘要一致；合包／分文件和 flat／tree 无冲突；禁用 HTTP 文件下载后仍可分块取回；私有断点可从新进程恢复；正式包只在全部校验通过后发布；服务器本人任务文件及会话收尾分别可核实。

在获准的独立测试实例导入混合包，保持包内应用虚拟路径，并将其映射到独立物理目录和测试 namespace。共用实例时须先证明 Web 应用和物理目录均已隔离；仅更换 namespace 不足以隔离 CSP／图片。核对对象与原图载荷后，才可报告可导入性验收通过。再从已编译 canonical 类导出仅含该类的安装 XML，并在另一隔离 namespace 验证导入；绑定源和安装包摘要、owner 版本及生成环境版本。

## 异常和最终回执

Export 结果不明时保留原 runId，不重复提交。公共 owner 熔断或 unknown 时，先核实原任务和资源，沿既有 `iris-remote status/reconcile` 恢复公共状态，再 inspect 原任务。本地 recover-lock 只处理证死的本机锁，不解除公共熔断。清理失败保留准确路径和 token，恢复后只处理本人任务文件。

最终分别报告：能力包文件／索引、宿主加载、基线内容、XML 内容、服务端类编译、安装 XML、资源资格及清理。仅在实际测试过的系统、IRIS 和运行时版本上声明通过；框架本地 mock 不替代真实服务器验收。
