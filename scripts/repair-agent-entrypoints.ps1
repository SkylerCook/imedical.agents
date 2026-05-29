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

function Backup-ExistingEntryPoint {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return ""
  }

  $backupPath = "$Path.bak"
  $index = 1
  while (Test-Path -LiteralPath $backupPath) {
    $backupPath = "$Path.bak.$index"
    $index++
  }

  Move-Item -LiteralPath $Path -Destination $backupPath
  return $backupPath
}

function Get-RelativeTarget {
  param(
    [string]$LinkPath,
    [string]$LinkTarget
  )

  if ([System.IO.Path]::IsPathRooted($LinkTarget)) {
    $linkDir = Split-Path -Parent $LinkPath
    return Get-RelativePathPortable -From $linkDir -To $LinkTarget
  }

  return ($LinkTarget -replace "\\", "/")
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$targetPath = Join-Path $projectRootFull $Target

if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
  Write-Error "Cannot repair agent entrypoints because $Target does not exist."
  exit 1
}

foreach ($entryPoint in $EntryPoints) {
  $entryPath = Join-Path $projectRootFull $entryPoint
  $backupPath = ""

  if (Test-Path -LiteralPath $entryPath) {
    $item = Get-Item -LiteralPath $entryPath -Force
    $isExpectedLink = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -and ((Get-RelativeTarget -LinkPath $entryPath -LinkTarget $item.Target) -eq $Target)
    if ($isExpectedLink) {
      [PSCustomObject]@{
        status = "ok"
        entrypoint = $entryPoint
        target = $Target
        backup = ""
      }
      continue
    }

    $backupPath = Backup-ExistingEntryPoint -Path $entryPath
  }

  try {
    New-Item -ItemType SymbolicLink -Path $entryPath -Target $targetPath | Out-Null
  }
  catch {
    $powerShellError = $_.Exception.Message
    & cmd.exe /c mklink "$entryPath" "$targetPath" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Cannot create symbolic link $entryPoint -> $Target. On Windows, enable Developer Mode or run cmd/PowerShell as Administrator, then create it manually with: mklink $entryPoint $Target. PowerShell error: $powerShellError"
      exit 1
    }
  }

  [PSCustomObject]@{
    status = "repaired"
    entrypoint = $entryPoint
    target = $Target
    backup = $backupPath
  }
}
