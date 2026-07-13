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
    "Get-LanguageDisplayName",
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

Assert-True (Test-IrisTemporarySyntaxFailure 'Execute+12^MCP.Temp.1 <SYNTAX>') "Temporary Execute <SYNTAX> was not detected."
Assert-True (-not (Test-IrisTemporarySyntaxFailure '<SYNTAX> in a business routine')) "Unrelated <SYNTAX> must not trigger the fallback."

$script:Calls = [System.Collections.Generic.List[string]]::new()
$script:Mode = "inline-success"
function Invoke-IrisObjectScript($Client, $Tool, [string]$Code) {
    $script:Calls.Add($Code)
    if ($script:Mode -eq "inline-success") { return '{"status":"saved"}' }
    if ($Code -match 'Base64Decode\("') { return 'Execute+7^MCP.Temp.1 <SYNTAX>' }
    if ($script:Mode -eq "fallback-save-failure" -and $Code -match 'Base64Decode\(xmlBase64\)') {
        throw "simulated fallback save failure"
    }
    if ($Code -match 'Base64Decode\(xmlBase64\)') { return '{"status":"saved"}' }
    return '{"status":"ok"}'
}

$base64 = "A" * 13001
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

Write-Host "sync-xml-print-template fallback tests passed."
