# AI 开发基础工具离线物料包

2026-10-29 候选组合，目标为 **Windows 10/11 x64**。本期准备六项基础工具；按用户后续补充，增加当前使用版本的 CodeBuddy VSIX、从现用配置摘取的安全模板与部署后的 PATH 配置入口。其它 AI 客户端后补；不含任何真实医院配置、凭据、项目源码或业务依赖。

正式包统一为 `ai-dev-base-windows-x64-2026-10-29.zip`，已包含 MCP/TOML 模板与 PATH 工具；核对交付时提供的最新 SHA256，不按文件名推断内容版本。

这是可带到现场的官方原包集合，附本地校验、手工部署步骤和显式调用的环境变量配置工具。**不是已经通过干净环境验收的一键安装器**。包完整性通过、工具能够启动、项目能够工作是三个不同结论；当前实际证据见 [PREPARATION-REPORT.md](PREPARATION-REPORT.md)。制包不改变准备机安装或系统变量；现场工具只处理明确选择的组件，不自动扫描电脑或探测未选组件。

## 包内组件

| 组件 | 固定版本 | 原包方式 | 现场命令位置 |
|---|---|---|---|
| VS Code | 1.144.0 | 官方 ZIP；解压后创建 `data/` 启用 portable | `Code.exe` / `bin/code.cmd` |
| Git | 2.56.0.windows.4 | 官方 PortableGit 自解压原包 | `cmd/git.exe` |
| PowerShell | 7.6.9 | 自包含 x64 ZIP，与 Windows PowerShell 并存 | `pwsh.exe` |
| Node.js | 22.23.4 | 官方 Windows ZIP，附带 npm | `node-v22.23.4-win-x64/node.exe` |
| Python | 3.14.10 | 官方完整 x64 安装器，含 pip；非 embeddable | 自选安装目录下 `python.exe` |
| Java 8 | Temurin JDK 8u504-b01 | 官方 ZIP；JDK 内含 Java 运行环境 | `jdk8u504-b01/bin/java.exe` / `javac.exe` |
| CodeBuddy | 4.12.39997873 | 官方 Marketplace VSIX，与用户当前插件版本一致 | `Tencent-Cloud.coding-copilot` |

版本由准备日官方发布源固定，不表示各项目依赖已兼容。Node 22 的选择满足框架最低 `22.5.0` 要求；Python 项目第三方包支持范围仍须按锁文件验证。不另带独立 JRE；没有 Java 开发需求时可以跳过 JDK。本期不含 Maven、Gradle、其它 VSIX／AI 客户端、额外 npm/pip 包、Playwright、数据库、Docker 或本地模型。CodeBuddy 包未声明 extensionDependencies/extensionPack；这只说明扩展安装依赖，不保证首次激活的附加下载或在线 AI 服务可离线运行。

## 先校验，只核对本包

将整个 ZIP 解压到本地独立目录，不在压缩包预览中直接运行脚本。复制后先核对外层 ZIP 的 SHA256 与交付时的摘要，再运行：

```powershell
& .\verify-packages.ps1
# 仅校验本次选择的组件，例如：
& .\verify-packages.ps1 -Components vscode,git,node
```

也可双击 `verify.cmd`。入口只需要系统自带 Windows PowerShell 5.1，不依赖待安装的 Node、Python 或 PowerShell 7。若现场策略阻止运行脚本，按现场可信文件和执行策略管理流程处理；入口不会改变执行策略、代理或安全软件。可用系统自带 `Get-FileHash -Algorithm SHA256` 手工对照 manifest。

校验只读取选定组件的原包大小和 SHA256，不启动程序、不查询已安装版本、不联网、不写系统配置。缺失、大小或哈希错误均停止并报错。`manifest.json` 同时记录官方 URL、摘要来源、安装方式、命令位置和验收条件。包内哈希不能单独证明分发者身份，必须核对外层交付摘要或官方来源。

六项基础工具的摘要来自各官方发布元数据；CodeBuddy 未取得发布者独立 SHA256，清单中的摘要是从官方 Marketplace 下载、还原 HTTP gzip 编码后的实际 VSIX 本地计算值，不能当成发布者签名。VSIX 内身份、版本、兼容范围与本机扩展 manifest 已交叉核对。

## 现场部署：先人工选择空白或补充

**空白环境**：人工确认本次所选工具没有已有安装后，按下表处理所选组件。**补充安装**：只处理人工选定的缺项；未选项不检查、不安装。本包不负责自动作出上述判断。

目录根建议 `D:\Programs`，可改到现场批准的其它位置；示例相对于该根。每项使用新建的空目录，发现目标已有未知内容即停止，不覆盖。先确认所选盘符、空间、权限及现场系统兼容性。不要把项目代码搬到工具目录。

| 组件 | 手工操作 |
|---|---|
| VS Code | 将 ZIP 解压到 `VSCode/1.144.0/`，确认包含 `Code.exe`；在其旁创建空的 `data/` 目录；用该路径启动，勿导入其它机器的用户数据。 |
| Git | 双击 PortableGit 自解压文件，仅解压到 `Git/2.56.0.windows.4/`，保留原有 Git；不运行全机升级。 |
| PowerShell | 解压到 `PowerShell/7.6.9/`，直接使用其中 `pwsh.exe`，保留 Windows PowerShell 5.1。 |
| Node | 解压到 `Node/22.23.4/`，保留 ZIP 内 `node-v22.23.4-win-x64/` 层级。 |
| Python | 打开完整安装器，选择自定义安装、用户级、目标 `Python/3.14.10/`，保留 pip/venv；不添加调试符号、调试二进制、自由线程或其它需下载的可选项。默认不让安装器抢改全局 PATH/文件关联/launcher。如果界面显示既有安装的 Modify/Repair/Upgrade，停止并报告，不把升级当成独立新装。 |
| Java 8 | 解压到 `Java/8u504-b01/`，保留 `jdk8u504-b01/` 层级；不升级医院现有 Java。 |
| CodeBuddy | 在本次选择的 VS Code 中用 Extensions → Install from VSIX，选择包内 `Tencent-Cloud.coding-copilot-4.12.39997873.vsix`。适用 VS Code `^1.70.2`，本包固定 VS Code 满足声明范围。登录、服务连接与实际 AI 功能另行处理，不复制旧电脑账号数据。 |

以上是手工安装指引。下文另提供部署后的 PATH 配置工具；完整自动安装、断点恢复安装器和 VS Code JSONC 自动导入仍未实现。

## 从现用 settings.json 摘取的可选模板

没有复制原文件；只对白名单设置提取值，并核对本机已用扩展的配置定义：

- `templates/settings-user.jsonc`：保留 PowerShell 7 profile 和默认终端、自动识别编码、关闭自动检测缩进；按本轮要求补上 Windows automationProfile，任务终端也优先用 `pwsh -NoLogo -NoProfile`。全部 `__PWSH_EXE__` 替换为本次所选 PowerShell 的完整路径，JSON 字符串内反斜线要转义为 `\\`。不硬编码准备机路径。
- `templates/settings-codebuddy.jsonc`：按当前偏好关闭自动补全与浮动快捷入口，不携带自动执行、权限、安全类别或登录状态。
- `templates/settings-iris-workspace.jsonc`：保留已用的 ObjectScript 格式偏好，连接结构按已安装 servermanager 3.14.2、vscode-objectscript 3.8.6、language-server 2.8.6 核对；连接值全部改为占位，`active=false`。这些 IRIS 扩展本期未随包携带，模板供后续选择相应扩展后使用。

导入是独立可选操作：先选择用户或项目工作区作用域、备份所选文件、展示差异，仅合并所选键，保留现有注释和无关键；同名 profile/服务器对象也要按子键合并，不能用整个父对象覆盖其它条目。冲突由用户决定。IRIS 参数现场填入本机私有文件；用户名在连接时提供，密码使用扩展凭据提示／安全保存机制。模板不预留密码、token 或 API key 字段。不要复制原文件中的连接、代理、安全校验开关、自动执行权限、外部 formatter 引用或其它机器路径。本次未改你的实际 settings.json，也没有实现自动合并器。

## 项目 MCP 与 IRIS TOML 模板

- `templates/mcp.template.json`：基于现用项目 `.mcp.json` 的单个 server 结构，只包含 `iris-agentic-dev`；命令改为 `__IRIS_AGENTIC_DEV_EXE__`，参数保留 `mcp` 并显式添加 `--config __IRIS_CONFIG_FILE__`，避免依赖客户端工作目录。替换为目标项目内实际 vendor exe 和私有 TOML 的绝对路径；JSON 反斜线需转义。不复制其它 MCP。
- `templates/iris-agentic-dev.template.toml`：基于现用 TOML 的顶层字段，保留 host、web_port、scheme、namespace、tls_verify；连接值为占位／示例，凭据字段省去。`52773` 不是现场已验证端口，scheme 按实际服务填写；模板不继承准备机的 TLS 例外。

两份模板分别落到目标项目根的 `.mcp.json` 与 `.iris-agentic-dev.toml`；已有混合 MCP 文件时只合并该 server，不能整文件覆盖。MCP env 的非敏感连接字段与 TOML 填同一目标值，以兼容现有 helper 对 `env.IRIS_NAMESPACE` 的读取；不在模板中放用户名、密码或它们的空白填空字段。运行时凭据使用目标客户端继承的进程环境 `IRIS_USERNAME` / `IRIS_PASSWORD`，或目标工具已支持且现场批准的安全凭据机制，不把密码放命令行。实例文件须在目标项目被 Git 忽略，且只在本机填写。

IRIS MCP 可执行文件继续来自目标项目既有 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`，本包未另带运行时，也不会启动或连接医院服务。模板 CLI 结构依据现有 vendor 1.5.0 帮助与 helper 核对；宿主实际加载、信任、认证和只读调用仍待目标环境验收。不会自动写入 CodeBuddy 用户级配置或其它宿主。

## 环境变量与所选项验收

现场安装到上表约定目录后，可右键以管理员身份运行 `configure-environment.cmd`，人工选择空白／补充模式、工具根目录和组件。它只检查所选路径下的 exe，不搜索已有安装；未选项不检测或配置。脚本入口也可在 Windows PowerShell 5.1 中运行：

```powershell
# 默认 Plan 只预览所选路径，不执行工具或更改变量。
& .\configure-environment.ps1 -Root 'D:\Programs' -Mode Blank -Components node,python,git,powershell
# Apply 配置系统 PATH（需要正常管理员权限）；补充安装改用 -Mode Supplement 并只列缺项。
& .\configure-environment.ps1 -Action Apply -Root 'D:\Programs' -Mode Blank -Components node,python,git,powershell
# 后续只验收本次选择的命令。
& .\configure-environment.ps1 -Action Verify -Root 'D:\Programs' -Components node,python,git,powershell
```

Apply 先将原 PATH、注册表值类型、本次结果和选择保存到所选根目录的 `.ai-dev-environment/<batch>.json` 并读回，再把所选工具目录放在 PATH 前部、按忽略大小写去重；其它项保留原相对顺序，保留 REG_EXPAND_SZ 及未展开的原值。已有旧工具不删除，所选项命令优先解析为本次部署版本。配置后用基于目标作用域环境的新子 CMD 检查 `where` 结果与四条版本命令，失败且没有后续修改时恢复原值。非管理员直接报告，不自动提权或改执行策略。

重开 CMD，应可直接执行：

```cmd
node -v
python --version
git --version
pwsh --version
```

系统环境变更会发出 Windows 通知，但已经运行的终端／VS Code 保留旧环境，须退出重开；子 CMD 验收不等于所有旧进程已刷新。特殊隔离场景显式加 `-Scope Process`，只改变当前 PowerShell 及后续子进程，此时其它新 CMD 不获得持久配置。恢复示例：

```powershell
& .\configure-environment.ps1 -Action Rollback -ReceiptFile 'D:\Programs\.ai-dev-environment\<batch>.json'
```

Rollback 必须仍与本次写入结果一致才恢复；出现后来 PATH 修改则停止，保留回执供按项合并，不用旧整串覆盖。Java 的 `JAVA_HOME` 和 PATH 仍按现场选择单独配置，遇既有业务值冲突保留原值并报告；本工具当前仅实现上述四项命令，不机械创建 HOME。

**AI 优先用 PowerShell 7**：选用 `settings-user.jsonc`，将 `__PWSH_EXE__` 替换为所选 `pwsh.exe` 的实际完整路径，默认终端即为 PowerShell 7。将 `templates/ai-shell-preference.md` 的短规则合并到目标项目既有 `AGENTS.md`，按目标 Agent 的现有适配机制加载；不创建同正文的独立 CODEBUDDY.md。CodeBuddy 如使用用户规则，可在其规则界面选择总是加载同一内容。新对话核对实际加载及一次命令的真实 shell，未核对时只报告模板已准备。PATH 可调用、编辑器默认终端和 AI 实际执行 shell 分别验收，不能仅凭 PATH 成功断言 AI 已切换。[CodeBuddy 官方规则说明](https://www.codebuddy.cn/docs/ide/User-guide/Rules)描述的是规则机制，不替代目标 VS Code 插件的实测。

重开终端／VS Code，再用**本次安装的完整路径**执行 manifest 中的验收命令，并核对实际命令解析位置。至少检查：VS Code 窗口启动；Git 本地临时仓库；PowerShell 版本；Node 与 npm；Python 的 pip 与项目 venv；Java 的 `java`、`javac` 及编译运行。项目级操作只在目标项目获准的目录进行，测试状态用完清理。未选组件标为跳过，AI 登录、医院连接和业务应用另行验收。

## 维护者重建

源码在 `tools/ai-dev-offline/`，最终 ZIP 在被忽略的 `tools/dist/`，整个 tools 不随 `.agents` 安装更新分发；原有业务工程无需同步或清理。准备脚本只面向 Windows，使用 Windows PowerShell 5.1 和系统 curl.exe，无 Node/npm 安装前提。

从仓库根运行，`WorkRoot` 必须是新的任务独立临时目录，或带匹配 owner 标记的本次目录：

```powershell
& .\tools\ai-dev-offline\prepare-package.ps1 -Action Download -WorkRoot 'D:\tmp\Codex\ai-dev-offline-<task-id>'
# 同一目录可续传；可加 -Components node,python 先准备最小批次。
# 确认有需要时，可加 -DirectMicrosoftCdn 仅直连微软官方 CDN，不修改代理配置。
& .\tools\ai-dev-offline\prepare-package.ps1 -Action Pack -WorkRoot 'D:\tmp\Codex\ai-dev-offline-<task-id>'
```

先读回逐组件 checkpoint 和原包，再扩展下载。脚本只读固定 manifest，不取 latest；断点续传只影响原包下载。CodeBuddy 的 HTTP 压缩传输使用 curl `--compressed`，不可用解码后字节偏移续传；残留 partial 必须由调用者核对本任务归属后明确清理，再重新下载该小包。已有完整文件必须重新校验；损坏文件、未知 work 目录、路径链接和已存在的输出 ZIP 均停止。Pack 重新校验全部原包并逐项读回 ZIP 流核对字节与哈希后才改为正式名称。固定版本升级必须重新核对官方元数据和运行兼容，不自动改清单。失败时保留本任务目录以便恢复；独立解压核验 ZIP 成功后，由调用任务按确认过的绝对路径清理该目录。

## 原包与授权说明

所有原包保持原始字节，保留其中许可证、版权和第三方 notices。各来源与许可证入口见 manifest。当前仅为用户私有准备和获准使用场景保存，**未授权公开上传本 ZIP 或二次分发第三方二进制**；尤其不能将 VS Code 产品与其 MIT 源代码许可混同。现场带包仍按组织与各产品许可执行。Git/Temurin 的固定源码入口已列入 manifest；对外分发需要另行满足对应源码和许可义务。

- [VS Code portable](https://code.visualstudio.com/docs/setup/portable) / [产品许可](https://code.visualstudio.com/license)
- [PortableGit 官方说明](https://github.com/git-for-windows/build-extra/blob/main/portable/root/README.portable)
- [PowerShell Windows ZIP](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows)
- [Python 完整安装器及离线安装](https://docs.python.org/3.14/using/windows.html#the-full-installer-deprecated)
- [Temurin 固定发布](https://github.com/adoptium/temurin8-binaries/releases/tag/jdk8u504-b01)
