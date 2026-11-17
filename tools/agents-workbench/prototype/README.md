# Agents Workbench 本机工作台

从源仓根启动，目录通过运行参数指定，不写入共享代码：

```powershell
node tools/agents-workbench/prototype/serve.js --project <业务工程根目录>
```

实际工程入口：`http://127.0.0.1:4179/actual.html#home`。绑定工程时根 `/` 也打开实际工作台。仅监听 127.0.0.1；无 CDN 或运行期下载；停止服务在启动终端按 Ctrl+C。

## 当前真实能力

- 九个页面使用同一工程身份、导航和视觉规范：总览、目录、插件、工程配置、客户端、MCP/连接、知识/向量、手册、任务/恢复。
- 从已知源文件读取字段设置状态、插件 profile 与领域配置存在性。工程配置值不返回界面；不能把已设置当认证有效。
- IRIS 工程连接复用 `tools/ai-dev-offline/configure-project.js`，同步 VS Code、MCP、TOML、已存在的集中 project-env 与受管 backend。支持预览、指纹冲突检查、用户确认保存、逐文件读回及失败恢复；回执沿现有忽略目录保存。本入口目前仅验证 Windows。
- BOS 与知识个人配置沿当前进程 `BOS_MCP_CONFIG` / `KNOWLEDGE_RAG_CONFIG` 绑定。支持字段级编辑、5 分钟变更预览、由用户保存、原文件读回。密码、Key、Token、可能含认证参数的地址不回显，用保留/替换/清除；候选值仅保留服务内存，不写浏览器存储。
- 保存仅支持既有 JSON 中的固定字段，保留未知字段、BOM、缩进与换行。临时文件继承原文件 ACL，原子替换前重查指纹；来源冲突停止。私有文件位于 Git 工作区、符号链接或来源缺失时不开放保存。
- HTTP 写接口校验本机 Host、Origin、专用请求头、JSON 类型与长度；没有任意路径、shell 或 SQL 接口。不防御同账号恶意本机进程。
- 仅原有个人实例保存凭据；尚未实现计划中的 DPAPI/SQLite 配置中心、持久审计、备份与崩溃恢复。外部非协作编辑器在最终检查与替换的极小时间窗仍可能竞争，因此不能宣称生产级并发事务。

## 未接通的能力

Web basePath/cspBasePath/brokerPath/cookie 与已存在的 SFTP host/port/username/password/localPath/remotePath 可编辑；SFTP 只更新已有可识别 MCP 的环境字段。创建新 SFTP、切换 runtime、keyFile/knownHosts、远程命令权限不在保存范围。部署更新、插件安装启停、宿主自动派发、MCP 启动/认证、业务向量检索/构建/续建/导出、数据库备份、EXE 均未实现真实执行。界面明确显示限制并提供 Agent 接续，不伪造成功。

知识页目前检索随工具的手册标题，并识别 .agents/.knowledge-cache 中已知索引文件的大小/时间，不将文件存在视为索引有效。手册默认打开使用手册，支持表格/代码、同目录手册跳转及显式 HTTPS 链接；跨目录链接和段落锚点尚未完整实现。客户端读取项目级入口存在性，不声称宿主已加载。插件管理提供依赖计划预览和 Agent 接续，不自动安装启停。源仓 manifest 版本不代表已部署版本。

## 保留的交互演示

`/index.html#/clinic/home` 打开原演示，使用虚构工程和独立 localStorage。左下角演示控制覆盖首次接入、独立工程、Overlay Root/模块、旧接口、冲突与失败恢复。不得输入真实凭据；演示不会写工程。真实工作台入口与演示相互链接，但不共享配置状态。

## 验证

```powershell
node --test tools/agents-workbench/prototype/personal-settings.test.js tools/agents-workbench/prototype/project-settings.test.js
```

测试使用独立临时合成文件，覆盖预览零写入、秘密不回传、替换读回、外部修改冲突、未知字段保留、BOM/CRLF、一次性计划、临时文件清理。Windows ACL 使用 .NET 文件接口，通过 Windows PowerShell 5.1 保留。

本轮实际工程仅测试读取与计划预览（预览发现现有 VS Code、受管 backend 与忽略规则需要同步），未由 Agent 保存真实凭据或连接。用户需自己在 UI 预览并保存。视觉说明见 [DESIGN.md](DESIGN.md)。

工程专项另覆盖集中 IRIS/Web/SFTP 与 MCP/VS Code/TOML 一致性、受管 backend 绑定保持、多文件中途失败恢复、原未知字段和启动参数保留。
