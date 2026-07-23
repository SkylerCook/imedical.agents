$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$pluginRoot = Join-Path $repoRoot "plugins/coding-iris-plugin"
$vendorRoot = Join-Path $repoRoot "vendor/iris-agentic-dev-skills"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Contains {
  param(
    [string]$Content,
    [string]$Expected,
    [string]$Message
  )
  if (-not $Content.Contains($Expected)) {
    throw $Message
  }
}

function Assert-NotContains {
  param(
    [string]$Content,
    [string]$Unexpected,
    [string]$Message
  )
  if ($Content.Contains($Unexpected)) {
    throw $Message
  }
}

$manifestPath = Join-Path $pluginRoot ".agents-plugin/plugin.json"
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
Assert-True ($manifest.name -eq "coding-iris-plugin") "Unexpected plugin name"
Assert-True ($manifest.version -eq "0.3.0") "Plugin version should be 0.3.0"

$lookupSkillPath = Join-Path $pluginRoot "skills/iris-mcp-lookup/SKILL.md"
$lookupRulePath = Join-Path $pluginRoot "rules/iris_knowledge_lookup.md"
$docsReferencePath = Join-Path $pluginRoot "references/iris-official-docs-routing.md"
foreach ($path in @($lookupSkillPath, $lookupRulePath, $docsReferencePath)) {
  Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "Required lookup file is missing: $path"
}

$lookupSkill = Get-Content -Raw -Encoding UTF8 -LiteralPath $lookupSkillPath
$lookupRule = Get-Content -Raw -Encoding UTF8 -LiteralPath $lookupRulePath
$docsReference = Get-Content -Raw -Encoding UTF8 -LiteralPath $docsReferencePath
Assert-Contains $lookupSkill "name: iris-mcp-lookup" "Lookup skill name is missing"
Assert-Contains $lookupSkill "docs_introspect" "Lookup skill should use live introspection"
Assert-Contains $lookupSkill "iris_doc mode=get/head" "Lookup skill should distinguish instance documents"
Assert-Contains $lookupSkill "Fetch/WebFetch/Open" "Lookup skill should support runtime-neutral URL fetch"
Assert-Contains $lookupSkill "GGBL_structure" "Lookup skill should include the verified DocBook example"
Assert-NotContains $lookupSkill "100% accurate" "Lookup skill must not claim absolute accuracy"
Assert-Contains $lookupRule "iris-agentic-dev" "Lookup rule should pin the IRIS MCP provider"
Assert-Contains $lookupRule "iris_debug action=capture" "Lookup rule should map legacy debug tools"
Assert-Contains $lookupRule "objectscript_iris_generate_test" "Lookup rule should map upstream unit-test tools"
Assert-Contains $docsReference "iris_doc_search" "Documentation reference should support MCP doc search"
Assert-Contains $docsReference "docs.intersystems.com" "Documentation reference should restrict the official source"

$expectedVendorSkills = @(
  "objectscript-review",
  "objectscript-guardrails",
  "objectscript-sql-patterns",
  "objectscript-list-patterns",
  "objectscript-navigation",
  "objectscript-unit-test",
  "objectscript-debugging"
)

$expectedVendorBlobs = @{
  "objectscript-review" = "0d3151f2d17b25f00510778b0951819c17c33d93"
  "objectscript-guardrails" = "1668eb5e19f748e1f91a412b65ab40b85ca31f55"
  "objectscript-sql-patterns" = "015a8d5e63cea23716cafc16413cf08549cf6ca0"
  "objectscript-list-patterns" = "a12c5bcd4c5e95e08ffceec40a1b22dcdca1201d"
  "objectscript-navigation" = "e9eb39e7b2455effa64af92c0f74ef0040ff121c"
  "objectscript-unit-test" = "155f9ab2422f610a5aafb9e790b1c823c21b2d9b"
  "objectscript-debugging" = "4f43ed44b8369e84b3db551e2bf74b09bd28ecf0"
}

$optionalDependencies = @($manifest.skillDependencies.optional)
Assert-True ($optionalDependencies.Count -eq $expectedVendorSkills.Count) "Unexpected optional vendor skill count"
foreach ($skillName in $expectedVendorSkills) {
  $skillPath = Join-Path $vendorRoot "skills/$skillName/SKILL.md"
  Assert-True (Test-Path -LiteralPath $skillPath -PathType Leaf) "Vendor skill is missing: $skillName"
  $skillContent = Get-Content -Raw -Encoding UTF8 -LiteralPath $skillPath
  Assert-Contains $skillContent "name: $skillName" "Vendor skill frontmatter is missing: $skillName"
  Assert-NotContains $skillContent "X-Algolia-API-Key" "Vendor skill must not embed an Algolia API key: $skillName"
  $actualBlob = (& git -C $repoRoot hash-object $skillPath | Out-String).Trim()
  Assert-True ($actualBlob -eq $expectedVendorBlobs[$skillName]) "Vendor skill differs from pinned upstream blob: $skillName"
  $dependency = @($optionalDependencies | Where-Object { $_.name -eq $skillName })
  Assert-True ($dependency.Count -eq 1) "Manifest optional dependency is missing: $skillName"
  Assert-True ($dependency[0].provider -eq "iris-agentic-dev-skills") "Unexpected vendor provider: $skillName"
}

$upstreamPath = Join-Path $vendorRoot "UPSTREAM.md"
$licensePath = Join-Path $vendorRoot "LICENSE"
Assert-True (Test-Path -LiteralPath $licensePath -PathType Leaf) "Vendor MIT license is missing"
$upstream = Get-Content -Raw -Encoding UTF8 -LiteralPath $upstreamPath
Assert-Contains $upstream "568a0e03cb5bdfae6870973a73d1d4d86ae42ab9" "Vendor snapshot commit is missing"
Assert-Contains $upstream "0.9.4" "Vendor upstream version is missing"

$resolverPath = Join-Path $repoRoot "scripts/resolve-plugin-skill-dependencies.ps1"
$resolvedJson = & $resolverPath -AgentsRoot $repoRoot -ProjectRoot $repoRoot -Plugin "coding-iris-plugin" -OutputFormat Json | Out-String
$resolvedPayload = $resolvedJson | ConvertFrom-Json
$resolved = @()
foreach ($entry in $resolvedPayload) {
  $resolved += $entry
}
foreach ($skillName in $expectedVendorSkills) {
  $item = @($resolved | Where-Object { $_.name -eq $skillName })
  Assert-True ($item.Count -eq 1) "Resolver did not return vendor skill: $skillName"
  Assert-True ($item[0].type -eq "optional") "Vendor skill should remain optional: $skillName"
  Assert-True ($item[0].sourceExists -eq $true) "Resolver source should exist: $skillName"
}

$thinIndexScript = Join-Path $pluginRoot "scripts/generate-plugin-thin-index.ps1"
$thinIndexOutput = & $thinIndexScript -PluginPath $pluginRoot -ProjectRoot $repoRoot -Mode DryRun | Out-String
Assert-Contains $thinIndexOutput "iris-mcp-lookup" "Plugin thin-index should include iris-mcp-lookup"
Assert-Contains $thinIndexOutput "iris_knowledge_lookup.md" "Plugin thin-index should include lookup rule"
Assert-NotContains $thinIndexOutput "iris-official-docs-routing.md" "References must not generate plugin thin-index"
foreach ($skillName in $expectedVendorSkills) {
  Assert-NotContains $thinIndexOutput $skillName "Optional vendor skills must not be emitted by plugin thin-index"
}

$agenticRulePath = Join-Path $pluginRoot "rules/iris_agentic_dev.md"
$agenticRule = Get-Content -Raw -Encoding UTF8 -LiteralPath $agenticRulePath
Assert-Contains $agenticRule "iris-agentic-dev 0.9.3" "Current bundled MCP version should be documented"
Assert-Contains $agenticRule "iris_debug" "Current merged debug tool should be documented"
Assert-Contains $agenticRule "iris_containers" "Current container tool should be documented"
Assert-Contains $agenticRule "iris_doc_search" "Doc search availability gate should be documented"
Assert-Contains $agenticRule "iris_coverage" "Coverage execution boundary should be documented"
Assert-Contains $agenticRule "capabilities.compile_path=docker_exec" "Compile capability routing should be documented"
Assert-Contains $agenticRule "disabled_tools" "MCP tool suppression should be documented"

Write-Host "iris-mcp-lookup tests passed"
