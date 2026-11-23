$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repoRoot 'scripts/update-agents.ps1'), [ref]$null, [ref]$null)
foreach ($name in @('Get-RelativePathPortable', 'Write-UpdateResult', 'Get-MarkdownConfigEntries', 'Merge-ConfigTemplate')) {
    $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert-True($value, $message) { if (!$value) { throw $message } }
$root = Join-Path ([IO.Path]::GetTempPath()) ('Codex/profile-merge-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
    $target = Join-Path $root 'profile.md'
    $template = Join-Path $root 'template.md'
    $header = '## Pending config items merged by update-agents.ps1'
    foreach ($newline in @("`r`n", "`n", "`r")) {
        foreach ($bom in @($false, $true)) {
            $original = (@('# Profile', '- keep: custom', $header, 'User note one', '- first: original', '## User section', 'User body', $header, 'User note two', '- second: original') -join $newline)
            [IO.File]::WriteAllText($target, $original, [Text.UTF8Encoding]::new($bom))
            [IO.File]::WriteAllText($template, "- keep: TODO`n- first: TODO`n- second: TODO`n- third: default-value", [Text.UTF8Encoding]::new($false))
            $before = [Convert]::ToBase64String([IO.File]::ReadAllBytes($target))
            foreach ($mode in @('DryRun', 'Check')) {
                Merge-ConfigTemplate $template $target $root sample $mode | Out-Null
                Assert-True ($before -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($target))) 'Read-only modes changed profile bytes'
            }
            Merge-ConfigTemplate $template $target $root sample Write | Out-Null
            $merged = [IO.File]::ReadAllText($target)
            Assert-True (([regex]::Matches($merged, [regex]::Escape($header))).Count -eq 1) 'Pending sections were not consolidated'
            foreach ($text in @('User note one', 'User note two', 'User body', '- keep: custom', '- first: original', '- second: original', '- third: default-value')) {
                Assert-True ($merged.Contains($text)) ('Lost content: ' + $text)
            }
            Assert-True (-not [regex]::IsMatch($merged, "`r(?!`n)")) 'Generated standalone CR'
            $bytes = [IO.File]::ReadAllBytes($target)
            Assert-True (($bytes[0] -eq 239) -eq $bom) 'BOM changed'
            $stable = [Convert]::ToBase64String($bytes)
            Merge-ConfigTemplate $template $target $root sample Write | Out-Null
            Assert-True ($stable -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($target))) 'Repeated Write changed bytes'
            [IO.File]::AppendAllText($template, "`n- fourth: incremental-value")
            Merge-ConfigTemplate $template $target $root sample Write | Out-Null
            Assert-True (([regex]::Matches([IO.File]::ReadAllText($target), [regex]::Escape($header))).Count -eq 1) 'Incremental merge duplicated Pending header'
        }
    }
    # Removing optional template noise must survive later updates.
    [IO.File]::WriteAllText($template, "- optional: TODO`n- mixed: CSP / TODO`n- empty:`n- required: <required>`n- unset: <unset>`n- real: default`n<!-- agents-update:review-required -->", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($target, "- keep: TODO`nUser-owned note", [Text.UTF8Encoding]::new($true))
    foreach ($mode in @('DryRun', 'Check', 'Write')) {
        $result = @(Merge-ConfigTemplate $template $target $root sample $mode)
        Assert-True (@($result | Where-Object { $_.status -eq 'config-review-required' }).Count -eq 1) 'Explicit review marker was lost'
        Assert-True (@($result | Where-Object { $_.reason -in @('optional','mixed','empty','required','unset') }).Count -eq 0) 'Placeholder was requested'
    }
    $cleaned = [IO.File]::ReadAllText($target)
    Assert-True ($cleaned.Contains('- keep: TODO') -and $cleaned.Contains('User-owned note')) 'Existing user content was removed'
    Assert-True ($cleaned.Contains('- real: default')) 'Meaningful default was not merged'
    foreach ($key in @('optional','mixed','empty','required','unset')) {
        Assert-True (!$cleaned.Contains('- ' + $key + ':')) 'Removed placeholder was recreated'
    }
    $newTarget = Join-Path $root 'new-profile.md'
    Merge-ConfigTemplate $template $newTarget $root sample Write | Out-Null
    Assert-True ([IO.File]::ReadAllText($newTarget) -eq [IO.File]::ReadAllText($template)) 'First creation must retain the full template'
    Write-Output 'profile merge tests passed'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    $allowed = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'Codex')) + [IO.Path]::DirectorySeparatorChar
    if (!$resolved.StartsWith($allowed) -or ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    Assert-True (!(Test-Path -LiteralPath $resolved)) 'Temporary directory cleanup failed'
}
