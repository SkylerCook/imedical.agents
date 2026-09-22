param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$AgentsRoot = ".agents",
  [ValidateSet("DryRun", "Write")][string]$Mode = "DryRun"
)
$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "iris-tools/sftp-config.js") $ProjectRoot $AgentsRoot $Mode
exit $LASTEXITCODE
