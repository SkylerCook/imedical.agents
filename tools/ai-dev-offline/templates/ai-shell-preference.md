## Windows 命令执行

- 执行开发命令优先使用 `pwsh.exe -NoLogo -NoProfile`；批处理命令按需使用 `cmd.exe /d /c`。
- 新会话先核对本次部署的 `pwsh` 路径与版本。宿主默认 shell 不明确时，显式调用所选 `pwsh.exe`，不要仅按提示中的 shell 名称推断实际执行环境。
- Node、Python、Git 使用本次部署并验收的命令路径。版本或路径不符时报告具体冲突；保持现有医院运行时和安全设置。
