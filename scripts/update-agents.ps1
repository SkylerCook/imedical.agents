param(
  [string]$ProjectRoot = ".",
  [ValidateSet("Check", "DryRun", "Write")]
  [string]$Mode = "DryRun",
  [string[]]$Plugin = @(),
  [string[]]$ExcludePlugin = @(),
  [switch]$ForceThinIndex,
  [switch]$NoPull,
  [switch]$Detailed
)

$ErrorActionPreference = "Stop"

$runtimeSparsePaths = @(
  "/docs/**",
  "/rules/**",
  "/skills/**",
  "/plugins/**",
  "/scripts/*.ps1"
)

$agentsLocalExcludePatterns = @(
  "/config/",
  "/memory/",
  "/rules/",
  "/skills/",
  "/scripts/"
)

function Resolve-FullPath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Resolve-FromBase {
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
  return ([System.Uri]::UnescapeDataString($relativeUri) -replace "\\", "/")
}

function Write-UpdateResult {
  param(
    [string]$Status,
    [string]$Target = "",
    [string]$Source = "",
    [string]$Reason = "",
    [string]$PluginName = "",
    [string]$Phase = ""
  )

  [PSCustomObject]@{
    status = $Status
    plugin = $PluginName
    phase = $Phase
    target = $Target
    source = $Source
    reason = $Reason
  }
}

function Add-LineIfMissing {
  param(
    [string]$Path,
    [string]$Line
  )

  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType File -Force -Path $Path | Out-Null
  }

  $exists = Select-String -Path $Path -Pattern ("^\s*" + [regex]::Escape($Line) + "\s*$") -Quiet
  if (-not $exists) {
    Add-Content -Path $Path -Value $Line
  }
}

function Get-MarkdownConfigEntries {
  param([string]$Path)

  $entries = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $entries
  }

  $lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)
  $fullWidthColon = [char]0xFF1A
  $entryPattern = '^\s*-\s*(?<key>[^:' + $fullWidthColon + ']+?)\s*[:' + $fullWidthColon + ']\s*(?<value>.*)$'
  foreach ($line in $lines) {
    $match = [System.Text.RegularExpressions.Regex]::Match($line, $entryPattern)
    if ($match.Success) {
      $key = $match.Groups["key"].Value.Trim()
      if (-not $entries.ContainsKey($key)) {
        $entries[$key] = [PSCustomObject]@{
          key = $key
          line = $line
        }
      }
    }
  }

  return $entries
}

function Merge-ConfigTemplate {
  param(
    [string]$TemplatePath,
    [string]$TargetPath,
    [string]$ProjectRootFull,
    [string]$PluginName,
    [string]$Mode
  )

  $templateRel = Get-RelativePathPortable -From $ProjectRootFull -To $TemplatePath
  $targetRel = Get-RelativePathPortable -From $ProjectRootFull -To $TargetPath
  $templateEntries = Get-MarkdownConfigEntries -Path $TemplatePath
  $results = New-Object System.Collections.Generic.List[object]

  $templateText = [System.IO.File]::ReadAllText($TemplatePath, [System.Text.Encoding]::UTF8)
  if ($templateText -match "agents-update:review-required") {
    $results.Add((Write-UpdateResult -Status "config-review-required" -Target $targetRel -Source $templateRel -Reason "template requests manual review" -PluginName $PluginName -Phase "config"))
  }

  if (-not (Test-Path -LiteralPath $TargetPath -PathType Leaf)) {
    if ($Mode -eq "Write") {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetPath) | Out-Null
      Copy-Item -LiteralPath $TemplatePath -Destination $TargetPath
      $results.Add((Write-UpdateResult -Status "config-created" -Target $targetRel -Source $templateRel -Reason "target config was missing" -PluginName $PluginName -Phase "config"))
    }
    else {
      $results.Add((Write-UpdateResult -Status "config-missing-file" -Target $targetRel -Source $templateRel -Reason "target config is missing" -PluginName $PluginName -Phase "config"))
    }
    return $results
  }

  $targetEntries = Get-MarkdownConfigEntries -Path $TargetPath
  $missingLines = New-Object System.Collections.Generic.List[string]

  foreach ($key in ($templateEntries.Keys | Sort-Object)) {
    if (-not $targetEntries.ContainsKey($key)) {
      $line = $templateEntries[$key].line
      $missingLines.Add($line)
      if ($Mode -eq "Write") {
        $status = "config-merged-key"
      }
      else {
        $status = "config-missing-key"
      }
      $results.Add((Write-UpdateResult -Status $status -Target $targetRel -Source $templateRel -Reason $key -PluginName $PluginName -Phase "config"))
    }
  }

  foreach ($key in ($targetEntries.Keys | Sort-Object)) {
    if (-not $templateEntries.ContainsKey($key)) {
      $results.Add((Write-UpdateResult -Status "config-deprecated-candidate" -Target $targetRel -Source $templateRel -Reason $key -PluginName $PluginName -Phase "config"))
    }
  }

  if (($Mode -eq "Write") -and ($missingLines.Count -gt 0)) {
    $existing = [System.IO.File]::ReadAllText($TargetPath, [System.Text.Encoding]::UTF8)
    $appendLines = New-Object System.Collections.Generic.List[string]
    if (-not $existing.EndsWith([Environment]::NewLine)) {
      $appendLines.Add("")
    }
    $appendLines.Add("")
    $appendLines.Add("## Pending config items merged by update-agents.ps1")
    $appendLines.Add("")
    $appendLines.Add("Review these non-sensitive project settings. Existing values were preserved.")
    $appendLines.Add("")
    foreach ($line in $missingLines) {
      $appendLines.Add($line)
    }
    Add-Content -Encoding UTF8 -Path $TargetPath -Value $appendLines
  }

  return $results
}

function Get-InstalledPlugins {
  param(
    [string]$AgentsRoot,
    [string[]]$IncludeNames,
    [string[]]$ExcludeNames
  )

  $pluginsRoot = Join-Path $AgentsRoot "plugins"
  $plugins = New-Object System.Collections.Generic.List[object]
  if (-not (Test-Path -LiteralPath $pluginsRoot -PathType Container)) {
    return $plugins
  }

  Get-ChildItem -LiteralPath $pluginsRoot -Directory | Sort-Object Name | ForEach-Object {
    $manifestPath = Join-Path $_.FullName ".agents-plugin/plugin.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
      return
    }
    $manifest = Get-Content -Raw -Encoding UTF8 -Path $manifestPath | ConvertFrom-Json
    $pluginName = [string]$manifest.name
    if ([string]::IsNullOrWhiteSpace($pluginName)) {
      $pluginName = $_.Name
    }
    if (($IncludeNames.Count -gt 0) -and (-not ($IncludeNames -contains $pluginName)) -and (-not ($IncludeNames -contains $_.Name))) {
      return
    }
    if (($ExcludeNames -contains $pluginName) -or ($ExcludeNames -contains $_.Name)) {
      return
    }

    $plugins.Add([PSCustomObject]@{
      name = $pluginName
      directoryName = $_.Name
      path = $_.FullName
      manifestPath = $manifestPath
      manifest = $manifest
    })
  }

  return $plugins
}

function Convert-ThinIndexTextOutput {
  param(
    [string]$Text,
    [string]$PluginName
  )

  $items = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $items
  }

  $normalized = $Text -replace "`r`n", "`n"
  $blocks = [System.Text.RegularExpressions.Regex]::Split($normalized.Trim(), "\n\s*\n")
  foreach ($block in $blocks) {
    if ([string]::IsNullOrWhiteSpace($block)) {
      continue
    }

    $statusMatch = [System.Text.RegularExpressions.Regex]::Match($block, '(?m)^\s*status\s*:\s*(?<value>.*)$')
    if (-not $statusMatch.Success) {
      continue
    }

    $targetMatch = [System.Text.RegularExpressions.Regex]::Match($block, '(?m)^\s*target\s*:\s*(?<value>.*)$')
    $sourceMatch = [System.Text.RegularExpressions.Regex]::Match($block, '(?m)^\s*source\s*:\s*(?<value>.*)$')
    $reasonMatch = [System.Text.RegularExpressions.Regex]::Match($block, '(?m)^\s*reason\s*:\s*(?<value>.*)$')
    $items.Add((Write-UpdateResult `
      -Status $statusMatch.Groups["value"].Value.Trim() `
      -Target $targetMatch.Groups["value"].Value.Trim() `
      -Source $sourceMatch.Groups["value"].Value.Trim() `
      -Reason $reasonMatch.Groups["value"].Value.Trim() `
      -PluginName $PluginName `
      -Phase "thin-index"))
  }

  if ($items.Count -eq 0) {
    $items.Add((Write-UpdateResult -Status "thin-index-output" -Reason $Text.Trim() -PluginName $PluginName -Phase "thin-index"))
  }

  return $items
}

function Write-UpdateSummary {
  param(
    [object[]]$Results,
    [string]$Mode
  )

  $actionRequiredStatuses = @(
    "agents-missing",
    "agents-git-missing",
    "pull-blocked-dirty",
    "fetch-failed",
    "pull-failed",
    "sparse-refresh-failed",
    "conflict",
    "config-review-required",
    "thin-index-script-missing",
    "entrypoint-check-missing",
    "agents-entry-missing"
  )

  $configStatuses = @(
    "config-missing-file",
    "config-created",
    "config-missing-key",
    "config-merged-key",
    "config-deprecated-candidate",
    "config-review-required"
  )

  $entrypointStatuses = @(
    "entrypoint-missing",
    "entrypoint-not-symlink",
    "entrypoint-wrong-target"
  )

  Write-Output "Agent kit update summary"
  Write-Output "Mode: $Mode"
  Write-Output ""

  $pluginNames = @($Results | Where-Object { $_.phase -eq "plugin" -and $_.status -eq "plugin-found" } | Select-Object -ExpandProperty plugin -Unique)
  if ($pluginNames.Count -gt 0) {
    Write-Output ("Plugins: " + ($pluginNames -join ", "))
  }
  else {
    Write-Output "Plugins: none"
  }

  $groups = $Results | Group-Object status | Sort-Object Name
  foreach ($group in $groups) {
    if ([string]::IsNullOrWhiteSpace($group.Name)) {
      continue
    }
    Write-Output ("{0}: {1}" -f $group.Name, $group.Count)
  }

  $actionRequired = @($Results | Where-Object { $actionRequiredStatuses -contains $_.status })
  if ($actionRequired.Count -gt 0) {
    Write-Output ""
    Write-Output "Action required:"
    foreach ($item in $actionRequired) {
      $pluginLabel = if ([string]::IsNullOrWhiteSpace($item.plugin)) { "-" } else { $item.plugin }
      Write-Output ("- {0} [{1}] {2} {3}" -f $item.status, $pluginLabel, $item.target, $item.reason)
    }
  }

  $configNotes = @($Results | Where-Object { $configStatuses -contains $_.status })
  if ($configNotes.Count -gt 0) {
    Write-Output ""
    Write-Output "Config notes:"
    foreach ($group in ($configNotes | Group-Object plugin, target | Sort-Object Name)) {
      $missing = @($group.Group | Where-Object { $_.status -eq "config-missing-key" }).Count
      $merged = @($group.Group | Where-Object { $_.status -eq "config-merged-key" }).Count
      $deprecated = @($group.Group | Where-Object { $_.status -eq "config-deprecated-candidate" }).Count
      $review = @($group.Group | Where-Object { $_.status -eq "config-review-required" }).Count
      $created = @($group.Group | Where-Object { $_.status -eq "config-created" }).Count
      $missingFile = @($group.Group | Where-Object { $_.status -eq "config-missing-file" }).Count
      $first = $group.Group[0]
      Write-Output ("- {0} {1}: missing={2}, merged={3}, deprecated-candidate={4}, review-required={5}, missing-file={6}, created={7}" -f $first.plugin, $first.target, $missing, $merged, $deprecated, $review, $missingFile, $created)
    }
  }

  $entrypointNotes = @($Results | Where-Object { $entrypointStatuses -contains $_.status })
  if ($entrypointNotes.Count -gt 0) {
    Write-Output ""
    Write-Output "Optional entrypoint notes:"
    foreach ($item in $entrypointNotes) {
      Write-Output ("- {0} {1}: {2}; no automatic repair or copy was performed" -f $item.status, $item.target, $item.reason)
    }
  }

  Write-Output ""
  Write-Output "Use -Detailed to print every result item."
}

function Invoke-AgentGitUpdate {
  param(
    [string]$AgentsRoot,
    [string]$ProjectRootFull
  )

  $results = New-Object System.Collections.Generic.List[object]
  if (-not (Test-Path -LiteralPath (Join-Path $AgentsRoot ".git"))) {
    $results.Add((Write-UpdateResult -Status "agents-git-missing" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason ".agents is not an independent Git repository" -Phase "git"))
    return $results
  }

  $dirty = git -C $AgentsRoot status --porcelain
  if ($LASTEXITCODE -ne 0) {
    $results.Add((Write-UpdateResult -Status "git-status-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "git status failed" -Phase "git"))
    return $results
  }
  if ($dirty) {
    $results.Add((Write-UpdateResult -Status "pull-blocked-dirty" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "local .agents changes must be handled before pulling" -Phase "git"))
    return $results
  }

  git -C $AgentsRoot fetch --prune
  if ($LASTEXITCODE -ne 0) {
    $results.Add((Write-UpdateResult -Status "fetch-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "git fetch --prune failed" -Phase "git"))
    return $results
  }

  git -C $AgentsRoot pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    $results.Add((Write-UpdateResult -Status "pull-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "git pull --ff-only failed" -Phase "git"))
    return $results
  }

  git -C $AgentsRoot sparse-checkout init --no-cone
  if ($LASTEXITCODE -eq 0) {
    $runtimeSparsePaths | git -C $AgentsRoot sparse-checkout set --stdin --no-cone
  }
  if ($LASTEXITCODE -ne 0) {
    $results.Add((Write-UpdateResult -Status "sparse-refresh-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "sparse checkout refresh failed" -Phase "git"))
    return $results
  }

  $results.Add((Write-UpdateResult -Status "agents-updated" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "fetch, pull, and sparse checkout refresh completed" -Phase "git"))
  return $results
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$agentsRoot = Join-Path $projectRootFull ".agents"
$results = New-Object System.Collections.Generic.List[object]

if (-not (Test-Path -LiteralPath $agentsRoot -PathType Container)) {
  Write-UpdateResult -Status "agents-missing" -Target ".agents" -Reason ".agents directory does not exist" -Phase "preflight"
  exit 1
}

if ((-not $NoPull) -and ($Mode -ne "Check")) {
  $gitResults = Invoke-AgentGitUpdate -AgentsRoot $agentsRoot -ProjectRootFull $projectRootFull
  foreach ($item in $gitResults) {
    $results.Add($item)
  }
  if ($gitResults | Where-Object { $_.status -in @("pull-blocked-dirty", "fetch-failed", "pull-failed", "sparse-refresh-failed") }) {
    $results | Format-List status, plugin, phase, target, source, reason
    exit 1
  }
}
elseif (-not (Test-Path -LiteralPath (Join-Path $agentsRoot ".git"))) {
  $results.Add((Write-UpdateResult -Status "agents-git-missing" -Target ".agents" -Reason ".agents is not an independent Git repository" -Phase "git"))
}

$agentsExcludePath = Join-Path $agentsRoot ".git/info/exclude"
foreach ($pattern in $agentsLocalExcludePatterns) {
  $exists = (Test-Path -LiteralPath $agentsExcludePath) -and (Select-String -Path $agentsExcludePath -Pattern ("^\s*" + [regex]::Escape($pattern) + "\s*$") -Quiet)
  if ($exists) {
    $results.Add((Write-UpdateResult -Status "exclude-ok" -Target (Get-RelativePathPortable -From $projectRootFull -To $agentsExcludePath) -Reason $pattern -Phase "exclude"))
  }
  elseif ($Mode -eq "Write") {
    Add-LineIfMissing -Path $agentsExcludePath -Line $pattern
    $results.Add((Write-UpdateResult -Status "exclude-added" -Target (Get-RelativePathPortable -From $projectRootFull -To $agentsExcludePath) -Reason $pattern -Phase "exclude"))
  }
  else {
    $results.Add((Write-UpdateResult -Status "exclude-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $agentsExcludePath) -Reason $pattern -Phase "exclude"))
  }
}

$checkEntrypoints = Join-Path $agentsRoot "scripts/check-agent-entrypoints.ps1"
if (Test-Path -LiteralPath (Join-Path $projectRootFull "AGENTS.md") -PathType Leaf) {
  if (Test-Path -LiteralPath $checkEntrypoints -PathType Leaf) {
    & $checkEntrypoints -ProjectRoot $projectRootFull | ForEach-Object {
      $results.Add((Write-UpdateResult -Status ("entrypoint-" + $_.status) -Target $_.entrypoint -Reason $_.reason -Phase "entrypoint"))
    }
  }
  else {
    $results.Add((Write-UpdateResult -Status "entrypoint-check-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $checkEntrypoints) -Reason "check script missing" -Phase "entrypoint"))
  }
}
else {
  $results.Add((Write-UpdateResult -Status "agents-entry-missing" -Target "AGENTS.md" -Reason "AGENTS.md is required as the single primary agent entrypoint" -Phase "entrypoint"))
}

$plugins = Get-InstalledPlugins -AgentsRoot $agentsRoot -IncludeNames $Plugin -ExcludeNames $ExcludePlugin
foreach ($installedPlugin in $plugins) {
  $results.Add((Write-UpdateResult -Status "plugin-found" -Target (Get-RelativePathPortable -From $projectRootFull -To $installedPlugin.path) -Reason $installedPlugin.name -PluginName $installedPlugin.name -Phase "plugin"))

  $templatesRoot = Join-Path $installedPlugin.path "templates"
  if (Test-Path -LiteralPath $templatesRoot -PathType Container) {
    Get-ChildItem -LiteralPath $templatesRoot -File -Filter "*_profile.template.md" | Sort-Object Name | ForEach-Object {
      $targetName = $_.Name -replace '\.template\.md$', '.md'
      $targetPath = Join-Path (Join-Path $agentsRoot "config") $targetName
      $mergeResults = Merge-ConfigTemplate -TemplatePath $_.FullName -TargetPath $targetPath -ProjectRootFull $projectRootFull -PluginName $installedPlugin.name -Mode $Mode
      foreach ($item in $mergeResults) {
        $results.Add($item)
      }
    }
  }

  $thinIndexScript = Join-Path $installedPlugin.path "scripts/generate-plugin-thin-index.ps1"
  if (Test-Path -LiteralPath $thinIndexScript -PathType Leaf) {
    $thinIndexMode = if ($Mode -eq "Write") { "Write" } else { "DryRun" }
    $pluginPathRel = Get-RelativePathPortable -From $projectRootFull -To $installedPlugin.path
    $thinParams = @{
      PluginPath = $pluginPathRel
      ProjectRoot = $projectRootFull
      Mode = $thinIndexMode
    }
    if ($ForceThinIndex) {
      $thinParams.Force = $true
    }
    $thinOutput = & $thinIndexScript @thinParams | Out-String
    $thinResults = Convert-ThinIndexTextOutput -Text $thinOutput -PluginName $installedPlugin.name
    foreach ($item in $thinResults) {
      $results.Add($item)
    }
  }
  else {
    $results.Add((Write-UpdateResult -Status "thin-index-script-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $thinIndexScript) -Reason "plugin has no thin-index script" -PluginName $installedPlugin.name -Phase "thin-index"))
  }
}

if ($plugins.Count -eq 0) {
  $results.Add((Write-UpdateResult -Status "plugin-none" -Target (Get-RelativePathPortable -From $projectRootFull -To (Join-Path $agentsRoot "plugins")) -Reason "no installed plugins matched filters" -Phase "plugin"))
}

if ($Detailed) {
  $results | Format-List status, plugin, phase, target, source, reason
}
else {
  Write-UpdateSummary -Results $results -Mode $Mode
}
