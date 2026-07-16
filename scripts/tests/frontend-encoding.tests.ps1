$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/check-frontend-encoding.ps1"
$convertScriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/convert-gb2312-upload.ps1"
$promoteScriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/promote-frontend-export.ps1"

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
Assert-True (Test-Path -LiteralPath $convertScriptUnderTest -PathType Leaf) "convert-gb2312-upload.ps1 should exist"
Assert-True (Test-Path -LiteralPath $promoteScriptUnderTest -PathType Leaf) "promote-frontend-export.ps1 should exist"

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

  $utf8AcceptedOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $utf8File -ExpectedEncoding utf8 -ErrorOnMismatch | Out-String
  $utf8AcceptedResult = $utf8AcceptedOutput | ConvertFrom-Json
  Assert-Equals $LASTEXITCODE 0 "UTF-8 file should pass expected UTF-8 guard"
  Assert-Equals $utf8AcceptedResult.status "ok" "UTF-8 file should report ok"

  $gbRejectedOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $gbFile -ExpectedEncoding utf8 -ErrorOnMismatch | Out-String
  $gbRejectedResult = $gbRejectedOutput | ConvertFrom-Json
  Assert-Equals $LASTEXITCODE 1 "GB2312 file should fail expected UTF-8 guard"
  Assert-Equals $gbRejectedResult.status "error" "GB2312 file should report mismatch"

  $asciiFile = Join-Path $testRoot "ascii.js"
  [System.IO.File]::WriteAllText($asciiFile, 'var title = "patient";', $utf8NoBom)
  $asciiOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $asciiFile -ExpectedEncoding gb2312 -ErrorOnMismatch | Out-String
  $asciiResult = $asciiOutput | ConvertFrom-Json
  Assert-Equals $LASTEXITCODE 0 "ASCII-only file should be ambiguous rather than a hard mismatch"
  Assert-Equals $asciiResult.encoding "ascii" "ASCII-only file should report ascii"
  Assert-Equals $asciiResult.status "warning" "ASCII-only file should report warning"

  $utf16File = Join-Path $testRoot "utf16.js"
  [System.IO.File]::WriteAllText($utf16File, 'var title = "患者姓名";', [System.Text.Encoding]::Unicode)
  $unknownOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $utf16File -ExpectedEncoding utf8 -ErrorOnMismatch | Out-String
  $unknownResult = $unknownOutput | ConvertFrom-Json
  Assert-Equals $LASTEXITCODE 1 "UTF-16 file should be rejected as unknown"
  Assert-Equals $unknownResult.encoding "unknown" "UTF-16 file should report unknown"

  $convertFile = Join-Path $testRoot "convert.js"
  [System.IO.File]::WriteAllText($convertFile, 'var title = "患者姓名";', $utf8NoBom)
  $convertOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $convertScriptUnderTest -Files $convertFile | Out-String
  $convertResult = $convertOutput | ConvertFrom-Json
  Assert-Equals $LASTEXITCODE 0 "Representable UTF-8 Chinese should convert to GB2312"
  Assert-True (Test-Path -LiteralPath $convertResult.uploadPath -PathType Leaf) "Converted GB2312 output should exist"
  $convertedCheck = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $convertResult.uploadPath -ExpectedEncoding gb2312 -ErrorOnMismatch | Out-String
  Assert-Equals $LASTEXITCODE 0 "Converted output should pass GB2312 guard"

  $emojiFile = Join-Path $testRoot "emoji.js"
  $emojiText = 'var title = "' + [char]0x60A3 + [char]0x8005 + [char]::ConvertFromUtf32(0x1F600) + '";'
  [System.IO.File]::WriteAllText($emojiFile, $emojiText, $utf8NoBom)
  $conversionFailed = $false
  try { $null = & $convertScriptUnderTest -Files $emojiFile }
  catch { $conversionFailed = $true }
  Assert-True $conversionFailed "Unrepresentable characters must fail GB2312 conversion"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot "emoji.gb2312.js"))) "Failed conversion must not leave a GB2312 output"

  $promotedFile = Join-Path $testRoot "promoted.js"
  $promoteOutput = & $promoteScriptUnderTest -StagedFile $convertFile -DestinationFile $promotedFile -ExpectedEncoding gb2312 | Out-String
  Assert-True ($promoteOutput.Contains('"promoted":true')) "Staging promotion should report success"
  $promotedCheck = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -Files $promotedFile -ExpectedEncoding gb2312 -ErrorOnMismatch | Out-String
  Assert-Equals $LASTEXITCODE 0 "Promoted standard frontend should pass GB2312 guard"

  $failedDestination = Join-Path $testRoot "emoji-promoted.js"
  $promoteFailed = $false
  try { $null = & $promoteScriptUnderTest -StagedFile $emojiFile -DestinationFile $failedDestination -ExpectedEncoding gb2312 }
  catch { $promoteFailed = $true }
  Assert-True $promoteFailed "Staging promotion must fail for unrepresentable characters"
  Assert-True (-not (Test-Path -LiteralPath $failedDestination)) "Failed staging promotion must keep destination absent"
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

Write-Host "frontend encoding tests passed"
