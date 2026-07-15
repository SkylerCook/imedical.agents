
$ErrorActionPreference = "Stop"

$validator = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\validate-agent-run.ps1"))
$powershell = (Get-Process -Id $PID).Path
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-run-tests-" + [guid]::NewGuid().ToString("N"))
$reportMap = [ordered]@{
    "explorer" = "10-explorer.md"
    "classifier" = "11-classifier.md"
    "backend-coder" = "20-backend-coder.md"
    "frontend-coder" = "21-frontend-coder.md"
    "template-seed" = "22-template-seed.md"
    "verifier" = "30-verifier.md"
    "summary" = "40-summary.md"
}

function Write-Utf8([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function New-AgentRunFixture([string]$Name, [string]$Mode = "serial", [string]$SchemaVersion = "1.2") {
    $path = Join-Path $tempRoot $Name
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    $isMulti = $Mode -eq "multi-agent"
    $actors = @{
        "explorer" = if ($isMulti) { "analysis-agent" } else { "single-agent" }
        "classifier" = if ($isMulti) { "analysis-agent" } else { "single-agent" }
        "backend-coder" = if ($isMulti) { "backend-agent" } else { "single-agent" }
        "frontend-coder" = if ($isMulti) { "frontend-agent" } else { "single-agent" }
        "template-seed" = if ($isMulti) { "template-agent" } else { "single-agent" }
        "verifier" = if ($isMulti) { "verifier-agent" } else { "single-agent" }
        "summary" = if ($isMulti) { "root-coordinator" } else { "single-agent" }
    }
    $times = @{
        "explorer" = @("2026-07-14T10:00:00+08:00", "2026-07-14T10:01:00+08:00")
        "classifier" = @("2026-07-14T10:01:00+08:00", "2026-07-14T10:02:00+08:00")
        "backend-coder" = @("2026-07-14T10:02:00+08:00", "2026-07-14T10:04:00+08:00")
        "frontend-coder" = @("2026-07-14T10:02:00+08:00", "2026-07-14T10:04:00+08:00")
        "template-seed" = @("2026-07-14T10:02:00+08:00", "2026-07-14T10:04:00+08:00")
        "verifier" = @("2026-07-14T10:04:00+08:00", "2026-07-14T10:05:00+08:00")
        "summary" = @("2026-07-14T10:05:00+08:00", "2026-07-14T10:06:00+08:00")
    }
    $stages = @()
    foreach ($entry in $reportMap.GetEnumerator()) {
        Write-Utf8 (Join-Path $path $entry.Value) "# $($entry.Key)`n`nSanitized validation fixture."
        $stage = [ordered]@{
            name = $entry.Key
            actor = $actors[$entry.Key]
            status = "completed"
            startedAt = $times[$entry.Key][0]
            completedAt = $times[$entry.Key][1]
            timingReason = ""
            report = $entry.Value
            reusedEvidence = $false
        }
        if ($SchemaVersion -eq "1.2") {
            $duration = ([DateTimeOffset]::Parse($times[$entry.Key][1]) - [DateTimeOffset]::Parse($times[$entry.Key][0])).TotalSeconds
            $stage["attempts"] = @([ordered]@{
                attempt = 1
                status = "completed"
                startedAt = $times[$entry.Key][0]
                completedAt = $times[$entry.Key][1]
                activeSeconds = [int]$duration
                reason = "initial execution"
            })
        }
        $stages += $stage
    }
    $manifest = [ordered]@{
        schemaVersion = $SchemaVersion
        topic = $Name
        runMode = $Mode
        retrospective = $false
        modeHistory = @([ordered]@{ mode = $Mode; selectedAt = "2026-07-14T10:00:00+08:00"; reason = "selected before execution" })
        authorization = [ordered]@{ multiAgent = $isMulti; remoteWrite = $false }
        startedAt = "2026-07-14T10:00:00+08:00"
        completedAt = "2026-07-14T10:06:00+08:00"
        elapsedSeconds = 360
        timingReason = ""
        ownership = if ($isMulti) {
            @(
                [ordered]@{ actor = "backend-agent"; stage = "backend-coder"; paths = @("backend/**") },
                [ordered]@{ actor = "frontend-agent"; stage = "frontend-coder"; paths = @("frontend/**") },
                [ordered]@{ actor = "template-agent"; stage = "template-seed"; paths = @("templates/**") }
            )
        } else {
            @([ordered]@{ actor = "single-agent"; stage = "all"; paths = @("task-scope/**") })
        }
        stages = $stages
        failures = @()
        qualityGates = [ordered]@{
            handoff = "pass"
            sensitiveData = "pass"
            objectScript = [ordered]@{ compile = "pass"; structure = "pass"; residualRisk = "" }
            xml = [ordered]@{ triggered = $true; metadata = "pass"; parse = "pass"; residue = "pass"; fallback = "pass" }
            parallelEfficiency = if ($isMulti) { "pass" } else { "not-applicable" }
        }
        remoteActions = @()
    }
    if ($SchemaVersion -eq "1.1") {
        $manifest["lastMutationAt"] = "2026-07-14T10:04:00+08:00"
        $manifest["verificationRevision"] = "fixture-final"
    } else {
        $manifest["capabilities"] = @([ordered]@{ name = "iris-query"; state = "available"; probe = "SELECT 1 AS Probe"; result = "success" })
        $manifest["finalization"] = [ordered]@{ ready = $true; checkedAt = "2026-07-14T10:04:00+08:00"; blockingFailures = @() }
        $manifest["verification"] = [ordered]@{
            scope = @("business-code", "local-i18n-artifacts", "authorized-remote-readback")
            lastMutationAt = "2026-07-14T10:04:00+08:00"
            revision = "fixture-final"
        }
    }
    Write-Utf8 (Join-Path $path "00-run-manifest.json") ($manifest | ConvertTo-Json -Depth 12)
    return $path
}

function Invoke-Validation([string]$Path, [int]$ExpectedExitCode) {
    $output = & $powershell -NoProfile -ExecutionPolicy Bypass -File $validator -RunDirectory $Path 2>&1
    $actual = $LASTEXITCODE
    if ($actual -ne $ExpectedExitCode) {
        throw "Expected exit code $ExpectedExitCode, got $actual.`n$($output -join [Environment]::NewLine)"
    }
}

try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    $serial = New-AgentRunFixture "valid-serial" "serial"
    Invoke-Validation $serial 0

    $legacy11 = New-AgentRunFixture "valid-schema-11" "serial" "1.1"
    Invoke-Validation $legacy11 0

    $multi = New-AgentRunFixture "valid-multi" "multi-agent"
    Invoke-Validation $multi 0

    $resumed = New-AgentRunFixture "valid-resumed-stage" "multi-agent"
    $manifestPath = Join-Path $resumed "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $template = $manifest.stages | Where-Object name -eq "template-seed"
    $template.completedAt = "2026-07-14T10:21:00+08:00"
    $template.attempts = @(
        [pscustomobject]@{ attempt = 1; status = "suspended"; startedAt = "2026-07-14T10:02:00+08:00"; completedAt = "2026-07-14T10:03:00+08:00"; activeSeconds = 60; reason = "temporary MCP session failure" },
        [pscustomobject]@{ attempt = 2; status = "completed"; startedAt = "2026-07-14T10:20:00+08:00"; completedAt = "2026-07-14T10:21:00+08:00"; activeSeconds = 60; reason = "resumed after fresh probe" }
    )
    $verifier = $manifest.stages | Where-Object name -eq "verifier"
    $verifier.startedAt = "2026-07-14T10:21:00+08:00"
    $verifier.completedAt = "2026-07-14T10:22:00+08:00"
    $verifier.attempts[0].startedAt = $verifier.startedAt
    $verifier.attempts[0].completedAt = $verifier.completedAt
    $summary = $manifest.stages | Where-Object name -eq "summary"
    $summary.startedAt = "2026-07-14T10:22:00+08:00"
    $summary.completedAt = "2026-07-14T10:23:00+08:00"
    $summary.attempts[0].startedAt = $summary.startedAt
    $summary.attempts[0].completedAt = $summary.completedAt
    $manifest.completedAt = "2026-07-14T10:23:00+08:00"
    $manifest.elapsedSeconds = 1380
    $manifest.finalization.checkedAt = "2026-07-14T10:21:00+08:00"
    $manifest.verification.lastMutationAt = "2026-07-14T10:21:00+08:00"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $resumed 0

    $terminalConflict = New-AgentRunFixture "valid-terminal-conflict" "serial"
    $manifestPath = Join-Path $terminalConflict "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.remoteActions = @([pscustomobject]@{ type = "translation-preflight"; write = $false; authorized = $false; state = "blocked"; terminal = $true; result = "existing conflicting value" })
    $manifest.finalization.blockingFailures = @("translation-conflict")
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $terminalConflict 0

    $unauthorizedMulti = New-AgentRunFixture "unauthorized-multi" "multi-agent"
    $manifestPath = Join-Path $unauthorizedMulti "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.authorization.multiAgent = $false
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $unauthorizedMulti 1

    $missingReport = New-AgentRunFixture "missing-report" "serial"
    Remove-Item -LiteralPath (Join-Path $missingReport "30-verifier.md")
    Invoke-Validation $missingReport 1

    $retryOverflow = New-AgentRunFixture "retry-overflow" "serial"
    $manifestPath = Join-Path $retryOverflow "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.failures = @([pscustomobject]@{ signature = "temporary syntax"; category = "payload-compilation"; sameSignatureRetryCount = 2; historicalViolation = $false; fallback = "none"; result = "failed" })
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $retryOverflow 1

    $remoteWrite = New-AgentRunFixture "unauthorized-remote-write" "serial"
    $manifestPath = Join-Path $remoteWrite "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.remoteActions = @([pscustomobject]@{ type = "template-save"; write = $true; authorized = $false; result = "not-run" })
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $remoteWrite 1

    $badDependency = New-AgentRunFixture "bad-stage-dependency" "serial"
    $manifestPath = Join-Path $badDependency "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    ($manifest.stages | Where-Object name -eq "verifier").startedAt = "2026-07-14T10:03:00+08:00"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $badDependency 1

    $badParallelGate = New-AgentRunFixture "bad-parallel-gate" "multi-agent"
    $manifestPath = Join-Path $badParallelGate "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.qualityGates.parallelEfficiency = "not-applicable"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $badParallelGate 1

    $midRunPromotion = New-AgentRunFixture "mid-run-promotion" "multi-agent"
    $manifestPath = Join-Path $midRunPromotion "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.modeHistory = @(
        [pscustomobject]@{ mode = "serial"; selectedAt = "2026-07-14T10:00:00+08:00"; reason = "initial" },
        [pscustomobject]@{ mode = "multi-agent"; selectedAt = "2026-07-14T10:02:00+08:00"; reason = "promoted later" }
    )
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $midRunPromotion 1

    $reconstructedTime = New-AgentRunFixture "reconstructed-time" "multi-agent"
    $manifestPath = Join-Path $reconstructedTime "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    ($manifest.stages | Where-Object name -eq "backend-coder").timingReason = "reconstructed after execution"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $reconstructedTime 1

    $overlappingOwnership = New-AgentRunFixture "overlapping-ownership" "multi-agent"
    $manifestPath = Join-Path $overlappingOwnership "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.ownership[1].paths = @("backend/**")
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $overlappingOwnership 1

    $staleVerifier = New-AgentRunFixture "stale-verifier" "multi-agent"
    $manifestPath = Join-Path $staleVerifier "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.verification.lastMutationAt = "2026-07-14T10:04:30+08:00"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $staleVerifier 1

    $missingRemoteScope = New-AgentRunFixture "missing-remote-scope" "serial"
    $manifestPath = Join-Path $missingRemoteScope "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.authorization.remoteWrite = $true
    $manifest.remoteActions = @([pscustomobject]@{ type = "template-save"; write = $true; authorized = $true; result = "completed"; authorizationCategory = "translation-data-write" })
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $missingRemoteScope 1

    $pendingRemote = New-AgentRunFixture "pending-remote-before-verifier" "serial"
    $manifestPath = Join-Path $pendingRemote "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.remoteActions = @([pscustomobject]@{ type = "translation-save"; write = $false; authorized = $false; state = "suspended"; terminal = $false; result = "temporary failure" })
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $pendingRemote 1

    $overlappingAttempts = New-AgentRunFixture "overlapping-attempts" "multi-agent"
    $manifestPath = Join-Path $overlappingAttempts "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $template = $manifest.stages | Where-Object name -eq "template-seed"
    $template.attempts = @(
        [pscustomobject]@{ attempt = 1; status = "suspended"; startedAt = "2026-07-14T10:02:00+08:00"; completedAt = "2026-07-14T10:03:30+08:00"; activeSeconds = 90; reason = "temporary failure" },
        [pscustomobject]@{ attempt = 2; status = "completed"; startedAt = "2026-07-14T10:03:00+08:00"; completedAt = "2026-07-14T10:04:00+08:00"; activeSeconds = 60; reason = "invalid overlap" }
    )
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $overlappingAttempts 1

    $suspendedFinal = New-AgentRunFixture "suspended-final-attempt" "serial"
    $manifestPath = Join-Path $suspendedFinal "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    ($manifest.stages | Where-Object name -eq "template-seed").attempts[0].status = "suspended"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $suspendedFinal 1

    $badVerificationScope = New-AgentRunFixture "bad-verification-scope" "serial"
    $manifestPath = Join-Path $badVerificationScope "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.verification.scope += "reports"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $badVerificationScope 1

    $lateFinalization = New-AgentRunFixture "late-finalization" "serial"
    $manifestPath = Join-Path $lateFinalization "00-run-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.finalization.checkedAt = "2026-07-14T10:04:30+08:00"
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 12)
    Invoke-Validation $lateFinalization 1

    $sensitive = New-AgentRunFixture "sensitive-payload" "serial"
    Add-Content -LiteralPath (Join-Path $sensitive "22-template-seed.md") -Value (("A" * 300))
    Invoke-Validation $sensitive 1

    Write-Host "validate-agent-run tests passed."
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
