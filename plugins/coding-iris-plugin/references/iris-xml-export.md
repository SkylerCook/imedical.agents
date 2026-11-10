# IRIS XML 导出协议

本协议归 `coding-iris-plugin`。入口为 [iris-xml-export](../skills/iris-xml-export/SKILL.md)，实现参数以 `scripts/iris-tools/xml-export.js --help` 为准。

现场已导出完整源码 XML、需要带出交给 AI 修改时，使用[离线拆分/编辑/回包](iris-offline-development.md#固定处理路径)。该分支不连接实例，不自动导入或编译；本协议继续管理服务器生成 XML 的受管通道。

## 命令入口

先解析当前 `ContextRoot/config/iris-development.json` 的 developmentMode：offline 不执行医院 XML 导出，已有实际源码或完整 XML 按[离线交付](iris-offline-development.md)处理；connected（含旧配置缺省）继续，非法值停止。本地清单比较和帮助无需医院连接。

下列命令从已解析的 CapabilityRoot 定位脚本，`<...>` 替换为目标项目参数。先准备确认清单，最小结构为 `{"items":[{"name":"Example.Sample","type":"CLS"}]}`；Web／图片条目使用已核对的完整文档名和 `type: "CSP"`。`xml-scope.js` 的 items 与此结构共用。

```text
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/xml-export.js plan --project-root <WorkspaceRoot> --manifest <confirmed-items.json> --namespace <namespace> --channel class --server-root <private-server-task-root> --format iris
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/xml-export.js preflight --plan <plan.json>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/xml-export.js export --plan <plan.json> --confirm-export
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/xml-export.js download --plan <plan.json>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/xml-export.js verify --plan <plan.json>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/xml-export.js cleanup --plan <plan.json>
```

计划默认合包，`--name <merged.xml>` 选择合包名，`--split` 按对象分文件；`--layout flat|tree` 在分文件时生效，默认 flat，同名目标在计划阶段停止核对。`--format cache` 选择兼容格式，执行通道用 `--channel execute`。`--out` 显式指定正式交付目录，`--web-application` 指定已核对的 WebApp。namespace、通道及私有服务器任务根均为计划显式输入，连接仍复用现有配置，不增加另一份 xmlExport 连接配置段。

`plan` 只生成本地私有计划，`status` 只读本地状态。`preflight`、`inspect`、`export`、`download` 和 `cleanup` 会连接目标；实际调用必须有对应授权。执行通道默认 `--executor terminal`，在同一个受管 MCP 进程中完成 iris_ws_open／exec／close；需要 IRIS 2023.2+／Atelier API v7+ 及目标资格。canonical XECUTE 私有块的 UTF-8 命令硬上限为 32KiB，计划阶段预检，超限明确选择类通道，不自动切换。源代码生成测试不替代真实目标语法与资源退出验收。

显式 `--executor mcp` 使用 HTTP iris_execute。vendor v1.5.0 可在内部进行最多 3 次尝试，只有适用策略的 `qualification.channels.mcp.acceptInternalRetries=true` 才允许，回执披露内部重试可能性；不能宣称整个 MCP 零重试。客户端不重复提交 Export，但这不消除所选 HTTP vendor 的内部重试。WS close 回执与 MCP 进程退出分别记录，均不等同 License 回落。

Export 已送达但结果不明时，先按现有 `iris-remote status/reconcile` 核实原服务器任务、资源和公共 owner，再 `inspect --plan <plan.json>`；公共 owner 仍熔断或待核实时 inspect 也停止，不能重放 Export 或换通道。`recover-lock --plan <plan.json> --confirm-recovery --lock-token <status.localLock.token>` 仅在本机原进程已证死且 token 匹配时恢复本地计划锁，不清理或解除公共锁。

verify 仅发布完整校验通过的本地包，cleanup 单列执行。正常 cleanup 要求本地包已 verified；未验证或失败任务如确需丢弃，先核对范围与恢复需要，再在明确授权下使用 `--confirm-discard`。该参数不产生用户授权。

## 范围与来源

XML 包保存**指定环境当前对象**。本地源码用于定位对象及发现依赖，尚未上传的修改不因此进入包。对象范围同时包含类型与远端文档身份；类从实际 Class 声明取名，Web 使用项目已确认的虚拟路径。

`xml-scope.js` 可从页面、Git 差异、关键字或明确路径发现候选。静态扫描不能证明动态调用、业务配置、字典、菜单和数据已随模块完整迁移；由 Agent 分析并与用户确认最终对象集合。读取服务器 Studio 工程清单属于显式远端发现步骤。

离线候选命令为 `files <paths...>`、`changed [--since <revision>]`、`grep <literal>`、`page <path> [--with-backend]` 和 `all`；`baseline` 仅兼容为 all。共用 `--project-root`、`--web-base`、`--out-list <scope.json>`、`--json`。输出 `candidateOnly: true`、items 及 unresolved／missing／deleted／renames／externalReferences／excluded 等明细，包含图片。默认不写文件，显式 out-list 只写当前工作区文档或任务目录，不写源码、私有配置或共享能力目录；候选不会自动导出。

XML 导出覆盖 CLS、例程、文本 Web 和图片等二进制 Web 资源。已有图片无损样本可用于回归；载荷通过解码后字节摘要验证，不能用条目数或肉眼观察替代。代码基线对图片的排除不影响本入口。

XML 解析复用能力包固定分发的 `saxes 6.0.0` 与 `xmlchars 2.2.0`，严格解析并拒绝 DTD／实体声明。它们是已固定版本的纯 JavaScript vendor 依赖，运行时无需 `npm install`；来源、许可证、维护风险及摘要按 [vendor 说明](../../../vendor/xml-parser/README.md)核对，不能宣称完全零第三方依赖。

## 两条通道

| 通道 | 前提 | 生命周期 |
|---|---|---|
| 专用类 | 目标 namespace 已有兼容的 `DHCDoc.Util.XmlPackage` | 提供导出、能力探测、任务产物读取及清理；所有文件限本任务登记范围 |
| 原生执行 | 默认 WS terminal 通过目标版本／API／资格预检；HTTP MCP 为显式且接受其内部重试的选项 | 直接调用 `$System.OBJ.Export`，无需提前部署专用类；WS 会话、MCP 进程及 XML 文件分别收尾 |

通道由当前项目明确选择，预检与执行使用同一目标。失败后停止并保留断点，换通道属于新任务或明确重新计划，不能自动重放。两条通道都不依赖 QTZ 类或项目业务辅助类。

专用类唯一维护源为 `templates/DHCDoc/Util/XmlPackage.cls`；经真实隔离环境生成和导入验证的安装 XML 才能作为已验证安装产物分发。源文件、安装 XML、协议和 owner 版本分别核对；协议标识不另设组件 SemVer。

类的存在不能证明能力兼容。探测返回实际 `$namespace`、协议及方法能力，且不创建服务器文件。初始化器提供两种准备方式；可选类缺失仅影响类通道，插件其它能力仍可使用。正常更新不会自动覆盖或编译服务器类，已有实现先核对调用方与接口差异。

本版 API 为 `Dispatch(payloadBase64)` 和 `GetExportInfo(expectedNamespace)`；项目清单能力通过 Dispatch 的 `operation=project` 承接。旧用户级实现的 `ExportDocs`／`ListProjectItems`／`ImportFiles` 签名不构成新协议兼容接口，任意服务器路径读写不保留。目标已有同名类时，先定位旧调用方、保存已核对旧源、迁移调用及验证后再切换；不得因类名一致就覆盖线上实现或沿用旧调用。未完成该迁移可明确选择原生执行通道。

## 配置和授权

按 [连接配置指南](../../../docs/guides/connection-configuration.md) 与 owner workspace 约定解析配置：`.mcp.json` 是 MCP 连接事实源，project-env 是项目私有配置；冲突停止。Overlay 从 ContextRoot 读取私有配置，仅按显式继承声明回退。实际运行 namespace 必须与计划、配置和回执一致。

导出授权覆盖确定的对象、环境和本任务服务器文件创建／读取／清理。安装类、上传编译、业务对象导入、数据库写入及生产发布沿各自有效授权；配置或 CLI 确认标志不自动授予权限。原生 MCP／终端必须按当前准入边界接入，不能成为避开共享资源门禁的路径。

服务器 XML 生成保持串行。源码采集的多会话资格不授予并行服务端执行、导出、上传或编译权限。

## 任务与校验

先本地计划，再预检及执行。正式 XML 交付归目标工程的 owner delivery 目录，私有计划与恢复回执归当前 ContextRoot。长批次先验证持久写入、新进程读回，再按批次保存准确的对象清单、产物身份和摘要。

服务器使用任务独立目录，拒绝通配符、逗号范围扩展及越界路径。两通道使用标准 IRIS 文件／流的分块读取，核对偏移、长度、Base64、结束标记及摘要，支持中断后取回原产物，导出目录无需公开 Web 访问。复用 HTTP／文件传输时仍须核对认证、TLS、实际端口及路径；临时状态未确定时先回读，不重新 Export 冒充恢复。

完整交付逐项核对：

- 结构可解析，根与条目合法；实体、CDATA、紧凑 XML 和属性顺序不影响解析。
- 确认对象与实际集合一致，没有缺失、重复、额外对象或空包。
- 合包／分文件及 IRIS／Cache 格式符合选择；每个产物有身份和摘要，二进制解码载荷无损。
- 来源 namespace、任务身份和产物取回一致。清理只接受本任务登记的文件，不开放任意远端读删。

下载或校验失败时保留可恢复产物及错误明细；部分文件成功不能报告整个包完整。服务端生成、下载校验、清理及业务部署分别报告。混合包导入验收使用获准的独立测试实例，或先证明 Web 应用和物理目录均隔离；仅换 namespace 不足以隔离 CSP／图片。导入验收用于证明包可用，不产生业务环境导入授权。

## 升级

按 [安装更新 runbook](../../../docs/update-agents.md#iris-xml-导出与代码基线coding-022) 取得完整 owner、根公共库和薄索引；缺失入口先核对 enabled 状态。全局旧名 `iris-xml-package` 沿 `skills-sync` 明确迁移，项目更新器不删除用户级原件或链接。
