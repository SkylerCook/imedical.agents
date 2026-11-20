# Agents Workbench 本机工作台

从[运行与构建说明](../react/README.md)打开实际工程或虚构演示。这里维护本机服务、配置适配器和演示数据。

## 当前真实能力

- 九个页面使用同一工程身份、导航和视觉规范：总览、目录、插件、工程配置、客户端、MCP/连接、知识/向量、手册、任务/恢复。
- 从已知源文件读取字段设置状态、插件 profile 与领域配置存在性。编辑器带出白名单非敏感字段，凭据仅显示设置状态。远端认证单独验证。
- IRIS 工程连接复用 `tools/ai-dev-offline/configure-project.js`，同步 VS Code、MCP、TOML、已存在的集中 project-env 与受管 backend。支持预览、指纹冲突检查、用户确认保存、逐文件读回及失败恢复；回执沿现有忽略目录保存。本入口目前仅验证 Windows。
- BOS 与知识个人配置沿当前进程 `BOS_MCP_CONFIG` / `KNOWLEDGE_RAG_CONFIG` 绑定。支持字段级编辑、5 分钟变更预览、由用户保存、原文件读回。改字段时保留原 JSONC 注释。密码、Key、Token、可能含认证参数的地址通过保留、替换或清除操作维护，候选值保存在服务内存。BOS 旧版共用时使用严格 JSON。 [BOS 格式与回退](../../../plugins/bos-plugin/references/usage.md#共享私有配置)
- BOS 查询和日志分别显示连接方式。公司默认地址由插件提供，已有自定义 HTTPS 地址可以在预览后替换。改变连接方式时沿配置说明编辑原文件。自定义地址在页面和预览中仅显示设置状态。
- 保存仅支持既有 JSON 中的固定字段，保留未知字段、BOM、缩进与换行。临时文件继承原文件 ACL，原子替换前重查指纹；来源冲突停止。私有文件位于 Git 工作区、符号链接或来源缺失时不开放保存。
- HTTP 写接口校验本机 Host、Origin、专用请求头、JSON 类型与长度；没有任意路径、shell 或 SQL 接口。不防御同账号恶意本机进程。
- 凭据由既有私有配置管理，操作回执沿各入口保存。外部非协作编辑器仍可能在最终检查与替换之间产生竞争。

## 未接通的能力

Web basePath/cspBasePath/brokerPath/cookie 与已存在的 SFTP host/port/username/password/localPath/remotePath 可编辑；SFTP 只更新已有可识别 MCP 的环境字段。Windows standard 工程可在连接表单添加或切换开发库档案，已登记的 VS Code、IRIS MCP、TOML 和框架配置随选择同步。正式 ZIP 中的可用范围见对应发行记录。源码试点支持显式核验当前 IRIS MCP 连接，在插件详情补装、启停并核对发现入口，初始化可接续给 Agent。宿主自动派发、MCP 启动与认证、业务向量操作及 EXE 按工作台方案推进。

知识页可检索已绑定工程的业务知识和界面参考正文，显示来源与行号，并识别 `.agents/.knowledge-cache` 中的已知索引。「使用手册」跨随包资料搜索标题、文件名和正文，结果可打开命中位置。手册支持表格、代码、同目录指南和已知小节跳转。客户端读取项目级入口存在性。插件管理提供依赖计划预览和 Agent 接续，目录显示源仓版本。

## 保留的交互演示

`/#/clinic/home` 打开临床协同工程的交互演示。演示控制提供首次接入、独立工程、Overlay Root／模块、旧接口、冲突与失败恢复。示例只使用虚构值，草稿和进度按工程保存在当前浏览器。

在 `/#/clinic/config` 的「开发库档案」选择 B，点击「预览切换」核对 VS Code ObjectScript、IRIS MCP 和框架脚本，再模拟应用。页面显示 B 为当前库与客户端待重连，点击「模拟重连并核验」后显示模拟连接结果。选 A 可用同一流程切回。模拟保存失败会保留原库和待应用草稿。

## 验证

```powershell
node --test tools/agents-workbench/prototype/personal-settings.test.js tools/agents-workbench/prototype/project-settings.test.js
```

测试使用独立临时合成文件，覆盖预览零写入、秘密不回传、替换读回、外部修改冲突、未知字段保留、BOM/CRLF、一次性计划、临时文件清理。Windows ACL 使用 .NET 文件接口，通过 Windows PowerShell 5.1 保留。

源码的[工作台验证流程](../../../.github/workflows/workbench.yml) 在 Windows、macOS、Linux 上构建界面并验证工程绑定、配置及暂存包。Windows 专项使用隔离工程验证并行启动及原安装器、更新器。

实际工程用于界面读取验收。预览、保存、冲突和恢复使用合成工程与虚构凭据验收。实际保存由用户在 UI 核对来源与影响后确认。

工程专项另覆盖集中 IRIS/Web/SFTP 与 MCP/VS Code/TOML 一致性、受管 backend 绑定保持、多文件中途失败恢复、原未知字段和启动参数保留。

## standard 工程的本地检查接口

启动器绑定工程后，服务在后台读取身份。带 `X-Workbench-Request: 1` 的 `GET /framework.json` 返回最近一次观测的 `projectId`、`status`、`revision` 和 `observedAt`。初次读取期间状态为 `observing`。重新读取用显式的 `refresh` 动作。

从启动器打开页面时，React 用 URL fragment 中的一次性令牌交换本地会话。页面集成可复用 [frameworkAction](../react/src/framework-api.ts)。调用示例：

```ts
const response = await fetch("/framework.json", { headers: { "X-Workbench-Request": "1" } });
const { projectId, revision } = await response.json();
const result = await frameworkAction("check", projectId, revision);
```

工程动作共用 `POST /framework/action`，JSON 正文只接受 `action`、`projectId` 和 `revision`。`check` 和 `preview` 分别执行已安装更新器的 Check 和 DryRun，均带 `-NoPull`。返回原进程 `exitCode` 和执行前后的工程身份及 revision。退出码只描述更新器进程，业务就绪状态仍需对应验证。

`install` 使用随包安装器校验首装目标，落盘后生成入口并复查。其它 revision 可读取工程身份，执行已安装脚本的动作需要该提交与已验证运行文件同时匹配。来源、落盘运行文件或执行树无法确认时，服务返回拒绝原因。

已部署 standard 或 Overlay 工程通过 `POST /framework/update-note` 取得只读版本观测及更新提示词。请求使用同一会话授权，JSON 正文为 `projectId` 和 `revision`。上游暂不可达时仍可复制提示词。更新及复查交给当前工程的 Agent 沿[原更新手册](../../../docs/update-agents.md#使用工作台安装与更新)执行。

`POST /framework/agent-handoff` 复用当前工程会话。页面接续请求传 `projectId`、`purpose: "task"` 和任务标识，选择插件、手册或工程档案时带相应标识。服务核对目录及任务来源后返回固定提示词，正文包含当前工程身份、相关入口、授权范围和复查步骤。

从仓库根运行真实安装、Git、PowerShell 5.1 和回环 HTTP 夹具：

```powershell
node --test tools/agents-workbench/tests/project-context.test.js tools/agents-workbench/tests/installed-owner.test.js
```
