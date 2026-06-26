param(
    [string]$PluginPath = ".agents/plugins/imedicalxc-doctor-extend-engineer",
    [string]$ProjectRoot = ".",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun",
    [string[]]$ExcludeSkill = @(),
    [string[]]$ExcludeRule = @(),
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$canonicalScript = Join-Path $PSScriptRoot "..\..\..\scripts\generate-plugin-thin-index.ps1"
$canonicalScript = [System.IO.Path]::GetFullPath($canonicalScript)

if (-not (Test-Path -LiteralPath $canonicalScript -PathType Leaf)) {
    Write-Error "Canonical thin-index script not found: $canonicalScript"
}

$invokeParams = @{
    PluginPath = $PluginPath
    ProjectRoot = $ProjectRoot
    Mode = $Mode
    ExcludeSkill = $ExcludeSkill
    ExcludeRule = $ExcludeRule
}
if ($Force) {
    $invokeParams.Force = $true
}

& $canonicalScript @invokeParams
