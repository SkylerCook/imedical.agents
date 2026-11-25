param(
    [string]$ProjectRoot = ".",
    [string]$ContextRoot = "",
    [string]$CapabilityRoot = "",
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

function New-AgentThinIndexContent {
    param(
        [string]$AgentName,
        [string]$Workflow,
        [string[]]$RequiredPlugins,
        [string]$Layout = 'current'
    )

    $agentPath = ".agents/agents/$AgentName"
    $usesBindings = $Layout -in @('bindings', 'original')
    $profile = if ($Layout -eq 'current') { 'project.jsonc' } else { 'plugin_profile.md' }
    $lines = @(
        '---'
        "name: $AgentName"
        "description: Agent thin-index for $AgentName. Read canonical AGENT.md and workflow before executing."
        '---'
        ''
        "# Agent Thin Index: $AgentName"
        ''
        'This file is generated from imedical.agents canonical agent definitions. It is an agent thin-index, not a tool adapter.'
        'Do not maintain this file by hand. Change .agents/agents/ or .agents/workflows/, then rerun .agents/scripts/update-agents.ps1.'
        ''
        'Agent instruction: after reading this file, continue reading these canonical files before executing the target project task.'
        ''
        if ($usesBindings) {
            "- Role definition: ``$agentPath/AGENT.md``"
            "- Binding index: ``$agentPath/bindings.yaml``"
        }
        else {
            "- Role definition and YAML metadata: ``$agentPath/AGENT.md``"
        }
        if ($Workflow) {
            "- Default workflow: ``$Workflow``"
        }
        if ($Layout -ne 'original') {
            ''
            'Discovery-only registries (read only when the agent or workflow has not already been selected):'
            ''
        }
        '- Agent registry: `.agents/agents/agent-registry.md`'
        '- Workflow registry: `.agents/workflows/workflow-registry.md`'
        ''
        'Preflight checks:'
        ''
        '- Read target project root `AGENTS.md`.'
        "- Read ``.agents/config/$profile`` and confirm required plugin states."
        if ($RequiredPlugins.Count) {
            foreach ($plugin in $RequiredPlugins) {
                "- Required plugin ``$plugin`` must satisfy the enablement preconditions declared by the canonical agent."
            }
        }
        else {
            '- If this agent has no domain plugin dependency, still follow project `AGENTS.md` and `.agents/config/`.'
        }
        ''
        'Do not:'
        ''
        '- Do not write server hosts, accounts, passwords, tokens, namespaces, or remote paths into this file, rules, memory, or reports.'
        '- Do not treat tool-specific entries as canonical sources.'
        '- Do not copy plugin rule bodies into this file; read canonical agent and plugin source files when needed.'
    )
    return $lines -join "`n"
}

function Test-ManagedAgentThinIndex {
    param([string]$Content, [string]$AgentName)

    # Only the workflow and plugin list can drift within a known generated layout.
    # Re-render the whole document to require the expected owner and preserve edits.
    $workflow = [regex]::Match($Content, '(?m)^- Default workflow: `(?<path>\.agents/workflows/[^`\n]+\.workflow\.md)`$').Groups['path'].Value
    $plugins = @([regex]::Matches($Content, '(?m)^- Required plugin `(?<name>[^`\n]+)` must satisfy the enablement preconditions declared by the canonical agent\.$') |
        ForEach-Object { $_.Groups['name'].Value })
    $layout = 'current'
    if ($Content.Contains('- Binding index: ')) {
        $layout = if ($Content.Contains('Discovery-only registries (')) { 'bindings' } else { 'original' }
    }
    elseif ($Content.Contains('- Read `.agents/config/plugin_profile.md` and confirm required plugin states.')) {
        $layout = 'profile'
    }
    return $Content -ceq (New-AgentThinIndexContent -AgentName $AgentName -Workflow $workflow -RequiredPlugins $plugins -Layout $layout)
}

function Get-InvalidTargetDirectory {
    param([string[]]$Paths)

    foreach ($path in $Paths) {
        $directory = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        if ($null -ne $directory -and ((-not $directory.PSIsContainer) -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint))) {
            return $path
        }
    }
}

function Test-AgentThinIndexTargetConflict {
    param([string]$TargetDirectory, [string]$TargetFile)

    if (Get-InvalidTargetDirectory -Paths @($contextRootFull, $skillsTarget, $TargetDirectory)) {
        return $true
    }
    $file = Get-Item -LiteralPath $TargetFile -Force -ErrorAction SilentlyContinue
    return $null -ne $file -and ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.LinkType -eq 'HardLink')
}

$projectRootFull = Resolve-FullPath $ProjectRoot
if ([string]::IsNullOrWhiteSpace($ContextRoot) -or [string]::IsNullOrWhiteSpace($CapabilityRoot)) {
    Import-Module (Join-Path $PSScriptRoot "lib/WorkspaceContext.psm1") -Force
    $workspaceContext = Resolve-AgentWorkspaceContext -ProjectRoot $projectRootFull
    if ([string]::IsNullOrWhiteSpace($ContextRoot)) { $ContextRoot = $workspaceContext.contextRoot }
    if ([string]::IsNullOrWhiteSpace($CapabilityRoot)) { $CapabilityRoot = $workspaceContext.capabilityRoot }
}
$contextRootFull = Resolve-FullPath $ContextRoot
$capabilityRootFull = Resolve-FullPath $CapabilityRoot
$agentsSource = Join-Path $capabilityRootFull "agents"
$workflowsSource = Join-Path $capabilityRootFull "workflows"
$skillsTarget = Join-Path $contextRootFull "skills"
$results = New-Object System.Collections.Generic.List[object]

if (-not (Test-Path -LiteralPath $agentsSource -PathType Container)) {
    Write-Result -Status "missing" -Source (Get-RelativePathPortable -From $projectRootFull -To $agentsSource) -Reason "agents directory is missing"
    exit 1
}

$invalidRoot = Get-InvalidTargetDirectory -Paths @($contextRootFull, $skillsTarget)
if ($invalidRoot) {
    Write-Result -Status 'thin-index-conflict' -Target (Get-RelativePathPortable -From $projectRootFull -To $invalidRoot) -Reason 'linked or invalid target directory preserved' |
        Format-List status, target, source, reason
    return
}

if (Test-Path -LiteralPath $skillsTarget -PathType Container) {
    Get-ChildItem -LiteralPath $skillsTarget -Directory | Sort-Object Name | ForEach-Object {
        $agentName = $_.Name
        if ($agentName -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*-agent$') {
            return
        }
        $sourcePath = Join-Path $agentsSource "$agentName/AGENT.md"
        if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
            return
        }
        $targetFile = Join-Path $_.FullName "SKILL.md"
        if ((Test-AgentThinIndexTargetConflict -TargetDirectory $_.FullName -TargetFile $targetFile) -or
            (-not (Test-Path -LiteralPath $targetFile -PathType Leaf))) {
            return
        }
        $existing = [IO.File]::ReadAllText($targetFile, [Text.Encoding]::UTF8)
        if (-not (Test-ManagedAgentThinIndex -Content $existing.Replace("`r`n", "`n") -AgentName $agentName)) {
            return
        }
        $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile
        $sourceRel = ".agents/agents/$agentName/AGENT.md"
        if ($Mode -eq 'Write') {
            if ((Test-AgentThinIndexTargetConflict -TargetDirectory $_.FullName -TargetFile $targetFile) -or
                (Test-Path -LiteralPath $sourcePath -PathType Leaf) -or
                (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) -or
                ([IO.File]::ReadAllText($targetFile, [Text.Encoding]::UTF8) -cne $existing)) {
                $results.Add((Write-Result -Status 'thin-index-conflict' -Target $targetRel -Source $sourceRel -Reason 'source or target changed before removal'))
                return
            }
            Remove-Item -LiteralPath $targetFile
            $results.Add((Write-Result -Status 'removed' -Target $targetRel -Source $sourceRel -Reason 'stale agent thin-index'))
        }
        else {
            $results.Add((Write-Result -Status 'stale' -Target $targetRel -Source $sourceRel -Reason 'stale agent thin-index'))
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
        $results.Add((Write-Result -Status "skipped" -Target (Get-RelativePathPortable -From $projectRootFull -To $targetFile) -Source (".agents/" + (Get-RelativePathPortable -From $capabilityRootFull -To $sourceFile).TrimStart("/")) -Reason "excluded by parameter"))
        return
    }

    $sourceFile = Join-Path $_.FullName "AGENT.md"
    $targetFile = Join-Path (Join-Path $skillsTarget $agentName) "SKILL.md"
    $sourceRel = ".agents/" + (Get-RelativePathPortable -From $capabilityRootFull -To $sourceFile).TrimStart("/")
    $targetRel = Get-RelativePathPortable -From $projectRootFull -To $targetFile

    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        $results.Add((Write-Result -Status "missing" -Target $targetRel -Source $sourceRel -Reason "agent directory has no AGENT.md"))
        return
    }
    $targetDirectory = Split-Path -Parent $targetFile
    if (Test-AgentThinIndexTargetConflict -TargetDirectory $targetDirectory -TargetFile $targetFile) {
        $results.Add((Write-Result -Status 'thin-index-conflict' -Target $targetRel -Source $sourceRel -Reason 'linked or invalid target preserved'))
        return
    }

    $definition = [System.IO.File]::ReadAllText($sourceFile, [System.Text.Encoding]::UTF8)
    $header = [regex]::Match($definition, '\A---\r?\n(?<yaml>[\s\S]*?)\r?\n---(?:\r?\n|$)')
    if (-not $header.Success) {
        $results.Add((Write-Result -Status "missing" -Target $targetRel -Source $sourceRel -Reason "AGENT.md has no YAML frontmatter"))
        return
    }
    $bindingLines = $header.Groups["yaml"].Value -split '\r?\n'
    $defaultWorkflow = Get-YamlScalarValue -Lines $bindingLines -Key "defaultWorkflow"
    $requiredPlugins = @(Get-YamlListValues -Lines $bindingLines -Key "requiredPlugins")
    if ($requiredPlugins.Count -eq 0) {
        $requiredPlugins = @(Get-YamlListValues -Lines $bindingLines -Key "plugins")
    }

    $workflowRel = ""
    if (-not [string]::IsNullOrWhiteSpace($defaultWorkflow)) {
        $workflowPath = Join-Path $workflowsSource ($defaultWorkflow + ".workflow.md")
        $workflowRel = ".agents/" + (Get-RelativePathPortable -From $capabilityRootFull -To $workflowPath).TrimStart("/")
        if (-not (Test-Path -LiteralPath $workflowPath -PathType Leaf)) {
            $results.Add((Write-Result -Status "missing" -Target $targetRel -Source $workflowRel -Reason "default workflow is missing"))
            return
        }
    }

    $content = New-AgentThinIndexContent -AgentName $agentName -Workflow $workflowRel -RequiredPlugins $requiredPlugins
    $status = 'generated'
    $exists = Test-Path -LiteralPath $targetFile -PathType Leaf
    if ($exists) {
        $original = [IO.File]::ReadAllText($targetFile, [Text.Encoding]::UTF8)
        $existing = $original.Replace("`r`n", "`n")
        if ($existing -ceq $content) {
            if (-not $Force) {
                $results.Add((Write-Result -Status 'unchanged' -Target $targetRel -Source $sourceRel -Reason 'managed agent thin-index is current'))
                return
            }
        }
        elseif (-not (Test-ManagedAgentThinIndex -Content $existing -AgentName $agentName)) {
            $results.Add((Write-Result -Status 'thin-index-conflict' -Target $targetRel -Source $sourceRel -Reason 'custom or unrecognized content preserved'))
            return
        }
        else {
            if ($Mode -ne 'Write') {
                $results.Add((Write-Result -Status 'thin-index-stale' -Target $targetRel -Source $sourceRel -Reason 'managed agent thin-index differs; run Write to refresh'))
                return
            }
            $status = 'updated'
        }
    }

    if ($Mode -eq 'Write') {
        if (Test-AgentThinIndexTargetConflict -TargetDirectory $targetDirectory -TargetFile $targetFile) {
            $results.Add((Write-Result -Status 'thin-index-conflict' -Target $targetRel -Source $sourceRel -Reason 'target changed before write'))
            return
        }
        New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
        $temporary = Join-Path $targetDirectory ([IO.Path]::GetRandomFileName())
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try {
            try {
                $bytes = [Text.Encoding]::UTF8.GetBytes($content.Replace("`n", [Environment]::NewLine))
                $stream.Write($bytes, 0, $bytes.Length)
            }
            finally {
                $stream.Dispose()
            }
            if ((Test-AgentThinIndexTargetConflict -TargetDirectory $targetDirectory -TargetFile $targetFile) -or
                ($exists -and ((-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) -or
                    ([IO.File]::ReadAllText($targetFile, [Text.Encoding]::UTF8) -cne $original)))) {
                $results.Add((Write-Result -Status 'thin-index-conflict' -Target $targetRel -Source $sourceRel -Reason 'target changed before write'))
                return
            }
            if ($exists) {
                [IO.File]::Replace($temporary, $targetFile, [NullString]::Value)
            }
            else {
                [IO.File]::Move($temporary, $targetFile)
            }
        }
        finally {
            if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
        }
    }
    $results.Add((Write-Result -Status $status -Target $targetRel -Source $sourceRel -Reason $Mode))
}

$results | Format-List status, target, source, reason
