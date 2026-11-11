# 开发工具离线安装助手

Windows 10/11 x64，使用系统 Windows PowerShell 5.1 和 .NET Framework。完整解压 ZIP 后双击 `开发工具安装助手.exe`。

正式交付固定为仓库根目录下 `tools/dist/ai-dev-offline-gui-win10-x64.zip`，当前为 r4，增加项目配置与目录自动回填。旧版及历史更新包保存在 `tools/dist/history/ai-dev-offline/`。

1. 选择安装目录，默认优先 D 盘。没有 D 盘时使用当前用户的程序目录。
2. 逐项选择“安装并配置”、“已有工具，仅配置”或“仅安装，保留环境”。已有工具用“选择”按钮定位对应 exe。全部工具默认跳过。
3. 选择环境变量作用域，默认当前用户。所有用户需要右键程序，以管理员身份运行。
4. 点击“开始安装与配置”，核对确认窗口后执行。日志显示各项结果，失败后可修正并重试。

包含 VS Code、Git、PowerShell 7、Node.js、Python 和 Java 8。各项可独立选择，GUI 包不携带 CodeBuddy。VS Code 使用独立 portable 目录。

选择配置的工具命令目录加入 PATH，Java 同时设置 JAVA_HOME。系统 PATH 中已有同名命令可能优先于用户 PATH，此时当前项检查失败并恢复变量，日志显示 `selected-command-shadowed`。可选择复用原程序，或在明确需要调整全机命令优先级时选择所有用户。

环境变量原值保存在安装根目录 `.ai-dev-environment/`。点击“恢复环境变量”选择回执，多次修改按从新到旧顺序恢复。后续修改冲突时停止恢复。关闭并重新打开终端才能获得更新后的环境。

只复用本工具有匹配安装记录的目录，已有普通目录请选择其它位置。安装中断可重新运行，已完成安装复用本地程序。Python 3.14 已存在于其它目录时，应选择已有 python.exe。Python 使用官方用户级安装器，即使选择所有用户环境变量，其安装注册仍属于运行安装器的用户。

GUI 运行自身脚本时，为后台进程设置 `RemoteSigned` 执行策略，作用范围随该进程结束。组织策略优先，带互联网来源标记的脚本需要可信签名。启动失败会显示失败步骤、后台程序路径及可取得的 Windows 错误码。

如果日志提示脚本未签名，请由现场管理员按文件来源审核和组织策略处理。若提示“拒绝访问”，将完整错误详情交给现场管理员核对应用控制记录。

每次开始安装或恢复都会自动生成带时间戳的 `.log` 文件，记录所选工具、目录、作用域、启动详情、安装输出和最终退出码。日志优先保存到包内 `logs/`，该目录不可写时使用当前用户 `%LOCALAPPDATA%/AiDevOffline/Logs/`。界面会显示实际日志位置。点击“导出日志…”可另存当前日志，任务运行时也可导出。日志包含本机目录和用户名，反馈前可检查相关内容。

安装过程中保持窗口开启。日志中的成功表示当前所选命令解析与运行检查通过。项目依赖和业务系统需在各自项目中验证。

## 项目配置

安装工具后，点击主窗口底部的“项目配置…”。此入口使用选定 VS Code 自带的运行时处理本地配置。

1. 选择项目根目录。已有配置会自动读取，也可点击“读取已有”重新载入。
2. 核对自动找到的 VS Code、PowerShell 7、Git、Node 和 MCP 路径。程序路径优先使用安装助手中选定的已有工具，再检查安装根目录、上次确认过的路径、PATH 与常见安装位置。VS Code 的便携／普通安装模式根据 `data/` 目录自动选择。
3. 核对服务器名称、主机、HTTP／HTTPS、Web 端口及命名空间。首次配置填写现场值，端口使用管理门户对应的 Web 端口。服务器名称支持 `~` 等普通字符，方便保留现场既有命名。
4. 按需勾选常用编码与 ObjectScript 格式、PowerShell 7 默认终端，以及项目 MCP/TOML。首次配置 MCP 时选择 `iris-agentic-dev.exe`，并填写本机账号密码。已有 MCP/TOML 凭据一致时可直接沿用。
5. 点击“预览配置”，核对目标和文件清单，再点击“应用配置”。修改输入后需要重新预览。成功应用后记住目录与程序路径，下次打开自动填入。
6. 在 VS Code 打开该项目并重新加载窗口。首次连接在扩展提示框中登录，可将密码保存到系统凭据管理器。重启使用该项目的 MCP 客户端后验证其实际连接。

| 配置落点 | 内容 |
|---|---|
| 项目 `.vscode/settings.json` | 所选服务器的 `intersystems.servers` 和当前项目的 `objectscript.conn` |
| 项目 `.mcp.json` | `iris-agentic-dev` 的连接字段，沿用其他 MCP、已识别的启动方式和禁用状态 |
| 项目 `.iris-agentic-dev.toml` | 对应连接参数和明确选择保存的本机凭据 |
| 选定 VS Code 的用户 `settings.json` | 勾选的编码、缩进、ObjectScript 格式和 PowerShell 7 终端设置 |
| 项目 `.agents/config/iris-session-backend.json` | 已使用受管 Node 入口时同步后端的连接参数；新建受管入口时使用项目已有 adapter 和所选 Node |

JSONC 增量合并保留其他配置与注释，TOML 合并后校验所有字段。更新账号密码时，VS Code 配置使用扩展登录提示，MCP 凭据保存到本机项目的私有实例文件。临时请求中的密码通过 Windows DPAPI 加密，日志记录操作、文件和结果，省略连接值与凭据。上次目录记录位于 `%LOCALAPPDATA%/AiDevOffline/last-project.json`，其中仅保存项目和程序路径。

写入前核对私有配置未被 Git 跟踪，自动补充 `.gitignore` 并验证忽略生效。原始字节与回执保存在项目 `.ai-dev-config-backups/`，其中可能包含原有凭据，应留在本机。点击“恢复配置…”选择该项目的 `receipt.json`，多批修改从最近一次开始恢复。后续文件修改发生冲突时停止，应用中途失败则尝试恢复已写文件。恢复后保留 Git 忽略规则以保护备份。异常退出遗留锁时，确认该项目配置进程退出后再移除项目的 `.ai-dev-config.lock`。

当前入口支持本地文件夹、便携或普通 VS Code 用户设置，以及已识别的直接 MCP／标准 `.agents` 受管入口。自定义 VS Code profile、Overlay 后端位置及未知 MCP 启动器需要按各自实际配置处理。

使用前需要在所选 VS Code 安装 InterSystems ObjectScript、Server Manager 和 Language Server 扩展。GUI ZIP 提供配置功能，扩展 VSIX 与 MCP 运行程序由现场已有环境或项目能力包提供。官方扩展支持 Caché／Ensemble 2016.2 及以上和各版本 IRIS，服务端需提供可用的 `/api/atelier`。HTTP、HTTPS 和任意有效 Web 端口均可配置，MCP 在旧 Caché 的实际功能仍需现场验证。[官方支持范围](https://docs.intersystems.com/components/csp/docbook/DocBook.UI.Page.cls?KEY=GVSCO_intro)

本机已验证配置合并、重试、并发修改保护、失败恢复、日志脱敏、真实 VS Code 运行时及 GUI 应用／恢复。远端登录、证书信任、权限、MCP 宿主加载和业务能力在目标环境验收。

## 维护者

运行 `build-gui.ps1` 从 `../dist/ai-dev-base-windows-x64.zip` 提取六项固定原包，重新校验 SHA256，编译 GUI 并生成 `../dist/ai-dev-offline-gui-win10-x64.zip`。重建前将需保留的旧包归档至 `../dist/history/ai-dev-offline/`，再生成固定名称的最新版。安装参数依据 [Git 官方自解压器实现](https://github.com/git-for-windows/7-Zip/blob/master/CPP/7zip/Bundles/SFXSetup/SfxSetup.cpp) 和 [Python 官方 Windows 安装说明](https://docs.python.org/3.14/using/windows.html)。

项目配置复用本目录的 JSONC 编辑器及 `jsonc-parser 3.3.1`。TOML 校验使用固定 `@iarna/toml 2.2.5` 的同步解析器及其最小依赖，来源、发布摘要、逐文件 SHA256 和 ISC 许可证保存在 `vendor/iarna-toml/`，现场无需 npm install。该库面向 TOML 0.5，遇到超出支持语法的配置会报告解析失败并保留原件。[上游源码](https://github.com/iarna/iarna-toml)

本机可进行 GUI、解压、已有路径配置及 Process 环境隔离检查。真实 User/Machine 环境写入、Python 安装注册和干净 Windows 10/11 断网完整流程应在获授权的验证机验收。

当前包适用 Windows 10/11 x64。Win7 独立兼容包已列为暂缓待办，实际项目需要时再启动制作与验证。

## 现场验收

先在现场允许的独立目录试装，按实际项目需要选择工具。

- 核对安装预览中的旧命令位置、所选路径与环境变量作用域。
- 先测试“仅安装，保留环境”，使用新程序完整路径检查版本，确认原 Java/Python 命令保持原有结果。
- 测试“已有工具，仅配置”或“安装并配置”后，重开终端，检查命令版本及 `where.exe` 返回的首个路径。
- Python 检查 `python -m pip --version`，并在测试目录执行 `python -m venv test-env`。
- Java 检查 `java -version`、`javac -version` 和 JAVA_HOME，结合原业务验证版本切换是否符合预期。
- 使用本次回执恢复环境变量，重开终端检查原路径与原版本。回执按最新到最早恢复。

本机验收覆盖隔离目录安装、Process 环境、恢复与保护逻辑、GUI 入口及日志导出。一个 Windows 10 x64 现场样本已验证 VS Code、PowerShell 7、Node.js 安装及 User PATH 配置，Java 8 使用完整路径可运行。该样本的旧 Java 命令优先级导致默认版本切换失败。Python 安装注册、Machine 持久写入、环境恢复及业务兼容仍待现场验收，Win11 干净环境另验。
