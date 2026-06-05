$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "scripts/update-agents.ps1"

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
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents") | Out-Null
  git -C (Join-Path $root ".agents") init | Out-Null

  New-Item -ItemType Directory -Force -Path (Join-Path $root ".agents/scripts") | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/generate-plugin-thin-index.ps1") -Destination (Join-Path $root ".agents/scripts/generate-plugin-thin-index.ps1")
  Copy-Item -LiteralPath $scriptUnderTest -Destination (Join-Path $root ".agents/scripts/update-agents.ps1")
  Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/check-agent-entrypoints.ps1") -Destination (Join-Path $root ".agents/scripts/check-agent-entrypoints.ps1")

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
    '  "scripts": "scripts/"',
    "}"
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "rules/sample_rule.md") -Value @(
    "# Sample Rule",
    "",
    "Rule body."
  )

  Set-Content -Encoding UTF8 -Path (Join-Path $pluginRoot "skills/sample-skill/SKILL.md") -Value @(
    "---",
    "name: sample-skill",
    "description: sample",
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

  return $root
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "scripts/update-agents.ps1 should exist"

$runbookPath = Join-Path $repoRoot "docs/update-agents.md"
$contextSkillPath = Join-Path $repoRoot "plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md"
Assert-True (Test-Path -LiteralPath $runbookPath -PathType Leaf) "docs/update-agents.md should exist"
$runbookContent = Get-Content -Raw -Encoding UTF8 -Path $runbookPath
Assert-Contains $runbookContent "DryRun" "runbook should mention DryRun"
Assert-Contains $runbookContent "Write" "runbook should mention Write"
Assert-Contains $runbookContent "-Detailed" "runbook should mention -Detailed"
Assert-Contains $runbookContent "config-review-required" "runbook should mention config-review-required"
Assert-Contains $runbookContent "pull-blocked-dirty" "runbook should mention pull-blocked-dirty"
Assert-Contains $runbookContent "git clone" "runbook should support manual clone"
$contextSkillContent = Get-Content -Raw -Encoding UTF8 -Path $contextSkillPath
Assert-Contains $contextSkillContent "docs/update-agents.md" "project-context-maintenance should route updates to docs/update-agents.md"

$projectRoot = New-TestProject
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot ".agents/config") | Out-Null
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
  Assert-Contains $summaryOutput "Config notes:" "Default output should group config notes"
  Assert-Contains $summaryOutput "Optional entrypoint notes:" "Default output should report optional entrypoint notes"
  Assert-True (-not $summaryOutput.Contains("Action required:")) "Missing or non-symlink optional entrypoints should not require action"

  $dryRunOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull -Detailed | Out-String
  Assert-Contains $dryRunOutput "config-missing-key" "DryRun should report missing config keys"
  Assert-Contains $dryRunOutput "config-deprecated-candidate" "DryRun should report deprecated config candidates"

  $beforeWrite = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")
  Assert-Contains $beforeWrite "projectName: real-project" "DryRun must not overwrite existing config values"
  Assert-True (-not $beforeWrite.Contains("newField: TODO")) "DryRun must not append missing config keys"

  $writeOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode Write -NoPull -Detailed | Out-String
  Assert-Contains $writeOutput "config-merged-key" "Write should merge missing config keys"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md")) "Write should generate rule thin-index before stale cleanup is tested"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot "CODEBUDDY.md"))) "Write must not create missing optional entrypoints"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot "CLAUDE.md.bak"))) "Write must not backup or replace existing optional entrypoints"
  $claudeContent = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot "CLAUDE.md")
  Assert-Contains $claudeContent "Existing Claude Entry" "Write must preserve existing optional entrypoint content"

  $afterWrite = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")
  Assert-Contains $afterWrite "projectName: real-project" "Write must preserve existing config values"
  Assert-Contains $afterWrite "preservedField: manual-value" "Write must preserve manually maintained values"
  Assert-Contains $afterWrite "oldField: legacy-value" "Write must not delete deprecated candidate fields"
  Assert-Contains $afterWrite "newField: TODO" "Write should append missing config keys"

  Remove-Item -LiteralPath (Join-Path $projectRoot ".agents/plugins/sample-plugin/rules/sample_rule.md")
  $staleOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode Write -NoPull -Detailed | Out-String
  if (-not $staleOutput.Contains("removed")) {
    Write-Host $staleOutput
    if (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md")) {
      Write-Host (Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/sample_rule.md"))
    }
  }
  Assert-Contains $staleOutput "removed" "Write should remove stale plugin thin-index files"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md"))) "Stale thin-index should be removed"

  $codingPluginRoot = Join-Path $projectRoot ".agents/plugins/coding-iris-plugin"
  New-Item -ItemType Directory -Force -Path (Join-Path $codingPluginRoot ".agents-plugin") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $codingPluginRoot "rules") | Out-Null
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
  New-Item -ItemType Directory -Force -Path (Join-Path $i18nPluginRoot "rules") | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $i18nPluginRoot "rules/i18n_hisui_widget_index.md") -Value "# i18n_hisui_widget_index"
  Set-Content -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/i18n-hisui-widget-index.md") -Value @(
    "# Thin Index: i18n-hisui-widget-index",
    "",
    "This file is a thin-index.",
    "",
    '- `.agents/plugins/i18n-iris-plugin/rules/i18n-hisui-widget-index.md`'
  )
  $legacyI18nWrite = & (Join-Path $projectRoot ".agents/scripts/generate-plugin-thin-index.ps1") -PluginPath ".agents/plugins/i18n-iris-plugin" -ProjectRoot $projectRoot -Mode Write | Out-String
  Assert-Contains $legacyI18nWrite "removed" "Write should remove stale legacy i18n thin-index files"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/i18n-hisui-widget-index.md"))) "Legacy i18n HISUI thin-index should be removed"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/i18n_hisui_widget_index.md")) "Current i18n_hisui_widget_index thin-index should be generated"
}
finally {
  if (Test-Path -LiteralPath $projectRoot) {
    Remove-Item -LiteralPath $projectRoot -Recurse -Force
  }
}

Write-Host "update-agents tests passed"
