
param(
    [string]$ScriptPath = (Join-Path $PSScriptRoot "..\sync-xml-print-template.ps1")
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Import-ScriptFunctions([string]$Path, [string[]]$Names) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
        throw "PowerShell parse failed: $($errors[0].Message)"
    }

    foreach ($name in $Names) {
        $functionAst = @($ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
        }, $true))[0]
        if ($null -eq $functionAst) { throw "Function not found: $name" }
        $definition = [regex]::Replace(
            $functionAst.Extent.Text,
            '^function\s+' + [regex]::Escape($name),
            "function script:$name",
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )
        Invoke-Expression $definition
    }
}

Import-ScriptFunctions $ScriptPath @(
    "Escape-OsString",
    "ConvertFrom-JsonArray",
    "New-ExportTemplatesCode",
    "Invoke-ExportTemplates",
    "Get-LanguageDisplayName",
    "Set-ProcessEnvironmentValue",
    "Test-IrisTemporarySyntaxFailure",
    "New-ApplyTemplateCodeBody",
    "New-ApplyTemplateCode",
    "New-InitializeTemplateChunksCode",
    "New-StageTemplateChunkCode",
    "New-CleanupTemplateChunksCode",
    "New-ApplyTemplateFromChunksCode",
    "Invoke-ChunkedTemplateApply",
    "Invoke-TemplateApplyWithFallback"
)

$processStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
Set-ProcessEnvironmentValue $processStartInfo "I18N_AGENT_TEST_ENV" "ok"
Assert-True ($processStartInfo.EnvironmentVariables["I18N_AGENT_TEST_ENV"] -eq "ok") "ProcessStartInfo environment fallback is not compatible with Windows PowerShell."

Assert-True (Test-IrisTemporarySyntaxFailure 'Execute+12^MCP.Temp.1 <SYNTAX>') "Temporary Execute <SYNTAX> was not detected."
Assert-True (-not (Test-IrisTemporarySyntaxFailure '<SYNTAX> in a business routine')) "Unrelated <SYNTAX> must not trigger the fallback."

$script:Calls = [System.Collections.Generic.List[string]]::new()
$script:Mode = "inline-success"
function Invoke-IrisObjectScript($Client, $Tool, [string]$Code) {
    $script:Calls.Add($Code)
    if ($script:Mode -eq "inline-success") { return '{"status":"saved"}' }
    if ($Code -match 'Base64Decode\("') { return 'Execute+7^MCP.Temp.1 <SYNTAX>' }
    if ($script:Mode -eq "fallback-save-failure" -and $Code -match 'CopyFrom\(xmlStream\)') {
        throw "simulated fallback save failure"
    }
    if ($Code -match 'CopyFrom\(xmlStream\)') { return '{"status":"saved"}' }
    return '{"status":"ok"}'
}

$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(("abc" * 600)))
$inline = Invoke-TemplateApplyWithFallback $null $null "Source" "Source-EN" $base64 $false "EN" @{} 6000
Assert-True (-not $inline.UsedFallback) "Successful inline apply must not use fallback."
Assert-True ($script:Calls.Count -eq 1) "Successful inline apply must issue exactly one save call."

$script:Calls.Clear()
$script:Mode = "inline-syntax"
$fallback = Invoke-TemplateApplyWithFallback $null $null "Source" "Source-EN" $base64 $false "EN" @{} 6000
Assert-True $fallback.UsedFallback "Temporary Execute <SYNTAX> must activate chunked fallback."
Assert-True (@($script:Calls | Where-Object { $_ -match 'Base64Decode\("' }).Count -eq 1) "Equivalent long inline payload must not be retried."
Assert-True (@($script:Calls | Where-Object { $_ -match '\^CacheTemp\("i18nXmlPrintTemplateSync"' }).Count -eq 6) "Fallback must initialize, stage three chunks, save, and clean up."
Assert-True ($script:Calls[-1] -match '^kill \^CacheTemp') "Temporary chunks must be cleaned after fallback."
Assert-True ($fallback.Json -match '"saved"') "Fallback save result was not returned."

$script:Calls.Clear()
$script:Mode = "fallback-save-failure"
$failedAsExpected = $false
try {
    $null = Invoke-TemplateApplyWithFallback $null $null "Source" "Source-EN" $base64 $false "EN" @{} 6000
} catch {
    $failedAsExpected = $_.Exception.Message -match 'simulated fallback save failure'
}
Assert-True $failedAsExpected "Fallback save failure must be propagated."
Assert-True ($script:Calls[-1] -match '^kill \^CacheTemp') "Temporary chunks must be cleaned when fallback save fails."

$stages = @($script:Calls | Where-Object { $_ -match 'set \^CacheTemp.*?,\d+\)="' })
$rebuilt = ($stages | ForEach-Object {
    $encoded = [regex]::Match($_, 'set \^CacheTemp.*?,\d+\)="([^"]*)"').Groups[1].Value
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
}) -join ''
Assert-True ($rebuilt -ceq ('abc' * 600)) "Staged content must round trip exactly."
$emptyRejected = $false
try { ConvertFrom-JsonArray '' } catch { $emptyRejected = $true }
Assert-True $emptyRejected "Empty output must not mean missing template."
$script:Calls.Clear()
$script:Mode = 'inline-syntax'
$unicode = ('中文😀' * 3000)
$null = Invoke-TemplateApplyWithFallback $null $null 'Source' 'Source-EN' ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($unicode))) $false 'EN' @{} 601
$rebuilt = (@($script:Calls | Where-Object { $_ -match 'set \^CacheTemp.*?,\d+\)="' }) | ForEach-Object {
    $encoded = [regex]::Match($_, 'set \^CacheTemp.*?,\d+\)="([^"]*)"').Groups[1].Value
    [Text.UTF8Encoding]::new($false, $true).GetString([Convert]::FromBase64String($encoded))
}) -join ''
Assert-True ($rebuilt -ceq $unicode) "Unicode chunks must preserve surrogate pairs and UTF-8 boundaries."
function Invoke-IrisObjectScript($Client, $Tool, [string]$Code) {
    if ($Code -match 'write "([a-f0-9]{32})",id') {
        $m = $Matches[1]
        return $m + '42' + $m + '描述' + $m + 'EN' + $m + 'Source' + $m + '<xml>中文</xml>' + $m
    }
    return ''
}
$export = @(ConvertFrom-JsonArray (Invoke-ExportTemplates $null $null @('Source')))
Assert-True ($export[0].exists -eq 1 -and $export[0].xml -ceq '<xml>中文</xml>') "Empty JSON must use compatibility export."
Write-Host "sync-xml-print-template fallback tests passed."
