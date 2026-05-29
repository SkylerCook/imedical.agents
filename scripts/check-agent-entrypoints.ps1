param(
  [string]$ProjectRoot = ".",
  [string]$Target = "AGENTS.md",
  [string[]]$EntryPoints = @("CLAUDE.md", "CODEBUDDY.md")
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Get-RelativeTarget {
  param(
    [string]$LinkPath,
    [string]$LinkTarget
  )

  if ([System.IO.Path]::IsPathRooted($LinkTarget)) {
    $linkDir = Split-Path -Parent $LinkPath
    $relative = [System.IO.Path]::GetRelativePath($linkDir, $LinkTarget)
    return ($relative -replace "\\", "/")
  }

  return ($LinkTarget -replace "\\", "/")
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$targetPath = Join-Path $projectRootFull $Target
$targetExists = Test-Path -LiteralPath $targetPath -PathType Leaf
$hasFailure = $false

foreach ($entryPoint in $EntryPoints) {
  $entryPath = Join-Path $projectRootFull $entryPoint
  $status = "ok"
  $reason = ""
  $actualTarget = ""

  if (-not $targetExists) {
    $status = "missing"
    $reason = "target missing"
    $hasFailure = $true
  }
  elseif (-not (Test-Path -LiteralPath $entryPath)) {
    $status = "missing"
    $reason = "entrypoint missing"
    $hasFailure = $true
  }
  else {
    $item = Get-Item -LiteralPath $entryPath -Force
    if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      $status = "not-symlink"
      $reason = "entrypoint is not a symbolic link"
      $hasFailure = $true
    }
    else {
      $actualTarget = Get-RelativeTarget -LinkPath $entryPath -LinkTarget $item.Target
      if ($actualTarget -ne $Target) {
        $status = "wrong-target"
        $reason = "entrypoint target is not $Target"
        $hasFailure = $true
      }
    }
  }

  [PSCustomObject]@{
    status = $status
    entrypoint = $entryPoint
    target = $Target
    actualTarget = $actualTarget
    reason = $reason
  }
}

if ($hasFailure) {
  exit 1
}
