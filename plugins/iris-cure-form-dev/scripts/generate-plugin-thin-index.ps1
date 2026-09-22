param(
    [string]$PluginPath = ".agents/plugins/iris-cure-form-dev",
    [string]$ProjectRoot = ".",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun",
    [string[]]$ExcludeSkill = @(),
    [string[]]$ExcludeRule = @(),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$canonicalScript = Join-Path $PSScriptRoot '..\..\..\scripts\generate-plugin-thin-index.ps1'
if (-not (Test-Path -LiteralPath $canonicalScript)) {
    throw "Canonical thin-index generator was not found: $canonicalScript"
}

& $canonicalScript -PluginPath $PluginPath -ProjectRoot $ProjectRoot -Mode $Mode -ExcludeSkill $ExcludeSkill -ExcludeRule $ExcludeRule -Force:$Force
