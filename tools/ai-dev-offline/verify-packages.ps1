#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PackageRoot,
    [string[]]$Components
)
$ErrorActionPreference = 'Stop'
if (-not $PackageRoot) { $PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PackageRoot)
function Assert-NoLink([string]$Path) {
    $p = [IO.Path]::GetFullPath($Path)
    while ($p) {
        if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'linked-package-path' }
        $p = [IO.Path]::GetDirectoryName($p)
    }
}
Assert-NoLink $root
Assert-NoLink (Join-Path $root 'manifest.json')
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or @($manifest.components).Count -eq 0) { throw 'invalid-manifest' }
$known = @($manifest.components | ForEach-Object { $_.id })
if (@($known | Select-Object -Unique).Count -ne $known.Count) { throw 'duplicate-component-id' }
if ($Components) {
    foreach ($id in $Components) { if ($id -notin $known) { throw "unknown-component: $id" } }
    $selected = @($manifest.components | Where-Object { $_.id -in $Components })
} else { $selected = @($manifest.components) }
$results = @()
foreach ($c in $selected) {
    if ($c.file -notmatch '^[A-Za-z0-9._-]+$' -or $c.sha256 -notmatch '^[a-f0-9]{64}$' -or $c.bytes -le 0) { throw "invalid-component-entry: $($c.id)" }
    $file = Join-Path (Join-Path $root 'payload') $c.file
    Assert-NoLink $file
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "missing-package: $($c.id)" }
    if ((Get-Item -LiteralPath $file).Length -ne $c.bytes) { throw "package-size-mismatch: $($c.id)" }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $c.sha256) { throw "package-sha256-mismatch: $($c.id)" }
    $results += [pscustomobject]@{component=$c.id;version=$c.version;bytes=$c.bytes;state='package-verified'}
}
$results
# Pure local byte verification: no executable launch, installed-tool detection, network or environment writes.
