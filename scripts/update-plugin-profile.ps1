param(
  [string]$ProjectRoot = ".",
  [Parameter(Mandatory = $true)]
  [string]$Plugin,
  [ValidateSet("available", "enabled", "disabled")]
  [string]$Status,
  [string]$InitSkill = "",
  [string[]]$DependsOn = @(),
  [string]$Notes = ""
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
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

function Get-InstalledPlugins {
  param([string]$AgentsRoot)

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
    $plugins.Add([PSCustomObject]@{
      name = $pluginName
      directoryName = $_.Name
      manifest = $manifest
    })
  }

  return $plugins
}

function Get-PluginInitSkill {
  param([object]$Plugin)

  $manifestValue = Get-PluginManifestValue -Manifest $Plugin.manifest -Names @("initSkill", "init_skill")
  if ($null -ne $manifestValue) {
    return [string]$manifestValue
  }
  return ""
}

function Get-PluginDependencies {
  param([object]$Plugin)

  $manifestValue = Get-PluginManifestValue -Manifest $Plugin.manifest -Names @("dependencies", "dependsOn", "depends_on")
  if ($null -eq $manifestValue) {
    return @()
  }
  return @($manifestValue | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Normalize-PluginStatus {
  param([string]$Value)

  $normalized = $Value.ToLowerInvariant()
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

function Read-PluginProfile {
  param([string]$ProfilePath)

  $profile = @{}
  if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
    return $profile
  }

  $lines = [System.IO.File]::ReadAllLines($ProfilePath, [System.Text.Encoding]::UTF8)
  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed.StartsWith("|")) {
      continue
    }
    if ($trimmed -match "^\|\s*-+\s*\|") {
      continue
    }
    $cells = @($trimmed.Trim("|").Split("|") | ForEach-Object { $_.Trim() })
    if ($cells.Count -lt 2 -or $cells[0] -eq "plugin") {
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
    $profile[$cells[0]] = [PSCustomObject]@{
      plugin = $cells[0]
      status = Normalize-PluginStatus -Value $cells[1]
      initSkill = $initSkill
      dependsOn = $dependsOn
      notes = $notes
    }
  }

  return $profile
}

function Get-DefaultStatus {
  param([string]$PluginName)
  if ($PluginName -eq "agent-context-kit") {
    return "enabled"
  }
  return "available"
}

function Write-PluginProfile {
  param(
    [string]$ProfilePath,
    [object[]]$Plugins,
    [hashtable]$Profile
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ProfilePath) | Out-Null
  $pipe = [char]124
  $lines = @(
    "# Plugin Profile",
    "",
    "This file records plugin enablement for the target project. A plugin directory means available only, not enabled.",
    "",
    ($pipe + " plugin " + $pipe + " status " + $pipe + " initSkill " + $pipe + " dependsOn " + $pipe + " notes " + $pipe),
    ($pipe + "---" + $pipe + "---" + $pipe + "---" + $pipe + "---" + $pipe + "---" + $pipe)
  )

  foreach ($pluginItem in ($Plugins | Sort-Object name)) {
    if ($Profile.ContainsKey($pluginItem.name)) {
      $entry = $Profile[$pluginItem.name]
      $statusValue = Normalize-PluginStatus -Value $entry.status
      $initSkillValue = $entry.initSkill
      $dependsOnValue = $entry.dependsOn
      $notesValue = $entry.notes
    }
    else {
      $statusValue = Get-DefaultStatus -PluginName $pluginItem.name
      $initSkillValue = Get-PluginInitSkill -Plugin $pluginItem
      $deps = Get-PluginDependencies -Plugin $pluginItem
      $dependsOnValue = if ($deps.Count -gt 0) { $deps -join ", " } else { "-" }
      $notesValue = if ($statusValue -eq "enabled") { "default base plugin" } else { "available capability; not enabled for this project" }
    }

    if ([string]::IsNullOrWhiteSpace($initSkillValue)) {
      $initSkillValue = "-"
    }
    if ([string]::IsNullOrWhiteSpace($dependsOnValue)) {
      $dependsOnValue = "-"
    }
    if ([string]::IsNullOrWhiteSpace($notesValue)) {
      $notesValue = "-"
    }
    $lines += ('{0} {1} {0} {2} {0} {3} {0} {4} {0} {5} {0}' -f $pipe, $pluginItem.name, $statusValue, $initSkillValue, $dependsOnValue, $notesValue)
  }

  [System.IO.File]::WriteAllLines($ProfilePath, $lines, [System.Text.UTF8Encoding]::new($false))
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$agentsRoot = Join-Path $projectRootFull ".agents"
if (-not (Test-Path -LiteralPath $agentsRoot -PathType Container)) {
  throw ".agents directory does not exist under ProjectRoot"
}

$plugins = Get-InstalledPlugins -AgentsRoot $agentsRoot
$targetPlugin = $plugins | Where-Object { $_.name -eq $Plugin -or $_.directoryName -eq $Plugin } | Select-Object -First 1
if (-not $targetPlugin) {
  throw "Plugin not found: $Plugin"
}

$profilePath = Join-Path (Join-Path $agentsRoot "config") "plugin_profile.md"
$profile = Read-PluginProfile -ProfilePath $profilePath

$targetInitSkill = $InitSkill
if ([string]::IsNullOrWhiteSpace($targetInitSkill)) {
  $targetInitSkill = Get-PluginInitSkill -Plugin $targetPlugin
}
$targetDependsOn = $DependsOn
if ($targetDependsOn.Count -eq 0) {
  $targetDependsOn = Get-PluginDependencies -Plugin $targetPlugin
}
$dependsOnText = if ($targetDependsOn.Count -gt 0) { $targetDependsOn -join ", " } else { "-" }
$notesText = $Notes
if ([string]::IsNullOrWhiteSpace($notesText)) {
  if ($Status -eq "enabled") {
    $notesText = "enabled by plugin init"
  }
  elseif ($Status -eq "disabled") {
    $notesText = "disabled by project choice"
  }
  else {
    $notesText = "available capability; not enabled for this project"
  }
}

$profile[$targetPlugin.name] = [PSCustomObject]@{
  plugin = $targetPlugin.name
  status = $Status
  initSkill = $targetInitSkill
  dependsOn = $dependsOnText
  notes = $notesText
}

Write-PluginProfile -ProfilePath $profilePath -Plugins $plugins -Profile $profile

[PSCustomObject]@{
  status = "plugin-profile-updated"
  plugin = $targetPlugin.name
  target = $profilePath
  value = $Status
} | Format-List status, plugin, target, value
