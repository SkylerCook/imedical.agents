param(
    [string]$PluginPath = ".agents/plugins/iris-imedical-doctor-ai",
    [string]$ProjectRoot = ".",
    [string]$ContextRoot = "",
    [string]$CapabilityRoot = "",
    [ValidateSet("DryRun", "Write")][string]$Mode = "DryRun",
    [string[]]$ExcludeSkill = @(),
    [string[]]$ExcludeRule = @(),
    [switch]$Force
)
$ErrorActionPreference = "Stop"
$canonicalScript = Join-Path $PSScriptRoot "../../../scripts/generate-plugin-thin-index.ps1"
& $canonicalScript -PluginPath $PluginPath -ProjectRoot $ProjectRoot -ContextRoot $ContextRoot -CapabilityRoot $CapabilityRoot -Mode $Mode -ExcludeSkill $ExcludeSkill -ExcludeRule $ExcludeRule -Force:$Force
