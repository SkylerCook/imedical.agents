$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1"

function Assert-Equal {
  param(
    [object]$Actual,
    [object]$Expected,
    [string]$Message
  )
  if ($Actual -ne $Expected) {
    throw "$Message Expected=[$Expected] Actual=[$Actual]"
  }
}

function Assert-Contains {
  param(
    [string]$Content,
    [string]$Expected,
    [string]$Message
  )
  if (-not $Content.Contains($Expected)) {
    throw "$Message Missing=[$Expected]"
  }
}

function Import-ScriptFunctions {
  param([string]$Path)

  $tokens = $null
  $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) {
    throw "Script parse failed: $($errors[0].Message)"
  }

  $functions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
  }, $true)

  return (($functions | ForEach-Object { $_.Extent.Text }) -join "`n`n")
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("i18n-profile-test-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$profilePath = Join-Path $tempRoot "i18n_project_profile.md"
[System.IO.File]::WriteAllText($profilePath, @"
# i18n 项目适配配置

## 语言目录

| langId | Code | Name |
|---|---|---|
| 1 | EN | English |
| 61 | FR | Français |
"@, [System.Text.Encoding]::UTF8)

try {
  Invoke-Expression (Import-ScriptFunctions $scriptUnderTest)

  $languageDisplayMap = Get-I18nLanguageDisplayMap $profilePath

  Assert-Equal (Get-LanguageDisplayName "EN" $languageDisplayMap) "English" "EN should resolve from profile."
  Assert-Equal (Get-LanguageDisplayName "FR" $languageDisplayMap) "Français" "FR should resolve from profile, not from hard-coded fallback."
  Assert-Equal (Get-LanguageDisplayName "DE" $languageDisplayMap) "DE" "Unknown languages should fall back to upper-case code."

  $xmlBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("<doc />"))
  $applyCode = New-ApplyTemplateCode "SourceTemplate" "SourceTemplate-FR" $xmlBase64 $false "FR" $languageDisplayMap
  Assert-Contains $applyCode 'set targetLanguage="FR"' "Apply code should write the requested language code."
  Assert-Contains $applyCode 'set targetLanguageDisplayName="Français"' "Apply code should write the profile display name."
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

Write-Host "i18n XML print template language tests passed."
