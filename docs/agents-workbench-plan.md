# .agents 本地工作台：可行方案与实施计划

> 状态：2026-11-17 修订，待评审；UI 交互原型已实现（源仓 tools/agents-workbench/prototype，模拟数据）；正式工作台后端尚未实施。Node 24 离线环境包已完成独立升级，不等于工作台已实现。
> 本计划承接用户确认的方向：离线 Web UI／EXE、本地 SQLite、结构化配置与 UI 编辑、复用本工程能力、兼容已经部署的项目。
> 本轮仅生成此计划，不修改框架、不接入业务项目、不提交或推送。

## 1. Goal：以工程为单位降低框架上手与日常维护成本

核心问题是插件、配置和执行入口分散，使用者需要记名称、读技能、判断顺序和排查状态。交付一个本工程 `.agents` 工作台：用户表达目标、补必要信息、执行并看到实际结果；底层继续复用框架，不建设另一套业务平台。

完整范围包括首次部署、已有项目接入、更新、插件管理、插件配置、工程配置、Agent 客户端适配与任务交接、MCP、连接、知识、向量、使用手册和恢复。分阶段只是实现顺序，单个配置表单或只读看板不算最终完成。

每个独立工程具有自己的工作台身份、配置与操作记录。Overlay 采用 Root 总览与共享管理、模块独立上下文的同一套界面；模块可直接进入，也可从 Root 进入。技术文件格式与内部步骤由工具处理，不转交用户学习。

### 1.1 执行能力分层：能做直接做，不能做帮助用户接续

| 类型 | 工作台行为 | 例子 | 完成依据 |
|---|---|---|---|
| 确定性操作 | 后端调用既有脚本，参数化编排、回读 | 安装、更新、插件补装/启停、已支持字段编辑、索引构建 | owner 回执与实际状态 |
| 需要 Agent 判断 | 有实测宿主接口时派发；否则生成提示词/交接材料 | 工程探索、语义型 profile 初始化、上下文整理、异常诊断、知识提炼 | Agent 结果加可自动执行的检查；业务事实仍由用户判断 |
| 需要人工操作 | 显示具体操作、原因与返回后的检查按钮 | 登录、客户端信任、重载、组织策略、关键业务选择 | 可观察状态或明确人工确认，分别标识 |

同一用户目标允许混合三类步骤。按钮表达目标，如“接入 IRIS 开发”，内部拆成环境检查、补装、确定性配置、Agent 补全及验证；不能因为其中一步需要模型，就把全部步骤退回给用户。也不能把 skill 名称当作可执行命令。

提示词是正式降级路径：包含当前目标、工程身份、已完成步骤、未完成项、能力根与真实 skill 路径、授权边界和预期验证；敏感值只引用本机来源。提供一键复制、按需保存到项目既有交接目录、返回后重新检查。复制/打开客户端不代表任务已执行。

## 2. 推荐结论

采用 **本地 Web UI + Node.js 本地服务 + SQLite 配置中心 + 框架能力适配层**，Windows 交付双击启动的 EXE，第一版 EXE 打开系统浏览器中的本地工作台。UI、配置模型和业务适配只维护一套；后续确有独立窗口需求时，再添加 WebView2 薄壳，不为外壳引入第二套业务逻辑。

SQLite 保存工作台管理的当前工程配置与操作关系，密码／Token 等字段加密后入库；框架现有 JSON、Markdown、TOML 文件作为兼容运行接口，由适配器读写。旧项目先只读识别，再按具体配置域显式接管，CLI／Agent 仍可工作，工作台必须识别外部修改而不是覆盖它们。

**推荐做配置中心，不做“几十个脚本按钮的合集”，也不做替换现有 Agent／MCP 的新平台。**

### 2.1 界面形态选择

| 方案 | 能否管理本机工程 | 成本与限制 | 决定 |
|---|---|---|---|
| 双击纯 HTML（file://） | 可以展示资料；普通浏览器网页不能直接启动 Git、PowerShell 或任意本机程序 | 文件选择授权不能补齐进程执行能力，SQLite WASM 也不能解决这一点 | 只适合只读手册／演示，不作为管理器 |
| 本地 HTML + 127.0.0.1 服务 | 能，所有本机动作由受限本地服务完成 | 需要启动器、进程收尾和本地接口保护 | **第一版采用** |
| EXE + WebView2 + 同一本地服务 | 能，窗口与目录选择体验更统一 | 增加 WebView2 Runtime 分发、SDK及Windows验收 | 第二阶段可选，不阻塞首版 |
| Electron | 能，成熟的独立桌面方案 | 自带 Chromium 带来包体和安全更新负担，与现有 Windows 工具形成新的外壳技术栈 | 暂不采用 |
| Tauri | 能，轻量桌面外壳 | 新增 Rust 构建链；本项目仍需 Node sidecar，Windows 仍涉及 WebView2 | 暂不采用 |

“离线”拆成两个能力：

1. **界面离线**：打开工作台、看手册、管理已有配置、本地搜索不需要互联网或 CDN。
2. **能力包离线分发**：首次安装／更新需要网络，或携带可校验的离线能力包。不能把界面离线宣传成无需任何物料就能安装所有插件。

## 3. 当前工程事实与复用边界

实施前先阅读根 `AGENTS.md`、`memory/agent-kit-maintenance-memory.md`、`.agents/skills/agent-kit-maintenance/SKILL.md`；原调查提交基线为 `26135aa3`，本次修订同时沿用已确认的 Node 24 环境包工作区改动；实施时重新检查 Git 状态，不覆盖并行工作。

### 3.1 已有能力，不重新实现

| 功能 | 当前事实源／实际入口 | 工作台接法 |
|---|---|---|
| standard／Overlay 根解析 | `scripts/lib/workspace-context.js` | 复用 resolver，明确 WorkspaceRoot、ContextRoot、CapabilityRoot、SourceRoot、GitRoot |
| 首次安装 | `scripts/install-agents.ps1` | 从可信随包入口启动，工作目录为用户选择的业务工程 |
| Overlay 初始化 | `scripts/initialize-workspace-overlay.ps1` | 复用既有声明与 Check/DryRun/Write，缺失拓扑通过表单或Agent接续，不猜 sibling |
| 基础环境 | `tools/ai-dev-offline/` | 部署 Node 24.22.3/Git 等；工作台启动器检测并引导复用 |
| 更新／检查 | `scripts/update-agents.ps1` | 复用 Check、DryRun、Write、NoPull；不另造更新器 |
| 插件目录与依赖 | `scripts/lib/plugin-catalog.json`、`scripts/lib/plugin-deployment.js` | 提供分组、依赖图、当前安装／启用状态 |
| 补装、迁移、裁剪 | `scripts/plugin-deploy.js` | 调用 list、plan、ensure、migrate、prune；保留原锁和恢复状态 |
| 插件启停／薄索引 | `scripts/update-plugin-profile.ps1`、`scripts/generate-plugin-thin-index.ps1` | 不直接改状态表绕过依赖和入口读回 |
| Skill／Agent 宿主适配 | `scripts/sync-runtime-skills.js`、`scripts/sync-runtime-agents.js` | 显式选择宿主；不把文件生成当宿主已加载 |
| IRIS 配置生成 | `plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js` | 抽取／复用其已有映射及校验，保留原 CLI 入口 |
| 开发方式与环境 | `plugins/coding-iris-plugin/scripts/iris-tools/development-config.js` | 保留 connected/offline 与项目类型等独立语义；不强制覆盖已有值 |
| 受管 MCP 迁移 | `scripts/lib/iris-session-migration.js` | 沿 Check／DryRun／Write／Rollback，不直接替换正在使用的服务 |
| 会话状态／恢复 | `scripts/iris-remote.js`、`scripts/lib/iris-session-manager.js` | 展示状态及 owner 下一步；不自动清未知写或释放他人资源 |
| BOS 私有配置 | `plugins/bos-plugin/scripts/personal-config.js` | 保留分段凭据、环境变量路径绑定及个人／项目区别 |
| 知识与向量 | `scripts/knowledge-query.js`、`scripts/lib/knowledge-retrieval.js`、`scripts/lib/knowledge-embedding.js` | 本地搜索、选装、preview/build/export 与恢复全部复用 |
| 文档／目录治理 | `docs/guides/`、`scripts/project-docs.js` | 原文展示、目录计划及受管说明，不另维护手册正文 |
| 已有 Windows 项目配置 GUI | `tools/ai-dev-offline/configure-project.js`、`configure-vscode.js`、`operation-runtime.js` | 复用 JSONC／TOML编辑、原字节备份和条件恢复经验；不复制整套GUI |

### 3.2 已核实的具体缺口

- 当前没有跨插件的统一配置模型与图形入口；字段分散在 manifest、模板、Markdown 和脚本中。
- manifest 不能完整描述配置类型、敏感性、字段来源和 UI 分组；不能仅凭模板自动生成一个可靠表单。
- 已有 `configure-project.js` 面向 VS Code 与固定 IRIS 服务，不能直接当通用配置后端；其 `main(projectInspect/projectPlan)` 会调用 `recoverPrepared()`，可能恢复文件。**工作台“只读接入”不得调用这个带恢复副作用的入口**；直接复用经过验证的纯读取函数，恢复另设显式动作。
- `update-agents.ps1 -Mode DryRun` 可更新 capability Git。工作台的“本地检查／预览”必须使用 Check 或 DryRun -NoPull；“联网获取新版并预演”另列为会修改本地 capability 的动作。
- 本轮此前实际运行 `node scripts/generate-plugin-catalog.js --check` 失败；程序比较确认 8 个 owner 的版本／依赖信息未同步进 catalog。按需安装会校验 manifestHash，必须在接入写路径前修正源仓 catalog，而非在 UI 忽略错误。
- 当前有 22 个插件 manifest；两个 XC 源目录没有 manifest。目录存在不代表正式可用。XC 治理仍按原决定暂缓，本项目不借工作台重写 XC 能力。
- 文档与 README 存在旧描述，版本判断以当前 owner manifest 和实际代码为准，历史维护记录不是当前验收结果。

### 3.3 计划假设

- 首发支持 Windows 10/11 x64。Web与配置核心可跨平台测试，Windows专属动作在其它平台返回明确不支持，不声称完整跨平台发布。
- 单机单用户，不建设账号体系、云同步、团队共享数据库、远程控制台。
- 每个工作台实例绑定一个 WorkspaceRoot；Root 实例可展示已声明 Overlay 成员。界面不提供全机工程管理中心，不扫描全盘。Root 导航到模块时切换到该模块独立实例与身份。
- 本轮“部署”指能力包安装／更新与项目接入，不默认为业务源码上传、数据库变更或生产发布。后者继续从既有 Agent/skill 执行，不加入首版一键操作。
- 首版不自建模型聊天平台或订阅管理；支持经验证的 Agent 宿主调用及提示词接续，不自动执行手册中的命令。

## 4. 产品与信息架构

### 4.1 目标入口与完整管理页面

默认首页回答“当前工程能做什么、还差什么、下一步怎么做”，不要求新人先理解插件体系。常用目标卡片包括“首次接入”“开始开发”“配置连接”“更新框架”“排查问题”；专家仍可直接进入管理页。

| 页面 | 主要交互与责任 |
|---|---|
| 总览 | 当前工程身份、可用能力、下一步、最近任务；首次进入自动走接入分支 |
| 能力与插件 | 场景推荐、依赖预览、安装/启停/升级；配置与初始化任务就近进入 |
| 工程与配置 | 工程事实、开发方式、域表单、来源与作用域；需探索的内容交给 Agent |
| Agent 客户端 | 多宿主接入、规则/Skills/Agents 适配、任务交接、重载指引、实际验证状态 |
| MCP 与连接 | MCP 注册及程序、连接档案与引用、显式测试；凭据不重复填写 |
| 知识与向量 | 资料浏览/检索、已有来源管理、索引状态、选装/构建/续建/导出；知识整理可交接 Agent |
| 使用手册 | docs/guides 原文、搜索与上下文帮助；跳到对应配置页或生成任务提示词 |
| 任务与恢复 | 确定性操作及 Agent 交接的进度、待回答项、结果、失败原因与可执行下一步 |

Root 视图增加“模块”导航与共享更新总览；模块视图固定显示模块名及共享能力来源。共享知识与模块资料分别标识，连接和草稿不会因界面导航混用。

桌面布局采用工程身份顶栏、左侧导航、主要任务区与按需展开的进度/帮助区。每页设计空白、加载、正常、缺项、执行中、部分完成、冲突、失败、待人工/Agent 接续状态。高级字段、脚本和诊断详情按需展开；常规路径不要求理解 revision、adapter、SQLite 或文件格式。

### 4.2 两条完整接入路径

**首次部署（工程尚无 `.agents`）**：

1. 从随包 EXE 启动入口选择目标工程；启动器自身不依赖 Node。缺少 Node/Git 时指向已有 ai-dev-offline 安装助手，安装返回后重新检查；不重复开发环境安装器。
2. 识别目录、现有 AGENTS/MCP/编辑器配置及业务 Git；“没有框架”不等于“空目录”。仅选择目录不写工程。
3. 选择使用目标及 Agent 客户端，自动推导最小能力组合；默认 standard。只有已声明共享结构或明确选择时才进入 Overlay 初始化，不要求普通用户理解根目录术语。
4. 展示安装来源、影响范围及必要字段；复用包内可信安装入口，不能依赖尚未安装的项目脚本。在线安装与本地能力包分别标识，环境原包不等于框架离线包。
5. 调用原安装器→补装能力→确定性配置→客户端适配；需要代码探索的初始化交接 Agent，沿任务卡接续，已完成步骤不重复执行。
6. 读回配置、启用状态和入口，显示客户端打开/重载指引及首个可执行请求。区分“本地接入完成”和“宿主/业务待验证”。安装中断保留已成功步骤，重试先识别现状，不重新覆盖。

**已有工程（已部署或部分部署）**：

1. 工程入口绑定当前根，只读识别 standard、旧全量/按需、Overlay、不完整部署或自定义目录；不自动更新、迁移、恢复或接管配置。
2. 首页展示当前可用能力及具体缺项。已有合法值和显式禁用优先保留，不重新要求填写连接或选择工程类型。
3. 按用户当前目标进入“直接使用、补装能力、编辑配置、升级框架、修复缺项”之一；普通查看和使用不以升级为前置。
4. 仅支持的配置域进入表单。旧版本缺少新接口时按 8.4 降级或升级；未知自定义内容保持只读并生成针对性 Agent 请求。
5. 应用后原 CLI/Agent 读回一致，重开工作台状态一致；未完成宿主或业务验证显式保留。

两条路径均复用同一配置、执行与结果界面，不维护两套业务逻辑。

### 4.3 表单原则

- 默认只显示必需字段；高级配置折叠。
- 显式 `false`、`0`、空字符串、未设置、TODO、继承值是不同状态，不用 JavaScript truthiness 合并。
- 值旁显示“来自哪里／影响哪些工程”，全局个人连接与工程覆盖分开。
- 字段变更后显示简明影响摘要；同一计划一次确认，不每个 helper 重复弹窗。
- 修改敏感字段用“保留／替换／清除”三态；空输入默认保留，清除需要显式操作。
- 配置未完整时可以保存草稿；不因此标记插件 ready。
- 默认值仅用于表单提示，不因打开页面就写回所有文件。
- 未支持的自定义配置显示原来源与限制，不能假装已有可安全编辑表单。

## 5. 统一配置模型与 SQLite 职责

### 5.1 结构化是核心，文件格式不是用户概念

将每个配置域定义为：

- `id`：稳定域标识，例如 `iris.connection`、`bos.query`、`knowledge.provider`。
- `owner`：实际负责语义的插件或共享模块。
- `scope`：user／project／plugin／host，不能靠目录名字推断。
- `schemaVersion`：模型版本，不是插件版本。
- `schema`：JSON Schema，描述类型、枚举、必填项、边界。
- `ui`：中文标签、分组、helpRef、条件展示、敏感标识；不放任意可执行表达式。
- `adapterId`：固定注册的读写适配器，禁止 schema 提供 shell／JS 代码。
- `sourceBindings`：原始文件及字段映射，由后端解析，不接受浏览器传入任意路径。
- `revision`：乐观并发版本。
- `status`：unmanaged／managed／drift／conflict／pending，不另造插件启用状态。

JSON Schema 验证数据形状；依赖、开发方式、启用前置、未知写和连接权限继续由 owner 的现有校验判定，不能把所有业务逻辑塞进 schema 或 UI。

### 5.2 SQLite 可以存配置和敏感字段，但不得明文存密码

SQLite 是本地数据库，适合作为配置中心；“本地”不代表防止文件复制、备份泄漏或误提交。

| 数据 | SQLite保存内容 | 运行事实来源 |
|---|---|---|
| 工程目录、别名、界面偏好 | 本机元数据 | 工作台数据库 |
| 已接管配置 | 结构化有效值、版本、来源绑定；凭据仅引用密文记录 | 工作台已应用配置；文件是兼容投影 |
| 未接管旧配置 | 来源位置、检查摘要、字节指纹；不自动成为数据库有效值 | 原文件 |
| 密码／Token／密钥 | DPAPI密文、保护方式和记录ID，不存明文 | 解密后仅在内存及必要私有实例中使用 |
| 草稿／待应用计划 | 非敏感字段与凭据引用；候选密文使用同一保护机制 | 不作为生效配置 |
| 插件启用／安装状态 | 展示缓存与观察时间，可丢弃 | plugin profile、部署状态及实际入口 |
| 知识正文 | 默认不复制 | 原有 Markdown／资料文件 |
| 业务向量 | 不复制进工作台数据库 | 原有 knowledge-index及构建缓存数据库 |
| 操作记录 | 类型、状态、错误码、脱敏摘要及owner回执引用 | 原操作回执及实际读回结果 |

**数据库不是任意 SQL 控制台。** 不给浏览器暴露 SQL、shell、文件路径读写等通用能力。

### 5.3 谁是事实源：按配置域显式接管，不全项目强制搬家

A. **未接管模式**：数据库只记工程和来源。读原文件生成模型，不写任何工程文件，不自动初始化或恢复。

B. **接管模式**：用户确认某个配置域的当前值和来源后，导入 SQLite。以后工作台通过统一写路径提交变更，并同步兼容文件；不是自动接管工程里全部文件。

C. **外部修改模式**：每份草稿持久保存创建时的基线 B（base_json、base_sources_json、expected_revision）、候选 D 和配置域身份；文件当前值为 F。基线中的敏感值仅为不可变 secretRef，替换凭据创建新引用。吸收新文件值不能覆盖仍在编辑草稿的 B；刷新或重启后仍按 B/D/F 三方比较：

- 只有F变化：校验后吸收为新的已应用revision，并刷新UI；不得把B写回文件。
- D与F修改不同字段：合并到候选计划，重新校验，按已有确认范围决定是否重新确认。
- D与F修改同一字段且值不同：返回 `CONFIG_CONFLICT`，只暂停该配置域。
- 敏感字段冲突仅显示来源与是否变化，不回传明文进行差异展示。
- 未知字段原位保留；不能由数据库投影重建整个文件丢失自定义内容。

数据库损坏、工作台卸载或缺失时，原有框架和 Agent 必须仍能读取最后一次成功生成的配置继续运行。不要使现有 `.agents` 执行依赖工作台常驻。

### 5.4 敏感信息保护

Windows首版使用 `.NET ProtectedData` 的 CurrentUser DPAPI：

- 加密再INSERT，禁止先落明文再加密；WAL、日志、草稿和异常消息不能有明文。
- 密钥不与数据库同存；不使用固定密码、Base64或机器名冒充加密。
- 普通GET只返回 `secretRef` 与 `isSet`，不把已有密码解密回填到浏览器。
- 新凭据从UI到本地服务只留内存，通过固定stdin协议交给DPAPI helper；不经命令行参数或普通请求文件。
- 如现有 MCP 必须读取明文 env／JSON／TOML，继续生成被忽略的私有实例，先检查未跟踪、忽略生效和权限，再写入并读回。明确披露“数据库加密，运行实例按上游契约保存”。
- 跨账号／换机不能保证DPAPI解密；首版导出配置默认不带凭据，到新机重新填写。带口令加密的跨机凭据迁移留后续独立需求，不临时自创加密协议。
- 数据库自动放入已确定的本机私有数据根，按当前工程身份隔离；不放业务`.agents`、源码仓、网络共享、OneDrive等同步目录。发现处于Git树内时拒绝保存数据库。
- 默认复用启动器安装位置旁的独立可写数据根，首次显示实际位置；不可写或处于Git/同步目录时才让用户选择替代位置。各工程数据库分别保存，不静默放临时目录。
- 仅防误泄漏和离线文件窃取，不宣称能防同账号恶意进程或管理员读取内存。

### 5.5 SQLite初版schema（实现前按下述身份与草稿约束验证）

新文件：`tools/agents-workbench/src/db/schema.sql`。字段不接受任意原始日志／配置JSON；写入前按模型剥离凭据并转secretRef。

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  context_root TEXT,
  capability_root TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('uninstalled','standard','workspace-overlay','nonstandard')),
  trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0,1)),
  created_at TEXT NOT NULL,
  last_opened_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'windows-dpapi-current-user'),
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS config_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  owner TEXT NOT NULL,
  domain TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('user','project','plugin','host')),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state TEXT NOT NULL CHECK (state IN ('unmanaged','managed','drift','conflict','pending')),
  applied_json TEXT NOT NULL CHECK (json_valid(applied_json)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS source_bindings (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES config_documents(id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  observed_hash TEXT NOT NULL,
  applied_hash TEXT,
  UNIQUE(document_id, source_path, source_locator)
) STRICT;

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','running','succeeded','failed','interrupted','conflict','cancelled')),
  document_id TEXT REFERENCES config_documents(id),
  expected_revision INTEGER,
  base_json TEXT CHECK (base_json IS NULL OR json_valid(base_json)),
  base_sources_json TEXT CHECK (base_sources_json IS NULL OR json_valid(base_sources_json)),
  desired_json TEXT CHECK (desired_json IS NULL OR json_valid(desired_json)),
  redacted_summary TEXT NOT NULL,
  owner_receipt TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS operation_steps (
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  adapter_id TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','applied','verified','reverted','conflict','unknown')),
  recovery_ref TEXT,
  PRIMARY KEY(operation_id, ordinal)
) STRICT;

CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json))
) STRICT;

INSERT INTO meta(key, value) VALUES ('schemaVersion','1')
ON CONFLICT(key) DO NOTHING;
```

配置域多环境／多服务实例的唯一身份由document ID加owner/domain/scope/绑定定义，不能把同一工程所有MCP服务折叠成一条连接。建库后的版本检查必须显式拒绝未知较高版本；DDL幂等不等于schema自动迁移。

不要以SQL约束替代secret拆分校验。测试必须用合成哨兵检查主库、WAL、操作记录及导出中均不存在明文。

## 6. 配置Schema、UI与执行契约

### 6.1 新增文件落点（均为计划，当前尚不存在）

- `scripts/configure-agents.js`：统一配置CLI入口，支持describe/read/plan/apply；UI与Agent均可复用。
- `scripts/lib/configuration-service.js`：域路由、数据读取、校验与计划，不保存工作台数据库。
- `scripts/lib/configuration-adapters.js`：固定adapter registry；不是可执行插件加载器。
- `scripts/lib/configuration-file-io.js`：原字节快照、条件写入、读回、回执；只填补现有入口确实缺失的共享能力。
- `plugins/agent-context-kit/schemas/configuration.schema.json`、`configuration.ui.json`。
- `plugins/coding-iris-plugin/schemas/configuration.schema.json`、`configuration.ui.json`。
- `plugins/bos-plugin/schemas/configuration.schema.json`、`configuration.ui.json`。
- `scripts/lib/knowledge-configuration.schema.json`、`knowledge-configuration.ui.json`：知识连接目前为共享运行时，暂不另建插件。
- `tools/agents-workbench/`：应用、SQLite、HTTP、UI、Windows启动器、打包和专属测试；不加入业务项目sparse。

Schema声明归owner，不由UI维护第二套字段默认值。manifest新增可选 `configuration` 元数据指向schema/ui，旧更新器忽略该字段即可；不得要求未接入工作台的插件立即补全此字段。

使用标准JSON Schema draft-07；Ajv仅作为维护者构建依赖生成固定standalone validator，业务项目运行不执行npm install。生成器放 `tools/agents-workbench/build/compile-schemas.js`，生成器输出随owner分发的 `schemas/configuration.validator.cjs`。schema改变必须重建并校验摘要；生成文件不是第二个可手改事实源。

### 6.2 完整字段示例

下例是新模型设计，不是声称现有字段已经采用这个结构。最终schema用真实owner字段逐项映射。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:imedical:configuration:iris-connection:1",
  "type": "object",
  "additionalProperties": false,
  "required": ["scheme", "host", "port", "namespace", "tlsVerify"],
  "properties": {
    "scheme": {"type": "string", "enum": ["http", "https"]},
    "host": {"type": "string", "minLength": 1},
    "port": {"type": "integer", "minimum": 1, "maximum": 65535},
    "namespace": {"type": "string", "minLength": 1},
    "tlsVerify": {"type": "boolean"},
    "username": {"type": "string"},
    "password": {
      "type": "object",
      "additionalProperties": false,
      "required": ["secretRef", "isSet"],
      "properties": {
        "secretRef": {"type": "string", "minLength": 1},
        "isSet": {"type": "boolean"}
      }
    }
  }
}
```

```json
{
  "id": "iris.connection",
  "schemaVersion": 1,
  "owner": "coding-iris-plugin",
  "scope": "project",
  "adapterId": "iris-connection-v1",
  "fields": [
    {"path": "/scheme", "label": "协议", "widget": "select", "group": "连接"},
    {"path": "/host", "label": "服务器", "widget": "text", "group": "连接"},
    {"path": "/port", "label": "Web端口", "widget": "number", "group": "连接"},
    {"path": "/namespace", "label": "命名空间", "widget": "text", "group": "连接"},
    {"path": "/tlsVerify", "label": "校验证书", "widget": "checkbox", "group": "高级"},
    {"path": "/username", "label": "账号", "widget": "text", "group": "凭据"},
    {"path": "/password", "label": "密码", "widget": "secret", "sensitive": true, "group": "凭据"}
  ],
  "helpRef": "docs/guides/connection-configuration.md"
}
```

端口／TLS历史默认由原owner解析，不在schema再写第二份default。host的协议、空白、分隔符等语义继续复用实际连接校验。`additionalProperties:false`限制提交的统一模型，不授权删除原文件中的未知字段。

### 6.3 每个adapter必须实现的契约

```text
read(context) -> { model, sources[], findings[], supported }
validate(context, model) -> { errors[], warnings[] }
plan(context, before, desired) -> { planId, sources[], changes[], effects[], requiredActions[] }
apply(context, planId) -> { state, receiptRef, changedTargets[] }
verify(context, planId) -> { matched, findings[] }
recover(context, receiptRef, decision) -> { state, findings[] }
```

这些是拟新增接口；现有脚本未全部具备，按下面任务补最小薄适配，不能在计划评审后假定接口已存在。

- read/validate/plan不写工程文件、不联网、不自动恢复。
- apply之前重新读取输入文件、检查revision和源指纹；变化返回409 `CONFIG_CONFLICT`。
- 优先调用已有owner写入口。没有字段级编辑能力时，在owner增加小函数，旧CLI与新adapter共同调用，不绕过原门禁。
- plan只包含允许字段及实际影响，不带明文凭据。
- 禁止 `eval`／任意命令模板／schema中的动态JS条件；条件仅支持固定数据比较。

### 6.4 数据库与文件的跨资源提交

SQLite事务无法让多个配置文件和子进程操作原子提交，不伪装成“全部天然事务”。采用现有回执加最小工作台操作记录：

1. 读取并校验候选；将不含明文的候选存入operations，原applied_json保持。
2. 列明每个 owner 的实际锁覆盖范围；UI 与 CLI 的受控写入口复用同一互斥，锁内重读指纹、写入及验证。共享操作按真实 CapabilityRoot 串行，模块配置按 ContextRoot 隔离。编辑器不遵守锁时仍有检查到写入的竞争窗口：最小化窗口并读回检测，不承诺对任意外部进程绝对无覆盖；冲突保留前像和候选，不盲目恢复。
3. 执行owner写入并逐文件回读，step记录实际结果。
4. 全部验证通过后，在一个SQLite事务中更新applied_json、revision、source_bindings，operation置succeeded。
5. 文件已写而DB尚未提交时崩溃：恢复时按候选及文件指纹判断，全部匹配则完成DB提交；否则调用owner恢复或报告冲突，不盲目重跑。
6. DB中的planned/running状态不代表原生框架已经采用该候选；UI明确显示待应用／待恢复。
7. 已有后续外部修改时不自动回滚。不能以删除数据库记录撤销已发生的外部效果。

## 7. 运行架构与安全

```text
EXE启动器／本地启动命令
  └─ 同一 Node 服务（仅 127.0.0.1，随机可用端口）
      ├─ HTML/CSS/ES modules：本地静态资产，无CDN
      ├─ API：工程注册、配置模型、计划与操作记录
      ├─ SQLite：配置中心、来源绑定、密文、恢复索引
      ├─ 凭据桥：Windows DPAPI，stdin/stdout，不写普通临时明文
      └─ 固定能力适配器
          ├─ 当前工程的既有安装／更新／插件工具
          ├─ 统一配置服务与owner能力
          └─ 知识／向量及只读文档入口
```

### 7.1 代码布局

```text
tools/agents-workbench/
  README.md
  package.json                  # 仅维护者构建／测试依赖
  package-lock.json
  launch.ps1                    # Windows PowerShell 5.1兼容入口
  build-package.ps1
  src/
    server.js
    api.js
    project-context.js
    engine-adapter.js
    operation-runner.js
    config-store.js
    secret-store.js
    document-service.js
    db/schema.sql
    web/index.html
    web/app.js
    web/styles.css
    web/config-form.js
    web/manual.js
    web/vendor/                 # 构建生成固定依赖，不手工维护副本
  windows/
    WorkbenchLauncher.cs
    ProtectSecret.ps1
  build/
    compile-schemas.js
    build-assets.js
    build-offline-package.js
  tests/
    db.test.js
    project-context.test.js
    config-store.test.js
    configuration.test.js
    secrets.test.js
    api-security.test.js
    operations.test.js
    deployment.test.js
    plugins.test.js
    mcp.test.js
    knowledge.test.js
    documents.test.js
    ui.test.js
    packaging.test.js
```

打包产物固定为 `tools/dist/agents-workbench.zip`；不把整个tools加入`.agents`安装。打包时从canonical取入所需通用模块与docs快照，保留revision、源相对路径及摘要；不手工复制形成独立维护源。

工作台可在未安装框架时启动并提供说明、环境检查和安装入口；不能从被管理项目require任意模块来完成“只读识别”。识别使用工作台打包的可信resolver，执行项目脚本前显示来源与revision并核对框架信任和兼容性。

### 7.2 本地接口保护

- 仅绑定127.0.0.1，不监听0.0.0.0，不开局域网访问。
- 启动生成一次性随机引导令牌，以URL fragment交给受信UI；UI立即移除fragment，POST换取HttpOnly、SameSite=Strict会话cookie，并取得CSRF token。令牌不进入HTTP路径、日志或持久存储；这不是抵御同账号恶意进程的认证系统。
- 校验Host为实际监听地址及端口、Origin为当前本地源；拒绝null／外站Origin写请求，禁止宽泛CORS。
- 写请求必须有JSON Content-Type、会话和CSRF token；所有GET无副作用。限制body大小并验证字段白名单。
- 前端只提交projectId/configId/planId，后端映射已登记根；目录注册单独验证用户选择的路径，文件读取不接受浏览器任意路径。
- 拒绝路径穿越、编码后的`..`、UNC目标（首版）、未声明链接和重解析点逃逸；Overlay合法链接只按现有resolver处理。
- `spawn`固定程序及参数数组，`shell:false`；不得提供“运行命令”HTTP接口。
- UI不展示原始stdout／stderr；先按错误码和结构化结果转换，再脱敏。已知敏感值和headers、URL参数同时处理，不只匹配password字段名。
- 已导入项目的自定义MCP command也是本机程序执行。保存配置不自动启动，tools/list单独确认来源；HTTP MCP可能联网，同样属于单独连接测试。
- 首版工作台不执行任意MCP工具，不提供SQL执行器，也不把原生MCP的allowWrite:true当用户授权。
- 所有长动作在受控子进程执行，不能堵塞HTTP事件循环；使用现有进度／回执，SQLite只记索引。取消为请求安全停止，不立即杀死关键配置写入。
- 关闭浏览器不立即终止正在写入的任务；启动器显示后台任务，允许返回窗口。退出时停止接收新任务，等待安全点；不可恢复阶段不承诺强杀后自动恢复。

### 7.3 文档安全

`docs/guides/`由当前工程CapabilityRoot提供；未部署时使用工作台随包快照并显示版本。Markdown不成为操作授权。

采用Marked解析、DOMPurify净化，仅本地依赖。阻止script、iframe、事件属性、javascript:链接、表单提交及远程图片自动加载；所有资源通过文档ID映射和允许目录白名单，链接不能进入`.mcp.json`或私有work目录。外链点击明确打开外部浏览器，不在拥有本机API能力的文档面板中加载远程页面。

相对链接、中文路径、锚点、表格、代码块必须可用；未安装插件的链接显示“需要安装对应能力”，不会自动补装。

## 8. 已部署项目兼容策略

### 8.1 接入不等于迁移

“添加已有工程”只在工作台数据库登记选择，扫描明确的配置入口，不写工程、不fetch、不补索引、不整理目录、不修复历史锁。

接入报告必须区分：

- 标准独立`.agents`仓；
- 老版本全量或sparse部署；
- Overlay与共享CapabilityRoot；
- `.agents`存在但不是标准部署；
- 自定义薄索引／宿主链接／MCP启动器；
- 当前目录就是能力包源仓。

最后一种只能进入“维护者视图”，不能在源仓再次安装嵌套`.agents`。

### 8.2 分域接管

优先接管工程元数据、已识别的IRIS连接、BOS个人配置、知识提供方配置。先做read→规范化模型→无修改回写计划，要求初次导入不产生无意义差异。

旧Markdown配置只编辑可唯一识别的字段／受管块，人工说明保留；重复键、冲突来源、无法确定作用域时返回具体问题，不整体重写。JSONC保留注释与BOM／换行；TOML只在原解析器支持范围内编辑，超范围保留原件。

对于只想继续旧CLI的人，不需要安装工作台或迁移到SQLite。工作台接管不改变现有命令名称。

### 8.3 Overlay更新

按真实CapabilityRoot归组：共享框架更新一次，再逐个已登记ContextRoot以NoPull刷新。离线成员沿既有lastRequired保留资源；未登记成员范围不完整时不能裁剪共享资源。UI显示受影响工程，不让使用者手工推导共享关系。

SQLite不保存另一套SourceRoot映射，读取现有capability.json。Root 到模块的导航使用独立实例；不同实例的配置、凭据、草稿与测试结果隔离。

### 8.4 旧框架兼容与执行来源

工作台随包携带可信 resolver、启动所需安装脚本及其依赖闭包，记录源 revision/hash；安装后优先调用受支持的 owner 接口。兼容表按“工作台版本 × 框架接口/格式 × 动作”判断，不仅看版本大小。

旧框架无新接口时：已验证旧格式可用随包薄适配器；缺少安全写能力的域保持读取，提供升级预览或 Agent 交接。不得把新脚本散拷进旧框架绕过发布。升级失败后仍可查看原配置。用固定历史 revision、缺少新服务的旧项目验证，不只模拟旧字段。

### 8.5 独立工程、Root 与模块的归属

- 独立工程：本工程工作台负责全流程。源码/二进制只维护一套，可复用外部工具安装位置；工程入口是绑定当前 WorkspaceRoot 的薄启动入口。
- Overlay Root：管理共享能力包版本、插件物料、共享知识/向量及模块接入总览。模块列表从现有注册/manifest读取，不另建人工名单。
- 模块：管理本模块启用集合、配置、连接、MCP、客户端入口、私有资料和任务。Root 内可进入模块，模块目录也可独立打开；无需先运行 Root 窗口。
- 模块申请补装共享插件时由统一后端按 CapabilityRoot 协调；共享安装不等于所有模块启用。更新共享一次，再刷新各 ContextRoot，逐模块呈现部分失败；裁剪必须核对所有声明成员，未登记/离线范围不明时不推断可删。
- SQLite 按工程身份隔离，Root 库仅保存共享任务及成员观察信息，模块库保存模块草稿/记录；个人级配置保持原 owner 来源与引用，Root 不复制模块凭据。沿 5.4 放仓外私有数据目录，按规范根身份自动分配子目录；用户通常无需选择数据库位置。每库 projects 表只允许当前绑定工程，Root 成员列表不成为多工程配置库。
- 工程移动后重新验证根与绑定，再迁移工作台数据；复制工程不得自动继承原数据库身份。移除工作台只解除自身入口，保留原框架与配置。

### 8.6 Agent 客户端适配与任务接续

客户端页面区分两类能力：入口适配（规则、Skills、Agents、MCP）和任务调用（打开、派发、提问、进度、结果、取消）。现有 sync-runtime-* 只证明其实际实现的入口生成，不证明任务调用。

每个宿主声明并实测支持项，UI只开放可用动作。优先复用现有 adapter 与任务交接协议；正式 run 才使用原 orchestration 协议，普通配置任务不强制创建完整多 Agent run。

- 有官方且已验证 CLI/API 的宿主：固定参数、目标 cwd 和本机上下文引用派发；真实支持提问/状态/取消时才呈现对应交互，登录与权限沿宿主自身流程。
- 只能打开宿主/工程的客户端：打开并生成可复制提示词；没有可靠输入通道时不宣称已发送。
- 无自动接口：提供一键复制请求及必要的交接文件，用户在客户端执行后回工作台点击“重新检查”。无需以完整自动化集成为普通功能的前置。
- 不抓取桌面控件或注入私有数据库作为默认集成；接入具体宿主前核对官方文档、版本和最小往返实验，不假定所有客户端支持相同参数。
- 用户级客户端设置显示跨工程影响；工程级优先。一个工程可适配多个宿主，canonical只维护一份。已生成、宿主发现、实际调用分别显示。
- 交接带任务标识、当前工程/模块、目标、已完成步骤、未完成项和允许范围；对话输出不自动成为成功回执。Agent 修改后的文件仍走相同漂移/冲突检查，授权不因宿主切换扩大。

## 9. 功能交付范围

| 功能 | 首轮可用版 | 后续完整覆盖／限制 |
|---|---|---|
| 工程管理 | 选择、只读接入、状态、分域接管 | 无全盘扫描；自定义布局先保持只读 |
| 部署更新 | 已有标准安装／更新入口、Overlay分组、实际读回 | 离线bundle导入单独完成后才声明断网部署 |
| 插件管理 | 全部有manifest插件可浏览、依赖预览、补装、启停 | 不自动启用未完成初始化的领域插件 |
| 配置UI | 基础工程、IRIS、BOS、知识提供方有完整schema与保存 | 其余owner逐个补schema；无schema显示原来源，不宣称全部可编辑 |
| Agent客户端 | 入口适配、能力分级、提示词交接与结果重查；可用接口逐宿主接通 | 不保证操控任意宿主聊天窗口或取得其会话结果 |
| MCP管理 | 工程级配置、受管IRIS检查／迁移、程序与工具发现 | 宿主用户级配置仅对已核实adapter开放；不猜全部宿主路径 |
| 连接管理 | 个人／工程作用域、密文存储、原文件兼容、显式测试 | 不自动探测医院服务器，不管理业务SQL |
| 知识库 | 已有资料浏览、本地搜索、来源与版本 | 任意资料上传／分类需要现有来源协议支持，不能直接扫描所有docs |
| 向量库 | 已有索引状态、选装／移除、preview/build/续建/export | 外发授权、模型／维度一致性仍由owner校验 |
| 手册 | 全部`docs/guides/`导航、搜索、锚点和安全链接 | 不复制成独立手册维护；不自动运行代码块 |
| 备份恢复 | DB一致性备份、owner配置回执、条件恢复 | DPAPI跨机凭据不自动迁移；未知外部写不重放 |

不能把首轮只读面板交付为完整工作台。最终验收至少打通“已有工程接入→配置修改→插件可用→退出重开后原CLI读取一致”的真实路径。

## 10. 技术选型与上游调查

已只读核对候选仓库说明／关键源码／许可信息，未下载依赖或制作原型。

| 候选 | 已核对内容 | 采用方式／理由 |
|---|---|---|
| https://github.com/electron/electron | 官方security文档、MIT许可、quick-start主进程示例；仓库未归档 | 暂不采用，避免首版额外Chromium运行时；若以后需要固定浏览器环境再比较 |
| https://github.com/tauri-apps/tauri | README的系统WebView／Rust架构与许可信息；仓库未归档 | 暂不采用，现有Node工具仍要sidecar，首版引入Rust收益不足 |
| https://github.com/MicrosoftEdge/WebView2Samples | WinForms BrowserForm的初始化、导航及虚拟主机映射；官方离线Runtime分发说明 | 仅参考设计，后续可选薄壳；仓库许可API未返回明确许可，不复制样例代码，采用SDK前另核授权条款 |
| https://github.com/markedjs/marked | README明确不做HTML净化，MIT许可 | 直接使用固定版本18.2.1，配DOMPurify，构建后本地分发 |
| https://github.com/cure53/DOMPurify | README安全边界、MPL-2.0 OR Apache-2.0许可 | 直接使用固定版本3.4.18；不得净化后再拼接未净化HTML |
| https://github.com/ajv-validator/ajv | standalone生成说明及MIT许可 | 构建期使用8.20.0，输出standalone校验器；检查生成代码无未携带的运行时require |

上述版本是本次registry读取结果，不代表已完成供应链审计或集成验证。实施时固定lockfile、记录实际包integrity和许可；更新版本需重跑安全及兼容测试，不自动追latest。

Node 默认部署基线统一为 24.22.3，由 ai-dev-offline 安装助手部署并校验官方摘要，工作台复用该环境，不默认另带私有 Node。启动时检查实际版本与路径，缺失时指向安装助手；SQLite、备份恢复和框架调用链仍须实测。本工程原有 Node >=22.5.0 最低兼容要求保留，不把工作台新 API 引入所有业务脚本。

第一版不引入React/Vue、ORM、微服务或通用表单设计器；原生ES modules和语义化HTML足够。配置schema、业务校验、源文件适配分开，但不建设任意插件执行DSL。

## 11. 实施任务与验证切片

### 11.1 执行纪律与命令约定

以下编号用于追踪能力任务；实际顺序按第14章纵向里程碑，允许提前取用后续任务的必要切片。按子步骤逐个RED→GREEN完成，**不是先写全部测试再写实现**。单个子步骤控制为一个断言或一个小函数，预期2–5分钟聚焦工作；涉及真实安装、网络、构建或GUI验收的等待不计入此估算。若一个实现子步骤明显超过此规模，按测试行为继续拆分，不把整套模块称为“五分钟任务”。

每个切片：

1. 创建指定test与最小可加载接口，写一个会失败的行为断言；失败必须来自缺少行为，不是语法错误。
2. 运行该切片所列命令，确认退出1且命中预期断言。
3. 最小实现，再运行同一命令，确认退出0及对应test通过。
4. 增加下一项边界行为，重复RED/GREEN；完成后运行相邻受影响回归。
5. 审查diff并形成提交检查点。**本计划不授予提交权限**；实施阶段用户明确允许后，才按检查点精确暂存和commit，不执行push。没有授权则保留未提交变更，不因TDD惯例自行提交。

下列命令均从仓库根执行。tests路径是拟新增文件，不是当前已存在／已通过的测试。

### 任务01：修复已知catalog前置问题

文件：`scripts/lib/plugin-catalog.json`、`scripts/tests/plugin-deployment.tests.js`、相关README的过期总览。

- 01a：在现有专项中加“catalog matches all current manifests”断言，调用现有generate比较当前catalog；运行`node scripts/generate-plugin-catalog.js --check`确认当前失败。
- 01b：执行既有生成器更新catalog；不手改版本或忽略manifestHash。
- 01c：运行`node scripts/generate-plugin-catalog.js --check`，预期退出0；定向专项通过。
- 01d：只修本次已核实的README数量、按需安装和已实现adapter说明；不扩成全仓文档重写。

提交检查点：`fix(catalog): 同步插件版本与按需部署目录`。

### 任务02：SQLite最小纵向切片

文件：`tools/agents-workbench/src/db/schema.sql`、`src/config-store.js`、`tests/db.test.js`。

- 02a：复制本计划DDL为schema.sql；测试约定`openStore(':memory:')`返回具有`db`和`close()`的对象。
- 02b：使用下面完整测试，先让version断言失败，再实现建库与version检查。
- 02c：新增未知高版本、foreign_keys生效、数据库目录位于Git树／网络路径被拒绝的测试，再实现路径检查。
- 02d：新增关库重开后值保持及崩溃恢复测试，验证写入不是只存在内存。

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../src/config-store');

test('WB-02 creates schema version 1 and enables foreign keys', () => {
  const store = openStore(':memory:');
  try {
    const row = store.db.prepare("SELECT value FROM meta WHERE key = ?").get('schemaVersion');
    assert.equal(row?.value, '1');
    assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    store.close();
  }
});
```

验证：`node --test tools/agents-workbench/tests/db.test.js`。预期全部通过，真实文件测试使用本任务独立临时目录并在finally清理，不在源码目录生成db/WAL。

### 任务03：工程绑定与两类接入识别

文件：`src/project-context.js`、`tests/project-context.test.js`；复用`scripts/lib/workspace-context.js`。

- 03a：添加标准工程夹具，保存接入前所有文件摘要；断言登记后根解析正确且摘要不变。
- 03b：实现只读注册与去重；Windows物理路径大小写和别名按既有resolver归一。
- 03c：覆盖无框架但已有AGENTS/MCP、旧全量、旧按需、Overlay Root/模块、部分安装、自定义目录和源仓；缺少新配置接口的历史revision必须进入测试。
- 03d：自定义MCP脚本夹具含“执行即产生标记”代码，断言注册时从未启动／require该脚本；不获取真实凭据。

验证：`node --test tools/agents-workbench/tests/project-context.test.js`。预期读回的roots来自声明，接入零工程写入，无网络调用。

### 任务04：最小本地服务与安全入口

文件：`src/server.js`、`src/api.js`、`tests/api-security.test.js`。

- 04a：先测GET health及127.0.0.1绑定；实现只返回版本和状态的health，不包含配置值。
- 04b：按7.2实现一次性引导、会话cookie和CSRF；分别测试错误Host、外站Origin、null Origin、缺token被拒绝。
- 04c：测试超大body、错误Content-Type、非法JSON、路径穿越、未知operation拒绝；逐项实现固定路由。
- 04d：测试任何GET不生成文件／不启动子进程；健康检查不能触发配置恢复。

验证：`node --test tools/agents-workbench/tests/api-security.test.js`。预期合法本地会话200，未授权401／403，冲突409，非法参数400，不泄漏异常堆栈。

### 任务05：可信命令适配器与操作记录

文件：`src/engine-adapter.js`、`src/operation-runner.js`、`tests/operations.test.js`。

- 05a：测试仅允许注册动作、固定exe/脚本/参数，含shell元字符的名称不会执行；实现shell:false。
- 05b：测试子进程非零退出和启动失败不标success，结构化错误优先；实现结果归一和脱敏。
- 05c：测试长动作不阻塞health，重复点击同一plan不双执行；实现异步子进程和同目标派发去重。
- 05d：测试子进程中断留下interrupted，重启只读检查owner回执，不自动重放；取消在安全点停止。

验证：`node --test tools/agents-workbench/tests/operations.test.js`。使用合成子进程，不运行业务脚本；无shell副作用，退出与业务验证状态分开。

### 任务06：配置模型与schema编译

文件：`scripts/configure-agents.js`、`scripts/lib/configuration-service.js`、`scripts/lib/configuration-adapters.js`、owner的schema/ui、`build/compile-schemas.js`、`tests/configuration.test.js`。

- 06a：先只接`iris.connection`，用本计划schema测试端口上下界、布尔false及缺项；实现模型读取与validate。
- 06b：增加read返回sources和未知原字段保留测试；实现映射，禁止用JSON.stringify重建整个原文件。
- 06c：加入schema/ui路径、版本、adapterId及helpRef校验；引用不合法时只禁用该配置域的写入。
- 06d：构建Ajv standalone；在无node_modules的隔离副本加载校验器，并在浏览器CSP禁止eval时验证相同行为。

验证：`node --test tools/agents-workbench/tests/configuration.test.js`；`node tools/agents-workbench/build/compile-schemas.js --check`。预期类型校验一致，schema变更但生成器未刷新时check退出1。

不要用一个测试同时覆盖所有owner。后续每个owner以同样契约补独立test。

### 任务07：DPAPI密文入库

文件：`src/secret-store.js`、`windows/ProtectSecret.ps1`、`tests/secrets.test.js`。

- 07a：Windows用合成字符串测试protect/unprotect往返；实现固定stdin JSON协议，非Windows返回`SECRET_PROVIDER_UNSUPPORTED`。
- 07b：测试同明文多次加密不要求密文相等；使用secretRef引用，不把密文摘要当密码是否相同的通用判据。
- 07c：测试保留／替换／清除三态，GET从不返回明文；实现字段拆分和写入顺序。
- 07d：写入合成凭据后扫描数据库、WAL、普通日志与脱敏导出，确认无明文；DPAPI失败不得降级明文。

验证：`node --test tools/agents-workbench/tests/secrets.test.js`。Windows必须实跑DPAPI，Linux/macOS只验证明确拒绝，不标跨平台密钥存储通过。

`ProtectSecret.ps1`兼容Windows PowerShell5.1，含中文时UTF-8 BOM；使用系统ProtectedData，不自行实现AES算法。私有数据不经argv。

### 任务08：配置接管与外部修改三方合并

文件：`src/config-store.js`、`tests/config-store.test.js`。

- 08a：测试未接管配置仍以文件为准，点击接管只导入、不重写等价文件；实现状态转换。
- 08b：测试外部单方修改吸收、无交集修改可合并、同字段冲突409；一次实现一个分支。
- 08c：测试空字符串／false／未设置不混淆，未知字段和人工正文保留。
- 08d：测试 Root/模块独立实例及 scope 隔离；草稿创建→外部修改→刷新→重启后仍用原基线正确合并。

验证：`node --test tools/agents-workbench/tests/config-store.test.js`。预期冲突场景工程字节不变，无“数据库覆盖一切”的后台同步。

### 任务09：配置应用、回读与中断恢复

文件：`scripts/lib/configuration-file-io.js`、`tests/configuration.test.js`、`src/config-store.js`。

- 09a：测试plan后变化、新文件抢先创建、锁内检查到写入窗口的并发注入；分别验证受控CLI互斥与非协作编辑器的检测边界。
- 09b：测试每个写入点故障注入，只有未被再次修改的文件允许恢复；优先复用owner回执。
- 09c：测试“文件写完DB未提交”与“DB候选保存但未写文件”两类重启恢复；实现6.4所述跨资源提交逻辑。
- 09d：测试无变更保存幂等、BOM/CRLF/LF/CR兼容以及最终读回值一致；不以退出0代替matched。

验证：`node --test tools/agents-workbench/tests/configuration.test.js tools/agents-workbench/tests/config-store.test.js`。预期全部失败注入有确定状态，无静默覆盖／自动重放。

### 任务10：IRIS工程配置适配

文件：`plugins/coding-iris-plugin/scripts/iris-tools/configuration-service.js`（新增owner薄服务）、`sync-env-config.js`、`development-config.js`、`tests/configuration.test.js`。

- 10a：先测试现有`.mcp.json`、project-env和受管backend三种来源的读取；冲突不自行选一个覆盖。
- 10b：将`sync-env-config.js`中可复用转换和校验抽成函数，旧CLI仍调用同函数；只处理本次字段。
- 10c：分别测试直连／受管MCP、其它服务保留、显式disabled、TLS false、端口字符串归一；保存必须覆盖实际消费者来源，不只改一个无效副本。
- 10d：分别测试connected/offline、环境别名、contextMode、需求类型；切换开发方式有活动任务时沿owner停止，不由普通配置UI强制切换。

验证：`node --test tools/agents-workbench/tests/configuration.test.js scripts/tests/iris-development-config.tests.js`。旧配置保值与新建配置均通过；远端连通不在该测试内。

### 任务11：BOS、知识连接与个人作用域

文件：`plugins/bos-plugin/scripts/personal-config.js`、其schema/ui、`scripts/lib/knowledge-embedding.js`、知识schema/ui、`tests/configuration.test.js`、`tests/knowledge.test.js`。

- 11a：复用BOS initialize／readSkillConfig／fieldHelp，新增最小字段更新函数；测试query/log凭据分离与其它段保留。
- 11b：测试个人配置不随工程切换被复制；更新环境变量绑定必须显式显示影响宿主重启，不假装现有进程已继承。
- 11c：复用知识provider解析及默认值，测试模型／维度／提供方变化使相关索引标记不匹配，不删除旧库。
- 11d：用户级配置只在明确选择时绑定环境变量；读取／预览不创建TODO文件或自动改注册表。

验证：`node --test tools/agents-workbench/tests/configuration.test.js tools/agents-workbench/tests/knowledge.test.js`，再运行`node --test plugins/bos-plugin/tests/*.tests.js`的受影响组。使用合成配置，禁止真实BOS连接。

### 任务12：安装更新与插件管理

文件：`src/engine-adapter.js`、`tests/deployment.test.js`、`tests/plugins.test.js`。

- 12a：测试“本地检查”只调用Check／DryRun -NoPull；安装命令必须在选定工程cwd运行。
- 12b：从无 `.agents` 的非空工程，以随包安装入口对本地bare远端完成真实安装/补装/配置/适配/读回；保留既有AGENTS/MCP。再用历史revision验证升级与失败后保留现状；不以mock替代。
- 12c：测试插件补装→配置未完成仍available→配置完成后setter启用→索引读回；反向依赖阻止停用。
- 12d：测试同CapabilityRoot多个ContextRoot只更新共享能力一次，离线成员不被prune；用户定制入口冲突保留。

验证：`node --test tools/agents-workbench/tests/deployment.test.js tools/agents-workbench/tests/plugins.test.js`；Windows下补`powershell.exe -NoProfile -File scripts/tests/update-agents.tests.ps1`与`pwsh.exe -NoProfile -File scripts/tests/update-agents.tests.ps1`。预期真实临时Git夹具通过，无业务仓写入。

### 任务13：MCP与宿主管理

文件：`src/engine-adapter.js`、`tests/mcp.test.js`、`scripts/lib/iris-session-migration.js`仅按实际缺口局部调整。

- 13a：测试配置存在／程序存在／受管Check／宿主发现／远端连接为独立状态；读取不启动服务器。
- 13b：测试已知受管迁移复用owner，保留其它服务、自定义args/env和disabled；未知启动器只读展示。
- 13c：用假stdio服务做initialize/tools-list/正常关闭，证明确认后只做发现而不调用写工具；记录真实退出而非仅发close。
- 13d：宿主适配复用sync-runtime-skills/agents；测试生成与实际发现分离、用户级影响预览。
- 13e：逐宿主核实官方调用接口并做最小往返；测试直接派发、仅打开、提示词复制三种能力级别，以及失败/提问/取消不支持时的真实反馈。复制请求不标完成，返回后重查 owner 状态。

验证：`node --test tools/agents-workbench/tests/mcp.test.js scripts/tests/runtime-agents.tests.js scripts/tests/runtime-skills.tests.js`。真实宿主加载单独在授权工程验收。

### 任务14：知识与向量面板

文件：`src/engine-adapter.js`、`tests/knowledge.test.js`。

- 14a：本地检索用既有knowledge-query加local-only，断网夹具必须返回来源、行号和本地模式。
- 14b：测试install-index/remove-index与物理索引状态分开，原工作台db不复制业务vectors。
- 14c：测试preview返回外发目录、provider、模型和费用未知值；只有范围授权后才能build，新增目录必须重新预览。
- 14d：故障注入中断后按原构建缓存续建；只在complete与remainingVectors满足owner判据后显示完整，export沿原校验。

验证：`node --test tools/agents-workbench/tests/knowledge.test.js scripts/tests/knowledge-retrieval.tests.js scripts/tests/knowledge-deployment.tests.js`。不调用真实Embedding服务；现场真实服务另行授权。

### 任务15：手册与配置UI

文件：`src/document-service.js`、`src/web/index.html`、`app.js`、`styles.css`、`config-form.js`、`manual.js`、`tests/documents.test.js`、`tests/ui.test.js`。

- 15a：先实现一个完整页面：选择已有工程→读取IRIS模型→编辑端口→预览→保存→刷新仍一致；不先画所有空壳菜单。
- 15b：测试schema渲染select/number/checkbox/secret及条件必填，前后端均拒绝越界；字段错误就地展示，focus回到首个错误。
- 15c：集成所有已部署guides；测试中文链接、标题锚点、代码复制、未安装插件链接和版本来源。
- 15d：加入恶意Markdown、远程图片、javascript链接、指向私有配置的链接测试；净化后不能触发API或外发。
- 15e：逐页接通工程、能力、MCP、知识与操作记录，未实现动作不显示可点击假按钮。

验证：`node --test tools/agents-workbench/tests/documents.test.js tools/agents-workbench/tests/ui.test.js`。UI测试使用维护者Playwright依赖与本地浏览器，不向业务项目分发浏览器包。再用Agent浏览器人工核对1280与1920宽度、键盘导航、Console/Network无异常、刷新持久化和Root/模块多窗口不串数据。

### 任务16：EXE启动、离线分发和数据库备份

文件：`windows/WorkbenchLauncher.cs`、`launch.ps1`、`build-package.ps1`、`build/build-assets.js`、`tests/packaging.test.js`。

- 16a：启动器先在无Node环境展示缺项并引导ai-dev-offline；返回后校验24.22.3并启动。最小EXE及可信安装依赖闭包前移到第一里程碑，正式包完善仍归本任务。
- 16b：打包UI依赖、schema校验器、可信resolver和guides快照，所有输入记录revision／hash／许可；在无node_modules目录运行。
- 16c：测试启动器重复打开复用原实例、退出不遗留自有进程、活动任务关闭有明确信息；不杀用户其它Node／MCP。
- 16d：数据库备份使用SQLite一致性backup而非仅复制主db；备份读回integrity_check，恢复先关闭连接并校验schema，DPAPI跨用户失败明确提示。
- 16e：断网、无开发工具路径、中文空格路径下实际解压运行，复用 ai-dev-offline 部署的 Node 24.22.3，验证工作台及其框架子进程解析到同一运行时；不静默安装或改全局PATH。

验证：`node --test tools/agents-workbench/tests/packaging.test.js`；`powershell.exe -NoProfile -File tools/agents-workbench/build-package.ps1`。预期固定ZIP、摘要核对通过，断网仍可接入已有工程和读手册。签名／组织应用控制在发布验收中单列，不宣称普通exe构建成功即所有现场可运行。

### 任务17：真正的离线能力包安装更新（独立可验收切片）

文件：`build/build-offline-package.js`、`scripts/install-agents.ps1`、`scripts/update-agents.ps1`、`tests/deployment.test.js`、`scripts/tests/update-agents.tests.ps1`、`docs/update-agents.md`。

- 17a：先测试原安装器只能使用固定远端，证明本地包输入缺口；设计新增显式`-RepositorySource`安装输入和`-UpdateSource`更新输入，默认路径保持不变。
- 17b：能力包使用可信完整Git bundle与清单，包含指定revision所需对象；构建时补齐partial clone缺失blob，禁网解包验证，不能只打当前sparse工作树。
- 17c：安装／更新仍走原sparse、依赖与生成层；source指向明确本地包，不执行来自包内的任意安装扩展。包校验失败原工程不变。
- 17d：现有远端与upstream保持；本地包更新只允许可证明的安全快进。dirty、领先、分叉或对象不全停止，不reset、不强推。
- 17e：验证全量／按需／Overlay及可选向量资源均能在禁网夹具完成，记录实际包体再决定按体系拆分；首版不为降低包体先造复杂增量格式。

验证：`node --test tools/agents-workbench/tests/deployment.test.js`及双PowerShell更新回归。预期禁止任何网络请求仍完成本地包接入，私有配置和已有远端不变。此切片未完成前产品只能宣称“界面离线”，不能宣称“完整断网部署”。

### 任务18：维护同步与正式验收

文件：`tools/agents-workbench/README.md`、`tools/README.md`、根`README.md`、`docs/guides/agents-workbench.md`、`docs/README.md`、`docs/update-agents.md`、受影响owner manifest及`releases/plugin/<owner>/<version>.md`、维护记忆／日志／backlog。

- 18a：记录工作台与框架版本兼容矩阵、源仓／业务项目边界、数据目录、恢复与卸载保留策略。
- 18b：受影响插件严格递增版本；一个完整交付目的一个发布记录，不为每个微步骤发一个版本。schema生成物、catalog和直接依赖范围一并核对。
- 18c：新增`.github/workflows/workbench.yml`，Node核心三平台矩阵，DPAPI／启动器Windows专项；发布只依据实际运行结果。
- 18d：在授权的新工程、旧全量工程、旧按需工程、Overlay各完成真实路径；人工只判断业务事实与可用性，不要求手改JSON救流程。
- 18e：记录学习与操作成本：用户需要理解的概念、必填字段、手工文件编辑次数、确认次数、故障恢复动作。目标是常规接入无需手工编辑配置；不预先编造节约比例或完成时间。

验证：

```powershell
node scripts/generate-plugin-catalog.js --check
node tools/agents-workbench/build/compile-schemas.js --check
node --test tools/agents-workbench/tests/*.test.js
node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js
git diff --check
```

取得提交授权、精确暂存本轮文件后再执行：

```powershell
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root . --staged --budget-ms 60000
git diff --cached --check
```

历史已登记XC版本问题按既有边界处理，不改不可变发布记录，也不把局部门禁通过宣传为全仓无技术债。

## 12. 验收矩阵与完成定义

### 12.1 必过路径

1. 首次部署：无Node时启动器引导既有安装助手→选无框架的非空工程→安装→补装→配置/Agent补全→启用→客户端入口读回；已有文件保留，不要求先打开配置文件。
2. 已有工程：只读添加无改动→导入一个配置域→改值→原CLI读取一致→退出重开一致。
3. 外部修改：Agent改文件→UI刷新识别→无冲突吸收／有冲突停在该字段，绝不静默覆盖。
4. 共享Overlay：两个工程共享能力，配置隔离；更新共享一次，刷新各自上下文，不误裁剪离线成员资源。
5. 凭据：数据库／WAL／日志／普通导出无明文；必要运行实例私有且未跟踪；错误账号不冒充连接成功。
6. 中断恢复：每个跨文件写入点、DB提交前后、子进程取消均可准确展示状态，不自动重放未知外部动作。
7. 手册：断网可读，可正确打开相关配置页面，恶意内容不能执行代码或访问私有文件。
8. 知识：无向量／无服务可本地查询；外发与建库显式授权，断点续建不丢已保存数据。
9. 脱离工作台：关闭／卸载UI后原框架继续工作，配置和恢复资料不被删除。
10. 离线包：只有任务17实跑通过才验收完整断网安装／更新。
11. 宿主接续：已验证接口实际派发/返回；无接口时复制带工程上下文的提示词→用户执行→返回重查。两者均不能把发起当完成。
12. Root/模块：从Root进入模块和模块独立启动取得同一模块身份；并行窗口不串配置，共享操作协调且不改变其它模块启用状态。

### 12.2 不得替代的证据

- mock通过不等于真实PowerShell／Git路径通过。
- 文件保存不等于MCP宿主已加载。
- 工具发现不等于连接认证或业务调用成功。
- UI表单提交不等于所有消费者读到了同一值。
- DB备份成功不等于异机凭据可解密。
- Windows通过不等于macOS/Linux完整可用。
- 新版源仓发布不等于已部署副本已升级。

## 13. 风险、取舍与待确认事项

### 已作出的推荐取舍

- 统一配置模型与SQLite中心值得建设，但只接管明确支持的配置域，避免一次性改写全部运行时。
- 初版EXE是可靠启动入口，界面仍由浏览器承载；不把WebView2作为所有人上手前置条件。
- 凭据使用DPAPI加密入库；不为首版自建密码库或跨机密钥同步。
- 业务执行状态继续由原框架负责，SQLite不另造第二个调度器、插件状态机、远端锁或向量引擎。
- 配置schema与UI元数据是必要新增：现有字段散落且不能可靠自动推导。其成本由维护者承担，不让使用者填写schema。
- 新的配置服务必须同时可供CLI／Agent使用，不能只为UI专门再造一条语义不一致的写入链。

### 实施前的关键验证，不留给使用者猜

- DPAPI往返、stdin保密、WAL无明文及备份恢复：任务07/16实测。
- 原配置工具的读写与恢复副作用：任务03/09对照，特别是configure-project.main。
- 老版本／Overlay的配置归属与未知字段保存：任务08/10/12实测。
- Node:sqlite实际运行版本与打包：任务02/16实测，不能仅凭文档支持宣称兼容。
- 公司应用控制／杀软与EXE签名：在指定试点机器验收；不能靠另取文件名绕过组织策略。
- Markdown净化与API隔离：任务04/15实测。

### 仅需产品选择，不阻塞当前方案

1. 若必须是独立桌面窗口而非浏览器，采用WebView2薄壳作为首版发布要求；核心模型与服务不变，但必须增加离线Runtime物料和实机验证。
2. 若要求换电脑连同凭据一并迁移，需单独批准带口令加密的导出／导入方案；当前默认仅迁移非凭据配置。
3. 是否首版就交付完整断网部署包：推荐先完成已有工程管理闭环，再完成任务17；两者均在本计划，但不混称完成。

## 14. 建议推进顺序与减负验收

1. **第一里程碑：首次与已有工程双路径最小闭环**。任务01–06及10/12/15/16必要切片：最小EXE、环境复用、工程识别、可信安装、一个配置域、客户端入口/提示词交接、读回。交付可操作界面，不先完成全部基础设施再做UI。
2. **第二里程碑：配置与Agent协同**。完成07–11、13及15相关部分：凭据、草稿、并发与恢复、工程探索交接、多宿主适配；验证旧版本与未知自定义分支。
3. **第三里程碑：完整管理范围**。完成Root/模块视图、插件生命周期、更新、MCP/连接、知识/向量、手册和任务恢复；所有目标均有确定性执行或明确Agent/人工接续路径，不留假按钮。
4. **第四里程碑：离线分发与推广验收**。完成16–18：环境包、工作台包和框架离线包分别校验，干净机断网、历史工程、Overlay及多客户端实测；未验证范围如实列出。

### 14.1 UI 与任务覆盖验收

实施前为第4章每页给出线框和状态设计，并按“用户目标→入口→自动步骤→Agent/人工步骤→结果检查”核对所有功能。首批原型同时演示新工程向导、已有工程首页、Root/模块导航、配置页和Agent交接卡；不以单张首页代替完整交互设计。

关键场景：首次接入、已有项目直接使用/补装/升级、连接修改、不同客户端接入、共享更新部分失败、知识检索与向量续建、通过手册发起任务、无宿主API时复制提示词后返回验证。覆盖空态、错误、刷新持久化、键盘操作及1280/1920宽度，检查Console/Network。

衡量用户负担：常规路径是否仍需找脚本、记插件名、手改配置、重复填写连接或重复确认；模型任务是否带完整上下文、返回后能否接续。记录实际步骤与人工介入，不编造节约比例。必要选择保留，框架可推导的内容自动处理；后台失败必须给具体下一步。

### 14.2 完成边界

新工程和已有工程都能完成真实接入；独立工程、Root、模块的配置与共享资源归属正确；第9章完整范围均有可用交互。自动执行、Agent完成、人工确认和未验证状态可辨别。没有宿主API不阻断工作台交付，但相应功能必须提供可用提示词/交接与重查路径，不能宣称已自动集成。
