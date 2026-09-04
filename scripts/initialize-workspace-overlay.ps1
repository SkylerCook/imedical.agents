param(
  [string]$WorkspaceRoot = ".",
  [ValidateSet("Check", "DryRun", "Write")][string]$Mode = "DryRun",
  [switch]$Repair
)

$ErrorActionPreference = "Stop"

$modulePath = Join-Path $PSScriptRoot "lib/WorkspaceContext.psm1"
Import-Module $modulePath -Force

$adapterNames = @(
  "update-agents.ps1",
  "update-plugin-profile.ps1",
  "generate-plugin-thin-index.ps1",
  "generate-agent-thin-index.ps1",
  "generate-vendor-thin-index.ps1",
  "sync-vendor-skills.ps1",
  "sync-claudecode-skills.ps1",
  "resolve-plugin-skill-dependencies.ps1",
  "check-agent-entrypoints.ps1",
  "check-functional-diff.ps1",
  "install-git-hooks.ps1",
  "repair-agent-entrypoints.ps1"
)
$nodeAdapterNames = @(
  "iris-mcp.js",
  "agent-orchestrator.js"
)

function New-OverlayResult {
  param(
    [string]$Status,
    [string]$Path = "",
    [string]$Expected = "",
    [string]$Actual = "",
    [string]$Reason = ""
  )
  [PSCustomObject][ordered]@{
    status = $Status
    path = $Path
    expected = $Expected
    actual = $Actual
    reason = $Reason
  }
}

function Test-PathEquals {
  param([string]$Left, [string]$Right)
  if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
  $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd([char[]]@('\', '/'))
  $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd([char[]]@('\', '/'))
  return $leftFull.Equals($rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathWithin {
  param([string]$Path, [string]$Root)
  $pathFull = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/'))
  return $pathFull.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or $pathFull.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathChainHasReparsePoint {
  param([string]$Path, [string]$Root)
  $pathFull = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/'))
  if (-not (Test-PathWithin -Path $pathFull -Root $rootFull) -or (Test-PathEquals -Left $pathFull -Right $rootFull)) { return $false }
  $relative = $pathFull.Substring($rootFull.Length).TrimStart([char[]]@('\', '/'))
  $current = $rootFull
  foreach ($segment in @($relative -split '[\\/]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
    $current = Join-Path $current $segment
    if (-not (Test-Path -LiteralPath $current)) { break }
    $item = Get-Item -Force -LiteralPath $current
    if ([bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { return $true }
  }
  return $false
}

function Get-PathValidation {
  param([object[]]$Validation, [string]$Path)
  @($Validation | Where-Object { Test-PathEquals -Left ([string]$_.path) -Right $Path }) | Select-Object -First 1
}

function Get-AdapterContent {
  param([string]$CanonicalScript, [string]$AdapterName)

  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($CanonicalScript, [ref]$tokens, [ref]$parseErrors)
  if (@($parseErrors).Count -gt 0) {
    throw ("Cannot parse canonical script parameter block: " + $CanonicalScript + "; " + (($parseErrors | ForEach-Object Message) -join "; "))
  }
  $paramBlock = if ($null -ne $ast.ParamBlock) { $ast.ParamBlock.Extent.Text } else { "param()" }
  $escapedName = $AdapterName.Replace('"', '`"')
  $body = @'


$ErrorActionPreference = "Stop"
$contextRootFull = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd([char[]]@('\', '/'))
$manifestPath = Join-Path $contextRootFull "capability.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw ("Workspace capability manifest is missing: " + $manifestPath)
}
$manifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$workspaceRootFull = $null
$candidate = $contextRootFull
while (-not [string]::IsNullOrWhiteSpace($candidate)) {
  $contextRootValue = [string]$manifest.contextRoot
  $resolvedContext = if ([System.IO.Path]::IsPathRooted($contextRootValue)) {
    [System.IO.Path]::GetFullPath($contextRootValue).TrimEnd([char[]]@('\', '/'))
  }
  else {
    [System.IO.Path]::GetFullPath((Join-Path $candidate $contextRootValue)).TrimEnd([char[]]@('\', '/'))
  }
  if ($resolvedContext.Equals($contextRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    $workspaceRootFull = $candidate
    break
  }
  $parent = Split-Path -Parent $candidate
  if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $candidate) { break }
  $candidate = $parent
}
if ([string]::IsNullOrWhiteSpace($workspaceRootFull)) {
  throw ("Cannot resolve WorkspaceRoot from ContextRoot: " + $contextRootFull)
}
$capabilityRootValue = [string]$manifest.capabilityRoot
$capabilityRootFull = if ([System.IO.Path]::IsPathRooted($capabilityRootValue)) {
  [System.IO.Path]::GetFullPath($capabilityRootValue)
}
else {
  [System.IO.Path]::GetFullPath((Join-Path $workspaceRootFull $capabilityRootValue))
}
$canonicalScript = Join-Path $capabilityRootFull "scripts/__ADAPTER_NAME__"
if (-not (Test-Path -LiteralPath $canonicalScript -PathType Leaf)) {
  throw ("Canonical capability script is missing: " + $canonicalScript)
}
& $canonicalScript @PSBoundParameters
'@
  return $paramBlock + ($body.Replace("__ADAPTER_NAME__", $escapedName))
}

function Get-NodeAdapterContent {
  param([string]$AdapterName)

  $escapedName = $AdapterName.Replace('\\', '\\\\').Replace("'", "\\'")
  $body = @'
#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolveWorkspaceRoot(contextRoot, manifest) {
  let candidate = contextRoot;
  while (true) {
    const contextRootValue = String(manifest.contextRoot || '.agents');
    const resolvedContext = path.isAbsolute(contextRootValue)
      ? path.resolve(contextRootValue)
      : path.resolve(candidate, contextRootValue);
    if (samePath(resolvedContext, contextRoot)) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Cannot resolve WorkspaceRoot from ContextRoot: ${contextRoot}`);
}

function main() {
  const contextRoot = path.resolve(__dirname, '..');
  const manifestPath = path.join(contextRoot, 'capability.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Workspace capability manifest is missing: ${manifestPath}`);
  }
  const manifestText = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
  const manifest = JSON.parse(manifestText);
  const workspaceRoot = resolveWorkspaceRoot(contextRoot, manifest);
  const capabilityRootValue = String(manifest.capabilityRoot || '.agents');
  const capabilityRoot = path.isAbsolute(capabilityRootValue)
    ? path.resolve(capabilityRootValue)
    : path.resolve(workspaceRoot, capabilityRootValue);
  const canonicalScript = path.join(capabilityRoot, 'scripts', '__ADAPTER_NAME__');
  if (!fs.existsSync(canonicalScript) || !fs.statSync(canonicalScript).isFile()) {
    throw new Error(`Canonical capability script is missing: ${canonicalScript}`);
  }
  const result = spawnSync(process.execPath, [canonicalScript, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  process.exitCode = typeof result.status === 'number' ? result.status : 1;
}

try {
  main();
} catch (error) {
  console.error('ERROR=' + error.message);
  process.exitCode = 1;
}
'@
  return $body.Replace("__ADAPTER_NAME__", $escapedName)
}

$context = Resolve-AgentWorkspaceContext -ProjectRoot $WorkspaceRoot
$validation = @(Test-AgentWorkspaceContext -Context $context)
$results = New-Object System.Collections.Generic.List[object]
foreach ($entry in $validation) { $results.Add($entry) }

$sharedPaths = @($context.sharedDirectories | ForEach-Object { [string]$_.path })
$blockingStatuses = @(
  "manifest-invalid",
  "schema-version-unsupported",
  "capability-root-missing",
  "capability-git-missing",
  "source-root-missing",
  "git-root-missing",
  "source-path-missing",
  "source-path-not-junction",
  "shared-path-not-junction",
  "local-path-is-link",
  "local-path-not-directory"
)
$blockers = New-Object System.Collections.Generic.List[object]
foreach ($entry in $validation) {
  if ($blockingStatuses -contains [string]$entry.status) {
    $blockers.Add($entry)
    continue
  }
  if ($entry.status -eq "junction-target-mismatch") {
    $isShared = (@($sharedPaths | Where-Object { Test-PathEquals -Left $_ -Right ([string]$entry.path) })).Count -gt 0
    $canRepair = $isShared -and $Repair -and $Mode -eq "Write"
    if (-not $canRepair) { $blockers.Add($entry) }
  }
}

if ((Test-PathChainHasReparsePoint -Path $context.contextRoot -Root $context.workspaceRoot) -and (@($blockers | Where-Object status -eq "manifest-invalid")).Count -eq 0) {
  $unsafeContextRoot = New-OverlayResult -Status "manifest-invalid" -Path $context.manifestPath -Actual $context.contextRoot -Reason "ContextRoot path crosses a reparse point"
  $results.Add($unsafeContextRoot)
  $blockers.Add($unsafeContextRoot)
}

$adapterContentByName = @{}
foreach ($adapterName in $adapterNames) {
  $canonicalScript = Join-Path $context.capabilityRoot ("scripts/" + $adapterName)
  if (-not (Test-Path -LiteralPath $canonicalScript -PathType Leaf)) {
    $missing = New-OverlayResult -Status "runtime-adapter-source-missing" -Path $canonicalScript -Expected $adapterName -Reason "canonical capability script is missing"
    $results.Add($missing)
    $blockers.Add($missing)
    continue
  }
  try {
    $adapterContentByName[$adapterName] = Get-AdapterContent -CanonicalScript $canonicalScript -AdapterName $adapterName
  }
  catch {
    $invalid = New-OverlayResult -Status "runtime-adapter-source-invalid" -Path $canonicalScript -Expected $adapterName -Actual $_.Exception.Message -Reason "canonical capability script cannot generate a runtime adapter"
    $results.Add($invalid)
    $blockers.Add($invalid)
  }
}
foreach ($adapterName in $nodeAdapterNames) {
  $canonicalScript = Join-Path $context.capabilityRoot ("scripts/" + $adapterName)
  if (-not (Test-Path -LiteralPath $canonicalScript -PathType Leaf)) {
    $missing = New-OverlayResult -Status "runtime-adapter-source-missing" -Path $canonicalScript -Expected $adapterName -Reason "canonical capability script is missing"
    $results.Add($missing)
    $blockers.Add($missing)
    continue
  }
  $adapterContentByName[$adapterName] = Get-NodeAdapterContent -AdapterName $adapterName
}

if ($blockers.Count -gt 0) {
  $results.Add((New-OverlayResult -Status "workspace-overlay-blocked" -Path $context.workspaceRoot -Actual (($blockers | ForEach-Object status | Sort-Object -Unique) -join ",") -Reason "unsafe overlay state prevents changes"))
  $results.ToArray()
  return
}

foreach ($shared in @($context.sharedDirectories)) {
  $pathValidation = Get-PathValidation -Validation $validation -Path $shared.path
  if ($null -eq $pathValidation -or $pathValidation.status -eq "shared-path-missing") {
    if ($Mode -eq "Write") {
      New-Item -ItemType Junction -Path $shared.path -Target $shared.target | Out-Null
      $results.Add((New-OverlayResult -Status "junction-created" -Path $shared.path -Expected $shared.target -Actual $shared.target -Reason "created shared Junction"))
    }
    elseif ($Mode -eq "DryRun") {
      $results.Add((New-OverlayResult -Status "junction-planned" -Path $shared.path -Expected $shared.target -Reason "shared Junction is missing"))
    }
    continue
  }

  if ($pathValidation.status -eq "junction-target-mismatch" -and $Repair) {
    if (-not (Test-PathWithin -Path $shared.path -Root $context.contextRoot)) {
      throw ("Repair refused path outside ContextRoot: " + $shared.path)
    }
    if ($Mode -eq "Write") {
      $item = Get-Item -Force -LiteralPath $shared.path
      $isJunction = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -and ([string]$item.LinkType -eq "Junction")
      if (-not $isJunction) { throw ("Repair refused non-Junction path: " + $shared.path) }
      Remove-Item -LiteralPath $shared.path -Force
      New-Item -ItemType Junction -Path $shared.path -Target $shared.target | Out-Null
      $results.Add((New-OverlayResult -Status "junction-repaired" -Path $shared.path -Expected $shared.target -Reason "replaced mismatched Junction object"))
    }
    elseif ($Mode -eq "DryRun") {
      $results.Add((New-OverlayResult -Status "junction-repair-planned" -Path $shared.path -Expected $shared.target -Actual $pathValidation.actual -Reason "mismatched Junction can be repaired in Write mode"))
    }
  }
}

foreach ($local in @($context.localDirectories)) {
  $pathValidation = Get-PathValidation -Validation $validation -Path $local.path
  if ($null -eq $pathValidation -or $pathValidation.status -eq "local-path-missing") {
    if ($Mode -eq "Write") {
      New-Item -ItemType Directory -Force -Path $local.path | Out-Null
      $results.Add((New-OverlayResult -Status "local-directory-created" -Path $local.path -Reason "created physical local directory"))
    }
    elseif ($Mode -eq "DryRun") {
      $results.Add((New-OverlayResult -Status "local-directory-planned" -Path $local.path -Reason "local directory is missing"))
    }
  }
}

$scriptsRoot = Join-Path $context.contextRoot "scripts"
foreach ($adapterName in $adapterNames) {
  $canonicalScript = Join-Path $context.capabilityRoot ("scripts/" + $adapterName)
  $adapterPath = Join-Path $scriptsRoot $adapterName
  $content = [string]$adapterContentByName[$adapterName]
  $existing = if (Test-Path -LiteralPath $adapterPath -PathType Leaf) { [System.IO.File]::ReadAllText($adapterPath, [System.Text.Encoding]::UTF8) } else { $null }
  if ($existing -eq $content) {
    $results.Add((New-OverlayResult -Status "runtime-adapter-unchanged" -Path $adapterPath -Expected $canonicalScript -Reason "runtime adapter already matches canonical parameters"))
  }
  elseif ($Mode -eq "Write") {
    if (-not (Test-Path -LiteralPath $scriptsRoot -PathType Container)) {
      New-Item -ItemType Directory -Force -Path $scriptsRoot | Out-Null
    }
    [System.IO.File]::WriteAllText($adapterPath, $content, [System.Text.UTF8Encoding]::new($true))
    $results.Add((New-OverlayResult -Status "runtime-adapter-generated" -Path $adapterPath -Expected $canonicalScript -Reason "generated manifest-aware runtime adapter"))
  }
  elseif ($Mode -eq "DryRun") {
    $results.Add((New-OverlayResult -Status "runtime-adapter-planned" -Path $adapterPath -Expected $canonicalScript -Reason "runtime adapter is missing or stale"))
  }
  else {
    $results.Add((New-OverlayResult -Status "runtime-adapter-missing" -Path $adapterPath -Expected $canonicalScript -Reason "runtime adapter is missing or stale"))
  }
}
foreach ($adapterName in $nodeAdapterNames) {
  $canonicalScript = Join-Path $context.capabilityRoot ("scripts/" + $adapterName)
  $adapterPath = Join-Path $scriptsRoot $adapterName
  $content = [string]$adapterContentByName[$adapterName]
  $existing = if (Test-Path -LiteralPath $adapterPath -PathType Leaf) { [System.IO.File]::ReadAllText($adapterPath, [System.Text.Encoding]::UTF8) } else { $null }
  if ($existing -eq $content) {
    $results.Add((New-OverlayResult -Status "runtime-adapter-unchanged" -Path $adapterPath -Expected $canonicalScript -Reason "runtime adapter already matches canonical parameters"))
  }
  elseif ($Mode -eq "Write") {
    if (-not (Test-Path -LiteralPath $scriptsRoot -PathType Container)) {
      New-Item -ItemType Directory -Force -Path $scriptsRoot | Out-Null
    }
    [System.IO.File]::WriteAllText($adapterPath, $content, [System.Text.UTF8Encoding]::new($false))
    $results.Add((New-OverlayResult -Status "runtime-adapter-generated" -Path $adapterPath -Expected $canonicalScript -Reason "generated manifest-aware runtime adapter"))
  }
  elseif ($Mode -eq "DryRun") {
    $results.Add((New-OverlayResult -Status "runtime-adapter-planned" -Path $adapterPath -Expected $canonicalScript -Reason "runtime adapter is missing or stale"))
  }
  else {
    $results.Add((New-OverlayResult -Status "runtime-adapter-missing" -Path $adapterPath -Expected $canonicalScript -Reason "runtime adapter is missing or stale"))
  }
}

$results.ToArray()
