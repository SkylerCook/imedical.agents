$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/migrate-frontend-encoding-profile.ps1"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function New-TestProject {
  param([string]$Root)
  New-Item -ItemType Directory -Force -Path (Join-Path $Root ".agents/config") | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $Root ".agents/config/iris_project_profile.md"), @"
# IRIS 项目适配配置

### 编码策略

- 前端编码模式：TODO
"@, [System.Text.UTF8Encoding]::new($false))
}

function Write-EncodedFile {
  param([string]$Path, [string]$Text, [System.Text.Encoding]$Encoding)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [System.IO.File]::WriteAllText($Path, $Text, $Encoding)
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "migration script should exist"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("frontend-encoding-migration-" + [Guid]::NewGuid().ToString("N"))
$utf8 = [System.Text.UTF8Encoding]::new($false)
$gb2312 = [System.Text.Encoding]::GetEncoding(936)

try {
  $hospital = Join-Path $testRoot "hospital"
  New-TestProject -Root $hospital
  Write-EncodedFile -Path (Join-Path $hospital "src/imedical/web/csp/page.csp") -Text '<div>患者姓名</div>' -Encoding $utf8
  $before = [System.IO.File]::ReadAllText((Join-Path $hospital ".agents/config/iris_project_profile.md"))
  $dryOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -ProjectRoot $hospital -AgentsRoot ".agents" -Mode DryRun | Out-String
  Assert-True ($dryOutput.Contains("config-migration-planned")) "hospital DryRun should plan migration"
  Assert-True ([System.IO.File]::ReadAllText((Join-Path $hospital ".agents/config/iris_project_profile.md")) -eq $before) "DryRun must not edit profile"
  $writeOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -ProjectRoot $hospital -AgentsRoot ".agents" -Mode Write | Out-String
  $hospitalProfile = [System.IO.File]::ReadAllText((Join-Path $hospital ".agents/config/iris_project_profile.md"))
  Assert-True ($writeOutput.Contains("config-migration-applied")) "hospital Write should apply migration"
  Assert-True ($hospitalProfile.Contains("前端编码模式：project-utf8")) ("hospital should migrate to project-utf8. Profile=" + $hospitalProfile)
  $hospitalSecond = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -ProjectRoot $hospital -AgentsRoot ".agents" -Mode Write | Out-String
  Assert-True ($hospitalSecond.Contains("config-migration-unchanged")) "confirmed hospital profile should not be overwritten"

  $standard = Join-Path $testRoot "standard"
  New-TestProject -Root $standard
  Write-EncodedFile -Path (Join-Path $standard "src/frontend/dental/csp/page.csp") -Text '<div>患者姓名</div>' -Encoding $gb2312
  $standardOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -ProjectRoot $standard -AgentsRoot ".agents" -Mode Write | Out-String
  $standardProfile = [System.IO.File]::ReadAllText((Join-Path $standard ".agents/config/iris_project_profile.md"))
  Assert-True ($standardOutput.Contains("config-migration-applied")) "standard Write should apply migration"
  Assert-True ($standardProfile.Contains("前端编码模式：standard-gb2312")) "standard should migrate to standard-gb2312"

  $mixed = Join-Path $testRoot "mixed"
  New-TestProject -Root $mixed
  Write-EncodedFile -Path (Join-Path $mixed "src/imedical/web/csp/page.csp") -Text '<div>患者姓名</div>' -Encoding $utf8
  Write-EncodedFile -Path (Join-Path $mixed "src/frontend/dental/csp/page.csp") -Text '<div>患者姓名</div>' -Encoding $gb2312
  $mixedOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -ProjectRoot $mixed -AgentsRoot ".agents" -Mode Write | Out-String
  $mixedProfile = [System.IO.File]::ReadAllText((Join-Path $mixed ".agents/config/iris_project_profile.md"))
  Assert-True ($mixedOutput.Contains("config-migration-applied")) "mixed Write should generate path overrides"
  Assert-True ($mixedProfile.Contains("src/imedical/web`` | project-utf8")) "mixed profile should map hospital root"
  Assert-True ($mixedProfile.Contains("src/frontend/dental`` | standard-gb2312")) "mixed profile should map standard root"
  Assert-True (-not $mixedProfile.Contains("path-specific")) "mixed profile must not introduce a third preset"

  $secondOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -ProjectRoot $mixed -AgentsRoot ".agents" -Mode Write | Out-String
  Assert-True ($secondOutput.Contains("config-migration-unchanged")) "second Write should be idempotent"

  $conflict = Join-Path $testRoot "conflict"
  New-TestProject -Root $conflict
  [System.IO.File]::WriteAllText((Join-Path $conflict ".agents/config/iris_project_profile.md"), "- 前端编码模式：standard-gb2312`n", [System.Text.UTF8Encoding]::new($false))
  Write-EncodedFile -Path (Join-Path $conflict "src/imedical/web/csp/page.csp") -Text '<div>患者姓名</div>' -Encoding $utf8
  $conflictBefore = [System.IO.File]::ReadAllText((Join-Path $conflict ".agents/config/iris_project_profile.md"))
  $conflictOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest -ProjectRoot $conflict -AgentsRoot ".agents" -Mode Write | Out-String
  Assert-True ($conflictOutput.Contains("config-migration-conflict")) "configured mode and byte validation mismatch should conflict"
  Assert-True ([System.IO.File]::ReadAllText((Join-Path $conflict ".agents/config/iris_project_profile.md")) -eq $conflictBefore) "conflict must not rewrite existing profile"
}
finally {
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

Write-Host "frontend encoding migration tests passed"
