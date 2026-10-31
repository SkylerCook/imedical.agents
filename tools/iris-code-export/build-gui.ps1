#requires -Version 5.1
[CmdletBinding()]
param([string]$OutputFile)
$ErrorActionPreference='Stop'
if(-not $OutputFile){$OutputFile=Join-Path $PSScriptRoot '../dist/iris-code-export-gui.zip'}
$parent=Join-Path ([IO.Path]::GetTempPath()) 'Codex'
if(Test-Path -LiteralPath 'D:\tmp' -PathType Container){$parent='D:\tmp\Codex'}
$stage=Join-Path $parent ('iris-export-gui-build-'+[guid]::NewGuid().ToString('N'))
try{
    if(-not(Get-Command node -ErrorAction SilentlyContinue)){throw 'build-requires-Node.js-22.5-or-newer-not-a-hospital-runtime-dependency'}
    if([version]((& node --version).TrimStart('v')) -lt [version]'22.5.0'){throw 'build-requires-Node.js-22.5-or-newer'}
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if(-not(Test-Path -LiteralPath $compiler)){throw 'build-requires-Windows-NET-Framework-compiler'}
    & node (Join-Path $PSScriptRoot 'build-catalogs.js') --package-out $stage
    if($LASTEXITCODE -ne 0){throw 'catalog-build-failed'}
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'gui-worker.ps1') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'GUI.md') -Destination $stage
    $exe=Join-Path $stage 'IRISSourceExporter.exe'
    & $compiler /nologo /target:winexe /platform:anycpu "/out:$exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll (Join-Path $PSScriptRoot 'ExporterForm.cs')
    if($LASTEXITCODE -ne 0){throw 'gui-compile-failed'}
    $manifest=@{schema='iris-export-gui-package/v1';builtAt=[DateTime]::UtcNow.ToString('o');files=@()}
    foreach($file in Get-ChildItem -LiteralPath $stage -File -Recurse){$manifest.files+=@{path=$file.FullName.Substring($stage.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}}
    $manifest|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $stage 'package-manifest.json') -Encoding UTF8
    $output=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputFile)
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $output -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($output)
    try {
        $entries=@($archive.Entries | Where-Object {$_.Name})
        if($entries.Count -ne $manifest.files.Count+1){throw 'package-entry-count-mismatch'}
        foreach($file in $manifest.files){
            $entry=@($entries | Where-Object {$_.FullName.Replace('\','/') -ceq $file.path})
            if($entry.Count -ne 1){throw 'package-entry-missing-or-duplicate'}
            $stream=$entry[0].Open();$sha=[Security.Cryptography.SHA256]::Create()
            try{$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}finally{$sha.Dispose();$stream.Dispose()}
            if($hash -ne $file.sha256){throw 'package-entry-hash-mismatch'}
        }
    } finally {$archive.Dispose()}
    [pscustomobject]@{path=$output;sha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash;state='built'}|ConvertTo-Json
}finally{
    if(Test-Path -LiteralPath $stage){
        if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stage)) -ne [IO.Path]::GetFullPath($parent)){throw 'unsafe-build-cleanup'}
        foreach($item in @((Get-Item -LiteralPath $stage))+@(Get-ChildItem -LiteralPath $stage -Recurse -Force)){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'linked-build-cleanup'}}
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
