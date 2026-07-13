$ErrorActionPreference = "Stop"

$repo = "https://gitee.com/skyler-cook/imedical.agents.git"
$target = ".agents"
$minimumGitSparseCheckoutVersion = [version]"2.25.0"

# Only deploy runtime capability directories into business projects.
# Repository-maintainer memory under root /memory/ is intentionally excluded.
$sparsePaths = @(
  "/agents/**",
  "/docs/**",
  "/workflows/**",
  "/rules/**",
  "/skills/**",
  "!/skills/agent-kit-maintenance/",
  "!/skills/agent-kit-maintenance/**",
  "/plugins/**",
  "/vendor/**",
  "/feedback/**",
  "/hooks/**",
  "/scripts/*.ps1"
)

# Hide project-local generated layers in the .agents Git repository.
# This does not hide tracked files from a manual full clone; sparse checkout does that.
$agentsLocalExcludePatterns = @(
  "/config/",
  "/memory/",
  "/rules/",
  "/skills/",
  "/scripts/"
  "/work/"
)

function Add-LineIfMissing {
  param(
    [string]$Path,
    [string]$Line
  )

  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  if (-not (Test-Path $Path)) {
    New-Item -ItemType File -Force -Path $Path | Out-Null
  }

  $exists = Select-String -Path $Path -Pattern ("^\s*" + [regex]::Escape($Line) + "\s*$") -Quiet
  if (-not $exists) {
    Add-Content -Path $Path -Value $Line
  }
}

function Assert-GitSparseCheckoutSubcommandAvailable {
  $versionText = git --version
  if ($LASTEXITCODE -ne 0) {
    throw "git is required but could not be executed."
  }

  $match = [System.Text.RegularExpressions.Regex]::Match($versionText, "(\d+)\.(\d+)\.(\d+)")
  if (-not $match.Success) {
    throw "Could not parse git version from: $versionText"
  }

  $gitVersion = [version]$match.Groups[0].Value
  if ($gitVersion -lt $minimumGitSparseCheckoutVersion) {
    throw ("Git {0} is installed. imedical.agents install/update requires Git {1} or newer because it uses 'git sparse-checkout'. Please upgrade Git for Windows and rerun this script." -f $gitVersion, $minimumGitSparseCheckoutVersion)
  }
}

function Set-AgentsSparseCheckout {
  git -C $target sparse-checkout init --no-cone
  $sparsePaths | git -C $target sparse-checkout set --stdin --no-cone
}

function Remove-MaintenanceOnlyRuntimeSkill {
  $maintenanceSkillPath = Join-Path $target "skills/agent-kit-maintenance"
  if (Test-Path -LiteralPath $maintenanceSkillPath) {
    Remove-Item -LiteralPath $maintenanceSkillPath -Recurse -Force
    Write-Host "Removed maintenance-only skill residue: .agents/skills/agent-kit-maintenance"
  }
}

function Write-PostInstallGuidance {
  Write-Host ""
  Write-Host "imedical.agents installed or updated."
  Write-Host "Next step: ask the user or their agent to run /project-context-maintenance."
  Write-Host "If the slash command is unavailable, read and follow:"
  Write-Host ".agents/plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md"
  Write-Host "After project context is maintained, choose required plugins from .agents/config/plugin_profile.md."
  Write-Host "When enabling a plugin, initialize dependency plugins first, then run the selected plugin's real initSkill."
}

Assert-GitSparseCheckoutSubcommandAvailable

if (Test-Path "$target\.git") {
  git -C $target fetch --prune
  git -C $target pull --ff-only
  Set-AgentsSparseCheckout
} else {
  git clone --filter=blob:none --no-checkout $repo $target
  Set-AgentsSparseCheckout
  git -C $target checkout
}

if (Test-Path "$target\.git") {
  $agentsExcludePath = Join-Path $target ".git/info/exclude"
  foreach ($pattern in $agentsLocalExcludePatterns) {
    Add-LineIfMissing -Path $agentsExcludePath -Line $pattern
  }
}

Remove-MaintenanceOnlyRuntimeSkill

if (Test-Path "AGENTS.md") {
  Write-Host "AGENTS.md found. CLAUDE.md and CODEBUDDY.md are optional compatibility symlinks; install-agents.ps1 does not create, copy, or repair them automatically."
}
else {
  Write-Warning "AGENTS.md not found. Continue installing .agents; create or update the project entrypoint later through project-context-maintenance."
}

if (Test-Path ".git") {
  $ignorePattern = "^\s*\.agents/\s*$"
  $hasIgnore = $false

  if (Test-Path ".gitignore") {
    $hasIgnore = Select-String -Path ".gitignore" -Pattern $ignorePattern -Quiet
  }

  if (-not $hasIgnore) {
    Add-Content -Path ".gitignore" -Value ".agents/"
  }
}

Write-PostInstallGuidance
