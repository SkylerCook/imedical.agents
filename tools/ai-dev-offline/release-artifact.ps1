#requires -Version 5.1

$aiDevVersionPattern = '(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'

function Get-AiDevArtifactPath([string]$Directory, [string]$Product, [string]$Version) {
    if ($Version -notmatch ('\A' + $aiDevVersionPattern + '\z')) { throw "invalid-release-version: $Product" }
    Join-Path $Directory ($Product + '-' + $Version + '.zip')
}

function Assert-AiDevArtifactSlot([string]$Archive, [string]$Product) {
    $target = [IO.Path]::GetFullPath($Archive)
    $directory = [IO.Path]::GetDirectoryName($target)
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return }
    $pattern = '\A' + [regex]::Escape($Product) + '(?:-' + $aiDevVersionPattern + ')?\.zip\z'
    $previous = Get-ChildItem -LiteralPath $directory -Force -File -Filter '*.zip' | Where-Object {
        $_.Name -match $pattern -and $_.FullName -ine $target
    }
    if ($previous) { throw "previous-release-present: $Product; use an explicit candidate path and archive the previous release after verification" }
}
