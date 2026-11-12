---
name: iris_deploy_checklist
description: Use when the user explicitly asks to upload, compile, deploy, or verify IRIS files remotely.
task-affinity: [iris, deploy, upload, compile, verify]
related:
  - iris_coding_workflow.md
---

# IRIS 部署执行清单

部署 IRIS 文件时优先按本清单执行。标题和字段名尽量稳定，便于低能力模型逐项检查。

先解析当前 `ContextRoot/config/iris-development.json` 的 `developmentMode`。offline 按[离线协议](../references/iris-offline-development.md)生成交付并独立 Verify，交给用户现场验证，不读取医院连接、不运行下文部署或编译。connected（含旧配置缺省）继续本清单；非法值停止。切换模式不释放锁、不清除未知结果，也不替代原发布许可。

已确认 `project` 需求且 `contextMode: intent-first-on-demand-export` 时先读[项目开发协议](../references/project-demand-development.md)，部署前同步与 source plan 发布门禁为前置；标版沿既有分支，contextMode 不决定需求类型。

## 部署配置继承

部署工具优先读取当前 ContextRoot 的 `config/project-env.json`；仅文件不存在时，允许 workspace-overlay 按 manifest 的可选 `projectEnvFallback` 读取指定文件（相对 WorkspaceRoot，也可为绝对路径）。没有声明就停止，不扫描父目录，不默认从 CapabilityRoot 取业务配置。

回退只选择整份配置，不合并字段或复制凭据。模块文件损坏、不完整或不可读时不回退；回退配置必须声明 iris.host/port/scheme/namespace，并与模块 `.mcp.json` 的实际目标一致。存在冲突时停止，不打印凭据。WorkspaceRoot、SourceRoot、GitRoot、MCP 和 profile 始终属于当前模块，不通过切换 `--project-root` 扩大部署范围。

本契约由 `scripts/iris-tools/project-env.js` 实现，适用于 compile、deploy-frontend、compile-csp 和 prepare-deploy-manifest。配置生成/迁移工具仍只写模块本地配置；导出与 Broker 调试尚沿用本地配置，不据此宣称支持继承。模块创建器负责显式填写主仓关系；普通项目不自动启用。

## 必需配置来源

- 读取目标项目 `AGENTS.md`、`.agents/config/iris_project_profile.md`，并按上述继承规则选择 `project-env.json`。
- namespace 从 `project-env.json -> iris.namespace` 获取。
- Web 文档前缀从 `project-env.json -> web.basePath` 和 `web.cspBasePath` 获取。
- 可选 Broker Cookie 从 `project-env.json -> web.cookie` 或 `debugger.js --cookie` 获取。
- 不得臆造 namespace、Web 根、host、Cookie 或远端路径默认值。
- 必需配置缺失时停止执行，并报告缺失字段名。

## 能力编排与优先级

1. 本地代码与本地脚本优先。先读本地源码、配置和项目规则；需要导出、编译、Broker 调试、环境同步时，优先使用 `scripts/iris-tools/`。
2. `sync-env-config.js` 用于从 `.agents/config/project-env.json` 生成 `.mcp.json`。
3. `export.js` 用于从 IRIS 导出类、CSP、JS 等文件；路径前缀从 `project-env.json` 的 `web.*` 字段获取。
4. `compile.js` 用于 `.cls` 类文件上传与编译；它不作为 CSP 编译入口。
5. `debugger.js` 用于 Broker/API 调试；Token、Cookie、Broker 路径从运行参数或 `project-env.json` 获取。
6. 后端 MCP `iris-agentic-dev` 用于脚本未覆盖的能力，例如 `check_config`、只读 SQL、类/宏/表结构 introspect、文档 head/get、低风险 compile 验证和 `iris_execute`。
7. 前端 MCP `sftp-server` 是可选能力。只有目标项目 `.mcp.json` 或 `project-env.json` 明确启用时才使用。
8. CSP 上传后使用 `scripts/iris-tools/compile-csp.js --documents <WebApp虚拟路径.csp> --execute`，通过 Atelier `action/compile` 编译明确目标；检查顶层及逐文档错误。默认直接编译指定 show.csp，不自动扩展父页面；生成类参数和页面功能另行验证。

决策规则：

- 能用脚本稳定完成的，不优先调用 MCP。
- MCP 只补脚本能力缺口、做远端只读验证，或在用户明确要求部署时执行上传/编译。
- 前端通道按项目明确配置选择：已确认支持时以 `web.frontendTransport="atelier"` 复用受保护 doc 读写；SFTP 为显式 fallback，旧项目省略字段沿用 SFTP。配置、失败与字节契约见[部署保护](../references/deployment-protection.md#前端通道选择)。两者均不可用时输出待上传文件和映射，不臆造能力或失败自动切换。
- 涉及远端写入、批量同步、远端命令、Production、凭据或数据库变更时，须有覆盖当前目标和范围的明确授权；已有授权不重复确认。

## 后端类部署

- direct 在本地未声明 Storage 时仅向上传产物补入服务器 Storage；本地显式 Storage 与服务器不同或无法可靠解析时停止核对。guarded 检查 B/L/R 的 Storage 差异。两种模式均不得自动删除或重新生成 Storage 来绕过保护。
- 编译成功后按 [部署保护](../references/deployment-protection.md#编译后-storage-同步) 回读并同步已验证的编译后源码（含格式化与 Storage）；完成标准包含本地同步。编译已成功但回填失败时停止，不重传或重编译；夜跑源码指纹变化沿既有冻结版本复审门禁交接。
- 不得上传“只删除 `Storage Default` 行但保留裸 Storage 内容”的类。
- 先上传完整依赖切片，再编译；不要上传一个类后立刻编译一个类。
- 推荐顺序：实体类（字典、配置、业务） -> 公共/基类 -> 业务类（字典、配置、业务 SQL/DATA/BLH） -> 集成类 -> 前端文件。
- 如编译错误提示关联类或短类名不存在，先上传缺失依赖切片，再按依赖顺序重新编译。

## 前端上传

按[前端编码契约](../references/frontend-encoding.md)读取已确认配置，自动生成服务器目标编码的上传产物并严格回读。源码编码与服务器编码不同须转换，未确认、不可表示字符、配置漂移或原字节回读不可用均停止相关上传。正常项目确认一次，后续自动按配置执行。

## CSP 编译

- CSP 经已选择的受保护 Atelier doc 或 SFTP 通道上传；虚拟文档名与物理路径分别取项目配置。
- CSP 上传后使用 `scripts/iris-tools/compile-csp.js --documents <WebApp虚拟路径.csp> --execute`，通过 Atelier `action/compile` 编译明确目标；检查顶层及逐文档错误。默认直接编译指定 show.csp，不自动扩展父页面；生成类参数和页面功能另行验证。
- Legacy 流程中不要把 `.gb2312.csp` 作为编译目标。
- 不要把 `iris_execute.success=true` 当成编译成功；它只表示 ObjectScript 外层包装执行过。
- ObjectScript 包装代码必须输出并检查 `$SYSTEM.Status.IsError(sc)` 和 `$SYSTEM.Status.GetErrorText(sc)`。

## 验证

### 文件部署完成

按本次目标、清单与当前源码核对脚本回执，只检查适用文件类型：

- 后端：上传或相同跳过、最终回读、编译无错误及适用的 Storage 同步均已核实；direct 的 verified 回执可复用其覆盖证据。
- Web 资源：全部文件上传或相同跳过，远端最终哈希与本次部署内容一致；CSP 另核对逐文档编译结果。
- 回执范围完整、没有未知写入或待执行操作，退出已核实或受管会话按策略保留。会话身份未知、目标冲突、Storage 未同步、回读不符及公共熔断仍按原保护协议停止。

满足以上条件即报告“文件部署已验证”，列出范围与业务验收状态；仅有进程退出码或上传成功不满足此标准。已有证据覆盖的类存在、编译与哈希不再另开 MCP 重验。回执缺项或相互矛盾时只补对应证据，不能以提效为由跳过。

### 业务验收与附加检查

页面加载、核心业务调用以及 CSP 生成类名/参数属于业务或路由验证。涉及 CSP 时按虚拟 URL 核对生成类及 CSPFILE/CSPURL；已有有效证据可复用。用户要求联调、业务验收或项目发布门禁要求时继续执行相应验证，不能只部署便结束。普通文件部署尚无业务验证条件时明确报告“文件部署已验证，业务待验收”，保持 acceptance-pending。

附加检查失败时先核对是否影响本次部署证据或共享会话安全。若影响则沿原失败恢复协议处理；若独立于已完整验证的部署，记录该检查未通过并立即交付部署结果，不把它扩为底层框架调查。明确要求的验收缺口仍须报告未完成，必要时在原范围补验；不得换通道绕过身份、目标或熔断保护。框架故障修复另按授权处理。

耗时分别报告工具执行与整轮交付时间；无法取得的时间不估算为服务器或模型耗时。

前端上传加编译固定使用 `scripts/iris-tools/deploy-frontend.js`：全批差异预检、隔离产物上传、哈希回读后批量 Atelier 编译；失败按[失败恢复与授权](../references/deployment-protection.md#失败恢复与授权)暂停写入、诊断并有限恢复，不临时生成脚本或自动换通道。参数及耗时口径见 `scripts/iris-tools/README.md`。

## 开发部署与可选基线保护

非按需导出工程日常开发部署默认使用 direct：明确目标、文件和授权后执行，不要求需求号、Git 基线会话或 fetch/pull；保留路径、编码、Storage、并发变化、回读和编译检查。需要跨版本三方合并时显式选择 `--mode guarded --demand <id>` 并建立保护会话。旧命令仅带 `--demand` 时继续按 guarded 执行，不静默降低已有保护。完整契约见 references/deployment-protection.md（从插件根解析）；无 `--execute` 始终只生成本地计划。
