#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Plan','Apply','Verify','Rollback')][string]$Action = 'Plan',
    [ValidateSet('Blank','Supplement')][string]$Mode = 'Supplement',
    [string]$Root,
    [string[]]$Components,
    [ValidateSet('Machine','User','Process')][string]$Scope = 'Machine',
    [string]$ReceiptFile,
    [hashtable]$ExecutablePaths,
    [switch]$Interactive
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:OS -ne 'Windows_NT') { throw 'windows-only-environment-configurator' }
if ($Interactive) {
    $choice = Read-Host 'Mode: 1=Blank (selected tools absent, confirmed by you); 2=Supplement'
    if ($choice -eq '1') { $Mode = 'Blank' } elseif ($choice -eq '2') { $Mode = 'Supplement' } else { throw 'choose-mode-1-or-2' }
    $Root = Read-Host 'Chosen tools root (example D:\Programs)'
    $Components = @(Read-Host 'Selected components, comma separated: node,python,git,powershell')
}
function Assert-NoLink([string]$Path) {
    $p = [IO.Path]::GetFullPath($Path)
    while ($p) {
        if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'linked-environment-path' }
        $p = [IO.Path]::GetDirectoryName($p)
    }
}
function Read-PathState {
    if ($Scope -eq 'Process') { return [pscustomobject]@{value=[Environment]::GetEnvironmentVariable('Path','Process');kind='String'} }
    $key = if ($Scope -eq 'User') { [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment') } else { [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment') }
    if (-not $key -or $null -eq $key.GetValue('Path')) { if ($key) { $key.Dispose() }; return [pscustomobject]@{value=$null;kind='ExpandString'} }
    try { return [pscustomobject]@{value=$key.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=[string]$key.GetValueKind('Path')} }
    finally { $key.Dispose() }
}
function Write-PathState($State) {
    if ($Scope -eq 'Process') { [Environment]::SetEnvironmentVariable('Path',$State.value,'Process'); return }
    $key = if ($Scope -eq 'User') { [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') } else { [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment',$true) }
    try { if ($null -eq $State.value) { $key.DeleteValue('Path',$false) } else { $key.SetValue('Path',[string]$State.value,[Microsoft.Win32.RegistryValueKind]$State.kind) } }
    finally { $key.Dispose() }
}
function Read-JavaHome {
    return [Environment]::GetEnvironmentVariable('JAVA_HOME',$Scope)
}
function Write-JavaHome($Value) {
    [Environment]::SetEnvironmentVariable('JAVA_HOME',$Value,$Scope)
}
function Require-Admin {
    if ($Scope -eq 'Machine') {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        try { $principal = New-Object Security.Principal.WindowsPrincipal($identity); if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'requires-administrator: reopen the chosen entry as administrator, or explicitly choose -Scope Process' } }
        finally { $identity.Dispose() }
    }
}
function Save-Receipt($Data,[string]$File) {
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($File,($Data | ConvertTo-Json -Depth 8),$utf8)
}
function Notify-EnvironmentChange {
    if ($Scope -ne 'Process') {
        if (-not ('AiDevEnvironment.Native' -as [type])) {
            Add-Type -TypeDefinition 'namespace AiDevEnvironment { public static class Native { [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode, SetLastError=true)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr h, uint m, System.UIntPtr w, string l, uint f, uint t, out System.UIntPtr r); } }'
        }
        $result = [UIntPtr]::Zero
        [void][AiDevEnvironment.Native]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,3000,[ref]$result)
    }
}
$environmentLock = $null
$environmentLocked = $false
try {
if ($Scope -ne 'Process' -and $Action -in @('Apply','Rollback')) {
    $lockName = 'Local\AiDevEnvironment-' + $Scope
    if ($Scope -eq 'User') { $lockName += '-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
    $environmentLock = New-Object Threading.Mutex($false,$lockName)
    try { $environmentLocked = $environmentLock.WaitOne(0) } catch [Threading.AbandonedMutexException] { $environmentLocked = $true }
    if (-not $environmentLocked) { throw 'environment-update-in-progress: retry after the other operation finishes' }
}
if ($Action -eq 'Rollback') {
    if (-not $ReceiptFile) { throw 'receipt-file-required' }
    Assert-NoLink $ReceiptFile
    $receipt = Get-Content -LiteralPath $ReceiptFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.schema -ne 1 -or $receipt.tool -ne 'ai-dev-path' -or $receipt.scope -notin @('Machine','User','Process') -or $receipt.state -ne 'applied') { throw 'invalid-environment-receipt' }
    if ($receipt.scope -ne $Scope) { throw 'receipt-scope-mismatch' }
    Require-Admin
    $now = Read-PathState
    if ($now.value -cne $receipt.after.value -or $now.kind -ne $receipt.after.kind) { throw 'path-changed-since-apply: preserve later edits; inspect receipt before manual merge' }
    if ($receipt.PSObject.Properties['javaChanged'] -and $receipt.javaChanged) {
        if ((Read-JavaHome) -cne $receipt.javaAfter) { throw 'JAVA_HOME-changed-since-apply' }
        Write-JavaHome $receipt.javaBefore
    }
    Write-PathState $receipt.before
    $restored = Read-PathState
    if ($restored.value -cne $receipt.before.value -or $restored.kind -ne $receipt.before.kind) { throw 'rollback-readback-failed' }
    $receipt.state = 'rolled-back'; Save-Receipt $receipt $ReceiptFile
    Notify-EnvironmentChange
    Write-Host 'PATH restored. Reopen terminals and VS Code.'
    return
}
if (-not $Root) { throw 'chosen-tools-root-required' }
$Components = @($Components | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | Select-Object -Unique)
if ($Components.Count -eq 0) { throw 'selected-components-required' }
foreach ($id in $Components) { if ($id -notin @('node','python','git','powershell','java8','vscode')) { throw "unsupported-selected-component: $id" } }
$rootPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Root)
if ($rootPath -match '[;\r\n]') { throw 'root-cannot-contain-path-separators-or-newlines' }
Assert-NoLink $rootPath
if (-not (Test-Path -LiteralPath $rootPath -PathType Container)) { throw 'chosen-tools-root-missing' }
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$tools = @()
foreach ($id in $Components) {
    $component = @($manifest.components | Where-Object { $_.id -eq $id })
    if ($component.Count -ne 1 -or $component[0].version -notmatch '^[a-zA-Z0-9.+-]+$') { throw 'invalid-component-mapping' }
    $version = $component[0].version
    switch ($id) {
        node { $relative = "Node/$version/node-v$version-win-x64/node.exe"; $command = 'node -v' }
        python { $relative = "Python/$version/python.exe"; $command = 'python --version' }
        git { $relative = "Git/$version/cmd/git.exe"; $command = 'git --version' }
        java8 { $relative = "Java/$version/jdk$version/bin/java.exe"; $command = 'java -version' }
        vscode { $relative = "VSCode/$version/Code.exe"; $command = 'code --version' }
        powershell { $relative = "PowerShell/$version/pwsh.exe"; $command = 'pwsh --version' }
    }
    $exe = [IO.Path]::GetFullPath((Join-Path $rootPath $relative))
    $custom = $ExecutablePaths -and $ExecutablePaths.ContainsKey($id)
    if ($custom) { $exe = [IO.Path]::GetFullPath($ExecutablePaths[$id]) }
    Assert-NoLink $exe
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "selected-executable-missing: $id; expected $exe" }
    $tools += [pscustomobject]@{id=$id;version=$version;custom=$custom;exe=$exe;directory=$(if($id -eq 'vscode'){Join-Path ([IO.Path]::GetDirectoryName($exe)) 'bin'}else{[IO.Path]::GetDirectoryName($exe)});command=$command}
}
$javaChanged = 'java8' -in $Components
$javaBefore = Read-JavaHome
$javaAfter = $javaBefore
if ($javaChanged) { $javaAfter = Split-Path -Parent (Split-Path -Parent ($tools | Where-Object id -eq 'java8').exe) }
$before = Read-PathState
$parts = New-Object 'System.Collections.Generic.List[string]'
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$commandDirectories = @($tools.directory)
foreach ($tool in $tools) {
    if ($tool.id -eq 'python') {
        $scripts = Join-Path $tool.directory 'Scripts'
        if (Test-Path -LiteralPath $scripts -PathType Container) { Assert-NoLink $scripts; $commandDirectories += $scripts }
    }
}
foreach ($item in $commandDirectories + @(([string]$before.value) -split ';')) {
    if (-not $item) { continue }
    $key = $item.Trim().Trim('"').TrimEnd('\','/')
    if ($seen.Add($key)) { $parts.Add($item) }
}
$after = [pscustomobject]@{value=($parts -join ';');kind=$before.kind}
if ($Action -eq 'Plan') {
    $tools | Select-Object id,exe,command
    Write-Host "Plan only: selected paths precede existing entries; scope=$Scope; mode=$Mode. No executable launched or variables written."
    return
}
function Invoke-Cmd([string]$Command,[string]$PathValue) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $info.Arguments = '/d /c chcp 65001 >nul & ' + $Command
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
    $info.WorkingDirectory = Join-Path $env:SystemRoot 'System32'
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.EnvironmentVariables['Path'] = $PathValue
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'selected-command-timeout' }
        $output = $stdout.GetAwaiter().GetResult(); $errorOutput = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "selected-command-failed: $Command; exit=$($process.ExitCode)" }
        return ($output + $errorOutput).Trim()
    } finally { $process.Dispose() }
}
function Verify-Selected {
    if ($Scope -eq 'Process') { $pathValue = [Environment]::GetEnvironmentVariable('Path','Process') }
    else {
        $userPath = [Environment]::GetEnvironmentVariable('Path','User')
        $machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
        $pathValue = [Environment]::ExpandEnvironmentVariables($machinePath+';'+$userPath)
    }
    foreach ($tool in $tools) {
        $commandFile = if($tool.id -eq 'vscode'){'code.cmd'}else{[IO.Path]::GetFileName($tool.exe)}
        $expected = Join-Path $tool.directory $commandFile
        $resolvedLines = (Invoke-Cmd ('where.exe '+$commandFile) $pathValue) -split '\r?\n'
        if ([IO.Path]::GetFullPath($resolvedLines[0].Trim()) -ine $expected) { throw "selected-command-shadowed: $($tool.id)" }
        $versionText = Invoke-Cmd $tool.command $pathValue
        if (-not $tool.custom -and $tool.id -eq 'java8') {
            $expectedJava = '1.8.0_' + (($tool.version -split '-')[0] -replace '^8u','')
            if ($versionText -notmatch ([regex]::Escape($expectedJava)+'(?![0-9])')) { throw 'selected-version-mismatch: java8' }
        }
        if (-not $tool.custom -and $tool.id -ne 'java8' -and $versionText -notmatch ([regex]::Escape($tool.version)+'(?![0-9])')) { throw "selected-version-mismatch: $($tool.id)" }
        [pscustomobject]@{component=$tool.id;resolved=$resolvedLines[0].Trim();version=$versionText;state='cmd-verified'}
    }
}
if ($Action -eq 'Verify') { Verify-Selected; return }
Require-Admin
if ($ReceiptFile) { throw 'apply-creates-its-own-receipt' }
$stateRoot = Join-Path $rootPath '.ai-dev-environment'
Assert-NoLink $stateRoot
[void][IO.Directory]::CreateDirectory($stateRoot)
$ReceiptFile = Join-Path $stateRoot (([guid]::NewGuid().ToString('N'))+'.json')
$receipt = [pscustomobject]@{schema=1;tool='ai-dev-path';state='prepared';scope=$Scope;mode=$Mode;root=$rootPath;components=$Components;before=$before;after=$after;javaChanged=$javaChanged;javaBefore=$javaBefore;javaAfter=$javaAfter}
Save-Receipt $receipt $ReceiptFile
$readback = Get-Content -LiteralPath $ReceiptFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($readback.before.value -cne $before.value -or $readback.after.value -cne $after.value) { throw 'backup-readback-failed' }
$now = Read-PathState
if ($now.value -cne $before.value -or $now.kind -ne $before.kind) { throw 'path-changed-before-write' }
try {
    if ($javaChanged) {
        if ((Read-JavaHome) -cne $javaBefore) { throw 'JAVA_HOME-changed-before-write' }
        Write-JavaHome $javaAfter
        if ((Read-JavaHome) -cne $javaAfter) { throw 'JAVA_HOME-write-readback-failed' }
    }
    Write-PathState $after
    $now = Read-PathState
    if ($now.value -cne $after.value -or $now.kind -ne $after.kind) { throw 'path-write-readback-failed' }
    $verified = @(Verify-Selected)
    $receipt.state = 'applied'; Save-Receipt $receipt $ReceiptFile
} catch {
    if ($javaChanged -and (Read-JavaHome) -ceq $javaAfter) { Write-JavaHome $javaBefore }
    $now = Read-PathState
    if ($now.value -ceq $after.value -and $now.kind -eq $after.kind) { Write-PathState $before; $receipt.state='reverted-after-failure'; Save-Receipt $receipt $ReceiptFile }
    throw
}
Notify-EnvironmentChange
$verified
Write-Host "PATH configured and verified in child CMD. Receipt: $ReceiptFile"
Write-Host 'Close and reopen CMD / VS Code. Existing processes retain their inherited environment.'

} finally {
    if ($environmentLocked) { $environmentLock.ReleaseMutex() }
    if ($environmentLock) { $environmentLock.Dispose() }
}
