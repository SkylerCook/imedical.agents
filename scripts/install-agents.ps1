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

if (Test-Path "$target\.git") {
  git -C $target fetch --prune
  git -C $target pull --ff-only
} else {
  git clone --filter=blob:none --no-checkout $repo $target
  git -C $target sparse-checkout init --no-cone
  $sparsePaths | git -C $target sparse-checkout set --stdin --no-cone
  git -C $target checkout
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
