param(
  [string]$ProjectRoot = ".",
  [switch]$Staged,
  [switch]$AllowFormatting,
  [int]$FormattingLineThreshold = 80,
  [double]$WhitespaceRatioThreshold = 0.70
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Path))
}

function Get-ChangedLineCount {
  param([string]$DiffText)

  if ([string]::IsNullOrWhiteSpace($DiffText)) {
    return 0
  }

  $count = 0
  foreach ($line in ($DiffText -split "`r?`n")) {
    if (($line.StartsWith("+") -and -not $line.StartsWith("+++")) -or ($line.StartsWith("-") -and -not $line.StartsWith("---"))) {
      $count++
    }
  }
  return $count
}

function Write-BlockedMessage {
  param([object[]]$Problems)

  Write-Output "functional-diff-blocked"
  Write-Output "提交被阻止：检测到疑似无意义空白差异。"
  Write-Output ""
  Write-Output "建议检查："
  Write-Output "  git diff --cached"
  Write-Output "  git diff --cached -w"
  Write-Output ""
  Write-Output "问题文件："
  foreach ($problem in $Problems) {
    Write-Output ("  - {0}: {1}" -f $problem.path, $problem.reason)
  }
  Write-Output ""
  Write-Output "处理方式："
  Write-Output "  1. 如果是误改格式，请还原空白变更后重新 stage。"
  Write-Output "  2. 如果是正常功能修改附近的局部缩进，请缩小 stage 范围后重试。"
  Write-Output "  3. 如果确实需要格式化，请拆成单独 format-only 提交；手动检查可使用 -AllowFormatting。"
}

function Invoke-GitText {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $text = & git -C $script:ProjectRootFullForGit @Arguments 2>$null | Out-String
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return [PSCustomObject]@{
    text = $text
    exitCode = $exitCode
  }
}

$projectRootFull = Resolve-FullPath $ProjectRoot
$script:ProjectRootFullForGit = $projectRootFull
if (-not (Test-Path -LiteralPath (Join-Path $projectRootFull ".git"))) {
  throw "ProjectRoot must be a Git repository root: $projectRootFull"
}

if (-not $Staged) {
  $Staged = $true
}

$diffArgs = @("diff")
if ($Staged) {
  $diffArgs += "--cached"
}

$checkResult = Invoke-GitText -Arguments @($diffArgs + "--check")
if ($checkResult.exitCode -ne 0) {
  Write-Output "functional-diff-blocked"
  Write-Output "git diff --cached --check failed:"
  Write-Output $checkResult.text.Trim()
  exit 1
}

$filesResult = Invoke-GitText -Arguments @($diffArgs + @("--name-only", "--diff-filter=ACMRT"))
if ($filesResult.exitCode -ne 0) {
  throw "Failed to list staged files."
}
$files = @($filesResult.text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

if ($files.Count -eq 0) {
  Write-Output "functional-diff-ok: no staged changes"
  exit 0
}

$problems = New-Object System.Collections.Generic.List[object]

foreach ($file in $files) {
  $numstatResult = Invoke-GitText -Arguments @($diffArgs + @("--numstat", "--", $file))
  if ($numstatResult.exitCode -ne 0) {
    throw "Failed to inspect diff for $file"
  }
  $numstat = $numstatResult.text
  if ($numstat -match '^\s*-\s+-\s+') {
    continue
  }

  $normalDiffResult = Invoke-GitText -Arguments @($diffArgs + @("--", $file))
  if ($normalDiffResult.exitCode -ne 0) {
    throw "Failed to read diff for $file"
  }
  $normalDiff = $normalDiffResult.text
  $ignoreWhitespaceDiffResult = Invoke-GitText -Arguments @($diffArgs + @("-w", "--", $file))
  if ($ignoreWhitespaceDiffResult.exitCode -ne 0) {
    throw "Failed to read whitespace-insensitive diff for $file"
  }
  $ignoreWhitespaceDiff = $ignoreWhitespaceDiffResult.text

  $normalLineCount = Get-ChangedLineCount -DiffText $normalDiff
  $ignoreWhitespaceLineCount = Get-ChangedLineCount -DiffText $ignoreWhitespaceDiff

  if (($normalLineCount -gt 0) -and ($ignoreWhitespaceLineCount -eq 0)) {
    $problems.Add([PSCustomObject]@{
      path = $file
      reason = "whitespace-only"
    })
    continue
  }

  if (-not $AllowFormatting) {
    $whitespaceOnlyLineCount = [Math]::Max(0, $normalLineCount - $ignoreWhitespaceLineCount)
    $whitespaceRatio = if ($normalLineCount -eq 0) { 0 } else { $whitespaceOnlyLineCount / $normalLineCount }
    if (($normalLineCount -ge $FormattingLineThreshold) -and ($whitespaceRatio -ge $WhitespaceRatioThreshold)) {
      $problems.Add([PSCustomObject]@{
        path = $file
        reason = ("formatting-heavy whitespaceRatio={0:P0} changedLines={1} functionalLines={2}" -f $whitespaceRatio, $normalLineCount, $ignoreWhitespaceLineCount)
      })
    }
  }
}

if ($problems.Count -gt 0) {
  Write-BlockedMessage -Problems $problems
  exit 1
}

Write-Output ("functional-diff-ok: checked {0} staged file(s)" -f $files.Count)
