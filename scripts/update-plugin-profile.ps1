param(
  [string]$ProjectRoot = ".",
  [string]$ContextRoot = "",
  [string]$CapabilityRoot = "",
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
      legacyNames = @((Get-PluginManifestValue -Manifest $manifest -Names @("legacyNames", "legacy_names", "aliases")) | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    })
  }

  $catalogPath = Join-Path $AgentsRoot "scripts/lib/plugin-catalog.json"
  if (Test-Path -LiteralPath $catalogPath) {
    $catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($item in @($catalog.plugins)) {
      if (@($plugins | Where-Object { $_.name -eq $item.manifest.name }).Count -gt 0) { continue }
      $plugins.Add([PSCustomObject]@{ name=[string]$item.manifest.name; directoryName=[string]$item.directory; manifest=$item.manifest; path=(Join-Path $pluginsRoot $item.directory); manifestPath=(Join-Path $pluginsRoot ($item.directory + "/.agents-plugin/plugin.json")); legacyNames=@($item.manifest.legacyNames | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }) })
    }
  }
  return $plugins
}

function Test-PluginNameMatches {
  param([object]$Plugin, [string]$Name)
  return $Name -eq $Plugin.name -or $Name -eq $Plugin.directoryName -or $Plugin.legacyNames -contains $Name
}

function Get-LegacyProfileName {
  param([object]$Plugin, [hashtable]$Profile)
  foreach ($legacyName in $Plugin.legacyNames) {
    if ($Profile.ContainsKey($legacyName)) {
      return $legacyName
    }
  }
  return ""
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
  $encoded = & node (Join-Path $PSScriptRoot "lib/project-plugin-profile.js") read $contextRootFull
  if ($LASTEXITCODE -ne 0) { throw "Cannot read project plugin profile" }
  $state = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
  $profile = @{}
  foreach ($row in @($state.rows)) { $profile[$row.plugin] = $row }
  return $profile
}

function Get-DefaultStatus {
  param([string]$PluginName)
  if ($PluginName -in @("agent-context-kit", "agent-framework-evolution")) {
    return "enabled"
  }
  return "available"
}

function Write-PluginProfile {
  param(
    [string]$ProfilePath,
    [object[]]$Plugins,
    [hashtable]$Profile,
    [string[]]$RetainedRequirements = @()
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ProfilePath) | Out-Null
  $rows = @{}
  $aliases = @{}
  foreach ($pluginItem in ($Plugins | Sort-Object name)) {
    if ($Profile.ContainsKey($pluginItem.name)) {
      $entry = $Profile[$pluginItem.name]
      $statusValue = Normalize-PluginStatus -Value $entry.status
      $initSkillValue = $entry.initSkill
      $dependsOnValue = $entry.dependsOn
      $notesValue = $entry.notes
    }
    else {
      $legacyProfileName = Get-LegacyProfileName -Plugin $pluginItem -Profile $Profile
      if (-not [string]::IsNullOrWhiteSpace($legacyProfileName)) {
        $entry = $Profile[$legacyProfileName]
        $statusValue = Normalize-PluginStatus -Value $entry.status
        $initSkillValue = Get-PluginInitSkill -Plugin $pluginItem
        $deps = Get-PluginDependencies -Plugin $pluginItem
        $dependsOnValue = if ($deps.Count -gt 0) { $deps -join ", " } else { "-" }
        $notesValue = "migrated from " + $legacyProfileName
      }
      else {
        if ($RetainedRequirements -contains $pluginItem.name) { continue }
        $statusValue = Get-DefaultStatus -PluginName $pluginItem.name
        $initSkillValue = Get-PluginInitSkill -Plugin $pluginItem
        $deps = Get-PluginDependencies -Plugin $pluginItem
        $dependsOnValue = if ($deps.Count -gt 0) { $deps -join ", " } else { "-" }
        $notesValue = if ($statusValue -eq "enabled") { "default base plugin" } else { "available capability; not enabled for this project" }
      }
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
    $rows[$pluginItem.name] = @{ status=$statusValue; initSkill=$initSkillValue; dependsOn=$dependsOnValue; notes=$notesValue }
    foreach ($alias in @($pluginItem.legacyNames)) { if ($alias) { $aliases[$alias] = $pluginItem.name } }
  }

  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -Depth 6 -InputObject @{rows=$rows; aliases=$aliases})))
  $encoded | & node (Join-Path $PSScriptRoot "lib/project-plugin-profile.js") save $contextRootFull
  if ($LASTEXITCODE -ne 0) { throw "Cannot write project plugin profile" }
}

function Assert-DiscoveryOutput {
  param([string]$Text, [switch]$Verified)
  $Text = $Text.Replace("`r`n", "`n").Replace("`r", "`n")
  $matches = [regex]::Matches($Text, '(?m)^[ \t]*status[ \t]*:[ \t]*(?<value>[^\r\n]+)')
  if ($matches.Count -eq 0) { throw "Plugin discovery output invalid; profile preserved" }
  $allowed = @("generated", "updated", "unchanged", "removed", "skipped", "stale", "thin-index-stale", "skill-owner-migrated", "missing")
  foreach ($match in $matches) {
    $value = $match.Groups["value"].Value.Trim()
    if ($value -match 'conflict') { throw "Custom discovery entries require review before changing plugin status; profile preserved" }
    if ($value -notin $allowed) { throw "Plugin discovery output invalid; profile preserved" }
  }
  foreach ($block in [regex]::Split($Text.Trim(), '(?:\r?\n)[ \t]*(?:\r?\n)')) {
    if ($block -match '(?m)^[ \t]*status[ \t]*:[ \t]*missing[ \t]*$' -and $block -notmatch '(?m)^[ \t]*reason[ \t]*:[ \t]*plugin has no (rules|skills) directory[ \t]*$') {
      throw "Plugin discovery source missing; profile preserved"
    }
  }
  if ($Verified -and $Text -match '(?m)^[ \t]*status[ \t]*:[ \t]*(generated|updated|stale|thin-index-stale|skill-owner-migrated)[ \t]*$') {
    throw "Plugin discovery verification incomplete; profile preserved"
  }
}

$projectRootFull = Resolve-FullPath $ProjectRoot
if ([string]::IsNullOrWhiteSpace($ContextRoot) -or [string]::IsNullOrWhiteSpace($CapabilityRoot)) {
  $workspaceContextModule = Join-Path $PSScriptRoot "lib/WorkspaceContext.psm1"
  Import-Module $workspaceContextModule -Force
  $workspaceContext = Resolve-AgentWorkspaceContext -ProjectRoot $projectRootFull
  if ([string]::IsNullOrWhiteSpace($ContextRoot)) { $ContextRoot = $workspaceContext.contextRoot }
  if ([string]::IsNullOrWhiteSpace($CapabilityRoot)) { $CapabilityRoot = $workspaceContext.capabilityRoot }
}
$contextRootFull = Resolve-FullPath $ContextRoot
$capabilityRootFull = Resolve-FullPath $CapabilityRoot
if (-not (Test-Path -LiteralPath $contextRootFull -PathType Container)) {
  throw ".agents directory does not exist under ProjectRoot"
}

$profileDeploymentToken = $null
$profileDeploymentEntry = Join-Path $PSScriptRoot "plugin-deploy.js"
if ((Test-Path -LiteralPath $profileDeploymentEntry) -and -not $env:IMEDICAL_DEPLOYMENT_LOCK) {
  $lockText = & node $profileDeploymentEntry acquire-lock --capability-root $capabilityRootFull --pid $PID
  if ($LASTEXITCODE -ne 0) { throw "Cannot acquire capability deployment lock" }
  $profileDeploymentToken = ($lockText | ConvertFrom-Json).token
  if ($profileDeploymentToken) { $env:IMEDICAL_DEPLOYMENT_LOCK = $profileDeploymentToken }
}
try {
$plugins = Get-InstalledPlugins -AgentsRoot $capabilityRootFull
$targetPlugin = $plugins | Where-Object { Test-PluginNameMatches -Plugin $_ -Name $Plugin } | Select-Object -First 1
if (-not $targetPlugin) {
  throw "Plugin not found: $Plugin"
}

if (($Status -eq "enabled") -and -not (Test-Path -LiteralPath (Join-Path $capabilityRootFull ("plugins/" + $targetPlugin.directoryName + "/.agents-plugin/plugin.json")))) {
  throw "Plugin is not materialized; run plugin-deploy.js ensure before initialization and enablement"
}

$profilePath = Join-Path (Join-Path $contextRootFull "config") "project.jsonc"
$profile = Read-PluginProfile -ProfilePath $profilePath
$retainedRequirements = @()
if (Test-Path -LiteralPath $profileDeploymentEntry -PathType Leaf) {
  $historyText = & node $profileDeploymentEntry profile-history --capability-root $capabilityRootFull --context-root $contextRootFull | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Cannot read retained plugin requirements; profile preserved" }
  $retainedRequirements = @(($historyText | ConvertFrom-Json).retained)
}

if ($Status -in @("disabled", "available")) {
  & node (Join-Path $PSScriptRoot "check-plugin-deactivation.js") $capabilityRootFull $contextRootFull $targetPlugin.name
  if ($LASTEXITCODE -ne 0) { throw "Plugin deactivation blocked by enabled dependencies; profile and discovery entries preserved" }
}

$enforceDiscovery = $false
if ((Test-Path -LiteralPath (Join-Path $contextRootFull "config/project.jsonc")) -or (Test-Path -LiteralPath (Join-Path $contextRootFull "config/plugin-deployment.json"))) {
  $policyAction = "read-policy"
  $policyResult = & node (Join-Path $PSScriptRoot "plugin-deploy.js") $policyAction --context-root $contextRootFull --capability-root $capabilityRootFull | Out-String
  if ($LASTEXITCODE -ne 0) { throw ("Cannot read project deployment policy: " + $policyResult) }
  $enforceDiscovery = (($policyResult | ConvertFrom-Json).mode -eq "on-demand")
}
if ($enforceDiscovery -and $Status -eq "enabled") {
  foreach ($dependency in @(Get-PluginDependencies -Plugin $targetPlugin)) {
    $dependencyPlugin = $plugins | Where-Object { Test-PluginNameMatches -Plugin $_ -Name $dependency } | Select-Object -First 1
    if (-not $dependencyPlugin) { throw ("Missing required dependency: " + $dependency) }
    $dependencyStatus = if ($profile.ContainsKey($dependencyPlugin.name)) { $profile[$dependencyPlugin.name].status } else { Get-DefaultStatus -PluginName $dependencyPlugin.name }
    if ($dependencyStatus -ne "enabled") { throw ("Initialize required dependency before enabling: " + $dependencyPlugin.name) }
  }
}

$thinScript = Join-Path $PSScriptRoot "generate-plugin-thin-index.ps1"
$ownerPath = Join-Path $capabilityRootFull ("plugins/" + $targetPlugin.directoryName)
if ($enforceDiscovery -and $Status -eq "enabled" -and -not (Test-Path -LiteralPath $thinScript -PathType Leaf)) {
  throw "Plugin discovery generator is missing; profile preserved"
}
if (($Status -in @("enabled", "disabled")) -and (Test-Path -LiteralPath $thinScript) -and (Test-Path -LiteralPath $ownerPath)) {
  $thinArgs = @{ PluginPath=$ownerPath; ProjectRoot=$projectRootFull; ContextRoot=$contextRootFull; CapabilityRoot=$capabilityRootFull; Mode="DryRun" }
  if ($Status -eq "disabled") { $thinArgs.Remove = $true }
  $thinPreview = & $thinScript @thinArgs | Out-String
  Assert-DiscoveryOutput -Text $thinPreview
  if ($Status -eq "disabled" -or ($enforceDiscovery -and $Status -eq "enabled")) {
    $thinArgs.Mode = "Write"
    $thinResult = & $thinScript @thinArgs | Out-String
    Assert-DiscoveryOutput -Text $thinResult
    if ($Status -eq "enabled") {
      $thinArgs.Mode = "DryRun"
      $thinVerified = & $thinScript @thinArgs | Out-String
      Assert-DiscoveryOutput -Text $thinVerified -Verified
    }
  }
}

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

Write-PluginProfile -ProfilePath $profilePath -Plugins $plugins -Profile $profile -RetainedRequirements $retainedRequirements

[PSCustomObject]@{
  status = "plugin-profile-updated"
  plugin = $targetPlugin.name
  target = $profilePath
  value = $Status
} | Format-List status, plugin, target, value

} finally {
  if ($profileDeploymentToken) {
    & node $profileDeploymentEntry release-lock --capability-root $capabilityRootFull --token $profileDeploymentToken | Out-Null
    Remove-Item Env:IMEDICAL_DEPLOYMENT_LOCK -ErrorAction SilentlyContinue
  }
}
