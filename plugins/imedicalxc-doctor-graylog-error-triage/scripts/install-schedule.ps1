# Graylog 巡检计划任务：预览 / 注册 / 卸载
# 用法:
#   .\install-schedule.ps1 -Env 87 -DryRun     只打印将注册的定义，不改系统
#   .\install-schedule.ps1 -Env 87             注册为当前用户的计划任务
#   .\install-schedule.ps1 -Env 87 -Force      覆盖同名任务
#   .\install-schedule.ps1 -Env 87 -Uninstall  卸载
#   .\install-schedule.ps1 -Env 87 -UseS4U     未登录也运行（代价：无用户域凭据）
# 退出码: 0 成功 / 2 配置缺失 / 3 任务已存在（未加 -Force）
param(
  [Parameter(Mandatory = $true)][string]$Env,
  [switch]$DryRun,
  [switch]$Uninstall,
  [switch]$Force,
  [switch]$UseS4U
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$scripts    = $PSScriptRoot
$pluginRoot = Split-Path -Parent $scripts
$configFile = Join-Path $pluginRoot 'config\graylog-triage.json'
$runner     = Join-Path $scripts 'run-triage.ps1'

if (-not (Test-Path $configFile)) { Write-Host "[ERROR] 配置缺失: $configFile"; exit 2 }
if (-not (Test-Path $runner))     { Write-Host "[ERROR] 入口脚本缺失: $runner";   exit 2 }

$cfg = Get-Content -Path $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $cfg.environments.PSObject.Properties.Name.Contains($Env)) {
  Write-Host ('[ERROR] 配置中没有环境 {0}，可选: {1}' -f $Env, (($cfg.environments.PSObject.Properties.Name) -join ', '))
  exit 2
}

$sch       = $cfg.schedule
$taskName  = ([string]$sch.taskNameTemplate).Replace('{env}', $Env)
$interval  = [int]($sch.intervalMinutes)
$timeLimit = [int]($sch.executionTimeLimitMinutes)
$repoRoot  = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $pluginRoot))

Write-Host '──── 计划任务定义 ────'
Write-Host ('  任务名   : {0}' -f $taskName)
Write-Host ('  环境     : {0}' -f $Env)
Write-Host ('  入口     : {0}' -f $runner)
Write-Host ('  工作目录 : {0}' -f $repoRoot)
Write-Host ('  触发     : 每 {0} 分钟' -f $interval)
Write-Host ('  单次时限 : {0} 分钟' -f $timeLimit)
Write-Host ('  运行身份 : {0}\{1}（{2}）' -f $env:USERDOMAIN, $env:USERNAME, $(if ($UseS4U) { 'S4U，未登录也运行' } else { '仅登录时运行' }))
Write-Host ''

if ($Uninstall) {
  $exist = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $exist) { Write-Host ('[INFO] 任务不存在，无需卸载: ' + $taskName); exit 0 }
  if ($DryRun) { Write-Host ('[DRYRUN] 将卸载任务 ' + $taskName); exit 0 }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host ('[OK] 已卸载 ' + $taskName)
  exit 0
}

$exist = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($exist -and -not $Force) {
  Write-Host ('[SKIP] 任务已存在: ' + $taskName + '，如需覆盖请加 -Force')
  exit 3
}

$psExe   = (Get-Command powershell.exe -ErrorAction Stop).Source
$argLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Env {1}' -f $runner, $Env

$action = New-ScheduledTaskAction -Execute $psExe -Argument $argLine -WorkingDirectory $repoRoot

# 对齐到下一个 interval 整数倍时刻，避免触发点随注册时间漂移
$now     = Get-Date
$startAt = $now.Date.AddHours($now.Hour).AddMinutes([math]::Ceiling($now.Minute / $interval) * $interval)
if ($startAt -le $now) { $startAt = $startAt.AddMinutes($interval) }

$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Minutes $interval)

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes $timeLimit) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 1 `
  -RestartInterval (New-TimeSpan -Minutes 5)

$logonType = if ($UseS4U) { 'S4U' } else { 'Interactive' }
$principal = New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) -LogonType $logonType -RunLevel Limited
$desc      = '医生站 Graylog 报错巡检（环境 ' + $Env + '）'

if ($DryRun) {
  Write-Host '[DRYRUN] 不写入系统。将提交给 Register-ScheduledTask 的定义：'
  Write-Host ('  Action   : {0} {1}' -f $psExe, $argLine)
  Write-Host ('  Trigger  : StartAt={0:yyyy-MM-dd HH:mm} / 每 {1} 分钟' -f $startAt, $interval)
  Write-Host ('  Repeat   : {0}' -f $(if ($trigger.Repetition.Duration) { 'Duration=' + $trigger.Repetition.Duration } else { '无限期' }))
  Write-Host ('  Settings : 时限 {0} 分钟 / 错过补跑 / 电池下运行 / 单实例' -f $timeLimit)
  Write-Host ('  Principal: {0} / {1} / Limited' -f $principal.UserId, $logonType)
  exit 0
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $desc | Out-Null
Write-Host ('[OK] 已注册 ' + $taskName)

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ('     下次运行: {0}' -f $info.NextRunTime)
Write-Host ''
Write-Host '验证方式：'
Write-Host ('  Start-ScheduledTask -TaskName "{0}"' -f $taskName)
Write-Host ('  Get-ScheduledTaskInfo -TaskName "{0}"' -f $taskName)
Write-Host ('  日志目录: ' + (Join-Path $pluginRoot 'config\logs'))
exit 0