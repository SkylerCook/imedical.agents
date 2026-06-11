$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/check-frontend-encoding.ps1"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Equals {
  param(
    [object]$Actual,
    [object]$Expected,
    [string]$Message
  )
  if ($Actual -ne $Expected) {
    throw "$Message Actual=[$Actual] Expected=[$Expected]"
  }
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "check-frontend-encoding.ps1 should exist"

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("frontend-encoding-test-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $gb2312 = [System.Text.Encoding]::GetEncoding("gb2312")
  $utf8NoBom = New-Object System.Text.UTF8Encoding ($false)

  $gbFile = Join-Path $testRoot "legacy.js"
  [System.IO.File]::WriteAllText($gbFile, 'var title = "患者姓名";', $gb2312)

  $gbOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $gbFile -ExpectedEncoding gb2312 -ErrorOnMismatch | Out-String
  $gbResult = $gbOutput | ConvertFrom-Json
  Assert-Equals $LASTEXITCODE 0 "GB2312 file should pass expected GB2312 guard"
  Assert-Equals $gbResult.encoding "gb2312" "GB2312 file should be detected as gb2312"
  Assert-Equals $gbResult.status "ok" "GB2312 file should report ok"

  $utf8File = Join-Path $testRoot "drifted.js"
  [System.IO.File]::WriteAllText($utf8File, 'var title = "患者姓名";', $utf8NoBom)

  $utf8Output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $utf8File -ExpectedEncoding gb2312 -ErrorOnMismatch | Out-String
  $utf8Result = $utf8Output | ConvertFrom-Json
  Assert-Equals $LASTEXITCODE 1 "UTF-8 Chinese file should fail expected GB2312 guard"
  Assert-Equals $utf8Result.encoding "utf8" "UTF-8 file should be detected as utf8"
  Assert-Equals $utf8Result.status "error" "UTF-8 file should report error when GB2312 is expected"
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

Write-Host "frontend encoding tests passed"
