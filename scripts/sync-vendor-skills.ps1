param(
  [string]$AgentsRoot = ".agents",
  [string]$ProjectRoot = ".",
  [ValidateSet("DryRun", "Write")]
  [string]$Mode = "DryRun",
  [string[]]$Skill = @(),
  [ValidateSet("Auto", "ClaudeCode", "Codex")]
  [string]$Runtime = "Auto",
  [switch]$ReportLegacy
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([string]$BasePath, [string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
  return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Write-Result {
  param([string]$Status, [string]$Target = "", [string]$Source = "", [string]$Reason = "")
  [PSCustomObject]@{ status=$Status; target=$Target; source=$Source; reason=$Reason }
}

function Find-VendorSkill {
  param([string]$VendorRoot, [string]$Name)
  foreach ($vendor in @(Get-ChildItem -LiteralPath $VendorRoot -Directory -ErrorAction SilentlyContinue)) {
    $nested = Join-Path $vendor.FullName "skills/$Name"
    if (Test-Path -LiteralPath (Join-Path $nested "SKILL.md") -PathType Leaf) { return $nested }
    if (($vendor.Name -eq $Name) -and (Test-Path -LiteralPath (Join-Path $vendor.FullName "SKILL.md") -PathType Leaf)) { return $vendor.FullName }
  }
  return $null
}

function Find-RuntimeProvidedSkill {
  param([object]$RuntimeTarget, [string]$Name, [string]$UserProfile, [string]$ProjectRoot)
  $direct = Join-Path $RuntimeTarget.path $Name
  if (Test-Path -LiteralPath (Join-Path $direct "SKILL.md") -PathType Leaf) { return $direct }
  if ($RuntimeTarget.runtime -eq "ClaudeCode") {
    $projectSkill = Join-Path $ProjectRoot ".claude/skills/$Name"
    if (Test-Path -LiteralPath (Join-Path $projectSkill "SKILL.md") -PathType Leaf) { return $projectSkill }
    $pluginRoot = Join-Path $UserProfile ".claude/plugins"
    if (Test-Path -LiteralPath $pluginRoot -PathType Container) {
      $match = Get-ChildItem -LiteralPath $pluginRoot -Recurse -Filter "SKILL.md" -ErrorAction SilentlyContinue | Where-Object {
        ($_.Directory.Name -eq $Name) -and ($null -ne $_.Directory.Parent) -and ($_.Directory.Parent.Name -eq "skills")
      } | Select-Object -First 1
      if ($null -ne $match) { return $match.Directory.FullName }
    }
  }
  return $null
}

$projectRootFull = Resolve-FullPath -BasePath (Get-Location) -Path $ProjectRoot
$agentsRootFull = Resolve-FullPath -BasePath $projectRootFull -Path $AgentsRoot
$vendorRoot = Join-Path $agentsRootFull "vendor"
$results = New-Object System.Collections.Generic.List[object]

if (($Mode -eq "Write") -and ($Skill.Count -eq 0)) {
  Write-Result -Status "vendor-skill-selection-required" -Target $vendorRoot -Reason "Write requires explicit -Skill; full vendor sync is disabled" | Format-List status, target, source, reason
  exit 1
}
if (-not (Test-Path -LiteralPath $vendorRoot -PathType Container)) {
  Write-Result -Status "vendor-missing" -Target $vendorRoot -Reason "no vendor directory" | Format-List status, target, source, reason
  exit 0
}

$userProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
$runtimeTargets = @()
if ($Runtime -in @("Auto", "ClaudeCode")) {
  $claudeTarget = Join-Path $userProfile ".claude/skills"
  if (($Runtime -eq "ClaudeCode") -or (Test-Path -LiteralPath (Split-Path -Parent $claudeTarget) -PathType Container)) {
    $runtimeTargets += [PSCustomObject]@{ runtime="ClaudeCode"; path=$claudeTarget }
  }
}
if ($Runtime -in @("Auto", "Codex")) {
  $codexTarget = Join-Path $userProfile ".codex/skills"
  if (($Runtime -eq "Codex") -or (Test-Path -LiteralPath (Split-Path -Parent $codexTarget) -PathType Container)) {
    $runtimeTargets += [PSCustomObject]@{ runtime="Codex"; path=$codexTarget }
  }
}

foreach ($name in @($Skill | Sort-Object -Unique)) {
  $source = Find-VendorSkill -VendorRoot $vendorRoot -Name $name
  if ($null -eq $source) {
    $results.Add((Write-Result -Status "vendor-skill-source-missing" -Target $name -Reason "requested vendor skill not found"))
    continue
  }
  foreach ($target in $runtimeTargets) {
    $targetPath = Join-Path $target.path $name
    $providedPath = Find-RuntimeProvidedSkill -RuntimeTarget $target -Name $name -UserProfile $userProfile -ProjectRoot $projectRootFull
    if ($null -ne $providedPath) {
      $results.Add((Write-Result -Status "vendor-skill-reused" -Target $providedPath -Source $source -Reason ($target.runtime + " already provides canonical skill")))
      continue
    }
    if (Test-Path -LiteralPath $targetPath) {
      $results.Add((Write-Result -Status "vendor-skill-conflict" -Target $targetPath -Source $source -Reason ($target.runtime + " target exists without SKILL.md; not overwritten")))
      continue
    }
    if ($Mode -eq "Write") {
      New-Item -ItemType Directory -Force -Path $target.path | Out-Null
      Copy-Item -LiteralPath $source -Destination $targetPath -Recurse
    }
    $results.Add((Write-Result -Status "vendor-skill-synced" -Target $targetPath -Source $source -Reason $target.runtime))
  }
}

if ($ReportLegacy) {
  $vendorNames = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($vendor in @(Get-ChildItem -LiteralPath $vendorRoot -Directory -ErrorAction SilentlyContinue)) {
    $rootSkill = Join-Path $vendor.FullName "SKILL.md"
    if (Test-Path -LiteralPath $rootSkill -PathType Leaf) { [void]$vendorNames.Add($vendor.Name) }
    $nestedRoot = Join-Path $vendor.FullName "skills"
    if (Test-Path -LiteralPath $nestedRoot -PathType Container) {
      Get-ChildItem -LiteralPath $nestedRoot -Directory | ForEach-Object {
        if (Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") -PathType Leaf) { [void]$vendorNames.Add($_.Name) }
      }
    }
  }
  foreach ($target in $runtimeTargets) {
    foreach ($name in $vendorNames) {
      $targetPath = Join-Path $target.path $name
      if (Test-Path -LiteralPath (Join-Path $targetPath "SKILL.md") -PathType Leaf) {
        $results.Add((Write-Result -Status "legacy-runtime-skill-detected" -Target $targetPath -Reason ($target.runtime + "; report only, never auto-delete")))
      }
    }
  }
}

$results | Format-List status, target, source, reason
