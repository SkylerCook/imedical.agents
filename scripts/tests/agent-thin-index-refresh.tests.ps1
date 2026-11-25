$ErrorActionPreference = 'Stop'
$generator = Join-Path $PSScriptRoot '../generate-agent-thin-index.ps1'
$tempBase = if ($env:AGENTS_TEST_TEMP) { $env:AGENTS_TEST_TEMP } else { [IO.Path]::GetTempPath() }
$root = Join-Path $tempBase ('agent-' + [guid]::NewGuid().ToString('N').Substring(0, 16))
$capability = Join-Path $root 'capability'
$context = Join-Path $root 'context'
$source = Join-Path $capability 'agents/example-agent/AGENT.md'
$target = Join-Path $context 'skills/example-agent/SKILL.md'
$utf8 = [Text.UTF8Encoding]::new($false)

function Assert-Test([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Invoke-Generation {
    param([string]$Mode = 'Write', [switch]$Force)
    & $generator -ProjectRoot $root -ContextRoot $context -CapabilityRoot $capability -Mode $Mode -Force:$Force | Out-String
}
function Assert-Status([string]$Output, [string]$Status) {
    Assert-Test ($Output -match ('(?m)^status\s*:\s*{0}[ \t]*\r?$' -f [regex]::Escape($Status))) "Expected status $Status, got $Output"
}

New-Item -ItemType Directory -Path $root | Out-Null
try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $source) | Out-Null
    [IO.File]::WriteAllText($source, "---`nname: example-agent`n---`n# Example", $utf8)
    Assert-Status (Invoke-Generation) 'generated'
    $original = [IO.File]::ReadAllText($target)
    Assert-Test ($original.Contains('.agents/config/project.jsonc')) 'Current index must route to unified configuration'

    $legacy = $original.Replace('.agents/config/project.jsonc', '.agents/config/plugin_profile.md').Replace("`r`n", "`n").Replace("`n", "`r`n")
    [IO.File]::WriteAllText($target, $legacy, [Text.UTF8Encoding]::new($true))
    $legacyHash = (Get-FileHash -LiteralPath $target).Hash
    Assert-Status (Invoke-Generation -Mode DryRun) 'thin-index-stale'
    Assert-Test ((Get-FileHash -LiteralPath $target).Hash -eq $legacyHash) 'Preview must preserve legacy bytes'
    Assert-Status (Invoke-Generation) 'updated'
    Assert-Test ([IO.File]::ReadAllText($target) -ceq $original) 'Write must replace the legacy configuration route'

    [IO.File]::SetLastWriteTimeUtc($target, [datetime]::UtcNow.AddDays(-1))
    $before = [IO.File]::GetLastWriteTimeUtc($target)
    Assert-Status (Invoke-Generation) 'unchanged'
    Assert-Test ([IO.File]::GetLastWriteTimeUtc($target) -eq $before) 'Repeated generation must not write the index'

    [IO.File]::WriteAllText($target, $original + [Environment]::NewLine + 'Local instructions', $utf8)
    $customHash = (Get-FileHash -LiteralPath $target).Hash
    Assert-Status (Invoke-Generation) 'thin-index-conflict'
    Assert-Status (Invoke-Generation -Force) 'thin-index-conflict'
    Assert-Test ((Get-FileHash -LiteralPath $target).Hash -eq $customHash) 'Neither normal nor forced generation may replace extra content'

    Write-Host 'agent thin-index refresh tests passed'
} finally {
    $resolved = Get-Item -LiteralPath $root -Force
    if (($resolved.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ([IO.Path]::GetFullPath($root) -ne $resolved.FullName)) {
        throw 'Unexpected cleanup path'
    }
    Remove-Item -LiteralPath $resolved.FullName -Recurse -Force
    Assert-Test (-not (Test-Path -LiteralPath $root)) 'Test directory must be removed'
}
