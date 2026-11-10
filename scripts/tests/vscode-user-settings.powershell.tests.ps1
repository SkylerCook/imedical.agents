#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CodeExe,
    [Parameter(Mandatory=$true)][string]$PwshExe,
    [Parameter(Mandatory=$true)][string]$WorkRoot
)
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../tools/ai-dev-offline/configure-vscode.ps1'))
$root=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($WorkRoot)
if(Test-Path -LiteralPath $root){throw 'integration-root-must-be-new'}
$probe=[IO.Path]::GetDirectoryName($root)
while($probe){if((Test-Path -LiteralPath $probe) -and ((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'linked-integration-parent'};$probe=[IO.Path]::GetDirectoryName($probe)}
$originalPath=[Environment]::GetEnvironmentVariable('Path','Process')
$machinePath=[Environment]::GetEnvironmentVariable('Path','Machine')
$realSettings=Join-Path $env:APPDATA 'Code/User/settings.json'
$realSettingsHash=$null
if(Test-Path -LiteralPath $realSettings){$realSettingsHash=(Get-FileHash -LiteralPath $realSettings -Algorithm SHA256).Hash}
try {
    [void][IO.Directory]::CreateDirectory($root)
    $hosts=@((Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'),$PwshExe)
    for($n=0;$n -lt $hosts.Count;$n++){
        $dir=Join-Path $root ('host-'+$n+'/User')
        [void][IO.Directory]::CreateDirectory($dir)
        $settings=Join-Path $dir 'settings.json'
        $original="{`r`n  // keep this comment`r`n  `"terminal.integrated.defaultProfile.windows`": `"Command Prompt`",`r`n  `"unrelated`": true,`r`n}`r`n"
        $utf8Bom=New-Object Text.UTF8Encoding($true)
        [IO.File]::WriteAllText($settings,$original,$utf8Bom)
        $before=(Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
        # Deliberately remove Node and every package path from the child environment.
        [Environment]::SetEnvironmentVariable('Path',(Join-Path $env:SystemRoot 'System32'),'Process')
        & $hosts[$n] -NoProfile -File $source -Action Plan -CodeExe $CodeExe -PwshExe $PwshExe -SettingsFile $settings | Out-Null
        if($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -ne $before){throw 'preview-must-be-read-only'}
        & $hosts[$n] -NoProfile -File $source -Action Apply -CodeExe $CodeExe -PwshExe $PwshExe -SettingsFile $settings -ReplaceExisting | Out-Null
        if($LASTEXITCODE -ne 0){throw 'wrapper-apply-failed'}
        $text=Get-Content -LiteralPath $settings -Raw -Encoding UTF8
        if(-not $text.Contains('// keep this comment') -or -not $text.Contains('"unrelated": true')){throw 'unrelated-settings-lost'}
        $receipts=@(Get-ChildItem -LiteralPath (Join-Path $dir '.ai-dev-settings-backups') -Recurse -Filter 'receipt.json' -File)
        if($receipts.Count -ne 1){throw 'expected-one-receipt'}
        & $hosts[$n] -NoProfile -File $source -Action Apply -CodeExe $CodeExe -PwshExe $PwshExe -SettingsFile $settings | Out-Null
        if($LASTEXITCODE -ne 0 -or @(Get-ChildItem -LiteralPath (Join-Path $dir '.ai-dev-settings-backups') -Recurse -Filter 'receipt.json' -File).Count -ne 1){throw 'wrapper-must-be-idempotent'}
        & $hosts[$n] -NoProfile -File $source -Action Rollback -CodeExe $CodeExe -ReceiptFile $receipts[0].FullName | Out-Null
        if($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -ne $before){throw 'wrapper-rollback-must-restore-bytes'}
        Write-Host ('Wrapper Plan/Apply/idempotence/Rollback passed without Node PATH: '+$hosts[$n])
    }
    if([Environment]::GetEnvironmentVariable('Path','Machine') -cne $machinePath){throw 'machine-path-changed'}
    if($realSettingsHash -and (Get-FileHash -LiteralPath $realSettings -Algorithm SHA256).Hash -ne $realSettingsHash){throw 'real-user-settings-changed'}
    Write-Host 'Real VS Code user settings and Machine PATH unchanged.'
} finally {
    [Environment]::SetEnvironmentVariable('Path',$originalPath,'Process')
    if(Test-Path -LiteralPath $root){
        if([IO.Path]::GetFullPath($root) -cne $root -or -not [IO.Path]::GetFileName($root).StartsWith('wrapper-tests-')){throw 'unsafe-integration-cleanup'}
        foreach($item in @((Get-Item -LiteralPath $root -Force))+@(Get-ChildItem -LiteralPath $root -Recurse -Force)){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'linked-integration-cleanup'}}
        Remove-Item -LiteralPath $root -Recurse -Force
        if(Test-Path -LiteralPath $root){throw 'integration-cleanup-failed'}
    }
}
