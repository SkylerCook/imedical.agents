#requires -Version 5.1
<#
.SYNOPSIS
按已确认版本清单导出医院当前源码，复用 export-iris-code.ps1。
.EXAMPLE
.\export-version-baseline.ps1 -ListVersions
.EXAMPLE
.\export-version-baseline.ps1 -Version v9.1 -OutputDirectory ..\baseline -PlanOnly
.NOTES
需使用包含 catalogs 的独立 ZIP；无 Node.js、框架、MCP 或外网依赖。
版本只定义对象范围，不证明医院当前版本或还原历史代码。默认只接受医生站清单。
#>
[CmdletBinding()]
param(
    [string]$Version,
    [ValidateSet('doctor','all-products')][string]$Scope = 'doctor',
    [string]$OutputDirectory,
    [string]$SupplementListFile,
    [string]$WebPathMapFile,
    [string]$CatalogDirectory,
    [string]$AtelierUrl,
    [string]$Namespace,
    [PSCredential]$Credential,
    [ValidateRange(50,60000)][int]$IntervalMs = 200,
    [ValidateRange(1,600)][int]$TimeoutSec = 30,
    [ValidateRange(1,2147483647)][int]$MaxFilesPerRun = 2147483647,
    [ValidateRange(1,10)][int]$Sessions = 1,
    [switch]$SessionTrial,
    [switch]$ConfirmedSessionBudget,
    [string]$CancelFile,
    [hashtable]$SessionContext,
    [switch]$ConfirmWebPaths,
    [switch]$PlanOnly,
    [switch]$ListVersions,
    [switch]$Resume
)
$ErrorActionPreference = 'Stop'
if (-not $CatalogDirectory) { $CatalogDirectory = Join-Path $PSScriptRoot 'catalogs' }
$utf8 = New-Object Text.UTF8Encoding($false,$true)
$temporary = $null
function Full-Path([string]$Path) { return [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)) }
function Assert-Plain([string]$Path) {
    $part = [IO.Path]::GetFullPath($Path)
    while ($part) {
        if ((Test-Path -LiteralPath $part) -and ((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'linked-version-path-forbidden' }
        $part = [IO.Path]::GetDirectoryName($part)
    }
}
function Hash-Bytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Read-Bytes([string]$Path) { Assert-Plain $Path; return ,([IO.File]::ReadAllBytes($Path)) }
function Check-Prefix([string]$Prefix) {
    if (-not $Prefix.StartsWith('/') -or -not $Prefix.EndsWith('/') -or $Prefix -eq '/' -or $Prefix -match '[\\:*?"<>|\x00-\x20]' -or @($Prefix.Trim('/').Split('/') | Where-Object { -not $_ -or $_ -in @('.','..') }).Count) { throw 'web-prefix-invalid' }
}
try {
    if ($env:OS -ne 'Windows_NT') { throw 'windows-powershell-required' }
    $catalogRoot = Full-Path $CatalogDirectory
    $indexBytes = Read-Bytes (Join-Path $catalogRoot 'index.json')
    $index = $utf8.GetString($indexBytes) | ConvertFrom-Json
    if ($index.schema -ne 'iris-version-catalogs/v1' -or -not @($index.entries).Count) { throw 'version-index-invalid' }
    $versions = @{}
    foreach ($entry in $index.entries) {
        if ($entry.version -cnotmatch '^v\d+\.\d+$' -or $entry.scope -notin @('doctor','all-products') -or $versions.ContainsKey($entry.version)) { throw 'version-index-invalid' }
        $versions[$entry.version] = $entry
    }
    if ($ListVersions) { $index.entries | Select-Object version,scope,scopeLabel,codeCount,duplicateCount,webRoots,webPathsNeedConfirmation | ConvertTo-Json -Depth 5; exit 0 }
    if (-not $OutputDirectory) { throw 'OutputDirectory-required' }
    if (-not $Version) {
        foreach ($entry in $index.entries) { Write-Host ($entry.version + ' | ' + $entry.scopeLabel + ' | ' + $entry.codeCount) }
        $Version = Read-Host 'Version (for example v9.1)'
    }
    $Version = $Version.ToLowerInvariant(); if (-not $Version.StartsWith('v')) { $Version = 'v' + $Version }
    if (-not $versions.ContainsKey($Version)) { throw 'version-not-available-no-fallback' }
    $entry = $versions[$Version]
    if ($entry.scope -ne $Scope) { throw 'version-scope-mismatch-use-the-explicit-scope-or-another-version' }
    if ($entry.listFile -cne ($Version + '.txt') -or $entry.listSha256 -cnotmatch '^[a-f0-9]{64}$' -or $entry.sourceSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'version-entry-invalid' }
    $listBytes = Read-Bytes (Join-Path $catalogRoot $entry.listFile)
    if ((Hash-Bytes $listBytes) -cne $entry.listSha256) { throw 'version-catalog-drift' }
    $lines = @($utf8.GetString($listBytes).Split("`n") | Where-Object { $_.Trim() })
    if ($lines.Count -ne $entry.codeCount) { throw 'version-catalog-count-mismatch' }
    $supplementBytes = $null; $supplementLines = @(); $supplementHash = $null
    if ($SupplementListFile) {
        $supplementBytes = Read-Bytes (Full-Path $SupplementListFile)
        $supplementHash = Hash-Bytes $supplementBytes
        $supplementLines = @($utf8.GetString($supplementBytes).TrimStart([char]0xFEFF).Split("`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
    }
    $maps = @(); $mapHash = $null; $mapSources = @{}
    if ($WebPathMapFile) {
        $mapBytes = Read-Bytes (Full-Path $WebPathMapFile); $mapHash = Hash-Bytes $mapBytes
        $mapText = $utf8.GetString($mapBytes).TrimStart([char]0xFEFF)
        if (-not $mapText.TrimStart().StartsWith('[')) { throw 'web-map-array-required' }
        foreach ($map in @($mapText | ConvertFrom-Json)) {
            if (-not $map.from -or -not $map.to) { throw 'web-map-invalid' }; Check-Prefix $map.from; Check-Prefix $map.to
            if ($mapSources.ContainsKey($map.from)) { throw 'duplicate-web-map-prefix' }; $mapSources[$map.from] = $true
            $maps += [pscustomobject]@{from=[string]$map.from;to=[string]$map.to}
        }
        $maps = @($maps | Sort-Object { $_.from.Length } -Descending)
    }
    $resolved = New-Object 'Collections.Generic.List[string]'; $seen = @{}; $mergedDuplicates = 0; $mappedCount = 0
    foreach ($raw in @($lines) + @($supplementLines)) {
        $name = $raw.Trim()
        if ($name.StartsWith('/')) {
            foreach ($map in $maps) { if ($name.StartsWith($map.from,[StringComparison]::Ordinal)) { $name = $map.to + $name.Substring($map.from.Length); $mappedCount++; break } }
        } elseif ($name -match '\.(cls|mac|inc|int)$') { $name = $name.Substring(0,$name.Length-4) + '.' + $Matches[1].ToLowerInvariant() }
        else { throw 'supplement-format-invalid-use-full-web-path-or-backend-extension' }
        if ($seen.ContainsKey($name)) { if ($seen[$name] -cne $name) { throw 'version-list-case-conflict' }; $mergedDuplicates++; continue }
        $seen[$name] = $name; $resolved.Add($name)
    }
    $filesBytes = $utf8.GetBytes(($resolved -join "`n") + "`n")
    $output = Full-Path $OutputDirectory
    $tempParent = Join-Path ([IO.Path]::GetTempPath()) 'Codex'
    if (Test-Path -LiteralPath 'D:\tmp' -PathType Container) { $tempParent = 'D:\tmp\Codex' }
    Assert-Plain $tempParent; $temporary = Join-Path $tempParent ('iris-version-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temporary)
    $filesPath = Join-Path $temporary 'files.txt'; [IO.File]::WriteAllBytes($filesPath,$filesBytes)
    $exporter = Join-Path $PSScriptRoot 'export-iris-code.ps1'; Assert-Plain $exporter
    $plan = & $exporter -ListFile $filesPath -OutputDirectory $output -PlanOnly | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $plan) { throw 'version-export-plan-invalid' }
    $webRoots = @($resolved | Where-Object { $_.StartsWith('/') } | ForEach-Object { if ($_.StartsWith('/imedical/web/')) { '/imedical/web/' } else { '/' + $_.TrimStart('/').Split('/')[0] + '/' } } | Sort-Object -Unique)
    $needsConfirmation = [bool]$entry.webPathsNeedConfirmation -or $maps.Count -gt 0
    $selection = [ordered]@{schema='iris-version-selection/v1';version=$Version;scope=$entry.scope;scopeLabel=$entry.scopeLabel;
        sourcePath=$entry.sourcePath;sourceSha256=$entry.sourceSha256;catalogIndexSha256=(Hash-Bytes $indexBytes);catalogListSha256=$entry.listSha256;
        originalItemCount=$entry.rawItemCount;catalogDuplicateCount=$entry.duplicateCount;excludedImages=@($entry.excludedImages);
        supplementSha256=$supplementHash;supplementItemCount=$supplementLines.Count;webMapSha256=$mapHash;webMap=@($maps);mappedItemCount=$mappedCount;
        mergedDuplicateCount=$mergedDuplicates;selectedFileCount=$resolved.Count;filesSha256=(Hash-Bytes $filesBytes);webRoots=$webRoots;
        webPathsConfirmed=[bool]$ConfirmWebPaths;meaning='version-defines-scope-content-from-current-instance'}
    $preview = [ordered]@{version=$Version;scope=$entry.scope;scopeLabel=$entry.scopeLabel;total=$plan.total;catalogDuplicateCount=$entry.duplicateCount;
        mergedDuplicateCount=$mergedDuplicates;supplementItemCount=$supplementLines.Count;mappedItemCount=$mappedCount;webRoots=$webRoots;
        webPathsNeedConfirmation=$needsConfirmation;webPathsConfirmed=[bool]$ConfirmWebPaths;sample=@($resolved | Select-Object -First 8);selection=$selection}
    if ($PlanOnly) { $preview | ConvertTo-Json -Depth 10; exit 0 }
    if ($needsConfirmation -and -not $ConfirmWebPaths) { throw 'web-paths-confirmation-required-run-PlanOnly-and-use-ConfirmWebPaths' }
    Write-Host ('Version: {0} | Scope: {1} | Files: {2} | Web: {3}' -f $Version,$entry.scopeLabel,$resolved.Count,($webRoots -join ', '))
    $selectionFile = Join-Path $temporary 'selection.json'
    [IO.File]::WriteAllText($selectionFile,($selection | ConvertTo-Json -Compress -Depth 12)+"`n",$utf8)
    $arguments = @{ListFile=$filesPath;VersionSelectionFile=$selectionFile;OutputDirectory=$output;IntervalMs=$IntervalMs;TimeoutSec=$TimeoutSec;MaxFilesPerRun=$MaxFilesPerRun;Resume=$Resume;Sessions=$Sessions;SessionTrial=$SessionTrial;ConfirmedSessionBudget=$ConfirmedSessionBudget;CancelFile=$CancelFile;SessionContext=$SessionContext}
    if ($AtelierUrl) { $arguments.AtelierUrl=$AtelierUrl }; if ($Namespace) { $arguments.Namespace=$Namespace }; if ($Credential) { $arguments.Credential=$Credential }
    & $exporter @arguments
    exit $LASTEXITCODE
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally {
    if ($temporary -and (Test-Path -LiteralPath $temporary)) {
        Assert-Plain $temporary
        foreach ($item in @(Get-ChildItem -LiteralPath $temporary -Force)) { if ($item.PSIsContainer -or $item.Name -notin @('files.txt','selection.json') -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'unexpected-version-temporary-entry' } }
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
