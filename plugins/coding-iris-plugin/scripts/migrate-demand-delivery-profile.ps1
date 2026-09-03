param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$AgentsRoot = ".agents",
  [ValidateSet("DryRun", "Write")][string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"
$projectRootFull = [System.IO.Path]::GetFullPath($ProjectRoot)
$agentsRootFull = if ([System.IO.Path]::IsPathRooted($AgentsRoot)) { [System.IO.Path]::GetFullPath($AgentsRoot) } else { [System.IO.Path]::GetFullPath((Join-Path $projectRootFull $AgentsRoot)) }
$profilePath = Join-Path $agentsRootFull "config/iris_project_profile.md"
$contextProfilePath = Join-Path $agentsRootFull "config/project_context_profile.md"
$agentsPath = Join-Path $projectRootFull "AGENTS.md"
$results = New-Object System.Collections.Generic.List[object]
$prompt = "默认需求交付类型仍为 TODO，请确认该工程默认处理 standard（标版）还是 project（项目）需求。"

function Add-Result {
  param([string]$Status, [string]$Reason)
  $results.Add([PSCustomObject]@{
    status = $Status
    target = ".agents/config/iris_project_profile.md"
    reason = $Reason
  })
}

function Read-Utf8Text {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return "" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
}

function Get-ExistingType {
  param([string]$Text)
  $match = [regex]::Match($Text, '(?m)^\s*-\s*默认需求交付类型\s*[：:]\s*(?<value>[^\r\n]+)')
  if ($match.Success) { return $match.Groups['value'].Value.Trim() }
  return $null
}

function Get-ProfileEvidence {
  param([string]$Text, [string[]]$Fields)
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  $lines = $Text -split "`r?`n"
  $escaped = @($Fields | ForEach-Object { [regex]::Escape($_) }) -join '|'
  $selected = @($lines | Where-Object { $_ -match ("^\s*-\s*(" + $escaped + ")\s*[：:]") })
  return ($selected -join "`n")
}

function Get-AgentsProjectIntro {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  $match = [regex]::Match($Text, '(?ms)^##\s+项目简介\s*$\s*(?<body>.*?)(?=^##\s|\z)')
  if ($match.Success) { return $match.Groups['body'].Value.Trim() }
  return ""
}

function Set-DeliveryType {
  param([string]$Text, [string]$Value)
  $line = "- 默认需求交付类型：$Value"
  $pattern = '(?m)^\s*-\s*默认需求交付类型\s*[：:]\s*[^\r\n]+'
  if ([regex]::IsMatch($Text, $pattern)) {
    return [regex]::Replace($Text, $pattern, $line, 1)
  }
  $header = [regex]::Match($Text, '(?m)^##\s+通用配置\s*$')
  if ($header.Success) {
    $insertAt = $header.Index + $header.Length
    return $Text.Substring(0, $insertAt) + [Environment]::NewLine + [Environment]::NewLine + $line + $Text.Substring($insertAt)
  }
  return $Text.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + "## 通用配置" + [Environment]::NewLine + [Environment]::NewLine + $line + [Environment]::NewLine
}

if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
  Add-Result -Status "config-migration-review-required" -Reason "iris_project_profile.md 缺失；$prompt"
  Write-Output (ConvertTo-Json @($results | ForEach-Object { $_ }) -Depth 4 -Compress)
  exit 0
}

$profileText = Read-Utf8Text -Path $profilePath
$existing = Get-ExistingType -Text $profileText
if ($existing -in @('standard', 'project')) {
  Add-Result -Status "config-migration-unchanged" -Reason "默认需求交付类型已明确为 $existing"
  Write-Output (ConvertTo-Json @($results | ForEach-Object { $_ }) -Depth 4 -Compress)
  exit 0
}
if ($existing -and $existing -notmatch '^TODO(?:$|\s|[（(])') {
  Add-Result -Status "config-migration-review-required" -Reason "不支持的默认需求交付类型 '$existing'；请改为 standard、project 或 TODO"
  Write-Output (ConvertTo-Json @($results | ForEach-Object { $_ }) -Depth 4 -Compress)
  exit 0
}

$evidence = @(
  Get-ProfileEvidence -Text $profileText -Fields @('工程类型')
  Get-ProfileEvidence -Text (Read-Utf8Text -Path $contextProfilePath) -Fields @('项目用途')
  Get-AgentsProjectIntro -Text (Read-Utf8Text -Path $agentsPath)
) -join "`n"
$hasStandard = $evidence -match '(标版|标准版|通用产品|通用多产品|多产品\s*HIS\s*组合工程)'
$hasProject = $evidence -match '(医院需求|医院项目|客户定制|项目版|项目实施)'
$resolved = if ($hasStandard -and -not $hasProject) { 'standard' } elseif ($hasProject -and -not $hasStandard) { 'project' } else { 'TODO' }
$newText = Set-DeliveryType -Text $profileText -Value $resolved

if ($Mode -eq 'Write' -and $newText -ne $profileText) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($profilePath, $newText, $utf8NoBom)
}

if ($resolved -eq 'TODO') {
  Add-Result -Status "config-migration-review-required" -Reason $prompt
} elseif ($newText -eq $profileText) {
  Add-Result -Status "config-migration-unchanged" -Reason "已根据明确项目上下文设置为 $resolved"
} elseif ($Mode -eq 'Write') {
  Add-Result -Status "config-migration-applied" -Reason "已根据明确项目上下文设置默认需求交付类型为 $resolved"
} else {
  Add-Result -Status "config-migration-planned" -Reason "将根据明确项目上下文设置默认需求交付类型为 $resolved"
}

Write-Output (ConvertTo-Json @($results | ForEach-Object { $_ }) -Depth 4 -Compress)
