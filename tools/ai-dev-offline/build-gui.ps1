#requires -Version 5.1
param([string]$MaterialZip,[string]$OutputFile,[string]$PreviewDirectory,[string]$PackagesFile,[switch]$ToolsOnly)
$ErrorActionPreference='Stop'
if(-not $MaterialZip){$MaterialZip=Join-Path $PSScriptRoot '../dist/ai-dev-base-windows-x64.zip'}
if(-not $OutputFile){$OutputFile=Join-Path $PSScriptRoot '../dist/ai-dev-offline-tools.zip'}
if(-not $PackagesFile){$PackagesFile=Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputFile))) 'ai-dev-offline-packages.zip'}
if(Test-Path -LiteralPath $OutputFile){throw 'tools-output-already-exists: archive the previous tools ZIP before rebuilding'}
if([IO.Path]::GetFullPath($OutputFile) -ieq [IO.Path]::GetFullPath($PackagesFile)){throw 'tools-and-packages-must-differ'}
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) 'Codex'
if(Test-Path -LiteralPath 'D:\tmp'){$tempRoot='D:\tmp\Codex'}
$stage=Join-Path $tempRoot ('ai-dev-gui-build-'+[guid]::NewGuid().ToString('N'))
$partials=New-Object 'Collections.Generic.List[string]'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
function Entry-Hash($Entry) {
    $stream=$Entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
    try {return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}
    finally {$stream.Dispose();$sha.Dispose()}
}
function Assert-ToolsArchive([string]$ArchiveFile,$Files) {
    $zip=[IO.Compression.ZipFile]::OpenRead($ArchiveFile)
    try {
        if(@($zip.Entries|Where-Object Name).Count -ne @($Files).Count){throw 'tools-file-count-mismatch'}
        foreach($file in $Files){
            $relative=$file.FullName.Substring($stage.Length+1).Replace('\','/')
            $entry=$zip.GetEntry($relative)
            if(-not $entry -or $entry.Length -ne $file.Length){throw "tools-zip-mismatch: $relative"}
            if((Entry-Hash $entry) -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash){throw "tools-hash-mismatch: $relative"}
        }
    } finally {$zip.Dispose()}
}
function Assert-PackagesArchive([string]$ArchiveFile) {
    $zip=[IO.Compression.ZipFile]::OpenRead($ArchiveFile)
    try {
        if(@($zip.Entries|Where-Object Name).Count -ne $manifest.components.Count){throw 'installer-file-count-mismatch'}
        foreach($component in $manifest.components){
            $entry=$zip.GetEntry('packages/'+$component.file)
            if(-not $entry -or $entry.Length -ne $component.bytes -or (Entry-Hash $entry) -ne $component.sha256){throw "installer-archive-mismatch: $($component.id); archive the old packages ZIP before rebuilding"}
        }
    } finally {$zip.Dispose()}
}
function New-PartialPath([string]$Destination) {
    $partial=[IO.Path]::GetFullPath($Destination)+'.partial'
    if(Test-Path -LiteralPath $partial){throw 'partial-already-exists'}
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($partial))
    $partials.Add($partial)
    return $partial
}
try {
    $tools=Join-Path $stage 'tools'
    [void][IO.Directory]::CreateDirectory($tools)
    $manifest=Get-Content -LiteralPath "$PSScriptRoot/manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest.components=@($manifest.components|Where-Object id -ne 'codebuddy')
    $manifest.bundleId='ai-dev-offline-gui-windows-x64'
    $manifest|ConvertTo-Json -Depth 10|Set-Content -LiteralPath "$tools/manifest.json" -Encoding UTF8
    foreach($file in @('gui-worker.ps1','configure-environment.ps1','verify-packages.ps1','GUI.md','configure-project.js','configure-vscode.js','update-notes.txt')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $tools}
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'vendor') -Destination $tools -Recurse
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $compiler /nologo /codepage:65001 /target:winexe /platform:x64 "/out:$tools/开发工具安装助手.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll (Join-Path $PSScriptRoot 'InstallerForm.cs') (Join-Path $PSScriptRoot 'ProjectConfigurationForm.cs')
    if($LASTEXITCODE -ne 0){throw 'gui-compile-failed'}
    $toolsPartial=New-PartialPath $OutputFile
    $files=@(Get-ChildItem -LiteralPath $tools -File -Recurse -Force)
    $zip=[IO.Compression.ZipFile]::Open($toolsPartial,[IO.Compression.ZipArchiveMode]::Create)
    try {foreach($file in $files){
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$file.FullName.Substring($stage.Length+1).Replace('\','/'),[IO.Compression.CompressionLevel]::Optimal)
    }} finally {$zip.Dispose()}
    Assert-ToolsArchive $toolsPartial $files
    $packagesPartial=$null
    if(-not $ToolsOnly){
        if(Test-Path -LiteralPath $PackagesFile){
            Assert-PackagesArchive ([IO.Path]::GetFullPath($PackagesFile))
            Write-Host 'Installer archive verified and reused.'
        } else {
            $source=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($MaterialZip))
            try {
                $packagesPartial=New-PartialPath $PackagesFile
                $zip=[IO.Compression.ZipFile]::Open($packagesPartial,[IO.Compression.ZipArchiveMode]::Create)
                try {foreach($component in $manifest.components){
                    $entry=$source.GetEntry('payload/'+$component.file)
                    if(-not $entry){throw "missing-material: $($component.id)"}
                    $destination=$zip.CreateEntry('packages/'+$component.file,[IO.Compression.CompressionLevel]::NoCompression)
                    $inputStream=$entry.Open();$outputStream=$destination.Open()
                    try {$inputStream.CopyTo($outputStream)} finally {$inputStream.Dispose();$outputStream.Dispose()}
                }} finally {$zip.Dispose()}
            } finally {$source.Dispose()}
            Assert-PackagesArchive $packagesPartial
        }
    }
    if($PreviewDirectory){
        if(Test-Path -LiteralPath $PreviewDirectory){throw 'preview-directory-already-exists'}
        Copy-Item -LiteralPath $stage -Destination $PreviewDirectory -Recurse
    }
    Move-Item -LiteralPath $toolsPartial -Destination $OutputFile
    if($packagesPartial){Move-Item -LiteralPath $packagesPartial -Destination $PackagesFile}
    Get-FileHash -LiteralPath $OutputFile -Algorithm SHA256
    if(-not $ToolsOnly){Get-FileHash -LiteralPath $PackagesFile -Algorithm SHA256}
} finally {
    foreach($partial in $partials){if(Test-Path -LiteralPath $partial){Remove-Item -LiteralPath $partial -Force}}
    if(Test-Path -LiteralPath $stage){
        $resolved=[IO.Path]::GetFullPath($stage)
        if([IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or (Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'unsafe-build-cleanup'}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
