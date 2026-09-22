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
Assert-True ($manifest.version -eq "0.4.0") "Plugin version should be 0.4.0"

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
  "objectscript-debugging",
  "objectscript-tdd"
)

$expectedVendorBlobs = @{
  "objectscript-review" = "cc2c49bb96d9c08f95c570902ce72042cd2c7b00"
  "objectscript-guardrails" = "05fef10872e435e7984a6de5afdaea9f854454c0"
  "objectscript-sql-patterns" = "015a8d5e63cea23716cafc16413cf08549cf6ca0"
  "objectscript-list-patterns" = "a12c5bcd4c5e95e08ffceec40a1b22dcdca1201d"
  "objectscript-navigation" = "df6fd5f2fabd1b343a7bacd42b07e735db5285b0"
  "objectscript-unit-test" = "66790507ca0e504fbfa1d48b99f5f7e68b81fe19"
  "objectscript-debugging" = "016bc111e2a4346be4da618fb3da2be80b69b68b"
  "objectscript-tdd" = "1e1fd7664d16ca1c31661dba90cdd12393d04388"
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
Assert-Contains $upstream "c54ae583eddc36350e5a155246153dadf843cfc7" "Vendor snapshot commit is missing"
Assert-Contains $upstream "1.2.6" "Vendor upstream version is missing"
Assert-Contains $upstream "objectscript-tdd" "Vendor TDD authorization boundary is missing"

$resolverPath = Join-Path $repoRoot "scripts/resolve-plugin-skill-dependencies.ps1"
$resolvedJson = & $resolverPath -AgentsRoot $repoRoot -ProjectRoot $repoRoot -ContextRoot $repoRoot -CapabilityRoot $repoRoot -Plugin "coding-iris-plugin" -OutputFormat Json | Out-String
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
Assert-Contains $agenticRule "iris-agentic-dev 1.2.6" "Current bundled MCP version should be documented"
Assert-Contains $agenticRule "iris_debug" "Current merged debug tool should be documented"
Assert-Contains $agenticRule "iris_containers" "Current container tool should be documented"
Assert-Contains $agenticRule "iris_doc_search" "Doc search availability gate should be documented"
Assert-Contains $agenticRule "iris_coverage" "Coverage execution boundary should be documented"
Assert-Contains $agenticRule "capabilities.compile_path=docker_exec" "Compile capability routing should be documented"
Assert-Contains $agenticRule "disabled_tools" "MCP tool suppression should be documented"
Assert-Contains $agenticRule "destructive_tools_enabled" "Destructive tool policy should be documented"
Assert-Contains $agenticRule "write_allowed_servers" "Per-server write policy should be documented"
Assert-Contains $agenticRule "--no-skills" "Built-in skill suppression should be documented"
Assert-Contains $agenticRule "78" "Live v1.2.6 tool count should be documented"

Write-Host "iris-mcp-lookup tests passed"
