$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$pluginRoot = Join-Path $repoRoot "plugins/imedicalxc-doctor-perf-analysis-engineer"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Contains {
  param([string]$Content, [string]$Expected, [string]$Message)
  if (-not $Content.Contains($Expected)) {
    throw $Message
  }
}

function Assert-NotContains {
  param([string]$Content, [string]$Unexpected, [string]$Message)
  if ($Content.Contains($Unexpected)) {
    throw $Message
  }
}

$manifestPath = Join-Path $pluginRoot ".agents-plugin/plugin.json"
$agentsPath = Join-Path $pluginRoot "AGENTS.md"
$readmePath = Join-Path $pluginRoot "README.md"
$skillPath = Join-Path $pluginRoot "skills/imedicalxc-doctor-perf-analysis-engineer/SKILL.md"
$graylogPath = Join-Path $pluginRoot "skills/imedicalxc-doctor-perf-analysis-engineer/references/graylog-search.md"
$diagnosisPath = Join-Path $pluginRoot "skills/imedicalxc-doctor-perf-analysis-engineer/references/diagnosis-workflow.md"
$thinIndexScript = Join-Path $pluginRoot "scripts/generate-plugin-thin-index.ps1"

foreach ($path in @($manifestPath, $agentsPath, $readmePath, $skillPath, $graylogPath, $diagnosisPath, $thinIndexScript)) {
  Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "missing perf-analysis plugin file: $path"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-True ($manifest.name -eq "imedicalxc-doctor-perf-analysis-engineer") "perf-analysis manifest name should be stable"

$agentsContent = Get-Content -LiteralPath $agentsPath -Raw -Encoding UTF8
$readmeContent = Get-Content -LiteralPath $readmePath -Raw -Encoding UTF8
$skillContent = Get-Content -LiteralPath $skillPath -Raw -Encoding UTF8
$graylogContent = Get-Content -LiteralPath $graylogPath -Raw -Encoding UTF8
$diagnosisContent = Get-Content -LiteralPath $diagnosisPath -Raw -Encoding UTF8
$graylogContract = $agentsContent + $readmeContent + $skillContent + $graylogContent + $diagnosisContent

foreach ($content in @($agentsContent, $readmeContent, $skillContent, $graylogContent)) {
  Assert-Contains $content "HTTP" "Graylog owner documents should describe the authorized HTTP fallback consistently"
}
Assert-Contains $graylogContent "GRAYLOG_ACCESS_TOKEN" "Graylog HTTP examples should use a temporary environment variable"
Assert-Contains $graylogContent "{graylog-host}" "Graylog examples should use an anonymized host placeholder"
Assert-Contains $graylogContent "{trace-id}" "Graylog examples should use an anonymized trace placeholder"
Assert-NotContains $graylogContract ".claude" "Canonical perf-analysis content must not bind permissions to Claude Code"
Assert-NotContains $graylogContract "settings.json" "Canonical perf-analysis content must not instruct agents to edit runtime settings"
Assert-NotContains $graylogContract "AskUserQuestion" "Canonical perf-analysis content must not bind user confirmation to one tool"
Assert-NotContains $graylogContract "Credential Leakage" "Canonical perf-analysis content must not bind approval handling to one runtime classifier"
Assert-NotContains $graylogContent '${TOKEN}' "Graylog examples should not use an undeclared shell-specific token variable"
Assert-NotContains $graylogContent "0..6" "Graylog pagination must not use a fixed page count"
Assert-True (-not [regex]::IsMatch($graylogContent, '\b(?:\d{1,3}\.){3}\d{1,3}\b')) "Graylog reference must not contain literal IPv4 addresses"
Assert-True (-not [regex]::IsMatch($graylogContent, '\b\d{12,}\b')) "Graylog reference must not contain real-looking long identifiers"

$thinIndexOutput = & $thinIndexScript -PluginPath $pluginRoot -ProjectRoot $repoRoot -Mode DryRun | Out-String
Assert-Contains $thinIndexOutput "imedicalxc-doctor-perf-analysis-engineer/SKILL.md" "Perf-analysis thin-index should expose the main skill"
Assert-Contains $thinIndexOutput "excluded by parameter" "Perf-analysis thin-index should explicitly skip the init skill"
Assert-True (-not [regex]::IsMatch($thinIndexOutput, '(?ms)status\s*:\s*generated\s*\r?\n\s*target\s*:\s*[^\r\n]*imedicalxc-doctor-perf-analysis-engineer-init')) "Perf-analysis thin-index should not generate the init skill"

Write-Host "perf-analysis plugin tests passed"
