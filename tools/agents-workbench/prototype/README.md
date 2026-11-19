# Agents Workbench 本机工作台

从[运行与构建说明](../react/README.md)打开实际工程或虚构演示。这里维护本机服务、配置适配器和演示数据。

## 当前真实能力

- 九个页面使用同一工程身份、导航和视觉规范：总览、目录、插件、工程配置、客户端、MCP/连接、知识/向量、手册、任务/恢复。
- 从已知源文件读取字段设置状态、插件 profile 与领域配置存在性。编辑器带出白名单非敏感字段，凭据仅显示设置状态。远端认证单独验证。
- IRIS 工程连接复用 `tools/ai-dev-offline/configure-project.js`，同步 VS Code、MCP、TOML、已存在的集中 project-env 与受管 backend。支持预览、指纹冲突检查、用户确认保存、逐文件读回及失败恢复；回执沿现有忽略目录保存。本入口目前仅验证 Windows。
- BOS 与知识个人配置沿当前进程 `BOS_MCP_CONFIG` / `KNOWLEDGE_RAG_CONFIG` 绑定。支持字段级编辑、5 分钟变更预览、由用户保存、原文件读回。密码、Key、Token、可能含认证参数的地址不回显，用保留/替换/清除；候选值仅保留服务内存，不写浏览器存储。
- 保存仅支持既有 JSON 中的固定字段，保留未知字段、BOM、缩进与换行。临时文件继承原文件 ACL，原子替换前重查指纹；来源冲突停止。私有文件位于 Git 工作区、符号链接或来源缺失时不开放保存。
- HTTP 写接口校验本机 Host、Origin、专用请求头、JSON 类型与长度；没有任意路径、shell 或 SQL 接口。不防御同账号恶意本机进程。
- 凭据由既有私有配置管理，操作回执沿各入口保存。外部非协作编辑器仍可能在最终检查与替换之间产生竞争。

## 未接通的能力

Web basePath/cspBasePath/brokerPath/cookie 与已存在的 SFTP host/port/username/password/localPath/remotePath 可编辑；SFTP 只更新已有可识别 MCP 的环境字段。实际工程入口编辑当前连接。真实多库切换、部署更新、插件安装启停、宿主自动派发、MCP 启动与认证、业务向量操作及 EXE 按工作台方案推进。

知识页检索随工具的手册标题，并识别 `.agents/.knowledge-cache` 中已知索引文件的大小和时间。手册支持表格、代码、同目录指南和已知小节的跳转。客户端读取项目级入口存在性。插件管理提供依赖计划预览和 Agent 接续，目录显示源仓版本。

## 保留的交互演示

`/#/clinic/home` 打开临床协同工程的交互演示。演示控制提供首次接入、独立工程、Overlay Root／模块、旧接口、冲突与失败恢复。示例只使用虚构值，草稿和进度按工程保存在当前浏览器。

在 `/#/clinic/config` 的「开发库档案」选择 B，点击「预览切换」核对 VS Code ObjectScript、IRIS MCP 和框架脚本，再模拟应用。页面显示 B 为当前库与客户端待重连，点击「模拟重连并核验」后显示模拟连接结果。选 A 可用同一流程切回。模拟保存失败会保留原库和待应用草稿。

## 验证

```powershell
node --test tools/agents-workbench/prototype/personal-settings.test.js tools/agents-workbench/prototype/project-settings.test.js
```

测试使用独立临时合成文件，覆盖预览零写入、秘密不回传、替换读回、外部修改冲突、未知字段保留、BOM/CRLF、一次性计划、临时文件清理。Windows ACL 使用 .NET 文件接口，通过 Windows PowerShell 5.1 保留。

实际工程用于界面读取验收。预览、保存、冲突和恢复使用合成工程与虚构凭据验收。实际保存由用户在 UI 核对来源与影响后确认。

工程专项另覆盖集中 IRIS/Web/SFTP 与 MCP/VS Code/TOML 一致性、受管 backend 绑定保持、多文件中途失败恢复、原未知字段和启动参数保留。
