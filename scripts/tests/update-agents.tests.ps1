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

  return $root
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "scripts/update-agents.ps1 should exist"

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

  $dryRunOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode DryRun -NoPull | Out-String
  Assert-Contains $dryRunOutput "config-missing-key" "DryRun should report missing config keys"
  Assert-Contains $dryRunOutput "config-deprecated-candidate" "DryRun should report deprecated config candidates"

  $beforeWrite = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")
  Assert-Contains $beforeWrite "projectName: real-project" "DryRun must not overwrite existing config values"
  Assert-True (-not $beforeWrite.Contains("newField: TODO")) "DryRun must not append missing config keys"

  $writeOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode Write -NoPull | Out-String
  Assert-Contains $writeOutput "config-merged-key" "Write should merge missing config keys"
  Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md")) "Write should generate rule thin-index before stale cleanup is tested"

  $afterWrite = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/config/sample_profile.md")
  Assert-Contains $afterWrite "projectName: real-project" "Write must preserve existing config values"
  Assert-Contains $afterWrite "preservedField: manual-value" "Write must preserve manually maintained values"
  Assert-Contains $afterWrite "oldField: legacy-value" "Write must not delete deprecated candidate fields"
  Assert-Contains $afterWrite "newField: TODO" "Write should append missing config keys"

  Remove-Item -LiteralPath (Join-Path $projectRoot ".agents/plugins/sample-plugin/rules/sample_rule.md")
  $staleOutput = & (Join-Path $projectRoot ".agents/scripts/update-agents.ps1") -ProjectRoot $projectRoot -Mode Write -NoPull | Out-String
  if (-not $staleOutput.Contains("removed")) {
    Write-Host $staleOutput
    if (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md")) {
      Write-Host (Get-Content -Raw -Encoding UTF8 -Path (Join-Path $projectRoot ".agents/rules/sample_rule.md"))
    }
  }
  Assert-Contains $staleOutput "removed" "Write should remove stale plugin thin-index files"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".agents/rules/sample_rule.md"))) "Stale thin-index should be removed"
}
finally {
  if (Test-Path -LiteralPath $projectRoot) {
    Remove-Item -LiteralPath $projectRoot -Recurse -Force
  }
}

Write-Host "update-agents tests passed"
