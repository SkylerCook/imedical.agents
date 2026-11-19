#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$ReleaseRecord,
    [Parameter(Mandatory)][string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

function Assert-NoReparsePoint([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Release import requires regular paths without links or reparse points.'
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Get-StreamSha256([IO.Stream]$Stream) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($Stream)).Replace('-', '') }
    finally { $hash.Dispose() }
}

function Get-ExtendedPath([string]$Path) {
    $nativePath = $Path.Replace('/', '\')
    if ($nativePath.StartsWith('\\')) { return '\\?\UNC\' + $nativePath.Substring(2) }
    return '\\?\' + $nativePath
}

function Assert-ReleaseMetadata($Metadata) {
    $versionPattern = '\A(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\z'
    if ($Metadata -isnot [pscustomobject] -or
        $Metadata.version -isnot [string] -or $Metadata.version -notmatch $versionPattern -or
        $Metadata.node -isnot [string] -or $Metadata.node -notmatch $versionPattern -or
        $Metadata.platform -isnot [string] -or $Metadata.platform -cne 'windows-x64' -or
        $Metadata.formal -isnot [bool] -or -not $Metadata.formal -or
        $Metadata.localBuildChanges -isnot [bool] -or $Metadata.localBuildChanges -or
        $Metadata.sourceBaseRevision -isnot [string] -or $Metadata.sourceBaseRevision -notmatch '\A[a-f0-9]{40}(?:[a-f0-9]{24})?\z' -or
        $Metadata.installerSha256 -isnot [string] -or $Metadata.installerSha256 -notmatch '\A[a-f0-9]{64}\z' -or
        $Metadata.documentationSha256 -isnot [pscustomobject]) {
        throw 'Release record is invalid or is not a formal Windows x64 release.'
    }
    if ($Metadata.PSObject.Properties['runtimePin']) {
        $pin = $Metadata.runtimePin
        if ($pin -isnot [pscustomobject] -or @($pin.PSObject.Properties).Count -ne 2 -or
            $pin.revision -isnot [string] -or $pin.revision -cne $Metadata.sourceBaseRevision -or
            $pin.treeDigest -isnot [string] -or $pin.treeDigest -cnotmatch '\A[a-f0-9]{64}\z') {
            throw 'Release record contains an invalid runtime pin.'
        }
    }
    foreach ($guide in $Metadata.documentationSha256.PSObject.Properties) {
        if ($guide.Name -cnotmatch '\Adocs/(?:guides/[^/]+\.md|update-agents\.md|workspace-overlay\.md)\z' -or
            $guide.Value -isnot [string] -or $guide.Value -notmatch '\A[a-f0-9]{64}\z') {
            throw 'Release record contains an invalid documentation digest.'
        }
    }
    foreach ($guide in 'docs/guides/usage-manual.md', 'docs/update-agents.md', 'docs/workspace-overlay.md') {
        if ($guide -cnotin $Metadata.documentationSha256.PSObject.Properties.Name) {
            throw 'Release record is missing a required documentation digest.'
        }
    }
}

function Get-ArchiveFiles($Zip) {
    $comparer = [StringComparer]::OrdinalIgnoreCase
    $files = [Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]]::new($comparer)
    $names = [Collections.Generic.HashSet[string]]::new($comparer)
    $directories = [Collections.Generic.Dictionary[string,string]]::new($comparer)

    foreach ($entry in $Zip.Entries) {
        $directory = $entry.FullName.EndsWith('/')
        $relative = if ($directory) { $entry.FullName.Substring(0, $entry.FullName.Length - 1) } else { $entry.FullName }
        $parts = $relative.Split('/')
        foreach ($part in $parts) {
            if (-not $part -or $part -match '[<>:"\\|?*\x00-\x1f]|[. ]$' -or
                $part -match '^(?:CON|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3]|CONIN\$|CONOUT\$)(?:\.|$)') {
                throw 'Release ZIP contains an unsafe entry path.'
            }
        }

        $unixType = ($entry.ExternalAttributes -shr 16) -band 0xf000
        if (($entry.ExternalAttributes -band 0x400) -or $unixType -notin @(0, 0x8000, 0x4000) -or
            ($directory -and ($unixType -eq 0x8000 -or $entry.Length -ne 0)) -or
            (-not $directory -and ($unixType -eq 0x4000 -or ($entry.ExternalAttributes -band 0x10)))) {
            throw 'Release ZIP contains a linked or unsupported entry.'
        }
        if (-not $names.Add($relative)) { throw 'Release ZIP contains duplicate or colliding entries.' }

        $parentCount = if ($directory) { $parts.Length } else { $parts.Length - 1 }
        $parent = ''
        for ($i = 0; $i -lt $parentCount; $i++) {
            $parent = if ($i -eq 0) { $parts[$i] } else { $parent + '/' + $parts[$i] }
            if ($files.ContainsKey($parent) -or ($directories.ContainsKey($parent) -and $directories[$parent] -cne $parent)) {
                throw 'Release ZIP contains duplicate or colliding entries.'
            }
            $directories[$parent] = $parent
        }
        if (-not $directory) {
            if ($directories.ContainsKey($relative)) { throw 'Release ZIP contains duplicate or colliding entries.' }
            $files.Add($relative, $entry)
        }
    }
    return [pscustomobject]@{ Files = $files; Directories = $directories.Values }
}

function Assert-SameRelease($Outer, $Inner) {
    Assert-ReleaseMetadata $Inner
    foreach ($field in 'version', 'platform', 'formal', 'node', 'sourceBaseRevision', 'localBuildChanges') {
        if ($Outer.$field -cne $Inner.$field) { throw 'Release ZIP metadata does not match the trusted record.' }
    }
    if ($Outer.installerSha256 -ine $Inner.installerSha256) { throw 'Release ZIP metadata does not match the trusted record.' }
    $outerPin = $Outer.runtimePin
    $innerPin = $Inner.runtimePin
    if ([bool]$outerPin -ne [bool]$innerPin -or
        ($outerPin -and ($outerPin.revision -cne $innerPin.revision -or $outerPin.treeDigest -cne $innerPin.treeDigest))) {
        throw 'Release ZIP runtime pin does not match the trusted record.'
    }
    $outerGuides = @($Outer.documentationSha256.PSObject.Properties)
    $innerGuides = @($Inner.documentationSha256.PSObject.Properties)
    if ($outerGuides.Count -ne $innerGuides.Count) { throw 'Release ZIP metadata does not match the trusted record.' }
    foreach ($guide in $outerGuides) {
        if ($guide.Name -cnotin $innerGuides.Name -or $guide.Value -ine $Inner.documentationSha256.($guide.Name)) {
            throw 'Release ZIP metadata does not match the trusted record.'
        }
    }
}

$archiveItem = Get-Item -LiteralPath $Archive -Force
$recordItem = Get-Item -LiteralPath $ReleaseRecord -Force
$destinationRoot = Get-Item -LiteralPath $InstallRoot -Force
if ($archiveItem -isnot [IO.FileInfo] -or $recordItem -isnot [IO.FileInfo] -or $destinationRoot -isnot [IO.DirectoryInfo]) {
    throw 'Select a ZIP file, its trusted release record, and an existing version parent directory.'
}
$root = $destinationRoot.FullName
Assert-NoReparsePoint $archiveItem.FullName
Assert-NoReparsePoint $recordItem.FullName
Assert-NoReparsePoint $root

if ($recordItem.Length -gt 1MB) { throw 'Trusted release record is too large.' }
$record = Get-Content -LiteralPath $recordItem.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-ReleaseMetadata $record
if ($record.file -isnot [string] -or $record.file -cne 'agents-workbench-react.zip' -or
    ($record.bytes -isnot [int] -and $record.bytes -isnot [long]) -or $record.bytes -le 0 -or
    $record.sha256 -isnot [string] -or $record.sha256 -notmatch '\A[a-f0-9]{64}\z') {
    throw 'Trusted release record is missing the ZIP name, size or SHA-256.'
}

$zipStream = [IO.File]::Open((Get-ExtendedPath $archiveItem.FullName), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
$zip = $null
$stage = $null
try {
    if ($zipStream.Length -ne $record.bytes) { throw 'Release ZIP size does not match the trusted record.' }
    $digest = Get-StreamSha256 $zipStream
    if ($digest -ine $record.sha256) { throw 'Release ZIP SHA-256 does not match the trusted record.' }
    $zipStream.Position = 0
    $zip = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Read, $true)
    $entries = Get-ArchiveFiles $zip
    $files = $entries.Files

    $required = @('workbench-release.json', 'start-workbench.cmd', 'runtime/node.exe', 'runtime/LICENSE',
        'tools/agents-workbench/prototype/serve.js', 'tools/agents-workbench/react/dist/index.html', 'scripts/install-agents.ps1')
    foreach ($file in ($required + $record.documentationSha256.PSObject.Properties.Name)) {
        if (-not $files.ContainsKey($file) -or $files[$file].Length -eq 0) { throw "Release ZIP is missing a required file ($file)." }
    }
    $metadataEntry = $files['workbench-release.json']
    if ($metadataEntry.Length -gt 1MB) { throw 'Release ZIP metadata is too large.' }
    $metadata = [IO.StreamReader]::new($metadataEntry.Open(), [Text.UTF8Encoding]::new($false, $true))
    try { $inner = $metadata.ReadToEnd() | ConvertFrom-Json }
    finally { $metadata.Dispose() }
    Assert-SameRelease $record $inner

    $destination = Join-Path $root ('agents-workbench-react-' + $record.version)
    if (Test-Path -LiteralPath $destination) { throw 'This release directory already exists and was left unchanged.' }
    Assert-NoReparsePoint $root
    $candidate = Join-Path $root ('.workbench-import-' + [Guid]::NewGuid().ToString('N'))
    $stage = (New-Item -ItemType Directory -Path $candidate).FullName
    $extendedStage = Get-ExtendedPath $stage
    foreach ($relative in $entries.Directories) {
        [void][IO.Directory]::CreateDirectory($extendedStage + '\' + $relative.Replace('/', '\'))
    }
    foreach ($relative in $files.Keys) {
        $entry = $files[$relative]
        $output = $extendedStage + '\' + $relative.Replace('/', '\')
        $source = $entry.Open()
        try {
            $target = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $source.CopyTo($target)
                if ($target.Length -ne $entry.Length) { throw 'Extracted file size does not match the ZIP entry.' }
            } finally { $target.Dispose() }
        } finally { $source.Dispose() }
    }

    $checks = @{ 'scripts/install-agents.ps1' = $record.installerSha256 }
    foreach ($guide in $record.documentationSha256.PSObject.Properties) { $checks.Add($guide.Name, $guide.Value) }
    foreach ($relative in $checks.Keys) {
        $extracted = [IO.File]::OpenRead($extendedStage + '\' + $relative.Replace('/', '\'))
        try { $actual = Get-StreamSha256 $extracted }
        finally { $extracted.Dispose() }
        if ($actual -ine $checks[$relative]) { throw "Extracted release file SHA-256 does not match the trusted record ($relative)." }
    }

    Assert-NoReparsePoint $stage
    [IO.Directory]::Move($extendedStage, (Get-ExtendedPath $destination))
    $stage = $null
    [pscustomobject]@{ state = 'imported'; version = $record.version; sourceBaseRevision = $record.sourceBaseRevision;
        sha256 = $digest; path = $destination } | ConvertTo-Json -Compress
} finally {
    if ($zip) { $zip.Dispose() }
    $zipStream.Dispose()
    if ($stage) {
        Assert-NoReparsePoint $stage
        if ([IO.Path]::GetDirectoryName($stage) -ine $root -or [IO.Path]::GetFileName($stage) -notmatch '^\.workbench-import-[a-f0-9]{32}$') {
            throw 'Unable to verify the temporary release directory for cleanup.'
        }
        [IO.Directory]::Delete((Get-ExtendedPath $stage), $true)
    }
}
