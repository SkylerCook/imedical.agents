param(
    [string]$PluginPath = ".agents/plugins/agent-context-kit",
    [string]$ProjectRoot = ".",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun",
    [string[]]$ExcludeSkill = @(),
    [string[]]$ExcludeRule = @(),
    [switch]$Force
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

function Convert-FromUtf8Base64 {
    param([string]$Value)
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
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

function Get-ThinIndexSourcePath {
    param(
        [string]$TargetFile,
        [string]$ProjectRoot
    )
    $content = [System.IO.File]::ReadAllText($TargetFile, [System.Text.Encoding]::UTF8)
    if ($content -notmatch "thin-index") {
        return $null
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    $codeSpanMatches = [System.Text.RegularExpressions.Regex]::Matches($content, '`{1,2}(?<source>[^`]+?)`{1,2}')
    foreach ($match in $codeSpanMatches) {
        $candidates.Add($match.Groups["source"].Value.Trim())
    }

    foreach ($line in ($content -split "`r?`n")) {
        $sourceLineMatch = [System.Text.RegularExpressions.Regex]::Match($line, '(?<source>\.agents/plugins/[^\s`]+/rules/[^\s`]+\.md)')
        if ($sourceLineMatch.Success) {
            $candidates.Add($sourceLineMatch.Groups["source"].Value.Trim())
        }
    }

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $normalized = $candidate -replace "\\", "/"
        if (($normalized.Contains(".agents/plugins/")) -and ($normalized.Contains("/rules/")) -and ($normalized.EndsWith(".md"))) {
            return Resolve-FullPathFromBase -BasePath $ProjectRoot -Path $candidate
        }
    }

    return $null
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$pluginRootFull = Resolve-FullPathFromBase -BasePath $projectRootFull -Path $PluginPath

if (-not (Test-Path -LiteralPath $pluginRootFull -PathType Container)) {
    Write-Result -Status "missing" -Target "" -Source $pluginRootFull -Reason "PluginPath does not exist"
    exit 1
}

$rulesSource = Join-Path $pluginRootFull "rules"
$skillsSource = Join-Path $pluginRootFull "skills"
$rulesTarget = Join-Path $projectRootFull ".agents/rules"
$skillsTarget = Join-Path $projectRootFull ".agents/skills"
$pluginsRoot = Join-Path $projectRootFull ".agents/plugins"

$results = New-Object System.Collections.Generic.List[object]

if ((Test-Path -LiteralPath $rulesTarget -PathType Container) -and (Test-Path -LiteralPath $pluginsRoot -PathType Container)) {
    Get-ChildItem -LiteralPath $rulesTarget -File -Filter "*.md" | Sort-Object Name | ForEach-Object {
        $sourcePath = Get-ThinIndexSourcePath -TargetFile $_.FullName -ProjectRoot $projectRootFull
        if ($null -eq $sourcePath) {
            return
        }
        if ((Test-IsUnderPath -Path $sourcePath -ParentPath $pluginsRoot) -and (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf))) {
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To $_.FullName
            $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourcePath
            if ($Mode -eq "Write") {
                Remove-Item -LiteralPath $_.FullName
                $results.Add((Write-Result -Status "removed" -Target $targetRel -Source $sourceRel -Reason "stale plugin rule thin-index"))
            }
            else {
                $results.Add((Write-Result -Status "stale" -Target $targetRel -Source $sourceRel -Reason "stale plugin rule thin-index"))
            }
        }
    }
}

if (Test-Path -LiteralPath $rulesSource -PathType Container) {
    Get-ChildItem -LiteralPath $rulesSource -File -Filter "*.md" | Sort-Object Name | ForEach-Object {
        if ($ExcludeRule -contains $_.Name -or $ExcludeRule -contains $_.BaseName) {
            $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $_.FullName
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To (Join-Path $rulesTarget $_.Name)
            $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "excluded by parameter"))
            return
        }

        $sourceFile = $_.FullName
        $targetFile = Join-Path $rulesTarget $_.Name
        $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourceFile
        $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile
        if (Test-Path -LiteralPath $targetFile -PathType Container) {
            $results.Add((Write-Result -Status "conflict" -Target $targetRel -Source $sourceRel -Reason "target path is a directory"))
            return
        }
        $contentLines = New-Object System.Collections.Generic.List[string]
        $frontmatterLines = Get-MarkdownFrontmatterLines -Path $sourceFile
        if ($frontmatterLines.Count -gt 0) {
            $selectedFrontmatterLines = Select-FrontmatterFieldLines `
                -FrontmatterLines $frontmatterLines `
                -FieldNames @("name", "description", "task-affinity", "related")
            $contentLines.Add("---")
            foreach ($line in $selectedFrontmatterLines) {
                $contentLines.Add($line)
            }
            $contentLines.Add("thin-index: true")
            $contentLines.Add("source: $sourceRel")
            $contentLines.Add("---")
            $contentLines.Add("")
        }

        @(
            "$(Convert-FromUtf8Base64 'IyDoloTntKLlvJXvvJo=')$($_.BaseName)",
            "",
            "$(Convert-FromUtf8Base64 '5pys5paH5Lu25pivIHRoaW4taW5kZXggLyDoloTntKLlvJXvvIzkuI3ljIXlkKvlrozmlbTop4TliJnjgII=')",
            "",
            "$(Convert-FromUtf8Base64 'QWdlbnQg5oyH5Luk77ya6K+75Y+W5pys5paH5Lu25ZCO77yM5b+F6aG757un57ut6K+75Y+W5bm26YG15b6q5o+S5Lu25YaF55yf5a6e6KeE5YiZ5paH5Lu277ya')",
            "",
            "- ``$sourceRel``",
            "",
            "$(Convert-FromUtf8Base64 '5aaC5Lu75Yqh5raJ5Y+K6aG555uu5beu5byC5oiW5pyN5Yqh5Zmo6IO95Yqb77yM6L+Y6ZyA6KaB6K+75Y+W77ya')",
            "",
            "- ``.agents/config/``",
            "- ``.mcp.json``",
            "",
            "$(Convert-FromUtf8Base64 '5LiN6KaB5oqKIE1DUCDov57mjqXkv6Hmga/lpI3liLbliLDmnKzmlofku7bjgII=')"
        ) | ForEach-Object { $contentLines.Add($_) }
        $content = @($contentLines) -join [Environment]::NewLine

        if ((Test-Path -LiteralPath $targetFile) -and (-not $Force)) {
            $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "target exists; use -Force to overwrite"))
            return
        }

        if ($Mode -eq "Write") {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
            [System.IO.File]::WriteAllText($targetFile, $content, [System.Text.UTF8Encoding]::new($false))
        }
        $results.Add((Write-Result -Status "generated" -Target $targetRel -Source $sourceRel -Reason $Mode))
    }
}
else {
    $results.Add((Write-Result -Status "missing" -Target "" -Source (Get-RelativePathPortable -From $projectRootFull -To $rulesSource) -Reason "plugin has no rules directory"))
}

if (Test-Path -LiteralPath $skillsSource -PathType Container) {
    Get-ChildItem -LiteralPath $skillsSource -Directory | Sort-Object Name | ForEach-Object {
        $skillName = $_.Name
        $sourceFile = Join-Path $_.FullName "SKILL.md"
        if ($ExcludeSkill -contains $skillName) {
            $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourceFile
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To (Join-Path (Join-Path $skillsTarget $skillName) "SKILL.md")
            $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "excluded by parameter"))
            return
        }

        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            $results.Add((Write-Result -Status "missing" -Target "" -Source (Get-RelativePathPortable -From $projectRootFull -To $sourceFile) -Reason "skill directory has no SKILL.md"))
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
        $content = @(
            "---",
            "name: $skillName",
            "description: Thin index for plugin-provided $skillName skill. $(Convert-FromUtf8Base64 '6K+75Y+W5ZCO5b+F6aG757un57ut6K+75Y+W5o+S5Lu25YaF55yf5a6eIFNLSUxMLm1k44CC')",
            "---",
            "",
            "$(Convert-FromUtf8Base64 'IyDoloTntKLlvJXvvJo=')$skillName",
            "",
            "$(Convert-FromUtf8Base64 '5pys5paH5Lu25pivIHRoaW4taW5kZXggLyDoloTntKLlvJXvvIzkuI3ljIXlkKvlrozmlbQgc2tpbGzjgII=')",
            "",
            "$(Convert-FromUtf8Base64 'QWdlbnQg5oyH5Luk77ya6K+75Y+W5pys5paH5Lu25ZCO77yM5b+F6aG757un57ut6K+75Y+W5bm26YG15b6q5o+S5Lu25YaF55yf5a6eIHNraWxs77ya')",
            "",
            "- ``$sourceRel``",
            "",
            "$(Convert-FromUtf8Base64 '5aaC5Lu75Yqh5raJ5Y+K6aG555uu5beu5byC5oiW5pyN5Yqh5Zmo6IO95Yqb77yM6L+Y6ZyA6KaB6K+75Y+W77ya')",
            "",
            "- ``.agents/config/``",
            "- ``.mcp.json``",
            "",
            "$(Convert-FromUtf8Base64 '5LiN6KaB5oqKIE1DUCDov57mjqXkv6Hmga/lpI3liLbliLDmnKzmlofku7bjgII=')"
        ) -join [Environment]::NewLine

        if ((Test-Path -LiteralPath $targetFile) -and (-not $Force)) {
            $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "target exists; use -Force to overwrite"))
            return
        }

        if ($Mode -eq "Write") {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
            [System.IO.File]::WriteAllText($targetFile, $content, [System.Text.UTF8Encoding]::new($false))
        }
        $results.Add((Write-Result -Status "generated" -Target $targetRel -Source $sourceRel -Reason $Mode))
    }
}
else {
    $results.Add((Write-Result -Status "missing" -Target "" -Source (Get-RelativePathPortable -From $projectRootFull -To $skillsSource) -Reason "plugin has no skills directory"))
}

$results | Format-List status, target, source, reason
