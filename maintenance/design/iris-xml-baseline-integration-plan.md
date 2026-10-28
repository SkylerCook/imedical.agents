# IRIS XML 导出与代码基线框架接入计划

日期：2026-10-28。状态：本地框架实现已完成。用户选择交付本地实现、专用类源及验收步骤，随后授权本批提交并推送；仍不更新实际项目或部署服务器。本计划保留后续接入流程，真实环境验收尚未执行，提交推送结果以 Git 回执为准，实际证据与未完事项以维护日志和 backlog 为准。

本地交付含两个 skill、owner CLI、公共会话池、自包含类源、固定 XML 解析依赖、版本及迁移说明、专项测试和[验收指南](../../docs/guides/iris-xml-baseline-acceptance.md)。本机回归已覆盖共享及旧流程、新增组合、source-sync 差异、PowerShell 7／5.1 更新器和 thin-index；跨平台矩阵仅完成配置，未执行远端 CI。专用类未真实编译，安装 XML 未生成，双通道真实导出及 License 资格仍待授权窗口验收。

## 目标与已确定边界

将现有两个用户级 skill 收敛到 `coding-iris-plugin`，使项目通过正常安装和更新取得能力，并能独立验证源码、入口、服务端能力及真实导出结果。

| 项目 | 定稿方向 |
|---|---|
| owner | 两个入口均归 `coding-iris-plugin`，复用现有连接、workspace、源码同步和远端准入 |
| XML 入口 | `iris-xml-export`；Agent 与用户确定准确对象清单后，从指定环境导出当前对象 |
| 基线入口 | `iris-code-baseline`；版本 XML 限定文件集合，内容来自指定实例当前状态，不代表历史版本源码 |
| 服务端类 | 保留 `DHCDoc.Util.XmlPackage`，继承 `%RegisteredObject`；作为可选、自包含的导出服务 |
| XML 通道 | 专用类通道，以及 MCP／终端直接调用 `$System.OBJ.Export` 的执行通道；完全去除 QTZ 依赖 |
| 初始基线 | 允许全量或明确子集；缺失可形成 `partial`，保留完整结果，接受差异后仍标记 `accepted-partial` |
| 日常更新 | 刷新需求准备修改的对象及必要上下游，部署前重新核对；沿现有 `source-sync` 流程 |
| 多会话 | 本轮实现基线只读获取的受管会话池，按目标环境资格启用；已有基础读取资格但无多会话资格时使用单会话 |
| 授权 | 实施、提交、推送、业务副本更新、服务端导入编译及真实环境验收分别沿有效授权执行；启用或更新不自动部署类 |

首版覆盖 CLS、MAC、INC、INT、CSP、JS、CSS 及现有文本 Web 类型。XML 包覆盖图片等二进制 Web 资源，沿已有图片无损样本补做框架回归。基线只采代码，图片在网络请求前筛除并记录完整排除列表及数量，其它不支持类型明确报告，不按 UTF-8 写入二进制资源。

本轮不新增 XML 导入 skill、不建设历史版本源码恢复、不提供业务配置或数据的整站自动迁移，不建立跨 GitRoot 原子事务。文件范围工具提供候选，完整的模块交付范围仍须经过 Agent 分析和用户确认。

## 命名与资产归属

`XmlPackage` 符合现有 UpperCamelCase 规则，能够表达合包、分文件、格式和产物管理。`Util` 与当前公共工具包用途一致；现有框架未确立另一套通用服务端根包，本轮不为风格新造包名。`DHCDoc` 是本次固定类契约，不是所有 IRIS 项目的包名前缀要求。包名与运行时 namespace 分别核对。

已采用以下目录，实际命令以 CLI 的 `--help` 和使用协议为准；安装 XML 是后续真实编译验收产物，本地交付不包含伪造安装包。

```text
plugins/coding-iris-plugin/
  skills/iris-xml-export/SKILL.md
  skills/iris-code-baseline/SKILL.md
  scripts/iris-tools/xml-export.js
  scripts/iris-tools/xml-scope.js
  scripts/iris-tools/baseline-catalog.js
  scripts/iris-tools/code-baseline.js               # 纯采集、资格验证及项目分支编排
  scripts/iris-tools/source-sync.js                 # 复用并扩展
  scripts/iris-tools/source-sync-core.js            # 复用并扩展
  scripts/iris-tools/tests/                         # XML、清单及基线专项
  references/iris-xml-export.md
  references/iris-code-baseline.md
  templates/DHCDoc/Util/XmlPackage.cls              # 唯一维护源
  templates/DHCDoc/Util/XmlPackage.install.xml      # 待真实编译后原生生成并验证，当前未提供
scripts/lib/atelier-client.js                      # 扩展受管只读批次
scripts/lib/iris-remote-operations.js               # 保留跨操作排他
```

共享换算逻辑归 owner 的 `scripts/iris-tools/`，取消跨平级 skill 的相对依赖。XML 解析经评估采用固定 vendor 的 `saxes 6.0.0`／`xmlchars 2.2.0`，严格模式并拒绝 DTD／实体声明；纯 JavaScript，无运行时 npm 安装。该依赖例外按 vendor 来源、许可证及摘要管理，其余 CLI 延续 Node 内置模块优先，不用固定行首或属性顺序正则冒充完整 XML 校验。

正式 XML 交付归目标工程既有 `docs/delivery` 约定；源码归声明的 SourceRoot；快照、断点、资格与运行状态归当前 ContextRoot 的受忽略任务目录。为 XML 导出补充 owner `projectDirectories` 声明并接入现有目录解析，不向共享 CapabilityRoot 写任务产物。

公共版本清单保留在 `docs/reference/project-export-map/`。项目增补清单和环境内容留项目。现有 v9.2 XML 已在框架内，复用原资产，不重新生成冒充同一版本。

## 实施基点和已处理缺口

计划基点为源仓 `5282be440f7048cd88b01aa7b2649bb69d973cbd`，`coding-iris-plugin 0.21.1`。执行前重读 HEAD、manifest 和现场差异；并行工作推进时调整版本及受测范围，保留无关修改。

| 缺口 | 本轮处理 |
|---|---|
| 两个外部 skill 自管连接、根目录及分发依赖 | 接入 workspace resolver、现有私有配置、统一帮助和 plugin thin-index |
| 版本 XML 与历史源码语义混淆 | 清单记录来源和范围；基线记录实际采集环境与观察时间窗口 |
| 默认覆盖、解除只读、按大小续跑 | 使用现有现场保护、摘要及原子保存；已有文件冲突停止，不删除重写 |
| Git porcelain 截断及 rename／中文路径问题 | 复用经验证的 Git 枚举逻辑，按 `-z` 正确处理状态和路径 |
| 部分 XML 导出缺失仍返回整体成功 | 按确认清单逐对象核对，缺失、额外对象、重复或解析失败均阻断完整交付 |
| XML 解析、合并与路径越界 | 覆盖属性顺序、实体、CDATA、紧凑 XML、相对路径及链接边界 |
| 专用类依赖业务辅助类和固定 Web 根 | 去除 `GenFile`、`ext.util.String`、`websys.Configuration` 等依赖，改为标准系统能力与已校验的私有配置输入 |
| 服务端共用目录、包名碰撞、无清理接口 | 每次任务独立目录，保存准确产物归属，按任务读取和清理 |
| 4 会话实现与现有准入单 owner 冲突 | 保留同许可池跨进程排他，仅扩展单批次内部只读会话池 |
| 旧协议示例仍调用 QTZ 路径方法 | 两通道共同使用项目配置和已核实的应用映射，移除全部 QTZ 路径与 SQL 依赖 |
| 框架 v9.2 说明仍指向外部 skill 及旧生成参数 | 更新为 owner 入口和实际命令；将“图谱”统一说明为版本导出清单，缺版本时显式确认范围 |

两次空响应只作为稳定复现，不能直接归因为服务器文件为零字节。404、空内容、认证、路由及接口错误分开记录。14.8 条/秒是用户样本的条目处理速率，不作为所有环境承诺，也不把 worker 数等同于实际 License 单元。

## 实施阶段与完成条件（流程留档）

以下为本次定稿的实施与后续接入流程，保留各阶段完成标准，不作为尚待从头执行的清单。本地实现、文档和回归已经完成；真实试点、安装产物、发布、实际项目更新及旧用户级入口迁移尚未执行。后续只按本文末尾“下一步工作计划”推进，XML 与基线可并行，公共远端库仍由一个集成人负责；没有子代理时按同一顺序串行执行。

### 第一阶段 冻结范围和保护现场

1. 记录框架、两个外部 skill、指定专用类的当前摘要及已有 Git 状态，核对来源和可分发边界。
2. 执行时读取目标项目自己的 AGENTS、上下文和安装状态，解析 WorkspaceRoot、ContextRoot、CapabilityRoot、SourceRoot 与 GitRoot；检查前后端独立仓库，不能以父仓状态代替。
3. 形成试点私有记录：实际目标、环境别名、所选通道、范围、安装版本、类现状和恢复位置。真实连接及业务文件名单只存目标工程，不写本共享计划或框架模板。
4. 若目标源码已有 `XmlPackage`，先比较接口及内容；服务器是否已部署、是否有调用方通过后续授权的只读预检确定，不按旧记录假设尚未部署。

完成条件：范围和恢复点能独立读回，无未解释的覆盖对象；本轮新增临时资料有准确归属。

### 第二阶段 统一清单和 CLI

1. `xml-scope.js` 接收页面、Git 改动、关键字和明确路径，输出候选与全部未解析项；候选不能直接代表口腔工作站等模块依赖已经闭合。
2. 复用 `prepare-deploy-manifest.js` 的 workspace／文件描述语义和 `source-sync` 的版本 XML 映射。已有 schema 能表达的字段直接复用，补齐远端对象身份和摘要，避免维护同内容的第二份名单。
3. 明确区分本地路径、IRIS 文档名和 ProjectItem 的输入类型，拒绝依靠字符串猜测；类名从 Class 声明取得。
4. `baseline-catalog.js` 承接离线 build／compare，版本标签、来源 ref、范围和重复项可核对；生成清单不自动发布或提交到框架。
5. 新 XML CLI 提供本地计划、通道预检、执行、校验、状态和清理入口；`code-baseline.js` 提供纯采集、续跑、受控资格验证和项目分支编排。帮助优先结束；离线计划不联网、不部署、不修改业务源码。需要读取服务端 Studio 工程名单时，单列明确的远端发现步骤。

完成条件：同一确认清单可交给两条 XML 通道；中文、空格、重命名、新文件及缺失引用均可追踪；全部拟新增命令以实际 `--help` 验证后写入使用文档。

连接配置继续使用当前 `ContextRoot/config/project-env.json` 与 `.mcp.json`，不新增 xmlExport 连接配置段。XML 的 `class/execute` 通道、expected namespace、受控导出根及可选 WebApp 作为 plan 显式参数，绑定既有连接指纹；执行器由已接入的受控通道提供。多会话预算和资格扩展现有 `iris-remote-policy.json`，不增加另一套连接文件或全局资格注册库。新增字段的 schema、默认值、旧文件缺字段行为和配置校验测试一并交付。

### 第三阶段 改造专用类和执行通道

专用类保持一个文件和固定类名，仅依赖 IRIS 标准类。导出、项目名单、受任务约束的读取与清理由新 `Dispatch(payloadBase64)` 协议承接，探测使用 `GetExportInfo(expectedNamespace)`；首版不保留旧 ExportDocs/ListProjectItems/ImportFiles 签名及任意服务器路径接口。目标已有同名类时先查调用方、核验旧源恢复和迁移方案，不因同名直接覆盖线上契约；迁移未完成可明确选择原生执行通道。

接口验收要求：

- 能力探测返回协议标识、实际 `$namespace`、支持格式和方法能力，且探测不创建导出文件。协议标识用于兼容，不形成插件内独立 SemVer。
- 导出只接收准确名单，拒绝通配符、逗号范围扩展、非法类型及越界目录。统一 Web 虚拟路径规则，按真实服务器版本验证前导 `/` 的要求。
- 合并／分文件、flat／tree 和 IRIS／Cache 兼容格式均返回逐对象结果及最终产物；失败保留全部明细。
- 客户端在调用前持久化 `runId`、目标、namespace 和范围摘要，服务器先登记任务再执行 Export。两通道均能按该 `runId` inspect，恢复“导出已执行但回执丢失”；不得因此重放 Export。
- 每次任务有独立标识和目录。读取和清理仅接受该任务登记的产物，不开放任意服务器文件读删。清理幂等，任务登记最后处理，清理中断后能识别本人剩余文件。
- 格式选项优先使用单次 Export 的 `qspec`；必须切换进程 qualifiers 时，正常、错误和异常路径均恢复原值。

执行通道通过已授权的 MCP 或现有受控终端调用 `$System.OBJ.Export(items, filename, qspec, .errorlog)`，无需预部署专用类。两通道的 Export、inspect、读取和 cleanup 都核对并回传运行时 namespace，绑定目标及任务摘要；Web 对象另外核对实际应用映射。两通道共用文档规范、产物回执和校验。MCP 自身的临时执行类、终端会话和服务器 XML 均纳入生命周期；不将“无需预部署类”描述为没有服务器临时状态。

复用目标工程已有的 HTTP／文件传输时，核对认证、TLS、真实下载端口及路径约束。本轮同时实现并验证标准 IRIS 文件／流分块读取，经所选 MCP／终端返回块偏移、长度、Base64 编码、结束标记及摘要，覆盖二进制、截断、丢块、重复块和中断续取。主动禁用 HTTP／文件传输做验收对照。导出目录与源 Web 应用根分开，不要求 XML 放在公开 Web 目录；临时载体或清理结果不明时保留恢复记录，不重放导出。

完成条件：实现没有 QTZ 类、SQL 或路径方法依赖，两个通道和自包含类的静态检查及 mocks 通过，可进入第六阶段的真实编译、无类证明和双通道验收。

### 第四阶段 接入基线和多会话

1. `iris-code-baseline` 按已有上下文选择编排：纯初始采集／标版场景复用公共 reader、文档映射、内容快照及原子落盘，不调用强制 `project` 和 Git 的提交状态机；已有文件仍要保护，已有 Git 时核对现场。只有满足项目按需开发分支条件时，才进入 `source-sync` 的 `initial-baseline`／`before-edit`／`pre-deploy`。抽取共用读取能力，不另维护一套覆盖式 pull；Git 初始化和阶段提交仍须授权。
2. 多 GitRoot 按已声明根分别计划和串行落盘，组合展示结果；任一根失败保留其余根的准确状态，不宣称跨仓原子完成。
3. 完整保存 `fetched/reused/missing/empty/failed/cancelled` 等逐项结果，数量守恒。初始缺失可以 partial，只有已验证成功集合进入应用和基线登记；其它项保留在父批次结果，不作为 null 传入写回／三方合并。`accepted-partial` 绑定清单摘要、接受的缺失集合和成功内容摘要，续跑改变集合后原接受失效。日常必需对象缺失先阻断；明确确认的删除另走既有删除契约。
4. 断点绑定工作区、真实 GitRoot、SourceRoot、环境和配置指纹、namespace、清单摘要、筛选范围、通道及内容表示；每个文件用摘要复核，不按大小跳过，不存凭据。
5. 首次长采集可复用同一来源的已验证历史观测，报告起止时间窗口；进入开发前仍按需求刷新。日常恢复保持现有整段重新观察语义，保留本地修改和暂存区。
6. 保留 `maxConcurrent=1` 的跨进程 owner；在其内部实现只读批次及独立 Cookie 会话池。不能直接让多个 client 并发调用当前单 `active` 的 `owner.run`。写入、编译和服务端 XML 生成不因此并行化。
7. 任一 worker 遇到 503 即原子持久化熔断及在途集合并停派发，再收束或取消请求、保存结果、逐一关闭本人会话，追加退出结果；保持零自动重试。503、关闭失败或已知资源异常保留阻断和恢复 token。日常正常批次核实全部自有会话退出并记录资格引用，不因客户端固定的 `licenseReleaseVerified:false` 字段自动报 unknown，也不声称逐批实测 License 回落；实际回落在资格窗口独立观察。
8. 多会话资格绑定目标、通道、版本、并发上限、最小间隔及证据摘要。普通运行无多会话资格时使用已获资格的单会话；连基础资格都没有时继续按原门禁停止。增加复用同一 owner 和锁的受限 qualification 目的入口：凭明确验证授权、固定目标／范围／会话数／时限预算运行，资格维持 pending；仅允许批准的试验读取，不开放日常任务。该入口解决首次超过 5 条的 bulk 门禁和首次多会话验证的引导问题，真实验收后才登记 verified，不能预先写假资格过门禁。

完成条件：同长度修改、换环境续跑、初始 partial、日常服务器删除、并发现场变化和中断恢复均有通过的定向测试；现有单会话调用方保持兼容。

### 第五阶段 完成本地和跨平台验证

| 验证层 | 最小覆盖和通过标准 |
|---|---|
| 清单与 XML | 属性顺序／实体／CDATA／紧凑 XML；身份、数量和载荷核对；重复、缺失、额外对象均能阻断完整包 |
| 文件保护 | 新文件、只读文件、本地修改、同长度改写、HEAD/index 并发变化、写盘和原子替换中断；原现场可恢复 |
| 网络与资源 | Cookie 更新、独立会话、认证和 TLS、不同下载端口、响应截断、超时；并发不超预算、单 worker 串行、整批期间另一进程不能进入；503 后零新派发，各 worker 退出结果独立核对 |
| 批次恢复 | Export 已送达而回执丢失、收到 503 并落盘后、清理到一半、下载前后、状态保存后、阶段提交后未回执分别中断；新进程读回，在途转 unknown／待观察，不重复 Export／commit，不解除活 owner |
| XML 通道 | 专用类与执行通道；无专用类环境；merge/split、IRIS/Cache、类／例程／文本 Web／图片；精确清理 |
| 分发更新 | 新装、旧装、enabled/available/disabled、standard/Overlay；新增文件真实落盘、薄索引正确、自定义内容和私有配置保留 |
| 宿主发现 | 项目入口实际可加载；帮助先结束；命中新名称；旧全局入口不会遮蔽新入口 |

复用 `.github/workflows/deployment-protection.yml` 的 Windows／macOS／Linux × Node `22.5.0/22/24` 矩阵，新增专项加入现有工作流，不另建重复矩阵。Windows 入口分别验证 PowerShell 5.1 和 PowerShell 7。矩阵结果未取得时，保持对应平台待验。

已有测试入口如下；新增 XML／清单／会话池用例按职责加入这些 suite 或 owner 新专项。MCP helper 退出等待与 v1.5.0 清理时长存在静态风险，改到退出实现时必须增加“正常清理完成后退出”和超时留证测试，不能以 kill 后进程消失代替清理完成。

```powershell
node --test scripts/tests/iris-remote-operations.tests.js scripts/tests/iris-export-encoding.tests.js plugins/coding-iris-plugin/scripts/iris-tools/tests/source-sync.test.js plugins/coding-iris-plugin/scripts/iris-tools/tests/source-sync-transaction.test.cjs plugins/coding-iris-plugin/scripts/iris-tools/tests/source-publication.test.cjs
node --test scripts/tests/iris-mcp-cli.tests.js scripts/tests/iris-mcp-schema.tests.js scripts/tests/runtime-skills.tests.js
powershell.exe -NoProfile -File scripts/tests/plugin-thin-index-refresh.tests.ps1
powershell.exe -NoProfile -File scripts/tests/update-agents.tests.ps1
pwsh.exe -NoProfile -File scripts/tests/update-agents.tests.ps1
```

完成条件：受影响本地 suite 和支持平台矩阵通过；用现有 validation-evidence 按实现、测试及运行输入 scope 登记证据，后续只重跑失效项。真实 IRIS 能力另在下一阶段验收。

### 第六阶段 完成真实试点和安装产物

业务集成从目标工程执行。发布前可在目标工程任务目录准备隔离候选工作区，以明确的 workspace 配置使用候选能力及测试 SourceRoot；不手工覆盖实际 `.agents`。连接继续来自获准私有来源，资格和恢复材料留目标工程，框架只保存通用测试代码。

1. 在获准的测试窗口确定实际 namespace、已确认对象范围、资源观测来源和观察权限。使用受限 qualification 入口，先以 1 会话、3–5 个代表文档验证持久落盘、新进程读回、中断恢复、自有会话退出及实际资源回落。没有可用资源观测时保持相应资格待验，不以 logout、进程退出或临时类消失代替 LU 回落。
2. 在明确未部署专用类的隔离 namespace 中，先验证执行通道导出、分块取回、对象校验及清理，证明无 QTZ 和预部署类依赖。
3. 从已冻结摘要的 canonical `.cls` 导入、编译专用类，再在同一实例、namespace 和相同清单上验证类通道，与前一步执行通道比较对象身份及载荷；只归一化允许变化的生成时间等元数据。
4. 用官方 Export 从该已编译类生成安装 XML，核对仅含该类；在另一获准隔离 namespace 导入并探测。源 `.cls` 与生成 `.install.xml` 的摘要、生成环境版本及验证结果写发布记录；生成物随 owner 发布，源 `.cls` 仍是唯一维护源。
5. 对拟启用的多会话档位继续使用受限 qualification 入口，按小批、中批、全清单逐步扩大，例如 20–50 条、约 200 条，再到完整范围。批大小是本次验证安排，不提升为通用安全阈值；先验证 4 会话，10 会话留待同样资格验证。单会话结果不替代多会话或 bulk 资格。
6. 全量逐项对账：请求范围、成功、复用、缺失、空内容、失败、取消、落盘数量和摘要一致；所有异常有完整名单。用户既有 5352 条样本可作为对照，不要求新环境数量相同或耗时固定为 361 秒。
7. 对实际导出包进行独立 XML 检查，并在获准的独立测试实例验证混合包导入及对象内容；Web 应用按包内虚拟路径映射到独立物理目录和测试 namespace。共用实例时先证明应用及物理目录隔离，仅更换 namespace 不足以隔离 CSP／图片。此处是包可导入性验收，不增加面向业务环境的导入 skill。

完成条件：两通道均取得真实证据；安装产物可导入；当前目标多会话资格和恢复已验证；下载／服务器任务文件／临时载体的收尾结果可核对。若只完成一条通道，对另一条保持待验，不能宣称双通道完成。

### 第七阶段 版本发布和维护同步

按当前基点，owner 新增能力并收紧已有 source-sync 准入、已知基线 404 和 initial partial 行为，发布 `0.22.0`，按 `0.x` MINOR 声明 breaking 及 required Migration。旧 bulk 证据重新按新版 readBatch 绑定取证，不自动转 verified；实际迁移步骤归 owner 发布记录和更新 runbook。七个直接消费者当前上界均为 `<0.22.0`；兼容回归通过后保留原下限、将上界扩至 `<0.23.0`，并各升 patch：

| 组件 | 当前版本 | 计划版本 |
|---|---|---|
| coding-iris-plugin | 0.21.1 | 0.22.0 |
| i18n-iris-plugin | 0.3.2 | 0.3.3 |
| iris-codegraph | 0.1.19 | 0.1.20 |
| iris-cure-form-dev | 0.8.2 | 0.8.3 |
| iris-external-reg | 0.1.20 | 0.1.21 |
| iris-imedical-doctor-ai | 0.4.2 | 0.4.3 |
| iris-interface-dev | 0.3.1 | 0.3.2 |
| iris-ui | 0.3.1 | 0.3.2 |

执行时重读版本；出现并行新版本则按实际基线重算。两 skill、服务端源及脚本继承 owner 版本，协议标识不作为独立组件发布。

同步 owner AGENTS／README／manifest、两个 skill、相关 reference／template、根 README、能力目录和使用指南、项目开发协议、`docs/update-agents.md`、版本清单说明、维护记忆入口／日志／backlog及相关测试。每个插件新增不可变 release record；未完验证写 backlog，完成项从下一步计划移入日志。

```powershell
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root .
```

准备提交时，在已有提交授权下只暂存本轮路径，再运行 staged 门禁和暂存差异检查。版本治理不接入业务更新器或 hook。

```powershell
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root . --staged --budget-ms 60000
git diff --cached --check
```

完成条件：功能证据、版本依赖和发布记录一致，提交范围经过审查。只有获准推送后才发布到实际项目可取得的仓库；源仓本地完成不代表项目已经更新。

### 第八阶段 安装和更新实际项目

首批验证对象为用户已指定专用类所在工程。其工程路径、连接、已安装版本及最终授权写本机或项目私有回执；推广时逐个登记目标，不扫描并批量改写其它工程。

**新安装项目**：沿现有安装器安装能力包，再执行真实 `coding-iris-init`；只启用本次选择的插件及既有必需依赖。init 展示 XML 的两种准备方式，未部署可选类不阻断 coding 插件其它能力。

**已有 standard 项目**：检查能力包与业务 Git 现场、确认已发布 revision 可取得，再沿原更新流程取得该 revision，检查新增脚本、类源、安装 XML 和索引实际字节。现有 `.mcp.json`、私有配置、业务源码和项目增补清单保持原归属，按缺失项合并新配置，不重置模板。

**Overlay 项目**：由共享 CapabilityRoot 所属 standard 入口更新一次，各模块再按原完整流程以 `-NoPull` 刷新自己的 ContextRoot。索引和任务状态分别属于各模块，不在共享能力包写恢复文件。

取版使用当前已验证更新器的普通 DryRun；该模式按现有规则可能 fetch／pull，必须在本次项目取版授权内执行。standard 的 `$capabilityOwnerProject` 为目标工程；Overlay 则先按 manifest／注册关系确认共享能力包所属 standard 工程，不能猜父目录。记录取版前后 revision，回执来源与已批准发布范围不符时停止生成层更新并处理差异。

```powershell
& "$capabilityRoot/scripts/update-agents.ps1" -ProjectRoot $capabilityOwnerProject -Mode DryRun -Detailed
```

以下为已取得版本后的现有更新器参数；先解析 CapabilityRoot 和目标 ProjectRoot。`-NoPull` 只检查／刷新已取得的版本，不能代替前面的能力包取版步骤。

```powershell
& "$capabilityRoot/scripts/update-agents.ps1" -ProjectRoot $targetProjectRoot -Mode Check -NoPull -Detailed
& "$capabilityRoot/scripts/update-agents.ps1" -ProjectRoot $targetProjectRoot -Mode DryRun -NoPull -Detailed
& "$capabilityRoot/scripts/update-agents.ps1" -ProjectRoot $targetProjectRoot -Mode Write -NoPull -Detailed
& "$capabilityRoot/scripts/update-agents.ps1" -ProjectRoot $targetProjectRoot -Mode Check -NoPull -Detailed
```

Check 可能因尚未刷新索引报告 stale；先评审 DryRun 再执行 Write，最后 Check 应通过。严格只读预演始终带 `-NoPull`，普通 DryRun 的既有联网／取版语义不改变。不要因安装了全部插件文件就自动将 available／disabled 改为 enabled。

服务端与客户端分别升级：

1. 选择专用类时，提供 owner 的安装 XML、`.cls`、摘要和部署步骤，默认提示用户导入；用户明确委托自动部署时才复用现有部署工具。类内容被项目改造或现状不明，先比较差异。导入编译后核对实际 namespace 与协议，再运行新客户端任务。
2. 选择执行通道时验证已有 MCP／终端及产物取回能力，无需部署该类。终端的 open／exec／close 必须处于同一受控进程或批次，不能用每次重启的单次 helper 复用 session token。
3. 通道是明确配置选择；执行失败停止并留证，不能自动换通道重放。类缺失时提供部署或选择执行通道的操作提示。
4. 正常能力包更新供应资产、引用和迁移提示，不自动覆盖服务器类、登记资格或开启多会话。所选类通道存在服务端升级时，先准备兼容的服务端再切换消费该契约的客户端任务。

完成条件：项目实际加载两个新入口，帮助与一次小样本真实调用均通过；旧业务和私有配置保留；分别报告能力包、索引、宿主发现、服务端通道和多会话资格状态。

### 第九阶段 收敛旧用户级入口

沿 `skills-sync` 单列迁移。旧维护源下的两个 skill、用户级 Junction、登记表和实际宿主入口先核对，不由项目更新器顺带删除。

1. 先盘点所有已登记宿主、两个旧源及其链接和使用依赖，再直接从目标项目 canonical 路径验证新入口和帮助；用项目级 `sync-runtime-skills.js` 适配已确认宿主。存在未授权迁移的依赖端时保留原源，不能先删源再查其它端。
2. 按维护源 Git 或 skills-sync 正式恢复规则保存可核验恢复信息；不在发现目录留下仍可调用的备份入口，不把私有配置带入框架。
3. 在明确授权的迁移范围内，先移除指向旧源的已核实 Junction 本体，刷新宿主发现后确认自动调用实际命中新项目入口；失败即恢复原链接。确认全部依赖均已迁移后才处理旧实体源并更新全局 `_sources.md`／README 登记。仍有其它端依赖时保留源并明确剩余范围，不报告全局迁移完成。
4. 项目 skill 以项目 CapabilityRoot 为事实源；用户级入口不能链接某个实际项目的副本。若仍需全局调用，使用只路由当前项目能力的兼容入口，明确旧名 `iris-xml-package` 到新名的迁移，不保留第二套执行实现。
5. 全局维护源迁移完成后，重新检查其它实际登记宿主是否还有旧链接或引用。项目级 updater 只管理其受管索引，不承担用户级目录清理。

完成条件：新项目入口可发现，已授权迁移端无旧实体遮蔽或断链，旧名称的处理有清晰回执；未纳入迁移的宿主逐项列明。

## 回滚与异常接续

| 故障阶段 | 恢复方式 |
|---|---|
| 实施或测试失败 | 保留有效既有版本；按任务差异恢复，不 reset 用户或其它会话修改 |
| 能力包更新失败 | 停止新任务，保留旧／新 revision、索引和私有配置摘要；沿现有 Git 安全更新与受管索引恢复流程处理，不强制 reset dirty 副本 |
| 专用类升级失败 | 仅当服务器内容仍匹配本次部署归属时，按已核验旧源恢复并编译；有他人修改先停，必要时显式选择执行通道运行新任务 |
| 503 或会话退出不明 | 保留公共熔断、在途记录和恢复 token，核实资源和未知结果；不换路重试或解除活 owner |
| 导出后下载／校验失败 | 保留准确服务器任务标识及路径，恢复后先核对产物，再取回或清理；不能重新 Export 冒充恢复 |
| 基线中断或本地漂移 | 先核对断点来源、摘要和现场；首次批次恢复历史观测，日常同步重新观察当前需求集合；不覆盖新本地修改 |
| 旧入口迁移失败 | 按正式恢复记录还原原有链接或实体，核对目标与宿主实际加载；新旧实现不同时作为默认入口 |

服务端成功与清理成功分别记录。只删除本任务可证明归属、且不再用于恢复的文件；安装产物、正式交付包及仍用于验收的证据保留。

## 本轮交付与后续验收

本轮本地交付已完成：两个 skill、owner CLI、自包含服务端类源、双通道协议、基线／多会话实现、专项测试、跨平台矩阵配置、八个组件版本记录、更新迁移说明及[验收指南](../../docs/guides/iris-xml-baseline-acceptance.md)。用户随后授权提交推送，按本批范围复核并执行；没有更新业务副本、部署服务端类或生成安装 XML。本机 mock 和隔离 Git 验证不代表真实 IRIS 或实际宿主已通过。

以下是后续实际接入的完成条件，不属于本轮已完成的本地交付：

- 两个入口随标准安装和已有项目更新真实落盘，启用、索引和宿主发现分别验收。
- 无 QTZ 或隐含业务辅助类依赖；两条 XML 通道都完成真实导出、取回、集合校验和清理。
- 专用类安装 XML 从 canonical 源生成，独立隔离 namespace 导入通过，升级提示和差异保护可用。
- 基线全量、partial、定向更新、中断恢复及本地保护通过；缺失不会被误用为删除。
- 已验证目标的多会话可用；未获相应资格的目标沿原保护处理；资源退出有真实证据。
- 直接消费者兼容、版本门禁和对应功能测试通过；平台及服务器支持范围按实际结果声明。
- 首批实际项目取得已发布版本并完成验收；其它项目仅在各自授权范围推广。
- 已授权的旧入口迁移完成，未迁移端和待验环境有明确清单；临时文件和测试状态按归属收尾。

真实环境窗口或发布授权未到时，保留对应阶段待执行；不以源仓测试通过代替实际项目完成。

## 下一步工作计划

1. 取得 Windows／macOS／Linux × Node `22.5.0/22/24` 远端矩阵实跑证据，并核对真实宿主发现与加载；当前仅配置矩阵，未运行远端 CI。
2. 在获得明确测试目标及远端操作授权后，按[验收指南](../../docs/guides/iris-xml-baseline-acceptance.md)完成小样本、断点恢复、双通道导出、图片载荷、清理及资源回落验收；据真实证据登记单会话／多会话资格。
3. 在获准隔离 namespace 编译 canonical 类源，原生生成仅含该类的安装 XML，再在另一隔离 namespace 导入核对，保留源、生成物和环境版本摘要。
4. 取得本批可分发 revision 后，按各项目另行授权执行 standard／Overlay 更新和实际加载验收。
5. 如用户另行授权全局迁移，按第九阶段和 `skills-sync` 盘点全部旧源依赖端，验证新入口、恢复能力和实际加载，再收敛旧用户级入口；未授权对象保持原状。

## 依据与执行入口

- [仓库维护入口](../../AGENTS.md)与[维护 skill](../../.agents/skills/agent-kit-maintenance/SKILL.md)
- [CLS 命名与格式](../../plugins/coding-iris-plugin/references/cls-coding-format.md)
- [项目开发与 License 协议](../../plugins/coding-iris-plugin/references/project-demand-development.md)
- [当前 source-sync CLI](../../plugins/coding-iris-plugin/scripts/iris-tools/source-sync.js)与[核心实现](../../plugins/coding-iris-plugin/scripts/iris-tools/source-sync-core.js)
- [远端准入](../../scripts/lib/iris-remote-operations.js)与[Atelier 客户端](../../scripts/lib/atelier-client.js)
- [安装更新 runbook](../../docs/update-agents.md)、[宿主项目技能适配](../../docs/coding-agent-adaptation.md)
- [XML 与基线验收指南](../../docs/guides/iris-xml-baseline-acceptance.md)
- [组件版本治理](../governance/component-version-management.md)与[现有跨平台矩阵](../../.github/workflows/deployment-protection.yml)
- [现有版本清单](../../docs/reference/project-export-map/doctor/README.md)
