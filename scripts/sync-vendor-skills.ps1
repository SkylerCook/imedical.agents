param(
  [string]$AgentsRoot = ".agents",
  [string]$ProjectRoot = ".",
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

function Get-DedupSkillNames {
  param([string]$ProjectRootFull)
  $skills = @{}
  $userProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
  $pluginDir = Join-Path $userProfile ".claude/plugins"
  if (Test-Path -LiteralPath $pluginDir -PathType Container) {
    Get-ChildItem -Path $pluginDir -Recurse -Filter "SKILL.md" -ErrorAction SilentlyContinue | ForEach-Object {
      $parent = $_.Directory.Parent
      if ($null -ne $parent -and $parent.Name -eq "skills") { $skills[$_.Directory.Name] = $true }
    }
  }
  $userSkillsDir = Join-Path $userProfile ".claude/skills"
  if (Test-Path -LiteralPath $userSkillsDir -PathType Container) {
    Get-ChildItem -Path $userSkillsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $skills[$_.Name] = $true }
  }
  $projectSkillsDir = Join-Path $ProjectRootFull ".claude/skills"
  if (Test-Path -LiteralPath $projectSkillsDir -PathType Container) {
    Get-ChildItem -Path $projectSkillsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $skills[$_.Name] = $true }
  }
  return $skills
}

function Get-RuntimeSkillsDirectory {
  # Claude Code user-level skills directory.
  # Other runtimes (Codex, Copilot CLI, Gemini CLI) may use ~/.agents/skills/;
 # extend this function when cross-runtime support is required.
 $userProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
  $dirs = @()
  $claudeDir = Join-Path $userProfile ".claude/skills"
  if (Test-Path -LiteralPath $claudeDir -PathType Container) { $dirs += $claudeDir }
  $codexDir = Join-Path $userProfile ".codex/skills"
  if (Test-Path -LiteralPath $codexDir -PathType Container) { $dirs += $codexDir }
  if ($dirs.Count -eq 0) { $dirs += $claudeDir }
  return $dirs
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
$projectRootFull = Resolve-FullPath $ProjectRoot
$vendorRoot = Join-Path $agentsRootFull "vendor"
$runtimeSkillsDirs = Get-RuntimeSkillsDirectory
$dedupSkills = Get-DedupSkillNames -ProjectRootFull $projectRootFull
$results = New-Object System.Collections.Generic.List[object]

if (-not (Test-Path -LiteralPath $vendorRoot -PathType Container)) {
  $results.Add((Write-SyncResult -Status "vendor-missing" -Target $vendorRoot -Reason "no vendor directory"))
  $results | Format-List status, target, source, reason
  exit 0
}

# vendor/<vendor-name>/skills/<skill-name>/SKILL.md
foreach ($runtimeSkillsDir in $runtimeSkillsDirs) {
  Get-ChildItem -LiteralPath $vendorRoot -Directory | ForEach-Object {
  $vendorName = $_.Name
  $vendorSkillsDir = Join-Path $_.FullName "skills"
  if (Test-Path -LiteralPath $vendorSkillsDir -PathType Container) {
    Get-ChildItem -LiteralPath $vendorSkillsDir -Directory | ForEach-Object {
      $skillName = $_.Name
      $skillFile = Join-Path $_.FullName "SKILL.md"
      if (Test-Path -LiteralPath $skillFile -PathType Leaf) {
        if ($dedupSkills.ContainsKey($skillName)) {
          $results.Add((Write-SyncResult -Status "vendor-skill-deduped" -Target "vendor/$vendorName/skills/$skillName" -Reason "provided by plugin/user/project skill"))
          return
        }
        $targetPath = Join-Path $runtimeSkillsDir $skillName
        Sync-VendorSkillDirectory -SourcePath $_.FullName -TargetPath $targetPath -Mode $Mode -Reason "vendor/$vendorName/skills/$skillName" -Results $results
      }
    }
  }

  # vendor/<vendor-name>/SKILL.md -> ~/.claude/skills/<vendor-name>/
  $rootSkillFile = Join-Path $_.FullName "SKILL.md"
  if (Test-Path -LiteralPath $rootSkillFile -PathType Leaf) {
      if ($dedupSkills.ContainsKey($vendorName)) {
        $results.Add((Write-SyncResult -Status "vendor-skill-deduped" -Target "vendor/$vendorName" -Reason "provided by plugin/user/project skill"))
        return
      }
      $targetPath = Join-Path $runtimeSkillsDir $vendorName
    Sync-VendorSkillDirectory -SourcePath $_.FullName -TargetPath $targetPath -Mode $Mode -Reason "vendor/$vendorName" -Results $results
  }
  }
}

$results | Format-List status, target, source, reason
