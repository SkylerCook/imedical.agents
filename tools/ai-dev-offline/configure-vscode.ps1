#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Plan','Apply','Rollback')][string]$Action = 'Plan',
    [string]$ToolsRoot,
    [string]$PwshExe,
    [string]$CodeExe,
    [ValidateSet('Portable','Installed')][string]$UserDataMode = 'Portable',
    [string]$SettingsFile,
    [string]$ReceiptFile,
    [switch]$ReplaceExisting,
    [switch]$Interactive
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'windows-only-vscode-user-settings' }
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Interactive) {
    $ToolsRoot = Read-Host 'Chosen tools root (example D:\Programs)'
    $choice = Read-Host 'VS Code user settings: 1=Portable; 2=Installed'
    if ($choice -eq '1') { $UserDataMode='Portable' } elseif ($choice -eq '2') { $UserDataMode='Installed' } else { throw 'choose-user-settings-mode-1-or-2' }
}
if ($ToolsRoot) {
    $manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $CodeExe) { $CodeExe = Join-Path $ToolsRoot ('VSCode/'+($manifest.components|Where-Object id -eq 'vscode').version+'/Code.exe') }
    if (-not $PwshExe) { $PwshExe = Join-Path $ToolsRoot ('PowerShell/'+($manifest.components|Where-Object id -eq 'powershell').version+'/pwsh.exe') }
}
if (-not $CodeExe) { throw 'selected-code-exe-required' }
$CodeExe = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CodeExe)
if (-not (Test-Path -LiteralPath $CodeExe -PathType Leaf) -or [IO.Path]::GetFileName($CodeExe) -ine 'Code.exe') { throw 'selected-code-exe-missing' }
if ($Action -ne 'Rollback') {
    if (-not $PwshExe) { throw 'selected-pwsh-exe-required' }
    $PwshExe = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PwshExe)
    if (-not (Test-Path -LiteralPath $PwshExe -PathType Leaf) -or [IO.Path]::GetFileName($PwshExe) -ine 'pwsh.exe') { throw 'selected-pwsh-exe-missing' }
    if (-not $SettingsFile) {
        if ($UserDataMode -eq 'Portable') { $SettingsFile = Join-Path (Split-Path -Parent $CodeExe) 'data/user-data/User/settings.json' }
        else { $SettingsFile = Join-Path $env:APPDATA 'Code/User/settings.json' }
    }
    $SettingsFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SettingsFile)
} elseif (-not $ReceiptFile) { throw 'settings-receipt-required' }
function Invoke-SettingsEditor([string[]]$Arguments) {
    $all = @((Join-Path $source 'configure-vscode.js')) + $Arguments
    foreach ($argument in $all) { if ($argument -match '["\r\n]') { throw 'invalid-settings-argument' } }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$CodeExe; $info.Arguments=(@($all|ForEach-Object{'"'+$_+'"'}) -join ' ')
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1'
    $process=New-Object Diagnostics.Process; $process.StartInfo=$info
    try {
        [void]$process.Start();$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(45000)){$process.Kill();throw 'settings-editor-timeout'}
        $text=$stdout.GetAwaiter().GetResult();$errorText=$stderr.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0){throw ('settings-editor: '+$errorText.Trim())}
        return ($text|ConvertFrom-Json)
    } finally {$process.Dispose()}
}
if ($Action -eq 'Rollback') {
    Invoke-SettingsEditor @('--action','rollback','--receipt',$ReceiptFile)
    return
}
$preview = Invoke-SettingsEditor @('--action','plan','--settings',$SettingsFile,'--pwsh',$PwshExe)
Write-Host ('User settings: '+$SettingsFile)
Write-Host ('Selected PowerShell: '+$PwshExe)
foreach($change in $preview.changes){Write-Host ($change.operation+': '+($change.path -join ' / '))}
if ($Action -eq 'Plan' -or $preview.state -eq 'unchanged') { $preview; return }
if (@($preview.conflicts).Count -gt 0 -and -not $ReplaceExisting) {
    if (-not $Interactive) { throw 'selected-terminal-keys-conflict: inspect Plan, then use -ReplaceExisting if intended' }
    if ((Read-Host 'Existing selected keys differ. Replace only the listed terminal keys? y/N') -ine 'y') { throw 'settings-conflict-not-approved' }
    $ReplaceExisting=$true
}
$arguments=@('--action','apply','--settings',$SettingsFile,'--pwsh',$PwshExe,'--expected-sha',$preview.sha256)
if($ReplaceExisting){$arguments+='--replace'}
$result=Invoke-SettingsEditor $arguments
$result
Write-Host 'VS Code user settings verified. Open a NEW terminal in the selected VS Code; existing terminals keep their shell.'
