#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PackageRoot,
    [Parameter(Mandatory=$true)][string]$PythonRuntimeZip,
    [Parameter(Mandatory=$true)][string]$PythonRuntimeSha256
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$source = Join-Path $repo 'tools/ai-dev-offline'
$configure = Join-Path $source 'configure-environment.ps1'
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$base = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PackageRoot)
$p = $base
while ($p) {
    if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'linked-smoke-parent' }
    $p = [IO.Path]::GetDirectoryName($p)
}
$root = Join-Path $base ('path-smoke-' + [guid]::NewGuid().ToString('N'))
$portable = Join-Path $root 'Portable Tools'
$originalPath = [Environment]::GetEnvironmentVariable('Path','Process')
$originalMachine = [Environment]::GetEnvironmentVariable('Path','Machine')
try {
    if ((Get-FileHash -LiteralPath $PythonRuntimeZip -Algorithm SHA256).Hash -ne $PythonRuntimeSha256) { throw 'python-runtime-hash-mismatch' }
    [void][IO.Directory]::CreateDirectory($portable)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach ($id in @('node','git','powershell')) {
        $c = $manifest.components | Where-Object { $_.id -eq $id }
        $file = Join-Path (Join-Path $base 'payload') $c.file
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $c.sha256) { throw "package-hash-mismatch: $id" }
        if ($id -eq 'git') {
            $dest = Join-Path $portable ('Git/'+$c.version)
            $process = Start-Process -FilePath $file -ArgumentList @('-y',('-o"'+$dest+'"')) -PassThru -Wait -WindowStyle Hidden
            if ($process.ExitCode -ne 0) { throw 'portablegit-extract-failed' }
        } else {
            $folder = if ($id -eq 'node') { 'Node' } else { 'PowerShell' }
            [IO.Compression.ZipFile]::ExtractToDirectory($file,(Join-Path $portable ($folder+'/'+$c.version)))
        }
    }
    $pythonVersion = ($manifest.components|Where-Object id -eq 'python').version
    [IO.Compression.ZipFile]::ExtractToDirectory($PythonRuntimeZip,(Join-Path $portable ('Python/'+$pythonVersion)))
    $verified = @(& $configure -Action Apply -Mode Blank -Scope Process -Root $portable -Components node,python,git,powershell)
    if ($verified.Count -ne 4 -or @($verified|Where-Object{$_.state -ne 'cmd-verified'}).Count) { throw 'four-cmd-commands-not-verified' }
    $afterFirst = [Environment]::GetEnvironmentVariable('Path','Process')
    $firstReceipt = @(Get-ChildItem -LiteralPath (Join-Path $portable '.ai-dev-environment') -File)
    if ($firstReceipt.Count -ne 1) { throw 'first-receipt-missing' }
    $second = @(& $configure -Action Apply -Mode Supplement -Scope Process -Root $portable -Components 'node,python,git,powershell')
    if ($second.Count -ne 4 -or [Environment]::GetEnvironmentVariable('Path','Process') -cne $afterFirst) { throw 'reapply-must-be-idempotent' }
    $secondReceipt = @(Get-ChildItem -LiteralPath (Join-Path $portable '.ai-dev-environment') -File | Where-Object { $_.FullName -ne $firstReceipt[0].FullName })
    if ($secondReceipt.Count -ne 1) { throw 'second-receipt-missing' }
    & $configure -Action Rollback -Scope Process -ReceiptFile $secondReceipt[0].FullName
    $later = $afterFirst + ';__AI_DEV_LATER_PATH__'
    [Environment]::SetEnvironmentVariable('Path',$later,'Process')
    $refused = $false
    try { & $configure -Action Rollback -Scope Process -ReceiptFile $firstReceipt[0].FullName }
    catch { if ($_.Exception.Message -notmatch 'path-changed-since-apply') { throw }; $refused = $true }
    if (-not $refused -or [Environment]::GetEnvironmentVariable('Path','Process') -cne $later) { throw 'rollback-must-preserve-later-edit' }
    [Environment]::SetEnvironmentVariable('Path',$afterFirst,'Process')
    & $configure -Action Rollback -Scope Process -ReceiptFile $firstReceipt[0].FullName
    if ([Environment]::GetEnvironmentVariable('Path','Process') -cne $originalPath) { throw 'rollback-must-restore-exact-original' }
    if ([Environment]::GetEnvironmentVariable('Path','Machine') -cne $originalMachine) { throw 'machine-path-must-not-change' }
    $verified | Format-Table -AutoSize
    Write-Host "Environment smoke passed on PS $($PSVersionTable.PSVersion): four CMD versions, paths with spaces, idempotence, backup/rollback, concurrent-edit refusal. Machine PATH unchanged."
} finally {
    [Environment]::SetEnvironmentVariable('Path',$originalPath,'Process')
    if (Test-Path -LiteralPath $root) {
        if ([IO.Path]::GetDirectoryName($root) -ne $base -or -not [IO.Path]::GetFileName($root).StartsWith('path-smoke-')) { throw 'unsafe-smoke-cleanup' }
        foreach ($item in @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Recurse -Force)) { if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'linked-smoke-cleanup' } }
        Remove-Item -LiteralPath $root -Recurse -Force
        if (Test-Path -LiteralPath $root) { throw 'smoke-cleanup-failed' }
    }
}
