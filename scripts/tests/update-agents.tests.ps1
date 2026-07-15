$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "scripts/update-agents.ps1"
$profileScriptUnderTest = Join-Path $repoRoot "scripts/update-plugin-profile.ps1"
$agentThinIndexScriptUnderTest = Join-Path $repoRoot "scripts/generate-agent-thin-index.ps1"
$vendorThinIndexScriptUnderTest = Join-Path $repoRoot "scripts/generate-vendor-thin-index.ps1"
$skillDependencyResolverUnderTest = Join-Path $repoRoot "scripts/resolve-plugin-skill-dependencies.ps1"
$checkFunctionalDiffScriptUnderTest = Join-Path $repoRoot "scripts/check-functional-diff.ps1"
$installGitHooksScriptUnderTest = Join-Path $repoRoot "scripts/install-git-hooks.ps1"
$preCommitHookUnderTest = Join-Path $repoRoot "hooks/pre-commit"
$irisMcpHelperUnderTest = Join-Path $repoRoot "scripts/iris-mcp.js"
$irisAgenticRuleUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/rules/iris_agentic_dev.md"

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

function New-TestProject {
  $root = Join-Path ([System.IO.Path]::GetTempPath()) ("agents-update-test-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  git -C $root init | Out-Null
  git -C $root config user.email "test@example.invalid" | Out-Null
  git -C $root config user.name "Test User" | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents") | Out-Null
  git -C (Join-Path $root ".agents") init | Out-Null

  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/scripts") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/hooks") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/agents") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/workflows") | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/generate-plugin-thin-index.ps1") -Destination (Join-Path $root ".agents/scripts/generate-plugin-thin-index.ps1")
  Copy-Item -LiteralPath $agentThinIndexScriptUnderTest -Destination (Join-Path $root ".agents/scripts/generate-agent-thin-index.ps1")
  Copy-Item -LiteralPath $scriptUnderTest -Destination (Join-Path $root ".agents/scripts/update-agents.ps1")
  Copy-Item -LiteralPath $profileScriptUnderTest -Destination (Join-Path $root ".agents/scripts/update-plugin-profile.ps1")
  Copy-Item -LiteralPath $checkFunctionalDiffScriptUnderTest -Destination (Join-Path $root ".agents/scripts/check-functional-diff.ps1")
  Copy-Item -LiteralPath $installGitHooksScriptUnderTest -Destination (Join-Path $root ".agents/scripts/install-git-hooks.ps1")
  Copy-Item -LiteralPath $preCommitHookUnderTest -Destination (Join-Path $root ".agents/hooks/pre-commit")
  Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/sync-vendor-skills.ps1") -Destination (Join-Path $root ".agents/scripts/sync-vendor-skills.ps1")
  Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/sync-claudecode-skills.ps1") -Destination (Join-Path $root ".agents/scripts/sync-claudecode-skills.ps1")
  Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/check-agent-entrypoints.ps1") -Destination (Join-Path $root ".agents/scripts/check-agent-entrypoints.ps1")
  Copy-Item -LiteralPath $vendorThinIndexScriptUnderTest -Destination (Join-Path $root ".agents/scripts/generate-vendor-thin-index.ps1")
  Copy-Item -LiteralPath $skillDependencyResolverUnderTest -Destination (Join-Path $root ".agents/scripts/resolve-plugin-skill-dependencies.ps1")
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".agents/agents/agent-registry.md") -Value "# Agent Registry"
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".agents/workflows/workflow-registry.md") -Value "# Workflow Registry"
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/agents/i18n-agent") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".agents/agents/i18n-agent/AGENT.md") -Value @(
    "# i18n-agent",
    "",
    "IRIS i18n agent."
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".agents/agents/i18n-agent/bindings.yaml") -Value @(
    "name: i18n-agent",
    "description: IRIS i18n agent.",
    "defaultWorkflow: i18n-change",
    "requiredPlugins:",
    "  - coding-iris-plugin",
    "  - i18n-iris-plugin"
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".agents/workflows/i18n-change.workflow.md") -Value "# i18n-change"

  $contextPluginRoot = Join-Path $root ".agents/plugins/agent-context-kit"
  New-Item -ItemType Directory -Force -Path (Join-Path $contextPluginRoot ".agents-plugin") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $contextPluginRoot "rules") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $contextPluginRoot "skills/project-context-maintenance") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $contextPluginRoot "scripts") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $contextPluginRoot ".agents-plugin/plugin.json") -Value @(
    "{",
    '  "name": "agent-context-kit",',
    '  "version": "0.1.0",',
    '  "displayName": "Agent Context Kit",',
    '  "rules": "rules/",',
    '  "skills": "skills/",',
    '  "scripts": "scripts/",',
    '  "initSkill": "project-context-maintenance"',
    "}"
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $contextPluginRoot "rules/context_rule.md") -Value "# Context Rule"
  Set-Content -Encoding UTF8 -Path (Join-Path $contextPluginRoot "skills/project-context-maintenance/SKILL.md") -Value @(
    "---",
    "name: project-context-maintenance",
    "description: context",
    "---",
    "",
    "# Project Context Maintenance"
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $contextPluginRoot "scripts/generate-plugin-thin-index.ps1") -Value @(
    "param(",
    '    [string]$PluginPath = ".agents/plugins/agent-context-kit",',
    '    [string]$ProjectRoot = ".",',
    '    [ValidateSet("DryRun", "Write")]',
    '    [string]$Mode = "DryRun",',
    '    [string[]]$ExcludeSkill = @(),',
    '    [string[]]$ExcludeRule = @(),',
    '    [switch]$Force',
    ")",
    "",
    '$ErrorActionPreference = "Stop"',
    '$canonicalScript = Join-Path $PSScriptRoot "..\..\..\scripts\generate-plugin-thin-index.ps1"',
    '& $canonicalScript -PluginPath $PluginPath -ProjectRoot $ProjectRoot -Mode $Mode -ExcludeSkill $ExcludeSkill -ExcludeRule $ExcludeRule -Force:$Force'
  )

  $pluginRoot = Join-Path $root ".agents/plugins/sample-plugin"
  New-Item -ItemType Directory -Force -Path (Join-Path $pluginRoot ".agents-plugin") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $pluginRoot "rules") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $pluginRoot "skills/sample-skill") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $pluginRoot "templates") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $pluginRoot "scripts") | Out-Null

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot ".agents-plugin/plugin.json") -Value @(
    "{",
    '  "name": "sample-plugin",',
    '  "version": "0.1.0",',
    '  "displayName": "Sample Plugin",',
    '  "rules": "rules/",',
    '  "skills": "skills/",',
    '  "templates": "templates/",',
    '  "scripts": "scripts/",',
    '  "configMigrations": [{"id":"sample-v1","script":"scripts/migrate-sample.ps1"}],',
    '  "skillDependencies": {',
    '    "required": [{"capability":"test.vendor.required","provider":"test-vendor","name":"vendor-test-skill"}],',
    '    "optional": [{"capability":"test.vendor.optional","provider":"root-vendor","name":"root-vendor","trigger":"test-only"}]',
    '  },',
    '  "initSkill": "sample-skill"',
    "}"
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "rules/sample_rule.md") -Value @(
    "---",
    "name: sample_rule",
    "description: Use when testing rule frontmatter propagation.",
    "task-affinity: [sample, rule, propagation]",
    "related:",
    "  - legacy_rule.md",
    "---",
    "",
    "# Sample Rule",
    "",
    "Rule body."
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "rules/legacy_rule.md") -Value @(
    "# Legacy Rule",
    "",
    "Rule body without frontmatter."
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "skills/sample-skill/SKILL.md") -Value @(
    "---",
    "name: sample-skill",
    "description: Use when testing real skill description propagation.",
    "---",
    "",
    "# Sample Skill"
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "templates/sample_profile.template.md") -Value @(
    "# Sample Profile",
    "",
    "## Basic",
    "",
    "- projectName: TODO",
    "- newField: TODO",
    "- preservedField: TODO"
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "scripts/generate-plugin-thin-index.ps1") -Value @(
    "param(",
    '    [string]$PluginPath = ".agents/plugins/sample-plugin",',
    '    [string]$ProjectRoot = ".",',
    '    [ValidateSet("DryRun", "Write")]',
    '    [string]$Mode = "DryRun",',
    '    [string[]]$ExcludeSkill = @(),',
    '    [string[]]$ExcludeRule = @(),',
    '    [switch]$Force',
    ")",
    "",
    '$ErrorActionPreference = "Stop"',
    '$canonicalScript = Join-Path $PSScriptRoot "..\..\..\scripts\generate-plugin-thin-index.ps1"',
    '& $canonicalScript -PluginPath $PluginPath -ProjectRoot $ProjectRoot -Mode $Mode -ExcludeSkill $ExcludeSkill -ExcludeRule $ExcludeRule -Force:$Force'
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $root "AGENTS.md") -Value "# Target Project"
  Set-Content -Encoding UTF8 -Path (Join-Path $root "CLAUDE.md") -Value "# Existing Claude Entry"

  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/vendor/test-vendor/skills/vendor-test-skill") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".agents/vendor/test-vendor/skills/vendor-test-skill/SKILL.md") -Value @(
    "---",
    "name: vendor-test-skill",
    "description: Use when testing vendor thin-index generation.",
    "---",
    "",
    "# Vendor Test Skill"
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "scripts/migrate-sample.ps1") -Value @(
    'param([string]$ProjectRoot=".",[string]$AgentsRoot=".agents",[ValidateSet("DryRun", "Write")][string]$Mode="DryRun")',
    '$status = if ($Mode -eq "Write") { "config-migration-applied" } else { "config-migration-unchanged" }',
    '[PSCustomObject]@{status=$status;target=".agents/config/sample_profile.md";reason=("sample migration received " + $Mode)} | ConvertTo-Json -Compress'
  )
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/vendor/root-vendor") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".agents/vendor/root-vendor/SKILL.md") -Value @(
    "---",
    "name: root-vendor",
    "description: Use when testing root vendor skill generation.",
    "---",
    "",
    "# Root Vendor Skill"
  )
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".claude/skills/vendor-test-skill") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".claude/skills/root-vendor") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $root ".claude/skills/vendor-test-skill/SKILL.md") -Value "# Existing user skill"

  return $root
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "scripts/update-agents.ps1 should exist"
Assert-True (Test-Path -LiteralPath $profileScriptUnderTest -PathType Leaf) "scripts/update-plugin-profile.ps1 should exist"
Assert-True (Test-Path -LiteralPath $agentThinIndexScriptUnderTest -PathType Leaf) "scripts/generate-agent-thin-index.ps1 should exist"
Assert-True (Test-Path -LiteralPath $vendorThinIndexScriptUnderTest -PathType Leaf) "scripts/generate-vendor-thin-index.ps1 should exist"
Assert-True (Test-Path -LiteralPath $checkFunctionalDiffScriptUnderTest -PathType Leaf) "scripts/check-functional-diff.ps1 should exist"
Assert-True (Test-Path -LiteralPath $installGitHooksScriptUnderTest -PathType Leaf) "scripts/install-git-hooks.ps1 should exist"
Assert-True (Test-Path -LiteralPath $preCommitHookUnderTest -PathType Leaf) "hooks/pre-commit should exist"
Assert-True (Test-Path -LiteralPath $skillDependencyResolverUnderTest -PathType Leaf) "skill dependency resolver should exist"

$runbookPath = Join-Path $repoRoot "docs/update-agents.md"
$readmePath = Join-Path $repoRoot "README.md"
$contextSkillPath = Join-Path $repoRoot "plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md"
$installScriptPath = Join-Path $repoRoot "scripts/install-agents.ps1"
Assert-True (Test-Path -LiteralPath $runbookPath -PathType Leaf) "docs/update-agents.md should exist"
Assert-True (Test-Path -LiteralPath $readmePath -PathType Leaf) "README.md should exist"
$updateScriptContent = Get-Content -Raw -Encoding UTF8 -Path $scriptUnderTest
$profileScriptContent = Get-Content -Raw -Encoding UTF8 -Path $profileScriptUnderTest
$installScriptContent = Get-Content -Raw -Encoding UTF8 -Path $installScriptPath
Assert-Contains $updateScriptContent "/agents/**" "update sparse checkout should include agents"
Assert-Contains $updateScriptContent "/workflows/**" "update sparse checkout should include workflows"
Assert-Contains $updateScriptContent "/feedback/**" "update sparse checkout should include feedback"
Assert-Contains $updateScriptContent "/hooks/**" "update sparse checkout should include hooks"
Assert-Contains $updateScriptContent "/scripts/iris-mcp.js" "update sparse checkout should deploy the MCP helper"
Assert-Contains $updateScriptContent "!/skills/agent-kit-maintenance/" "update sparse checkout should exclude maintenance-only skill directory"
Assert-Contains $updateScriptContent "!/skills/agent-kit-maintenance/**" "update sparse checkout should exclude maintenance-only skill"
Assert-Contains $updateScriptContent '"/work/"' "update should ignore local staging work directory"
Assert-Contains $updateScriptContent "generate-agent-thin-index.ps1" "update should invoke agent thin-index generation"
Assert-Contains $updateScriptContent "generate-vendor-thin-index.ps1" "update should invoke vendor thin-index generation"
Assert-Contains $updateScriptContent "resolve-plugin-skill-dependencies.ps1" "update should resolve plugin skill dependencies"
Assert-Contains $updateScriptContent "CleanupLegacyVendorSkills" "update should support explicit legacy vendor cleanup"
Assert-Contains $updateScriptContent "sync-claudecode-skills.ps1" "update should invoke Claude Code skill sync"
Assert-Contains $updateScriptContent "2.25.0" "update should require Git 2.25.0 or newer for sparse-checkout subcommand"
Assert-Contains $updateScriptContent "Assert-GitSparseCheckoutSubcommandAvailable" "update should fail early when git sparse-checkout subcommand is unavailable"
Assert-Contains $installScriptContent "/agents/**" "install sparse checkout should include agents"
Assert-Contains $installScriptContent "/workflows/**" "install sparse checkout should include workflows"
Assert-Contains $installScriptContent "/feedback/**" "install sparse checkout should include feedback"
Assert-Contains $installScriptContent "/hooks/**" "install sparse checkout should include hooks"
Assert-Contains $installScriptContent "/scripts/iris-mcp.js" "install sparse checkout should deploy the MCP helper"
Assert-True (Test-Path -LiteralPath $irisMcpHelperUnderTest -PathType Leaf) "iris-mcp.js helper should exist at the deployed canonical path"
$irisAgenticRuleContent = Get-Content -Raw -Encoding UTF8 -LiteralPath $irisAgenticRuleUnderTest
Assert-Contains $irisAgenticRuleContent 'SELECT 1 AS Probe' "MCP diagnostics should use a real query probe"
Assert-Contains $irisAgenticRuleContent 'config_file=null' "MCP diagnostics should define the auto-discovery null-config boundary"
Assert-Contains $irisAgenticRuleContent 'HTTP 404/405' "MCP diagnostics should not expand one endpoint failure to the whole MCP"
Assert-Contains $irisAgenticRuleContent 'mcp__iris_agentic_dev__*' "MCP diagnostics should prefer native tools before the helper"
Assert-Contains $installScriptContent "!/skills/agent-kit-maintenance/" "install sparse checkout should exclude maintenance-only skill directory"
Assert-True (-not $installScriptContent.Contains("core.hooksPath")) "install must not enable git hooks automatically"
Assert-Contains $updateScriptContent "git-hooks-not-enabled" "update should report hook availability without enabling hooks"
Assert-True (-not $updateScriptContent.Contains("git config core.hooksPath .agents/hooks")) "update must not enable git hooks automatically"
Assert-Contains $installScriptContent "!/skills/agent-kit-maintenance/**" "install sparse checkout should exclude maintenance-only skill"
Assert-Contains $installScriptContent '"/work/"' "install should ignore local staging work directory"
Assert-Contains $installScriptContent "2.25.0" "install should require Git 2.25.0 or newer for sparse-checkout subcommand"
Assert-Contains $installScriptContent "Assert-GitSparseCheckoutSubcommandAvailable" "install should fail early when git sparse-checkout subcommand is unavailable"
Assert-Contains $installScriptContent "Continue installing .agents" "install should not block .agents bootstrap when AGENTS.md is missing"
Assert-Contains $installScriptContent "/project-context-maintenance" "install should guide users or their agent to run project-context-maintenance after install"
Assert-True (-not $installScriptContent.Contains("Syncing vendor skills to runtime skill directory")) "install must not sync all vendor skills to user runtime directories"
Assert-Contains $installScriptContent ".agents/plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md" "install should point to the real project-context-maintenance skill path"
Assert-Contains $profileScriptContent "available" "profile updater should support available"
Assert-Contains $profileScriptContent "enabled" "profile updater should support enabled"
Assert-Contains $profileScriptContent "disabled" "profile updater should support disabled"
$readmeContent = Get-Content -Raw -Encoding UTF8 -Path $readmePath
Assert-Contains $readmeContent 'Git `2.25.0`' "README should document Git 2.25.0 requirement before local runbook exists"
Assert-Contains $readmeContent "git sparse-checkout" "README should explain sparse-checkout dependency before first install"
$runbookContent = Get-Content -Raw -Encoding UTF8 -Path $runbookPath
Assert-Contains $runbookContent "DryRun" "runbook should mention DryRun"
Assert-Contains $runbookContent "Write" "runbook should mention Write"
Assert-Contains $runbookContent "-Detailed" "runbook should mention -Detailed"
Assert-Contains $runbookContent "config-review-required" "runbook should mention config-review-required"
Assert-Contains $runbookContent "pull-blocked-dirty" "runbook should mention pull-blocked-dirty"
Assert-Contains $runbookContent "git clone" "runbook should support manual clone"
Assert-Contains $runbookContent "/project-context-maintenance" "runbook should guide users to maintain project context after install"
Assert-Contains $runbookContent "dependencies" "runbook should explain dependency plugin initialization order"
Assert-Contains $runbookContent "install-git-hooks.ps1" "runbook should document explicit git hook enablement"
Assert-Contains $runbookContent "git-hooks-not-enabled" "runbook should document hook status notes"
$contextSkillContent = Get-Content -Raw -Encoding UTF8 -Path $contextSkillPath
Assert-Contains $contextSkillContent "docs/update-agents.md" "project-context-maintenance should route updates to docs/update-agents.md"
Assert-Contains $contextSkillContent "depends_on" "project-context-maintenance should guide plugin enablement after context maintenance"
Assert-Contains $contextSkillContent "dependencies" "project-context-maintenance should read plugin manifest dependencies before enabling plugins"
Assert-Contains $contextSkillContent "update-plugin-profile.ps1" "project-context-maintenance should use update-plugin-profile.ps1 after init validation"
Assert-Contains $contextSkillContent "install-git-hooks.ps1" "project-context-maintenance should mention optional git hook enablement"

$missingAgentsEntryProjectRoot = New-TestProject
try {
  Remove-Item -LiteralPath (Join-Path $missingAgentsEntryProjectRoot "AGENTS.md")
  $missingAgentsEntryOutput = & (Join-Path $missingAgentsEntryProjectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $missingAgentsEntryProjectRoot -Mode DryRun -NoPull | Out-String
  Assert-Contains $missingAgentsEntryOutput "agents-entry-missing" "Missing AGENTS.md should be reported for later project context maintenance"
  Assert-True (-not $missingAgentsEntryOutput.Contains("Action required:")) "Missing AGENTS.md should not block .agents update"
}
finally {
  Remove-Item -Recurse -Force -LiteralPath $missingAgentsEntryProjectRoot
}

$projectRoot = New-TestProject
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot ".agents/config") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot ".agents/skills/agent-kit-maintenance") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/skills/agent-kit-maintenance/SKILL.md") -Value "# Maintenance-only Skill"
  Set-Content -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md") -Value @(
    "# Sample Profile",
    "",
    "## Basic",
    "",
    "- projectName: real-project",
    "- preservedField: manual-value",
    "- oldField: legacy-value"
  )

  $summaryOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull | Out-String
  Assert-Contains $summaryOutput "Agent kit update summary" "Default output should be summarized"
  Assert-Contains $summaryOutput "Available plugins:" "Default output should list available plugins"
  Assert-Contains $summaryOutput "sample-plugin" "Default output should report sample plugin as available"
  Assert-Contains $summaryOutput "agent-context-kit" "Default output should process the default context plugin"
  Assert-Contains $summaryOutput "git-hooks-not-enabled" "Default output should report available but disabled git hooks"
  Assert-True (-not $summaryOutput.Contains("vendor-skill-synced")) "Default update must not sync vendor skills to user runtime directories"
  Assert-Contains $summaryOutput "Optional entrypoint notes:" "Default output should report optional entrypoint notes"
  Assert-True ([string]::IsNullOrWhiteSpace((git -C $projectRoot config --get core.hooksPath))) "Update must not set core.hooksPath automatically"
  Assert-True (-not $summaryOutput.Contains("Action required:")) "Missing or non-symlink optional entrypoints should not require action"
  Assert-True (-not $summaryOutput.Contains("sample_profile.md")) "Available plugins must not have templates merged by default"
  Assert-True (-not $summaryOutput.Contains("sample_rule.md")) "Available plugins must not generate thin-index by default"

  $unenabledPluginOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed -Plugin sample-plugin | Out-String
  Assert-Contains $unenabledPluginOutput "plugin-init-required" "Explicit available plugin should require init instead of being processed"
  Assert-True (-not $unenabledPluginOutput.Contains("config-missing-key")) "Explicit available plugin must not merge config before enablement"
  Assert-True (-not $unenabledPluginOutput.Contains("sample_rule.md")) "Explicit available plugin must not generate thin-index before enablement"

  $detailedDefaultOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed | Out-String
  Assert-Contains $detailedDefaultOutput "runtime-adapter-skipped" "Detailed output should report that runtime adapters are opt-in"

  $enableSampleOutput = & (Join-Path $projectRoot ".agents/scripts/update-plugin-profile.ps1") -ProjectRoot $projectRoot -Plugin sample-plugin -Status enabled | Out-String
  Assert-Contains $enableSampleOutput "plugin-profile-updated" "Profile updater should report updated status"
  $pluginProfileAfterEnable = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/plugin_profile.md")
  Assert-Contains $pluginProfileAfterEnable "sample-plugin" "Profile updater should write selected plugin"
  Assert-Contains $pluginProfileAfterEnable "enabled" "Profile updater should mark selected plugin enabled"

  $dryRunOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed -Plugin sample-plugin | Out-String
  Assert-Contains $dryRunOutput "config-missing-key" "DryRun should report missing config keys"
  Assert-Contains $dryRunOutput "config-deprecated-candidate" "DryRun should report deprecated config candidates"
  Assert-Contains $dryRunOutput "config-migration-unchanged" "DryRun should invoke plugin config migration"
  Assert-Contains $dryRunOutput "sample migration received DryRun" "DryRun should pass DryRun to plugin config migration"

  $beforeWrite = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")
  Assert-Contains $beforeWrite "projectName: real-project" "DryRun must not overwrite existing config values"
  Assert-True (-not $beforeWrite.Contains("newField: TODO")) "DryRun must not append missing config keys"

  $writeOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode Write -NoPull -Detailed -Plugin sample-plugin | Out-String
  Assert-Contains $writeOutput "config-merged-key" "Write should merge missing config keys"
  Assert-Contains $writeOutput "config-migration-applied" "Write should apply plugin config migration"
  Assert-Contains $writeOutput "sample migration received Write" "Write should pass Write to plugin config migration"
  Assert-Contains $writeOutput "git-hooks-not-enabled" "Write should report hooks are available but not enabled"
  Assert-Contains $writeOutput "agent-thin-index" "Write should include agent thin-index phase"
  Assert-Contains $writeOutput "vendor-thin-index" "Write should include vendor thin-index phase"
  Assert-Contains $writeOutput "runtime-adapter-skipped" "Write should keep runtime adapters opt-in"
  Assert-Contains $writeOutput "skill-dependency-required" "Write should report required vendor capability"
  Assert-Contains $writeOutput "skill-dependency-optional" "Write should report optional vendor capability"
  Assert-Contains $writeOutput "maintenance-only-skill-removed" "Write should report removal of deployed maintenance-only skill"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/skills/agent-kit-maintenance"))) "Write should remove deployed maintenance-only skill"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/config/plugin_profile.md")) "Write should create plugin profile"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/skills/i18n-agent/SKILL.md")) "Write should generate i18n-agent skill thin-index"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/skills/vendor-test-skill/SKILL.md")) "Write should generate vendor skill thin-index"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/skills/root-vendor/SKILL.md"))) "Write should not generate optional vendor skill thin-index"

  $profileBeforeCheck = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")
  $thinIndexBeforeCheck = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/skills/sample-skill/SKILL.md")
  $checkOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode Check -NoPull -Detailed -Plugin sample-plugin | Out-String
  Assert-Contains $checkOutput "config-migration-unchanged" "Check should accept an unchanged plugin config migration"
  Assert-Contains $checkOutput "sample migration received DryRun" "Check should pass DryRun to plugin config migration"
  Assert-True (-not $checkOutput.Contains("config-migration-failed")) "Check should not report config-migration-failed for a DryRun-only migration"
  Assert-True ((Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")) -eq $profileBeforeCheck) "Check must not modify plugin profile files"
  Assert-True ((Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/skills/sample-skill/SKILL.md")) -eq $thinIndexBeforeCheck) "Check must not modify generated thin-index files"
  $agentSkillThinIndex = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/skills/i18n-agent/SKILL.md")
  Assert-Contains $agentSkillThinIndex ".agents/agents/i18n-agent/AGENT.md" "Agent thin-index should point to canonical AGENT.md"
  Assert-Contains $agentSkillThinIndex ".agents/agents/i18n-agent/bindings.yaml" "Agent thin-index should point to bindings.yaml"
  Assert-Contains $agentSkillThinIndex ".agents/workflows/i18n-change.workflow.md" "Agent thin-index should point to default workflow"
  Assert-True (-not $agentSkillThinIndex.Contains(".codex/agents")) "Agent thin-index must not generate tool adapter content"
  $profileAfterWrite = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/plugin_profile.md")
  Assert-Contains $profileAfterWrite "agent-context-kit | enabled" "Default context plugin should be enabled"
  Assert-Contains $profileAfterWrite "sample-plugin | enabled" "Write must preserve enabled plugin state"
  Assert-True (-not $profileAfterWrite.Contains("initialized")) "Stable plugin profile must not write initialized"
  Assert-True (-not $profileAfterWrite.Contains("indexed")) "Stable plugin profile must not write indexed"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md")) "Write should generate rule thin-index before stale cleanup is tested"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/legacy_rule.md")) "Write should generate legacy rule thin-index without source frontmatter"
  $sampleRuleThinIndex = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/sample_rule.md")
  Assert-Contains $sampleRuleThinIndex "task-affinity: [sample, rule, propagation]" "Rule thin-index should propagate task-affinity frontmatter"
  Assert-Contains $sampleRuleThinIndex "thin-index: true" "Rule thin-index should declare thin-index frontmatter"
  Assert-Contains $sampleRuleThinIndex "source: .agents/plugins/sample-plugin/rules/sample_rule.md" "Rule thin-index should declare source frontmatter"
  Assert-Contains $sampleRuleThinIndex "description: Use when testing rule frontmatter propagation." "Rule thin-index should propagate description frontmatter"
  $legacyRuleThinIndex = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/legacy_rule.md")
  Assert-True (-not $legacyRuleThinIndex.StartsWith("---")) "Legacy rule thin-index should keep existing non-frontmatter shape"
  Assert-Contains $legacyRuleThinIndex ".agents/plugins/sample-plugin/rules/legacy_rule.md" "Legacy rule thin-index should still point to its source"
  $sampleSkillThinIndex = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/skills/sample-skill/SKILL.md")
  Assert-True (-not $sampleSkillThinIndex.Contains("task-affinity")) "Skill thin-index should not gain rule task-affinity metadata"
  Assert-Contains $sampleSkillThinIndex "description: Use when testing real skill description propagation." "Skill thin-index should propagate source skill description"
  Assert-Contains $sampleSkillThinIndex "thin-index: true" "Skill thin-index should declare thin-index frontmatter"
  Assert-Contains $sampleSkillThinIndex "source: .agents/plugins/sample-plugin/skills/sample-skill/SKILL.md" "Skill thin-index should declare source frontmatter"
  $vendorSkillThinIndex = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/skills/vendor-test-skill/SKILL.md")
  Assert-Contains $vendorSkillThinIndex "description: Use when testing vendor thin-index generation." "Vendor thin-index should propagate source skill description"
  Assert-Contains $vendorSkillThinIndex "thin-index: true" "Vendor thin-index should declare thin-index frontmatter"
  Assert-Contains $vendorSkillThinIndex "source: .agents/vendor/test-vendor/skills/vendor-test-skill/SKILL.md" "Vendor thin-index should point to vendor source"
  $claudeSkillSyncDryRun = & (Join-Path $projectRoot ".agents/scripts/sync-claudecode-skills.ps1") -AgentsRoot (Join-Path $projectRoot ".agents") -ProjectRoot $projectRoot -Mode DryRun | Out-String
  Assert-Contains $claudeSkillSyncDryRun "skipped" "Claude Code skill sync should skip project skills already provided by dedup sources"
  Assert-Contains $claudeSkillSyncDryRun "generated" "Claude Code skill sync should report skills that need project-level sync"
  $vendorSyncWithoutSelection = & (Join-Path $projectRoot ".agents/scripts/sync-vendor-skills.ps1") -AgentsRoot (Join-Path $projectRoot ".agents") -ProjectRoot $projectRoot -Mode Write 2>&1 | Out-String
  Assert-Contains $vendorSyncWithoutSelection "vendor-skill-selection-required" "Vendor runtime Write should reject missing skill selection"
  $vendorSyncReuse = & (Join-Path $projectRoot ".agents/scripts/sync-vendor-skills.ps1") -AgentsRoot (Join-Path $projectRoot ".agents") -ProjectRoot $projectRoot -Skill @("vendor-test-skill") -Runtime ClaudeCode -Mode DryRun | Out-String
  Assert-Contains $vendorSyncReuse "vendor-skill-reused" "Explicit runtime sync should reuse an existing canonical user skill"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot "CODEBUDDY.md"))) "Write must not create missing optional entrypoints"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot "CLAUDE.md.bak"))) "Write must not backup or replace existing optional entrypoints"
  Assert-True ([string]::IsNullOrWhiteSpace((git -C $projectRoot config --get core.hooksPath))) "Write must not enable git hooks automatically"

  $installHookOutput = & (Join-Path $projectRoot ".agents/scripts/install-git-hooks.ps1") -ProjectRoot $projectRoot | Out-String
  Assert-Contains $installHookOutput "git-hooks-enabled" "install-git-hooks should report enabled hooks"
  Assert-Contains (git -C $projectRoot config --get core.hooksPath) ".agents/hooks" "install-git-hooks should set core.hooksPath to .agents/hooks"
  $hooksEnabledOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed | Out-String
  Assert-Contains $hooksEnabledOutput "git-hooks-enabled" "Update should report enabled git hooks after explicit install"
  $claudeContent = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot "CLAUDE.md")
  Assert-Contains $claudeContent "Existing Claude Entry" "Write must preserve existing optional entrypoint content"

  $afterWrite = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")
  Assert-Contains $afterWrite "projectName: real-project" "Write must preserve existing config values"
  Assert-Contains $afterWrite "preservedField: manual-value" "Write must preserve manually maintained values"
  Assert-Contains $afterWrite "oldField: legacy-value" "Write must not delete deprecated candidate fields"
  Assert-Contains $afterWrite "newField: TODO" "Write should append missing config keys"

  Remove-Item -LiteralPath (Join-Path $projectRoot ".agents/plugins/sample-plugin/rules/sample_rule.md")
  $staleOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode Write -NoPull -Detailed -Plugin sample-plugin | Out-String
  if (-not $staleOutput.Contains("removed")) {
    Write-Host $staleOutput
    if (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md")) {
      Write-Host (Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/sample_rule.md"))
    }
  }
  Assert-Contains $staleOutput "removed" "Write should remove stale plugin thin-index files"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md"))) "Stale thin-index should be removed"

  Remove-Item -LiteralPath (Join-Path $projectRoot ".agents/vendor/test-vendor/skills/vendor-test-skill/SKILL.md")
  $staleVendorOutput = & (Join-Path $projectRoot ".agents/scripts/generate-vendor-thin-index.ps1") -AgentsRoot ".agents" -ProjectRoot $projectRoot -Skill @("root-vendor") -CleanupLegacyVendorSkills -Mode Write | Out-String
  Assert-Contains $staleVendorOutput "removed" "Write should remove stale vendor thin-index files"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/skills/vendor-test-skill/SKILL.md"))) "Stale vendor thin-index should be removed"

  $codingPluginRoot = Join-Path $projectRoot ".agents/plugins/coding-iris-plugin"
  $agentContextPluginRoot = Join-Path $projectRoot ".agents/plugins/agent-context-kit"
  New-Item -ItemType Directory -Force -Path $agentContextPluginRoot | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $codingPluginRoot ".agents-plugin") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $codingPluginRoot "rules") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $codingPluginRoot ".agents-plugin/plugin.json") -Value @(
    "{",
    '  "name": "coding-iris-plugin",',
    '  "version": "0.1.0",',
    '  "displayName": "IRIS Coding Plugin",',
    '  "rules": "rules/",',
    '  "initSkill": "coding-iris-init"',
    "}"
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $codingPluginRoot "rules/sftp_server.md") -Value "# sftp_server"
  Set-Content -Encoding UTF8 -Path (Join-Path $codingPluginRoot "rules/iris_agentic_dev.md") -Value "# iris_agentic_dev"
  Set-Content -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/sftp-server.md") -Value @(
    "# Thin Index: sftp-server",
    "",
    "This file is a thin-index.",
    "",
    '- ``.agents/plugins/coding-iris-plugin/rules/sftp-server.md``'
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/iris-agentic-dev.md") -Value @(
    "# Thin Index: iris-agentic-dev",
    "",
    "This file is a thin-index.",
    "",
    "source: .agents/plugins/coding-iris-plugin/rules/iris-agentic-dev.md"
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/project_custom.md") -Value @(
    "# Project Custom",
    "",
    "This is a project rule and mentions thin-index as plain prose only."
  )
  $allPluginCleanupDryRun = & (Join-Path $projectRoot ".agents/scripts/generate-plugin-thin-index.ps1") -PluginPath ".agents/plugins/agent-context-kit" -ProjectRoot $projectRoot -Mode DryRun | Out-String
  Assert-Contains $allPluginCleanupDryRun "sftp-server.md" "DryRun from a plugin without rules should still report stale indexes from other plugins"
  Assert-Contains $allPluginCleanupDryRun "iris-agentic-dev.md" "All-plugin cleanup should not depend on current PluginPath rules"
  $legacyCodingDryRun = & (Join-Path $projectRoot ".agents/scripts/generate-plugin-thin-index.ps1") -PluginPath ".agents/plugins/coding-iris-plugin" -ProjectRoot $projectRoot -Mode DryRun | Out-String
  Assert-Contains $legacyCodingDryRun "sftp-server.md" "DryRun should report stale legacy sftp-server thin-index"
  Assert-Contains $legacyCodingDryRun "iris-agentic-dev.md" "DryRun should report stale legacy iris-agentic-dev thin-index"
  Assert-Contains $legacyCodingDryRun "sftp_server.md" "DryRun should generate current sftp_server thin-index"
  Assert-Contains $legacyCodingDryRun "iris_agentic_dev.md" "DryRun should generate current iris_agentic_dev thin-index"
  $legacyCodingWrite = & (Join-Path $projectRoot ".agents/scripts/generate-plugin-thin-index.ps1") -PluginPath ".agents/plugins/coding-iris-plugin" -ProjectRoot $projectRoot -Mode Write | Out-String
  Assert-Contains $legacyCodingWrite "removed" "Write should remove stale legacy coding thin-index files"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sftp-server.md"))) "Legacy sftp-server thin-index should be removed"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/iris-agentic-dev.md"))) "Legacy iris-agentic-dev thin-index should be removed"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/project_custom.md")) "Project custom rules must not be removed"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sftp_server.md")) "Current sftp_server thin-index should be generated"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/iris_agentic_dev.md")) "Current iris_agentic_dev thin-index should be generated"

  $i18nPluginRoot = Join-Path $projectRoot ".agents/plugins/i18n-iris-plugin"
  New-Item -ItemType Directory -Force -Path (Join-Path $i18nPluginRoot ".agents-plugin") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $i18nPluginRoot "rules") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $i18nPluginRoot "scripts") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $i18nPluginRoot ".agents-plugin/plugin.json") -Value @(
    "{",
    '  "name": "i18n-iris-plugin",',
    '  "version": "0.1.0",',
    '  "displayName": "IRIS I18N Plugin",',
    '  "rules": "rules/",',
    '  "scripts": "scripts/",',
    '  "initSkill": "i18n-project-init",',
    '  "dependencies": ["coding-iris-plugin"]',
    "}"
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $i18nPluginRoot "scripts/generate-plugin-thin-index.ps1") -Value @(
    "param(",
    '    [string]$PluginPath = ".agents/plugins/i18n-iris-plugin",',
    '    [string]$ProjectRoot = ".",',
    '    [ValidateSet("DryRun", "Write")]',
    '    [string]$Mode = "DryRun",',
    '    [string[]]$ExcludeSkill = @(),',
    '    [string[]]$ExcludeRule = @(),',
    '    [switch]$Force',
    ")",
    "",
    '$ErrorActionPreference = "Stop"',
    '$canonicalScript = Join-Path $PSScriptRoot "..\..\..\scripts\generate-plugin-thin-index.ps1"',
    '& $canonicalScript -PluginPath $PluginPath -ProjectRoot $ProjectRoot -Mode $Mode -ExcludeSkill $ExcludeSkill -ExcludeRule $ExcludeRule -Force:$Force'
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $i18nPluginRoot "rules/i18n_hisui_widget_index.md") -Value "# i18n_hisui_widget_index"
  $i18nInitRequiredOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed -Plugin i18n-iris-plugin | Out-String
  Assert-Contains $i18nInitRequiredOutput "plugin-init-required" "Explicit available i18n plugin should require init before dependency checks"

  & (Join-Path $projectRoot ".agents/scripts/update-plugin-profile.ps1") -ProjectRoot $projectRoot -Plugin i18n-iris-plugin -Status enabled | Out-Null
  $i18nBlockedOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed -Plugin i18n-iris-plugin | Out-String
  Assert-Contains $i18nBlockedOutput "plugin-dependency-missing" "i18n plugin should be blocked until coding dependency is enabled"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/i18n_hisui_widget_index.md"))) "Blocked i18n plugin must not generate thin-index"

  & (Join-Path $projectRoot ".agents/scripts/update-plugin-profile.ps1") -ProjectRoot $projectRoot -Plugin coding-iris-plugin -Status enabled | Out-Null
  $i18nEnabledOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed -Plugin i18n-iris-plugin | Out-String
  Assert-Contains $i18nEnabledOutput "generated" "Enabled i18n plugin should be allowed to generate thin-index"

  Set-Content -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/i18n-hisui-widget-index.md") -Value @(
    "# Thin Index: i18n-hisui-widget-index",
    "",
    "This file is a thin-index.",
    "",
    '- `.agents/plugins/i18n-iris-plugin/rules/i18n-hisui-widget-index.md`'
  )
  $allPluginCleanupWrite = & (Join-Path $projectRoot ".agents/scripts/generate-plugin-thin-index.ps1") -PluginPath ".agents/plugins/agent-context-kit" -ProjectRoot $projectRoot -Mode Write | Out-String
  Assert-Contains $allPluginCleanupWrite "removed" "Write from a plugin without rules should remove stale indexes from other plugins"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/i18n-hisui-widget-index.md"))) "Legacy i18n HISUI thin-index should be removed"
  $legacyI18nWrite = & (Join-Path $projectRoot ".agents/scripts/generate-plugin-thin-index.ps1") -PluginPath ".agents/plugins/i18n-iris-plugin" -ProjectRoot $projectRoot -Mode Write | Out-String
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/i18n_hisui_widget_index.md")) "Current i18n_hisui_widget_index thin-index should be generated"
}
finally {
  if (Test-Path -LiteralPath $projectRoot) {
    Remove-Item -LiteralPath $projectRoot -Recurse -Force
  }
}

Write-Host "update-agents tests passed"
