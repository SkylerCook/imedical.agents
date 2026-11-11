#requires -Version 5.1
param([string]$MaterialZip,[string]$OutputFile,[string]$PreviewDirectory)
$ErrorActionPreference='Stop'
if(-not $MaterialZip){$MaterialZip=Join-Path $PSScriptRoot '../dist/ai-dev-base-windows-x64.zip'}
if(-not $OutputFile){$OutputFile=Join-Path $PSScriptRoot '../dist/ai-dev-offline-gui-win10-x64.zip'}
if(Test-Path -LiteralPath $OutputFile){throw 'output-already-exists: archive the previous package under tools/dist/history before rebuilding'}
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) 'Codex'
if(Test-Path -LiteralPath 'D:\tmp'){$tempRoot='D:\tmp\Codex'}
$stage=Join-Path $tempRoot ('ai-dev-gui-build-'+[guid]::NewGuid().ToString('N'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    [void][IO.Directory]::CreateDirectory((Join-Path $stage 'payload'))
    $manifest=Get-Content -LiteralPath "$PSScriptRoot/manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest.components=@($manifest.components|Where-Object id -ne 'codebuddy')
    $manifest.bundleId='ai-dev-offline-gui-windows-x64'
    $manifest|ConvertTo-Json -Depth 10|Set-Content -LiteralPath "$stage/manifest.json" -Encoding UTF8
    $source=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($MaterialZip))
    try {foreach($component in $manifest.components){
        $entry=$source.GetEntry('payload/'+$component.file)
        if(-not $entry){throw "missing-material: $($component.id)"}
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path "$stage/payload" $component.file))
    }} finally {$source.Dispose()}
    foreach($file in @('gui-worker.ps1','configure-environment.ps1','verify-packages.ps1','GUI.md','configure-project.js','configure-vscode.js')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stage}
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'vendor') -Destination $stage -Recurse
    & "$stage/verify-packages.ps1" | Out-Host
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $compiler /nologo /codepage:65001 /target:winexe /platform:x64 "/out:$stage/开发工具安装助手.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll (Join-Path $PSScriptRoot 'InstallerForm.cs') (Join-Path $PSScriptRoot 'ProjectConfigurationForm.cs')
    if($LASTEXITCODE -ne 0){throw 'gui-compile-failed'}
    $partial=[IO.Path]::GetFullPath($OutputFile)+'.partial'
    if(Test-Path -LiteralPath $partial){throw 'partial-already-exists'}
    [IO.Compression.ZipFile]::CreateFromDirectory($stage,$partial,[IO.Compression.CompressionLevel]::NoCompression,$false)
    $zip=[IO.Compression.ZipFile]::OpenRead($partial)
    try {foreach($file in Get-ChildItem -LiteralPath $stage -File -Recurse){
        $relative=$file.FullName.Substring($stage.Length+1).Replace('\','/')
        $entry=$zip.GetEntry($relative)
        if(-not $entry){$entry=$zip.GetEntry($relative.Replace('/','\'))}
        if(-not $entry -or $entry.Length -ne $file.Length){throw "zip-mismatch: $relative"}
        $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
        try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose();$sha.Dispose()}
        if($hash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash){throw "zip-hash-mismatch: $relative"}
    }} finally {$zip.Dispose()}
    if($PreviewDirectory){
        if(Test-Path -LiteralPath $PreviewDirectory){throw 'preview-directory-already-exists'}
        Copy-Item -LiteralPath $stage -Destination $PreviewDirectory -Recurse
    }
    Move-Item -LiteralPath $partial -Destination $OutputFile
    Get-FileHash -LiteralPath $OutputFile -Algorithm SHA256
} finally {
    if(Test-Path -LiteralPath $stage){
        $resolved=[IO.Path]::GetFullPath($stage)
        if([IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or (Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'unsafe-build-cleanup'}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
