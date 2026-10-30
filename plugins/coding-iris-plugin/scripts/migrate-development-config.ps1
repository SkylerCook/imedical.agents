param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$AgentsRoot = ".agents",
  [ValidateSet("DryRun", "Write")][string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"
$projectRootFull = [System.IO.Path]::GetFullPath($ProjectRoot)
$contextRoot = if ([System.IO.Path]::IsPathRooted($AgentsRoot)) {
  [System.IO.Path]::GetFullPath($AgentsRoot)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $projectRootFull $AgentsRoot))
}
$core = Join-Path $PSScriptRoot "iris-tools/development-config.js"
& node $core --project-root $projectRootFull --context-root $contextRoot --mode $Mode
if ($LASTEXITCODE -ne 0) { throw "Development config migration failed: $LASTEXITCODE" }
