# IRIS 离线开发与交付

本协议统一处理人工交接的实际源码和完整源码 XML：确认材料与范围 → 保存基线 → 修改 → 本地检查 → Code Review → Pack → 独立 Verify → 用户现场验证。代码只从接收材料或已核对的本地事实取得，不连接医院补源码。

## 开发方式与完成边界

- 唯一机器事实源是当前 ContextRoot 的 `config/iris-development.json`：`developmentMode` 取 `connected` 或 `offline`。缺少文件或字段保持旧 `connected` 行为；非法值停止 IRIS 流程，不能降级为 direct。profile 只引用该配置，不维护另一份值。
- `contextMode` 继续表达上下文及按需补齐策略，`standard/project` 继续表达需求类型；完整代码和少量代码都可离线开发。离线初始化可只声明 `{"developmentMode":"offline"}`，不猜环境别名或类型，不要求连接、资格或服务器类。
- `offline` 禁止医院远端读取、导出、上传、编译、导入、调试、测试及菜单采集。受管入口在连接配置/客户端之前阻断；Agent 同样不得调用原生 IRIS MCP。原生 MCP、外部 IDE 不在脚本拦截边界，不能宣称全系统断网。Git 联网和公共资料查询仍按原授权处理。
- 本地编辑、静态/本地测试、知识查询、清单比较、Review、打包及本地状态检查可用。医院验收 runner 不作为离线检查工具；本地状态与恢复材料检查不清除旧锁或未知结果。模式切换不释放旧任务，也不使旧发布批准重新有效；既有连接只报告，不自动改写或生成。
- 本地 Verify、Review、Git 提交都不表示医院已导入、编译或验收。交付后进入 `acceptance-pending`，由用户现场验证并反馈。回退原件来自带回快照，现场导入/回退前仍须核对漂移并按现场流程备份。

## 接收材料、源码与 Git

原始材料保留在项目的 `incoming/<batch>`，不覆盖旧批次。可编辑源码和 XML 对象位于声明的 SourceRoot/GitRoot；私有任务基线、范围及恢复资料复用 ContextRoot 的 `work/source-sync/offline-edit/<task>`。先解析工作区，不扫描父目录推断其它项目，也不在共享 CapabilityRoot 写业务资料。Git 初始化、提交和推送各按现有授权，不由本流程自动执行。

新材料先比较旧输入、当前修改和新输入，不覆盖未完成任务；缺失不表示删除。本轮只支持已接收对象修改：新增、删除、重命名明确报告暂不支持。只有 Project/ProjectItem 的 XML 是范围清单，不能当源码。源码类型、编码和对象身份不受目录名或少量文件推断。

## 实际源码：基线、增量与回退

唯一实现为本插件 `scripts/iris-tools/source-delivery.ps1`。框架使用同目录 `source-delivery.js` 薄入口，它只解析工作区、核对实际 Git 归属/范围并调用该 PowerShell 实现，不复制打包逻辑。人工 ZIP 构建也从同一 canonical 取入脚本，现场无需框架、Node.js、Git 或联网。当前打包实现要求 Windows PowerShell 5.1 或 Windows 上的 PowerShell 7；其它平台明确停止打包，不把能力缺失当已交付。

- 带导出回执的源码使用 `--export-directory`，框架 Prepare 同样显式给出 `--batch-id`，原回执字节、未知新增字段和完整摘要保持；partial 需显式接受，未收到对象不补造。旧缺来源回执按原工具核对真实带出来源，不要求连接医院。
- 无回执源码使用 `--source-directory`、`--original-directory`、`--batch-id` 与 `--scope-file`。原件必须与编辑目录分开；Prepare 对明确范围核对两边实际字节，已有改动不能反标为原件。来源 URL/namespace 可未知，不生成假的 `baseline-state.json`。
- 范围 JSON 为 `{"files":["src/Example/Sample.cls"]}`，路径相对编辑根，保留原结构。框架调用的范围固定在一个声明的 SourceRoot/GitRoot；多个 Git 分别处理。范围外改动保留，不进入包。当前支持 CLS/MAC/INC/INT/CSP/CSR/JS/CSS/HTML/HTM 的无 BOM UTF-8 文本；异常编码报告限制，不自动转码。

```powershell
# 脚本从已解析的 CapabilityRoot 定位；以下相对路径属于当前目标工作区
node <iris-tools>/source-delivery.js prepare --project-root . --source-directory code --original-directory incoming/batch-01 --batch-id batch-01 --scope-file .agents/work/source-sync/offline-edit/task-01/scope.json --baseline-directory .agents/work/source-sync/offline-edit/task-01/baseline
node <iris-tools>/source-delivery.js pack --project-root . --source-directory code --baseline-directory .agents/work/source-sync/offline-edit/task-01/baseline --out docs/delivery/demands/task-01 --notes-file notes.md
node <iris-tools>/source-delivery.js verify --project-root . --source-directory code --baseline-directory .agents/work/source-sync/offline-edit/task-01/baseline --out docs/delivery/demands/task-01
```

Prepare 冻结输入范围、原始摘要与工作区/GitRoot 绑定；恢复原任务沿用该基线，不覆盖重建。框架新增能力使用 v2 基线/交付记录，区分 `manual-source` 与 `export-receipt`；旧 v1 的独立脚本参数和严格验证继续可用，旧未绑定基线不自动升级为框架已绑定。

修改后必须核对最终 Git 差异、调用影响和适用的编码规则，写真实 notes（实际 Review、已执行的本地检查和医院待验证项），再 Pack 和独立 Verify。框架将实际 Git HEAD、范围内 status/diff 摘要和逐文件字节摘要绑定到 manifest 的 localEvidence，说明文件另有摘要；这只证明材料对应关系，不自动判定 Review 或测试通过。无变化不创建空包；缺说明、原件/范围/身份/绑定漂移、删除或改名均停止。输出保留相对路径的 `changes/`、对应 `rollback/`、`files.txt`、变更说明和 manifest；人工目录的 `files.txt` 是相对文件清单，不冒充服务器对象清单。Verify 的 `-CurrentSourceDirectory` 或旧 `-CurrentExportDirectory` 只比较用户提供的新快照，不代表实时锁定现场。

## 完整源码 XML

## 固定处理路径

**聚合 XML → 按对象拆分 XML → AI 修改源码节点 → 交付增量 XML、对应回退 XML 和变更说明。** 不以 XML→UDL→XML 转换作为必经步骤，不自动导入或编译。

### 1. 识别输入与范围

- 接收 IRIS 原生 `Export` 根的源码包，支持 `Class`、`Routine`、`CSP`、`CSPBase64`；可同时包含一个或多个 `Project` 元数据节点。Project 只保留在工作模板，不当源码对象编辑，也不放入增量交付。
- 只有 Project/ProjectItem 的 XML 是范围清单，没有源码，必须停止说明；不能补造方法实现。含 Global 等未支持顶层数据节点时停止，不能按代码包盲目处理。
- 按用户需求明确对象、依赖和预期行为。对象不在带回范围内时指出缺少的上下文，不猜测现场实现。顶层对象的新增、删除、重命名属于独立范围决策，本入口拒绝通过加删工作文件或改身份隐式执行；对象内部成员按已授权需求修改。
- 读取目标工程的本地约束与适用的 CLS/前端规则。此分支不要求 IRIS 连接配置、MCP、在线元数据或服务器类，也不能借此产生远端授权。

### 2. 保存原包并按对象拆分

复用 [edit-export-xml.ps1](../scripts/iris-tools/edit-export-xml.ps1)。辅助脚本支持 Windows PowerShell 5.1 与 Windows 上的 PowerShell 7，无 Node.js、IRIS 或外网依赖。

脚本从 CapabilityRoot 定位。框架使用同一 `source-delivery.js` 薄入口的 xml-unpack/xml-pack/xml-verify：可编辑目录在声明的源码 Git 内，`package.xml`、inventory 和冻结绑定在显式私有 BaselineDirectory。`--batch-id` 必填，`--scope-file` 可将聚合包限制到本需求的对象文件（如 objects/000001.xml）；缺省采用收到的全部对象，开工前核对范围。Pack 忽略范围外修改，Verify 核对冻结范围与工作区绑定；不维护派生 UDL。旧 `work/iris-xml-export/offline-edit/<task>` 任务沿旧参数原位恢复，不自动迁移或宣称已受 Git 管理。

```powershell
node <iris-tools>/source-delivery.js xml-unpack --project-root . --source-directory code/xml/task-01 --input-xml incoming/batch-01/export.xml --batch-id batch-01 --baseline-directory .agents/work/source-sync/offline-edit/task-01/xml-baseline
```

工作目录必须不存在。成功后有：

| 文件 | 用途 |
|---|---|
| 私有基线的 `package.xml` | 输入原包，保留原始字节，禁止编辑 |
| 私有基线的 `inventory.json` | 原包摘要、批次、冻结范围、工作区绑定、来源类型和对象导航 |
| `objects/000001.xml` 等 | 每个文件对应一个完整源码对象，供本地 AI 编辑 |

对象文件名固定编号，不由类名/虚拟路径生成。先用 inventory 定位对象，再读 XML 内的完整上下文。原包和每个对象的外层 Export 属性、身份及对象集合都受核对；不要编辑 inventory、改外层属性或将 XML 文件更名。

### 3. AI 修改与说明

直接修改 Class 的方法 Implementation、成员定义或其它命中源码节点，保留未涉及的继承、属性、Parameter、XData、Storage 和原有契约；例程与 CSP 文本修改原文本/CDATA，二进制维持原 Base64，只有明确需求才修改资源。XML 标签、实体、CDATA 边界必须合法。

源码事实源始终是对象 XML。可抽取代码片段辅助阅读和静态分析，但不能维护第二份独立修改的 `.cls`/页面文件后遗漏回填，也不能把手写 Class→UDL 转换宣称为等价还原。确需 UDL 时由可用的 IRIS 原生转换，或让现场先导出实际源码。

AI 必须编写 UTF-8 的 `notes.md`，说明实际改动、原因、依赖及已做/未做的验证，不能只写占位符或“修复问题”。仅修改需求内对象，避免对全部 XML 做格式化；对象 XML 内容摘要变化（包括格式变化）都会纳入交付。

### 4. 生成增量交付并独立核对

```powershell
node <iris-tools>/source-delivery.js xml-pack --project-root . --source-directory code/xml/task-01 --baseline-directory .agents/work/source-sync/offline-edit/task-01/xml-baseline --out docs/delivery/demands/task-01 --notes-file notes.md
node <iris-tools>/source-delivery.js xml-verify --project-root . --source-directory code/xml/task-01 --baseline-directory .agents/work/source-sync/offline-edit/task-01/xml-baseline --out docs/delivery/demands/task-01
```

框架入口必须显式选择源码树外、当前工作区内的正式 XML 交付路径。独立 PowerShell 原参数保持，新增 `-BaselineDirectory` 可分离冻结原包，未指定时沿旧工作目录布局。输出目录必须不存在，不覆盖已有交付。没有修改时返回 `state=unchanged`，不创建空包；有修改必须提供非空 NotesFile。

| 交付文件 | 内容 |
|---|---|
| `changes.xml` | 只含修改后的完整对象，可带回现场导入 |
| `rollback.xml` | 同一批对象在本次输入原包中的完整旧定义 |
| `变更说明.md` | AI 提供的实际说明、对象范围、前后摘要与现场验证边界 |
| `manifest.json` | 原包与交付文件摘要、前后对象/载荷摘要、数量和未执行的验证状态 |

未修改对象、Project 元数据和未修改图片不会进入 changes/rollback；两个 XML 的对象身份、数量和顺序一一对应。类以完整定义交付，既不是方法片段，也不是对全项目的重发。rollback 是本次带回快照的旧定义，不代表现场导入时的即时备份。

写入采用同父目录临时目录，全部文件生成、解析和摘要核对通过后才一次发布。Verify 从新进程读回，核对原包、交付文件集合、对象集合、回退原定义和载荷；发现漂移就停止。它不依赖仍打开的编辑器或前一进程内存。原始工作目录应保留到评审/验收结束，之后按任务生命周期处理，不能当普通临时材料直接清理。

### 5. 带回现场

给用户交付上述文件和简短操作说明。先比较现场当前对象与带出时原定义，确认是否已有并行修改；漂移时先合并，不直接覆盖。再按现场既有授权、备份/回滚和隔离验证流程导入、编译与验收。需要回退时也先核对后续变化，不能盲目导入 rollback.xml。

本地核对只证明 XML 结构、交付范围和载荷一致；`irisImportVerified`、`compileVerified`、`businessVerified`、`targetDriftVerified` 保持 false。没有真实环境证据，不得宣称已安装、已编译或业务验收通过。
