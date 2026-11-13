param(
    [string]$PluginPath = ".agents/plugins/agent-context-kit",
    [string]$ProjectRoot = ".",
    [string]$ContextRoot = "",
    [string]$CapabilityRoot = "",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun",
    [string[]]$ExcludeSkill = @(),
    [string[]]$ExcludeRule = @(),
    [switch]$Force,
    [switch]$Remove
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

function Get-CapabilityLogicalPath {
    param([string]$Path)
    $relative = Get-RelativePathPortable -From $capabilityRootFull -To $Path
    return ".agents/" + $relative.TrimStart("/")
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

function Update-ManagedThinIndex {
    param([string]$TargetFile, [string]$TargetRel, [string]$SourceRel,
          [string]$Content, [string[]]$Fields, [string[]]$LegacyHashes = @())

    # Never traverse a generated target link, including missing children of a junction.
    $cursor = $TargetFile
    while ($cursor -and (($cursor -eq $contextRootFull) -or (Test-IsUnderPath $cursor $contextRootFull))) {
        $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue
        if ($null -ne $entry -and (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            (($cursor -ne $TargetFile) -and (-not $entry.PSIsContainer)) -or
            (($cursor -eq $TargetFile) -and $entry.PSIsContainer))) {
            return Write-Result 'thin-index-conflict' $TargetRel $SourceRel 'linked or invalid target preserved'
        }
        if ($cursor -eq $contextRootFull) { break }
        $cursor = Split-Path -Parent $cursor
    }

    $status = 'generated'
    if (Test-Path -LiteralPath $TargetFile -PathType Leaf) {
        $original = [IO.File]::ReadAllText($TargetFile, [Text.Encoding]::UTF8)
        $existing = $original.Replace("`r`n", "`n").TrimStart([char]0xFEFF)
        $expected = $Content.Replace("`r`n", "`n")
        if ($existing -ceq $expected) {
            if ($script:Remove) {
                if ($Mode -eq 'Write') {
                    if ([IO.File]::ReadAllText($TargetFile, [Text.Encoding]::UTF8) -cne $original) { return Write-Result 'thin-index-conflict' $TargetRel $SourceRel 'target changed before removal' }
                    Remove-Item -LiteralPath $TargetFile
                }
                return Write-Result 'removed' $TargetRel $SourceRel 'disabled managed entry'
            }
            return Write-Result 'unchanged' $TargetRel $SourceRel 'managed thin-index is current'
        }
        # Only generated metadata may vary. Source, marker, unknown fields and body
        # must still match the current template exactly; a marker alone is not ownership.
        $headerPattern = '\A---\n(?<header>[\s\S]*?)\n---(?:\n|$)'
        $oldHeader = [regex]::Match($existing, $headerPattern)
        $newHeader = [regex]::Match($expected, $headerPattern)
        $managed = $false
        if ($oldHeader.Success -and $newHeader.Success) {
            $fieldPattern = '(?m)^(?:' + ($Fields -join '|') + '):[^\n]*(?:\n[ \t]+[^\n]*)*\n?'
            $oldFixed = [regex]::Replace($oldHeader.Groups['header'].Value + "`n", $fieldPattern, '')
            $newFixed = [regex]::Replace($newHeader.Groups['header'].Value + "`n", $fieldPattern, '')
            $managed = ($oldFixed -ceq $newFixed) -and
                ($existing.Substring($oldHeader.Length) -ceq $expected.Substring($newHeader.Length))
        }
        if (-not $managed -and $LegacyHashes.Count -gt 0) {
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($existing)))).Replace('-', '').ToLowerInvariant() }
            finally { $sha.Dispose() }
            if ($LegacyHashes -contains $hash) { $managed = $true; $status = 'skill-owner-migrated' }
        }
        if (-not $managed) {
            $conflict = if ($LegacyHashes.Count -gt 0) { 'skill-owner-migration-conflict' } else { 'thin-index-conflict' }
            return Write-Result $conflict $TargetRel $SourceRel 'custom or unrecognized content preserved; Force does not bypass ownership'
        }
        if ($status -ne 'skill-owner-migrated') { $status = 'updated' }
        if ($Mode -ne 'Write') {
            if ($status -eq 'skill-owner-migrated') { return Write-Result $status $TargetRel $SourceRel $Mode }
            return Write-Result 'thin-index-stale' $TargetRel $SourceRel 'managed thin-index differs; run Write to refresh'
        }
        if ([IO.File]::ReadAllText($TargetFile, [Text.Encoding]::UTF8) -cne $original) {
            return Write-Result 'thin-index-conflict' $TargetRel $SourceRel 'target changed during generation'
        }
    }
    if ($script:Remove) {
        if ((Test-Path -LiteralPath $TargetFile -PathType Leaf) -and $Mode -eq 'Write') { Remove-Item -LiteralPath $TargetFile }
        return Write-Result 'removed' $TargetRel $SourceRel 'disabled managed entry'
    }
    if ($Mode -eq 'Write') {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetFile) | Out-Null
        [IO.File]::WriteAllText($TargetFile, $Content, [Text.UTF8Encoding]::new($false))
    }
    return Write-Result $status $TargetRel $SourceRel $Mode
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

function Get-RuleThinIndexBody {
    param([string]$RuleName, [string]$SourceRel)
    return @(
        "$(Convert-FromUtf8Base64 'IyDoloTntKLlvJXvvJo=')$RuleName",
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
    ) -join [Environment]::NewLine
}

function Get-SkillThinIndexBody {
    param([string]$SkillName, [string]$SourceRel)
    return @(
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
}

function Get-ManagedThinIndexMetadata {
    param([string]$Content, [string[]]$Fields = @('name', 'description', 'thin-index', 'source'))
    $normalized = $Content.Replace("`r`n", "`n").TrimStart([char]0xFEFF)
    $header = [regex]::Match($normalized, '\A---\n(?<header>[\s\S]*?)\n---(?:\n|$)(?<body>[\s\S]*)\z')
    if (-not $header.Success) { return $null }
    $headerFields = $header.Groups['header'].Value
    $source = [regex]::Matches($headerFields, '(?m)^source:[ \t]*([^\n]+?)[ \t]*$')
    $marker = [regex]::Matches($headerFields, '(?m)^thin-index:[ \t]*true[ \t]*$')
    $fieldPattern = '(?m)^(?:' + ($Fields -join '|') + '):[^\n]*(?:\n[ \t]+[^\n]*)*\n?'
    $unknown = [regex]::Replace($headerFields + "`n", $fieldPattern, '')
    if ($source.Count -ne 1 -or $marker.Count -ne 1 -or $unknown.Trim().Length -ne 0) { return $null }
    return [pscustomobject]@{ source = $source[0].Groups[1].Value.Trim().Replace('\', '/'); body = $header.Groups['body'].Value.Trim() }
}

$projectRootFull = Resolve-FullPath $ProjectRoot
if ([string]::IsNullOrWhiteSpace($ContextRoot) -or [string]::IsNullOrWhiteSpace($CapabilityRoot)) {
    Import-Module (Join-Path $PSScriptRoot "lib/WorkspaceContext.psm1") -Force
    $workspaceContext = Resolve-AgentWorkspaceContext -ProjectRoot $projectRootFull
    if ([string]::IsNullOrWhiteSpace($ContextRoot)) { $ContextRoot = $workspaceContext.contextRoot }
    if ([string]::IsNullOrWhiteSpace($CapabilityRoot)) { $CapabilityRoot = $workspaceContext.capabilityRoot }
}
$contextRootFull = Resolve-FullPathFromBase -BasePath $projectRootFull -Path $ContextRoot
$capabilityRootFull = Resolve-FullPathFromBase -BasePath $projectRootFull -Path $CapabilityRoot
$pluginRootFull = if ([System.IO.Path]::IsPathRooted($PluginPath)) { Resolve-FullPath $PluginPath } else {
    $logicalPrefix = ".agents/"
    $pluginPathNormalized = $PluginPath.Replace('\', '/')
    if ($pluginPathNormalized.StartsWith($logicalPrefix)) {
        Resolve-FullPathFromBase -BasePath $capabilityRootFull -Path ($pluginPathNormalized.Substring($logicalPrefix.Length))
    } else { Resolve-FullPathFromBase -BasePath $capabilityRootFull -Path $PluginPath }
}

if (-not (Test-Path -LiteralPath $pluginRootFull -PathType Container)) {
    Write-Result -Status "missing" -Target "" -Source $pluginRootFull -Reason "PluginPath does not exist"
    exit 1
}

$rulesSource = Join-Path $pluginRootFull "rules"
$skillsSource = Join-Path $pluginRootFull "skills"
$rulesTarget = Join-Path $contextRootFull "rules"
$skillsTarget = Join-Path $contextRootFull "skills"
$pluginsRoot = Join-Path $capabilityRootFull "plugins"

# The updater calls this canonical entry directly; owner policy must not depend on a wrapper.
$pluginManifestPath = Join-Path $pluginRootFull ".agents-plugin/plugin.json"
$pluginManifest = $null
if (Test-Path -LiteralPath $pluginManifestPath -PathType Leaf) {
    $pluginManifest = [System.IO.File]::ReadAllText($pluginManifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($null -ne $pluginManifest.thinIndex -and $null -ne $pluginManifest.thinIndex.excludeSkills) {
        $ExcludeSkill = @($ExcludeSkill) + @($pluginManifest.thinIndex.excludeSkills) | Select-Object -Unique
    }
}

$results = New-Object System.Collections.Generic.List[object]

# Only explicit names retired by this owner are eligible for compatibility cleanup.
# A source missing from the current checkout does not prove that it was deleted.
$legacyOwnerNames = @()
foreach ($field in @('legacyNames', 'legacy_names', 'aliases')) {
    if ($null -ne $pluginManifest -and $pluginManifest.PSObject.Properties.Name -contains $field) {
        $legacyOwnerNames += @($pluginManifest.$field | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    }
}
$legacyOwnerNames = @($legacyOwnerNames | Where-Object { $_ -ne (Split-Path -Leaf $pluginRootFull) -and $_ -ne $pluginManifest.name } | Select-Object -Unique)
if (-not $Remove -and $legacyOwnerNames.Count -gt 0) {
    $legacyTargets = @()
    if (Test-Path -LiteralPath $rulesTarget -PathType Container) { $legacyTargets += @(Get-ChildItem -LiteralPath $rulesTarget -File -Filter '*.md') }
    if (Test-Path -LiteralPath $skillsTarget -PathType Container) {
        $legacyTargets += @(Get-ChildItem -LiteralPath $skillsTarget -Directory | ForEach-Object {
            Get-Item -LiteralPath (Join-Path $_.FullName 'SKILL.md') -Force -ErrorAction SilentlyContinue
        })
    }
    foreach ($target in $legacyTargets) {
        $linked = $false
        $cursor = $target.FullName
        while ($cursor -and (($cursor -eq $contextRootFull) -or (Test-IsUnderPath $cursor $contextRootFull))) {
            $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue
            if ($null -ne $entry -and ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $linked = $true; break }
            if ($cursor -eq $contextRootFull) { break }
            $cursor = Split-Path -Parent $cursor
        }
        if ($linked -or $target.PSIsContainer) { continue }
        $before = [IO.File]::ReadAllText($target.FullName, [Text.Encoding]::UTF8)
        $kind = if ($target.Name -eq 'SKILL.md') { 'skill' } else { 'rule' }
        $fields = @('name', 'description', 'thin-index', 'source')
        if ($kind -eq 'rule') { $fields += @('task-affinity', 'related') }
        $metadata = Get-ManagedThinIndexMetadata -Content $before -Fields $fields
        if ($null -eq $metadata) { continue }
        $belongsToRetiredOwner = $false
        $sourcePattern = if ($kind -eq 'skill') { '^skills/[^/]+/SKILL\.md$' } else { '^rules/[^/]+\.md$' }
        foreach ($legacyName in $legacyOwnerNames) {
            $prefix = '.agents/plugins/' + $legacyName + '/'
            if ($metadata.source.StartsWith($prefix, [StringComparison]::Ordinal) -and
                $metadata.source.Substring($prefix.Length) -match $sourcePattern) { $belongsToRetiredOwner = $true; break }
        }
        if (-not $belongsToRetiredOwner) { continue }
        $entryName = if ($kind -eq 'skill') { Split-Path -Leaf $target.DirectoryName } else { $target.BaseName }
        $knownBody = if ($kind -eq 'skill') { Get-SkillThinIndexBody $entryName $metadata.source } else { Get-RuleThinIndexBody $entryName $metadata.source }
        if ($metadata.body.Length -ne 0 -and $metadata.body -cne $knownBody.Replace("`r`n", "`n").Trim()) { continue }
        $targetRel = Get-RelativePathPortable -From $projectRootFull -To $target.FullName
        $status = if ($Mode -eq 'Write') { 'removed' } else { 'stale' }
        if ($Mode -eq 'Write') {
            if ([IO.File]::ReadAllText($target.FullName, [Text.Encoding]::UTF8) -cne $before) {
                $results.Add((Write-Result 'thin-index-conflict' $targetRel $metadata.source 'target changed before owner migration'))
                continue
            }
            Remove-Item -LiteralPath $target.FullName
            if ($target.Name -eq 'SKILL.md' -and @(Get-ChildItem -LiteralPath $target.DirectoryName -Force).Count -eq 0) { [IO.Directory]::Delete($target.DirectoryName, $false) }
        }
        $results.Add((Write-Result $status $targetRel $metadata.source ('stale plugin ' + $kind + ' thin-index; explicit owner migration')))
    }
}

if (Test-Path -LiteralPath $rulesSource -PathType Container) {
    Get-ChildItem -LiteralPath $rulesSource -File -Filter "*.md" | Sort-Object Name | ForEach-Object {
        if ($ExcludeRule -contains $_.Name -or $ExcludeRule -contains $_.BaseName) {
            $sourceRel = Get-CapabilityLogicalPath -Path $_.FullName
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To (Join-Path $rulesTarget $_.Name)
            $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "excluded by parameter"))
            return
        }

        $sourceFile = $_.FullName
        $targetFile = Join-Path $rulesTarget $_.Name
        $sourceRel = Get-CapabilityLogicalPath -Path $sourceFile
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

        $contentLines.Add((Get-RuleThinIndexBody -RuleName $_.BaseName -SourceRel $sourceRel))
        $content = @($contentLines) -join [Environment]::NewLine

        $results.Add((Update-ManagedThinIndex $targetFile $targetRel $sourceRel $content @('name', 'description', 'task-affinity', 'related')))
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
            $sourceRel = Get-CapabilityLogicalPath -Path $sourceFile
            $excludedTarget = Join-Path (Join-Path $skillsTarget $skillName) "SKILL.md"
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To $excludedTarget
            $removeManagedIndex = $false
            if (Test-Path -LiteralPath $excludedTarget -PathType Leaf) {
                $targetItem = Get-Item -LiteralPath $excludedTarget -Force
                $isLink = ($targetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
                $parentPath = Split-Path -Parent $excludedTarget
                while ($parentPath -and (($parentPath -eq $contextRootFull) -or (Test-IsUnderPath -Path $parentPath -ParentPath $contextRootFull))) {
                    $parentItem = Get-Item -LiteralPath $parentPath -Force
                    if (($parentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $isLink = $true; break }
                    if ($parentPath -eq $contextRootFull) { break }
                    $parentPath = Split-Path -Parent $parentPath
                }
                if (-not $isLink) {
                    $excludedContent = [System.IO.File]::ReadAllText($excludedTarget, [System.Text.Encoding]::UTF8)
                    $metadata = Get-ManagedThinIndexMetadata $excludedContent
                    $expectedBody = (Get-SkillThinIndexBody -SkillName $skillName -SourceRel $sourceRel).Replace("`r`n", "`n").Trim()
                    if ($null -ne $metadata -and $metadata.source -ceq $sourceRel.Replace('\', '/') -and
                        ($metadata.body.Length -eq 0 -or $metadata.body -ceq $expectedBody)) {
                        $removeManagedIndex = $true
                        if ($Mode -eq "Write") {
                            if ([IO.File]::ReadAllText($excludedTarget, [Text.Encoding]::UTF8) -cne $excludedContent) {
                                $results.Add((Write-Result 'thin-index-conflict' $targetRel $sourceRel 'target changed before excluded init removal'))
                                return
                            }
                            Remove-Item -LiteralPath $excludedTarget
                            $results.Add((Write-Result -Status "removed" -Target $targetRel -Source $sourceRel -Reason "excluded managed plugin skill thin-index"))
                        } else {
                            $results.Add((Write-Result -Status "stale" -Target $targetRel -Source $sourceRel -Reason "excluded managed plugin skill thin-index"))
                        }
                    }
                }
            }
            # Also recover empty directories left by earlier versions. Never recurse or follow links.
            $excludedDirectory = Split-Path -Parent $excludedTarget
            if ((Test-IsUnderPath -Path $excludedDirectory -ParentPath $skillsTarget) -and (Test-Path -LiteralPath $excludedDirectory -PathType Container)) {
                $directoryIsLink = $false
                $cursor = $excludedDirectory
                while ($cursor -and (($cursor -eq $contextRootFull) -or (Test-IsUnderPath -Path $cursor -ParentPath $contextRootFull))) {
                    $entry = Get-Item -LiteralPath $cursor -Force
                    if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $directoryIsLink = $true; break }
                    if ($cursor -eq $contextRootFull) { break }
                    $cursor = Split-Path -Parent $cursor
                }
                if (-not $directoryIsLink) {
                    $children = @(Get-ChildItem -LiteralPath $excludedDirectory -Force)
                    $emptyAfterPreview = ($Mode -ne "Write") -and $removeManagedIndex -and ($children.Count -eq 1) -and ($children[0].Name -eq "SKILL.md")
                    if (($children.Count -eq 0) -or $emptyAfterPreview) {
                        $directoryRel = Get-RelativePathPortable -From $projectRootFull -To $excludedDirectory
                        if ($Mode -eq "Write") {
                            [System.IO.Directory]::Delete($excludedDirectory, $false)
                            $results.Add((Write-Result -Status "removed" -Target $directoryRel -Source $sourceRel -Reason "excluded empty plugin skill directory"))
                        } else {
                            $results.Add((Write-Result -Status "stale" -Target $directoryRel -Source $sourceRel -Reason "excluded empty plugin skill directory"))
                        }
                    }
                }
            }
            $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "excluded by parameter"))
            return
        }

        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            $results.Add((Write-Result -Status "missing" -Target "" -Source (Get-CapabilityLogicalPath -Path $sourceFile) -Reason "skill directory has no SKILL.md"))
            return
        }

        $targetFile = Join-Path (Join-Path $skillsTarget $skillName) "SKILL.md"
        $sourceRel = Get-CapabilityLogicalPath -Path $sourceFile
        $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile
        $skillTargetDir = Split-Path -Parent $targetFile
        $legacyHashes = @()
        if ($null -ne $pluginManifest -and $null -ne $pluginManifest.legacyRootSkillHashes) {
            $legacyProperty = $pluginManifest.legacyRootSkillHashes.PSObject.Properties[$skillName]
            if ($null -ne $legacyProperty) { $legacyHashes = @($legacyProperty.Value) }
        }
        if ($legacyHashes.Count -gt 0) {
            # Migration never follows target links or overwrites custom files, even with -Force.
            $cursor = $targetFile
            while ($cursor -and (($cursor -eq $contextRootFull) -or (Test-IsUnderPath -Path $cursor -ParentPath $contextRootFull))) {
                $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue
                if ($null -ne $entry -and (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or (($cursor -ne $targetFile) -and (-not $entry.PSIsContainer)) -or (($cursor -eq $targetFile) -and $entry.PSIsContainer))) {
                    $results.Add((Write-Result -Status "skill-owner-migration-conflict" -Target $targetRel -Source $sourceRel -Reason "linked or invalid target preserved"))
                    return
                }
                if ($cursor -eq $contextRootFull) { break }
                $cursor = Split-Path -Parent $cursor
            }
        }
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
            if ($line -match '^name\s*:') {
                $hasName = $true
            }
            if ($line -match '^description\s*:') {
                $hasDescription = $true
            }
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
                if ($line -notmatch '^name\s*:') {
                    $contentLines.Add($line)
                }
            }
        }
        if (-not $hasDescription) {
            $contentLines.Add("description: Thin index for plugin-provided $skillName skill. $(Convert-FromUtf8Base64 '6K+75Y+W5ZCO5b+F6aG757un57ut6K+75Y+W5o+S5Lu25YaF55yf5a6eIFNLSUxMLm1k44CC')")
        }
        $contentLines.Add("thin-index: true")
        $contentLines.Add("source: $sourceRel")
        $contentLines.Add("---")
        $contentLines.Add("")

        $contentLines.Add((Get-SkillThinIndexBody -SkillName $skillName -SourceRel $sourceRel))
        $content = @($contentLines) -join [Environment]::NewLine

        $results.Add((Update-ManagedThinIndex $targetFile $targetRel $sourceRel $content @('name', 'description') $legacyHashes))
    }
}
else {
    $results.Add((Write-Result -Status "missing" -Target "" -Source (Get-RelativePathPortable -From $projectRootFull -To $skillsSource) -Reason "plugin has no skills directory"))
}

$results | Format-List status, target, source, reason
