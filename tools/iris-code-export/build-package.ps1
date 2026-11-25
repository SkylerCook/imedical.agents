#requires -Version 5.1
<#
.SYNOPSIS
维护者重建独立 ZIP。Node.js 只在打包电脑需要，不随包分发。
#>
[CmdletBinding()]
param(
    [string]$OutputFile,
    [string]$LocalExampleFile
)
$ErrorActionPreference = 'Stop'
$version = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'VERSION')).Trim()
if ($version -cnotmatch '\A(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\z') { throw 'invalid-tool-version' }
if (-not $OutputFile) {
    $dist = Join-Path $PSScriptRoot '../dist'
    if ((Test-Path -LiteralPath $dist) -and (Get-ChildItem -LiteralPath $dist -File -Force | Where-Object { $_.Name -match '^iris-code-export(?:-[0-9]+\.[0-9]+\.[0-9]+)?\.zip$' })) {
        throw 'Current CLI package exists. Build a candidate with -OutputFile in a temporary directory before rotating the current release.'
    }
    $OutputFile = Join-Path $dist "iris-code-export-$version.zip"
}
$stage = $null
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'build-requires-Node.js-22.5-or-newer-not-a-hospital-runtime-dependency' }
    $nodeVersion = [version]((& node --version).TrimStart('v'))
    if ($nodeVersion -lt [version]'22.5.0') { throw 'build-requires-Node.js-22.5-or-newer-not-a-hospital-runtime-dependency' }
    $output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputFile)
    if (Test-Path -LiteralPath $output -PathType Container) { throw 'package-output-must-be-a-file' }
    $parent = Join-Path ([IO.Path]::GetTempPath()) 'Codex'
    if (Test-Path -LiteralPath 'D:\tmp' -PathType Container) { $parent = 'D:\tmp\Codex' }
    $probe = [IO.Path]::GetFullPath($parent)
    while ($probe) {
        if ((Test-Path -LiteralPath $probe) -and ((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'linked-package-parent' }
        $probe = [IO.Path]::GetDirectoryName($probe)
    }
    $stage = Join-Path $parent ('iris-code-export-build-' + [guid]::NewGuid().ToString('N'))
    $runtime = Join-Path $stage 'runtime'
    $candidate = Join-Path $stage 'package.zip'
    & node (Join-Path $PSScriptRoot 'build-catalogs.js') --package-out $runtime
    if ($LASTEXITCODE -ne 0) { throw 'package-source-generation-failed' }
    if ($LocalExampleFile) {
        $examplePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($LocalExampleFile)
        $utf8 = New-Object Text.UTF8Encoding($false,$true)
        $readmePath = Join-Path $runtime 'README.md'
        $readme = [IO.File]::ReadAllText($readmePath,$utf8)
        if (-not $readme.Contains('<!-- local-atelier-example -->')) { throw 'local-example-marker-missing' }
        [IO.File]::WriteAllText($readmePath,$readme.Replace('<!-- local-atelier-example -->',[IO.File]::ReadAllText($examplePath,$utf8)),$utf8)
    }
    Compress-Archive -Path (Join-Path $runtime '*') -DestinationPath $candidate
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($candidate)
    try {
        $files = @(Get-ChildItem -LiteralPath $runtime -Recurse -File -Force)
        $entries = @($archive.Entries | Where-Object { $_.Name })
        if ($files.Count -ne $entries.Count) { throw 'package-entry-count-mismatch' }
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($runtime.Length+1).Replace('\','/')
            $entry = @($entries | Where-Object { $_.FullName.Replace('\','/') -ceq $relative })
            if ($entry.Count -ne 1) { throw 'package-entry-missing-or-duplicate' }
            $entry = $entry[0]
            if (-not $entry) { throw 'package-entry-missing' }
            $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
            try { $packedHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $sha.Dispose(); $stream.Dispose() }
            if ($packedHash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { throw 'package-entry-hash-mismatch' }
        }
    } finally { $archive.Dispose() }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
    Move-Item -LiteralPath $candidate -Destination $output -Force
    [pscustomobject]@{state='packaged';path=$output;version=$version;sha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash} | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally {
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        if ([IO.Path]::GetDirectoryName($stage) -cne $parent -or -not [IO.Path]::GetFileName($stage).StartsWith('iris-code-export-build-')) { throw 'unsafe-package-stage' }
        foreach ($item in @((Get-Item -LiteralPath $stage -Force)) + @(Get-ChildItem -LiteralPath $stage -Recurse -Force)) { if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'linked-package-stage' } }
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
