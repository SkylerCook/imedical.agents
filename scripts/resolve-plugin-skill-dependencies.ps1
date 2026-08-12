param(
  [string]$AgentsRoot = ".agents",
  [string]$ProjectRoot = ".",
  [string]$ContextRoot = "",
  [string]$CapabilityRoot = "",
  [string[]]$Plugin = @(),
  [ValidateSet("Json", "List")]
  [string]$OutputFormat = "List"
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([string]$BasePath, [string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
  return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Read-PluginProfile {
  param([string]$Path)
  $profile = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $profile }
  foreach ($line in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
    if ($line -match '^\|\s*`?(?<name>[^|`]+)`?\s*\|\s*(?<status>available|enabled|disabled|initialized|indexed)\s*\|') {
      $status = $matches.status.ToLowerInvariant()
      if ($status -eq "initialized") { $status = "enabled" }
      if ($status -eq "indexed") { $status = "available" }
      $profile[$matches.name.Trim()] = $status
    }
  }
  return $profile
}

function Get-VendorSource {
  param([string]$VendorRoot, [string]$Provider, [string]$Name)
  $nested = Join-Path $VendorRoot "$Provider/skills/$Name/SKILL.md"
  if (Test-Path -LiteralPath $nested -PathType Leaf) { return $nested }
  $root = Join-Path $VendorRoot "$Provider/SKILL.md"
  if (Test-Path -LiteralPath $root -PathType Leaf) { return $root }
  return $nested
}

$projectRootFull = Resolve-FullPath -BasePath (Get-Location) -Path $ProjectRoot
if ([string]::IsNullOrWhiteSpace($ContextRoot) -or [string]::IsNullOrWhiteSpace($CapabilityRoot)) {
  Import-Module (Join-Path $PSScriptRoot "lib/WorkspaceContext.psm1") -Force
  $workspaceContext = Resolve-AgentWorkspaceContext -ProjectRoot $projectRootFull
  if ([string]::IsNullOrWhiteSpace($ContextRoot)) { $ContextRoot = $workspaceContext.contextRoot }
  if ([string]::IsNullOrWhiteSpace($CapabilityRoot)) { $CapabilityRoot = $workspaceContext.capabilityRoot }
}
$contextRootFull = Resolve-FullPath -BasePath $projectRootFull -Path $ContextRoot
$capabilityRootFull = Resolve-FullPath -BasePath $projectRootFull -Path $CapabilityRoot
$pluginsRoot = Join-Path $capabilityRootFull "plugins"
$vendorRoot = Join-Path $capabilityRootFull "vendor"
$profilePath = Join-Path $contextRootFull "config/plugin_profile.md"
$profile = Read-PluginProfile -Path $profilePath
$installed = @{}

if (Test-Path -LiteralPath $pluginsRoot -PathType Container) {
  Get-ChildItem -LiteralPath $pluginsRoot -Directory | ForEach-Object {
    $manifestPath = Join-Path $_.FullName ".agents-plugin/plugin.json"
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
      $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $name = if ([string]::IsNullOrWhiteSpace([string]$manifest.name)) { $_.Name } else { [string]$manifest.name }
      $installed[$name] = [PSCustomObject]@{ name=$name; directoryName=$_.Name; path=$_.FullName; manifest=$manifest }
    }
  }
}

$selected = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
foreach ($name in $Plugin) {
  if (-not [string]::IsNullOrWhiteSpace($name)) { [void]$selected.Add($name) }
}
if ($selected.Count -eq 0) {
  foreach ($name in $installed.Keys) {
    $item = $installed[$name]
    if (($profile[$name] -eq "enabled") -or ($profile[$item.directoryName] -eq "enabled") -or (($profile.Count -eq 0) -and ($name -eq "agent-context-kit"))) {
      [void]$selected.Add($name)
    }
  }
}

$visited = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
$queue = New-Object System.Collections.Generic.Queue[string]
foreach ($name in $selected) { $queue.Enqueue($name) }
while ($queue.Count -gt 0) {
  $name = $queue.Dequeue()
  $item = $installed[$name]
  if ($null -eq $item) {
    $item = $installed.Values | Where-Object { $_.directoryName -eq $name } | Select-Object -First 1
  }
  if (($null -eq $item) -or (-not $visited.Add($item.name))) { continue }
  foreach ($dependency in @($item.manifest.dependencies)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$dependency)) { $queue.Enqueue([string]$dependency) }
  }
}

$resolved = @{}
foreach ($pluginName in $visited) {
  $item = $installed[$pluginName]
  if ($null -eq $item) { continue }
  foreach ($type in @("required", "optional")) {
    $entries = @($item.manifest.skillDependencies.$type)
    foreach ($entry in $entries) {
      if ($null -eq $entry) { continue }
      $capability = [string]$entry.capability
      $provider = [string]$entry.provider
      $name = [string]$entry.name
      if ([string]::IsNullOrWhiteSpace($capability) -or [string]::IsNullOrWhiteSpace($provider) -or [string]::IsNullOrWhiteSpace($name)) { continue }
      $sourcePath = Get-VendorSource -VendorRoot $vendorRoot -Provider $provider -Name $name
      $candidate = [PSCustomObject]@{
        capability = $capability
        type = $type
        provider = $provider
        name = $name
        trigger = [string]$entry.trigger
        plugin = $pluginName
        source = ($sourcePath -replace '\\','/')
        sourceExists = (Test-Path -LiteralPath $sourcePath -PathType Leaf)
      }
      if ((-not $resolved.ContainsKey($capability)) -or (($resolved[$capability].type -eq "optional") -and ($type -eq "required"))) {
        $resolved[$capability] = $candidate
      }
    }
  }
}

$output = @($resolved.Values | Sort-Object type, capability)
if ($OutputFormat -eq "Json") {
  @($output) | ConvertTo-Json -Depth 5
}
else {
  $output | Format-List capability, type, provider, name, trigger, plugin, source, sourceExists
}
