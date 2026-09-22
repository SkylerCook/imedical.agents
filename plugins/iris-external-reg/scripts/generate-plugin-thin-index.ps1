param(
    [string]$PluginPath = ".agents/plugins/iris-external-reg",
    [string]$ProjectRoot = ".",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun",
    [string[]]$ExcludeSkill = @(),
    [string[]]$ExcludeRule = @(),
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$canonicalScript = Join-Path $PSScriptRoot "..\..\..\scripts\generate-plugin-thin-index.ps1"
if (-not (Test-Path -LiteralPath $canonicalScript -PathType Leaf)) {
    Write-Error "Canonical thin-index script not found: $canonicalScript"
}

& $canonicalScript -PluginPath $PluginPath -ProjectRoot $ProjectRoot -Mode $Mode -ExcludeSkill $ExcludeSkill -ExcludeRule $ExcludeRule -Force:$Force
