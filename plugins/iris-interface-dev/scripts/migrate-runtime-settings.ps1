param([string]$ProjectRoot='.', [string]$AgentsRoot='.agents', [ValidateSet('Write','DryRun')][string]$Mode='DryRun')
$plugin = Split-Path (Split-Path $PSScriptRoot -Parent) -Leaf
& node (Join-Path $PSScriptRoot '../../../scripts/plugin-settings.js') $Mode $plugin $ProjectRoot
exit $LASTEXITCODE
