# AGENTS.md

## 适用范围

本文件只用于维护 `imedical.agents` 能力包仓库内置的 `iris-agentic-dev.exe` Windows x64 可执行文件。

不部署到业务项目 `.agents/`，不是业务项目的 Agent 入口。

## 前置条件

- PowerShell 或 Bash（curl 为系统标配）
- 网络可访问 `github.com`
- 当前工作目录为仓库根

## 更新流程

Agent 按以下 6 步自主完成版本检测、对比、下载和文档同步。已是最新版本时零操作退出。

---

### 步骤 1：检测本地版本

运行 `--version`，用正则提取 `x.y.z` 版本号。

````powershell
$exePath = "vendor\iris-agentic-dev\windows-x64\iris-agentic-dev.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "本地未找到 iris-agentic-dev.exe，将直接下载最新版本。"
    $localVersion = "0.0.0"
}
else {
    $versionOutput = & $exePath --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "无法执行 iris-agentic-dev.exe --version，退出码: $LASTEXITCODE"
        exit 1
    }
    $versionMatch = [regex]::Match($versionOutput, '(\d+\.\d+\.\d+)')
    if (-not $versionMatch.Success) {
        Write-Error "无法从版本输出中解析版本号，原始输出: $versionOutput"
        exit 1
    }
    $localVersion = $versionMatch.Groups[1].Value
    Write-Host "本地版本: iris-agentic-dev $localVersion"
}
````

**Bash**：

```bash
exe_path="vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe"
if [ ! -f "$exe_path" ]; then
    echo "本地未找到 iris-agentic-dev.exe，将直接下载最新版本。"
    local_version="0.0.0"
else
    version_output=$("$exe_path" --version 2>&1)
    local_version=$(echo "$version_output" | grep -oP '\d+\.\d+\.\d+')
    if [ -z "$local_version" ]; then
        echo "ERROR: 无法从版本输出中解析版本号，原始输出: $version_output"
        exit 1
    fi
    echo "本地版本: iris-agentic-dev $local_version"
fi
```

---

### 步骤 2：查询 GitHub 最新版本

**首选方案：`git ls-remote --tags`**（走 Git 协议，无需 API、无限流、在受限网络环境下比 HTTPS 更稳定）。

````powershell
# PowerShell
$tagOutput = git ls-remote --tags "https://github.com/intersystems-community/iris-agentic-dev.git" 2>$null
if (-not $tagOutput) {
    Write-Error "无法通过 git ls-remote 获取标签列表。检查网络或 Git 是否可用。"
    exit 1
}

# 提取稳定版本标签 vx.y.z（排除 -beta、-rc 等），取版本号最大者
$latestVersion = ($tagOutput -split "`n" `
    | ForEach-Object { if ($_ -match 'refs/tags/v(\d+\.\d+\.\d+)$') { $matches[1] } } `
    | Sort-Object { [version]$_ } -Descending `
    | Select-Object -First 1)

if (-not $latestVersion) {
    Write-Error "无法从 git 标签中解析版本号。"
    exit 1
}

$downloadUrl = "https://github.com/intersystems-community/iris-agentic-dev/releases/download/v$latestVersion/iris-agentic-dev-windows-x86_64.exe"

Write-Host "GitHub 最新版本: $latestVersion"
Write-Host "下载地址: $downloadUrl"
````

**Bash**：

```bash
# git ls-remote 走 Git 协议，在受限网络下比 HTTPS 更可靠
latest_version=$(git ls-remote --tags "https://github.com/intersystems-community/iris-agentic-dev.git" 2>/dev/null \
    | grep -oP 'refs/tags/v\K\d+\.\d+\.\d+$' \
    | sort -t. -k1,1n -k2,2n -k3,3n \
    | tail -1)

if [ -z "$latest_version" ]; then
    echo "ERROR: 无法通过 git ls-remote 获取标签列表。请尝试降级方案或访问 https://github.com/intersystems-community/iris-agentic-dev/releases/latest"
    exit 1
fi

download_url="https://github.com/intersystems-community/iris-agentic-dev/releases/download/v${latest_version}/iris-agentic-dev-windows-x86_64.exe"

echo "GitHub 最新版本: $latest_version"
echo "下载地址: $download_url"
```

**降级方案：curl 跟踪重定向**（`git ls-remote` 不可用时）。

````powershell
# Windows 10 1803+ 自带 curl.exe
$redirectUrl = curl.exe -sI -o $null -w "%{redirect_url}" "https://github.com/intersystems-community/iris-agentic-dev/releases/latest" 2>$null

if (-not $redirectUrl) {
    Write-Error "无法获取 GitHub 最新版本重定向地址。"
    exit 1
}

$latestVersion = $redirectUrl -replace '.*/tag/v', ''
if ($latestVersion -notmatch '^\d+\.\d+\.\d+') {
    Write-Error "无法从重定向地址解析版本号: $redirectUrl"
    exit 1
}

$downloadUrl = "https://github.com/intersystems-community/iris-agentic-dev/releases/download/v$latestVersion/iris-agentic-dev-windows-x86_64.exe"
````

**Bash 降级**：

```bash
redirect_url=$(curl -sI -o /dev/null -w "%{redirect_url}" "https://github.com/intersystems-community/iris-agentic-dev/releases/latest")
if [ -z "$redirect_url" ]; then
    echo "ERROR: 无法获取 GitHub 最新版本重定向地址。"
    exit 1
fi
latest_version=$(echo "$redirect_url" | sed 's|.*/tag/v||')
download_url="https://github.com/intersystems-community/iris-agentic-dev/releases/download/v${latest_version}/iris-agentic-dev-windows-x86_64.exe"
```

---

### 步骤 3：版本比较

````powershell
if ([version]$localVersion -ge [version]$latestVersion) {
    Write-Host "当前版本 $localVersion 已是最新 ($latestVersion)，无需更新。"
    exit 0
}

Write-Host "发现新版本: $localVersion -> $latestVersion，开始下载更新..."
````

**Bash**（逐段比较，无外部依赖）：

```bash
# 将 x.y.z 拆分为三段逐次比较
IFS='.' read -r l1 l2 l3 <<< "$local_version"
IFS='.' read -r r1 r2 r3 <<< "$latest_version"
need_update="no"
if [ "$l1" -lt "$r1" ] || { [ "$l1" -eq "$r1" ] && [ "$l2" -lt "$r2" ]; } || { [ "$l1" -eq "$r1" ] && [ "$l2" -eq "$r2" ] && [ "$l3" -lt "$r3" ]; }; then
    need_update="yes"
fi

if [ "$need_update" = "no" ]; then
    echo "当前版本 $local_version 已是最新 ($latest_version)，无需更新。"
    exit 0
fi

echo "发现新版本: $local_version -> $latest_version，开始下载更新..."
```

---

### 步骤 4：下载更新

先下载到临时目录，成功后再移动到目标路径，避免中断导致文件损坏。

````powershell
$tempFile = Join-Path $env:TEMP "iris-agentic-dev-windows-x86_64.exe"

try {
    Write-Host "正在下载..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -ErrorAction Stop

    Move-Item -Path $tempFile -Destination $exePath -Force
    Write-Host "下载完成，已覆盖 vendor\iris-agentic-dev\windows-x64\iris-agentic-dev.exe"
}
catch {
    if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
    Write-Error "下载失败: $_"
    exit 1
}
````

**Bash**：

```bash
temp_file="/tmp/iris-agentic-dev-windows-x86_64.exe"
echo "正在下载..."
curl -fL -o "$temp_file" "$download_url"
if [ $? -ne 0 ]; then
    echo "ERROR: 下载失败。检查网络连接后重试。"
    exit 1
fi
mv "$temp_file" "$exe_path"
echo "下载完成，已覆盖 $exe_path"
```

---

### 步骤 5：验证下载

重新执行 `--version`，确认输出的版本号与 GitHub 最新版本一致。

````powershell
$newVersionOutput = & $exePath --version 2>&1
$newVersionMatch = [regex]::Match($newVersionOutput, '(\d+\.\d+\.\d+)')

if (-not $newVersionMatch.Success -or $newVersionMatch.Groups[1].Value -ne $latestVersion) {
    Write-Error "下载后版本验证失败: 期望 $latestVersion，实际输出: $newVersionOutput"
    exit 1
}

Write-Host "验证通过: $newVersionOutput"
````

**Bash**：

```bash
new_version_output=$("$exe_path" --version 2>&1)
new_version=$(echo "$new_version_output" | grep -oP '\d+\.\d+\.\d+')
if [ "$new_version" != "$latest_version" ]; then
    echo "ERROR: 下载后版本验证失败: 期望 $latest_version，实际输出: $new_version_output"
    exit 1
fi
echo "验证通过: $new_version_output"
```

---

### 步骤 6：同步版本号到 README

更新两处文件中的版本号：

1. **`vendor/iris-agentic-dev/README.md`**：
   - `当前版本：**0.6.20**` → 替换为 `当前版本：**{new_version}**`
   - 下载 URL 中 `v0.6.20` → `v{new_version}`

2. **根 `README.md`**（`coding-iris-plugin` 段落）：
   - `（当前 **v0.6.20**）` → 替换为 `（当前 **v{new_version}**）`

使用文本替换完成，不引入额外脚本。

---

## 停止条件

以下情况应停止并向用户报告：

| 情况 | 处理方式 |
|------|----------|
| `git ls-remote` 和降级方案均失败 | 报告网络错误，提供 Release 页面 URL 供手工检查 |
| 标签列表无法解析出版本号 | 报告原始标签输出，请用户确认标签格式是否变更 |
| `--version` 输出格式异常 | 报告原始输出，请用户确认版本输出格式是否变更 |
| 下载网络失败 | 报告网络错误，清理临时文件 |
| 下载后版本验证失败 | 报告版本不匹配，保留文件供排查 |

## 验收标准

- `vendor\iris-agentic-dev\windows-x64\iris-agentic-dev.exe --version` 输出与 GitHub 最新 Release 一致
- `vendor/iris-agentic-dev/README.md` 中 `当前版本` 与下载 URL 版本号一致
- 根 `README.md` 中 `iris-agentic-dev` 版本引用已同步
