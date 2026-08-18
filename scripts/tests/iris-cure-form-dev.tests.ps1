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

try {
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null

    $manifest = Get-Content -LiteralPath (Join-Path $pluginRoot '.agents-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($manifest.name -eq 'iris-cure-form-dev') 'Unexpected plugin name.'
    Assert-True ($manifest.version -eq '0.2.5') 'Unexpected plugin version.'
    Assert-True (($manifest.dependencies -contains 'extract-doc') -and ($manifest.dependencies -contains 'coding-iris-plugin')) 'Plugin dependencies are incomplete.'

    foreach ($skill in @('cure-form-init','cure-form-requirement-adapter','cure-assess-form-dev','cure-record-form-dev','cure-form-responsive','make-assess-form-responsive','cure-form-deploy','cure-form-lookup','cure-form-fragment')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $pluginRoot "skills\$skill\SKILL.md")) "Missing skill: $skill"
    }

    & node --check $cli
    if ($LASTEXITCODE -ne 0) { throw 'Node syntax check failed.' }
    $cliContent = Get-Content -LiteralPath $cli -Raw -Encoding UTF8
    $stagedTransport = Join-Path $pluginRoot 'scripts\cure-form-staged-transport.js'
    Assert-True (Test-Path -LiteralPath $stagedTransport -PathType Leaf) 'Persistent staged transport is missing.'
    & node --check $stagedTransport
    if ($LASTEXITCODE -ne 0) { throw 'Persistent staged transport syntax check failed.' }
    $stagedTransportContent = Get-Content -LiteralPath $stagedTransport -Raw -Encoding UTF8
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
    $styleBoundaryFiles = @(
        (Join-Path $pluginRoot 'rules\cure_form_workflow.md'),
        (Join-Path $pluginRoot 'rules\cure_form_deploy.md'),
        (Join-Path $pluginRoot 'references\cure-form-responsive-compatibility.md')
    )
    $styleBoundaryText = ($styleBoundaryFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw -Encoding UTF8 }) -join "`n"
    Assert-True ($styleBoundaryText -notmatch '(?i)[A-Z]:[\\/][^\r\n`]*adaptation\.css') 'Plugin governance must not hardcode a project-specific public responsive CSS path.'
    Assert-True (($styleBoundaryText -match '已改造表单.*快照') -and ($styleBoundaryText -match '两阶段')) 'Plugin governance must require compatibility snapshots and a two-stage migration for existing forms.'
    Assert-True (($styleBoundaryText -match '24 个字符') -and ($styleBoundaryText -match 'camelCase') -and ($styleBoundaryText -match '引用路径.*basename.*一致')) 'Plugin governance must constrain deployment asset names by semantics and length.'

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
    $ca | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $caSpec -Encoding UTF8
    Invoke-Cure @('review','--spec',$caSpec,'--approved-by','tester') | Out-Null
    $ca = Get-Content -LiteralPath $caSpec -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($ca.approval.unresolvedCount -eq 0) 'CA approval was not recorded.'

    $generatedRoot = Join-Path $scratch 'generated'
    Invoke-Cure @('prepare','--mode','create','--spec',$caSpec,'--output-root',$generatedRoot) | Out-Null
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
    Invoke-Cure @('prepare','--mode','create','--spec','docs\cure-form\DocsDefaultForm\cure-form-spec.json','--project-root',$docsProject) | Out-Null
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
    Invoke-Cure @('prepare','--mode','create','--spec',$multiSpecPath,'--output-root',$generatedRoot,'--public-responsive-css',$publicResponsiveCss,'--public-responsive-css-copy',$publicResponsiveCssCopy) | Out-Null
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
    $pollutedPrepare = Invoke-Cure @('prepare','--mode','create','--spec',$multiSpecPath,'--output-root',$generatedRoot,'--public-responsive-css',$publicResponsiveCss) 1
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
    Invoke-Cure @('plan','--spec',$multiSpecPath,'--snapshot',$multiSnapshotPath,'--changes',(Join-Path $generatedRoot 'MultiForm\cure-form-deploy-changes.json'),'--output',$multiPackagePath,'--public-responsive-css',$publicResponsiveCss,'--public-responsive-css-copy',$publicResponsiveCssCopy) | Out-Null
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
    Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$snapshotPath,'--changes',$changesPath,'--output',$packagePath) | Out-Null
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
    Invoke-Cure @('plan','--spec',$caSpec,'--snapshot',$missingSnapshotPath,'--changes',$changesPath,'--output',$newPackagePath) | Out-Null
    $newPackage = Get-Content -LiteralPath $newPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($newPackage.expectedVersion -eq 'NEW') 'A missing server Map must produce expectedVersion=NEW.'
    Assert-True ($null -eq $newPackage.expectedContentHash) 'A missing server Map must not retain a placeholder content hash.'
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
            @{ name = '治疗前图片（响应式 vtest）'; appId = 'TreatStartPig'; content = '<div id="TreatStartPig"></div>'; items = @() },
            @{ name = '治疗后图片（响应式 vtest）'; appId = 'TreatEndPig'; content = '<div id="TreatEndPig"></div>'; items = @() }
        )
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reuseChangesPath -Encoding UTF8
    $approvedClonesPath = Join-Path $scratch 'approved-clones.json'
    @{ approvedClones = @{ '212' = '242' } } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $approvedClonesPath -Encoding UTF8
    $reusePackagePath = Join-Path $scratch 'ReuseCommon.package.json'
    Invoke-Cure @('plan','--spec',$reuseSpecPath,'--snapshot',$snapshotPath,'--changes',$reuseChangesPath,'--approved-clones',$approvedClonesPath,'--output',$reusePackagePath) | Out-Null
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
    Invoke-Cure @('prepare','--mode','create','--spec',$crSpec,'--output-root',$generatedRoot) | Out-Null
    $crScript = Get-Content -LiteralPath (Join-Path $generatedRoot 'CRForm\CRForm.js') -Raw -Encoding UTF8
    Assert-True (($crScript -match 'SaveCureRecord') -and ($crScript -match 'CureExpJsonStr') -and ($crScript -match 'MapID')) 'Generated CR runtime contract is incomplete.'
    Assert-True (-not ($crScript -match 'function\s+SaveCureRecord|throw new Error')) 'Generated CR module must not override the host save entry.'

    Invoke-Cure @('intake','--structure',$structurePath,'--form-type','','--module-id','Pathology') 1 | Out-Null

    $legacyHtml = Join-Path $scratch 'legacy.html'
    '<html><head></head><body><div id="Root" style="min-width:300px"><table class="item-table"><tr><td><input id="A" data-cache-tag="A"></td><td><input id="TableRadio" type="radio" name="TableR" value="Y"><label class="radio" for="TableRadio"></label><label class="i-label-box" for="TableRadio">是</label></td></tr></table><table class="item-table-line"><tr><td>P</td><td>1</td><td>2</td><td>3</td></tr></table><input id="MobileRadio" type="radio" name="MobileR" value="1"><label class="radio" for="MobileRadio"></label><label class="m-label-box" for="MobileRadio">选项</label><input id="NativeRadio" type="radio" name="NativeR" value="N"><label class="radio" for="NativeRadio"></label><input type="checkbox" name="C" value="Y"></div></body></html>' | Set-Content -LiteralPath $legacyHtml -Encoding UTF8
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
            content = '<div id="CRCommon" class="hisui-panel"><table class="item-table"><tr><th><label for="DCRTitle">治疗标题</label></th><td><input id="DCRTitle" class="textbox"/></td></tr></table></div>'
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

    $inventory = Join-Path $scratch 'inventory.json'
    @(
        @{ mapCode = 'OtherCR'; formType = 'CR' },
        @{ mapCode = 'Pathology'; formType = '' },
        @{ mapCode = 'LymphedemaLimb'; formType = 'CA' }
    ) | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $inventory -Encoding UTF8
    $migration = Join-Path $scratch 'migration.json'
    Invoke-Cure @('common-migrate','--inventory',$inventory,'--output',$migration) | Out-Null
    $migrationData = Get-Content -LiteralPath $migration -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($migrationData.maps.Count -eq 2) 'Common migration did not exclude pathology.'
    Assert-True ($migrationData.maps[0].mapCode -eq 'LymphedemaLimb') 'Common migration canary order is incorrect.'

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
    if (Test-Path -LiteralPath $scratch) {
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
