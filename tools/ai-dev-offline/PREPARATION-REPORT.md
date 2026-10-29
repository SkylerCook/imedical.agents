# 基础工具离线物料准备回执

日期：2026-10-29（Asia/Shanghai）。组合：`ai-dev-base-windows-x64-2026-10-29`。

本期准备六项基础工具，用户随后明确使用 CodeBuddy 插件，补入与本机同版本的官方 VSIX、三个 settings 模板、单 server MCP/TOML 模板及部署后的 PATH 配置入口。此回执记录准备机证据，不代表医院现场或干净环境部署已验收。

## 当前证据

- 官方发布元数据已读取，固定下载来源、文件名、精确字节数与官方 SHA256 见 manifest。
- 六项基础工具已取得官方原包，按官方元数据核对精确大小与 SHA256。CodeBuddy 从官方 Marketplace 获取并还原 HTTP gzip 传输编码，本地计算原始 VSIX SHA256，未取得发布者独立摘要；内部 publisher/name/version/engines 与本机已用 manifest 交叉核对，无声明的扩展依赖或扩展包。
- Windows PowerShell 5.1.26100.9711 与 PowerShell 7.6.9：各 24 项定向检查通过，覆盖所选项隔离、默认包根定位、未选项缺包跳过、缺包失败、未知组件、同大小损坏、大小错误、路径越界、重复身份、语法、固定清单与模板的无凭据／无自动连接保护；新增环境 Plan 只读、未选工具不检测、错误选择停止与 Process 验证失败恢复原 PATH。TOML 使用标准库 tomllib 解析，JSON/TOML 五个非敏感连接字段逐项一致。PS5.1 实际制包发现的参数默认路径初始化与压缩程序集显式加载问题已修正，以真实制包／解压结果验收。
- 在本任务独立临时目录运行：VS Code CLI `1.144.0` / commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf` / x64；使用隔离 user-data/extensions 成功安装并列出 `tencent-cloud.coding-copilot@4.12.39997873`。未激活插件或登录，CLI 出现 Node `DEP0169` 提示，退出码为 0，不推断为 AI 功能已可用。
- PowerShell 原包运行输出 `7.6.9`；Node `v22.23.4`、npm `10.9.9`，内存 SQLite 返回 `42`（Node22 实验特性警告已保留）；PortableGit `2.56.0.windows.4` 创建临时本地仓库成功；Temurin `1.8.0_504` 与 javac `1.8.0_504` 成功编译并运行 `Hello.java`。
- Python 完整安装器 Authenticode 状态 `Valid`，签名主体为 Python Software Foundation；没有执行安装。
- 设置模板仅提取当前本机所选通用偏好。IRIS 结构依据已用 servermanager 3.14.2 / vscode-objectscript 3.8.6 / language-server 2.8.6 配置 schema，真实参数改为占位并关闭连接；这三项扩展本期未打包。没有复制原 settings.json、真实连接、API key、密码、代理、安全开关或自动执行权限。
- MCP 模板只含 iris-agentic-dev，启动命令／TOML 路径为占位并显式指定 --config；TOML 只保留非敏感连接字段，账号密码字段省去，不复制现用值或其它 MCP。启动参数按源仓 vendor 1.5.0 的真实帮助及 helper 核对，不运行 MCP 服务或读取服务器数据。原项目配置未修改。
- PATH 集成在 PS5.1、PS7 各通过一次：使用含空格的临时工具根，将 Node 22.23.4、Python 3.14.10、PortableGit 2.56.0.windows.4、PowerShell 7.6.9 放到部署约定路径，仅以 Scope=Process 执行 Apply，再用新子 CMD 的 where 与四条版本命令核验；重复 Apply 不重复 PATH，回执恢复原串，后来修改导致 Rollback 拒绝。本机 Machine PATH 前后相同。Python 使用同版本官方完整运行时 ZIP 作为测试夹具，按官方 windows-3.14.10.json 摘要校验，测试后删除且不加入正式包；这不代表 Python 安装器、pip/venv 已验收。
- 构建器重新核对七个原包，并逐文件读回最终 ZIP 的流摘要；交付前另用 Windows PowerShell 5.1 解压 ZIP、运行包内校验器，再对全部文件与源文件／manifest 逐项比较。归档结果以本轮构建及独立校验回执为准，ZIP 外层 SHA256 由交付消息提供。

## 待验边界

- 干净 Windows 10/11 x64 断网完整安装尚未执行；医院老系统、权限、安全软件及业务运行时兼容性未验证。
- Python 完整安装器未安装到本机；不以哈希通过替代 pip/venv 的干净环境验收。
- VS Code GUI、CodeBuddy 激活时附加资源、AI 登录／服务连接、IRIS 连接及项目 npm/pip 依赖未验收。VSIX 安装通过仅证明本次隔离安装，不等于完整离线运行能力。
- 本包提供 PATH Plan/Apply/Verify/Rollback；没有完整自动安装器、JSONC/MCP 自动导入、现场 doctor 或项目 launch 实现。Machine 作用域的管理员写入／Windows 环境通知仍需现场验收；本机测试只修改隔离进程的 PATH，未改系统 PATH。
- VS Code 默认／automationProfile 的 PowerShell 7 设置与 AI shell 偏好片段已准备；目标 CodeBuddy 插件是否加载规则、实际是否执行 pwsh 仍需新对话取证。没有变更 ComSpec 或替换 Windows PowerShell 5.1。
- 未修改本机环境变量、安装注册或现有工具；未向医院或其它项目部署。
