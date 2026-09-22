$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$scriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/migrate-demand-delivery-profile.ps1"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("demand-delivery-profile-" + [Guid]::NewGuid().ToString("N"))

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function New-Fixture {
  param([string]$Name, [string]$IrisContext, [string]$ProjectContext = "")
  $root = Join-Path $testRoot $Name
  $config = Join-Path $root ".agents/config"
  New-Item -ItemType Directory -Force -Path $config | Out-Null
  Set-Content -Encoding UTF8 -LiteralPath (Join-Path $config "iris_project_profile.md") -Value ("# IRIS 项目适配配置`n`n## 通用配置`n`n- 工程类型：$IrisContext`n")
  if ($ProjectContext) {
    Set-Content -Encoding UTF8 -LiteralPath (Join-Path $config "project_context_profile.md") -Value ("# 项目上下文配置`n`n- 项目用途：$ProjectContext`n")
  }
  Set-Content -Encoding UTF8 -LiteralPath (Join-Path $root "AGENTS.md") -Value "# Project`n`n## Skill 路由`n`n- 标版/项目需求提交使用 iris-demand-commit。"
  return $root
}

function Invoke-Migration {
  param([string]$Root, [string]$Mode)
  $output = & $scriptUnderTest -ProjectRoot $Root -AgentsRoot ".agents" -Mode $Mode | Out-String
  return @($output.Trim() | ConvertFrom-Json)
}

try {
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

  $standard = New-Fixture -Name "standard" -IrisContext "通用多产品 HIS 组合工程"
  $dryRun = Invoke-Migration -Root $standard -Mode "DryRun"
  Assert-True ($dryRun[0].status -eq "config-migration-planned") "standard context should be planned"
  Assert-True (-not (([System.IO.File]::ReadAllText((Join-Path $standard ".agents/config/iris_project_profile.md"), [System.Text.Encoding]::UTF8)) -match "默认需求交付类型")) "DryRun must not write"
  $applied = Invoke-Migration -Root $standard -Mode "Write"
  Assert-True ($applied[0].status -eq "config-migration-applied") "standard context should be applied"
  Assert-True (([System.IO.File]::ReadAllText((Join-Path $standard ".agents/config/iris_project_profile.md"), [System.Text.Encoding]::UTF8)) -match "默认需求交付类型：standard") "standard value should be written"
  $unchanged = Invoke-Migration -Root $standard -Mode "Write"
  Assert-True ($unchanged[0].status -eq "config-migration-unchanged") "second write should be idempotent"

  $project = New-Fixture -Name "project" -IrisContext "医生站工程" -ProjectContext "海南一龄医院需求处理"
  Invoke-Migration -Root $project -Mode "Write" | Out-Null
  Assert-True (([System.IO.File]::ReadAllText((Join-Path $project ".agents/config/iris_project_profile.md"), [System.Text.Encoding]::UTF8)) -match "默认需求交付类型：project") "hospital demand should resolve project"

  $agentsIntro = New-Fixture -Name "agents-intro" -IrisContext "医生站工程"
  Set-Content -Encoding UTF8 -LiteralPath (Join-Path $agentsIntro "AGENTS.md") -Value "# Project`n`n## 项目简介`n`n本工程是通用产品标准版源码。`n`n## Skill 路由`n`n- 项目版需求提交规则。"
  Invoke-Migration -Root $agentsIntro -Mode "Write" | Out-Null
  Assert-True (([System.IO.File]::ReadAllText((Join-Path $agentsIntro ".agents/config/iris_project_profile.md"), [System.Text.Encoding]::UTF8)) -match "默认需求交付类型：standard") "only project intro should contribute AGENTS evidence"

  $unknown = New-Fixture -Name "unknown" -IrisContext "医生站工程"
  $review = Invoke-Migration -Root $unknown -Mode "Write"
  Assert-True ($review[0].status -eq "config-migration-review-required") "unknown context should require review"
  Assert-True ($review[0].reason -match "请确认该工程默认处理 standard") "TODO should prompt the user"
  Assert-True (([System.IO.File]::ReadAllText((Join-Path $unknown ".agents/config/iris_project_profile.md"), [System.Text.Encoding]::UTF8)) -match "默认需求交付类型：TODO") "unknown context should write TODO"

  $conflict = New-Fixture -Name "conflict" -IrisContext "通用产品标准版" -ProjectContext "医院项目实施"
  $conflictResult = Invoke-Migration -Root $conflict -Mode "Write"
  Assert-True ($conflictResult[0].status -eq "config-migration-review-required") "conflicting context should require review"

  $existing = New-Fixture -Name "existing" -IrisContext "通用产品标准版"
  Add-Content -Encoding UTF8 -LiteralPath (Join-Path $existing ".agents/config/iris_project_profile.md") -Value "- 默认需求交付类型：project"
  Invoke-Migration -Root $existing -Mode "Write" | Out-Null
  Assert-True (([System.IO.File]::ReadAllText((Join-Path $existing ".agents/config/iris_project_profile.md"), [System.Text.Encoding]::UTF8)) -match "默认需求交付类型：project") "valid existing value must win"

  Write-Output "demand delivery profile migration tests passed"
}
finally {
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
