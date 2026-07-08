param(
  [string]$ProjectRoot = "."
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Path))
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$agentsRoot = Join-Path $projectRootFull ".agents"
$hookPath = Join-Path $agentsRoot "hooks/pre-commit"
$checkScriptPath = Join-Path $agentsRoot "scripts/check-functional-diff.ps1"
$targetHooksPath = ".agents/hooks"

if (-not (Test-Path -LiteralPath (Join-Path $projectRootFull ".git"))) {
  throw "ProjectRoot must be a Git repository root: $projectRootFull"
}

if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) {
  throw "Git hook template missing: $hookPath"
}

if (-not (Test-Path -LiteralPath $checkScriptPath -PathType Leaf)) {
  throw "Functional diff check script missing: $checkScriptPath"
}

git -C $projectRootFull config core.hooksPath $targetHooksPath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to set core.hooksPath to $targetHooksPath"
}

[PSCustomObject]@{
  status = "git-hooks-enabled"
  target = $targetHooksPath
  reason = "core.hooksPath configured explicitly by user request"
} | Format-List status, target, reason
