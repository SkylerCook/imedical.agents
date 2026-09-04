param(
  [string]$ProjectRoot = ".",
  [ValidateSet("Check", "DryRun", "Write")]
  [string]$Mode = "DryRun",
  [string[]]$Plugin = @(),
  [string[]]$ExcludePlugin = @(),
  [ValidateSet("ClaudeCode", "Codex")]
  [string[]]$RuntimeAdapter = @(),
  [switch]$ForceThinIndex,
  [switch]$CleanupLegacyVendorSkills,
  [switch]$NoPull,
  [switch]$Detailed,
  [switch]$ResumedAfterSelfUpdate,
  [ValidateSet("", "agents-up-to-date", "agents-updated")]
  [string]$ResumedGitStatus = "",
  [string]$ResumedOldHash = "",
  [string]$ResumedNewHash = "",
  [string]$ResumedUpstreamHash = ""
)

$ErrorActionPreference = "Stop"
$minimumGitSparseCheckoutVersion = [version]"2.25.0"

$runtimeSparsePaths = @(
  "/agents/**",
  "/docs/**",
  "/workflows/**",
  "/rules/**",
  "/skills/**",
  "/plugins/**",
  "/vendor/**",
  "/feedback/**",
  "/hooks/**",
  "/scripts/*.ps1",
  "/scripts/*.js",
  "/scripts/lib/**",
  "/scripts/iris-mcp.js"
)

$agentsLocalExcludePatterns = @(
  "/config/",
  "/memory/",
  "/rules/",
  "/skills/",
  "/scripts/"
  "/work/"
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
    [string]$Phase = "",
    [string]$OldHash = "",
    [string]$NewHash = "",
    [string]$UpstreamHash = ""
  )

  [PSCustomObject]@{
    status = $Status
    plugin = $PluginName
    phase = $Phase
    target = $Target
    source = $Source
    reason = $Reason
    oldHash = $OldHash
    newHash = $NewHash
    upstreamHash = $UpstreamHash
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

function Assert-GitSparseCheckoutSubcommandAvailable {
  $versionText = git --version
  if ($LASTEXITCODE -ne 0) {
    throw "git is required but could not be executed."
  }

  $match = [System.Text.RegularExpressions.Regex]::Match($versionText, "(\d+)\.(\d+)\.(\d+)")
  if (-not $match.Success) {
    throw "Could not parse git version from: $versionText"
  }

  $gitVersion = [version]$match.Groups[0].Value
  if ($gitVersion -lt $minimumGitSparseCheckoutVersion) {
    throw ("Git {0} is installed. imedical.agents install/update requires Git {1} or newer because it uses 'git sparse-checkout'. Please upgrade Git for Windows and rerun this script." -f $gitVersion, $minimumGitSparseCheckoutVersion)
  }
}

function Restore-LegacySparseRuntimeModules {
  param(
    [string]$AgentsRoot,
    [string]$WorkspaceContextModule
  )

  $target = Get-RelativePathPortable -From $AgentsRoot -To $WorkspaceContextModule
  if (-not (Test-Path -LiteralPath (Join-Path $AgentsRoot ".git"))) {
    return (Write-UpdateResult -Status "workspace-context-resolver-restore-failed" -Target $target -Reason "Cannot restore scripts/lib/** because the updater is not running from an independent capability Git checkout" -Phase "preflight")
  }

  try {
    Assert-GitSparseCheckoutSubcommandAvailable
  }
  catch {
    return (Write-UpdateResult -Status "workspace-context-resolver-restore-failed" -Target $target -Reason $_.Exception.Message -Phase "preflight")
  }

  $dirty = git -C $AgentsRoot status --porcelain
  if (($LASTEXITCODE -ne 0) -or $dirty) {
    return (Write-UpdateResult -Status "workspace-context-resolver-restore-failed" -Target $target -Reason "Cannot repair a legacy sparse checkout while the capability Git checkout is dirty or unreadable" -Phase "preflight")
  }

  git -C $AgentsRoot sparse-checkout init --no-cone
  if ($LASTEXITCODE -eq 0) {
    $runtimeSparsePaths | git -C $AgentsRoot sparse-checkout set --stdin --no-cone
  }
  if (($LASTEXITCODE -ne 0) -or (-not (Test-Path -LiteralPath $WorkspaceContextModule -PathType Leaf))) {
    return (Write-UpdateResult -Status "workspace-context-resolver-restore-failed" -Target $target -Reason "Failed to refresh the current runtime sparse paths before loading WorkspaceContext.psm1" -Phase "preflight")
  }

  return (Write-UpdateResult -Status "workspace-context-resolver-restored" -Target $target -Reason "Restored scripts/lib/** omitted by a legacy updater sparse checkout" -Phase "preflight")
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

function Invoke-PluginConfigMigrations {
  param(
    [object]$Plugin,
    [string]$ProjectRootFull,
    [string]$AgentsRoot,
    [string]$Mode
  )

  $items = New-Object System.Collections.Generic.List[object]
  foreach ($migration in @($Plugin.manifest.configMigrations)) {
    if ($null -eq $migration -or [string]::IsNullOrWhiteSpace([string]$migration.script)) {
      continue
    }
    $migrationPath = Join-Path $Plugin.path ([string]$migration.script)
    $migrationId = [string]$migration.id
    if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
      $items.Add((Write-UpdateResult -Status "config-migration-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $migrationPath) -Reason ("migration script missing: " + $migrationId) -PluginName $Plugin.name -Phase "config-migration"))
      continue
    }
    try {
      $migrationMode = if ($Mode -eq "Check") { "DryRun" } else { $Mode }
      $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $migrationPath -ProjectRoot $ProjectRootFull -AgentsRoot $AgentsRoot -Mode $migrationMode | Out-String
      if ($LASTEXITCODE -ne 0) {
        throw "migration exited with code $LASTEXITCODE"
      }
      $parsed = $output.Trim() | ConvertFrom-Json
      foreach ($entry in @($parsed)) {
        $items.Add((Write-UpdateResult -Status ([string]$entry.status) -Target ([string]$entry.target) -Source $migrationId -Reason ([string]$entry.reason) -PluginName $Plugin.name -Phase "config-migration"))
      }
    }
    catch {
      $items.Add((Write-UpdateResult -Status "config-migration-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $migrationPath) -Source $migrationId -Reason $_.Exception.Message -PluginName $Plugin.name -Phase "config-migration"))
    }
  }
  return $items
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
    $legacyNames = @((Get-PluginManifestValue -Manifest $manifest -Names @("legacyNames", "legacy_names", "aliases")) | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if (($ExcludeNames -contains $pluginName) -or ($ExcludeNames -contains $_.Name) -or (@($legacyNames | Where-Object { $ExcludeNames -contains $_ }).Count -gt 0)) {
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

function Get-PluginManifestValue {
  param(
    [object]$Manifest,
    [string[]]$Names
  )

  foreach ($name in $Names) {
    if ($Manifest.PSObject.Properties.Name -contains $name) {
      $value = $Manifest.$name
      if ($null -ne $value) {
        return $value
      }
    }
  }
  return $null
}

function Get-PluginInitSkill {
  param(
    [object]$Plugin
  )

  $manifestValue = Get-PluginManifestValue -Manifest $Plugin.manifest -Names @("initSkill", "init_skill")
  if ($null -ne $manifestValue) {
    return [string]$manifestValue
  }

  $skillsRoot = Join-Path $Plugin.path "skills"
  if (Test-Path -LiteralPath $skillsRoot -PathType Container) {
    $candidate = Get-ChildItem -LiteralPath $skillsRoot -Directory |
      Where-Object { $_.Name -like "*-init" -or $_.Name -like "*project-init" -or $_.Name -eq "project-context-maintenance" } |
      Sort-Object Name |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.Name
    }
  }

  return ""
}

function Get-PluginDependencies {
  param(
    [object]$Plugin
  )

  $manifestValue = Get-PluginManifestValue -Manifest $Plugin.manifest -Names @("dependencies", "dependsOn", "depends_on")
  if ($null -eq $manifestValue) {
    return @()
  }
  return @($manifestValue | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-PluginLegacyNames {
  param(
    [object]$Plugin
  )

  $manifestValue = Get-PluginManifestValue -Manifest $Plugin.manifest -Names @("legacyNames", "legacy_names", "aliases")
  if ($null -eq $manifestValue) {
    return @()
  }
  return @($manifestValue | ForEach-Object { [string]$_ } | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne $Plugin.name -and $_ -ne $Plugin.directoryName
  })
}

function Test-PluginNameMatches {
  param(
    [object]$Plugin,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return $false
  }
  if ($Name -eq $Plugin.name -or $Name -eq $Plugin.directoryName) {
    return $true
  }
  return (Get-PluginLegacyNames -Plugin $Plugin) -contains $Name
}

function Get-PluginProfileLegacyName {
  param(
    [object]$Plugin,
    [hashtable]$Profile
  )

  foreach ($legacyName in (Get-PluginLegacyNames -Plugin $Plugin)) {
    if ($Profile.ContainsKey($legacyName)) {
      return $legacyName
    }
  }
  return ""
}

function Get-DefaultPluginStatus {
  param([string]$PluginName)

  if ($PluginName -eq "agent-context-kit") {
    return "enabled"
  }
  return "available"
}

function Normalize-PluginStatus {
  param([string]$Status)

  $normalized = $Status.ToLowerInvariant()
  if ($normalized -eq "initialized") {
    return "enabled"
  }
  if ($normalized -eq "indexed") {
    return "available"
  }
  if (@("available", "enabled", "disabled") -contains $normalized) {
    return $normalized
  }
  return "available"
}

function Get-PluginProfilePath {
  param([string]$AgentsRoot)
  return (Join-Path (Join-Path $AgentsRoot "config") "plugin_profile.md")
}

function Read-PluginProfile {
  param([string]$AgentsRoot)

  $profile = @{}
  $profilePath = Get-PluginProfilePath -AgentsRoot $AgentsRoot
  if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
    return $profile
  }

  $validStatuses = @("available", "enabled", "indexed", "initialized", "disabled")
  $lines = [System.IO.File]::ReadAllLines($profilePath, [System.Text.Encoding]::UTF8)
  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed.StartsWith("|")) {
      continue
    }
    if ($trimmed -match "^\|\s*-+\s*\|") {
      continue
    }
    $cells = @($trimmed.Trim("|").Split("|") | ForEach-Object { $_.Trim() })
    if ($cells.Count -lt 2) {
      continue
    }
    if ($cells[0] -eq "plugin") {
      continue
    }
    $pluginName = $cells[0]
    $status = $cells[1].ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($pluginName) -or -not ($validStatuses -contains $status)) {
      continue
    }
    $initSkill = ""
    if ($cells.Count -gt 2) {
      $initSkill = $cells[2]
    }
    $dependsOn = ""
    if ($cells.Count -gt 3) {
      $dependsOn = $cells[3]
    }
    $notes = ""
    if ($cells.Count -gt 4) {
      $notes = $cells[4]
    }
    $profile[$pluginName] = [PSCustomObject]@{
      plugin = $pluginName
      status = Normalize-PluginStatus -Status $status
      initSkill = $initSkill
      dependsOn = $dependsOn
      notes = $notes
    }
  }

  return $profile
}

function Get-PluginProfileEntry {
  param(
    [object]$Plugin,
    [hashtable]$Profile,
    [bool]$ExplicitlySelected
  )

  if ($Profile.ContainsKey($Plugin.name)) {
    return $Profile[$Plugin.name]
  }

  $legacyName = Get-PluginProfileLegacyName -Plugin $Plugin -Profile $Profile
  if (-not [string]::IsNullOrWhiteSpace($legacyName)) {
    $legacyEntry = $Profile[$legacyName]
    $dependsOn = Get-PluginDependencies -Plugin $Plugin
    $dependsOnText = if ($dependsOn.Count -gt 0) { $dependsOn -join ", " } else { "-" }
    return [PSCustomObject]@{
      plugin = $Plugin.name
      status = $legacyEntry.status
      initSkill = Get-PluginInitSkill -Plugin $Plugin
      dependsOn = $dependsOnText
      notes = ("migrated from " + $legacyName)
    }
  }

  $status = Get-DefaultPluginStatus -PluginName $Plugin.name

  $dependsOn = Get-PluginDependencies -Plugin $Plugin
  $dependsOnText = "-"
  if ($dependsOn.Count -gt 0) {
    $dependsOnText = $dependsOn -join ", "
  }
  $notesText = "default plugin state"
  if ($status -eq "available") {
    $notesText = "available capability; not enabled for this project"
  }
  [PSCustomObject]@{
    plugin = $Plugin.name
    status = $status
    initSkill = Get-PluginInitSkill -Plugin $Plugin
    dependsOn = $dependsOnText
    notes = $notesText
  }
}

function Write-PluginProfile {
  param(
    [string]$AgentsRoot,
    [object[]]$Plugins,
    [hashtable]$ExistingProfile,
    [string[]]$ExplicitPluginNames
  )

  $profilePath = Get-PluginProfilePath -AgentsRoot $AgentsRoot
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $profilePath) | Out-Null

  $pipe = [char]124
  $lines = @(
    "# Plugin Profile",
    "",
    "This file records plugin enablement for the target project. A plugin directory means available only, not enabled.",
    "",
    ($pipe + " plugin " + $pipe + " status " + $pipe + " initSkill " + $pipe + " dependsOn " + $pipe + " notes " + $pipe),
    ($pipe + "---" + $pipe + "---" + $pipe + "---" + $pipe + "---" + $pipe + "---" + $pipe)
  )

  foreach ($plugin in ($Plugins | Sort-Object name)) {
    $explicit = @($ExplicitPluginNames | Where-Object { Test-PluginNameMatches -Plugin $plugin -Name $_ }).Count -gt 0
    $entry = Get-PluginProfileEntry -Plugin $plugin -Profile $ExistingProfile -ExplicitlySelected $explicit
    $initSkill = $entry.initSkill
    if ([string]::IsNullOrWhiteSpace($initSkill)) {
      $initSkill = "-"
    }
    $dependsOn = $entry.dependsOn
    if ([string]::IsNullOrWhiteSpace($dependsOn)) {
      $dependsOn = "-"
    }
    $notes = $entry.notes
    if ([string]::IsNullOrWhiteSpace($notes)) {
      $notes = "-"
    }
    $lines += ('{0} {1} {0} {2} {0} {3} {0} {4} {0} {5} {0}' -f $pipe, $plugin.name, $entry.status, $initSkill, $dependsOn, $notes)
  }

  [System.IO.File]::WriteAllLines($profilePath, $lines, [System.Text.UTF8Encoding]::new($false))
}

function Test-PluginShouldProcess {
  param(
    [object]$ProfileEntry,
    [bool]$ExplicitlySelected
  )

  if ($ExplicitlySelected) {
    return $ProfileEntry.status -eq "enabled"
  }
  return $ProfileEntry.status -eq "enabled"
}

function Test-PluginDependenciesInitialized {
  param(
    [object]$Plugin,
    [object[]]$AllPlugins,
    [hashtable]$Profile,
    [string[]]$ExplicitPluginNames
  )

  $missing = New-Object System.Collections.Generic.List[string]
  $dependencies = Get-PluginDependencies -Plugin $Plugin
  foreach ($dependencyName in $dependencies) {
    $dependencyPlugin = $AllPlugins | Where-Object { Test-PluginNameMatches -Plugin $_ -Name $dependencyName } | Select-Object -First 1
    if (-not $dependencyPlugin) {
      $missing.Add($dependencyName)
      continue
    }
    $dependencyExplicit = @($ExplicitPluginNames | Where-Object { Test-PluginNameMatches -Plugin $dependencyPlugin -Name $_ }).Count -gt 0
    $dependencyEntry = Get-PluginProfileEntry -Plugin $dependencyPlugin -Profile $Profile -ExplicitlySelected $dependencyExplicit
    if ($dependencyEntry.status -ne "enabled") {
      $missing.Add(("{0}:{1}" -f $dependencyName, $dependencyEntry.status))
    }
  }

  return $missing
}

function Convert-ThinIndexTextOutput {
  param(
    [string]$Text,
    [string]$PluginName,
    [string]$Phase = "thin-index"
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
      -Phase $Phase))
  }

  if ($items.Count -eq 0) {
    $items.Add((Write-UpdateResult -Status "thin-index-output" -Reason $Text.Trim() -PluginName $PluginName -Phase $Phase))
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
    "git-version-unsupported",
    "git-status-failed",
    "git-head-resolve-failed",
    "git-upstream-missing",
    "git-divergence-check-failed",
    "pull-blocked-dirty",
    "pull-blocked-ahead",
    "pull-blocked-diverged",
    "fetch-failed",
    "pull-failed",
    "sparse-refresh-failed",
    "conflict",
    "config-review-required",
    "config-migration-review-required",
    "config-migration-conflict",
    "config-migration-failed",
    "submodule-init-required",
    "script-conflict",
    "thin-index-script-missing",
    "entrypoint-check-missing",
    "agent-thin-index-script-missing",
   "vendor-skill-sync-script-missing",
    "vendor-thin-index-script-missing",
    "skill-dependency-resolver-missing",
    "skill-dependency-source-missing",
    "legacy-vendor-profile-review-required",
    "sync-claudecode-skills-script-missing",
    "maintenance-only-skill-remove-failed",
    "mcp-vendor-preference-script-missing",
    "mcp-vendor-executable-missing",
    "mcp-vendor-config-invalid",
    "mcp-vendor-command-ambiguous",
    "mcp-vendor-command-write-failed",
   "plugin-init-required",
   "plugin-dependency-missing"
  )

  $configStatuses = @(
    "config-missing-file",
    "config-created",
    "config-missing-key",
    "config-merged-key",
    "config-deprecated-candidate",
    "config-review-required",
    "config-migration-planned",
    "config-migration-applied",
    "config-migration-unchanged",
    "config-migration-review-required",
    "config-migration-conflict",
    "config-migration-failed",
    "submodule-init-required",
    "script-wrapper-planned",
    "script-wrapper-applied",
    "script-conflict"
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

  $availablePlugins = @($Results | Where-Object { $_.phase -eq "plugin" -and $_.status -eq "plugin-available" } | Select-Object -ExpandProperty plugin -Unique)
  if ($availablePlugins.Count -gt 0) {
    Write-Output ("Available plugins: " + ($availablePlugins -join ", "))
  }

  $disabledPlugins = @($Results | Where-Object { $_.phase -eq "plugin" -and $_.status -eq "plugin-disabled" } | Select-Object -ExpandProperty plugin -Unique)
  if ($disabledPlugins.Count -gt 0) {
    Write-Output ("Disabled plugins: " + ($disabledPlugins -join ", "))
  }

  $selectedPlugins = @($Results | Where-Object { $_.phase -eq "plugin" -and $_.status -eq "plugin-selected" } | Select-Object -ExpandProperty plugin -Unique)
  if ($selectedPlugins.Count -gt 0) {
    Write-Output ("Selected plugins: " + ($selectedPlugins -join ", "))
  }

  $groups = $Results | Group-Object status | Sort-Object Name
  foreach ($group in $groups) {
    if ([string]::IsNullOrWhiteSpace($group.Name)) {
      continue
    }
    Write-Output ("{0}: {1}" -f $group.Name, $group.Count)
  }

  $gitSyncResults = @($Results | Where-Object { $_.status -in @("agents-up-to-date", "agents-updated") })
  if ($gitSyncResults.Count -gt 0) {
    Write-Output ""
    Write-Output "Git capability:"
    foreach ($item in $gitSyncResults) {
      Write-Output ("- {0} old={1} new={2} upstream={3}" -f $item.status, $item.oldHash, $item.newHash, $item.upstreamHash)
    }
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

  try {
    Assert-GitSparseCheckoutSubcommandAvailable
  }
  catch {
    $results.Add((Write-UpdateResult -Status "git-version-unsupported" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason $_.Exception.Message -Phase "git"))
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

  $oldHashOutput = @(git -C $AgentsRoot rev-parse --verify HEAD 2>$null)
  if (($LASTEXITCODE -ne 0) -or ($oldHashOutput.Count -eq 0)) {
    $results.Add((Write-UpdateResult -Status "git-head-resolve-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "cannot resolve local HEAD" -Phase "git"))
    return $results
  }
  $oldHash = ([string]$oldHashOutput[0]).Trim()

  git -C $AgentsRoot fetch --prune | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $results.Add((Write-UpdateResult -Status "fetch-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "git fetch --prune failed" -Phase "git"))
    return $results
  }

  $upstreamRef = "@{upstream}"
  $upstreamHashOutput = @(git -C $AgentsRoot rev-parse --verify $upstreamRef 2>$null)
  if (($LASTEXITCODE -ne 0) -or ($upstreamHashOutput.Count -eq 0)) {
    $results.Add((Write-UpdateResult -Status "git-upstream-missing" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "current branch has no resolvable upstream after fetch" -Phase "git" -OldHash $oldHash))
    return $results
  }
  $upstreamHash = ([string]$upstreamHashOutput[0]).Trim()

  $divergenceOutput = @(git -C $AgentsRoot rev-list --left-right --count ("HEAD..." + $upstreamRef) 2>$null)
  if (($LASTEXITCODE -ne 0) -or ($divergenceOutput.Count -eq 0)) {
    $results.Add((Write-UpdateResult -Status "git-divergence-check-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "cannot compare local HEAD with upstream" -Phase "git" -OldHash $oldHash -UpstreamHash $upstreamHash))
    return $results
  }
  $divergenceParts = ([string]$divergenceOutput[0]).Trim() -split "\s+"
  $aheadCount = 0
  $behindCount = 0
  $divergenceValid = ($divergenceParts.Count -eq 2) -and [int]::TryParse($divergenceParts[0], [ref]$aheadCount) -and [int]::TryParse($divergenceParts[1], [ref]$behindCount)
  if (-not $divergenceValid) {
    $results.Add((Write-UpdateResult -Status "git-divergence-check-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason ("unexpected rev-list output: " + ([string]$divergenceOutput[0]).Trim()) -Phase "git" -OldHash $oldHash -UpstreamHash $upstreamHash))
    return $results
  }

  if (($aheadCount -gt 0) -and ($behindCount -eq 0)) {
    $results.Add((Write-UpdateResult -Status "pull-blocked-ahead" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason ("local .agents branch is ahead of upstream by {0} commit(s)" -f $aheadCount) -Phase "git" -OldHash $oldHash -NewHash $oldHash -UpstreamHash $upstreamHash))
    return $results
  }
  if (($aheadCount -gt 0) -and ($behindCount -gt 0)) {
    $results.Add((Write-UpdateResult -Status "pull-blocked-diverged" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason ("local .agents branch diverged from upstream: ahead={0}, behind={1}" -f $aheadCount, $behindCount) -Phase "git" -OldHash $oldHash -NewHash $oldHash -UpstreamHash $upstreamHash))
    return $results
  }

  $gitStatus = "agents-up-to-date"
  $gitReason = "upstream unchanged; pull skipped; sparse checkout refresh completed"
  $newHash = $oldHash
  if ($behindCount -gt 0) {
    git -C $AgentsRoot pull --ff-only | Out-Null
    if ($LASTEXITCODE -ne 0) {
      $results.Add((Write-UpdateResult -Status "pull-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "git pull --ff-only failed" -Phase "git" -OldHash $oldHash -NewHash $oldHash -UpstreamHash $upstreamHash))
      return $results
    }

    $newHashOutput = @(git -C $AgentsRoot rev-parse --verify HEAD 2>$null)
    $newHashExitCode = $LASTEXITCODE
    $refreshedUpstreamOutput = @(git -C $AgentsRoot rev-parse --verify $upstreamRef 2>$null)
    $refreshedUpstreamExitCode = $LASTEXITCODE
    if (($newHashExitCode -ne 0) -or ($refreshedUpstreamExitCode -ne 0) -or ($newHashOutput.Count -eq 0) -or ($refreshedUpstreamOutput.Count -eq 0)) {
      $results.Add((Write-UpdateResult -Status "pull-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "cannot verify HEAD and upstream after pull" -Phase "git" -OldHash $oldHash -NewHash $oldHash -UpstreamHash $upstreamHash))
      return $results
    }
    $newHash = ([string]$newHashOutput[0]).Trim()
    $upstreamHash = ([string]$refreshedUpstreamOutput[0]).Trim()
    if ($newHash -ne $upstreamHash) {
      $results.Add((Write-UpdateResult -Status "pull-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "local HEAD does not match upstream after pull" -Phase "git" -OldHash $oldHash -NewHash $newHash -UpstreamHash $upstreamHash))
      return $results
    }
    $gitStatus = "agents-updated"
    $gitReason = "fast-forward pull and sparse checkout refresh completed"
  }

  git -C $AgentsRoot sparse-checkout init --no-cone | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $runtimeSparsePaths | git -C $AgentsRoot sparse-checkout set --stdin --no-cone | Out-Null
  }
  if ($LASTEXITCODE -ne 0) {
    $results.Add((Write-UpdateResult -Status "sparse-refresh-failed" -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason "sparse checkout refresh failed" -Phase "git" -OldHash $oldHash -NewHash $newHash -UpstreamHash $upstreamHash))
    return $results
  }

  $results.Add((Write-UpdateResult -Status $gitStatus -Target (Get-RelativePathPortable -From $ProjectRootFull -To $AgentsRoot) -Reason $gitReason -Phase "git" -OldHash $oldHash -NewHash $newHash -UpstreamHash $upstreamHash))
  return $results
}

function Remove-MaintenanceOnlyRuntimeSkill {
  param(
    [string]$AgentsRoot,
    [string]$ProjectRootFull,
    [string]$Mode
  )

  $results = New-Object System.Collections.Generic.List[object]
  $maintenanceSkillPath = Join-Path $AgentsRoot "skills/agent-kit-maintenance"
  if (-not (Test-Path -LiteralPath $maintenanceSkillPath)) {
    return $results
  }

  $target = Get-RelativePathPortable -From $ProjectRootFull -To $maintenanceSkillPath
  if ($Mode -eq "Write") {
    try {
      Remove-Item -LiteralPath $maintenanceSkillPath -Recurse -Force
      $results.Add((Write-UpdateResult -Status "maintenance-only-skill-removed" -Target $target -Reason "maintenance-only skill is not part of business-project deployment" -Phase "compat-cleanup"))
    }
    catch {
      $results.Add((Write-UpdateResult -Status "maintenance-only-skill-remove-failed" -Target $target -Reason $_.Exception.Message -Phase "compat-cleanup"))
    }
  }
  else {
    $results.Add((Write-UpdateResult -Status "maintenance-only-skill-present" -Target $target -Reason "run Write mode to remove maintenance-only deployed residue" -Phase "compat-cleanup"))
  }

  return $results
}

function Get-GitHooksStatus {
  param(
    [string]$AgentsRoot,
    [string]$ProjectRootFull
  )

  $results = New-Object System.Collections.Generic.List[object]
  $hookPath = Join-Path $AgentsRoot "hooks/pre-commit"
  $installScriptPath = Join-Path $AgentsRoot "scripts/install-git-hooks.ps1"
  $target = ".agents/hooks"

  if ((-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) -or (-not (Test-Path -LiteralPath $installScriptPath -PathType Leaf))) {
    $results.Add((Write-UpdateResult -Status "git-hooks-unavailable" -Target $target -Reason "pre-commit hook or install-git-hooks.ps1 is missing" -Phase "git-hooks"))
    return $results
  }

  $configured = git -C $ProjectRootFull config --get core.hooksPath 2>$null
  if ($LASTEXITCODE -ne 0) {
    $configured = ""
  }
  $configuredNormalized = ($configured -replace '\\', '/').Trim().TrimEnd('/')

  if ($configuredNormalized -eq $target) {
    $results.Add((Write-UpdateResult -Status "git-hooks-enabled" -Target $target -Reason "core.hooksPath points to .agents/hooks" -Phase "git-hooks"))
  }
  else {
    $reason = if ([string]::IsNullOrWhiteSpace($configuredNormalized)) {
      "hook files are available; run .agents/scripts/install-git-hooks.ps1 to enable"
    }
    else {
      "core.hooksPath is '$configured'; run .agents/scripts/install-git-hooks.ps1 to use .agents/hooks"
    }
    $results.Add((Write-UpdateResult -Status "git-hooks-not-enabled" -Target $target -Reason $reason -Phase "git-hooks"))
  }

  return $results
}

$workspaceContextModule = Join-Path $PSScriptRoot "lib/WorkspaceContext.psm1"
$workspaceContextBootstrapResult = $null
if (-not (Test-Path -LiteralPath $workspaceContextModule -PathType Leaf)) {
  $canRestoreLegacySparseRuntime = $ResumedAfterSelfUpdate -or ($Mode -eq "Write") -or (($Mode -eq "DryRun") -and (-not $NoPull))
  if ($canRestoreLegacySparseRuntime) {
    $bootstrapAgentsRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    $workspaceContextBootstrapResult = Restore-LegacySparseRuntimeModules -AgentsRoot $bootstrapAgentsRoot -WorkspaceContextModule $workspaceContextModule
  }
  if (-not (Test-Path -LiteralPath $workspaceContextModule -PathType Leaf)) {
    if ($null -ne $workspaceContextBootstrapResult) {
      $workspaceContextBootstrapResult
    }
    else {
      Write-UpdateResult -Status "workspace-context-resolver-missing" -Target $workspaceContextModule -Reason "scripts/lib/WorkspaceContext.psm1 is required; rerun an update-capable DryRun/Write without -NoPull to repair a legacy sparse checkout" -Phase "preflight"
    }
    return
  }
}
Import-Module $workspaceContextModule -Force

$context = Resolve-AgentWorkspaceContext -ProjectRoot $ProjectRoot
$projectRootFull = $context.workspaceRoot
$contextRoot = $context.contextRoot
$capabilityRoot = $context.capabilityRoot
$agentsRoot = $contextRoot
$results = New-Object System.Collections.Generic.List[object]
if ($null -ne $workspaceContextBootstrapResult) {
  $results.Add($workspaceContextBootstrapResult)
}
if ($ResumedAfterSelfUpdate -and $NoPull -and (-not [string]::IsNullOrWhiteSpace($ResumedGitStatus))) {
  $results.Add((Write-UpdateResult -Status $ResumedGitStatus -Target (Get-RelativePathPortable -From $projectRootFull -To $agentsRoot) -Reason "Git result carried forward after updater self-restart; continuing local convergence" -Phase "git" -OldHash $ResumedOldHash -NewHash $ResumedNewHash -UpstreamHash $ResumedUpstreamHash))
}
$runningScriptPath = $MyInvocation.MyCommand.Path
$runningScriptHash = if (Test-Path -LiteralPath $runningScriptPath -PathType Leaf) { (Get-FileHash -LiteralPath $runningScriptPath -Algorithm SHA256).Hash } else { "" }

if (-not (Test-Path -LiteralPath $contextRoot -PathType Container)) {
  Write-UpdateResult -Status "agents-missing" -Target ".agents" -Reason ".agents directory does not exist" -Phase "preflight"
  return
}

if ($context.mode -eq "workspace-overlay") {
  $initializer = Join-Path $capabilityRoot "scripts/initialize-workspace-overlay.ps1"
  if (-not (Test-Path -LiteralPath $initializer -PathType Leaf)) {
    $results.Add((Write-UpdateResult -Status "workspace-overlay-initializer-missing" -Target $initializer -Reason "CapabilityRoot initializer is missing" -Phase "workspace-context"))
  }
  else {
    $overlayResults = @(& $initializer -WorkspaceRoot $projectRootFull -Mode $Mode)
    foreach ($item in $overlayResults) {
      $results.Add((Write-UpdateResult -Status ([string]$item.status) -Target ([string]$item.path) -Source ([string]$item.expected) -Reason ([string]$item.reason) -Phase "workspace-context"))
    }
  }
  $skipReason = if ($NoPull) { "Overlay context refresh explicitly requested -NoPull" } else { "Overlay context never fetches or pulls CapabilityRoot" }
  $results.Add((Write-UpdateResult -Status "capability-pull-skipped-overlay" -Target $capabilityRoot -Reason $skipReason -Phase "git"))
  if ($results | Where-Object { $_.status -in @("workspace-overlay-initializer-missing", "workspace-overlay-blocked", "manifest-invalid", "schema-version-unsupported", "capability-root-missing", "capability-git-missing", "source-root-missing", "git-root-missing", "source-path-missing", "source-path-not-junction", "junction-target-mismatch", "shared-path-not-junction", "local-path-is-link", "runtime-adapter-source-missing", "runtime-adapter-source-invalid") }) {
    if ($Detailed) { $results | Format-List status, plugin, phase, target, source, reason } else { Write-UpdateSummary -Results $results -Mode $Mode }
    return
  }
}
elseif ((-not $NoPull) -and ($Mode -ne "Check")) {
  $gitResults = Invoke-AgentGitUpdate -AgentsRoot $agentsRoot -ProjectRootFull $projectRootFull
  foreach ($item in $gitResults) {
    $results.Add($item)
  }
  if ($gitResults | Where-Object { $_.status -in @("git-version-unsupported", "git-status-failed", "git-head-resolve-failed", "git-upstream-missing", "git-divergence-check-failed", "pull-blocked-dirty", "pull-blocked-ahead", "pull-blocked-diverged", "fetch-failed", "pull-failed", "sparse-refresh-failed") }) {
    $results | Format-List status, plugin, phase, target, source, reason, oldHash, newHash, upstreamHash
    exit 1
  }
  $updatedScriptHash = if (Test-Path -LiteralPath $runningScriptPath -PathType Leaf) { (Get-FileHash -LiteralPath $runningScriptPath -Algorithm SHA256).Hash } else { $runningScriptHash }
  if ((-not $ResumedAfterSelfUpdate) -and ($updatedScriptHash -ne $runningScriptHash)) {
    $resumeParams = @{
      ProjectRoot = $projectRootFull
      Mode = $Mode
      Plugin = $Plugin
      ExcludePlugin = $ExcludePlugin
      RuntimeAdapter = $RuntimeAdapter
      NoPull = $true
      ResumedAfterSelfUpdate = $true
      ResumedGitStatus = [string]$gitResults[0].status
      ResumedOldHash = [string]$gitResults[0].oldHash
      ResumedNewHash = [string]$gitResults[0].newHash
      ResumedUpstreamHash = [string]$gitResults[0].upstreamHash
    }
    if ($ForceThinIndex) { $resumeParams.ForceThinIndex = $true }
    if ($CleanupLegacyVendorSkills) { $resumeParams.CleanupLegacyVendorSkills = $true }
    if ($Detailed) { $resumeParams.Detailed = $true }
    & $runningScriptPath @resumeParams
    exit $LASTEXITCODE
  }
}
elseif (($context.mode -eq "standard") -and (-not (Test-Path -LiteralPath (Join-Path $agentsRoot ".git")))) {
  $results.Add((Write-UpdateResult -Status "agents-git-missing" -Target ".agents" -Reason ".agents is not an independent Git repository" -Phase "git"))
}

if ($context.mode -eq "standard") {
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
}
else {
  $results.Add((Write-UpdateResult -Status "context-exclude-skipped-overlay" -Target $contextRoot -Reason "ContextRoot has no independent .git" -Phase "exclude"))
}

$agentsRootPrefix = ([System.IO.Path]::GetFullPath($agentsRoot)).TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
$runningFromInstalledAgents = ([System.IO.Path]::GetFullPath($runningScriptPath)).StartsWith($agentsRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
if ($runningFromInstalledAgents) {
  foreach ($item in (Remove-MaintenanceOnlyRuntimeSkill -AgentsRoot $agentsRoot -ProjectRootFull $projectRootFull -Mode $Mode)) {
    $results.Add($item)
  }
}

$preferVendorIrisMcpScript = Join-Path $capabilityRoot "scripts/prefer-vendor-iris-mcp.ps1"
if (Test-Path -LiteralPath $preferVendorIrisMcpScript -PathType Leaf) {
  $preferenceMode = if ($Mode -eq "Write") { "Write" } else { "DryRun" }
  foreach ($item in @(& $preferVendorIrisMcpScript -ProjectRoot $projectRootFull -ContextRoot $contextRoot -Mode $preferenceMode)) {
    $results.Add((Write-UpdateResult -Status ([string]$item.status) -Target ([string]$item.target) -Reason ([string]$item.reason) -Phase "mcp-runtime"))
  }
}
else {
  $results.Add((Write-UpdateResult -Status "mcp-vendor-preference-script-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $preferVendorIrisMcpScript) -Reason "cannot prefer the bundled iris-agentic-dev executable" -Phase "mcp-runtime"))
}

foreach ($item in (Get-GitHooksStatus -AgentsRoot $agentsRoot -ProjectRootFull $projectRootFull)) {
  $results.Add($item)
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
  $results.Add((Write-UpdateResult -Status "agents-entry-missing" -Target "AGENTS.md" -Reason "project entrypoint missing; maintain it through project-context-maintenance" -Phase "entrypoint"))
}

$allPlugins = Get-InstalledPlugins -AgentsRoot $capabilityRoot -IncludeNames @() -ExcludeNames $ExcludePlugin
$pluginProfile = Read-PluginProfile -AgentsRoot $agentsRoot
$plugins = New-Object System.Collections.Generic.List[object]
$matchedPluginCount = 0

foreach ($installedPlugin in $allPlugins) {
  $explicitlySelected = (($Plugin.Count -gt 0) -and (@($Plugin | Where-Object { Test-PluginNameMatches -Plugin $installedPlugin -Name $_ }).Count -gt 0))
  if (($Plugin.Count -gt 0) -and (-not $explicitlySelected)) {
    continue
  }
  $matchedPluginCount++

  $legacyProfileName = Get-PluginProfileLegacyName -Plugin $installedPlugin -Profile $pluginProfile
  if (-not [string]::IsNullOrWhiteSpace($legacyProfileName)) {
    $migrationStatus = if ($Mode -eq "Write") { "plugin-profile-name-migrated" } else { "plugin-profile-name-migration-planned" }
    $results.Add((Write-UpdateResult -Status $migrationStatus -Target ".agents/config/plugin_profile.md" -Source $legacyProfileName -Reason ("preserve status under " + $installedPlugin.name) -PluginName $installedPlugin.name -Phase "plugin"))
  }

  $profileEntry = Get-PluginProfileEntry -Plugin $installedPlugin -Profile $pluginProfile -ExplicitlySelected $explicitlySelected
  $pluginTarget = Get-RelativePathPortable -From $projectRootFull -To $installedPlugin.path
  if ($profileEntry.status -eq "disabled") {
    $disabledStatus = if ($explicitlySelected) { "plugin-explicit-selection-disabled" } else { "plugin-disabled" }
    $results.Add((Write-UpdateResult -Status $disabledStatus -Target $pluginTarget -Reason "plugin is disabled in plugin_profile.md" -PluginName $installedPlugin.name -Phase "plugin"))
    continue
  }

  if (-not (Test-PluginShouldProcess -ProfileEntry $profileEntry -ExplicitlySelected $explicitlySelected)) {
    $initSkill = if ([string]::IsNullOrWhiteSpace($profileEntry.initSkill)) { Get-PluginInitSkill -Plugin $installedPlugin } else { $profileEntry.initSkill }
    if ($explicitlySelected) {
      $results.Add((Write-UpdateResult -Status "plugin-init-required" -Target $pluginTarget -Reason ("read initSkill=" + $initSkill) -PluginName $installedPlugin.name -Phase "plugin"))
    }
    else {
      $results.Add((Write-UpdateResult -Status "plugin-available" -Target $pluginTarget -Reason ("initSkill=" + $initSkill) -PluginName $installedPlugin.name -Phase "plugin"))
    }
    continue
  }

  $missingDependencies = Test-PluginDependenciesInitialized -Plugin $installedPlugin -AllPlugins $allPlugins -Profile $pluginProfile -ExplicitPluginNames $Plugin
  if ($missingDependencies.Count -gt 0) {
    $results.Add((Write-UpdateResult -Status "plugin-dependency-missing" -Target $pluginTarget -Reason ("requires enabled: " + ($missingDependencies -join ", ")) -PluginName $installedPlugin.name -Phase "plugin"))
    continue
  }

  $plugins.Add($installedPlugin)
  $status = if ($explicitlySelected) { "plugin-selected" } else { "plugin-found" }
  $results.Add((Write-UpdateResult -Status $status -Target $pluginTarget -Reason $profileEntry.status -PluginName $installedPlugin.name -Phase "plugin"))
}

if ($Mode -eq "Write") {
  Write-PluginProfile -AgentsRoot $agentsRoot -Plugins $allPlugins -ExistingProfile $pluginProfile -ExplicitPluginNames $Plugin
  $results.Add((Write-UpdateResult -Status "plugin-profile-written" -Target (Get-RelativePathPortable -From $projectRootFull -To (Get-PluginProfilePath -AgentsRoot $agentsRoot)) -Reason "plugin states recorded" -Phase "plugin"))
}

foreach ($installedPlugin in $plugins) {

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

  $migrationResults = Invoke-PluginConfigMigrations -Plugin $installedPlugin -ProjectRootFull $projectRootFull -AgentsRoot $agentsRoot -Mode $Mode
  foreach ($item in $migrationResults) {
    $results.Add($item)
  }

  $thinIndexScript = Join-Path $capabilityRoot "scripts/generate-plugin-thin-index.ps1"
  if (Test-Path -LiteralPath $thinIndexScript -PathType Leaf) {
    $thinIndexMode = if ($Mode -eq "Write") { "Write" } else { "DryRun" }
    $pluginPathRel = Get-RelativePathPortable -From $projectRootFull -To $installedPlugin.path
    $thinParams = @{
      PluginPath = $installedPlugin.path
      ProjectRoot = $projectRootFull
      ContextRoot = $contextRoot
      CapabilityRoot = $capabilityRoot
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

$agentThinIndexScript = Join-Path $agentsRoot "scripts/generate-agent-thin-index.ps1"
if (Test-Path -LiteralPath $agentThinIndexScript -PathType Leaf) {
  $agentThinIndexMode = if ($Mode -eq "Write") { "Write" } else { "DryRun" }
  $agentThinParams = @{
    ProjectRoot = $projectRootFull
    ContextRoot = $contextRoot
    CapabilityRoot = $capabilityRoot
    Mode = $agentThinIndexMode
  }
  if ($ForceThinIndex) {
    $agentThinParams.Force = $true
  }
  $agentThinOutput = & $agentThinIndexScript @agentThinParams | Out-String
  $agentThinResults = Convert-ThinIndexTextOutput -Text $agentThinOutput -PluginName "" -Phase "agent-thin-index"
  foreach ($item in $agentThinResults) {
    $results.Add($item)
  }
}
else {
  $results.Add((Write-UpdateResult -Status "agent-thin-index-script-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $agentThinIndexScript) -Reason "agent thin-index script missing" -Phase "agent-thin-index"))
}

$resolverScript = Join-Path $agentsRoot "scripts/resolve-plugin-skill-dependencies.ps1"
$resolvedSkillDependencies = @()
$dependencyPluginNames = @($plugins | ForEach-Object { $_.name }) + @($Plugin)
if (Test-Path -LiteralPath $resolverScript -PathType Leaf) {
  $resolverOutput = & $resolverScript -ProjectRoot $projectRootFull -ContextRoot $contextRoot -CapabilityRoot $capabilityRoot -Plugin $dependencyPluginNames -OutputFormat Json | Out-String
  if (-not [string]::IsNullOrWhiteSpace($resolverOutput)) {
    $resolvedSkillDependencies = $resolverOutput | ConvertFrom-Json
  }
  foreach ($dependency in $resolvedSkillDependencies) {
    $status = if (-not $dependency.sourceExists) { "skill-dependency-source-missing" } elseif ($dependency.type -eq "required") { "skill-dependency-required" } else { "skill-dependency-optional" }
    $results.Add((Write-UpdateResult -Status $status -Target $dependency.name -Source $dependency.source -Reason $dependency.capability -PluginName $dependency.plugin -Phase "skill-dependency"))
  }
}
else {
  $results.Add((Write-UpdateResult -Status "skill-dependency-resolver-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $resolverScript) -Reason "dependency resolver missing" -Phase "skill-dependency"))
}

$profilePathBeforeWrite = Get-PluginProfilePath -AgentsRoot $agentsRoot
if ((-not (Test-Path -LiteralPath $profilePathBeforeWrite -PathType Leaf)) -and (Test-Path -LiteralPath (Join-Path $agentsRoot "skills") -PathType Container)) {
  $legacyVendorIndexes = @(Get-ChildItem -LiteralPath (Join-Path $agentsRoot "skills") -Recurse -Filter "SKILL.md" -ErrorAction SilentlyContinue | Where-Object {
    (Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8) -match 'source:\s+\.agents/vendor/'
  })
  if ($legacyVendorIndexes.Count -gt 0) {
    $results.Add((Write-UpdateResult -Status "legacy-vendor-profile-review-required" -Target ".agents/config/plugin_profile.md" -Reason ("profile was missing; preserving {0} legacy vendor thin-indexes until plugin states are confirmed" -f $legacyVendorIndexes.Count) -Phase "compat-migration"))
  }
}

$syncVendorSkillsScript = Join-Path $agentsRoot "scripts/sync-vendor-skills.ps1"
if (Test-Path -LiteralPath $syncVendorSkillsScript -PathType Leaf) {
  $legacyRuntimeOutput = & $syncVendorSkillsScript -ProjectRoot $projectRootFull -ContextRoot $contextRoot -CapabilityRoot $capabilityRoot -Mode DryRun -ReportLegacy | Out-String
  foreach ($item in (Convert-ThinIndexTextOutput -Text $legacyRuntimeOutput -PluginName "" -Phase "runtime-adapter")) {
    $results.Add($item)
  }
}
else {
  $results.Add((Write-UpdateResult -Status "vendor-skill-sync-script-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $syncVendorSkillsScript) -Reason "runtime adapter compatibility wrapper missing" -Phase "runtime-adapter"))
}

$vendorThinIndexScript = Join-Path $agentsRoot "scripts/generate-vendor-thin-index.ps1"
if (Test-Path -LiteralPath $vendorThinIndexScript -PathType Leaf) {
  $vendorThinIndexMode = if ($Mode -eq "Write") { "Write" } else { "DryRun" }
  $vendorThinParams = @{
    ProjectRoot = $projectRootFull
    ContextRoot = $contextRoot
    CapabilityRoot = $capabilityRoot
    Mode = $vendorThinIndexMode
    Skill = @($resolvedSkillDependencies | Where-Object { $_.type -eq "required" -and $_.sourceExists } | ForEach-Object { $_.name })
  }
  if ($ForceThinIndex) {
    $vendorThinParams.Force = $true
  }
  if ($CleanupLegacyVendorSkills) {
    $vendorThinParams.CleanupLegacyVendorSkills = $true
  }
  $vendorThinOutput = & $vendorThinIndexScript @vendorThinParams | Out-String
  $vendorThinResults = Convert-ThinIndexTextOutput -Text $vendorThinOutput -PluginName "" -Phase "vendor-thin-index"
  foreach ($item in $vendorThinResults) {
    $results.Add($item)
  }
}
else {
  $results.Add((Write-UpdateResult -Status "vendor-thin-index-script-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $vendorThinIndexScript) -Reason "vendor thin-index script missing" -Phase "vendor-thin-index"))
}

$syncClaudeSkillsScript = Join-Path $agentsRoot "scripts/sync-claudecode-skills.ps1"
if ($RuntimeAdapter -contains "Codex") {
  $results.Add((Write-UpdateResult -Status "runtime-adapter-reused" -Target ".agents/skills" -Reason "Codex uses the common project discovery layer; user-level copies require explicit sync-vendor-skills.ps1" -Phase "runtime-adapter"))
}
if (($RuntimeAdapter -contains "ClaudeCode") -and (Test-Path -LiteralPath $syncClaudeSkillsScript -PathType Leaf)) {
  $syncMode = if ($Mode -eq "Write") { "Write" } else { "DryRun" }
  $syncOutput = & $syncClaudeSkillsScript -ProjectRoot $projectRootFull -ContextRoot $contextRoot -CapabilityRoot $capabilityRoot -Mode $syncMode | Out-String
  $syncResults = Convert-ThinIndexTextOutput -Text $syncOutput -PluginName "" -Phase "claudecode-skills"
  foreach ($item in $syncResults) {
    $results.Add($item)
  }
}
elseif ($RuntimeAdapter -contains "ClaudeCode") {
  $results.Add((Write-UpdateResult -Status "sync-claudecode-skills-script-missing" -Target (Get-RelativePathPortable -From $projectRootFull -To $syncClaudeSkillsScript) -Reason "sync claudecode skills script missing" -Phase "claudecode-skills"))
}
else {
  $results.Add((Write-UpdateResult -Status "runtime-adapter-skipped" -Target ".agents/skills" -Reason "project discovery layer is canonical; pass -RuntimeAdapter ClaudeCode only when native project sync is required" -Phase "runtime-adapter"))
}

if (($allPlugins.Count -eq 0) -or (($Plugin.Count -gt 0) -and ($matchedPluginCount -eq 0))) {
  $results.Add((Write-UpdateResult -Status "plugin-none" -Target (Get-RelativePathPortable -From $projectRootFull -To (Join-Path $agentsRoot "plugins")) -Reason "no installed plugins matched filters" -Phase "plugin"))
}

if ($Detailed) {
  $results | Format-List status, plugin, phase, target, source, reason, oldHash, newHash, upstreamHash
}
else {
  Write-UpdateSummary -Results $results -Mode $Mode
}
