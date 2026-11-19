param(
  [ValidateSet("ClaudeCode", "Codex", "CodeBuddy", "WorkBuddy", "WorkBuddyDonghua", "OpenCode", "Cursor", "GeminiCLI", "GitHubCopilot", "Qoder")]
  [string[]]$RuntimeAdapter = @(),
  [switch]$Agent,
  [ValidatePattern("^[a-f0-9]{40}:[a-f0-9]{64}(,[a-f0-9]{40}:[a-f0-9]{64})*$")]
  [string]$TrustedRuntimeTree,
  [ValidateNotNullOrEmpty()]
  [string]$RepositorySource,
  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$ExpectedRevision,
  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$PublishedRevision
)

$ErrorActionPreference = "Stop"
if ($Agent -and (($RuntimeAdapter.Count -ne 1) -or ($RuntimeAdapter[0] -notin @("Codex", "CodeBuddy", "WorkBuddy")))) { throw "-Agent requires one RuntimeAdapter: Codex, CodeBuddy or WorkBuddy" }

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
  "/plugins/**",
  "/vendor/**",
  "/feedback/**",
  "/hooks/**",
  "/scripts/*.ps1",
  "/scripts/*.js",
  "/scripts/lib/**",
  "/scripts/iris-mcp.js"
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

function Assert-AgentsNodeRuntime {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Install Node.js >=22.5.0 for the .agents toolchain; it is not a business server dependency."
  }
  $nodeVersion = & node -p "process.versions.node"
  if (($LASTEXITCODE -ne 0) -or ([version]$nodeVersion -lt [version]"22.5.0")) {
    throw "Node.js >=22.5.0 is required for the .agents toolchain (not the business server). Install Node.js and retry."
  }
}

function Invoke-AgentsSparseRefresh {
  param([string]$Root, [string[]]$Patterns, [switch]$Initial, [switch]$OnDemand)
  # Read from HEAD: the helper itself may be excluded by legacy sparse rules.
  $source = git -C $Root show HEAD:scripts/refresh-agents-sparse.js
  if ($LASTEXITCODE -ne 0) { throw "Sparse refresh runtime missing from HEAD" }
  Assert-AgentsNodeRuntime
  $extra = @()
  if ($Initial) { $extra += "--initial" }
  if ($OnDemand) { $extra += "--on-demand" }
  & node -e ($source -join "`n") -- --sparse-bootstrap $Root @Patterns @extra
  if ($LASTEXITCODE -ne 0) { throw "Sparse refresh or runtime materialization validation failed" }
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
  param([switch]$Initial)
  Invoke-AgentsSparseRefresh -Root $target -Patterns $sparsePaths -Initial:$Initial -OnDemand:$Initial
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
  Write-Host "After project context is maintained, choose required plugins from the plugins section of .agents/config/project.jsonc."
  Write-Host "When enabling a plugin, initialize dependency plugins first, then run the selected plugin's real initSkill."
}

Assert-AgentsNodeRuntime
Assert-GitSparseCheckoutSubcommandAvailable

if ($RepositorySource -and (-not $ExpectedRevision -or -not $TrustedRuntimeTree)) {
  throw "Offline first installation requires -RepositorySource, -ExpectedRevision, and -TrustedRuntimeTree."
}
if ($ExpectedRevision -and -not $RepositorySource) {
  throw "-ExpectedRevision is only used with -RepositorySource."
}
if ($PublishedRevision -and ($RepositorySource -or -not $TrustedRuntimeTree -or
    -not ($TrustedRuntimeTree.Split(',') | Where-Object { $_.StartsWith($PublishedRevision + ':') }))) {
  throw "-PublishedRevision requires a trusted online first installation."
}
if ($TrustedRuntimeTree -and (Test-Path -LiteralPath $target)) {
  throw "Trusted first installation requires a project without .agents."
}
$previousGitAllowProtocol = $env:GIT_ALLOW_PROTOCOL
$previousGitNoLazyFetch = $env:GIT_NO_LAZY_FETCH
$installDeploymentToken = $null
$installDeploymentEntry = Join-Path $target "scripts/plugin-deploy.js"
if ((-not $TrustedRuntimeTree) -and (Test-Path -LiteralPath $installDeploymentEntry) -and -not $env:IMEDICAL_DEPLOYMENT_LOCK) {
  $lockText = & node $installDeploymentEntry acquire-lock --project-root (Get-Location).Path --pid $PID
  if ($LASTEXITCODE -ne 0) { throw "Cannot acquire capability deployment lock" }
  $installDeploymentToken = ($lockText | ConvertFrom-Json).token
  if ($installDeploymentToken) { $env:IMEDICAL_DEPLOYMENT_LOCK = $installDeploymentToken }
}
try {
if ($RepositorySource) {
  $localSource = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RepositorySource)
  if ($localSource.StartsWith("\\")) { throw "Offline capability source must be on a local filesystem." }
  $sourceItem = Get-Item -LiteralPath $localSource
  if (($sourceItem -isnot [System.IO.DirectoryInfo]) -or ($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw "Offline capability source must be a local bare Git repository."
  }
  $env:GIT_ALLOW_PROTOCOL = "file"
  $env:GIT_NO_LAZY_FETCH = "1"
  $isBare = git -C $localSource rev-parse --is-bare-repository
  if (($LASTEXITCODE -ne 0) -or ($isBare -ne "true")) { throw "Offline capability source must be a local bare Git repository." }
  $bareDirectory = git -C $localSource rev-parse --absolute-git-dir
  if (($LASTEXITCODE -ne 0) -or ([System.IO.Path]::GetFullPath($bareDirectory) -ne [System.IO.Path]::GetFullPath($localSource))) {
    throw "Select the offline bare Git repository itself."
  }
  $promisedObjects = Get-ChildItem -LiteralPath (Join-Path $localSource "objects/pack") -File -Filter "*.promisor" | Select-Object -First 1
  if ((Test-Path -LiteralPath (Join-Path $localSource "shallow")) -or (Test-Path -LiteralPath (Join-Path $localSource "objects/info/alternates")) -or $promisedObjects) {
    throw "Offline capability source must contain its own complete Git history and objects."
  }
  $offlineBranch = git -C $localSource symbolic-ref --quiet HEAD
  if (($LASTEXITCODE -ne 0) -or ($offlineBranch -notlike "refs/heads/*")) { throw "Offline capability source HEAD must identify its release branch." }
  $sourceRevision = git --no-replace-objects -C $localSource rev-parse --verify "HEAD^{commit}"
  if (($LASTEXITCODE -ne 0) -or ($sourceRevision -ne $ExpectedRevision)) { throw "Offline capability revision does not match the approved revision." }
}
if ((-not $TrustedRuntimeTree) -and (Test-Path "$target\.git")) {
  $dirty = git -C $target status --porcelain
  if (($LASTEXITCODE -ne 0) -or $dirty) { throw "Cannot update a dirty or unreadable capability checkout" }
  git -C $target fetch --prune
  if ($LASTEXITCODE -ne 0) { throw "Capability fetch failed" }
  git -C $target pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "Capability pull failed" }
  Set-AgentsSparseCheckout
} else {
  # Verify the tree before executing sparse bootstrap code. The guarded installation
  # publishes the verified clone on the same volume and never overwrites an existing target.
  $cloneTarget = $target
  if ($TrustedRuntimeTree) {
    $cloneTarget = Join-Path (Get-Location).Path (".agents-install-" + [Guid]::NewGuid().ToString("N"))
    $null = New-Item -ItemType Directory -Path $cloneTarget -ErrorAction Stop
  }
  try {
    if ($RepositorySource) {
      git -c core.longpaths=true clone --local --no-hardlinks --no-checkout -- $localSource $cloneTarget
    } elseif ($PublishedRevision) {
      git clone --filter=blob:none --no-checkout --branch master $repo $cloneTarget
    } else {
      git clone --filter=blob:none --no-checkout $repo $cloneTarget
    }
    if ($LASTEXITCODE -ne 0) { throw "Capability clone failed" }
    if ($TrustedRuntimeTree) {
      if ($RepositorySource) {
        $actualRevision = git --no-replace-objects -C $cloneTarget rev-parse HEAD
        if (($LASTEXITCODE -ne 0) -or ($actualRevision -ne $ExpectedRevision)) { throw "Offline capability revision does not match the approved revision." }
        $actualBranch = git -C $cloneTarget symbolic-ref --quiet HEAD
        if (($LASTEXITCODE -ne 0) -or ($actualBranch -ne $offlineBranch)) { throw "Offline capability clone did not retain its release branch." }
        if (Test-Path -LiteralPath (Join-Path $cloneTarget ".git/objects/info/alternates")) { throw "Offline capability clone depends on external Git objects." }
        git --no-replace-objects -c core.longpaths=true -C $cloneTarget fsck --full --strict --no-dangling HEAD | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Offline capability clone is missing valid Git objects." }
        git -C $cloneTarget remote set-url origin $repo
        if ($LASTEXITCODE -ne 0) { throw "Cannot restore the canonical capability remote." }
      } elseif ($PublishedRevision) {
        $publishedHead = git --no-replace-objects -C $cloneTarget rev-parse --verify refs/remotes/origin/master
        if (($LASTEXITCODE -ne 0) -or ($publishedHead -notmatch '^[a-f0-9]{40}$')) { throw "Cannot read the published framework branch." }
        if (-not ($TrustedRuntimeTree.Split(',') | Where-Object { $_.StartsWith($publishedHead + ':') })) {
          git --no-replace-objects -C $cloneTarget merge-base --is-ancestor $PublishedRevision $publishedHead
          if ($LASTEXITCODE -ne 0) { throw "The workbench revision is not reachable from the published framework branch." }
          # Only move the local branch of this new clone. Keep origin/master and its upstream.
          git -C $cloneTarget update-ref refs/heads/master $PublishedRevision $publishedHead
          if ($LASTEXITCODE -ne 0) { throw "Cannot select the approved framework revision." }
        }
      }
      $verifyTree = @'
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const [root, approved] = process.argv.slice(1);
const tree = execFileSync('git', ['--no-replace-objects', '-C', root, 'ls-tree', '-r', '-z', 'HEAD', '--', 'scripts', 'plugins', 'vendor', 'hooks'], { maxBuffer: 4194304 });
const deployed = tree.toString('latin1').split('\0').filter(row => row.slice(row.indexOf('\t') + 1) !== 'scripts/install-agents.ps1');
const revision = execFileSync('git', ['--no-replace-objects', '-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const digest = createHash('sha256').update(deployed.join('\0'), 'latin1').digest('hex');
if (!approved.split(',').includes(revision + ':' + digest)) process.exit(20);
'@
      & node -e $verifyTree -- $cloneTarget $TrustedRuntimeTree
      if ($LASTEXITCODE -ne 0) { throw "Unrecognized framework execution tree. The project was not installed." }
      [System.IO.Directory]::Move($cloneTarget, (Join-Path (Get-Location).Path $target))
    }
  } finally {
    if ($TrustedRuntimeTree -and (Test-Path -LiteralPath $cloneTarget)) {
      Remove-Item -LiteralPath $cloneTarget -Recurse -Force
    }
  }
  Set-AgentsSparseCheckout -Initial
  & node (Join-Path $target "scripts/plugin-deploy.js") configure --project-root (Get-Location).Path --auto-install false
  if ($LASTEXITCODE -ne 0) { throw "Plugin deployment configuration failed" }
}

if (Test-Path "$target\.git") {
  $agentsExcludePath = Join-Path $target ".git/info/exclude"
  foreach ($pattern in $agentsLocalExcludePatterns) {
    Add-LineIfMissing -Path $agentsExcludePath -Line $pattern
  }
}

Remove-MaintenanceOnlyRuntimeSkill

$preferVendorIrisMcpScript = Join-Path $target "scripts/prefer-vendor-iris-mcp.ps1"
if ((Test-Path -LiteralPath (Join-Path $target "plugins/coding-iris-plugin/.agents-plugin/plugin.json")) -and (Test-Path -LiteralPath $preferVendorIrisMcpScript -PathType Leaf)) {
  $preferenceResults = @(& $preferVendorIrisMcpScript -ProjectRoot (Get-Location).Path -ContextRoot $target -Mode Write)
  $preferenceResults | ForEach-Object {
    Write-Host ("{0}: {1} ({2})" -f $_.status, $_.target, $_.reason)
  }
  $preferenceFailures = @($preferenceResults | Where-Object { $_.status -in @(
    "mcp-vendor-executable-missing",
    "mcp-vendor-config-invalid",
    "mcp-vendor-command-ambiguous",
    "mcp-vendor-command-write-failed"
  ) })
  if ($preferenceFailures.Count -gt 0) {
    throw "Bundled iris-agentic-dev preference could not be applied safely. Existing MCP configuration was preserved; resolve the reported status before retrying."
  }
}


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

if ($RuntimeAdapter.Count -gt 0) {
  & (Join-Path $target "scripts/update-agents.ps1") -ProjectRoot (Get-Location).Path -Mode Write -NoPull -RuntimeAdapter $RuntimeAdapter -Agent:$Agent
}

} finally {
  if ($RepositorySource) {
    $env:GIT_ALLOW_PROTOCOL = $previousGitAllowProtocol
    $env:GIT_NO_LAZY_FETCH = $previousGitNoLazyFetch
  }
  if ($installDeploymentToken) {
    & node $installDeploymentEntry release-lock --project-root (Get-Location).Path --token $installDeploymentToken | Out-Null
    Remove-Item Env:IMEDICAL_DEPLOYMENT_LOCK -ErrorAction SilentlyContinue
  }
}
