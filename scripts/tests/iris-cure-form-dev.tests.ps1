$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pluginRoot = Join-Path $repoRoot 'plugins\iris-cure-form-dev'
$cli = Join-Path $pluginRoot 'scripts\cure-form.js'
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('iris-cure-form-dev-tests-' + [Guid]::NewGuid().ToString('N'))

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Invoke-Cure {
    param([string[]]$Arguments, [int]$ExpectedExitCode = 0)
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & node $cli @Arguments 2>&1 | Out-String
    $ErrorActionPreference = $previousErrorAction
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne $ExpectedExitCode) {
        throw "cure-form exit code $exitCode, expected $ExpectedExitCode. Output: $output"
    }
    return $output
}

function New-PassedPreviewVerification {
    param(
        [string]$Changes,
        [string]$Snapshot,
        [string]$Name
    )
    $previewRoot = Join-Path $scratch ("preview-" + $Name)
    $arguments = @('preview','--changes',$Changes,'--target-profile',$previewProfile,'--output-root',$previewRoot)
    if ($Snapshot) { $arguments += @('--snapshot',$Snapshot) }
    $preview = Invoke-Cure $arguments | ConvertFrom-Json
    $manifest = Get-Content -LiteralPath $preview.manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $runner = [ordered]@{
        schema = 'cure-form-browser-runner/v1'
        gateVersion = 'cure-form-preview-gate/2'
        manifestHash = $preview.manifestHash
        engine = 'chromium-cdp'
        browser = 'test-fixture'
        browserProduct = 'test-fixture'
        protocolVersion = 'test-fixture'
        completedAt = '2026-01-01T00:00:00.000Z'
    }
    $results = @($manifest.widths | ForEach-Object {
        [ordered]@{
            schema = 'cure-form-browser-result/v1'
            manifestHash = $preview.manifestHash
            width = [int]$_
            resources = @($manifest.resources | ForEach-Object { [ordered]@{ role = $_.role; state = 'loaded' } })
            checks = [ordered]@{
                jqueryAvailable = $true
                parserAvailable = $true
                panelCount = [int]$manifest.expectedRuntime.panelCount
                initializedPanelCount = [int]$manifest.expectedRuntime.panelCount
                radioCount = [int]$manifest.expectedRuntime.radioCount
                generatedRadioLabelCount = [int]$manifest.expectedRuntime.radioCount
                hisuiRadioTargetCount = [int]$manifest.expectedRuntime.hisuiRadioCount
                completeHisuiRadioPairCount = [int]$manifest.expectedRuntime.semanticRadioPairCount
                brokenHisuiRadioPairCount = 0
                unpairedHisuiRadioCount = [int]$manifest.expectedRuntime.hisuiRadioCount - [int]$manifest.expectedRuntime.semanticRadioPairCount
                horizontalOverflow = $false
            }
            networkErrors = @()
            consoleErrors = @()
            runtimeErrors = @()
        }
    })
    $browserResults = Join-Path $previewRoot 'browser-results.json'
    @{ schema = 'cure-form-browser-results/v1'; runner = $runner; results = $results } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $browserResults -Encoding UTF8
    $verification = Join-Path $previewRoot 'preview-verification.json'
    Invoke-Cure @('preview-check','--manifest',$preview.manifest,'--browser-results',$browserResults,'--output',$verification) | Out-Null
    return $verification
}

function New-PassedUserInteractionVerification {
    param(
        [string]$Spec,
        [string]$Changes,
        [string]$Snapshot,
        [string]$PreviewVerification,
        [string]$Name
    )
    $interactionRoot = Join-Path $scratch ("interaction-" + $Name)
    New-Item -ItemType Directory -Force -Path $interactionRoot | Out-Null
    $reportPath = Join-Path $interactionRoot 'interaction-report.json'
    $verificationPath = Join-Path $interactionRoot 'interaction-verification.json'
    $arguments = @('interaction-prepare','--stage','pre-deploy','--spec',$Spec,'--changes',$Changes,'--preview-verification',$PreviewVerification,'--output',$reportPath)
    if ($Snapshot) { $arguments += @('--snapshot',$Snapshot) }
    Invoke-Cure $arguments | Out-Null
    $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $report.execution.mode = 'user-attested'
    $report.execution.testedBy = 'fixture-user'
    $report.execution.testedAt = '2026-01-01T00:00:00.000Z'
    $report.execution.summary = '用户已人工完成清单范围并确认测试通过。'
    $report.execution.overallStatus = 'passed'
    $report | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Invoke-Cure @('interaction-check','--report',$reportPath,'--output',$verificationPath) | Out-Null
    return $verificationPath
}

try {
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null

    $manifest = Get-Content -LiteralPath (Join-Path $pluginRoot '.agents-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($manifest.name -eq 'iris-cure-form-dev') 'Unexpected plugin name.'
    Assert-True ($manifest.version -eq '0.6.0') 'Unexpected plugin version.'
    Assert-True (($manifest.dependencies -contains 'extract-doc') -and ($manifest.dependencies -contains 'coding-iris-plugin')) 'Plugin dependencies are incomplete.'

    foreach ($skill in @('cure-form-init','cure-form-requirement-adapter','cure-assess-form-dev','cure-record-form-dev','cure-form-responsive','make-assess-form-responsive','cure-form-deploy','cure-form-lookup','cure-form-fragment')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $pluginRoot "skills\$skill\SKILL.md")) "Missing skill: $skill"
    }

    & node --check $cli
    if ($LASTEXITCODE -ne 0) { throw 'Node syntax check failed.' }
    $cliContent = Get-Content -LiteralPath $cli -Raw -Encoding UTF8
    Assert-True (($cliContent -match "'preview-run'") -and ($cliContent -match 'cure-form-preview-gate/2')) 'Canonical preview runner or gate v2 is missing.'
    Assert-True (($cliContent -match "'interaction-prepare'") -and ($cliContent -match 'cure-form-interaction-verification/v1')) 'Manual interaction workflow or verification gate is missing.'
    Assert-True ($cliContent -notmatch 'LymphedemaLimb|PhysicalTherapy|CR-PTTemp') 'Canonical migration code must not contain target-project MapCode seeds.'
    Assert-True ($cliContent -notmatch "sourceTemplateRowId:\s*'(?:51|52|53|57|141)'") 'Canonical migration code must not contain target-project template RowID seeds.'
    $stagedTransport = Join-Path $pluginRoot 'scripts\cure-form-staged-transport.js'
    $browserRunner = Join-Path $pluginRoot 'scripts\cure-form-browser-runner.js'
    Assert-True (Test-Path -LiteralPath $stagedTransport -PathType Leaf) 'Persistent staged transport is missing.'
    & node --check $stagedTransport
    if ($LASTEXITCODE -ne 0) { throw 'Persistent staged transport syntax check failed.' }
    Assert-True (Test-Path -LiteralPath $browserRunner -PathType Leaf) 'Canonical Chromium browser runner is missing.'
    & node --check $browserRunner
    if ($LASTEXITCODE -ne 0) { throw 'Canonical Chromium browser runner syntax check failed.' }
    $stagedTransportContent = Get-Content -LiteralPath $stagedTransport -Raw -Encoding UTF8
    Assert-True ($cliContent -match "CURE_FORM_DEPLOY_CLASS = 'DHCDoc\.Cure\.AI\.CureFormDeploy'") 'Main transport must target the canonical cure deployment class.'
    Assert-True ($stagedTransportContent -match "CURE_FORM_DEPLOY_CLASS = 'DHCDoc\.Cure\.AI\.CureFormDeploy'") 'Staged transport must target the canonical cure deployment class.'
    Assert-True ($cliContent -match '##class\(\$\{CURE_FORM_DEPLOY_CLASS\}\)') 'Main transport must build calls from the fixed canonical deployment class.'
    Assert-True (([regex]::Matches($stagedTransportContent, '##class\(\$\{CURE_FORM_DEPLOY_CLASS\}\)')).Count -eq 2) 'Staged transport must use the fixed canonical deployment class for direct and chunked calls.'
    Assert-True (($cliContent -notmatch 'web\.DHCDocAPPBLDeploy') -and ($stagedTransportContent -notmatch 'web\.DHCDocAPPBLDeploy')) 'Runtime transports must not retain the retired deployment class or fallback.'
    Assert-True (($cliContent -match "'PutPackageChunk'") -and ($cliContent -match "'ValidateStagedPackage'") -and ($cliContent -match "'ApplyStagedPackage'") -and ($cliContent -match "'ClearStagedPackage'")) 'Staged package method allowlist is missing.'
    Assert-True (($cliContent -match "call', 'iris_execute'") -and ($cliContent -match 'Base64Decode') -and ($cliContent -match '\$zconvert')) 'Current MCP iris_execute UTF-8 adapter is incomplete.'
    Assert-True (($cliContent -match "'--json-file'") -and ($cliContent -match 'mkdtempSync')) 'Large MCP request payloads must use a temporary JSON file instead of argv.'
    Assert-True (($cliContent -match 'cure-form-staged-transport\.js') -and ($cliContent -match 'confirmStagingWrite')) 'Large deployment packages must use confirmed staged chunk transport.'
    Assert-True (($stagedTransportContent -match 'class McpClient') -and ($stagedTransportContent -match "'PutPackageChunk'") -and ($stagedTransportContent -match "'ClearStagedPackage'")) 'Staged transport must reuse one MCP process and clean temporary stages.'
    Assert-True (($stagedTransportContent -match "'InspectForm'") -and ($stagedTransportContent -match 'RESULT_CHUNK_SIZE')) 'Large InspectForm snapshots must reuse the persistent MCP transport.'
    Assert-True ($cliContent -match 'Server validation rejected the package') 'Remote validation failures must not be reported as valid.'
    Assert-True (-not ($cliContent -match "call', 'iris_execute_method'")) 'Unavailable iris_execute_method must not be used.'
    Assert-True (($cliContent -match 'REMOTE_CHUNK_SIZE') -and ($cliContent -match '\$extract\(value,')) 'Large server snapshot chunking is missing.'
    Assert-True ($cliContent -match 'refusing to repeat a state-changing call') 'Empty write results must not trigger a repeated server write.'
    Assert-True (($cliContent -match "invokeServer\('ValidatePackage'") -and ($cliContent -match "invokeServer\('ApplyPackage'")) 'ValidatePackage and ApplyPackage must remain separate deployment paths.'
    Assert-True ($cliContent -match 'if \(!args\.confirmWrite\)') 'Apply must preserve the default dry-run branch before any remote write.'
    Assert-True (($cliContent -match "'consolidate'") -and ($cliContent -match "invokeServer\('ValidateConsolidation'") -and ($cliContent -match "invokeServer\('ApplyConsolidation'")) 'Consolidation must expose separate dry-run and write paths.'
    Assert-True (($stagedTransportContent -match "'InspectConsolidation'") -and ($stagedTransportContent -match "'ValidateConsolidation'") -and ($stagedTransportContent -match "'ApplyConsolidation'")) 'Persistent transport is missing consolidation methods.'
    Assert-True (($cliContent -match "'cleanup'") -and ($cliContent -match "invokeServer\('ValidateCleanup'") -and ($cliContent -match "invokeServer\('ApplyCleanup'")) 'Cleanup must expose separate dry-run and write paths.'
    Assert-True (($stagedTransportContent -match "'InspectCleanup'") -and ($stagedTransportContent -match "'ValidateCleanup'") -and ($stagedTransportContent -match "'ApplyCleanup'")) 'Persistent transport is missing cleanup methods.'
    Assert-True (($cliContent -match "'consolidate-shared'") -and ($cliContent -match "invokeServer\('ValidateSharedConsolidation'") -and ($cliContent -match "invokeServer\('ApplySharedConsolidation'")) 'Shared consolidation must expose separate dry-run and write paths.'
    Assert-True (($stagedTransportContent -match "'InspectSharedConsolidation'") -and ($stagedTransportContent -match "'ValidateSharedConsolidation'") -and ($stagedTransportContent -match "'ApplySharedConsolidation'")) 'Persistent transport is missing shared consolidation methods.'

    $consolidationSnapshotPath = Join-Path $scratch 'consolidation.snapshot.json'
    $consolidationPackagePath = Join-Path $scratch 'consolidation.package.json'
    $sourceContent = '<div id="FormalRoot" class="hisui-panel cure-form-responsive assess-form assess-form--responsive"><table class="item-table assess-form-grid"><tr><td><input id="ChoiceA" class="hisui-radio" type="radio" name="Choice" value="A"><label class="i-label-box" for="ChoiceA">A</label></td></tr></table></div>'
    $targetContent = '<div id="FormalRoot" class="hisui-panel"><table class="item-table"><tr><td><input id="ChoiceA" class="hisui-radio" type="radio" name="Choice" value="A"><label class="i-label-box" for="ChoiceA">A</label></td></tr></table></div>'
    $consolidationSnapshot = [ordered]@{
        schema = 'cure-form-consolidation-snapshot/v1'
        formType = 'CA'
        mapCode = 'FixtureMap'
        version = 3
        contentHash = 'fixture-current-hash'
        mappings = @([ordered]@{
            source = [ordered]@{ rowId = '900'; name = '响应式灰度'; appId = 'FormalRoot'; mapType = 'CA'; lastId = '100'; content = $sourceContent; js = ''; items = @([ordered]@{ rowId = '1900'; id = 'ChoiceA'; templateRowId = '900' }) }
            target = [ordered]@{ rowId = '100'; name = '正式模板'; appId = 'FormalRoot'; mapType = 'CA'; lastId = '0'; content = $targetContent; js = ''; items = @([ordered]@{ rowId = '1100'; id = 'ChoiceA'; templateRowId = '100' }) }
            sourceContentHash = 'server-source-hash'
            targetContentHash = 'server-target-hash'
            sourceCacheContractHash = 'server-cache-hash'
            targetCacheContractHash = 'server-cache-hash'
        })
    }
    $consolidationSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $consolidationSnapshotPath -Encoding UTF8
    Invoke-Cure @('consolidate','--snapshot',$consolidationSnapshotPath,'--expected-count','1','--output',$consolidationPackagePath) | Out-Null
    $consolidationPackage = Get-Content -LiteralPath $consolidationPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (($consolidationPackage.schema -eq 'cure-form-consolidation/v1') -and ($consolidationPackage.mappings.Count -eq 1)) 'Consolidation package generation failed.'
    Assert-True (($consolidationPackage.mappings[0].sourceContentHash -eq 'server-source-hash') -and ($consolidationPackage.mappings[0].cacheContractHash -eq 'server-cache-hash')) 'Consolidation package must bind server-computed hashes.'
    $consolidationDryRun = Invoke-Cure @('consolidate','--package',$consolidationPackagePath)
    Assert-True ($consolidationDryRun -match '"dryRun": true') 'Consolidation must default to offline dry-run.'
    $countDrift = Invoke-Cure @('consolidate','--snapshot',$consolidationSnapshotPath,'--expected-count','8','--output',(Join-Path $scratch 'count-drift.json')) 1
    Assert-True ($countDrift -match 'mapping count changed') 'Consolidation must reject mapping-count drift.'
    $badCacheSnapshot = $consolidationSnapshot | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $badCacheSnapshot.mappings[0].target.items[0].id = 'ChangedCache'
    $badCachePath = Join-Path $scratch 'consolidation.bad-cache.json'
    $badCacheSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $badCachePath -Encoding UTF8
    $badCache = Invoke-Cure @('consolidate','--snapshot',$badCachePath,'--output',(Join-Path $scratch 'bad-cache.package.json')) 1
    Assert-True ($badCache -match 'Cache field contract differs') 'Consolidation must reject cache-contract drift.'
    $badDomSnapshot = $consolidationSnapshot | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $badDomSnapshot.mappings[0].target.content = $targetContent.Replace('ChoiceA','ChoiceB')
    $badDomPath = Join-Path $scratch 'consolidation.bad-dom.json'
    $badDomSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $badDomPath -Encoding UTF8
    $badDom = Invoke-Cure @('consolidate','--snapshot',$badDomPath,'--output',(Join-Path $scratch 'bad-dom.package.json')) 1
    Assert-True ($badDom -match 'DOM/radio contract differs') 'Consolidation must reject DOM/radio-contract drift.'

    $sharedSnapshotPath = Join-Path $scratch 'shared-consolidation.snapshot.json'
    $sharedPackagePath = Join-Path $scratch 'shared-consolidation.package.json'
    $sharedSourceContent = '<div id="SharedRoot" class="hisui-panel assess-form assess-form--responsive"><table class="item-table assess-form-grid"><tr><td><input id="SharedChoice" class="hisui-radio" type="radio" name="Shared" value="Y"><label class="i-label-box" for="SharedChoice">Y</label></td></tr></table></div>'
    $sharedTargetContent = '<div id="SharedRoot" class="hisui-panel"><table class="item-table"><tr><td><input id="SharedChoice" class="hisui-radio" type="radio" name="Shared" value="Y"><label class="i-label-box" for="SharedChoice">Y</label></td></tr></table></div>'
    $sharedSnapshot = [ordered]@{
        schema = 'cure-form-shared-consolidation-snapshot/v1'; formType = 'CA'; scopeId = 'shared-fixture'
        sourceIds = '900'; targetIds = '100'; contentHash = 'shared-inspection-hash'; error = ''
        mappings = @([ordered]@{ sourceRowId='900'; targetRowId='100'; appId='SharedRoot'; sourceContentHash='shared-source-content'; targetContentHash='shared-target-content'; sourceSnapshotHash='shared-source-snapshot'; targetSnapshotHash='shared-target-snapshot'; sourceReferenceCount=1; targetReferenceCount=2; sourceCacheContractHash='shared-cache'; targetCacheContractHash='shared-cache'; sourceCacheDuplicate=0; targetCacheDuplicate=0 })
        sourceTemplates = @([ordered]@{ rowId='900'; name='共享灰度'; appId='SharedRoot'; mapType='CA'; lastId='0'; content=$sharedSourceContent; js=''; items=@([ordered]@{rowId='1900';id='SharedChoice';templateRowId='900'}) })
        targetTemplates = @([ordered]@{ rowId='100'; name='共享正式'; appId='SharedRoot'; mapType='CA'; lastId='0'; content=$sharedTargetContent; js=''; items=@([ordered]@{rowId='1100';id='SharedChoice';templateRowId='100'}) })
        maps = @([ordered]@{ rowId='77'; code='SharedMap'; name='共享Map'; showTemp='900||200'; active='Y'; mapType='CA' })
    }
    $sharedSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $sharedSnapshotPath -Encoding UTF8
    Invoke-Cure @('consolidate-shared','--snapshot',$sharedSnapshotPath,'--expected-count','1','--expected-map-count','1','--output',$sharedPackagePath) | Out-Null
    $sharedPackage = Get-Content -LiteralPath $sharedPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (($sharedPackage.schema -eq 'cure-form-shared-consolidation/v1') -and ($sharedPackage.mappings.Count -eq 1) -and ($sharedPackage.maps.Count -eq 1)) 'Shared consolidation package generation failed.'
    Assert-True (($sharedPackage.maps[0].beforeComposition -eq '900||200') -and ($sharedPackage.maps[0].afterComposition -eq '100||200')) 'Shared consolidation must preserve Map order while replacing RowIDs.'
    $sharedDryRun = Invoke-Cure @('consolidate-shared','--package',$sharedPackagePath)
    Assert-True ($sharedDryRun -match '"dryRun": true') 'Shared consolidation must default to offline dry-run.'
    $duplicateSharedPackage = $sharedPackage | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $duplicateSharedPackage.mappings = @($duplicateSharedPackage.mappings[0], $duplicateSharedPackage.mappings[0])
    $duplicateSharedPackagePath = Join-Path $scratch 'shared-duplicate-mapping.package.json'
    $duplicateSharedPackage | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $duplicateSharedPackagePath -Encoding UTF8
    $duplicateSharedMapping = Invoke-Cure @('consolidate-shared','--package',$duplicateSharedPackagePath) 1
    Assert-True ($duplicateSharedMapping -match 'one-to-one') 'Shared consolidation package validation must reject duplicate mappings.'
    $driftedSharedPackage = $sharedPackage | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $driftedSharedPackage.maps[0].afterComposition = '200||100'
    $driftedSharedPackagePath = Join-Path $scratch 'shared-composition-drift.package.json'
    $driftedSharedPackage | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $driftedSharedPackagePath -Encoding UTF8
    $driftedSharedComposition = Invoke-Cure @('consolidate-shared','--package',$driftedSharedPackagePath) 1
    Assert-True ($driftedSharedComposition -match 'afterComposition does not match') 'Shared consolidation package validation must reject Map composition drift.'
    $sharedMapDrift = Invoke-Cure @('consolidate-shared','--snapshot',$sharedSnapshotPath,'--expected-map-count','26','--output',(Join-Path $scratch 'shared-map-drift.json')) 1
    Assert-True ($sharedMapDrift -match 'Map count changed') 'Shared consolidation must reject affected-Map-count drift.'
    $duplicateSharedSnapshot = $sharedSnapshot | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $duplicateSharedSnapshot.maps[0].showTemp = '100||900'
    $duplicateSharedPath = Join-Path $scratch 'shared-duplicate.json'
    $duplicateSharedSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $duplicateSharedPath -Encoding UTF8
    $duplicateShared = Invoke-Cure @('consolidate-shared','--snapshot',$duplicateSharedPath,'--output',(Join-Path $scratch 'shared-duplicate.package.json')) 1
    Assert-True ($duplicateShared -match 'duplicate template RowIDs') 'Shared consolidation must reject duplicate target RowIDs in a Map.'

    $cleanupSnapshotPath = Join-Path $scratch 'cleanup.snapshot.json'
    $cleanupPackagePath = Join-Path $scratch 'cleanup.package.json'
    $cleanupSnapshot = [ordered]@{
        schema = 'cure-form-cleanup-snapshot/v1'
        formType = 'CA'
        scopeId = 'cleanup-fixture'
        sourceIds = @('10')
        replacementIds = @('20')
        contentHash = 'server-cleanup-inspection-hash'
        entries = @([ordered]@{
            sourceRowId = '10'; replacementRowId = '20'; appId = 'CleanupRoot'
            sourceReferenceCount = 0; replacementReferenceCount = 1
            sourceContentHash = 'source-content-hash'; replacementContentHash = 'replacement-content-hash'
            sourceSnapshotHash = 'source-snapshot-hash'; replacementSnapshotHash = 'replacement-snapshot-hash'
        })
        sourceTemplates = @([ordered]@{
            rowId = '10'; name = '旧模板'; appId = 'CleanupRoot'; mapType = 'CA'; lastId = '0'
            content = '<div id="CleanupRoot" class="hisui-panel"><table class="item-table"><tr><td>旧模板</td></tr></table></div>'
            js = ''; items = @([ordered]@{ rowId = '1010'; id = 'CleanupField'; templateRowId = '10' })
        })
        replacementTemplates = @([ordered]@{
            rowId = '20'; name = '响应式模板'; appId = 'CleanupRoot'; mapType = 'CA'; lastId = '10'
            content = '<div id="CleanupRoot" class="hisui-panel assess-form assess-form--responsive"><table class="item-table assess-form-grid"><tr><td>响应式模板</td></tr></table></div>'
            js = ''; items = @([ordered]@{ rowId = '1020'; id = 'CleanupField'; templateRowId = '20' })
        })
        error = ''
    }
    $cleanupSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $cleanupSnapshotPath -Encoding UTF8
    Invoke-Cure @('cleanup','--snapshot',$cleanupSnapshotPath,'--expected-count','1','--output',$cleanupPackagePath) | Out-Null
    $cleanupPackage = Get-Content -LiteralPath $cleanupPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (($cleanupPackage.schema -eq 'cure-form-cleanup/v1') -and ($cleanupPackage.entries.Count -eq 1)) 'Cleanup package generation failed.'
    Assert-True (($cleanupPackage.inspectionHash -eq 'server-cleanup-inspection-hash') -and ($cleanupPackage.entries[0].sourceSnapshotHash -eq 'source-snapshot-hash')) 'Cleanup package must bind server-computed hashes.'
    $cleanupDryRun = Invoke-Cure @('cleanup','--package',$cleanupPackagePath)
    Assert-True ($cleanupDryRun -match '"dryRun": true') 'Cleanup must default to offline dry-run.'
    $cleanupCountDrift = Invoke-Cure @('cleanup','--snapshot',$cleanupSnapshotPath,'--expected-count','18','--output',(Join-Path $scratch 'cleanup-count-drift.json')) 1
    Assert-True ($cleanupCountDrift -match 'template count changed') 'Cleanup must reject template-count drift.'
    $referencedCleanupSnapshot = $cleanupSnapshot | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $referencedCleanupSnapshot.entries[0].sourceReferenceCount = 1
    $referencedCleanupPath = Join-Path $scratch 'cleanup.referenced.json'
    $referencedCleanupSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $referencedCleanupPath -Encoding UTF8
    $referencedCleanup = Invoke-Cure @('cleanup','--snapshot',$referencedCleanupPath,'--output',(Join-Path $scratch 'cleanup.referenced.package.json')) 1
    Assert-True ($referencedCleanup -match 'still referenced') 'Cleanup must reject a referenced source template.'
    $nonresponsiveReplacementSnapshot = $cleanupSnapshot | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $nonresponsiveReplacementSnapshot.replacementTemplates[0].content = $nonresponsiveReplacementSnapshot.replacementTemplates[0].content.Replace(' assess-form--responsive','')
    $nonresponsiveReplacementPath = Join-Path $scratch 'cleanup.nonresponsive-replacement.json'
    $nonresponsiveReplacementSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $nonresponsiveReplacementPath -Encoding UTF8
    $nonresponsiveReplacement = Invoke-Cure @('cleanup','--snapshot',$nonresponsiveReplacementPath,'--output',(Join-Path $scratch 'cleanup.nonresponsive-replacement.package.json')) 1
    Assert-True ($nonresponsiveReplacement -match 'is not responsive') 'Cleanup must reject a nonresponsive replacement template.'
    $styleBoundaryFiles = @(
        (Join-Path $pluginRoot 'rules\cure_form_workflow.md'),
        (Join-Path $pluginRoot 'rules\cure_form_deploy.md'),
        (Join-Path $pluginRoot 'references\cure-form-responsive-compatibility.md')
    )
    $styleBoundaryText = ($styleBoundaryFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw -Encoding UTF8 }) -join "`n"
    Assert-True ($styleBoundaryText -notmatch '(?i)[A-Z]:[\\/][^\r\n`]*adaptation\.css') 'Plugin governance must not hardcode a project-specific public responsive CSS path.'
    Assert-True (($styleBoundaryText -match '已改造表单.*快照') -and ($styleBoundaryText -match '两阶段')) 'Plugin governance must require compatibility snapshots and a two-stage migration for existing forms.'
    $lifecycleBoundaryFiles = @(
        (Join-Path $pluginRoot 'AGENTS.md'),
        (Join-Path $pluginRoot 'README.md'),
        (Join-Path $pluginRoot 'rules\cure_form_workflow.md'),
        (Join-Path $pluginRoot 'skills\cure-form-responsive\SKILL.md'),
        (Join-Path $pluginRoot 'skills\cure-form-deploy\SKILL.md')
    )
    $lifecycleBoundaryText = ($lifecycleBoundaryFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw -Encoding UTF8 }) -join "`n"
    Assert-True ($lifecycleBoundaryText -match '新开发表单[^\r\n]*(不使用|不进入|无需)[^\r\n]*灰度') 'New form development must remain outside the grey-template lifecycle.'
    Assert-True (($lifecycleBoundaryText -match '现有模板改造[^\r\n]*consolidate') -and ($lifecycleBoundaryText -match 'consolidate-shared')) 'Existing template retrofit must require the appropriate consolidation command.'
    Assert-True ($lifecycleBoundaryText -match '灰度[^\r\n]*(引用数|引用)[^\r\n]*0') 'Existing template retrofit completion must require zero grey references.'
    Assert-True (($styleBoundaryText -match '24 个字符') -and ($styleBoundaryText -match 'camelCase') -and ($styleBoundaryText -match '引用路径.*basename.*一致')) 'Plugin governance must constrain deployment asset names by semantics and length.'
    Assert-True ($cliContent -notmatch '\.\./scripts_lib/(?:hisui|com)') 'Canonical generator must not hardcode target-project preview resource paths.'
    $profileTemplateContent = Get-Content -LiteralPath (Join-Path $pluginRoot 'templates\cure_form_profile.template.md') -Raw -Encoding UTF8
    foreach ($profileKey in @('PreviewHisuiCss','PreviewJqueryJs','PreviewHisuiJs','PreviewHisuiLocaleJs','PreviewAsscomCss','PreviewAdaptationCss','PreviewBrowserCommand','CommonMigrationConfig')) {
        Assert-True ($profileTemplateContent -match [regex]::Escape($profileKey)) "Profile template is missing $profileKey."
    }
    Assert-True (([regex]::Matches($profileTemplateContent, '\.agents/vendor/hisui/')).Count -eq 4) 'New target profiles must resolve HISUI, jQuery, and locale from the deployed vendor/hisui runtime.'

    $previewAssetRoot = Join-Path $scratch 'preview-assets'
    New-Item -ItemType Directory -Force -Path $previewAssetRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\hisui\dist\js\jquery-1.11.3.min.js') -Destination (Join-Path $previewAssetRoot 'jquery-1.11.3.min.js')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\hisui\dist\js\jquery.hisui.min.js') -Destination (Join-Path $previewAssetRoot 'jquery.hisui.min.js')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\hisui\dist\js\locale\hisui-lang-zh_CN.js') -Destination (Join-Path $previewAssetRoot 'hisui-lang-zh_CN.js')
    New-Item -ItemType Directory -Force -Path (Join-Path $previewAssetRoot 'theme') | Out-Null
    '.fixture-theme { display: block; }' | Set-Content -LiteralPath (Join-Path $previewAssetRoot 'theme\fixture.css') -Encoding UTF8
    '@import "theme/fixture.css"; .item-table { width: 100%; }' | Set-Content -LiteralPath (Join-Path $previewAssetRoot 'asscom.css') -Encoding UTF8
    '.assess-form { max-width: 100%; }' | Set-Content -LiteralPath (Join-Path $previewAssetRoot 'adaptation.css') -Encoding UTF8
    $migrationConfig = Join-Path $scratch 'common-migration-config.json'
    @{
        schema = 'cure-form-common-migration-config/v1'
        priorityMapCodes = @('CanaryCA')
        publicTemplates = @(
            @{ sourceTemplateRowId = '901'; formTypes = @('CA','CR') },
            @{ sourceTemplateRowId = '902'; formTypes = @('CR') }
        )
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $migrationConfig -Encoding UTF8
    $previewProfile = Join-Path $scratch 'cure_form_profile.md'
    @(
        '# Cure Form Profile',
        '',
        "- PreviewHisuiCss: $(Join-Path $repoRoot 'vendor\hisui\dist\css\hisui.pure.min.css')",
        "- PreviewJqueryJs: $(Join-Path $previewAssetRoot 'jquery-1.11.3.min.js')",
        "- PreviewHisuiJs: $(Join-Path $previewAssetRoot 'jquery.hisui.min.js')",
        "- PreviewHisuiLocaleJs: $(Join-Path $previewAssetRoot 'hisui-lang-zh_CN.js')",
        "- PreviewAsscomCss: $(Join-Path $previewAssetRoot 'asscom.css')",
        "- PreviewAdaptationCss: $(Join-Path $previewAssetRoot 'adaptation.css')",
        "- CommonMigrationConfig: $migrationConfig"
    ) | Set-Content -LiteralPath $previewProfile -Encoding UTF8

    $structurePath = Join-Path $scratch 'structure.json'
    @{
        schemaVersion = 'extract-doc/structure-v1'
        sourceFile = 'hospital-form.xlsx'
        sourceHash = ('a' * 64)
        converter = 'test-fixture'
        requiresVisualExtraction = $false
        paragraphs = @(@{ index = 0; text = 'Assessment' })
        tables = @(@{
            index = 0
            cells = @(
                @{ row = 1; column = 1; text = 'Pain:' },
                @{ row = 2; column = 1; text = 'Score:' }
            )
        })
        diagnostics = @()
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $structurePath -Encoding UTF8

    $caSpec = Join-Path $scratch 'CAForm.cure-form-spec.json'
    Invoke-Cure @('intake','--structure',$structurePath,'--form-type','CA','--module-id','CAForm','--output',$caSpec) | Out-Null
    $ca = Get-Content -LiteralPath $caSpec -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($ca.schema -eq 'cure-form-spec/v1') 'CA specification schema mismatch.'
    Assert-True ($ca.fields.Count -gt 0) 'CA intake produced no candidate fields.'
    Assert-True ($ca.unresolved.Count -gt 0) 'CA intake must require semantic review.'
    $failedReview = Invoke-Cure @('review','--spec',$caSpec,'--approved-by','tester') 1
    Assert-True ($failedReview -match 'unresolved') 'Unresolved review was not blocked.'

    $ca.unresolved = @()
    $ca.fields[0].control = 'number'
    $ca.fields[0] | Add-Member -NotePropertyName min -NotePropertyValue 0
    $ca.fields[0] | Add-Member -NotePropertyName max -NotePropertyValue 100
    $ca.calculations = @(@{ id = 'score-total'; title = '评分计算联动'; inputs = @($ca.fields[0].id); output = $ca.fields[0].id; expected = '计算结果符合规格。' })
    $ca.visibilityRules = @(@{ id = 'score-visibility'; title = '评分显隐联动'; inputs = @($ca.fields[0].id); targets = @($ca.fields[0].id); expected = '显隐结果符合规格。' })
    $ca | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $caSpec -Encoding UTF8
    Invoke-Cure @('review','--spec',$caSpec,'--approved-by','tester') | Out-Null
    $ca = Get-Content -LiteralPath $caSpec -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($ca.approval.unresolvedCount -eq 0) 'CA approval was not recorded.'

    $generatedRoot = Join-Path $scratch 'generated'
    Invoke-Cure @('prepare','--mode','create','--spec',$caSpec,'--output-root',$generatedRoot,'--target-profile',$previewProfile) | Out-Null
    foreach ($name in @('CAForm.html','CAForm.js','CAForm.fragment.html','cure-form-spec.json','cure-form-deploy-changes.json')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $generatedRoot "CAForm\$name")) "Missing generated CA artifact: $name"
    }

    $docsProject = Join-Path $scratch 'docs-default-project'
    $docsStructure = Join-Path $docsProject 'fixture-structure.json'
    New-Item -ItemType Directory -Force -Path $docsProject | Out-Null
    Copy-Item -LiteralPath $structurePath -Destination $docsStructure
    Invoke-Cure @('intake','--structure',$docsStructure,'--form-type','CA','--module-id','DocsDefaultForm','--project-root',$docsProject) | Out-Null
    $docsModuleRoot = Join-Path $docsProject 'docs\cure-form\DocsDefaultForm'
    $docsDefaultSpec = Join-Path $docsModuleRoot 'cure-form-spec.json'
    Assert-True (Test-Path -LiteralPath $docsDefaultSpec) 'Default intake specification must be written under docs/cure-form/<moduleId>.'
    Assert-True (Test-Path -LiteralPath (Join-Path $docsModuleRoot 'intake-report.md')) 'Default intake report must be written under docs/cure-form/<moduleId>.'
    $docsSpecValue = Get-Content -LiteralPath $docsDefaultSpec -Raw -Encoding UTF8 | ConvertFrom-Json
    $docsSpecValue.unresolved = @()
    $docsSpecValue | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $docsDefaultSpec -Encoding UTF8
    Invoke-Cure @('review','--spec',$docsDefaultSpec,'--approved-by','tester') | Out-Null
    Invoke-Cure @('prepare','--mode','create','--spec','docs\cure-form\DocsDefaultForm\cure-form-spec.json','--project-root',$docsProject,'--target-profile',$previewProfile) | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $docsModuleRoot 'DocsDefaultForm.html')) 'Default create output must be written under docs/cure-form/<moduleId>.'

    $ambiguousProject = Join-Path $scratch 'ambiguous-docs-project'
    $ambiguousDocs = Join-Path $ambiguousProject 'docs'
    New-Item -ItemType Directory -Force -Path $ambiguousDocs | Out-Null
    New-Item -ItemType File -Force -Path (Join-Path $ambiguousDocs 'first.docx'), (Join-Path $ambiguousDocs 'second.pdf') | Out-Null
    $ambiguousResult = Invoke-Cure @('intake','--form-type','CA','--module-id','AmbiguousForm','--project-root',$ambiguousProject) 1
    Assert-True ($ambiguousResult -match 'Multiple requirement documents') 'Multiple docs candidates must require explicit --source selection.'

    $xlsxStructurePath = Join-Path $scratch 'xlsx-structure.json'
    $xlsxCells = @()
    $boundaryTemplates = @()
    for ($index = 1; $index -le 9; $index++) {
        $column = [char](64 + $index)
        $xlsxCells += @(
            @{ coordinate = "${column}1"; row = 1; column = $index; value = "模板$index"; displayedValue = "模板$index"; formula = ''; dataType = 's' },
            @{ coordinate = "${column}2"; row = 2; column = $index; value = "字段$index"; displayedValue = "字段$index"; formula = ''; dataType = 's' }
        )
        $boundary = @{
            order = $index
            key = "template-$index"
            title = "模板$index"
        }
        if ($index -eq 9) {
            $boundary.sourceRanges = @("${column}1:${column}1", "${column}2:${column}2")
        }
        else {
            $boundary.sourceRange = "${column}1:${column}2"
        }
        $boundaryTemplates += $boundary
    }
    @{
        schemaVersion = 'extract-doc/structure-v1'
        sourceFile = 'multi-template.xlsx'
        sourceHash = ('b' * 64)
        converter = 'xlsx-test-fixture'
        requiresVisualExtraction = $false
        sheets = @(@{
            name = 'Sheet1'
            maxRow = 2
            maxColumn = 9
            mergedRanges = @()
            dataValidations = @()
            cells = $xlsxCells
        })
        diagnostics = @()
    } | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $xlsxStructurePath -Encoding UTF8
    $boundariesPath = Join-Path $scratch 'template-boundaries.json'
    @{
        schema = 'cure-form-template-boundaries/v1'
        sheet = 'Sheet1'
        expectedTemplateCount = 9
        templates = $boundaryTemplates
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $boundariesPath -Encoding UTF8
    $multiSpecPath = Join-Path $scratch 'MultiForm.cure-form-spec.json'
    $multiReportPath = Join-Path $scratch 'MultiForm.intake.md'
    Invoke-Cure @('intake','--structure',$xlsxStructurePath,'--form-type','CA','--module-id','MultiForm','--template-boundaries',$boundariesPath,'--report',$multiReportPath,'--output',$multiSpecPath) | Out-Null
    $multi = Get-Content -LiteralPath $multiSpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($multi.templates.Count -eq 9) 'Multi-template intake must preserve exactly nine configured boundaries.'
    Assert-True ($multi.fields.Count -eq 9) 'Multi-template intake must preserve one candidate field per fixture template.'
    Assert-True ($multi.sourceStructure.populatedExtent.endColumn -eq 9) 'Workbook populated extent was not preserved.'
    Assert-True (Test-Path -LiteralPath $multiReportPath) 'Multi-template intake report was not generated.'

    $splitMergeStructurePath = Join-Path $scratch 'split-merge-structure.json'
    @{
        schemaVersion = 'extract-doc/structure-v1'
        sourceFile = 'split-merge.xlsx'
        sourceHash = ('c' * 64)
        converter = 'xlsx-test-fixture'
        requiresVisualExtraction = $false
        sheets = @(@{
            name = 'Sheet1'
            maxRow = 2
            maxColumn = 2
            mergedRanges = @('A1:B1')
            dataValidations = @()
            cells = @(
                @{ coordinate = 'A1'; row = 1; column = 1; value = '跨边界标题'; displayedValue = '跨边界标题'; formula = ''; dataType = 's' },
                @{ coordinate = 'A2'; row = 2; column = 1; value = '字段A'; displayedValue = '字段A'; formula = ''; dataType = 's' },
                @{ coordinate = 'B2'; row = 2; column = 2; value = '字段B'; displayedValue = '字段B'; formula = ''; dataType = 's' }
            )
        })
        diagnostics = @()
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $splitMergeStructurePath -Encoding UTF8
    $splitMergeBoundariesPath = Join-Path $scratch 'split-merge-boundaries.json'
    @{
        schema = 'cure-form-template-boundaries/v1'
        sheet = 'Sheet1'
        expectedTemplateCount = 2
        templates = @(
            @{ order = 1; key = 'left'; title = '左模板'; sourceRange = 'A1:A2' },
            @{ order = 2; key = 'right'; title = '右模板'; sourceRange = 'B1:B2' }
        )
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $splitMergeBoundariesPath -Encoding UTF8
    $splitMergeSpecPath = Join-Path $scratch 'SplitMerge.cure-form-spec.json'
    Invoke-Cure @('intake','--structure',$splitMergeStructurePath,'--form-type','CA','--module-id','SplitMerge','--template-boundaries',$splitMergeBoundariesPath,'--output',$splitMergeSpecPath) | Out-Null
    $splitMergeSpec = Get-Content -LiteralPath $splitMergeSpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (@($splitMergeSpec.unresolved | Where-Object code -eq 'TEMPLATE_MERGE_SPLIT').Count -eq 1) 'A merged range split across template boundaries must be blocked.'

    foreach ($template in $multi.templates) {
        $template.rootId = "MultiForm_$($template.order)"
        $template.moduleName = "MultiFormTemplate$($template.order)"
    }
    $multi | Add-Member -NotePropertyName templateCategory -NotePropertyValue ([pscustomobject]@{
        name = 'Multi Form Category'
        appId = 'MultiForm'
        type = 'CATEGORY'
    })
    $multi.templates[0] | Add-Member -NotePropertyName fragmentHtml -NotePropertyValue '<div id="MultiForm_1" class="hisui-panel assess-form assess-form--responsive override-fixture" data-options="border:false"><label for="field_candidate_template_1_a2">字段1</label><input id="field_candidate_template_1_a2" class="textbox" type="text" data-cache-tag="field_candidate_template_1_a2"></div>'
    $multi.templates[0] | Add-Member -NotePropertyName javascript -NotePropertyValue "'use strict';`nvar MultiFormTemplate1 = (function () { function Init() {} function OtherInfo() { return ''; } function PrintInfo() { return ''; } return { Init: Init, OtherInfo: OtherInfo, PrintInfo: PrintInfo }; }());`n"
    $multi.templates[0] | Add-Member -NotePropertyName javascriptHref -NotePropertyValue 'scripts/dhcdoc/dhcdoccure_hui/asstemp/multiFormTemplate1.js'
    $multi.templates[0] | Add-Member -NotePropertyName javascriptDeploymentPath -NotePropertyValue 'asstemp/multiFormTemplate1.js'
    foreach ($field in $multi.fields) {
        $field.control = 'text'
        $field.candidate = $false
    }
    $multi | Add-Member -NotePropertyName stylesheets -NotePropertyValue @(@{
        path = 'MultiForm.css'
        loadMode = 'template'
        runtimeHref = '../asstemp/css/multiForm.css'
        deploymentPath = 'asstemp/css/multiForm.css'
        content = '.multi-form-skin { color: #123456; }'
    })
    $multi | Add-Member -NotePropertyName scriptHref -NotePropertyValue 'scripts/dhcdoc/dhcdoccure_hui/asstemp/multiForm.js'
    $multi | Add-Member -NotePropertyName scriptDeploymentPath -NotePropertyValue 'asstemp/multiForm.js'
    $multi | Add-Member -NotePropertyName aggregateTemplateInit -NotePropertyValue $true
    $multi | Add-Member -NotePropertyName publicStylesheets -NotePropertyValue ([pscustomobject]@{
        baseHref = '../project-assets/css/common-form.css'
        responsiveHref = '../project-assets/css/project-responsive.css'
    })
    $multi.unresolved = @()
    $missingTemplateHrefSpec = Join-Path $scratch 'MultiForm.missing-template-href.cure-form-spec.json'
    $missingTemplateHref = $multi | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $missingTemplateHref.templates[0].PSObject.Properties.Remove('javascriptHref')
    $missingTemplateHref | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $missingTemplateHrefSpec -Encoding UTF8
    Assert-True ((Invoke-Cure @('review','--spec',$missingTemplateHrefSpec,'--approved-by','tester') 1) -match 'javascriptHref') 'Template logic without an external JavaScript reference must be rejected.'
    $missingScriptHrefSpec = Join-Path $scratch 'MultiForm.missing-script-href.cure-form-spec.json'
    $missingScriptHref = $multi | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $missingScriptHref.PSObject.Properties.Remove('scriptHref')
    $missingScriptHref | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $missingScriptHrefSpec -Encoding UTF8
    Assert-True ((Invoke-Cure @('review','--spec',$missingScriptHrefSpec,'--approved-by','tester') 1) -match 'scriptHref') 'Host-loaded form JavaScript without a runtime reference must be rejected.'
    $longResourceSpec = Join-Path $scratch 'MultiForm.long-resource.cure-form-spec.json'
    $longResource = $multi | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $longResource.scriptHref = 'scripts/dhcdoc/dhcdoccure_hui/asstemp/bodyStructureFunctionAssessment.js'
    $longResource.scriptDeploymentPath = 'asstemp/bodyStructureFunctionAssessment.js'
    $longResource | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $longResourceSpec -Encoding UTF8
    Assert-True ((Invoke-Cure @('review','--spec',$longResourceSpec,'--approved-by','tester') 1) -match 'at most 24 characters') 'Overlong deployment resource basenames must be rejected.'
    $multi | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $multiSpecPath -Encoding UTF8
    Invoke-Cure @('review','--spec',$multiSpecPath,'--approved-by','tester') | Out-Null
    $publicResponsiveCss = Join-Path $scratch 'public-responsive.css'
    $publicResponsiveCssCopy = Join-Path $scratch 'public-responsive-copy.css'
    '.assess-form { max-width: 100%; }' | Set-Content -LiteralPath $publicResponsiveCss -Encoding UTF8
    Copy-Item -LiteralPath $publicResponsiveCss -Destination $publicResponsiveCssCopy
    Invoke-Cure @('prepare','--mode','create','--spec',$multiSpecPath,'--output-root',$generatedRoot,'--target-profile',$previewProfile,'--public-responsive-css',$publicResponsiveCss,'--public-responsive-css-copy',$publicResponsiveCssCopy) | Out-Null
    $multiChanges = Get-Content -LiteralPath (Join-Path $generatedRoot 'MultiForm\cure-form-deploy-changes.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $multiHtml = Get-Content -LiteralPath (Join-Path $generatedRoot 'MultiForm\MultiForm.html') -Raw -Encoding UTF8
    $overrideFragment = Get-Content -LiteralPath (Join-Path $generatedRoot 'MultiForm\templates\01-template-1.fragment.html') -Raw -Encoding UTF8
    $generatedStylesheet = Join-Path $generatedRoot 'MultiForm\MultiForm.css'
    $generatedTemplateScript = Get-Content -LiteralPath (Join-Path $generatedRoot 'MultiForm\templates\01-template-1.js') -Raw -Encoding UTF8
    Assert-True ($multiChanges.templates.Count -eq 9) 'Multi-template generation must create nine deployment templates.'
    Assert-True (($multiChanges.templateCategory.name -eq 'Multi Form Category') -and ($multiChanges.templateCategory.lastId -eq '0')) 'Multi-template generation must emit a root template category.'
    Assert-True (@($multiChanges.templates | ForEach-Object { $_.items } | Where-Object { $_.xId }).Count -eq 0) 'Generated cache fields must not duplicate DOM IDs into the length-limited extension xId.'
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $generatedRoot 'MultiForm\templates') -Filter '*.fragment.html').Count -eq 9) 'Multi-template generation must create nine fragments.'
    Assert-True ($overrideFragment -match 'override-fixture') 'Approved template fragmentHtml override was not preserved.'
    Assert-True (($multiHtml -match 'templates/01-template-1.js') -and ($multiHtml -notmatch 'MultiFormTemplate1.Init\(\)') -and ($multiHtml -match 'MultiForm.Init\(\)')) 'Standalone aggregate mode must load existing template scripts and delegate initialization to the form-level entry only.'
    Assert-True ((Test-Path -LiteralPath $generatedStylesheet) -and ($multiHtml -match 'id="MultiForm-stylesheet-') -and ($multiHtml -match 'href="MultiForm.css"')) 'Standalone HTML must emit and statically load the form stylesheet.'
    Assert-True (($generatedTemplateScript -match 'project-responsive\.css') -and ($generatedTemplateScript -match '\.\./asstemp/css/multiForm\.css') -and ($generatedTemplateScript -match 'document\.createElement\(''link''\)') -and ($generatedTemplateScript -notmatch '<style')) 'Template JavaScript must derive its anchor from project configuration and idempotently load the configured external stylesheet without injecting CSS text.'
    Assert-True (@($multiChanges.resources | Where-Object { $_.kind -eq 'stylesheet' -and $_.path -eq 'asstemp/css/multiForm.css' -and $_.loadMode -eq 'template' }).Count -eq 1) 'Deployment changes must declare the configured form stylesheet resource exactly once.'
    Assert-True (@($multiChanges.resources | Where-Object { $_.kind -eq 'javascript' -and $_.path -eq 'asstemp/multiFormTemplate1.js' }).Count -eq 1) 'Template JavaScript deployment resource must use its configured short semantic path.'
    Assert-True ($multiChanges.templates[0].js -eq 'scripts/dhcdoc/dhcdoccure_hui/asstemp/multiFormTemplate1.js') 'Template JavaScript configuration must store an external path rather than inline source.'
    Assert-True ($multiChanges.map.showJS -eq 'scripts/dhcdoc/dhcdoccure_hui/asstemp/multiForm.js') 'Map JavaScript configuration must store the form-level external entry path.'
    $generatedMainScript = Get-Content -LiteralPath (Join-Path $generatedRoot 'MultiForm\MultiForm.js') -Raw -Encoding UTF8
    Assert-True ($generatedMainScript -match 'MultiFormTemplate1\.Init') 'The opted-in form-level JavaScript must centrally initialize template business modules.'
    Assert-True (($generatedMainScript -match 'window\.jQuery\(deferredInit\)') -and ($generatedMainScript -match 'window\.setTimeout\(Init, 0\)')) 'Central template initialization must defer until the host DOM-ready lifecycle has restored cached values.'
    Assert-True ($generatedMainScript -notmatch 'MultiFormTemplate2\.Init') 'Central template initialization must skip templates without business JavaScript.'
    '.assess-form { max-width: 100%; } .multi-form-skin { color: red; }' | Set-Content -LiteralPath $publicResponsiveCss -Encoding UTF8
    $pollutedPrepare = Invoke-Cure @('prepare','--mode','create','--spec',$multiSpecPath,'--output-root',$generatedRoot,'--target-profile',$previewProfile,'--public-responsive-css',$publicResponsiveCss) 1
    Assert-True ($pollutedPrepare -match 'Public responsive CSS contains form-specific selectors') 'Public responsive CSS pollution must block preparation.'
    '.assess-form { max-width: 100%; }' | Set-Content -LiteralPath $publicResponsiveCss -Encoding UTF8
    $multiSnapshotPath = Join-Path $scratch 'MultiForm.snapshot.json'
    @{
        schema = 'cure-form-server-snapshot/v1'
        formType = 'CA'
        mapCode = 'MultiForm'
        version = 0
        contentHash = 'multi-fixture-v0'
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $multiSnapshotPath -Encoding UTF8
    $multiPackagePath = Join-Path $scratch 'MultiForm.package.json'
    $multiChangesPath = Join-Path $generatedRoot 'MultiForm\cure-form-deploy-changes.json'
    $multiVerification = New-PassedPreviewVerification -Changes $multiChangesPath -Snapshot $multiSnapshotPath -Name 'multi'
    Invoke-Cure @('plan','--spec',$multiSpecPath,'--snapshot',$multiSnapshotPath,'--changes',$multiChangesPath,'--preview-verification',$multiVerification,'--output',$multiPackagePath,'--public-responsive-css',$publicResponsiveCss,'--public-responsive-css-copy',$publicResponsiveCssCopy) | Out-Null
    $multiDryRun = Invoke-Cure @('apply','--package',$multiPackagePath)
    Assert-True ($multiDryRun -match '"dryRun": true') 'Multi-template package must pass the default offline dry-run gate.'

    $packagePath = Join-Path $scratch 'CAForm.package.json'
    $changesPath = Join-Path $generatedRoot 'CAForm\cure-form-deploy-changes.json'
    $snapshotPath = Join-Path $scratch 'CAForm.snapshot.json'
    @{
        schema = 'cure-form-server-snapshot/v1'
        formType = 'CA'
        mapCode = 'CAForm'
        version = 0
        contentHash = 'fixture-hash-v0'
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
    $caVerification = New-PassedPreviewVerification -Changes $changesPath -Snapshot $snapshotPath -Name 'ca-existing'
    $missingPreviewGate = Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$snapshotPath,'--changes',$changesPath,'--output',(Join-Path $scratch 'CAForm.no-preview.package.json')) 1
    Assert-True ($missingPreviewGate -match 'preview-verification') 'Deployable changes must require preview verification evidence.'
    $oldGateVerificationPath = Join-Path $scratch 'CAForm.old-gate.preview-verification.json'
    $oldGateVerification = Get-Content -LiteralPath $caVerification -Raw -Encoding UTF8 | ConvertFrom-Json
    $oldGateVerification.gateVersion = 'cure-form-preview-gate/1'
    $oldGateVerification | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $oldGateVerificationPath -Encoding UTF8
    $oldGateResult = Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$snapshotPath,'--changes',$changesPath,'--preview-verification',$oldGateVerificationPath,'--output',(Join-Path $scratch 'CAForm.old-gate.package.json')) 1
    Assert-True ($oldGateResult -match 'cure-form-preview-gate/2') 'Gate v1 preview credentials must not bypass the current deployment gate.'
    Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$snapshotPath,'--changes',$changesPath,'--preview-verification',$caVerification,'--output',$packagePath) | Out-Null
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($package.expectedVersion -eq 0) 'Snapshot version 0 must not be converted to NEW.'
    Assert-True ($package.expectedContentHash -eq 'fixture-hash-v0') 'Snapshot content hash was not preserved.'
    $missingSnapshotPath = Join-Path $scratch 'CAForm.missing.snapshot.json'
    @{
        schema = 'cure-form-server-snapshot/v1'
        formType = 'CA'
        mapCode = 'CAForm'
        exists = 0
        version = 0
        contentHash = 'missing-map-placeholder-hash'
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $missingSnapshotPath -Encoding UTF8
    $newPackagePath = Join-Path $scratch 'CAForm.new.package.json'
    $newVerification = New-PassedPreviewVerification -Changes $changesPath -Snapshot $missingSnapshotPath -Name 'ca-new'
    $missingInteractionGate = Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$missingSnapshotPath,'--changes',$changesPath,'--preview-verification',$newVerification,'--output',$newPackagePath) 1
    Assert-True ($missingInteractionGate -match 'interaction-verification') 'New forms must require pre-deploy manual interaction verification.'
    $interactionReportPath = Join-Path $scratch 'CAForm.interaction-report.json'
    Invoke-Cure @('interaction-prepare','--stage','pre-deploy','--spec',$caSpec,'--snapshot',$missingSnapshotPath,'--changes',$changesPath,'--preview-verification',$newVerification,'--output',$interactionReportPath) | Out-Null
    $interactionReport = Get-Content -LiteralPath $interactionReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $requiredIds = @($interactionReport.requiredCases | ForEach-Object { $_.id })
    Assert-True (($requiredIds -contains ("number:" + $ca.fields[0].id + ":integer")) -and ($requiredIds -contains ("number:" + $ca.fields[0].id + ":decimal")) -and ($requiredIds -contains ("number:" + $ca.fields[0].id + ":min")) -and ($requiredIds -contains ("number:" + $ca.fields[0].id + ":max"))) 'Interaction skeleton must cover numberbox integer, decimal, and declared boundaries.'
    Assert-True (($requiredIds -contains 'calculation:score-total') -and ($requiredIds -contains 'visibility:score-visibility') -and ($requiredIds -contains 'semantic:unit-deduplication') -and ($requiredIds -contains 'semantic:side-deduplication')) 'Interaction skeleton must cover calculations, linkage, units, and side-label deduplication.'
    $automatedReportPath = Join-Path $scratch 'CAForm.automated-interaction-report.json'
    $automatedReport = $interactionReport | ConvertTo-Json -Depth 40 | ConvertFrom-Json
    $automatedReport.execution.mode = 'automated'
    $automatedReport.execution.testedBy = 'fixture-runner'
    $automatedReport.execution.testedAt = '2026-01-01T00:00:00.000Z'
    $automatedReport.execution.summary = 'Automated fixture'
    $automatedReport.execution.overallStatus = 'passed'
    $automatedReport | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $automatedReportPath -Encoding UTF8
    $automatedResult = Invoke-Cure @('interaction-check','--report',$automatedReportPath,'--output',(Join-Path $scratch 'automated-verification.json')) 1
    Assert-True ($automatedResult -match 'Automated interaction execution is not supported') 'Automated interaction reports must be rejected.'
    $agentReportPath = Join-Path $scratch 'CAForm.agent-interaction-report.json'
    $agentReport = $interactionReport | ConvertTo-Json -Depth 40 | ConvertFrom-Json
    $agentReport.execution.mode = 'agent-manual'
    $agentReport.execution.testedBy = 'fixture-agent'
    $agentReport.execution.testedAt = '2026-01-01T00:00:00.000Z'
    $agentReport.execution.environment = 'local canonical preview'
    $agentReport.execution.summary = 'Agent manual fixture'
    $agentReport.execution.overallStatus = 'passed'
    $agentReport | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $agentReportPath -Encoding UTF8
    $agentMissingResult = Invoke-Cure @('interaction-check','--report',$agentReportPath,'--output',(Join-Path $scratch 'agent-verification.json')) 1
    Assert-True ($agentMissingResult -match 'result is missing for case') 'Agent manual testing must record every case result.'
    $removedCaseReportPath = Join-Path $scratch 'CAForm.removed-case-interaction-report.json'
    $removedCaseReport = $interactionReport | ConvertTo-Json -Depth 40 | ConvertFrom-Json
    $removedCaseReport.requiredCases = @($removedCaseReport.requiredCases | Select-Object -Skip 1)
    $removedCaseReport.execution.mode = 'user-attested'
    $removedCaseReport.execution.testedBy = 'fixture-user'
    $removedCaseReport.execution.testedAt = '2026-01-01T00:00:00.000Z'
    $removedCaseReport.execution.summary = 'Fixture removed case'
    $removedCaseReport.execution.overallStatus = 'passed'
    $removedCaseReport | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $removedCaseReportPath -Encoding UTF8
    $removedCaseResult = Invoke-Cure @('interaction-check','--report',$removedCaseReportPath,'--output',(Join-Path $scratch 'removed-case-verification.json')) 1
    Assert-True ($removedCaseResult -match 'Generated interaction cases were removed or changed') 'Generated interaction cases must not be removable.'
    $customReportPath = Join-Path $scratch 'CAForm.custom-interaction-report.json'
    $customReport = $interactionReport | ConvertTo-Json -Depth 40 | ConvertFrom-Json
    $customReport.customCases = @(@{ id = 'business:custom-linkage'; category = 'business-linkage'; title = '业务联动'; sourceRefs = @($ca.fields[0].id); steps = @('人工触发业务联动'); expected = '联动符合规格。'; required = $true })
    $customReport.execution.mode = 'user-attested'
    $customReport.execution.testedBy = 'fixture-user'
    $customReport.execution.testedAt = '2026-01-01T00:00:00.000Z'
    $customReport.execution.summary = '用户已人工完成含自定义业务联动的清单并确认通过。'
    $customReport.execution.overallStatus = 'passed'
    $customReport | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $customReportPath -Encoding UTF8
    $newInteractionVerification = Join-Path $scratch 'CAForm.interaction-verification.json'
    Invoke-Cure @('interaction-check','--report',$customReportPath,'--output',$newInteractionVerification) | Out-Null
    $customVerificationValue = Get-Content -LiteralPath $newInteractionVerification -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($customVerificationValue.caseCount -eq ($interactionReport.requiredCases.Count + 1)) 'Custom interaction cases must be accepted and included in the verification count.'
    $staleInteractionPath = Join-Path $scratch 'CAForm.stale-interaction-verification.json'
    $staleInteraction = Get-Content -LiteralPath $newInteractionVerification -Raw -Encoding UTF8 | ConvertFrom-Json
    $staleInteraction.bindings.changesHash = ('0' * 64)
    $staleInteraction | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $staleInteractionPath -Encoding UTF8
    $staleInteractionResult = Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$missingSnapshotPath,'--changes',$changesPath,'--preview-verification',$newVerification,'--interaction-verification',$staleInteractionPath,'--output',$newPackagePath) 1
    Assert-True ($staleInteractionResult -match 'does not match changesHash') 'Stale interaction evidence must not bypass the new-form gate.'
    Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$missingSnapshotPath,'--changes',$changesPath,'--preview-verification',$newVerification,'--interaction-verification',$newInteractionVerification,'--output',$newPackagePath) | Out-Null
    $newPackage = Get-Content -LiteralPath $newPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($newPackage.expectedVersion -eq 'NEW') 'A missing server Map must produce expectedVersion=NEW.'
    Assert-True ($null -eq $newPackage.expectedContentHash) 'A missing server Map must not retain a placeholder content hash.'
    Assert-True (($newPackage.interactionVerification.status -eq 'passed') -and ($newPackage.interactionVerification.mode -eq 'user-attested')) 'New package must embed the passed manual interaction verification.'
    $postInteractionReportPath = Join-Path $scratch 'CAForm.post-interaction-report.json'
    Invoke-Cure @('interaction-prepare','--stage','post-deploy','--package',$newPackagePath,'--operation-id','fixture-operation','--output',$postInteractionReportPath) | Out-Null
    $postInteractionReport = Get-Content -LiteralPath $postInteractionReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $postIds = @($postInteractionReport.requiredCases | ForEach-Object { $_.id })
    Assert-True (($postIds -contains 'lifecycle:save') -and ($postIds -contains 'lifecycle:reopen') -and ($postIds -contains 'lifecycle:restore') -and ($postIds -contains 'lifecycle:print')) 'CA post-deploy interaction skeleton must cover save, reopen, restore, and print.'
    $postInteractionReport.execution.mode = 'user-attested'
    $postInteractionReport.execution.testedBy = 'fixture-user'
    $postInteractionReport.execution.testedAt = '2026-01-01T00:00:00.000Z'
    $postInteractionReport.execution.summary = '用户确认部署后保存、重开、回显和打印通过。'
    $postInteractionReport.execution.overallStatus = 'passed'
    $postInteractionReport | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $postInteractionReportPath -Encoding UTF8
    $postInteractionVerificationPath = Join-Path $scratch 'CAForm.post-interaction-verification.json'
    Invoke-Cure @('interaction-check','--report',$postInteractionReportPath,'--output',$postInteractionVerificationPath) | Out-Null
    $postInteractionVerification = Get-Content -LiteralPath $postInteractionVerificationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (($postInteractionVerification.stage -eq 'post-deploy') -and ($postInteractionVerification.bindings.operationId -eq 'fixture-operation')) 'Post-deploy interaction verification must bind the operation ID.'
    $dryRun = Invoke-Cure @('apply','--package',$packagePath)
    Assert-True ($dryRun -match '"dryRun": true') 'Apply must default to dry-run.'

    $reuseSpecPath = Join-Path $scratch 'ReuseCommon.cure-form-spec.json'
    $reuseSpec = $ca | ConvertTo-Json -Depth 40 | ConvertFrom-Json
    $reuseSpec.sections = @(
        @{ id = '212'; title = '治疗前图片' },
        @{ id = '213'; title = '治疗后图片' }
    )
    $reuseSpec.PSObject.Properties.Remove('approval')
    $reuseSpec | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $reuseSpecPath -Encoding UTF8
    Invoke-Cure @('review','--spec',$reuseSpecPath,'--approved-by','tester') | Out-Null
    $reuseChangesPath = Join-Path $scratch 'ReuseCommon.changes.json'
    @{
        templates = @(
            @{ name = '治疗前图片（响应式 vtest）'; appId = 'TreatStartPig'; content = '<div id="TreatStartPig" class="hisui-panel"></div>'; items = @() },
            @{ name = '治疗后图片（响应式 vtest）'; appId = 'TreatEndPig'; content = '<div id="TreatEndPig" class="hisui-panel"></div>'; items = @() }
        )
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reuseChangesPath -Encoding UTF8
    $approvedClonesPath = Join-Path $scratch 'approved-clones.json'
    @{ approvedClones = @{ '212' = '242' } } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $approvedClonesPath -Encoding UTF8
    $reusePackagePath = Join-Path $scratch 'ReuseCommon.package.json'
    $reuseVerification = New-PassedPreviewVerification -Changes $reuseChangesPath -Snapshot $snapshotPath -Name 'reuse'
    Invoke-Cure @('plan','--spec',$reuseSpecPath,'--snapshot',$snapshotPath,'--changes',$reuseChangesPath,'--preview-verification',$reuseVerification,'--approved-clones',$approvedClonesPath,'--output',$reusePackagePath) | Out-Null
    $reusePackage = Get-Content -LiteralPath $reusePackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (($reusePackage.changes.templates[0].referenceOnly -eq $true) -and ($reusePackage.changes.templates[0].rowId -eq '242')) 'Approved common template was not converted to referenceOnly.'
    Assert-True (-not $reusePackage.changes.templates[0].PSObject.Properties['content']) 'Approved common template reference must not carry duplicate template content.'
    Assert-True (($reusePackage.changes.templates[1].sourceTemplateRowId -eq '213') -and (-not $reusePackage.changes.templates[1].referenceOnly)) 'Unapproved template must remain a versioned clone with source identity.'
    Assert-True (($reusePackage.commonTemplateReferences.Count -eq 1) -and ($reusePackage.commonTemplateReferences[0].approvedCloneRowId -eq '242')) 'Package common-template reuse audit is incomplete.'

    $crSpec = Join-Path $scratch 'CRForm.cure-form-spec.json'
    Invoke-Cure @('intake','--structure',$structurePath,'--form-type','CR','--module-id','CRForm','--output',$crSpec) | Out-Null
    $cr = Get-Content -LiteralPath $crSpec -Raw -Encoding UTF8 | ConvertFrom-Json
    $cr.unresolved = @()
    $cr | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $crSpec -Encoding UTF8
    Invoke-Cure @('review','--spec',$crSpec,'--approved-by','tester') | Out-Null
    Invoke-Cure @('prepare','--mode','create','--spec',$crSpec,'--output-root',$generatedRoot,'--target-profile',$previewProfile) | Out-Null
    $crScript = Get-Content -LiteralPath (Join-Path $generatedRoot 'CRForm\CRForm.js') -Raw -Encoding UTF8
    Assert-True (($crScript -match 'SaveCureRecord') -and ($crScript -match 'CureExpJsonStr') -and ($crScript -match 'MapID')) 'Generated CR runtime contract is incomplete.'
    Assert-True (-not ($crScript -match 'function\s+SaveCureRecord|throw new Error')) 'Generated CR module must not override the host save entry.'
    $crChangesPath = Join-Path $generatedRoot 'CRForm\cure-form-deploy-changes.json'
    $crMissingSnapshotPath = Join-Path $scratch 'CRForm.missing.snapshot.json'
    @{ schema = 'cure-form-server-snapshot/v1'; formType = 'CR'; mapCode = 'CRForm'; exists = 0 } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $crMissingSnapshotPath -Encoding UTF8
    $crPreviewVerification = New-PassedPreviewVerification -Changes $crChangesPath -Snapshot $crMissingSnapshotPath -Name 'cr-new'
    $crInteractionVerification = New-PassedUserInteractionVerification -Spec $crSpec -Changes $crChangesPath -Snapshot $crMissingSnapshotPath -PreviewVerification $crPreviewVerification -Name 'cr-new'
    $crPackagePath = Join-Path $scratch 'CRForm.new.package.json'
    Invoke-Cure @('plan','--spec',$crSpec,'--snapshot',$crMissingSnapshotPath,'--changes',$crChangesPath,'--preview-verification',$crPreviewVerification,'--interaction-verification',$crInteractionVerification,'--output',$crPackagePath) | Out-Null
    $crPostReportPath = Join-Path $scratch 'CRForm.post-interaction-report.json'
    Invoke-Cure @('interaction-prepare','--stage','post-deploy','--package',$crPackagePath,'--operation-id','fixture-cr-operation','--output',$crPostReportPath) | Out-Null
    $crPostReport = Get-Content -LiteralPath $crPostReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True (@($crPostReport.requiredCases | ForEach-Object { $_.id }) -contains 'runtime:cr-contract') 'CR post-deploy interaction skeleton must cover SaveCureRecord, CureExpJsonStr, and MapID.'

    Invoke-Cure @('intake','--structure',$structurePath,'--form-type','','--module-id','Pathology') 1 | Out-Null

    $legacyHtml = Join-Path $scratch 'legacy.html'
    '<html><head><link rel="stylesheet" href="hisui.pure.min.css"><script src="jquery-1.11.3.min.js"></script><script src="jquery.hisui.min.js"></script><script src="hisui-lang-zh_CN.js"></script><link rel="stylesheet" href="asscom.css"><link rel="stylesheet" href="adaptation.css"></head><body><div id="Root" style="min-width:300px"><table class="item-table"><tr><td><input id="A" data-cache-tag="A"></td><td><input id="TableRadio" type="radio" name="TableR" value="Y"><label class="radio" for="TableRadio"></label><label class="i-label-box" for="TableRadio">是</label></td></tr></table><table class="item-table-line"><tr><td>P</td><td>1</td><td>2</td><td>3</td></tr></table><input id="MobileRadio" type="radio" name="MobileR" value="1"><label class="radio" for="MobileRadio"></label><label class="m-label-box" for="MobileRadio">选项</label><input id="NativeRadio" type="radio" name="NativeR" value="N"><label class="radio" for="NativeRadio"></label><input type="checkbox" name="C" value="Y"></div></body></html>' | Set-Content -LiteralPath $legacyHtml -Encoding UTF8
    $responsiveHtml = Join-Path $scratch 'legacy.responsive.html'
    Invoke-Cure @('prepare','--mode','responsive','--html',$legacyHtml,'--output',$responsiveHtml) | Out-Null
    $responsive = Get-Content -LiteralPath $responsiveHtml -Raw -Encoding UTF8
    Assert-True (($responsive -match 'cure-form-responsive') -and ($responsive -match 'assess-form--responsive') -and ($responsive -match 'adaptation.css') -and ($responsive -match 'viewport')) 'Responsive root contract was not added.'
    Assert-True (($responsive -match 'assess-form-grid') -and ($responsive -match 'assess-measurement-table') -and ($responsive -match 'assess-measurement-point')) 'Responsive table contract was not added.'
    Assert-True (-not ($responsive -match 'min-width\s*:\s*300px')) 'Fixed root min-width was not removed.'
    Assert-True (($responsive -match 'class="i-label-box"') -and ($responsive -match 'class="m-label-box"')) 'Responsive transformation must preserve both HISUI semantic radio label variants.'
    Assert-True (($responsive -match 'name="TableR" value="Y"') -and ($responsive -match 'name="MobileR" value="1"') -and ($responsive -match 'name="NativeR" value="N"')) 'Responsive transformation changed radio name/value pairs.'
    Assert-True (([regex]::Matches($responsive, 'class="radio"')).Count -eq 3) 'Responsive transformation must preserve paired and unpaired native HISUI radio labels.'
    Assert-True (-not ($responsive -match 'label\.radio[^\{]*\{[^\}]*display\s*:\s*none')) 'Business HTML must not inject an unconditional label.radio hide rule.'
    $missingResourceHtml = Join-Path $scratch 'missing-resource.html'
    ($responsive -replace '<link rel="stylesheet" href="adaptation\.css">', '') | Set-Content -LiteralPath $missingResourceHtml -Encoding UTF8
    $missingResourceResult = Invoke-Cure @('prepare','--mode','responsive','--html',$missingResourceHtml,'--output',(Join-Path $scratch 'missing-resource.responsive.html')) 1
    Assert-True ($missingResourceResult -match 'missing required preview resources.*adaptation\.css') 'Complete HTML must fail when a canonical preview resource is missing.'

    $commonSnapshotPath = Join-Path $scratch 'common-snapshot.json'
    @{
        schema = 'cure-form-server-snapshot/v1'
        formType = 'CR'
        mapCode = 'CRFixture'
        templates = @(@{
            rowId = '141'
            name = '治疗记录通用模板'
            appId = 'CRCommon'
            lastId = '140'
            content = '<div id="CRCommon" class="hisui-panel"><table class="item-table"><tr><th><label for="DCRTitle">治疗标题</label></th><td><input id="DCRTitle" class="textbox"/></td></tr><tr><th>是否完成</th><td><input id="DCRDoneY" class="hisui-radio" type="radio" name="DCRDone" value="Y" label="是" checked="checked"/><input id="DCRDoneN" class="hisui-radio" type="radio" name="DCRDone" value="N" label="否"/></td></tr></table></div>'
            items = @(@{ rowId = '9001'; id = 'DCRTitle'; name = '治疗标题'; save = 'Y' })
        })
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $commonSnapshotPath -Encoding UTF8
    $commonRoot = Join-Path $scratch 'common-responsive'
    Invoke-Cure @('prepare','--mode','common-responsive','--snapshot',$commonSnapshotPath,'--output-root',$commonRoot,'--version-label','vtest') | Out-Null
    $commonChanges = Get-Content -LiteralPath (Join-Path $commonRoot 'responsive-changes.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $commonReport = Get-Content -LiteralPath (Join-Path $commonRoot 'responsive-report.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($commonChanges.strategy -eq 'versioned-clone') 'Common responsive preparation must use versioned clones.'
    Assert-True (-not $commonChanges.templates[0].PSObject.Properties['rowId']) 'Common responsive clone must not update the source template row.'
    Assert-True (-not $commonChanges.templates[0].items[0].PSObject.Properties['rowId']) 'Common responsive clone must allocate new cache item rows.'
    Assert-True ($commonChanges.templates[0].content -match 'assess-form-grid') 'Common responsive clone is missing the grid contract.'
    Assert-True (($commonReport.runtimeContract.requiredInterfaces -contains 'SaveCureRecord') -and ($commonReport.runtimeContract.requiredInterfaces -contains 'CureExpJsonStr')) 'CR common responsive runtime gates are incomplete.'
    $commonPreviewRoot = Join-Path $scratch 'common-preview'
    $commonPreview = Invoke-Cure @('preview','--snapshot',$commonSnapshotPath,'--changes',(Join-Path $commonRoot 'responsive-changes.json'),'--target-profile',$previewProfile,'--output-root',$commonPreviewRoot) | ConvertFrom-Json
    $commonPreviewManifest = Get-Content -LiteralPath $commonPreview.manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $commonPreviewHtml = Get-Content -LiteralPath $commonPreview.html -Raw -Encoding UTF8
    Assert-True ($commonPreviewManifest.resources.Count -eq 6) 'Canonical preview must bind all six required resources.'
    Assert-True (($commonPreviewManifest.gateVersion -eq 'cure-form-preview-gate/2') -and ($commonPreviewManifest.requiredChecks -contains 'css-dependencies') -and ($commonPreviewManifest.requiredChecks -contains 'console-errors')) 'Canonical preview manifest must declare gate v2 dependency and Console checks.'
    Assert-True (($commonPreviewManifest.cssDependencies.dependencies.Count -gt 0) -and ($commonPreviewManifest.dependencyHash -match '^[a-f0-9]{64}$')) 'Canonical preview must hash copied CSS dependencies.'
    Assert-True ($commonPreviewManifest.expectedRuntime.radioCount -eq 2) 'Canonical preview must bind the source radio count into its runtime gate.'
    Assert-True (($commonPreviewManifest.expectedRuntime.hisuiRadioCount -eq 2) -and ($commonPreviewManifest.expectedRuntime.semanticRadioPairCount -eq 0)) 'Canonical preview must bind source HISUI radios while leaving radios without semantic labels unpaired.'
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $commonPreviewRoot 'assets') -File).Count -eq 6) 'Canonical preview must copy local target resources into a self-contained asset directory.'
    Assert-True (Test-Path -LiteralPath (Join-Path $commonPreviewRoot 'assets\images\pure\checkbox_lite_v.png') -PathType Leaf) 'Canonical preview must preserve local CSS dependencies used by HISUI radio rendering.'
    Assert-True (Test-Path -LiteralPath (Join-Path $commonPreviewRoot 'assets\theme\fixture.css') -PathType Leaf) 'Canonical preview must recursively copy CSS @import dependencies.'
    Assert-True (($commonPreviewHtml -match '__cureFormPreviewCheck') -and ($commonPreviewHtml -match 'data-cure-preview-resource="hisuiCss"')) 'Canonical preview must embed the browser runtime probe and tracked resource tags.'
    Assert-True ($commonPreviewHtml -notmatch [regex]::Escape($previewAssetRoot)) 'Canonical preview must not persist absolute target resource paths.'
    if ($env:CURE_FORM_TEST_BROWSER_COMMAND) {
        $realBrowserResults = Join-Path $commonPreviewRoot 'canonical-browser-results.json'
        $realBrowserVerification = Join-Path $commonPreviewRoot 'canonical-preview-verification.json'
        Invoke-Cure @('preview-run','--manifest',$commonPreview.manifest,'--browser-command',$env:CURE_FORM_TEST_BROWSER_COMMAND,'--target-profile',$previewProfile,'--output',$realBrowserResults) | Out-Null
        Invoke-Cure @('preview-check','--manifest',$commonPreview.manifest,'--browser-results',$realBrowserResults,'--output',$realBrowserVerification) | Out-Null
        $realBrowserPayload = Get-Content -LiteralPath $realBrowserResults -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-True (($realBrowserPayload.runner.engine -eq 'chromium-cdp') -and ($realBrowserPayload.results.Count -eq 9)) 'Canonical preview-run must produce nine Chromium CDP results.'
    }
    $missingRadioResults = Join-Path $commonPreviewRoot 'missing-radio-results.json'
    @{
        schema = 'cure-form-browser-results/v1'
        runner = @{
            schema = 'cure-form-browser-runner/v1'; gateVersion = 'cure-form-preview-gate/2'; manifestHash = $commonPreview.manifestHash
            engine = 'chromium-cdp'; browser = 'test-fixture'; browserProduct = 'test-fixture'; protocolVersion = 'test-fixture'; completedAt = '2026-01-01T00:00:00.000Z'
        }
        results = @($commonPreviewManifest.widths | ForEach-Object {
            [ordered]@{
                schema = 'cure-form-browser-result/v1'; manifestHash = $commonPreview.manifestHash; width = [int]$_
                resources = @($commonPreviewManifest.resources | ForEach-Object { [ordered]@{ role = $_.role; state = 'loaded' } })
                checks = [ordered]@{ jqueryAvailable = $true; parserAvailable = $true; panelCount = 1; initializedPanelCount = 1; radioCount = 0; generatedRadioLabelCount = 0; horizontalOverflow = $false }
                networkErrors = @()
                consoleErrors = @()
                runtimeErrors = @()
            }
        })
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $missingRadioResults -Encoding UTF8
    $missingRadioResult = Invoke-Cure @('preview-check','--manifest',$commonPreview.manifest,'--browser-results',$missingRadioResults,'--output',(Join-Path $commonPreviewRoot 'missing-radio-verification.json')) 1
    Assert-True ($missingRadioResult -match 'radio label generation is incomplete') 'Browser evidence must not bypass radio generation by reporting zero radios.'
    [System.IO.File]::AppendAllText($commonPreview.html, '<!-- tampered -->')
    $tamperedHtmlResult = Invoke-Cure @('preview-check','--manifest',$commonPreview.manifest,'--browser-results',$missingRadioResults,'--output',(Join-Path $commonPreviewRoot 'tampered-html-verification.json')) 1
    Assert-True ($tamperedHtmlResult -match 'Preview HTML does not match the manifest') 'Edited preview HTML must invalidate browser acceptance.'
    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($commonPreview.html, $commonPreviewHtml, $utf8NoBom)
    $copiedCssDependency = Join-Path $commonPreviewRoot 'assets\images\pure\checkbox_lite_v.png'
    [System.IO.File]::WriteAllBytes($copiedCssDependency, [byte[]](1,2,3))
    $tamperedDependencyResult = Invoke-Cure @('preview-check','--manifest',$commonPreview.manifest,'--browser-results',$missingRadioResults,'--output',(Join-Path $commonPreviewRoot 'tampered-dependency-verification.json')) 1
    Assert-True ($tamperedDependencyResult -match 'resource hash mismatch') 'A changed copied CSS dependency must invalidate browser acceptance.'
    Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\hisui\dist\css\images\pure\checkbox_lite_v.png') -Destination $copiedCssDependency -Force

    $atomicChangesPath = Join-Path $scratch 'atomic-radio-changes.json'
    @{
        title = 'HISUI radio atomic pairing fixture'
        templates = @(@{
            appId = 'AtomicRadioFixture'
            content = '<div id="AtomicRadioFixture" class="hisui-panel assess-form"><input id="AtomicI" class="hisui-radio radio-f" type="radio" name="AtomicIGroup" value="Y"><label class="i-label-box" for="AtomicI">表格选项</label><input id="AtomicM" class="hisui-radio radio-f" type="radio" name="AtomicMGroup" value="Y"><label class="m-label-box" for="AtomicM">普通选项</label><input id="HisuiWithoutSemantic" class="hisui-radio radio-f" type="radio" name="HisuiWithoutSemanticGroup" value="Y"><input id="MismatchedFor" class="hisui-radio radio-f" type="radio" name="MismatchedForGroup" value="Y"><label class="m-label-box" for="OtherRadioId">for/id 不一致</label><input id="MissingRadioF" class="hisui-radio" type="radio" name="MissingRadioFGroup" value="Y"><label class="m-label-box" for="MissingRadioF">源模板待 HISUI 添加 radio-f</label><input id="MissingHisuiRadio" class="radio-f" type="radio" name="MissingHisuiGroup" value="Y"><label class="m-label-box" for="MissingHisuiRadio">缺少 hisui-radio</label></div><div id="OutsideAssessForm"><input id="OutsideAtomicClasses" class="hisui-radio radio-f" type="radio" name="OutsideGroup" value="Y"><label class="m-label-box" for="OutsideAtomicClasses">容器外选项</label></div>'
        })
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $atomicChangesPath -Encoding UTF8
    $atomicPreviewRoot = Join-Path $scratch 'atomic-radio-preview'
    $atomicPreview = Invoke-Cure @('preview','--changes',$atomicChangesPath,'--target-profile',$previewProfile,'--output-root',$atomicPreviewRoot) | ConvertFrom-Json
    $atomicManifest = Get-Content -LiteralPath $atomicPreview.manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $atomicPreviewHtml = Get-Content -LiteralPath $atomicPreview.html -Raw -Encoding UTF8
    Assert-True (($atomicManifest.schema -eq 'cure-form-preview-manifest/v1') -and ($atomicManifest.expectedRuntime.radioCount -eq 7) -and ($atomicManifest.expectedRuntime.hisuiRadioCount -eq 5) -and ($atomicManifest.expectedRuntime.semanticRadioPairCount -eq 3)) 'Canonical preview must count source HISUI radios inside .assess-form while excluding mismatched for/id pairs, controls without hisui-radio, and controls outside the form.'
    Assert-True ($atomicManifest.requiredChecks -contains 'radio-atomic-pairing') 'Canonical preview manifest must declare the atomic radio pairing gate.'
    Assert-True (($atomicPreviewHtml -match 'completeHisuiRadioPairCount') -and ($atomicPreviewHtml -match 'brokenHisuiRadioPairCount') -and ($atomicPreviewHtml -match 'unpairedHisuiRadioCount')) 'Canonical preview probe is missing atomic radio result fields.'
    Assert-True ($atomicPreviewHtml.Contains('.assess-form input[type="radio"].hisui-radio.radio-f') -and $atomicPreviewHtml.Contains("semanticLabel.getAttribute('for') === id")) 'Canonical preview probe must enforce the exact target classes and semantic label for/id match.'
    $atomicPassedPayload = @{
        schema = 'cure-form-browser-results/v1'
        runner = @{
            schema = 'cure-form-browser-runner/v1'; gateVersion = 'cure-form-preview-gate/2'; manifestHash = $atomicPreview.manifestHash
            engine = 'chromium-cdp'; browser = 'test-fixture'; browserProduct = 'test-fixture'; protocolVersion = 'test-fixture'; completedAt = '2026-01-01T00:00:00.000Z'
        }
        results = @($atomicManifest.widths | ForEach-Object {
            [ordered]@{
                schema = 'cure-form-browser-result/v1'; manifestHash = $atomicPreview.manifestHash; width = [int]$_
                resources = @($atomicManifest.resources | ForEach-Object { [ordered]@{ role = $_.role; state = 'loaded' } })
                checks = [ordered]@{
                    jqueryAvailable = $true; parserAvailable = $true; panelCount = 1; initializedPanelCount = 1
                    radioCount = 7; generatedRadioLabelCount = 7
                    hisuiRadioTargetCount = 5; completeHisuiRadioPairCount = 3; brokenHisuiRadioPairCount = 0; unpairedHisuiRadioCount = 2
                    horizontalOverflow = $false
                }
                networkErrors = @()
                consoleErrors = @()
                runtimeErrors = @()
            }
        })
    }
    $atomicPassedResults = Join-Path $atomicPreviewRoot 'atomic-passed-results.json'
    $atomicPassedPayload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $atomicPassedResults -Encoding UTF8
    Invoke-Cure @('preview-check','--manifest',$atomicPreview.manifest,'--browser-results',$atomicPassedResults,'--output',(Join-Path $atomicPreviewRoot 'atomic-passed-verification.json')) | Out-Null

    $atomicBrokenPayload = $atomicPassedPayload | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    foreach ($result in $atomicBrokenPayload.results) {
        $result.checks.completeHisuiRadioPairCount = 2
        $result.checks.brokenHisuiRadioPairCount = 1
    }
    $atomicBrokenResults = Join-Path $atomicPreviewRoot 'atomic-broken-results.json'
    $atomicBrokenPayload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $atomicBrokenResults -Encoding UTF8
    $atomicBrokenResult = Invoke-Cure @('preview-check','--manifest',$atomicPreview.manifest,'--browser-results',$atomicBrokenResults,'--output',(Join-Path $atomicPreviewRoot 'atomic-broken-verification.json')) 1
    Assert-True ($atomicBrokenResult -match 'radio atomic pairing is broken') 'Preview-check must reject broken HISUI radio atomic pairing.'

    $atomicIncompletePayload = $atomicPassedPayload | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    foreach ($result in $atomicIncompletePayload.results) {
        $result.checks.completeHisuiRadioPairCount = 2
        $result.checks.unpairedHisuiRadioCount = 3
    }
    $atomicIncompleteResults = Join-Path $atomicPreviewRoot 'atomic-incomplete-results.json'
    $atomicIncompletePayload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $atomicIncompleteResults -Encoding UTF8
    $atomicIncompleteResult = Invoke-Cure @('preview-check','--manifest',$atomicPreview.manifest,'--browser-results',$atomicIncompleteResults,'--output',(Join-Path $atomicPreviewRoot 'atomic-incomplete-verification.json')) 1
    Assert-True ($atomicIncompleteResult -match 'radio atomic pairing is incomplete') 'Preview-check must reject incomplete HISUI radio atomic pairing.'

    $atomicMissingTargetPayload = $atomicPassedPayload | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    foreach ($result in $atomicMissingTargetPayload.results) {
        $result.checks.hisuiRadioTargetCount = 4
        $result.checks.unpairedHisuiRadioCount = 1
    }
    $atomicMissingTargetResults = Join-Path $atomicPreviewRoot 'atomic-missing-target-results.json'
    $atomicMissingTargetPayload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $atomicMissingTargetResults -Encoding UTF8
    $atomicMissingTargetResult = Invoke-Cure @('preview-check','--manifest',$atomicPreview.manifest,'--browser-results',$atomicMissingTargetResults,'--output',(Join-Path $atomicPreviewRoot 'atomic-missing-target-verification.json')) 1
    Assert-True ($atomicMissingTargetResult -match 'initialized atomic targets are incomplete') 'Preview-check must reject HISUI source radios that did not initialize into exact atomic targets.'

    $inventory = Join-Path $scratch 'inventory.json'
    @(
        @{ mapCode = 'OtherCR'; formType = 'CR' },
        @{ mapCode = 'Pathology'; formType = '' },
        @{ mapCode = 'CanaryCA'; formType = 'CA' }
    ) | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $inventory -Encoding UTF8
    $migration = Join-Path $scratch 'migration.json'
    Invoke-Cure @('common-migrate','--inventory',$inventory,'--migration-config',$migrationConfig,'--output',$migration) | Out-Null
    $migrationData = Get-Content -LiteralPath $migration -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($migrationData.maps.Count -eq 2) 'Common migration did not exclude pathology.'
    Assert-True ($migrationData.maps[0].mapCode -eq 'CanaryCA') 'Common migration config priority order is incorrect.'
    Assert-True (($migrationData.seedTemplates.CA[0] -eq '901') -and ($migrationData.seedTemplates.CR.Count -eq 2)) 'Common migration template seeds must come from target configuration.'
    Assert-True ($migrationData.migrationConfigHash -match '^[a-f0-9]{64}$') 'Common migration plan must bind the target configuration hash.'

    $compatibilitySkill = Get-Content -LiteralPath (Join-Path $pluginRoot 'skills\make-assess-form-responsive\SKILL.md') -Raw -Encoding UTF8
    Assert-True ($compatibilitySkill -match 'cure-form-responsive') 'Compatibility skill must delegate to cure-form-responsive.'
    $responsiveSkill = Get-Content -LiteralPath (Join-Path $pluginRoot 'skills\cure-form-responsive\SKILL.md') -Raw -Encoding UTF8
    $responsiveReference = Get-Content -LiteralPath (Join-Path $pluginRoot 'references\cure-form-responsive-compatibility.md') -Raw -Encoding UTF8
    Assert-True (($responsiveSkill -match 'i-label-box') -and ($responsiveSkill -match 'm-label-box') -and ($responsiveSkill -match '旧 WebView')) 'Responsive skill is missing the validated HISUI radio compatibility gate.'
    Assert-True (($responsiveReference -match '@supports selector') -and ($responsiveReference -match '禁止无条件') -and ($responsiveReference -match '表格布局')) 'Responsive compatibility reference is incomplete.'
    Assert-True (($responsiveSkill -match '独立.*CSS') -and ($responsiveSkill -match '不得.*写死.*路径') -and ($responsiveReference -match '公共响应式样式.*仅')) 'Plugin guidance must separate public responsive CSS from form-specific styles without hard-coded project paths.'

    & (Join-Path $pluginRoot 'scripts\generate-plugin-thin-index.ps1') -PluginPath $pluginRoot -ProjectRoot $repoRoot -Mode DryRun | Out-Null
    if ($LASTEXITCODE -notin @(0, $null)) { throw 'Thin-index dry-run failed.' }

    Write-Host 'iris-cure-form-dev tests passed.'
}
finally {
    if ($env:KEEP_IRIS_CURE_FORM_TEST_ARTIFACTS -eq '1') {
        Write-Host "iris-cure-form-dev test artifacts: $scratch"
    }
    elseif (Test-Path -LiteralPath $scratch) {
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
