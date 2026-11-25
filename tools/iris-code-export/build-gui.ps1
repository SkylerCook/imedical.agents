#requires -Version 5.1
[CmdletBinding()]
param([string]$OutputFile)
$ErrorActionPreference='Stop'
$version = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'VERSION')).Trim()
if ($version -cnotmatch '\A(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\z') { throw 'invalid-tool-version' }
if (-not $OutputFile) {
    $dist = Join-Path $PSScriptRoot '../dist'
    if ((Test-Path -LiteralPath $dist) -and (Get-ChildItem -LiteralPath $dist -File -Force | Where-Object { $_.Name -match '^iris-code-export-gui(?:-[0-9]+\.[0-9]+\.[0-9]+)?\.zip$' })) {
        throw 'Current GUI package exists. Build a candidate with -OutputFile in a temporary directory before rotating the current release.'
    }
    $OutputFile = Join-Path $dist "iris-code-export-gui-$version.zip"
}
$parent=Join-Path ([IO.Path]::GetTempPath()) 'Codex'
if(Test-Path -LiteralPath 'D:\tmp' -PathType Container){$parent='D:\tmp\Codex'}
$stage=Join-Path $parent ('iris-export-gui-build-'+[guid]::NewGuid().ToString('N'))
$runtime = Join-Path $stage 'runtime'
$candidate = Join-Path $stage 'package.zip'
try{
    $output=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputFile)
    if (Test-Path -LiteralPath $output -PathType Container) { throw 'package-output-must-be-a-file' }
    if(-not(Get-Command node -ErrorAction SilentlyContinue)){throw 'build-requires-Node.js-22.5-or-newer-not-a-hospital-runtime-dependency'}
    if([version]((& node --version).TrimStart('v')) -lt [version]'22.5.0'){throw 'build-requires-Node.js-22.5-or-newer'}
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if(-not(Test-Path -LiteralPath $compiler)){throw 'build-requires-Windows-NET-Framework-compiler'}
    & node (Join-Path $PSScriptRoot 'build-catalogs.js') --package-out $runtime
    if($LASTEXITCODE -ne 0){throw 'catalog-build-failed'}
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'gui-worker.ps1') -Destination $runtime
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'GUI.md') -Destination $runtime
    $exe=Join-Path $runtime 'IRISSourceExporter.exe'
    & $compiler /nologo /codepage:65001 /target:winexe /platform:anycpu "/out:$exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll /r:System.Xml.dll (Join-Path $PSScriptRoot 'ExporterForm.cs') (Join-Path $PSScriptRoot 'ExporterWorkflow.cs') (Join-Path $PSScriptRoot 'ExporterWorkbench.cs') (Join-Path $PSScriptRoot 'ProjectBaseline.cs')
    if($LASTEXITCODE -ne 0){throw 'gui-compile-failed'}
    $manifest=@{schema='iris-export-gui-package/v1';version=$version;builtAt=[DateTime]::UtcNow.ToString('o');files=@()}
    foreach($file in Get-ChildItem -LiteralPath $runtime -File -Recurse){$manifest.files+=@{path=$file.FullName.Substring($runtime.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}}
    $manifest|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $runtime 'package-manifest.json') -Encoding UTF8
    Compress-Archive -Path (Join-Path $runtime '*') -DestinationPath $candidate
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($candidate)
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
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
    Move-Item -LiteralPath $candidate -Destination $output -Force
    [pscustomobject]@{path=$output;version=$version;sha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash;state='built'}|ConvertTo-Json
}finally{
    if(Test-Path -LiteralPath $stage){
        if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stage)) -ne [IO.Path]::GetFullPath($parent)){throw 'unsafe-build-cleanup'}
        foreach($item in @((Get-Item -LiteralPath $stage))+@(Get-ChildItem -LiteralPath $stage -Recurse -Force)){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'linked-build-cleanup'}}
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
