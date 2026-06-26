param(
  [string]$AgentsRoot = ".agents",
  [ValidateSet("DryRun", "Write")]
  [string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"

function Write-SyncResult {
  param(
    [string]$Status,
    [string]$Target,
    [string]$Source,
    [string]$Reason = ""
  )
  [PSCustomObject]@{
    status = $Status
    target = $Target
    source = $Source
    reason = $Reason
  }
}

function Resolve-FullPath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Get-RuntimeSkillsDirectory {
  # Claude Code user-level skills directory.
  # Other runtimes (Codex, Copilot CLI, Gemini CLI) may use ~/.agents/skills/;
  # extend this function when cross-runtime support is required.
  $userProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
  return Join-Path $userProfile ".claude/skills"
}

function Sync-VendorSkillDirectory {
  param(
    [string]$SourcePath,
    [string]$TargetPath,
    [string]$Mode,
    [string]$Reason,
    [object]$Results
  )

  if ($Mode -eq "Write") {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetPath) | Out-Null
    if (Test-Path -LiteralPath $TargetPath) {
      Remove-Item -Recurse -Force -LiteralPath $TargetPath
    }
    Copy-Item -Recurse -Force -LiteralPath $SourcePath -Destination $TargetPath
  }

  $Results.Add((Write-SyncResult -Status "vendor-skill-synced" -Target $TargetPath -Source $SourcePath -Reason $Reason))
}

$agentsRootFull = Resolve-FullPath $AgentsRoot
$vendorRoot = Join-Path $agentsRootFull "vendor"
$runtimeSkillsDir = Get-RuntimeSkillsDirectory
$results = New-Object System.Collections.Generic.List[object]

if (-not (Test-Path -LiteralPath $vendorRoot -PathType Container)) {
  $results.Add((Write-SyncResult -Status "vendor-missing" -Target $vendorRoot -Reason "no vendor directory"))
  $results | Format-List status, target, source, reason
  exit 0
}

# vendor/<vendor-name>/skills/<skill-name>/SKILL.md -> ~/.claude/skills/<skill-name>/
Get-ChildItem -LiteralPath $vendorRoot -Directory | ForEach-Object {
  $vendorName = $_.Name
  $vendorSkillsDir = Join-Path $_.FullName "skills"
  if (Test-Path -LiteralPath $vendorSkillsDir -PathType Container) {
    Get-ChildItem -LiteralPath $vendorSkillsDir -Directory | ForEach-Object {
      $skillName = $_.Name
      $skillFile = Join-Path $_.FullName "SKILL.md"
      if (Test-Path -LiteralPath $skillFile -PathType Leaf) {
        $targetPath = Join-Path $runtimeSkillsDir $skillName
        Sync-VendorSkillDirectory -SourcePath $_.FullName -TargetPath $targetPath -Mode $Mode -Reason "vendor/$vendorName/skills/$skillName" -Results $results
      }
    }
  }

  # vendor/<vendor-name>/SKILL.md -> ~/.claude/skills/<vendor-name>/
  $rootSkillFile = Join-Path $_.FullName "SKILL.md"
  if (Test-Path -LiteralPath $rootSkillFile -PathType Leaf) {
    $targetPath = Join-Path $runtimeSkillsDir $vendorName
    Sync-VendorSkillDirectory -SourcePath $_.FullName -TargetPath $targetPath -Mode $Mode -Reason "vendor/$vendorName" -Results $results
  }
}

$results | Format-List status, target, source, reason
