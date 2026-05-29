$ErrorActionPreference = "Stop"

$repo = "https://gitee.com/skyler-cook/imedical.agents.git"
$target = ".agents"
$sparsePaths = @(
  "/docs/**",
  "/rules/**",
  "/skills/**",
  "/plugins/**",
  "/scripts/**"
)

$agentsLocalExcludePatterns = @(
  "/config/",
  "/memory/",
  "/rules/",
  "/skills/",
  "/scripts/"
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

function Set-AgentsSparseCheckout {
  git -C $target sparse-checkout init --no-cone
  $sparsePaths | git -C $target sparse-checkout set --stdin --no-cone
}

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

$entrypointRepairScript = Join-Path $target "scripts/repair-agent-entrypoints.ps1"
if ((Test-Path "AGENTS.md") -and (Test-Path $entrypointRepairScript)) {
  powershell -NoProfile -ExecutionPolicy Bypass -File $entrypointRepairScript -ProjectRoot .
}
elseif (-not (Test-Path "AGENTS.md")) {
  Write-Host "AGENTS.md not found; skip agent entrypoint symlink repair."
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
