param(
    [string]$ProjectRoot = ".",
    [ValidateSet("DryRun", "Write")]
    [string]$Mode = "DryRun",
    [string[]]$ExcludeAgent = @(),
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
        [string]$Target = "",
        [string]$Source = "",
        [string]$Reason = ""
    )
    [PSCustomObject]@{
        status = $Status
        target = $Target
        source = $Source
        reason = $Reason
    }
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

function Get-YamlScalarValue {
    param(
        [string[]]$Lines,
        [string]$Key
    )
    $pattern = '^\s*' + [regex]::Escape($Key) + '\s*:\s*(?<value>.+?)\s*$'
    foreach ($line in $Lines) {
        $match = [System.Text.RegularExpressions.Regex]::Match($line, $pattern)
        if ($match.Success) {
            return $match.Groups["value"].Value.Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Get-YamlListValues {
    param(
        [string[]]$Lines,
        [string]$Key
    )
    $values = New-Object System.Collections.Generic.List[string]
    $inList = $false
    $keyPattern = '^\s*' + [regex]::Escape($Key) + '\s*:\s*$'
    foreach ($line in $Lines) {
        if ($line -match $keyPattern) {
            $inList = $true
            continue
        }
        if ($inList) {
            $itemMatch = [System.Text.RegularExpressions.Regex]::Match($line, '^\s*-\s*(?<value>.+?)\s*$')
            if ($itemMatch.Success) {
                $values.Add($itemMatch.Groups["value"].Value.Trim().Trim('"').Trim("'"))
                continue
            }
            if ($line -match '^\S') {
                break
            }
        }
    }
    return @($values)
}

function Get-AgentThinIndexSourcePath {
    param(
        [string]$TargetFile,
        [string]$ProjectRoot
    )
    $content = [System.IO.File]::ReadAllText($TargetFile, [System.Text.Encoding]::UTF8)
    if ($content -notmatch "agent thin-index") {
        return $null
    }
    $match = [System.Text.RegularExpressions.Regex]::Match($content, '(?<source>\.agents/agents/[^\s`]+/AGENT\.md)')
    if (-not $match.Success) {
        return $null
    }
    return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $match.Groups["source"].Value))
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$agentsRoot = Join-Path $projectRootFull ".agents"
$agentsSource = Join-Path $agentsRoot "agents"
$workflowsSource = Join-Path $agentsRoot "workflows"
$skillsTarget = Join-Path $agentsRoot "skills"
$results = New-Object System.Collections.Generic.List[object]

if (-not (Test-Path -LiteralPath $agentsSource -PathType Container)) {
    Write-Result -Status "missing" -Source (Get-RelativePathPortable -From $projectRootFull -To $agentsSource) -Reason "agents directory is missing"
    exit 1
}

if (Test-Path -LiteralPath $skillsTarget -PathType Container) {
    Get-ChildItem -LiteralPath $skillsTarget -Directory | Sort-Object Name | ForEach-Object {
        $targetFile = Join-Path $_.FullName "SKILL.md"
        if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
            return
        }
        $sourcePath = Get-AgentThinIndexSourcePath -TargetFile $targetFile -ProjectRoot $projectRootFull
        if ($null -eq $sourcePath) {
            return
        }
        if ((Test-IsUnderPath -Path $sourcePath -ParentPath $agentsSource) -and (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf))) {
            $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile
            $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourcePath
            if ($Mode -eq "Write") {
                Remove-Item -LiteralPath $targetFile
                $results.Add((Write-Result -Status "removed" -Target $targetRel -Source $sourceRel -Reason "stale agent thin-index"))
            }
            else {
                $results.Add((Write-Result -Status "stale" -Target $targetRel -Source $sourceRel -Reason "stale agent thin-index"))
            }
        }
    }
}

Get-ChildItem -LiteralPath $agentsSource -Directory | Sort-Object Name | ForEach-Object {
    $agentName = $_.Name
    if ($agentName -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*-agent$') {
        return
    }
    if ($ExcludeAgent -contains $agentName) {
        $sourceFile = Join-Path $_.FullName "AGENT.md"
        $targetFile = Join-Path (Join-Path $skillsTarget $agentName) "SKILL.md"
        $results.Add((Write-Result -Status "skipped" -Target (Get-RelativePathPortable -From $projectRootFull -To $targetFile) -Source (Get-RelativePathPortable -From $projectRootFull -To $sourceFile) -Reason "excluded by parameter"))
        return
    }

    $sourceFile = Join-Path $_.FullName "AGENT.md"
    $bindingsFile = Join-Path $_.FullName "bindings.yaml"
    $targetFile = Join-Path (Join-Path $skillsTarget $agentName) "SKILL.md"
    $sourceRel = Get-RelativePathPortable -From $projectRootFull -To $sourceFile
    $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile

    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        $results.Add((Write-Result -Status "missing" -Target $targetRel -Source $sourceRel -Reason "agent directory has no AGENT.md"))
        return
    }
    if (-not (Test-Path -LiteralPath $bindingsFile -PathType Leaf)) {
        $results.Add((Write-Result -Status "missing" -Target $targetRel -Source (Get-RelativePathPortable -From $projectRootFull -To $bindingsFile) -Reason "agent directory has no bindings.yaml"))
        return
    }
    if (Test-Path -LiteralPath (Split-Path -Parent $targetFile) -PathType Leaf) {
        $results.Add((Write-Result -Status "conflict" -Target (Get-RelativePathPortable -From $projectRootFull -To (Split-Path -Parent $targetFile)) -Source $sourceRel -Reason "skill target directory path is a file"))
        return
    }
    if (Test-Path -LiteralPath $targetFile -PathType Container) {
        $results.Add((Write-Result -Status "conflict" -Target $targetRel -Source $sourceRel -Reason "target SKILL.md path is a directory"))
        return
    }

    $bindingLines = [System.IO.File]::ReadAllLines($bindingsFile, [System.Text.Encoding]::UTF8)
    $bindingName = Get-YamlScalarValue -Lines $bindingLines -Key "name"
    if ([string]::IsNullOrWhiteSpace($bindingName)) {
        $bindingName = $agentName
    }
    $description = Get-YamlScalarValue -Lines $bindingLines -Key "description"
    if ([string]::IsNullOrWhiteSpace($description)) {
        $description = "Agent thin-index for $agentName."
    }
    $defaultWorkflow = Get-YamlScalarValue -Lines $bindingLines -Key "defaultWorkflow"
    $requiredPlugins = @(Get-YamlListValues -Lines $bindingLines -Key "requiredPlugins")
    if ($requiredPlugins.Count -eq 0) {
        $requiredPlugins = @(Get-YamlListValues -Lines $bindingLines -Key "plugins")
    }

    $bindingsRel = Get-RelativePathPortable -From $projectRootFull -To $bindingsFile
    $workflowRel = ""
    if (-not [string]::IsNullOrWhiteSpace($defaultWorkflow)) {
        $workflowPath = Join-Path $workflowsSource ($defaultWorkflow + ".workflow.md")
        $workflowRel = Get-RelativePathPortable -From $projectRootFull -To $workflowPath
        if (-not (Test-Path -LiteralPath $workflowPath -PathType Leaf)) {
            $results.Add((Write-Result -Status "missing" -Target $targetRel -Source $workflowRel -Reason "default workflow is missing"))
            return
        }
    }

    $contentLines = New-Object System.Collections.Generic.List[string]
    $contentLines.Add("---")
    $contentLines.Add("name: $agentName")
    $contentLines.Add("description: Agent thin-index for $agentName. Read canonical AGENT.md and workflow before executing.")
    $contentLines.Add("---")
    $contentLines.Add("")
    $contentLines.Add("# Agent Thin Index: $agentName")
    $contentLines.Add("")
    $contentLines.Add("This file is generated from imedical.agents canonical agent definitions. It is an agent thin-index, not a tool adapter.")
    $contentLines.Add("Do not maintain this file by hand. Change `.agents/agents/` or `.agents/workflows/`, then rerun `.agents/scripts/update-agents.ps1`.")
    $contentLines.Add("")
    $contentLines.Add("Agent instruction: after reading this file, continue reading these canonical files before executing the target project task.")
    $contentLines.Add("")
    $contentLines.Add("- Role definition: ``$sourceRel``")
    $contentLines.Add("- Binding index: ``$bindingsRel``")
    if (-not [string]::IsNullOrWhiteSpace($workflowRel)) {
        $contentLines.Add("- Default workflow: ``$workflowRel``")
    }
    $contentLines.Add("")
    $contentLines.Add("Discovery-only registries (read only when the agent or workflow has not already been selected):")
    $contentLines.Add("")
    $contentLines.Add("- Agent registry: ``.agents/agents/agent-registry.md``")
    $contentLines.Add("- Workflow registry: ``.agents/workflows/workflow-registry.md``")
    $contentLines.Add("")
    $contentLines.Add("Preflight checks:")
    $contentLines.Add("")
    $contentLines.Add("- Read target project root ``AGENTS.md``.")
    $contentLines.Add("- Read ``.agents/config/plugin_profile.md`` and confirm required plugin states.")
    if ($requiredPlugins.Count -gt 0) {
        foreach ($plugin in $requiredPlugins) {
            $contentLines.Add("- Required plugin ``$plugin`` must satisfy the enablement preconditions declared by the canonical agent.")
        }
    }
    else {
        $contentLines.Add("- If this agent has no domain plugin dependency, still follow project ``AGENTS.md`` and ``.agents/config/``.")
    }
    $contentLines.Add("")
    $contentLines.Add("Do not:")
    $contentLines.Add("")
    $contentLines.Add("- Do not write server hosts, accounts, passwords, tokens, namespaces, or remote paths into this file, rules, memory, or reports.")
    $contentLines.Add("- Do not treat tool-specific entries as canonical sources.")
    $contentLines.Add("- Do not copy plugin rule bodies into this file; read canonical agent and plugin source files when needed.")
    $content = $contentLines -join [Environment]::NewLine

    if ((Test-Path -LiteralPath $targetFile) -and (-not $Force)) {
        $existing = [System.IO.File]::ReadAllText($targetFile, [System.Text.Encoding]::UTF8)
        if ($existing -ne $content) {
            $results.Add((Write-Result -Status "skipped" -Target $targetRel -Source $sourceRel -Reason "target exists; use -Force to overwrite"))
        }
        else {
            $results.Add((Write-Result -Status "unchanged" -Target $targetRel -Source $sourceRel -Reason $Mode))
        }
        return
    }

    if ($Mode -eq "Write") {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
        [System.IO.File]::WriteAllText($targetFile, $content, [System.Text.UTF8Encoding]::new($false))
    }
    $results.Add((Write-Result -Status "generated" -Target $targetRel -Source $sourceRel -Reason $Mode))
}

$results | Format-List status, target, source, reason
