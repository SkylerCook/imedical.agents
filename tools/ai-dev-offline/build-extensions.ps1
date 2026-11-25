#requires -Version 5.1
param([string]$OutputFile)
$ErrorActionPreference='Stop'
$manifest=Get-Content -LiteralPath "$PSScriptRoot/extensions.json" -Raw -Encoding UTF8 | ConvertFrom-Json
if(-not $OutputFile){
    . (Join-Path $PSScriptRoot 'release-artifact.ps1')
    $OutputFile=Get-AiDevArtifactPath (Join-Path $PSScriptRoot '../dist') 'ai-dev-offline-extensions' $manifest.releaseVersion
    Assert-AiDevArtifactSlot $OutputFile 'ai-dev-offline-extensions'
}
if(Test-Path -LiteralPath $OutputFile){throw 'extensions-output-already-exists: archive the previous ZIP before rebuilding'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$partial=[IO.Path]::GetFullPath($OutputFile)+'.partial'
if(Test-Path -LiteralPath $partial){throw 'partial-already-exists'}
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($partial))
try {
    $zip=[IO.Compression.ZipFile]::Open($partial,[IO.Compression.ZipArchiveMode]::Create)
    try {foreach($component in $manifest.extensions){
        $file=Join-Path "$PSScriptRoot/assets" $component.file
        if((Get-Item -LiteralPath $file).Length -ne $component.bytes -or (Get-FileHash -LiteralPath $file).Hash -ne $component.sha256){throw "extension-asset-mismatch: $($component.file)"}
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file,('packages/extensions/'+$component.file),[IO.Compression.CompressionLevel]::NoCompression)
    }} finally {$zip.Dispose()}
    $zip=[IO.Compression.ZipFile]::OpenRead($partial)
    try {
        if($zip.Entries.Count -ne $manifest.extensions.Count){throw 'extension-count-mismatch'}
        foreach($component in $manifest.extensions){
            $entry=$zip.GetEntry('packages/extensions/'+$component.file)
            if(-not $entry -or $entry.Length -ne $component.bytes){throw 'extension-size-mismatch'}
            $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
            try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose();$sha.Dispose()}
            if($hash -ne $component.sha256){throw 'extension-hash-mismatch'}
        }
    } finally {$zip.Dispose()}
    Move-Item -LiteralPath $partial -Destination $OutputFile
    Get-FileHash -LiteralPath $OutputFile
} finally {if(Test-Path -LiteralPath $partial){Remove-Item -LiteralPath $partial -Force}}
