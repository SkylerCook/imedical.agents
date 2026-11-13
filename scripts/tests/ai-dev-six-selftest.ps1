#requires -Version 5.1
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../tools/ai-dev-offline'))
$parent=if(Test-Path -LiteralPath 'D:/tmp'){'D:\tmp\Codex'}else{Join-Path ([IO.Path]::GetTempPath()) 'Codex'}
$root=Join-Path $parent ('ai-dev-six-selftest-'+[guid]::NewGuid().ToString('N'))
try {
    [void][IO.Directory]::CreateDirectory((Join-Path $root 'fake'))
    Copy-Item -LiteralPath "$source/manifest.json","$source/gui-worker.ps1" -Destination $root
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $files=@((Join-Path $source 'InstallerForm.cs'),(Join-Path $source 'ProjectConfigurationForm.cs'),(Join-Path $PSScriptRoot 'fixtures/ai-dev-six-selftest.cs'))
    & $compiler /nologo /codepage:65001 /target:exe /platform:x64 /main:AiDevOffline.SleepCode "/out:$root/fake/Code.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll @files
    if($LASTEXITCODE -ne 0){throw 'fixture compile failed'}
    & $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /main:AiDevOffline.SixSelfTest "/out:$root/selftest.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll @files
    if($LASTEXITCODE -ne 0){throw 'selftest compile failed'}
    $process=Start-Process -FilePath "$root/selftest.exe" -ArgumentList ('"'+$root+'"') -PassThru -WindowStyle Hidden
    try {if(-not $process.WaitForExit(40000)){$process.Kill();[void]$process.WaitForExit(5000);throw 'native selftest timed out'};$code=$process.ExitCode} finally {$process.Dispose()}
    Get-Content -LiteralPath "$root/result.txt" -Raw
    if($code -ne 0){throw 'native selftest failed'}
} finally {
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($root)) -ne $parent){throw 'unsafe test cleanup'}
    if(Get-Process | Where-Object {$_.Path -and $_.Path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)}){throw "test processes still active: $root"}
    if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
