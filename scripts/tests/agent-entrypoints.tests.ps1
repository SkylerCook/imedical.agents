$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$checker = Join-Path $repoRoot 'scripts/check-agent-entrypoints.ps1'
$repairer = Join-Path $repoRoot 'scripts/repair-agent-entrypoints.ps1'
$testBase = Join-Path ([IO.Path]::GetTempPath()) 'codex'
$testRoot = Join-Path $testBase ('agent-entrypoints-test-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)
  if ($Actual -ne $Expected) { throw "$Message (actual=$Actual, expected=$Expected)" }
}

function New-TestLink {
  param([string]$Path, [string]$Target)
  & cmd.exe /c mklink "$Path" "$Target" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cannot create test link: $Path" }
}

New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
try {
  $correctRoot = Join-Path $testRoot 'correct'
  New-Item -ItemType Directory -Path $correctRoot | Out-Null
  Set-Content -Encoding UTF8 -LiteralPath (Join-Path $correctRoot 'AGENTS.md') -Value '# Agent entry'
  New-TestLink -Path (Join-Path $correctRoot 'CLAUDE.md') -Target '.\AGENTS.md'
  New-TestLink -Path (Join-Path $correctRoot 'CODEBUDDY.md') -Target 'AGENTS.md'
  $claudeBefore = (Get-Item -Force -LiteralPath (Join-Path $correctRoot 'CLAUDE.md')).Target
  Assert-Equal $claudeBefore '.\AGENTS.md' 'Test link must retain the Windows relative target'

  $checked = @(& $checker -ProjectRoot $correctRoot)
  Assert-Equal (@($checked | Where-Object status -eq 'ok').Count) 2 'Checker must accept both equivalent relative targets'
  $repaired = @(& $repairer -ProjectRoot $correctRoot)
  Assert-Equal (@($repaired | Where-Object status -eq 'ok').Count) 2 'Repairer must preserve correct links'
  Assert-Equal (Get-Item -Force -LiteralPath (Join-Path $correctRoot 'CLAUDE.md')).Target $claudeBefore 'Repairer must not replace the existing link'
  if (Test-Path -LiteralPath (Join-Path $correctRoot 'CLAUDE.md.bak')) { throw 'Repairer backed up a correct link' }

  $wrongRoot = Join-Path $testRoot 'wrong'
  New-Item -ItemType Directory -Path $wrongRoot | Out-Null
  Set-Content -Encoding UTF8 -LiteralPath (Join-Path $wrongRoot 'AGENTS.md') -Value '# Agent entry'
  Set-Content -Encoding UTF8 -LiteralPath (Join-Path $wrongRoot 'OTHER.md') -Value '# Other entry'
  New-TestLink -Path (Join-Path $wrongRoot 'CLAUDE.md') -Target 'OTHER.md'
  $wrong = @(& $checker -ProjectRoot $wrongRoot -EntryPoints @('CLAUDE.md'))
  Assert-Equal $wrong[0].status 'wrong-target' 'Checker must reject a different target'
  $fixed = @(& $repairer -ProjectRoot $wrongRoot -EntryPoints @('CLAUDE.md'))
  Assert-Equal $fixed[0].status 'repaired' 'Repairer must still fix a different target'
  if (-not (Test-Path -LiteralPath (Join-Path $wrongRoot 'CLAUDE.md.bak'))) { throw 'Wrong target backup missing' }
  $after = @(& $checker -ProjectRoot $wrongRoot -EntryPoints @('CLAUDE.md'))
  Assert-Equal $after[0].status 'ok' 'Repaired link must pass the checker'

  Write-Output 'agent-entrypoints-ok: equivalent targets preserved; wrong target repaired'
}
finally {
  foreach ($name in @('correct', 'wrong')) {
    $caseRoot = Join-Path $testRoot $name
    foreach ($link in @('CLAUDE.md', 'CODEBUDDY.md', 'CLAUDE.md.bak')) {
      $linkPath = Join-Path $caseRoot $link
      if (Test-Path -LiteralPath $linkPath) { Remove-Item -LiteralPath $linkPath -Force }
    }
  }
  $fullBase = [IO.Path]::GetFullPath($testBase)
  $fullRoot = [IO.Path]::GetFullPath($testRoot)
  if (-not $fullRoot.StartsWith($fullBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
  if ((Get-Item -LiteralPath $fullRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Test root is a link' }
  Remove-Item -LiteralPath $fullRoot -Recurse -Force
}
