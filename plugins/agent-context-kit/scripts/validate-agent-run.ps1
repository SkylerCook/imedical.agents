
param(
    [Parameter(Mandatory = $true)]
    [string]$RunDirectory
)

$ErrorActionPreference = "Stop"
$issues = New-Object System.Collections.Generic.List[string]
$allowedModes = @("retrospective", "serial", "multi-agent")
$allowedStatuses = @("completed", "not-applicable", "blocked")
$requiredReports = [ordered]@{
    "explorer" = "10-explorer.md"
    "classifier" = "11-classifier.md"
    "backend-coder" = "20-backend-coder.md"
    "frontend-coder" = "21-frontend-coder.md"
    "template-seed" = "22-template-seed.md"
    "verifier" = "30-verifier.md"
    "summary" = "40-summary.md"
}

function Add-Issue([string]$Message) {
    $script:issues.Add($Message)
}

function Get-PropertyValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Test-PropertyExists($Object, [string]$Name) {
    if ($null -eq $Object) { return $false }
    return ($null -ne $Object.PSObject.Properties[$Name])
}

function Test-IsoTimestamp($Value) {
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $false }
    $parsed = [DateTimeOffset]::MinValue
    return [DateTimeOffset]::TryParse([string]$Value, [ref]$parsed)
}

function Convert-IsoTimestamp($Value) {
    if (-not (Test-IsoTimestamp $Value)) { return $null }
    return [DateTimeOffset]::Parse([string]$Value)
}

function Test-PassValue($Value) {
    return ([string]$Value -eq "pass")
}

function Test-SensitiveContent([string]$Content, [string]$Source) {
    $patterns = [ordered]@{
        "IPv4 address" = '(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)'
        "network URL" = '(?i)\b(?:https?|sftp)://'
        "Windows absolute path" = '(?i)\b[A-Z]:\\'
        "server absolute path" = '(?i)(?:^|[\s"''`])/(?:opt|var|home|usr|srv)/'
        "secret or connection assignment" = '(?im)\b(?:password|passwd|token|secret|account|username|namespace|remotePath)\b\s*[:=]\s*["'']?[^"''\s,}]+'
        "long Base64 payload" = '(?m)[A-Za-z0-9+/]{256,}={0,2}'
        "complete XML payload" = '(?i)<\?xml\s'
    }
    foreach ($entry in $patterns.GetEnumerator()) {
        if ($Content -match $entry.Value) {
            Add-Issue "$Source contains prohibited $($entry.Key)."
        }
    }
}

$runDirectoryFull = [System.IO.Path]::GetFullPath($RunDirectory)
$manifestPath = Join-Path $runDirectoryFull "00-run-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Write-Error "Missing manifest: $manifestPath"
    exit 1
}

try {
    $manifestText = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
    $manifest = $manifestText | ConvertFrom-Json
} catch {
    Write-Error "Invalid manifest JSON: $($_.Exception.Message)"
    exit 1
}

foreach ($name in @("schemaVersion", "topic", "runMode", "retrospective", "authorization", "startedAt", "completedAt", "elapsedSeconds", "timingReason", "stages", "failures", "qualityGates", "remoteActions")) {
    if (-not (Test-PropertyExists $manifest $name)) { Add-Issue "Manifest is missing '$name'." }
}

$schemaVersion = [string](Get-PropertyValue $manifest "schemaVersion")
$topic = [string](Get-PropertyValue $manifest "topic")
if (@("1.0", "1.1") -notcontains $schemaVersion) { Add-Issue "Unsupported schemaVersion '$schemaVersion'." }
$isSchema11 = $schemaVersion -eq "1.1"
if ($isSchema11) {
    foreach ($name in @("modeHistory", "ownership", "lastMutationAt", "verificationRevision")) {
        if (-not (Test-PropertyExists $manifest $name)) { Add-Issue "Schema 1.1 manifest is missing '$name'." }
    }
}
if ([string]::IsNullOrWhiteSpace($topic)) { Add-Issue "Manifest topic must not be empty." }

$runMode = [string](Get-PropertyValue $manifest "runMode")
$retrospective = [bool](Get-PropertyValue $manifest "retrospective")
if ($allowedModes -notcontains $runMode) { Add-Issue "Unsupported runMode '$runMode'." }
if (($runMode -eq "retrospective") -ne $retrospective) { Add-Issue "runMode and retrospective flag are inconsistent." }
if ($isSchema11) {
    $modeHistory = @((Get-PropertyValue $manifest "modeHistory"))
    if ($modeHistory.Count -eq 0) {
        Add-Issue "Schema 1.1 requires a non-empty modeHistory."
    } else {
        $firstMode = [string](Get-PropertyValue $modeHistory[0] "mode")
        if ($runMode -eq "multi-agent" -and $firstMode -ne "multi-agent") {
            Add-Issue "multi-agent must be selected at run start; mid-run mode promotion is not valid P1 evidence."
        }
        foreach ($modeEntry in $modeHistory) {
            foreach ($name in @("mode", "selectedAt", "reason")) {
                if (-not (Test-PropertyExists $modeEntry $name)) { Add-Issue "A modeHistory entry is missing '$name'." }
            }
        }
    }
}

$authorization = Get-PropertyValue $manifest "authorization"
$multiAgentAuthorized = [bool](Get-PropertyValue $authorization "multiAgent")
$remoteWriteAuthorized = [bool](Get-PropertyValue $authorization "remoteWrite")
if ($runMode -eq "multi-agent" -and -not $multiAgentAuthorized) {
    Add-Issue "multi-agent mode requires authorization.multiAgent=true."
}

$startedAt = Get-PropertyValue $manifest "startedAt"
$completedAt = Get-PropertyValue $manifest "completedAt"
$timingReason = [string](Get-PropertyValue $manifest "timingReason")
if ($retrospective) {
    if (($null -eq $startedAt -or $null -eq $completedAt) -and [string]::IsNullOrWhiteSpace($timingReason)) {
        Add-Issue "Retrospective runs with unknown timestamps require timingReason."
    }
} else {
    if (-not (Test-IsoTimestamp $startedAt)) { Add-Issue "startedAt must be an ISO 8601 timestamp." }
    if (-not (Test-IsoTimestamp $completedAt)) { Add-Issue "completedAt must be an ISO 8601 timestamp." }
}

$stages = @((Get-PropertyValue $manifest "stages"))
$stageMap = @{}
foreach ($stage in $stages) {
    $name = [string](Get-PropertyValue $stage "name")
    if ([string]::IsNullOrWhiteSpace($name)) {
        Add-Issue "A stage is missing name."
        continue
    }
    if ($stageMap.ContainsKey($name)) {
        Add-Issue "Duplicate stage '$name'."
        continue
    }
    $stageMap[$name] = $stage
}

foreach ($entry in $requiredReports.GetEnumerator()) {
    if (-not $stageMap.ContainsKey($entry.Key)) {
        Add-Issue "Missing stage '$($entry.Key)'."
        continue
    }
    $stage = $stageMap[$entry.Key]
    foreach ($name in @("actor", "status", "startedAt", "completedAt", "timingReason", "report", "reusedEvidence")) {
        if (-not (Test-PropertyExists $stage $name)) { Add-Issue "Stage '$($entry.Key)' is missing '$name'." }
    }
    $status = [string](Get-PropertyValue $stage "status")
    if ($allowedStatuses -notcontains $status) { Add-Issue "Stage '$($entry.Key)' has invalid status '$status'." }
    $report = [string](Get-PropertyValue $stage "report")
    if ($report -ne $entry.Value) { Add-Issue "Stage '$($entry.Key)' must use report '$($entry.Value)'." }
    $reportPath = Join-Path $runDirectoryFull $entry.Value
    if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
        Add-Issue "Missing report '$($entry.Value)'."
    } else {
        $content = [System.IO.File]::ReadAllText($reportPath, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($content)) { Add-Issue "Report '$($entry.Value)' is empty." }
        Test-SensitiveContent $content $entry.Value
    }

    $stageStartedAt = Get-PropertyValue $stage "startedAt"
    $stageCompletedAt = Get-PropertyValue $stage "completedAt"
    $stageTimingReason = [string](Get-PropertyValue $stage "timingReason")
    if ($retrospective) {
        if (($null -eq $stageStartedAt -or $null -eq $stageCompletedAt) -and [string]::IsNullOrWhiteSpace($stageTimingReason)) {
            Add-Issue "Retrospective stage '$($entry.Key)' requires timingReason when timestamps are unknown."
        }
    } else {
        if (-not (Test-IsoTimestamp $stageStartedAt)) { Add-Issue "Stage '$($entry.Key)' startedAt is invalid." }
        if (-not (Test-IsoTimestamp $stageCompletedAt)) { Add-Issue "Stage '$($entry.Key)' completedAt is invalid." }
        if ($isSchema11 -and -not [string]::IsNullOrWhiteSpace($stageTimingReason)) {
            Add-Issue "Schema 1.1 non-retrospective stage '$($entry.Key)' must use actual timestamps and an empty timingReason."
        }
    }
}

if (-not $retrospective) {
    $dependencyPairs = @(
        @("explorer", "classifier"),
        @("classifier", "backend-coder"),
        @("classifier", "frontend-coder"),
        @("classifier", "template-seed"),
        @("backend-coder", "verifier"),
        @("frontend-coder", "verifier"),
        @("template-seed", "verifier"),
        @("verifier", "summary")
    )
    foreach ($pair in $dependencyPairs) {
        if (-not $stageMap.ContainsKey($pair[0]) -or -not $stageMap.ContainsKey($pair[1])) { continue }
        $source = $stageMap[$pair[0]]
        $target = $stageMap[$pair[1]]
        if ([string](Get-PropertyValue $source "status") -eq "not-applicable" -or [string](Get-PropertyValue $target "status") -eq "not-applicable") { continue }
        $sourceEnd = Convert-IsoTimestamp (Get-PropertyValue $source "completedAt")
        $targetStart = Convert-IsoTimestamp (Get-PropertyValue $target "startedAt")
        if ($null -ne $sourceEnd -and $null -ne $targetStart -and $targetStart -lt $sourceEnd) {
            Add-Issue "Stage dependency order is invalid: '$($pair[1])' starts before '$($pair[0])' completes."
        }
    }
}

if ($runMode -eq "serial" -or $runMode -eq "retrospective") {
    $actors = @($stages | ForEach-Object { [string](Get-PropertyValue $_ "actor") } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
    if ($actors.Count -gt 1) { Add-Issue "$runMode mode must use one actor; found $($actors.Count)." }
}

if ($runMode -eq "multi-agent") {
    $parallelActors = @()
    foreach ($name in @("backend-coder", "frontend-coder", "template-seed")) {
        if ($stageMap.ContainsKey($name) -and [string](Get-PropertyValue $stageMap[$name] "status") -eq "completed") {
            $parallelActors += [string](Get-PropertyValue $stageMap[$name] "actor")
        }
    }
    $parallelActors = @($parallelActors | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
    if ($parallelActors.Count -lt 2) { Add-Issue "multi-agent mode requires at least two distinct completed coder/template actors." }
    $verifierActor = if ($stageMap.ContainsKey("verifier")) { [string](Get-PropertyValue $stageMap["verifier"] "actor") } else { "" }
    if ($parallelActors -contains $verifierActor) { Add-Issue "Verifier must be independent from coder/template actors." }
}

if ($isSchema11) {
    $ownership = @((Get-PropertyValue $manifest "ownership"))
    $pathOwners = @{}
    foreach ($entry in $ownership) {
        foreach ($name in @("actor", "stage", "paths")) {
            if (-not (Test-PropertyExists $entry $name)) { Add-Issue "An ownership entry is missing '$name'." }
        }
        $owner = [string](Get-PropertyValue $entry "actor")
        foreach ($path in @((Get-PropertyValue $entry "paths"))) {
            $pathText = [string]$path
            if ([string]::IsNullOrWhiteSpace($pathText)) {
                Add-Issue "Ownership paths must not be empty."
            } elseif ($pathOwners.ContainsKey($pathText) -and $pathOwners[$pathText] -ne $owner) {
                Add-Issue "Ownership path '$pathText' is assigned to both '$($pathOwners[$pathText])' and '$owner'."
            } else {
                $pathOwners[$pathText] = $owner
            }
        }
    }

    $lastMutationAt = Get-PropertyValue $manifest "lastMutationAt"
    $verificationRevision = [string](Get-PropertyValue $manifest "verificationRevision")
    if (-not (Test-IsoTimestamp $lastMutationAt)) { Add-Issue "Schema 1.1 lastMutationAt must be an ISO 8601 timestamp." }
    if ([string]::IsNullOrWhiteSpace($verificationRevision)) { Add-Issue "Schema 1.1 verificationRevision must not be empty." }
    if ($stageMap.ContainsKey("verifier")) {
        $mutationTime = Convert-IsoTimestamp $lastMutationAt
        $verifierStart = Convert-IsoTimestamp (Get-PropertyValue $stageMap["verifier"] "startedAt")
        if ($null -ne $mutationTime -and $null -ne $verifierStart -and $mutationTime -gt $verifierStart) {
            Add-Issue "Verifier starts before lastMutationAt; verification does not cover the final state."
        }
    }
}

foreach ($action in @((Get-PropertyValue $manifest "remoteActions")) | Where-Object { $null -ne $_ }) {
    foreach ($name in @("type", "write", "authorized")) {
        if (-not (Test-PropertyExists $action $name)) { Add-Issue "A remote action is missing '$name'." }
    }
    $isWrite = [bool](Get-PropertyValue $action "write")
    $isAuthorized = [bool](Get-PropertyValue $action "authorized")
    if ($isWrite -and (-not $remoteWriteAuthorized -or -not $isAuthorized)) {
        Add-Issue "Remote write action requires run-level and action-level authorization."
    }
    if ($isSchema11 -and $isWrite) {
        if ([string]::IsNullOrWhiteSpace([string](Get-PropertyValue $action "scope"))) {
            Add-Issue "Schema 1.1 remote write action requires a non-empty scope."
        }
        if (@("translation-data-write", "business-code-deploy") -notcontains [string](Get-PropertyValue $action "authorizationCategory")) {
            Add-Issue "Schema 1.1 remote write action requires a valid authorizationCategory."
        }
    }
}

foreach ($failure in @((Get-PropertyValue $manifest "failures")) | Where-Object { $null -ne $_ }) {
    foreach ($name in @("signature", "category", "sameSignatureRetryCount", "historicalViolation", "fallback", "result")) {
        if (-not (Test-PropertyExists $failure $name)) { Add-Issue "A failure record is missing '$name'." }
    }
    $category = [string](Get-PropertyValue $failure "category")
    $retryCount = Get-PropertyValue $failure "sameSignatureRetryCount"
    $historicalViolation = [bool](Get-PropertyValue $failure "historicalViolation")
    $unknownReason = [string](Get-PropertyValue $failure "unknownReason")
    if ($null -eq $retryCount) {
        if (-not ($retrospective -and $historicalViolation -and -not [string]::IsNullOrWhiteSpace($unknownReason))) {
            Add-Issue "Failure retry count may be null only for a documented retrospective historical violation."
        }
    } elseif ($category -eq "payload-compilation" -and [int]$retryCount -gt 1 -and -not ($retrospective -and $historicalViolation)) {
        Add-Issue "Equivalent payload-compilation retry count must not exceed 1."
    }
}

$qualityGates = Get-PropertyValue $manifest "qualityGates"
if (-not (Test-PassValue (Get-PropertyValue $qualityGates "handoff"))) { Add-Issue "qualityGates.handoff must be 'pass'." }
if (-not (Test-PassValue (Get-PropertyValue $qualityGates "sensitiveData"))) { Add-Issue "qualityGates.sensitiveData must be 'pass'." }

$objectScriptGate = Get-PropertyValue $qualityGates "objectScript"
$compileStatus = [string](Get-PropertyValue $objectScriptGate "compile")
if (@("pass", "not-authorized", "not-applicable") -notcontains $compileStatus) { Add-Issue "ObjectScript compile gate has invalid status '$compileStatus'." }
if ($compileStatus -eq "not-authorized") {
    if (-not (Test-PassValue (Get-PropertyValue $objectScriptGate "structure"))) { Add-Issue "Uncompiled ObjectScript requires structure=pass." }
    if ([string]::IsNullOrWhiteSpace([string](Get-PropertyValue $objectScriptGate "residualRisk"))) { Add-Issue "Uncompiled ObjectScript requires residualRisk." }
}

$xmlGate = Get-PropertyValue $qualityGates "xml"
if ([bool](Get-PropertyValue $xmlGate "triggered")) {
    foreach ($name in @("metadata", "parse", "residue", "fallback")) {
        if (-not (Test-PassValue (Get-PropertyValue $xmlGate $name))) { Add-Issue "Triggered XML gate requires '$name=pass'." }
    }
}

if ($runMode -eq "multi-agent") {
    $eligible = New-Object System.Collections.Generic.List[object]
    foreach ($name in @("backend-coder", "frontend-coder", "template-seed")) {
        if (-not $stageMap.ContainsKey($name)) { continue }
        $stage = $stageMap[$name]
        if ([string](Get-PropertyValue $stage "status") -ne "completed") { continue }
        $start = Convert-IsoTimestamp (Get-PropertyValue $stage "startedAt")
        $end = Convert-IsoTimestamp (Get-PropertyValue $stage "completedAt")
        if ($null -eq $start -or $null -eq $end) { continue }
        $duration = ($end - $start).TotalSeconds
        if ($duration -ge 60) { $eligible.Add([pscustomobject]@{ Start = $start; End = $end; Duration = $duration }) }
    }
    if ($eligible.Count -ge 2) {
        $sum = ($eligible | Measure-Object -Property Duration -Sum).Sum
        $windowStart = ($eligible | Sort-Object Start | Select-Object -First 1).Start
        $windowEnd = ($eligible | Sort-Object End -Descending | Select-Object -First 1).End
        $window = ($windowEnd - $windowStart).TotalSeconds
        if ($window -gt ($sum * 0.75)) {
            Add-Issue "Parallel window exceeds 75% of eligible stage duration sum."
        } elseif ([string](Get-PropertyValue $qualityGates "parallelEfficiency") -ne "pass") {
            Add-Issue "Eligible multi-agent run requires qualityGates.parallelEfficiency='pass'."
        }
    } elseif ([string](Get-PropertyValue $qualityGates "parallelEfficiency") -ne "not-applicable") {
        Add-Issue "Multi-agent run without two eligible parallel stages requires parallelEfficiency='not-applicable'."
    }
} elseif ([string](Get-PropertyValue $qualityGates "parallelEfficiency") -ne "not-applicable") {
    Add-Issue "$runMode mode requires qualityGates.parallelEfficiency='not-applicable'."
}

Test-SensitiveContent $manifestText "00-run-manifest.json"

if ($issues.Count -gt 0) {
    Write-Host "Agent run validation failed with $($issues.Count) issue(s):"
    foreach ($issue in $issues) { Write-Host "- $issue" }
    exit 1
}

Write-Host "Agent run validation passed: $runMode / $([string](Get-PropertyValue $manifest 'topic'))"
exit 0
