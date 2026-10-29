#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$source = Join-Path $repo 'tools/ai-dev-offline'
$parent = Join-Path ([IO.Path]::GetTempPath()) 'Codex'
if (Test-Path -LiteralPath 'D:\tmp' -PathType Container) { $parent = 'D:\tmp\Codex' }
$testRoot = Join-Path $parent ('ai-dev-offline-tests-' + [guid]::NewGuid().ToString('N'))
$p = $parent
while ($p) {
    if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'linked-test-parent' }
    $p = [IO.Path]::GetDirectoryName($p)
}
$count = 0
function Expect-Failure([scriptblock]$Call,[string]$Pattern) {
    $failed = $false
    try { & $Call | Out-Null } catch { if ($_.Exception.Message -notmatch $Pattern) { throw }; $failed = $true }
    if (-not $failed) { throw "expected-failure: $Pattern" }
    $script:count++
}
try {
    [void][IO.Directory]::CreateDirectory((Join-Path $testRoot 'payload'))
    $fixture = Join-Path $testRoot 'payload/a.zip'
    [IO.File]::WriteAllBytes($fixture,[byte[]]@(1,2,3,4))
    $c = @{id='a';version='1.0.0';file='a.zip';bytes=4;sha256=(Get-FileHash $fixture -Algorithm SHA256).Hash.ToLowerInvariant()}
    $missing = @{id='b';version='1.0.0';file='missing.zip';bytes=4;sha256=$c.sha256}
    $manifestPath = Join-Path $testRoot 'manifest.json'
    @{schemaVersion=1;components=@($c,$missing)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    $verify = Join-Path $source 'verify-packages.ps1'
    $ok = @(& $verify -PackageRoot $testRoot -Components a)
    if ($ok.Count -ne 1 -or $ok[0].state -ne 'package-verified') { throw 'selected-only-verification-failed' }; $count++
    $copiedVerify = Join-Path $testRoot 'verify-packages.ps1'
    Copy-Item -LiteralPath $verify -Destination $copiedVerify
    $defaultRoot = @(& $copiedVerify -Components a)
    if ($defaultRoot.Count -ne 1 -or $defaultRoot[0].state -ne 'package-verified') { throw 'default-package-root-failed' }; $count++
    Expect-Failure { & $verify -PackageRoot $testRoot } 'missing-package: b'
    Expect-Failure { & $verify -PackageRoot $testRoot -Components unknown } 'unknown-component'
    [IO.File]::WriteAllBytes($fixture,[byte[]]@(1,2,3,5))
    Expect-Failure { & $verify -PackageRoot $testRoot -Components a } 'package-sha256-mismatch'
    [IO.File]::WriteAllBytes($fixture,[byte[]]@(1,2,3))
    Expect-Failure { & $verify -PackageRoot $testRoot -Components a } 'package-size-mismatch'
    $c.file = '../outside.zip'
    @{schemaVersion=1;components=@($c)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Expect-Failure { & $verify -PackageRoot $testRoot } 'invalid-component-entry'
    @{schemaVersion=1;components=@($c,$c)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Expect-Failure { & $verify -PackageRoot $testRoot } 'duplicate-component-id'
    foreach ($name in @('prepare-package.ps1','verify-packages.ps1','configure-environment.ps1')) {
        $errors = $null; $tokens = $null
        [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $source $name),[ref]$tokens,[ref]$errors)
        if ($errors.Count) { throw "parse-failed: $name" }; $count++
    }
    $manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.components.Count -ne 7 -or @($manifest.components | Where-Object { $_.bytes -le 0 -or $_.sha256 -notmatch '^[a-f0-9]{64}$' -or $_.url -notlike 'https://*' }).Count) { throw 'invalid-pinned-manifest' }; $count++
    foreach ($name in @('settings-user.jsonc','settings-codebuddy.jsonc','settings-iris-workspace.jsonc')) {
        $raw = Get-Content -LiteralPath (Join-Path $source ('templates/'+$name)) -Encoding UTF8
        $json = ($raw | Where-Object { -not $_.TrimStart().StartsWith('//') }) -join "`n"
        $parsed = $json | ConvertFrom-Json
        if ($json -match '"[^"\r\n]*(password|token|api.?key|disabledSecurityCategories|autoRun|proxyStrictSSL)[^"\r\n]*"\s*:') { throw 'unsafe-template-setting' }
        if ($name -eq 'settings-user.jsonc' -and $parsed.'terminal.integrated.profiles.windows'.'PowerShell 7'.path -ne '__PWSH_EXE__') { throw 'machine-path-in-template' }
        if ($name -eq 'settings-user.jsonc' -and ($parsed.'terminal.integrated.automationProfile.windows'.path -ne '__PWSH_EXE__' -or ($parsed.'terminal.integrated.automationProfile.windows'.args -join '|') -ne '-NoLogo|-NoProfile')) { throw 'automation-must-prefer-pwsh' }
        if ($name -eq 'settings-iris-workspace.jsonc' -and $parsed.'objectscript.conn'.active -ne $false) { throw 'template-must-not-connect' }
        $count++
    }
    $mcp = Get-Content -LiteralPath (Join-Path $source 'templates/mcp.template.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $servers = @($mcp.mcpServers.PSObject.Properties.Name)
    $iris = $mcp.mcpServers.'iris-agentic-dev'
    if ($servers.Count -ne 1 -or $servers[0] -ne 'iris-agentic-dev' -or $iris.command -ne '__IRIS_AGENTIC_DEV_EXE__' -or ($iris.args -join '|') -ne 'mcp|--config|__IRIS_CONFIG_FILE__') { throw 'mcp-template-scope-or-launch-mismatch' }; $count++
    if (@($iris.env.PSObject.Properties.Name|Where-Object{$_ -match 'USERNAME|PASSWORD|TOKEN|KEY'}).Count -or $iris.env.IRIS_HOST -ne 'REPLACE_WITH_IRIS_HOST' -or $iris.env.IRIS_NAMESPACE -ne 'REPLACE_WITH_IRIS_NAMESPACE' -or $iris.env.IRIS_TLS_VERIFY -ne 'true') { throw 'unsafe-mcp-template-env' }; $count++
    $toml = Get-Content -LiteralPath (Join-Path $source 'templates/iris-agentic-dev.template.toml') -Raw -Encoding UTF8
    if ($toml -match '(?m)^\s*(username|password|token|api_key)\s*=' -or $toml -notmatch '(?m)^tls_verify = true$' -or $toml -notmatch 'host = "REPLACE_WITH_IRIS_HOST"' -or $toml -notmatch 'namespace = "REPLACE_WITH_IRIS_NAMESPACE"') { throw 'unsafe-toml-template' }; $count++
    $environment = Join-Path $source 'configure-environment.ps1'
    $toolsRoot = Join-Path $testRoot 'tools-root'
    $nodeVersion = ($manifest.components | Where-Object id -eq 'node').version
    $nodeDir = Join-Path $toolsRoot ("Node/$nodeVersion/node-v$nodeVersion-win-x64")
    [void][IO.Directory]::CreateDirectory($nodeDir)
    [IO.File]::WriteAllBytes((Join-Path $nodeDir 'node.exe'),[byte[]]@(1,2,3))
    $pathBefore = [Environment]::GetEnvironmentVariable('Path','Process')
    $nodeOnlyPlan = @(& $environment -Root $toolsRoot -Scope Process -Components 'node')
    if ($nodeOnlyPlan.Count -ne 1 -or $nodeOnlyPlan[0].id -ne 'node' -or [Environment]::GetEnvironmentVariable('Path','Process') -cne $pathBefore -or (Test-Path -LiteralPath (Join-Path $toolsRoot '.ai-dev-environment'))) { throw 'plan-must-be-selected-only-and-read-only' }; $count++
    Expect-Failure { & $environment -Root $toolsRoot -Scope Process -Components 'node,python' } 'selected-executable-missing: python'
    Expect-Failure { & $environment -Root $toolsRoot -Scope Process -Components 'unknown' } 'unsupported-selected-component'
    Expect-Failure { & $environment -Root $toolsRoot -Scope Process } 'selected-components-required'
    Expect-Failure { & $environment -Root $toolsRoot -Scope Process -Components node -Action Apply } 'selected-command-failed'
    if ([Environment]::GetEnvironmentVariable('Path','Process') -cne $pathBefore) { throw 'failed-verification-must-restore-path' }; $count++
    Write-Host "$count checks passed on PowerShell $($PSVersionTable.PSVersion)"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        if ([IO.Path]::GetDirectoryName($testRoot) -ne $parent -or -not [IO.Path]::GetFileName($testRoot).StartsWith('ai-dev-offline-tests-')) { throw 'unsafe-test-cleanup' }
        foreach ($item in @((Get-Item -LiteralPath $testRoot -Force)) + @(Get-ChildItem -LiteralPath $testRoot -Recurse -Force)) { if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'linked-test-cleanup' } }
        Remove-Item -LiteralPath $testRoot -Recurse -Force
        if (Test-Path -LiteralPath $testRoot) { throw 'test-cleanup-failed' }
    }
}
