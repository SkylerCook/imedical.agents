$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "scripts/initialize-workspace-overlay.ps1"
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

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)
  if ($Actual -ne $Expected) { throw ("{0}. Expected={1}; Actual={2}" -f $Message, $Expected, $Actual) }
}

function Write-Utf8Json {
  param([string]$Path, [object]$Value)
  [System.IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
}

function New-OverlayFixture {
  param([string]$Parent, [string]$Name)

  $root = Join-Path $Parent $Name
  $contextRoot = Join-Path $root ".agents"
  $capabilityRoot = Join-Path $Parent ($Name + "-capability")
  $sourceTarget = Join-Path $Parent ($Name + "-source")
  $gitRoot = Join-Path $Parent ($Name + "-git")
  New-Item -ItemType Directory -Force -Path $contextRoot | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $capabilityRoot ".git"), (Join-Path $capabilityRoot "plugins"), (Join-Path $capabilityRoot "vendor"), (Join-Path $capabilityRoot "scripts") | Out-Null
  New-Item -ItemType Directory -Force -Path $sourceTarget, $gitRoot | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $root "backend") -Target $sourceTarget | Out-Null

  foreach ($adapterName in $adapterNames) {
    $content = if ($adapterName -eq "update-agents.ps1") {
      @'
param(
  [string]$ProjectRoot = ".",
  [ValidateSet("Check", "DryRun", "Write")][string]$Mode = "DryRun",
  [switch]$NoPull
)
[PSCustomObject]@{ projectRoot = $ProjectRoot; mode = $Mode; noPull = [bool]$NoPull }
'@
    }
    else {
      'param([string]$ProjectRoot = ".")' + [Environment]::NewLine + '[PSCustomObject]@{ projectRoot = $ProjectRoot }'
    }
    [System.IO.File]::WriteAllText((Join-Path $capabilityRoot ("scripts/" + $adapterName)), $content, [System.Text.UTF8Encoding]::new($false))
  }
  foreach ($adapterName in $nodeAdapterNames) {
    $content = '"use strict";' + [Environment]::NewLine + 'if (process.argv.includes("help")) console.log("Usage: fixture");'
    [System.IO.File]::WriteAllText((Join-Path $capabilityRoot ("scripts/" + $adapterName)), $content, [System.Text.UTF8Encoding]::new($false))
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    mode = "workspace-overlay"
    workspace = $Name
    contextRoot = ".agents"
    capabilityRoot = ("../" + $Name + "-capability")
    sharedDirectories = @("plugins", "vendor")
    localDirectories = @("config", "rules", "memory", "skills", "scripts", "work")
    sourceRoots = @(
      [ordered]@{
        name = "backend"
        path = "backend"
        target = ("../" + $Name + "-source")
        gitRoot = ("../" + $Name + "-git")
      }
    )
  }
  Write-Utf8Json -Path (Join-Path $contextRoot "capability.json") -Value $manifest
  [PSCustomObject]@{ Root = $root; ContextRoot = $contextRoot; CapabilityRoot = $capabilityRoot }
}

function Get-Status {
  param([object[]]$Results, [string]$Status)
  @($Results | Where-Object status -eq $Status)
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "initialize-workspace-overlay.ps1 should exist"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agents-workspace-overlay-" + [Guid]::NewGuid().ToString("N"))
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $dry = New-OverlayFixture -Parent $testRoot -Name "dry"
  $dryResults = @(& $scriptUnderTest -WorkspaceRoot $dry.Root -Mode DryRun)
  Assert-Equal @(Get-Status -Results $dryResults -Status "junction-planned").Count 2 "DryRun shared Junction plans"
  Assert-Equal @(Get-Status -Results $dryResults -Status "local-directory-planned").Count 6 "DryRun local directory plans"
  Assert-Equal @(Get-Status -Results $dryResults -Status "runtime-adapter-planned").Count ($adapterNames.Count + $nodeAdapterNames.Count) "DryRun adapter plans"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $dry.ContextRoot "plugins"))) "DryRun must not create shared Junction"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $dry.ContextRoot "config"))) "DryRun must not create local directory"

  $write = New-OverlayFixture -Parent $testRoot -Name "write"
  $writeResults = @(& $scriptUnderTest -WorkspaceRoot $write.Root -Mode Write)
  Assert-Equal @(Get-Status -Results $writeResults -Status "junction-created").Count 2 "Write shared Junction creation"
  Assert-Equal @(Get-Status -Results $writeResults -Status "local-directory-created").Count 6 "Write local directory creation"
  Assert-Equal @(Get-Status -Results $writeResults -Status "runtime-adapter-generated").Count ($adapterNames.Count + $nodeAdapterNames.Count) "Write adapter generation"
  foreach ($sharedName in @("plugins", "vendor")) {
    $item = Get-Item -Force -LiteralPath (Join-Path $write.ContextRoot $sharedName)
    Assert-Equal $item.LinkType "Junction" ($sharedName + " should be a Junction")
  }
  foreach ($localName in @("config", "rules", "memory", "skills", "scripts", "work")) {
    $item = Get-Item -Force -LiteralPath (Join-Path $write.ContextRoot $localName)
    Assert-True (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) ($localName + " should be physical")
  }
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $write.ContextRoot ".git"))) "initializer must not create ContextRoot .git"
  foreach ($adapterName in $adapterNames) {
    $adapterPath = Join-Path $write.ContextRoot ("scripts/" + $adapterName)
    Assert-True (Test-Path -LiteralPath $adapterPath -PathType Leaf) ($adapterName + " adapter should exist")
    $adapterContent = [System.IO.File]::ReadAllText($adapterPath, [System.Text.Encoding]::UTF8)
    Assert-True ($adapterContent.Contains('@PSBoundParameters')) ($adapterName + " should forward bound parameters")
    Assert-True (-not $adapterContent.Contains($write.CapabilityRoot)) ($adapterName + " must not hardcode CapabilityRoot")
  }
  foreach ($adapterName in $nodeAdapterNames) {
    $adapterPath = Join-Path $write.ContextRoot ("scripts/" + $adapterName)
    Assert-True (Test-Path -LiteralPath $adapterPath -PathType Leaf) ($adapterName + " adapter should exist")
    $adapterContent = [System.IO.File]::ReadAllText($adapterPath, [System.Text.Encoding]::UTF8)
    Assert-True ($adapterContent.Contains("capability.json")) ($adapterName + " should resolve CapabilityRoot from the manifest")
    Assert-True (-not $adapterContent.Contains($write.CapabilityRoot)) ($adapterName + " must not hardcode CapabilityRoot")
    $adapterHelp = (& node $adapterPath help 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -eq 0) ($adapterName + " should preserve the canonical exit code")
    Assert-True $adapterHelp.Contains("Usage:") ($adapterName + " should forward arguments")
  }
  $adapterOutput = & (Join-Path $write.ContextRoot "scripts/update-agents.ps1") -ProjectRoot "custom-root" -Mode Check -NoPull
  Assert-Equal $adapterOutput.projectRoot "custom-root" "runtime adapter ProjectRoot forwarding"
  Assert-Equal $adapterOutput.mode "Check" "runtime adapter Mode forwarding"
  Assert-True $adapterOutput.noPull "runtime adapter switch forwarding"

  $secondResults = @(& $scriptUnderTest -WorkspaceRoot $write.Root -Mode Write)
  Assert-Equal @(Get-Status -Results $secondResults -Status "junction-ok").Count 3 "idempotent source and shared Junctions"
  Assert-Equal @(Get-Status -Results $secondResults -Status "local-path-ok").Count 6 "idempotent local directories"
  Assert-Equal @(Get-Status -Results $secondResults -Status "runtime-adapter-unchanged").Count ($adapterNames.Count + $nodeAdapterNames.Count) "idempotent runtime adapters"

  $wrong = New-OverlayFixture -Parent $testRoot -Name "wrong"
  $wrongTarget = Join-Path $testRoot "wrong-target"
  New-Item -ItemType Directory -Force -Path $wrongTarget | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $wrong.ContextRoot "plugins") -Target $wrongTarget | Out-Null
  $wrongResults = @(& $scriptUnderTest -WorkspaceRoot $wrong.Root -Mode Write)
  Assert-Equal @(Get-Status -Results $wrongResults -Status "junction-target-mismatch").Count 1 "wrong Junction should block"
  Assert-Equal (Get-Item -Force -LiteralPath (Join-Path $wrong.ContextRoot "plugins")).Target $wrongTarget "wrong Junction must remain without Repair"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $wrong.ContextRoot "vendor"))) "blocked Write must not create other shared paths"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $wrong.ContextRoot "config"))) "blocked Write must not create local paths"

  $repairResults = @(& $scriptUnderTest -WorkspaceRoot $wrong.Root -Mode Write -Repair)
  Assert-Equal @(Get-Status -Results $repairResults -Status "junction-repaired").Count 1 "Repair should replace wrong Junction"
  Assert-Equal (Get-Item -Force -LiteralPath (Join-Path $wrong.ContextRoot "plugins")).LinkType "Junction" "repaired path should remain Junction"

  $physical = New-OverlayFixture -Parent $testRoot -Name "physical"
  New-Item -ItemType Directory -Force -Path (Join-Path $physical.ContextRoot "plugins") | Out-Null
  $physicalResults = @(& $scriptUnderTest -WorkspaceRoot $physical.Root -Mode Write -Repair)
  Assert-Equal @(Get-Status -Results $physicalResults -Status "shared-path-not-junction").Count 1 "physical shared path should block Repair"
  Assert-True (Test-Path -LiteralPath (Join-Path $physical.ContextRoot "plugins") -PathType Container) "Repair must not remove physical shared directory"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $physical.ContextRoot "vendor"))) "physical conflict must block all writes"

  $localLink = New-OverlayFixture -Parent $testRoot -Name "local-link"
  New-Item -ItemType Junction -Path (Join-Path $localLink.ContextRoot "config") -Target $wrongTarget | Out-Null
  $localLinkResults = @(& $scriptUnderTest -WorkspaceRoot $localLink.Root -Mode Write -Repair)
  Assert-Equal @(Get-Status -Results $localLinkResults -Status "local-path-is-link").Count 1 "local Junction should block Repair"
  Assert-Equal (Get-Item -Force -LiteralPath (Join-Path $localLink.ContextRoot "config")).LinkType "Junction" "Repair must not remove local Junction"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $localLink.ContextRoot "plugins"))) "local conflict must block all writes"

  $invalidAdapter = New-OverlayFixture -Parent $testRoot -Name "invalid-adapter"
  [System.IO.File]::WriteAllText((Join-Path $invalidAdapter.CapabilityRoot "scripts/update-agents.ps1"), "param(`n", [System.Text.UTF8Encoding]::new($false))
  $invalidAdapterResults = @(& $scriptUnderTest -WorkspaceRoot $invalidAdapter.Root -Mode Write)
  Assert-Equal @(Get-Status -Results $invalidAdapterResults -Status "runtime-adapter-source-invalid").Count 1 "invalid canonical script should block"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $invalidAdapter.ContextRoot "plugins"))) "invalid adapter source must block shared writes"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $invalidAdapter.ContextRoot "config"))) "invalid adapter source must block local writes"

  $unsafe = New-OverlayFixture -Parent $testRoot -Name "unsafe"
  $unsafeManifestPath = Join-Path $unsafe.Root ".agents/capability.json"
  $unsafeManifest = Get-Content -Raw -Encoding UTF8 $unsafeManifestPath | ConvertFrom-Json
  $unsafeManifest.localDirectories = @("../../escaped-local")
  Write-Utf8Json -Path $unsafeManifestPath -Value $unsafeManifest
  $unsafeResults = @(& $scriptUnderTest -WorkspaceRoot $unsafe.Root -Mode Write -Repair)
  Assert-Equal @(Get-Status -Results $unsafeResults -Status "workspace-overlay-blocked").Count 1 "unsafe manifest paths must block initializer"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot "escaped-local"))) "initializer must not write outside ContextRoot"

  $junctionContext = New-OverlayFixture -Parent $testRoot -Name "junction-context"
  $outsideContext = Join-Path $testRoot "junction-context-outside"
  Move-Item -LiteralPath $junctionContext.ContextRoot -Destination $outsideContext
  New-Item -ItemType Junction -Path $junctionContext.ContextRoot -Target $outsideContext | Out-Null
  $junctionContextResults = @(& $scriptUnderTest -WorkspaceRoot $junctionContext.Root -Mode Write -Repair)
  Assert-Equal @(Get-Status -Results $junctionContextResults -Status "workspace-overlay-blocked").Count 1 "ContextRoot Junction must block initializer"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $outsideContext "config"))) "initializer must not write through a ContextRoot Junction"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $outsideContext "scripts/update-agents.ps1"))) "initializer must not generate adapters through a ContextRoot Junction"
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot).TrimEnd('\', '/')
    Assert-True ($resolvedTestRoot.StartsWith($tempRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) "cleanup root must stay under TEMP"
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}

Write-Host "workspace overlay initializer tests passed"
