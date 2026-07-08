$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "scripts/check-functional-diff.ps1"

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

function New-GitFixture {
  $root = Join-Path ([System.IO.Path]::GetTempPath()) ("functional-diff-test-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  git -C $root init | Out-Null
  git -C $root config user.email "test@example.invalid" | Out-Null
  git -C $root config user.name "Test User" | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $root "sample.js") -Value @(
    "function total(items) {",
    "  return items.length;",
    "}",
    ""
  )
  git -C $root add sample.js | Out-Null
  git -C $root commit -m "init" | Out-Null
  return $root
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "scripts/check-functional-diff.ps1 should exist"

$normalProject = New-GitFixture
try {
  Set-Content -Encoding UTF8 -Path (Join-Path $normalProject "sample.js") -Value @(
    "function total(items) {",
    "  if (!items) {",
    "    return 0;",
    "  }",
    "",
    "  return items.length;",
    "}",
    ""
  )
  git -C $normalProject add sample.js | Out-Null
  $output = & $scriptUnderTest -ProjectRoot $normalProject -Staged | Out-String
  Assert-Contains $output "functional-diff-ok" "Normal functional edits with local spacing should pass"
}
finally {
  Remove-Item -LiteralPath $normalProject -Recurse -Force
}

$whitespaceProject = New-GitFixture
try {
  Set-Content -Encoding UTF8 -Path (Join-Path $whitespaceProject "sample.js") -Value @(
    "function total(items) {",
    "    return items.length;",
    "}",
    ""
  )
  git -C $whitespaceProject add sample.js | Out-Null
  $output = & $scriptUnderTest -ProjectRoot $whitespaceProject -Staged 2>&1 | Out-String
  Assert-True ($LASTEXITCODE -ne 0) "Whitespace-only staged edits should fail"
  Assert-Contains $output "functional-diff-blocked" "Failure should explain that the commit was blocked"
  Assert-Contains $output "sample.js" "Failure should name the affected file"
}
finally {
  Remove-Item -LiteralPath $whitespaceProject -Recurse -Force
}

$formatProject = New-GitFixture
try {
  $lines = @()
  for ($i = 1; $i -le 90; $i++) {
    $lines += ("const value{0} = {0};" -f $i)
  }
  Set-Content -Encoding UTF8 -Path (Join-Path $formatProject "legacy.js") -Value $lines
  git -C $formatProject add legacy.js | Out-Null
  git -C $formatProject commit -m "add legacy" | Out-Null
  $formatted = @()
  for ($i = 1; $i -le 90; $i++) {
    $formatted += ("  const value{0} = {0};" -f $i)
  }
  $formatted += "const changed = true;"
  Set-Content -Encoding UTF8 -Path (Join-Path $formatProject "legacy.js") -Value $formatted
  git -C $formatProject add legacy.js | Out-Null
  $output = & $scriptUnderTest -ProjectRoot $formatProject -Staged 2>&1 | Out-String
  Assert-True ($LASTEXITCODE -ne 0) "Large formatting-heavy staged edits should fail"
  Assert-Contains $output "formatting-heavy" "Failure should identify formatting-heavy risk"
  $allowOutput = & $scriptUnderTest -ProjectRoot $formatProject -Staged -AllowFormatting | Out-String
  Assert-Contains $allowOutput "functional-diff-ok" "AllowFormatting should allow explicit manual format checks"
}
finally {
  Remove-Item -LiteralPath $formatProject -Recurse -Force
}

Write-Host "check-functional-diff tests passed"
