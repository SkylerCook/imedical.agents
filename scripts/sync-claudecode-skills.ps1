param(
    [string]$AgentsRoot = ".agents",
    [string]$ProjectRoot = ".",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Get-RelativePathPortable {
    param([string]$From, [string]$To)
    $fromFull = [System.IO.Path]::GetFullPath($From)
    $toFull = [System.IO.Path]::GetFullPath($To)
    if (-not $fromFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $fromFull = $fromFull + [System.IO.Path]::DirectorySeparatorChar
    }
    $fromUri = New-Object System.Uri($fromFull)
    $toUri = New-Object System.Uri($toFull)
    $relativeUri = $fromUri.MakeRelativeUri($toUri).ToString()
    return [System.Uri]::UnescapeDataString($relativeUri) -replace "\\", "/"
}

function Write-Result {
    param([string]$Status, [string]$Target = "", [string]$Source = "", [string]$Reason = "", [string]$Phase = "")
    [PSCustomObject]@{ status = $Status; target = $Target; source = $Source; reason = $Reason; phase = $Phase }
}

function Get-PluginSkillNames {
    param([string]$BaseDir)
    $skills = @{}
    if (-not (Test-Path -LiteralPath $BaseDir -PathType Container)) { return $skills }
    Get-ChildItem -Path $BaseDir -Recurse -Filter "SKILL.md" -ErrorAction SilentlyContinue | ForEach-Object {
        $parentDir = $_.Directory.Parent
        if ($null -ne $parentDir -and $parentDir.Name -eq "skills") {
            $skills[$_.Directory.Name] = $true
        }
    }
    return $skills
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$agentsRootFull = Resolve-FullPath $AgentsRoot
$skillsSource = Join-Path $agentsRootFull "skills"
$targetDir = Join-Path $projectRootFull ".claude/skills"
$results = New-Object System.Collections.Generic.List[object]

if (-not (Test-Path -LiteralPath $skillsSource -PathType Container)) {
    $results.Add((Write-Result -Status "missing" -Target "" -Source $skillsSource -Reason ".agents/skills/ does not exist"))
    $results | Format-List status, target, source, reason, phase
    exit 0
}

# Collect dedup sources
$dedupSkills = @{}
$userProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)

# 1. Plugin skills (user-level, any depth)
$pluginDir = Join-Path $userProfile ".claude/plugins"
$pluginSkillCount = 0
if (Test-Path -LiteralPath $pluginDir -PathType Container) {
    $pluginSkills = Get-PluginSkillNames -BaseDir $pluginDir
    $pluginSkillCount = $pluginSkills.Count
    foreach ($k in $pluginSkills.Keys) { $dedupSkills[$k] = $true }
}

# 2. User-level claude skills
$userSkillsDir = Join-Path $userProfile ".claude/skills"
$userSkillCount = 0
if (Test-Path -LiteralPath $userSkillsDir -PathType Container) {
    $userDirs = @(Get-ChildItem -Path $userSkillsDir -Directory -ErrorAction SilentlyContinue)
    $userSkillCount = $userDirs.Count
    foreach ($d in $userDirs) { $dedupSkills[$d.Name] = $true }
}

# 3. Project-level .claude/skills (already synced)
$projectSkillCount = 0
if (Test-Path -LiteralPath $targetDir -PathType Container) {
    $projectDirs = @(Get-ChildItem -Path $targetDir -Directory -ErrorAction SilentlyContinue)
    $projectSkillCount = $projectDirs.Count
    foreach ($d in $projectDirs) { $dedupSkills[$d.Name] = $true }
}

$allProjectSkills = @(Get-ChildItem -Path $skillsSource -Directory)
Write-Host "Project skills: $($allProjectSkills.Count)"
Write-Host "Dedup: plugins=$pluginSkillCount, user-skills=$userSkillCount, project-skills=$projectSkillCount, total=$($dedupSkills.Count)"
Write-Host "Target: $targetDir"

if ($Mode -eq "Write" -and -not (Test-Path -LiteralPath $targetDir -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

foreach ($skill in $allProjectSkills) {
    $skillName = $skill.Name
    $sourceSkillFile = Join-Path $skill.FullName "SKILL.md"
    if (-not (Test-Path -LiteralPath $sourceSkillFile -PathType Leaf)) { continue }

    $skillTargetDir = Join-Path $targetDir $skillName
    $skillTargetFile = Join-Path $skillTargetDir "SKILL.md"
    $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $skill.FullName
    $targetRel = Get-RelativePathPortable -From $projectRootFull -To $skillTargetFile

    # Dedup: skip if already provided by another source
    if ($dedupSkills.ContainsKey($skillName)) {
        $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "provided by dedup source" -Phase "claudecode-skills"))
        continue
    }

    # Content check
    if (Test-Path -LiteralPath $skillTargetFile -PathType Leaf) {
        $existing = [System.IO.File]::ReadAllText($skillTargetFile, [System.Text.Encoding]::UTF8)
        $sourceContent = [System.IO.File]::ReadAllText($sourceSkillFile, [System.Text.Encoding]::UTF8)
        $normalized = $sourceContent -replace 'source: \.agents/', "source: $($projectRootFull -replace '\\', '/')/.agents/"
        if ($existing -eq $normalized) {
            $results.Add((Write-Result -Status "unchanged" -Target $targetRel -Source $sourceRel -Reason $Mode -Phase "claudecode-skills"))
            continue
        }
    }

    if ($Mode -eq "Write") {
        if (-not (Test-Path -LiteralPath $skillTargetDir -PathType Container)) {
            New-Item -ItemType Directory -Force -Path $skillTargetDir | Out-Null
        }
        $content = [System.IO.File]::ReadAllText($sourceSkillFile, [System.Text.Encoding]::UTF8)
        $content = $content -replace 'source: \.agents/', "source: $($projectRootFull -replace '\\', '/')/.agents/"
        [System.IO.File]::WriteAllText($skillTargetFile, $content, [System.Text.UTF8Encoding]::new($false))
        $results.Add((Write-Result -Status "generated" -Target $targetRel -Source $sourceRel -Reason "synced to .claude/skills/" -Phase "claudecode-skills"))
    }
    else {
        $results.Add((Write-Result -Status "generated" -Target $targetRel -Source $sourceRel -Reason $Mode -Phase "claudecode-skills"))
    }
}

$results | Format-List status, target, source, reason, phase
