# 现场源码带回与 XML 离线修改

现场无法使用 AI 时分两条路径：人工源码导出使用源仓 `tools/iris-code-export/` 的独立 ZIP，无框架/skill 依赖、不随 `.agents` 分发；本协议负责用户从现场带回完整 XML、本地 AI 修改、交付 XML 再带回现场导入，不另打人工 XML 工具包。

## 固定处理路径

**聚合 XML → 按对象拆分 XML → AI 修改源码节点 → 交付增量 XML、对应回退 XML 和变更说明。** 不以 XML→UDL→XML 转换作为必经步骤，不自动导入或编译。

### 1. 识别输入与范围

- 接收 IRIS 原生 `Export` 根的源码包，支持 `Class`、`Routine`、`CSP`、`CSPBase64`；可同时包含一个或多个 `Project` 元数据节点。Project 只保留在工作模板，不当源码对象编辑，也不放入增量交付。
- 只有 Project/ProjectItem 的 XML 是范围清单，没有源码，必须停止说明；不能补造方法实现。含 Global 等未支持顶层数据节点时停止，不能按代码包盲目处理。
- 按用户需求明确对象、依赖和预期行为。对象不在带回范围内时指出缺少的上下文，不猜测现场实现。顶层对象的新增、删除、重命名属于独立范围决策，本入口拒绝通过加删工作文件或改身份隐式执行；对象内部成员按已授权需求修改。
- 读取目标工程的本地约束与适用的 CLS/前端规则。此分支不要求 IRIS 连接配置、MCP、在线元数据或服务器类，也不能借此产生远端授权。

### 2. 保存原包并按对象拆分

复用 [edit-export-xml.ps1](../scripts/iris-tools/edit-export-xml.ps1)。辅助脚本支持 Windows PowerShell 5.1 与 Windows 上的 PowerShell 7，无 Node.js、IRIS 或外网依赖。

脚本从 CapabilityRoot 定位；工作目录复用当前 ContextRoot 的 `work/iris-xml-export/offline-edit/<task>` 私有恢复区域，正式输出复用 owner 的 XML 交付目录（默认目标工程 `docs/delivery/iris-xml/<task>`），均按目录解析器和目标约定取值。不要在共享能力包生成业务原包或交付物；用户显式路径保持有效。

```powershell
# 以下仅展示参数；脚本从当前 CapabilityRoot 的插件目录解析
.\edit-export-xml.ps1 -Mode Unpack -InputXml .\export.xml -WorkDirectory D:\work\iris-edit
```

工作目录必须不存在。成功后有：

| 文件 | 用途 |
|---|---|
| `package.xml` | 输入原包，保留原始字节，禁止编辑 |
| `inventory.json` | 原包摘要、来源类型、Project 数量、对象导航与原对象摘要 |
| `objects/000001.xml` 等 | 每个文件对应一个完整源码对象，供本地 AI 编辑 |

对象文件名固定编号，不由类名/虚拟路径生成。先用 inventory 定位对象，再读 XML 内的完整上下文。原包和每个对象的外层 Export 属性、身份及对象集合都受核对；不要编辑 inventory、改外层属性或将 XML 文件更名。

### 3. AI 修改与说明

直接修改 Class 的方法 Implementation、成员定义或其它命中源码节点，保留未涉及的继承、属性、Parameter、XData、Storage 和原有契约；例程与 CSP 文本修改原文本/CDATA，二进制维持原 Base64，只有明确需求才修改资源。XML 标签、实体、CDATA 边界必须合法。

源码事实源始终是对象 XML。可抽取代码片段辅助阅读和静态分析，但不能维护第二份独立修改的 `.cls`/页面文件后遗漏回填，也不能把手写 Class→UDL 转换宣称为等价还原。确需 UDL 时由可用的 IRIS 原生转换，或让现场先导出实际源码。

AI 必须编写 UTF-8 的 `notes.md`，说明实际改动、原因、依赖及已做/未做的验证，不能只写占位符或“修复问题”。仅修改需求内对象，避免对全部 XML 做格式化；对象 XML 内容摘要变化（包括格式变化）都会纳入交付。

### 4. 生成增量交付并独立核对

```powershell
.\edit-export-xml.ps1 -Mode Pack -WorkDirectory D:\work\iris-edit -NotesFile .\notes.md -OutputDirectory D:\delivery\change
.\edit-export-xml.ps1 -Mode Verify -WorkDirectory D:\work\iris-edit -OutputDirectory D:\delivery\change
```

`-OutputDirectory` 默认工作目录下的 `delivery`，正式交付时应显式选择目标工程的 XML 交付路径。输出目录必须不存在，不覆盖已有交付。没有修改时返回 `state=unchanged`，不创建空包；有修改必须提供非空 NotesFile。

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
