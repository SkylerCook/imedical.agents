# IRIS 内网源码导出工具：人工操作说明

把 ZIP 带到现场电脑或远程电脑，解压即可使用。需要 Windows PowerShell 5.1 或 Windows 上的 PowerShell 7，不需要 AI、框架技能、Node.js、Git 或 MCP。

**以下操作全部在实际能访问 IRIS 的那台电脑执行。** 如果正在远程桌面里操作，就在远程桌面的 PowerShell 和浏览器中检查，不能用自己本机的连通性替代。

## 一、文件这样放，在项目目录执行

推荐采用下面的摆放方式。`项目目录` 是你自己选的工作目录，名字没有要求：

```text
项目目录\
├─ iris-code-export.zip        带来的压缩包
├─ iris-code-export\           解压后的工具目录
│  ├─ README.md
│  ├─ export-iris-code.ps1
│  ├─ files.example.txt
│  └─ images\project-layout-example.png
├─ files.txt                   自己编写的导出清单
└─ exported-code\              执行导出后生成，第一次执行前应不存在
```

导出完成后的实际目录示例：

![导出完成后的项目目录示例](images/project-layout-example.png)

图中的 params.md.txt 是现场自建的操作说明，不是脚本必需文件；ZIP 自带说明位于工具目录内的 README.md。图片展示文件摆放，是否全部成功仍以终端的 complete 和文件数量为准。

**PowerShell 停留在项目目录，不是工具子目录。** 打开项目目录，点击资源管理器地址栏，输入 `powershell` 后回车。若解压后又套了一层文件夹，先整理到图中的结构，确保脚本位于 `iris-code-export\export-iris-code.ps1`。

在资源管理器“查看”中打开“文件扩展名”，确认清单实际叫 `files.txt`，不是 `files.txt.txt`；脚本实际是 `.ps1`，不是 `.ps1.txt`。`README.md.txt` 仍可阅读，但建议说明文件保留 `.md` 名称。

文中的每个 PowerShell 代码块都是一整行。**完整复制一行、粘贴、按回车**；窗口自动换行不影响执行。若出现连续的 `>>`，表示命令还未补全，先按 Ctrl+C 回到 `PS …>`，再重新复制整行，不要倒序粘贴多行代码。

## 二、准备 files.txt

已有清单就直接用记事本编辑，不必重新复制示例。下面一行只会在没有 files.txt 时创建示例副本，不覆盖已有清单：

```powershell
if (-not (Test-Path -LiteralPath .\files.txt)) { Copy-Item -LiteralPath .\iris-code-export\files.example.txt -Destination .\files.txt }; notepad .\files.txt
```

保存为 **UTF-8**，每行一个准确对象。后端写对象全名和扩展名，前端写以 `/` 开头的完整 Web 虚拟路径：

```text
# 后端示例
DHCDoc.Util.RegisteredObject.cls

# 前端示例：前缀属于相应项目，并非脚本固定值
/imedical/web/scripts/udhcfavitem.edit.newshow.js
/imedical/web/csp/chemo.aform.main.csp
```

其它现场必须换成实际存在的对象名和路径。`/imedical/web` 不是固定前缀；其它说明里的 `webapp` 也只是占位符。脚本不会自动补 Web 前缀，不接受本地磁盘路径来代替服务器虚拟路径。

- 后端支持 `.cls/.mac/.inc/.int`；不写磁盘目录，必须带扩展名。
- 前端支持 `.csp/.csr/.js/.css/.html/.htm`；必须以 `/` 开头。
- 允许空行、整行 `#` 注释和 UTF-8 BOM；不支持行尾注释。
- 不接受通配符、整个目录、缺扩展名、相对前端路径或图片。重复对象、目录穿越、Windows 保留文件名和落盘冲突会停止。

## 三、先检查清单，再导出

在项目目录执行，先检查格式与路径映射：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\iris-code-export\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory .\exported-code -PlanOnly
```

看到 `total` 和逐项清单，表示本地检查通过。此时 `status: pending`、`sha256: null`、`bytes: 0` 都正常：**PlanOnly 没有连接服务器，也没有导出文件或创建输出目录。** total 应与你清单里实际对象数量一致。

确认后执行正式导出，只去掉末尾的 `-PlanOnly`：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\iris-code-export\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory .\exported-code
```

`-ExecutionPolicy Bypass` 只作用于这次新启动的进程，不修改系统执行策略。使用前确认脚本来源并遵守现场要求。

程序依次提示：

1. **Atelier 根 URL**：输入现场实际地址，格式为 `https://<服务器或域名>:<端口>/api/atelier/`，可带网关前缀；不要在末尾追加 namespace，也不要照抄其它环境的地址。
2. **Namespace**：填写要读取对象所在的 namespace，单独输入。
3. **账号与密码**：在凭据输入框/提示中填写具备相应读取权限的现场账号，不把密码写入脚本、清单或命令明文。

<!-- local-atelier-example -->

HTTPS 使用 Windows 的证书信任，脚本不绕过证书校验；请求直接访问输入地址，不使用系统代理，也不跟随重定向。

清单较大时，可在第一次正式命令末尾加 `-MaxFilesPerRun 1`，先确认一个文件能落盘，再另开 PowerShell 用下面的恢复命令继续。

## 四、失败或只导出一部分，用 Resume

正式导出开始后，即使一个文件都没取到，也可能已经生成 `exported-code` 和恢复记录。**保留目录，在原命令末尾加 `-Resume`：**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\iris-code-export\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory .\exported-code -Resume
```

使用与首次一致的清单、脚本版本、Atelier 地址和 Namespace。脚本先核对已保存文件，再读取未完成项；不要为了恢复而删除恢复记录、修改摘要或覆盖已有源码。

如果要改清单、换环境或重新导出当前最新内容，选一个不存在的新输出目录，例如 `-OutputDirectory .\exported-code-2`，不要将旧快照强行当成新快照。

## 五、怎样确认完成

成功时终端显示 `state: complete`，`fetched` 等于此次清单的 total，`failed`、`missing`、`empty` 和 `pending` 均为 0。例如清单有 4 项，全部成功时 fetched 为 4。只看到目录生成不能证明全部导出完成。

结果在项目目录的 `exported-code\src\`。类 `Demo.Patient.cls` 保存为 `src\Demo\Patient.cls`，例程 `Demo.Tools.mac` 保存为 `src\routines\Demo.Tools.mac`，Web 文件保留虚拟路径的层级。代码以 UTF-8 保存，表示读取时实例返回的当前内容。

`baseline-state.json` 是恢复记录，保存输入、目标、脚本及内容摘要、时间与逐项结果，不保存连接明文、账号密码或 Cookie。不要手工编辑或删除；导出源码被修改后，Resume 会停止以保护修改。

| 退出码 / 状态 | 含义 |
|---|---|
| `0` / complete | 全部对象已取得，退出接口有回执 |
| `2` / partial | 部分完成，按 missing、empty、failed、pending 排查 |
| `1` | 输入、输出目录、连接参数或恢复核对受阻 |

## 六、这次现场遇到的问题，按这个顺序查

### 1. 找不到示例文件或脚本

先确认当前目录与第一节一致。项目目录里用 `-File .\iris-code-export\export-iris-code.ps1`；`-ListFile .\files.txt` 指向项目目录里的清单。直接写 `.\export-iris-code.ps1` 会去当前目录找脚本，因此找不到工具子目录中的文件。已编写好的 files.txt 不需要再复制示例。

### 2. 传输失败：atelier-transport-or-timeout

这个提示同时涵盖网络、超时和 HTTPS 传输异常，本身不能断定具体原因。**在实际运行导出的远程电脑**执行下面一整行，输入与导出相同的 Atelier URL：

```powershell
$probeUrl=Read-Host 'Atelier URL';$probeUri=[uri]$probeUrl;Test-NetConnection -ComputerName $probeUri.DnsSafeHost -Port $probeUri.Port
```

`TcpTestSucceeded: False` 时先排查现场路由、防火墙、地址和端口；True 只证明 TCP 端口连通，尚未证明 HTTPS、认证或文件读取成功。

接着在同一窗口执行下面一整行，查看 HTTPS 具体异常。该探测不携带账号密码：

```powershell
$r=[System.Net.HttpWebRequest]::Create($probeUrl);$r.Proxy=$null;$r.Timeout=15000;try{$s=$r.GetResponse();$s.StatusCode;$s.Close()}catch{$_.Exception.ToString()}
```

### 3. 提示 SSL/TLS 无法建立信任、远程证书无效

这是证书验证失败。先在同一台远程电脑的浏览器查看该地址的证书、颁发者、有效期和备用名称：

- 证书签给域名而不是当前 IP：使用证书覆盖且现场可解析的域名。
- 根/中间证书未受信任或证书链不完整：由现场管理员核实来源，再按现场规范补齐信任/证书链，确保运行脚本的账号可用。
- 证书过期：更新服务器证书。

不要仅凭端口连通就反复重试，也不要通过关闭证书校验掩盖错误。完成处理后重新执行 HTTPS 探测；如返回 401，按下一项判断。

### 4. 401 要区分出现位置

| 出现位置 | 含义与下一步 |
|---|---|
| 上面的匿名 HTTPS 探测返回 401 | 已收到 HTTP 认证响应；因为探测未带凭据，不能据此认定现场账号错误。使用正式导出命令输入凭据；原目录已有恢复记录时加 Resume |
| 正式导出显示 `reason: atelier-http-401` | 本次导出认证未通过，核对账号密码与 Atelier 认证配置 |
| 导出成功后只有 `logoutHttpStatus: 401` | 可能是退出后的认证挑战，结合 complete 和 fetched 判断，不能单凭这个状态认定导出失败 |

本次远程现场的排查顺序是：TCP 可达 → HTTPS 证书验证失败 → 安装受信任证书后匿名探测返回 401 → 用正式命令及凭据恢复导出。它是一次已观察到的案例，不代表所有 transport 错误都是证书问题。

### 5. 其它常见停止结果

| 提示 | 处理 |
|---|---|
| `output-directory-must-be-new-or-use-Resume` | 已有首次导出现场，用原参数加 Resume；另一次全新采集则换新目录 |
| `missing` / 404 | 核对 Namespace、对象全名与大小写，以及前端完整 Web 虚拟路径；未取得不等于应删除本地文件 |
| `empty` | 服务器返回空内容，单独核实，不能当成功 |
| `atelier-http-503` | 先由现场核实服务/容量状态，再决定恢复；脚本不自动重试 |
| `local-source-drift` 等摘要不匹配 | 已导出文件有变化，保留源码与恢复记录，先核实；不要手改摘要绕过 |
| 更换脚本后断点不匹配 | 用原脚本继续，或选择新目录重采；不要覆盖原现场 |

默认串行读取，间隔 200ms；不要和其它大批量操作并行运行。退出回执不等于实际 License 已回落。本工具只读取与保存源码，修改后如何带回、部署和验收按项目原有流程处理。

## 附：其它输入与结果保留

已有 ProjectItem 范围 XML 时，可把 `-ListFile .\files.txt` 换成 `-Baseline .\ProjectItem.xml`，不能同时传入。这里的 XML 只有范围，不是带有 Class/Routine 源码的完整导出 XML；XML 清单中的图片会在请求前排除并统计。

将所需源码带回本地编辑时，保留原始快照和恢复记录，不把现场私有代码或恢复资料放入公共仓库。需要新快照时另建输出目录。
