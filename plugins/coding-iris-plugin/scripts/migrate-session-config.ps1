param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$AgentsRoot = ".agents",
  [ValidateSet("DryRun", "Write", "Check", "Rollback")][string]$Mode = "DryRun"
)
$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "iris-tools/session-migration.js") --project-root $ProjectRoot --mode $Mode
if ($LASTEXITCODE -ne 0) { throw "IRIS session migration requires review." }
