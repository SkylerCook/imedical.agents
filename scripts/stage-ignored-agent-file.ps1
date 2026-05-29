param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,
  [string]$ProjectRoot = "."
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Get-RelativePathPortable {
  param(
    [string]$From,
    [string]$To
  )

  $fromFull = [System.IO.Path]::GetFullPath($From)
  $toFull = [System.IO.Path]::GetFullPath($To)
  if (-not $fromFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $fromFull = $fromFull + [System.IO.Path]::DirectorySeparatorChar
  }

  $fromUri = New-Object System.Uri($fromFull)
  $toUri = New-Object System.Uri($toFull)
  $relativeUri = $fromUri.MakeRelativeUri($toUri).ToString()
  return ([System.Uri]::UnescapeDataString($relativeUri) -replace "\\", "/")
}

function Convert-ToRepoRelativePath {
  param(
    [string]$RepoRoot,
    [string]$CandidatePath
  )

  $fullPath = Resolve-FullPath (Join-Path $RepoRoot $CandidatePath)
  $repoRootFull = Resolve-FullPath $RepoRoot
  if (-not $fullPath.StartsWith($repoRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside repository: $CandidatePath"
  }

  return Get-RelativePathPortable -From $repoRootFull -To $fullPath
}

function Test-AllowedPath {
  param([string]$RelativePath)

  return (
    $RelativePath -match "^scripts/[^/].+" -or
    $RelativePath -match "^plugins/[^/]+/scripts/[^/].+" -or
    $RelativePath -match "^rules/[^/].+" -or
    $RelativePath -match "^skills/[^/]+/SKILL\.md$"
  )
}

$projectRootFull = Resolve-FullPath $ProjectRoot

git -C $projectRootFull rev-parse --is-inside-work-tree | Out-Null

foreach ($inputPath in $Path) {
  $relativePath = Convert-ToRepoRelativePath -RepoRoot $projectRootFull -CandidatePath $inputPath

  if (-not (Test-AllowedPath -RelativePath $relativePath)) {
    Write-Error "Refuse to stage path outside allowed agent contribution areas: $relativePath"
    exit 1
  }

  if (-not (Test-Path -LiteralPath (Join-Path $projectRootFull $relativePath))) {
    Write-Error "Path does not exist: $relativePath"
    exit 1
  }

  $ignored = $false
  git -C $projectRootFull check-ignore -q -- $relativePath
  if ($LASTEXITCODE -eq 0) {
    $ignored = $true
  }

  git -C $projectRootFull add -f -- $relativePath

  [PSCustomObject]@{
    status = "staged"
    path = $relativePath
    ignored = $ignored
    command = "git add -f -- $relativePath"
  }
}
