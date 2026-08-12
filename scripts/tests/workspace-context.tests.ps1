$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$moduleUnderTest = Join-Path $repoRoot "scripts/lib/WorkspaceContext.psm1"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)
  if ($Actual -ne $Expected) {
    throw ("{0}. Expected={1}; Actual={2}" -f $Message, $Expected, $Actual)
  }
}

function Write-Utf8Json {
  param([string]$Path, [object]$Value)
  $json = $Value | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function New-OverlayFixture {
  param(
    [string]$Parent,
    [string]$Name,
    [switch]$BackendOnly,
    [switch]$SkipCapabilityGit,
    [switch]$SkipLinks
  )

  $root = Join-Path $Parent $Name
  $capabilityRoot = Join-Path $Parent ($Name + "-capability")
  $backendTarget = Join-Path $Parent ($Name + "-backend-target")
  $backendGitRoot = Join-Path $Parent ($Name + "-backend-git")
  $frontendTarget = Join-Path $Parent ($Name + "-frontend-target")
  $frontendGitRoot = Join-Path $Parent ($Name + "-frontend-git")

  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $capabilityRoot "plugins") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $capabilityRoot "vendor") | Out-Null
  if (-not $SkipCapabilityGit) {
    New-Item -ItemType Directory -Force -Path (Join-Path $capabilityRoot ".git") | Out-Null
  }
  New-Item -ItemType Directory -Force -Path $backendTarget, $backendGitRoot | Out-Null
  if (-not $BackendOnly) {
    New-Item -ItemType Directory -Force -Path $frontendTarget, $frontendGitRoot | Out-Null
  }

  $sourceRoots = @(
    [ordered]@{
      name = "backend"
      path = "backend"
      target = ("../" + $Name + "-backend-target")
      gitRoot = ("../" + $Name + "-backend-git")
    }
  )
  if (-not $BackendOnly) {
    $sourceRoots += [ordered]@{
      name = "frontend"
      path = "frontend"
      target = ("../" + $Name + "-frontend-target")
      gitRoot = ("../" + $Name + "-frontend-git")
    }
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    mode = "workspace-overlay"
    workspace = $Name
    contextRoot = ".agents"
    capabilityRoot = ("../" + $Name + "-capability")
    sharedDirectories = @("plugins", "vendor")
    localDirectories = @("config", "rules")
    sourceRoots = $sourceRoots
  }
  Write-Utf8Json -Path (Join-Path $root ".agents/capability.json") -Value $manifest

  if (-not $SkipLinks) {
    New-Item -ItemType Junction -Path (Join-Path $root "backend") -Target $backendTarget | Out-Null
    if (-not $BackendOnly) {
      New-Item -ItemType Junction -Path (Join-Path $root "frontend") -Target $frontendTarget | Out-Null
    }
    New-Item -ItemType Junction -Path (Join-Path $root ".agents/plugins") -Target (Join-Path $capabilityRoot "plugins") | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $root ".agents/vendor") -Target (Join-Path $capabilityRoot "vendor") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/config"), (Join-Path $root ".agents/rules") | Out-Null
  }

  [PSCustomObject]@{
    Root = $root
    CapabilityRoot = $capabilityRoot
    BackendTarget = $backendTarget
    BackendGitRoot = $backendGitRoot
    FrontendTarget = $frontendTarget
    FrontendGitRoot = $frontendGitRoot
  }
}

function Get-Status {
  param([object[]]$Results, [string]$Status)
  @($Results | Where-Object status -eq $Status)
}

Assert-True (Test-Path -LiteralPath $moduleUnderTest -PathType Leaf) "WorkspaceContext.psm1 should exist"
Import-Module $moduleUnderTest -Force

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agents-workspace-context-" + [Guid]::NewGuid().ToString("N"))
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $standard = Join-Path $testRoot "standard"
  New-Item -ItemType Directory -Force -Path $standard | Out-Null
  $standardContext = Resolve-AgentWorkspaceContext -ProjectRoot $standard
  Assert-Equal $standardContext.mode "standard" "missing manifest should select standard mode"
  Assert-Equal $standardContext.workspaceRoot ([System.IO.Path]::GetFullPath($standard)) "standard workspace root"
  Assert-Equal $standardContext.contextRoot (Join-Path ([System.IO.Path]::GetFullPath($standard)) ".agents") "standard context root"
  Assert-Equal $standardContext.capabilityRoot $standardContext.contextRoot "standard capability and context roots"
  Assert-Equal @($standardContext.sourceRoots).Count 1 "standard source root count"

  $valid = New-OverlayFixture -Parent $testRoot -Name "valid"
  $validContext = Resolve-AgentWorkspaceContext -ProjectRoot $valid.Root
  $expectedFields = @("mode", "workspaceName", "workspaceRoot", "contextRoot", "capabilityRoot", "manifestPath", "sharedDirectories", "localDirectories", "sourceRoots", "gitRoots")
  foreach ($field in $expectedFields) {
    Assert-True ($validContext.PSObject.Properties.Name -contains $field) ("context should expose " + $field)
  }
  Assert-Equal $validContext.mode "workspace-overlay" "valid manifest mode"
  Assert-Equal $validContext.workspaceName "valid" "workspace name"
  Assert-Equal $validContext.capabilityRoot ([System.IO.Path]::GetFullPath($valid.CapabilityRoot)) "capability root resolution"
  Assert-Equal @($validContext.sourceRoots).Count 2 "overlay source root count"
  Assert-Equal @($validContext.gitRoots).Count 2 "overlay git root count"
  $validResults = @(Test-AgentWorkspaceContext -Context $validContext)
  Assert-Equal @(Get-Status -Results $validResults -Status "workspace-context-resolved").Count 1 "valid resolution status"
  Assert-Equal @(Get-Status -Results $validResults -Status "junction-ok").Count 4 "source and shared junction validation"

  $mapped = Resolve-AgentGitRoot -Context $validContext -Path (Join-Path $valid.BackendTarget "src/file.cls")
  Assert-Equal $mapped.name "backend" "backend mapping name"
  Assert-Equal $mapped.gitRoot ([System.IO.Path]::GetFullPath($valid.BackendGitRoot)) "backend mapping Git root"
  $outsideFailed = $false
  try { Resolve-AgentGitRoot -Context $validContext -Path (Join-Path $testRoot "outside/file.cls") | Out-Null }
  catch { $outsideFailed = $_.Exception.Message.Contains("not inside a declared source root") }
  Assert-True $outsideFailed "outside paths must not fall back to cwd Git root"

  $missingCapability = New-OverlayFixture -Parent $testRoot -Name "missing-capability" -SkipLinks
  Remove-Item -LiteralPath $missingCapability.CapabilityRoot -Recurse -Force
  $missingCapabilityResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $missingCapability.Root))
  Assert-Equal @(Get-Status -Results $missingCapabilityResults -Status "capability-root-missing").Count 1 "missing capability status"

  $missingGit = New-OverlayFixture -Parent $testRoot -Name "missing-git" -SkipCapabilityGit -SkipLinks
  $missingGitResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $missingGit.Root))
  Assert-Equal @(Get-Status -Results $missingGitResults -Status "capability-git-missing").Count 1 "missing capability Git status"

  $wrongJunction = New-OverlayFixture -Parent $testRoot -Name "wrong-junction" -SkipLinks
  $wrongTarget = Join-Path $testRoot "wrong-target"
  New-Item -ItemType Directory -Force -Path $wrongTarget | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $wrongJunction.Root ".agents/plugins") -Target $wrongTarget | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $wrongJunction.Root ".agents/vendor") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $wrongJunction.Root ".agents/config") | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $wrongJunction.Root ".agents/rules") -Target $wrongTarget | Out-Null
  $wrongResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $wrongJunction.Root))
  Assert-Equal @(Get-Status -Results $wrongResults -Status "junction-target-mismatch").Count 1 "wrong Junction target status"
  Assert-Equal @(Get-Status -Results $wrongResults -Status "shared-path-not-junction").Count 1 "physical shared directory status"
  Assert-Equal @(Get-Status -Results $wrongResults -Status "local-path-is-link").Count 1 "local Junction status"

  $backendOnly = New-OverlayFixture -Parent $testRoot -Name "backend-only" -BackendOnly
  $backendOnlyContext = Resolve-AgentWorkspaceContext -ProjectRoot $backendOnly.Root
  Assert-Equal @($backendOnlyContext.sourceRoots).Count 1 "backend-only source root count"
  Assert-Equal $backendOnlyContext.sourceRoots[0].name "backend" "backend-only name"

  $invalidRoot = Join-Path $testRoot "invalid-json"
  New-Item -ItemType Directory -Force -Path (Join-Path $invalidRoot ".agents") | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $invalidRoot ".agents/capability.json"), "{invalid", [System.Text.UTF8Encoding]::new($false))
  $invalidResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $invalidRoot))
  Assert-Equal @(Get-Status -Results $invalidResults -Status "manifest-invalid").Count 1 "invalid JSON status"

  $unsupported = New-OverlayFixture -Parent $testRoot -Name "unsupported" -SkipLinks
  $unsupportedManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $unsupported.Root ".agents/capability.json") | ConvertFrom-Json
  $unsupportedManifest.schemaVersion = 2
  Write-Utf8Json -Path (Join-Path $unsupported.Root ".agents/capability.json") -Value $unsupportedManifest
  $unsupportedResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $unsupported.Root))
  Assert-Equal @(Get-Status -Results $unsupportedResults -Status "schema-version-unsupported").Count 1 "unknown schema version status"

  $duplicate = New-OverlayFixture -Parent $testRoot -Name "duplicate" -SkipLinks
  $duplicateManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $duplicate.Root ".agents/capability.json") | ConvertFrom-Json
  $duplicateManifest.sourceRoots[1].name = "backend"
  Write-Utf8Json -Path (Join-Path $duplicate.Root ".agents/capability.json") -Value $duplicateManifest
  $duplicateResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $duplicate.Root))
  Assert-Equal @(Get-Status -Results $duplicateResults -Status "manifest-invalid").Count 1 "duplicate source root name status"

  $wrongMode = New-OverlayFixture -Parent $testRoot -Name "wrong-mode" -SkipLinks
  $wrongModeManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $wrongMode.Root ".agents/capability.json") | ConvertFrom-Json
  $wrongModeManifest.mode = "standard"
  Write-Utf8Json -Path (Join-Path $wrongMode.Root ".agents/capability.json") -Value $wrongModeManifest
  $wrongModeResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $wrongMode.Root))
  Assert-Equal @(Get-Status -Results $wrongModeResults -Status "manifest-invalid").Count 1 "manifest file cannot bypass overlay validation with another mode"

  $unsafe = New-OverlayFixture -Parent $testRoot -Name "unsafe-paths" -SkipLinks
  $unsafeManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $unsafe.Root ".agents/capability.json") | ConvertFrom-Json
  $unsafeManifest.contextRoot = "../../escaped-context"
  $unsafeManifest.sharedDirectories = @("../escaped-shared")
  $unsafeManifest.localDirectories = @("../../escaped-local")
  $unsafeManifest.sourceRoots[0].path = "../escaped-source"
  Write-Utf8Json -Path (Join-Path $unsafe.Root ".agents/capability.json") -Value $unsafeManifest
  $unsafeResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $unsafe.Root))
  Assert-Equal @(Get-Status -Results $unsafeResults -Status "manifest-invalid").Count 1 "manifest paths must stay inside their declared roots"

  $junctionContext = New-OverlayFixture -Parent $testRoot -Name "junction-context" -SkipLinks
  $outsideContext = Join-Path $testRoot "junction-context-outside"
  Move-Item -LiteralPath (Join-Path $junctionContext.Root ".agents") -Destination $outsideContext
  New-Item -ItemType Junction -Path (Join-Path $junctionContext.Root ".agents") -Target $outsideContext | Out-Null
  $junctionContextResults = @(Test-AgentWorkspaceContext -Context (Resolve-AgentWorkspaceContext -ProjectRoot $junctionContext.Root))
  Assert-Equal @(Get-Status -Results $junctionContextResults -Status "manifest-invalid").Count 1 "ContextRoot must not escape through a Junction"
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot).TrimEnd('\', '/')
    Assert-True ($resolvedTestRoot.StartsWith($tempRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) "cleanup root must stay under TEMP"
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}

Write-Host "workspace context PowerShell tests passed"
