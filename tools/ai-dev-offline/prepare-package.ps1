#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Download','Pack')][string]$Action,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [string]$OutputFile,
    [switch]$DirectMicrosoftCdn,
    [string[]]$Components
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutputFile) { $OutputFile = Join-Path $sourceRoot '../dist/ai-dev-base-windows-x64-2026-10-29.zip' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$work = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($WorkRoot)
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Assert-NoLink([string]$Path) {
    $p = [IO.Path]::GetFullPath($Path)
    while ($p) {
        if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "linked-path: $p" }
        $p = [IO.Path]::GetDirectoryName($p)
    }
}
Assert-NoLink $work
$marker = Join-Path $work 'prepare-owner.json'
if (Test-Path -LiteralPath $work) {
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw 'work-root-must-be-new-or-owned' }
    $owner = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($owner.bundleId -ne $manifest.bundleId -or $owner.workRoot -ne $work) { throw 'work-root-owner-mismatch' }
} else {
    if ($Action -ne 'Download') { throw 'download-first' }
    [void][IO.Directory]::CreateDirectory($work)
    @{bundleId=$manifest.bundleId;workRoot=$work} | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
}
foreach ($item in Get-ChildItem -LiteralPath $work -Recurse -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'linked-work-content' }
}
$payload = Join-Path $work 'payload'
[void][IO.Directory]::CreateDirectory($payload)
$checkpoint = Join-Path $work 'download-checkpoint.json'
$results = @()
if ($Components -and $Action -eq 'Pack') { throw 'pack-requires-all-components' }
foreach ($id in $Components) { if ($id -notin @($manifest.components.id)) { throw "unknown-component: $id" } }
$selected = @($manifest.components | Where-Object { -not $Components -or $_.id -in $Components })
foreach ($c in $selected) {
    $checkpoint = Join-Path $work ($c.id + '-checkpoint.json')
    if ($c.file -notmatch '^[A-Za-z0-9._-]+$' -or $c.sha256 -notmatch '^[a-f0-9]{64}$' -or $c.bytes -le 0) { throw 'invalid-manifest-entry' }
    $uri = [uri]$c.url
    if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('github.com','nodejs.org','www.python.org','vscode.download.prss.microsoft.com','marketplace.visualstudio.com')) { throw 'non-official-download-source' }
    $file = Join-Path $payload $c.file
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        if ($Action -ne 'Download') { throw "missing-package: $($c.id)" }
        $part = $file + '.partial'
        Write-Host "Downloading $($c.id) $($c.version) ..."
        $networkArgs = @()
        if ($DirectMicrosoftCdn -and $uri.Host -eq 'vscode.download.prss.microsoft.com') { $networkArgs = @('--noproxy','*') }
        $resumeArgs = @('--continue-at','-')
        if ($c.downloadEncoding -eq 'http-compressed-no-resume') {
            if (Test-Path -LiteralPath $part) { throw 'compressed-transfer-partial-requires-explicit-cleanup' }
            $resumeArgs = @('--compressed')
        }
        & curl.exe --silent --show-error --fail --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 30 --max-time 1200 --speed-time 45 --speed-limit 1024 @resumeArgs --output $part @networkArgs $c.url
        if ($LASTEXITCODE -ne 0) { throw "download-failed: $($c.id); partial retained for resume" }
        if ((Get-Item -LiteralPath $part).Length -ne $c.bytes -or (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash -ne $c.sha256) { throw "download-integrity-failed: $($c.id)" }
        Move-Item -LiteralPath $part -Destination $file
    }
    if ((Get-Item -LiteralPath $file).Length -ne $c.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $c.sha256) { throw "package-integrity-failed: $($c.id)" }
    $results += [pscustomobject]@{id=$c.id;file=$c.file;bytes=$c.bytes;sha256=$c.sha256;state='hash-verified'}
    $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ($checkpoint+'.tmp') -Encoding UTF8
    Move-Item -LiteralPath ($checkpoint+'.tmp') -Destination $checkpoint -Force
    Write-Host "Verified $($c.id) $($c.bytes) bytes"
}
if ($Action -eq 'Download') { Write-Host "Downloads persisted and read back: $checkpoint"; return }
$actualNames = @(Get-ChildItem -LiteralPath $payload -Force | ForEach-Object { $_.Name })
if (@(Compare-Object $actualNames @($manifest.components.file)).Count -ne 0) { throw 'unexpected-payload-content' }
$packageFiles = @('README.md','manifest.json','verify-packages.ps1','verify.cmd','PREPARATION-REPORT.md','templates/settings-user.jsonc','templates/settings-codebuddy.jsonc','templates/settings-iris-workspace.jsonc','templates/mcp.template.json','templates/iris-agentic-dev.template.toml','templates/ai-shell-preference.md','configure-environment.ps1','configure-environment.cmd')
foreach ($name in $packageFiles) {
    $destination = Join-Path $work $name
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
    Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $destination -Force
}
& (Join-Path $work 'verify-packages.ps1')
if (-not $?) { throw 'staged-verification-failed' }
$out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputFile)
Assert-NoLink $out
if (Test-Path -LiteralPath $out) { throw 'output-already-exists-use-new-name' }
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($out))
$partialZip = $out + '.partial'
if (Test-Path -LiteralPath $partialZip) { throw 'partial-output-already-exists' }
$zip = [IO.Compression.ZipFile]::Open($partialZip,[IO.Compression.ZipArchiveMode]::Create)
try {
    $files = @(Get-ChildItem -LiteralPath $payload -File) + @($packageFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $work $_) })
    foreach ($file in $files) {
        $rel = $file.FullName.Substring($work.Length+1).Replace('\','/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$rel,[IO.Compression.CompressionLevel]::NoCompression)
    }
} finally { $zip.Dispose() }
$zip = [IO.Compression.ZipFile]::OpenRead($partialZip)
try {
    if ($zip.Entries.Count -ne $files.Count) { throw 'archive-count-mismatch' }
    foreach ($file in $files) {
        $rel = $file.FullName.Substring($work.Length+1).Replace('\','/')
        $entry = $zip.GetEntry($rel)
        if (-not $entry -or $entry.Length -ne $file.Length) { throw "archive-entry-mismatch: $rel" }
        $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { throw "archive-hash-mismatch: $rel" }
    }
} finally { $zip.Dispose() }
Move-Item -LiteralPath $partialZip -Destination $out
[pscustomobject]@{state='packaged-and-read-back';path=$out;bytes=(Get-Item -LiteralPath $out).Length;sha256=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash} | ConvertTo-Json -Compress
# WorkRoot intentionally survives until the caller independently extracts and verifies the ZIP.
# The caller owns final cleanup; failed downloads are resumable, not silently erased.
