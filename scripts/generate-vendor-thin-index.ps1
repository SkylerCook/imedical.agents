param(
    [string]$AgentsRoot = ".agents",
    [string]$ProjectRoot = ".",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun",
    [switch]$Force,
    [string[]]$Skill = @(),
    [switch]$CleanupLegacyVendorSkills
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Resolve-FullPathFromBase {
    param(
        [string]$BasePath,
        [string]$Path
    )
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
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
    return [System.Uri]::UnescapeDataString($relativeUri) -replace "\\", "/"
}

function Write-Result {
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

function Get-MarkdownFrontmatterLines {
    param([string]$Path)

    $lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)
    if (($lines.Count -eq 0) -or ($lines[0].Trim() -ne "---")) {
        return @()
    }

    $frontmatter = New-Object System.Collections.Generic.List[string]
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq "---") {
            return @($frontmatter)
        }
        $frontmatter.Add($lines[$i])
    }

    return @()
}

function Select-FrontmatterFieldLines {
    param(
        [string[]]$FrontmatterLines,
        [string[]]$FieldNames
    )

    $selected = New-Object System.Collections.Generic.List[string]
    $fieldSet = @{}
    foreach ($fieldName in $FieldNames) {
        $fieldSet[$fieldName] = $true
    }

    $capture = $false
    foreach ($line in $FrontmatterLines) {
        $topLevelMatch = [System.Text.RegularExpressions.Regex]::Match($line, '^(?<key>[A-Za-z0-9_-]+)\s*:')
        if ($topLevelMatch.Success) {
            $capture = $fieldSet.ContainsKey($topLevelMatch.Groups["key"].Value)
        }

        if ($capture) {
            $selected.Add($line)
        }
    }

    return @($selected)
}

function Test-IsUnderPath {
    param(
        [string]$Path,
        [string]$ParentPath
    )
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    $parentFull = [System.IO.Path]::GetFullPath($ParentPath)
    if (-not $parentFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $parentFull = $parentFull + [System.IO.Path]::DirectorySeparatorChar
    }
    return $pathFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-VendorThinIndexSourcePath {
    param(
        [string]$TargetFile,
        [string]$ProjectRoot
    )
    $content = [System.IO.File]::ReadAllText($TargetFile, [System.Text.Encoding]::UTF8)
    if ($content -notmatch "thin-index") {
        return $null
    }

    $match = [System.Text.RegularExpressions.Regex]::Match($content, '(?<source>\.agents/vendor/[^\s`]+/SKILL\.md)')
    if (-not $match.Success) {
        return $null
    }
    return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $match.Groups["source"].Value))
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$agentsRootFull = Resolve-FullPathFromBase -BasePath $projectRootFull -Path $AgentsRoot
$vendorRoot = Join-Path $agentsRootFull "vendor"
$skillsTarget = Join-Path $agentsRootFull "skills"
$results = New-Object System.Collections.Generic.List[object]
$requestedSkills = @{}
foreach ($requestedSkill in $Skill) {
    if (-not [string]::IsNullOrWhiteSpace($requestedSkill)) { $requestedSkills[$requestedSkill] = $true }
}

if (-not (Test-Path -LiteralPath $vendorRoot -PathType Container)) {
    $results.Add((Write-Result -Status "vendor-missing" -Target "" -Source $vendorRoot -Reason ".agents/vendor/ does not exist"))
    $results | Format-List status, target, source, reason
    exit 0
}

# Legacy cleanup is deliberately opt-in for deployed projects.
if ($CleanupLegacyVendorSkills -and (Test-Path -LiteralPath $skillsTarget -PathType Container)) {
    Get-ChildItem -LiteralPath $skillsTarget -Directory | Sort-Object Name | ForEach-Object {
        $targetFile = Join-Path $_.FullName "SKILL.md"
        if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
            return
        }
        $sourcePath = Get-VendorThinIndexSourcePath -TargetFile $targetFile -ProjectRoot $projectRootFull
        if ($null -eq $sourcePath) {
            return
        }
        $skillName = $_.Name
        if ((-not $requestedSkills.ContainsKey($skillName)) -or (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf))) {
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile
            $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourcePath
            if ($Mode -eq "Write") {
               Remove-Item -LiteralPath $targetFile
                $results.Add((Write-Result -Status "removed" -Target $targetRel -Source $sourceRel -Reason "legacy vendor thin-index not required"))
           }
           else {
                $results.Add((Write-Result -Status "stale" -Target $targetRel -Source $sourceRel -Reason "legacy vendor thin-index not required"))
            }
        }
    }
}

# Scan vendor directories for two patterns:
# 1. vendor/<vendor>/skills/<skill>/SKILL.md
# 2. vendor/<vendor>/SKILL.md
Get-ChildItem -LiteralPath $vendorRoot -Directory | Sort-Object Name | ForEach-Object {
    $vendorName = $_.Name

    # Pattern 1: vendor/<vendor>/skills/<skill>/SKILL.md
    $vendorSkillsDir = Join-Path $_.FullName "skills"
    if (Test-Path -LiteralPath $vendorSkillsDir -PathType Container) {
        Get-ChildItem -LiteralPath $vendorSkillsDir -Directory | Sort-Object Name | ForEach-Object {
            $skillName = $_.Name
            if (-not $requestedSkills.ContainsKey($skillName)) { return }
            $sourceFile = Join-Path $_.FullName "SKILL.md"
            if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
                $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourceFile
                $results.Add((Write-Result -Status "missing" -Target "" -Source $sourceRel -Reason "vendor/$vendorName/skills/$skillName has no SKILL.md"))
                return
            }

            $targetFile = Join-Path (Join-Path $skillsTarget $skillName) "SKILL.md"
            $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourceFile
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile

            $skillTargetDir = Split-Path -Parent $targetFile
            if (Test-Path -LiteralPath $skillTargetDir -PathType Leaf) {
                $results.Add((Write-Result -Status "conflict" -Target (Get-RelativePathPortable -From $projectRootFull -To $skillTargetDir) -Source $sourceRel -Reason "skill target directory path is a file"))
                return
            }
            if (Test-Path -LiteralPath $targetFile -PathType Container) {
                $results.Add((Write-Result -Status "conflict" -Target $targetRel -Source $sourceRel -Reason "target SKILL.md path is a directory"))
                return
            }

            $contentLines = New-Object System.Collections.Generic.List[string]
            $frontmatterLines = Get-MarkdownFrontmatterLines -Path $sourceFile
            $selectedFrontmatterLines = Select-FrontmatterFieldLines `
                -FrontmatterLines $frontmatterLines `
                -FieldNames @("name", "description")
            $hasName = $false
            $hasDescription = $false
            foreach ($line in $selectedFrontmatterLines) {
                if ($line -match '^name\s*:') { $hasName = $true }
                if ($line -match '^description\s*:') { $hasDescription = $true }
            }

            $contentLines.Add("---")
            if ($hasName) {
                foreach ($line in $selectedFrontmatterLines) {
                    $contentLines.Add($line)
                }
            }
            else {
                $contentLines.Add("name: $skillName")
                foreach ($line in $selectedFrontmatterLines) {
                    if ($line -notmatch '^name\s*:') { $contentLines.Add($line) }
                }
            }
            if (-not $hasDescription) {
                $contentLines.Add("description: Thin index for vendor-provided $skillName skill.")
            }
            $contentLines.Add("thin-index: true")
            $contentLines.Add("source: $sourceRel")
            $contentLines.Add("---")
            $contentLines.Add("")

            @(
                "# Thin Index: $skillName",
                "",
                "This file is a thin-index and does not contain the full skill.",
                "",
                "Agent instruction: after reading this file, continue to read and follow the real vendor skill:",
                "",
                "- ``$sourceRel``",
                "",
                "If the task depends on project-specific facts or server capabilities, also read:",
                "",
                "- ``.agents/config/``",
                "- ``.mcp.json``",
                "",
                "Do not copy MCP connection facts into this file."
            ) | ForEach-Object { $contentLines.Add($_) }
            $content = @($contentLines) -join [Environment]::NewLine

            if (Test-Path -LiteralPath $targetFile) {
                $existing = [System.IO.File]::ReadAllText($targetFile, [System.Text.Encoding]::UTF8)
                if ($existing -eq $content) {
                    $results.Add((Write-Result -Status "unchanged" -Target $targetRel -Source $sourceRel -Reason $Mode))
                    return
                }
            }

            if ($Mode -eq "Write") {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
                [System.IO.File]::WriteAllText($targetFile, $content, [System.Text.UTF8Encoding]::new($false))
            }
            $results.Add((Write-Result -Status "generated" -Target $targetRel -Source $sourceRel -Reason $Mode))
        }
    }

    # Pattern 2: vendor/<vendor>/SKILL.md
    $rootSkillFile = Join-Path $_.FullName "SKILL.md"
    if (Test-Path -LiteralPath $rootSkillFile -PathType Leaf) {
        $skillName = $vendorName
        if (-not $requestedSkills.ContainsKey($skillName)) { return }
        $sourceFile = $rootSkillFile
        $targetFile = Join-Path (Join-Path $skillsTarget $skillName) "SKILL.md"
        $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourceFile
        $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile

        $skillTargetDir = Split-Path -Parent $targetFile
        if (Test-Path -LiteralPath $skillTargetDir -PathType Leaf) {
            $results.Add((Write-Result -Status "conflict" -Target (Get-RelativePathPortable -From $projectRootFull -To $skillTargetDir) -Source $sourceRel -Reason "skill target directory path is a file"))
            return
        }
        if (Test-Path -LiteralPath $targetFile -PathType Container) {
            $results.Add((Write-Result -Status "conflict" -Target $targetRel -Source $sourceRel -Reason "target SKILL.md path is a directory"))
            return
        }

        $contentLines = New-Object System.Collections.Generic.List[string]
        $frontmatterLines = Get-MarkdownFrontmatterLines -Path $sourceFile
        $selectedFrontmatterLines = Select-FrontmatterFieldLines `
            -FrontmatterLines $frontmatterLines `
            -FieldNames @("name", "description")
        $hasName = $false
        $hasDescription = $false
        foreach ($line in $selectedFrontmatterLines) {
            if ($line -match '^name\s*:') { $hasName = $true }
            if ($line -match '^description\s*:') { $hasDescription = $true }
        }

        $contentLines.Add("---")
        if ($hasName) {
            foreach ($line in $selectedFrontmatterLines) {
                $contentLines.Add($line)
            }
        }
        else {
            $contentLines.Add("name: $skillName")
            foreach ($line in $selectedFrontmatterLines) {
                if ($line -notmatch '^name\s*:') { $contentLines.Add($line) }
            }
        }
        if (-not $hasDescription) {
            $contentLines.Add("description: Thin index for vendor-provided $skillName skill.")
        }
        $contentLines.Add("thin-index: true")
        $contentLines.Add("source: $sourceRel")
        $contentLines.Add("---")
        $contentLines.Add("")

        @(
            "# Thin Index: $skillName",
            "",
            "This file is a thin-index and does not contain the full skill.",
            "",
            "Agent instruction: after reading this file, continue to read and follow the real vendor skill:",
            "",
            "- ``$sourceRel``",
            "",
            "If the task depends on project-specific facts or server capabilities, also read:",
            "",
            "- ``.agents/config/``",
            "- ``.mcp.json``",
            "",
            "Do not copy MCP connection facts into this file."
        ) | ForEach-Object { $contentLines.Add($_) }
        $content = @($contentLines) -join [Environment]::NewLine

        if (Test-Path -LiteralPath $targetFile) {
            $existing = [System.IO.File]::ReadAllText($targetFile, [System.Text.Encoding]::UTF8)
            if ($existing -eq $content) {
                $results.Add((Write-Result -Status "unchanged" -Target $targetRel -Source $sourceRel -Reason $Mode))
                return
            }
        }

        if ($Mode -eq "Write") {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
            [System.IO.File]::WriteAllText($targetFile, $content, [System.Text.UTF8Encoding]::new($false))
        }
        $results.Add((Write-Result -Status "generated" -Target $targetRel -Source $sourceRel -Reason $Mode))
    }
}

$results | Format-List status, target, source, reason
