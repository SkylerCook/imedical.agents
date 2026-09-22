param(
  [string]$ProjectRoot = ".",
  [string]$AgentsRoot = ".agents",
  [ValidateSet("DryRun", "Write")]
  [string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"
$projectRootFull = [System.IO.Path]::GetFullPath($ProjectRoot)
$agentsRootFull = if ([System.IO.Path]::IsPathRooted($AgentsRoot)) {
  [System.IO.Path]::GetFullPath($AgentsRoot)
}
else {
  [System.IO.Path]::GetFullPath((Join-Path $projectRootFull $AgentsRoot))
}
$profilePath = Join-Path $agentsRootFull "config/iris_interface_profile.md"
$target = ".agents/config/iris_interface_profile.md"

function Write-MigrationResult {
  param([string]$Status, [string]$Reason)
  [PSCustomObject]@{
    status = $Status
    target = $target
    reason = $Reason
  } | ConvertTo-Json -Compress
}

if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
  Write-MigrationResult -Status "config-migration-unchanged" -Reason "profile is absent; init uses the current template"
  exit 0
}

$bytes = [System.IO.File]::ReadAllBytes($profilePath)
$hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
$utf8 = New-Object System.Text.UTF8Encoding($hasUtf8Bom, $true)
$text = $utf8.GetString($bytes).TrimStart([char]0xFEFF)
$pattern = '(?m)^(?<prefix>\s*-\s*outputRoot\s*:\s*)docs/output/iris-interface\s*$'

if (-not [System.Text.RegularExpressions.Regex]::IsMatch($text, $pattern)) {
  Write-MigrationResult -Status "config-migration-unchanged" -Reason "legacy outputRoot is not present"
  exit 0
}

$updated = [System.Text.RegularExpressions.Regex]::Replace($text, $pattern, '${prefix}docs/interface', 1)
if ($Mode -eq "Write") {
  [System.IO.File]::WriteAllText($profilePath, $updated, $utf8)
  Write-MigrationResult -Status "config-migration-applied" -Reason "migrated the legacy default outputRoot to docs/interface"
}
else {
  Write-MigrationResult -Status "config-migration-planned" -Reason "legacy default outputRoot will migrate to docs/interface"
}
