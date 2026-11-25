# Graylog 报错巡检一轮执行：采集 -> 分类 -> 前端穿透 -> 渲染 -> 推送
# 计划任务入口，也可手动执行；各阶段输出追加到 config\logs\triage-yyyyMMdd.log
# 退出码 0=正常（含主动跳过） 1=阶段失败 2=环境不可用 3=另一轮正在执行
# 用法: .\run-triage.ps1 -Env 87 [-McpConfig .mcp.json] [-SkipNotify] [-SkipCollect] [-Limit 200] [-NoLock]
param(
  [string]$Env = '',
  # 连接配置文件路径；传给 collect-errors.js --mcp-config。连接配在工作区 .mcp.json 时必须显式指定，
  # 否则采集回退到用户目录默认路径（~/.qoder-cn/shared_client/mcp.json）导致 missing-config。
  [string]$McpConfig = '',
  [int]$Limit = 0,
  [switch]$SkipCollect,
  [switch]$SkipNotify,
  [switch]$NoLock
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$scripts    = $PSScriptRoot
$pluginRoot = Split-Path -Parent $scripts
$configDir  = Join-Path $pluginRoot 'config'
$logDir     = Join-Path $configDir 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
# 锁按环境隔离：多环境各注册一个计划任务时不应互相阻塞
$lockSuffix = if ($Env) { '-' + $Env } else { '' }
# 日志同样按环境分文件：混写一份时只能靠日志里的「环境=X」行辨认，排查成本高
$logFile  = Join-Path $logDir ('triage-' + (Get-Date -Format 'yyyyMMdd') + $lockSuffix + '.log')
$lockFile = Join-Path $configDir ('.run' + $lockSuffix + '.lock')

function Write-Log {
  param([string]$Message)
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host '[ERROR] 未找到 node，请确认 Node.js 已安装并在 PATH 中'
  exit 2
}
$nodePath = $nodeCmd.Source

# ── 并发锁：内容为 "PID|ISO时间"，持锁进程已死则立即接管 ──
if (-not $NoLock) {
  if (Test-Path $lockFile) {
    $holderPid = 0
    try { $holderPid = [int]((Get-Content -Path $lockFile -Raw -Encoding UTF8).Split('|')[0]) } catch { $holderPid = 0 }
    $holderAlive = $false
    if ($holderPid -gt 0) { $holderAlive = $null -ne (Get-Process -Id $holderPid -ErrorAction SilentlyContinue) }
    $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
    if ($holderAlive -and $lockAge.TotalMinutes -lt 60) {
      Write-Log ('[SKIP] 上一轮仍在执行（PID {0}，锁龄 {1:N1} 分钟），本轮跳过' -f $holderPid, $lockAge.TotalMinutes)
      exit 3
    }
    Write-Log ('[WARN] 清理残留锁（持有 PID {0} 已退出，锁龄 {1:N1} 分钟）' -f $holderPid, $lockAge.TotalMinutes)
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  }
  Set-Content -Path $lockFile -Value ('{0}|{1}' -f $PID, (Get-Date -Format 'o')) -Encoding utf8
}

# 任何未捕获的终止错误都要释放锁，否则会挡住后续 60 分钟
trap {
  if (-not $NoLock -and (Test-Path $lockFile)) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
  Write-Host ('[FATAL] 未捕获异常：' + $_.Exception.Message)
  exit 1
}

function Invoke-Stage {
  param(
    [string]$Name,
    [string]$ScriptName,
    [string[]]$ScriptArgs
  )
  $scriptPath = Join-Path $scripts $ScriptName
  if (-not (Test-Path $scriptPath)) {
    Write-Log ('[FAIL] {0}：脚本缺失 {1}' -f $Name, $ScriptName)
    return 1
  }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Write-Log ('[STAGE] {0} 开始：{1} {2}' -f $Name, $ScriptName, ($ScriptArgs -join ' '))

  # node 写 stderr 时 PS5.1 会转成 NativeCommandError，Stop 会导致整轮中断
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $code = 0
  try {
    & $nodePath $scriptPath @ScriptArgs *>> $logFile
    $code = $LASTEXITCODE
  } catch {
    Write-Log ('[WARN] {0} 执行异常：{1}' -f $Name, $_.Exception.Message)
  } finally {
    $ErrorActionPreference = $prevEap
  }

  $sw.Stop()
  Write-Log ('[STAGE] {0} 结束：exit={1} 用时={2:N1}s' -f $Name, $code, $sw.Elapsed.TotalSeconds)
  if ($code -ne 0) {
    Write-Host ('[TAIL] {0} 最后 3 行（完整见日志）：' -f $ScriptName)
    Get-Content -Path $logFile -Tail 3 -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('       ' + $_) }
  }
  return $code
}

function Get-ReportRoot {
  # 采集/分类/渲染都以仓库根为基准（config-env.resolvePath），不是插件根
  $repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $pluginRoot))
  $base = Join-Path $repoRoot 'docs\agent-reports\graylog-triage'
  if ($Env) { return (Join-Path $base $Env) }
  return $base
}

function Find-NewestFile {
  param([string]$Root, [string]$Filter)
  if (-not (Test-Path $Root)) { return $null }
  return Get-ChildItem -Path $Root -Filter $Filter -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

$startedAll = Get-Date
Write-Log '════════ 巡检开始 ════════'
Write-Log ('node={0}  环境={1}  mcp-config={2}' -f $nodePath, $(if ($Env) { $Env } else { '<默认>' }), $(if ($McpConfig) { $McpConfig } else { '<默认>' }))

$commonArgs = @()
if ($Env) { $commonArgs += @('--env', $Env) }

$failed = $false
$rawFile = $null
$classifiedFile = $null

# ── 1. 采集 ──────────────────────────────────────────────
if ($SkipCollect) {
  $rawFile = Find-NewestFile -Root (Get-ReportRoot) -Filter 'raw-errors-*.json'
  if (-not $rawFile) {
    Write-Log '[FAIL] -SkipCollect 指定但找不到历史 raw-errors-*.json'
    $failed = $true
  } else {
    Write-Log ('[SKIP] 采集阶段跳过，复用 {0}' -f $rawFile.FullName)
  }
} else {
  $collectArgs = @($commonArgs)
  # --mcp-config 只对采集阶段有意义（其余阶段不读连接配置）
  if ($McpConfig) { $collectArgs += @('--mcp-config', $McpConfig) }
  if ($Limit -gt 0) { $collectArgs += @('--limit', "$Limit") }
  $code = Invoke-Stage -Name '采集' -ScriptName 'collect-errors.js' -ScriptArgs $collectArgs
  switch ($code) {
    0 { }
    1 { Write-Log '[WARN] 采集不完整（分页或去重异常），继续使用已落盘数据' }
    default {
      Write-Log ('[FAIL] 采集失败 exit={0}（2=配置/连接不可用）' -f $code)
      $failed = $true
    }
  }
  if (-not $failed) {
    $rawFile = Find-NewestFile -Root (Get-ReportRoot) -Filter 'raw-errors-*.json'
    if ($rawFile) { Write-Log ('[INFO] 原始采集文件：{0}' -f $rawFile.FullName) }
    else { Write-Log ('[WARN] 未发现 raw-errors-*.json（查找目录 {0}）' -f (Get-ReportRoot)) }
  }
}

# ── 2. 分类 ──────────────────────────────────────────────
if (-not $failed -and $rawFile) {
  $classifyArgs = @($commonArgs) + @('--file', $rawFile.FullName)
  $code = Invoke-Stage -Name '分类' -ScriptName 'classify-owner.js' -ScriptArgs $classifyArgs
  if ($code -ne 0) {
    Write-Log ('[FAIL] 分类失败 exit={0}' -f $code)
    $failed = $true
  } else {
    $classifiedFile = Find-NewestFile -Root $rawFile.DirectoryName -Filter 'classified-*.json'
    if ($classifiedFile) { Write-Log ('[INFO] 分类结果：{0}' -f $classifiedFile.FullName) }
    else { Write-Log '[FAIL] 分类未产出 classified-*.json'; $failed = $true }
  }
} elseif (-not $failed) {
  Write-Log '[SKIP] 无采集数据，后续阶段跳过'
}

# ── 3. 前端穿透（启发式，失败不阻断）─────────────────────
if (-not $failed -and $classifiedFile) {
  $penArgs = @($commonArgs) + @('--classified', $classifiedFile.FullName)
  $code = Invoke-Stage -Name '穿透' -ScriptName 'penetrate-frontend.js' -ScriptArgs $penArgs
  if ($code -ne 0) {
    Write-Log ('[WARN] 前端穿透失败 exit={0}，报告将缺少界面定位，继续渲染' -f $code)
  }
}

# ── 4. 渲染 ──────────────────────────────────────────────
if (-not $failed -and $classifiedFile) {
  $renderArgs = @($commonArgs) + @('--classified', $classifiedFile.FullName)
  $code = Invoke-Stage -Name '渲染' -ScriptName 'render-report.js' -ScriptArgs $renderArgs
  if ($code -ne 0) {
    Write-Log ('[FAIL] 渲染失败 exit={0}（1=输入非法或脱敏校验拦截）' -f $code)
    $failed = $true
  }
}

# ── 5. 推送（未配置仅告警）───────────────────────────────
if (-not $failed -and $classifiedFile) {
  if ($SkipNotify) {
    Write-Log '[SKIP] 推送阶段跳过（-SkipNotify）'
  } else {
    $pushArgs = @($commonArgs) + @('--classified', $classifiedFile.FullName)
    $code = Invoke-Stage -Name '推送' -ScriptName 'push-notify.js' -ScriptArgs $pushArgs
    switch ($code) {
      0 { }
      2 { Write-Log '[WARN] 推送未配置（缺 graylog-triage-push.json 或令牌），本轮不推送' }
      default { Write-Log ('[FAIL] 推送失败 exit={0}' -f $code); $failed = $true }
    }
  }
}

# ── 汇总 ─────────────────────────────────────────────────
if ($classifiedFile -and (Test-Path $classifiedFile.FullName)) {
  try {
    $payload = Get-Content -Path $classifiedFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $s = $payload.stats
    Write-Log ('[SUMMARY] 日志 {0} 条（报错 {1} / 慢请求 {2}）/ 簇 {3} 个：本组 {4}、基础设施 {5}、他组 {6} 组 {7} 簇、无关 {8}、待定 {9}' -f `
        $s.items, $s.errorItems, $s.slowItems, $s.clusters, $s.self, $s.infra, $s.externalGroups, $s.externalClusters, $s.unrelated, $s.unknown)
    Write-Log ('[SUMMARY] 严重度初判：P0 {0} 簇 / P1 {1} 簇；慢请求 {2} 簇（其中本组 {3}）' -f `
        $s.p0, $s.p1, $s.slowClusters, $s.selfSlow)
  } catch {
    Write-Log ('[WARN] 汇总解析失败：{0}' -f $_.Exception.Message)
  }
}

$elapsed = ((Get-Date) - $startedAll).TotalSeconds
if ($failed) {
  Write-Log ('════════ 巡检结束（有失败）总耗时 {0:N1}s ════════' -f $elapsed)
  $exitCode = 1
} else {
  Write-Log ('════════ 巡检结束（正常）总耗时 {0:N1}s ════════' -f $elapsed)
  $exitCode = 0
}

if (-not $NoLock -and (Test-Path $lockFile)) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }

# 清理过期运行日志（output.runLogKeepDays，默认 14 天）
$keepDays = 14
try {
  $cfgPath = Join-Path $configDir 'graylog-triage.json'
  if (Test-Path $cfgPath) {
    $c = Get-Content -Path $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($c.output -and $c.output.runLogKeepDays) { $keepDays = [int]$c.output.runLogKeepDays }
  }
} catch { }
if ($keepDays -gt 0) {
  Get-ChildItem -Path $logDir -Filter 'triage-*.log' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

exit $exitCode