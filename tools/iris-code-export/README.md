# IRIS 内网源码导出工具

给人工使用的独立工具。将整个目录压缩带入项目现场，解压后运行即可。**不需要 AI、框架技能、`.agents`、Node.js、Git 或 MCP，也不下载任何依赖。**

需要 Windows PowerShell 5.1 或 Windows 上的 PowerShell 7；电脑能够访问目标 IRIS 的内网 Atelier 接口，账号有读取相应对象的权限。

压缩包只有三个文件：

```text
README.md                  使用说明
export-iris-code.ps1       源码导出脚本
files.example.txt         UTF-8 清单示例
```

## 1. 编写要导出的文件清单

复制 `files.example.txt` 为 `files.txt`，用记事本修改并保存为 UTF-8。每行一个准确对象，可以混写前后端：

```text
# 后端：IRIS 对象全名＋扩展名，不写磁盘目录
Demo.Patient.cls
Demo.Tools.mac
Demo.Constants.inc
Demo.Generated.int

# 前端：以 / 开头的完整 Web 虚拟路径
/webapp/csp/patient.csp
/webapp/scripts/patient.js
/webapp/css/patient.css
```

**`webapp` 是占位示例，不是固定前缀。** 请替换为现场实际的完整 Web 应用路径。脚本不会自动补前缀，也不能根据本地工程目录推断服务器路径。例如，假设现场前缀为 `/example/web`，则应写 `/example/web/scripts/patient.js`；不要照抄示例去访问不存在的文件。

用户指定的项目示例（`files.example.txt` 已使用此清单）：

```text
DHCDoc.Util.RegisteredObject.cls
/imedical/web/scripts/udhcfavitem.edit.newshow.js
/imedical/web/csp/chemo.aform.main.csp
```

这里的前端前缀是 `/imedical/web`，属于该项目，不是脚本固定值；其它项目应替换为自己的完整路径。后端类名同样按目标实例实际对象填写。

格式约束：

- 后端支持 `.cls/.mac/.inc/.int`；类名的点号表示包，必须写扩展名。
- 前端支持 `.csp/.csr/.js/.css/.html/.htm`；必须以 `/` 开头，填写服务器虚拟路径。
- 空行、整行 `#` 注释、UTF-8 BOM 可以使用；不支持行尾注释。
- 不接受通配符、整个目录、磁盘路径、缺扩展名、相对前端路径或图片。
- 按服务器原名称保留大小写；重复对象、目录穿越、Windows 保留文件名和落盘冲突会报错停止。

## 2. 在脚本目录打开 PowerShell

先运行计划，核对格式与导出范围。此步骤不联网、不创建输出目录：

```powershell
.\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot -PlanOnly
```

确认后执行导出。第一次建议只取一个文件：

```powershell
.\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot -MaxFilesPerRun 1
```

程序会依次提示输入：

1. Atelier 根 URL：服务器已启用的 Atelier 应用地址，以 `/api/atelier/` 结尾；允许带网关前缀。
2. Namespace：要导出对象所在的 namespace。
3. 账号与密码：使用凭据输入框/提示，密码不会写入脚本或结果文件。

<!-- local-atelier-example -->

这些信息由现场管理员提供。不要把密码写入清单、脚本、说明或命令明文。HTTPS 使用系统证书校验；私有 CA 应通过现场原有流程配置信任，不跳过证书校验。脚本直接访问输入的地址，禁用代理及重定向。

输出目录必须是一个不存在的新目录；父目录可由脚本创建。不能直接覆盖已有工程目录。确认文件已正确保存后，另开一个 PowerShell，使用同样清单与连接信息继续：

```powershell
.\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot -Resume
```

也可以从一开始完整执行，不传 `-MaxFilesPerRun`：

```powershell
.\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot
```

若系统执行策略阻止运行，可在确认脚本来源、符合现场策略后，使用仅作用于本次进程的方式；无需修改系统策略：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot
```

已有 ProjectItem 范围 XML 时，可将 `-ListFile .\files.txt` 换成 `-Baseline .\ProjectItem.xml`。两种输入不能同时指定；这里的 XML 只有对象清单，不是包含 Class/Routine 源码的完整导出 XML。XML 清单中的图片会在请求前排除并单独统计。

## 3. 查看导出结果

| 清单内容 | 输出目录中的路径 |
|---|---|
| `Demo.Patient.cls` | `src/Demo/Patient.cls` |
| `Demo.Tools.mac` | `src/routines/Demo.Tools.mac` |
| `/webapp/scripts/patient.js` | `src/webapp/scripts/patient.js` |

代码保存为 UTF-8，内容来自目标实例读取时的当前状态。可将所需源码带回本地编辑。不要把从现场取得的私有代码或恢复信息放入公共仓库。

`baseline-state.json` 保存清单、目标、脚本及文件摘要、逐项结果和观察时间，用于恢复；不保存连接明文、账号密码或 Cookie。它不能删除或手工修改。`-Resume` 会验证已有文件，只重取未取得的项；已导出文件被修改后会停止，保护本地修改。需要导出较新的服务器内容时，使用新输出目录重新导出，不把旧快照当成当前状态。

程序退出码：

| 退出码 | 含义 |
|---|---|
| `0` | 全部对象已取得，退出接口收到回执 |
| `2` | 部分完成；检查逐项 missing、empty、failed 或 pending |
| `1` | 输入、输出目录、连接参数或恢复核对受阻 |

默认串行读取、间隔 200ms，不自动重试。404 表示缺失；空内容单独记录；503、认证、网络或响应异常会停止后续读取，保留成功文件。遇到服务器容量问题应先由现场核实，不要反复重跑。

脚本结束时只退出自己使用的会话，退出后可能收到 401 认证挑战；此状态会单独记录。退出回执不等于实际 License 已回落。不要和其它大批量操作并行运行；本工具只协调同一 Windows 登录会话内自身的同目标/同目录导出，不控制 IDE 或其它客户端。

更换脚本版本后，原断点会因脚本摘要变化而停止。保留旧脚本与现场继续恢复，或另建目录重新采集；不要修改摘要来强制通过。强制杀进程后如遗留临时文件，应先核对现场，不删除已导出的源码或恢复文件。

本工具只读取和保存源码，不上传、不编译、不执行业务方法，也不自动提交 Git。修改后的代码如何带回、部署和验收，由项目原有流程处理。
