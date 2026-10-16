$ErrorActionPreference = 'Stop'
$generator = Join-Path $PSScriptRoot '../generate-plugin-thin-index.ps1'
$tempBase = if ($env:AGENTS_TEST_TEMP) { $env:AGENTS_TEST_TEMP } else { [IO.Path]::GetTempPath() }
$root = Join-Path $tempBase ('thin-refresh-' + [guid]::NewGuid().ToString('N'))
$capability = Join-Path $root 'capability'
$context = Join-Path $root 'context'
$plugin = Join-Path $capability 'plugins/test-plugin'
$source = Join-Path $plugin 'skills/example/SKILL.md'
$target = Join-Path $context 'skills/example/SKILL.md'
function Write-TestFile([string]$Path, [string]$Text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Assert-Test([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Generate([string]$Mode = 'Write') {
    & $generator -PluginPath $plugin -ProjectRoot $root -ContextRoot $context -CapabilityRoot $capability -Mode $Mode | Out-String
}
try {
    Write-TestFile $source "---`nname: example`ndescription: original`n---`n# Source"
    $manifest = Join-Path $plugin '.agents-plugin/plugin.json'
    Write-TestFile $manifest '{"name":"test-plugin","legacyRootSkillHashes":{"example":["unused"]}}'
    $rule = Join-Path $plugin 'rules/example.md'
    Write-TestFile $rule "---`ndescription: original`ntask-affinity: [old]`n---`n# Rule"
    Generate | Out-Null
    $original = [IO.File]::ReadAllText($target)
    Write-TestFile $source "---`nname: renamed`ndescription: |`n  updated line one`n  updated line two`n---`n# Source"
    Write-TestFile $rule "---`ndescription: changed`ntask-affinity: [new]`n---`n# Rule"
    Assert-Test ((Generate 'DryRun').Contains('thin-index-stale')) 'Overlay preview must detect changed metadata'
    Assert-Test ([IO.File]::ReadAllText($target) -ceq $original) 'Preview must not write'
    Assert-Test ((Generate).Contains('updated')) 'Migrated owners must refresh without requiring old root hashes again'
    $current = [IO.File]::ReadAllText($target)
    Assert-Test ($current.Contains('updated line two')) 'Multiline description must propagate'
    Assert-Test ($current.Contains('name: renamed')) 'Name must propagate'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $context 'rules/example.md')).Contains('task-affinity: [new]')) 'Rule metadata must refresh'
    Assert-Test ((Generate).Contains('unchanged')) 'Repeated generation must be unchanged'
    # Existing CRLF/BOM generation remains recognized when the next metadata change arrives.
    [IO.File]::WriteAllText($target, $current.Replace("`r`n", "`n").Replace("`n", "`r`n"), [Text.UTF8Encoding]::new($true))
    Write-TestFile $source "---`nname: renamed`ndescription: final`n---`n# Source"
    Assert-Test ((Generate).Contains('updated')) 'BOM and CRLF legacy indexes must refresh'
    $current = [IO.File]::ReadAllText($target)
    Write-TestFile $target ($current + "`nCustom body")
    Assert-Test ((Generate).Contains('skill-owner-migration-conflict')) 'Migrated owner custom content must remain protected'
    Assert-Test ([IO.File]::ReadAllText($target).EndsWith('Custom body')) 'Custom content must survive'
    Write-TestFile $target $current
    # A new target below a linked directory must never be written through the link.
    $outside = Join-Path $root 'external'
    New-Item -ItemType Directory -Path $outside | Out-Null
    $linkedSource = Join-Path $plugin 'skills/linked/SKILL.md'
    Write-TestFile $linkedSource "---`nname: linked`ndescription: link test`n---"
    $link = Join-Path $context 'skills/linked'
    $linkType = if ($env:OS -eq 'Windows_NT') { 'Junction' } else { 'SymbolicLink' }
    New-Item -ItemType $linkType -Path $link -Target $outside | Out-Null
    Assert-Test ((Generate).Contains('thin-index-conflict')) 'Linked parent must report conflict'
    Assert-Test (-not (Test-Path (Join-Path $outside 'SKILL.md'))) 'Missing linked target must not be created'
    $linkEntry = Get-Item -LiteralPath $link -Force
    Assert-Test (($linkEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'Cleanup target must remain a link'
    [IO.Directory]::Delete($link)
    Assert-Test (-not (Test-Path -LiteralPath $link)) 'Test link must be removed'
    Write-Host 'plugin thin-index refresh tests passed'
} finally {
    if (Test-Path -LiteralPath $root) {
        if (-not ([IO.Path]::GetFullPath($root).StartsWith([IO.Path]::GetFullPath($tempBase)))) { throw 'Unexpected cleanup path' }
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
