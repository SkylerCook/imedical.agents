#requires -Version 5.1
<#
.SYNOPSIS
为带回的 IRIS 源码保存原始基线，生成增量源码与回退文件，并离线核对交付。
.EXAMPLE
.\source-delivery.ps1 -Mode Prepare -ExportDirectory ..\exported-code
.EXAMPLE
.\source-delivery.ps1 -Mode Pack -ExportDirectory ..\exported-code -NotesFile ..\notes.md -OutputDirectory ..\delivery
.EXAMPLE
.\source-delivery.ps1 -Mode Verify -OutputDirectory ..\delivery
.NOTES
无框架、Node.js、Git、IRIS 或联网依赖。只处理已有对象，不上传、不编译。
旧导出缺少来源时，Prepare 提示填写 Atelier URL 和 Namespace，并核对原 target 摘要。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Prepare','Pack','Verify')][string]$Mode,
    [string]$ExportDirectory,
    [string]$OutputDirectory,
    [string]$NotesFile,
    [string]$CurrentExportDirectory,
    [string]$AtelierUrl,
    [string]$Namespace,
    [switch]$AllowPartial,
    [string]$SourceDirectory,
    [string]$OriginalDirectory,
    [string]$BatchId,
    [string]$ScopeFile,
    [string]$WorkspaceEvidence,
    [string]$BaselineDirectory,
    [string]$WorkspaceBinding,
    [string]$CurrentSourceDirectory
)
$ErrorActionPreference='Stop'
$utf8=New-Object Text.UTF8Encoding($false,$true)
function Full-Path([string]$Path) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path) }
function Hash-Bytes([byte[]]$Bytes) {
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Plain-Path([string]$Path) {
    $part=[IO.Path]::GetFullPath($Path)
    while($part) {
        if(Test-Path -LiteralPath $part) { if((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'linked-path-forbidden'} }
        $part=[IO.Path]::GetDirectoryName($part)
    }
}
function Join-Safe([string]$Root,[string]$Relative) {
    if(-not $Relative -or [IO.Path]::IsPathRooted($Relative) -or $Relative.Contains('\')){throw 'unsafe-source-path'}
    foreach($segment in $Relative.Split('/')) {
        if(-not $segment -or $segment -in @('.','..') -or $segment -match '[<>:"|?*\x00-\x1f]' -or $segment -match '[. ]$' -or $segment -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)'){throw 'unsafe-source-path'}
    }
    $path=[IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if(-not $path.StartsWith($Root.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'source-path-outside-root'}
    Plain-Path $path; return $path
}
function Hash-File([string]$Path){Plain-Path $Path;return Hash-Bytes ([IO.File]::ReadAllBytes($Path))}
function Read-Json([string]$Path){Plain-Path $Path;return ([IO.File]::ReadAllText($Path,$utf8)|ConvertFrom-Json)}
function Expected-Path([string]$Document) {
    if(-not $Document -or $Document -cne $Document.Trim() -or $Document.Contains('\')){throw 'invalid-source-document'}
    $ext=[IO.Path]::GetExtension($Document).ToLowerInvariant()
    if($ext -in @('.cls','.mac','.inc','.int') -and -not $Document.Contains('/')) {
        $stem=$Document.Substring(0,$Document.Length-4)
        if($stem -cnotmatch '^[%A-Za-z][%A-Za-z0-9]*(\.[%A-Za-z][%A-Za-z0-9]*)*$'){throw 'invalid-backend-document'}
        if($ext -eq '.cls'){return 'src/'+$stem.Replace('.','/')+$ext}
        return 'src/routines/'+$Document
    }
    if($ext -notin @('.csp','.csr','.js','.css','.html','.htm') -or $Document.StartsWith('/')){throw 'invalid-web-document'}
    return 'src/'+$Document
}
function List-Files([string]$Directory) {
    Plain-Path $Directory
    if(-not(Test-Path -LiteralPath $Directory -PathType Container)){throw 'source-directory-missing'}
    $todo=New-Object 'Collections.Generic.Stack[string]';$todo.Push($Directory)
    while($todo.Count){
        foreach($item in @(Get-ChildItem -LiteralPath $todo.Pop() -Force)){
            if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'linked-source-entry'}
            if($item.PSIsContainer){$todo.Push($item.FullName)}else{$item.FullName}
        }
    }
}
function Source-Info($Value,[string]$Target) {
    if($Value.kind -eq 'manual-source') {
        if($Target -or -not $Value.batchId -or ([string]$Value.batchId).Length -gt 128 -or ([string]$Value.batchId) -match '[\x00-\x1f]'){throw 'manual-source-identity-invalid'}
        return [pscustomobject]@{kind='manual-source';batchId=[string]$Value.batchId}
    }
    if(-not $Value -or -not $Value.atelierUrl -or -not $Value.namespace){throw 'source-information-required'}
    try{$uri=[uri](([string]$Value.atelierUrl).TrimEnd('/')+'/')}catch{throw 'source-information-invalid'}
    $ns=[string]$Value.namespace
    if(-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -notmatch '/api/atelier/$' -or -not $ns -or $ns -match '[\x00-\x20/\\?#]'){throw 'source-information-invalid'}
    if((Hash-Bytes ($utf8.GetBytes($uri.AbsoluteUri+'|'+$ns))) -ne $Target){throw 'source-target-mismatch'}
    return [pscustomobject]@{atelierUrl=$uri.AbsoluteUri;namespace=$ns}
}
function Read-ExportState([string]$Root) {
    $path=Join-Path $Root 'baseline-state.json';$state=Read-Json $path
    if($state.schema -ne 'iris-standalone-baseline/v1' -or $state.target -cnotmatch '^[a-f0-9]{64}$' -or -not @($state.items).Count){throw 'export-state-invalid'}
    $seen=@{};$paths=@{};$included=@();$excluded=@()
    foreach($item in $state.items){
        $expected=Expected-Path $item.document
        if($expected -cne $item.path -or $seen.ContainsKey($item.document) -or $paths.ContainsKey($expected)){throw 'export-object-map-invalid'}
        [void](Join-Safe $Root $expected);$seen[$item.document]=$true;$paths[$expected]=$true
        if($item.status -eq 'fetched'){
            if($item.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $item.bytes -le 0){throw 'export-object-hash-invalid'}
            $included += [pscustomobject]@{document=$item.document;path=$item.path;sha256=$item.sha256;bytes=$item.bytes}
        }else{$excluded += [pscustomobject]@{document=$item.document;status=$item.status}}
    }
    if(-not $included.Count){throw 'no-successful-source'}
    if($state.state -eq 'complete' -and $excluded.Count){throw 'export-complete-count-mismatch'}
    return [pscustomobject]@{state=$state;receiptSha256=(Hash-File $path);items=@($included);excluded=@($excluded)}
}
function Assert-SourceSet([string]$Root,$Items) {
    $expected=@{};foreach($item in $Items){$expected[(Join-Safe $Root $item.path)]=$true}
    $actual=@(List-Files (Join-Path $Root 'src'))
    if($actual.Count -ne $expected.Count -or @($actual|Where-Object{-not $expected.ContainsKey($_)}).Count){throw 'source-file-set-changed'}
}
function Check-Text($Item,[byte[]]$Bytes){
    if(-not $Bytes.Length){throw 'empty-source-file'}
    if($Bytes.Length -ge 3 -and $Bytes[0]-eq 239 -and $Bytes[1]-eq 187 -and $Bytes[2]-eq 191){throw 'source-utf8-bom-forbidden'}
    try{$text=$utf8.GetString($Bytes)}catch{throw 'source-utf8-required'}
    if($Item.document.EndsWith('.cls') -and $text -notmatch ('(?m)^\s*Class\s+'+[regex]::Escape($Item.document.Substring(0,$Item.document.Length-4))+'(?=\s|\(|$)')){throw 'class-identity-mismatch'}
}
function Download-List($Items){
    $lines=@($Items|ForEach-Object{if($_.document.Contains('/') -or [IO.Path]::GetExtension($_.document).ToLowerInvariant()-in @('.csp','.csr','.js','.css','.html','.htm')){'/'+$_.document}else{$_.document}})
    return ($lines-join "`n")+"`n"
}
function Delivery-List($Items,[bool]$Manual){if($Manual){return (@($Items|ForEach-Object{$_.path})-join "`n")+"`n"};return Download-List $Items}
function Write-New([string]$Path,[byte[]]$Bytes){
    Plain-Path $Path;[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Cleanup-Stage([string]$Stage,[string]$Target){
    if([IO.Path]::GetDirectoryName($Stage)-ne [IO.Path]::GetDirectoryName($Target)-or -not $Stage.StartsWith($Target+'.')-or -not $Stage.EndsWith('.tmp')){throw 'invalid-stage'}
    if(Test-Path -LiteralPath $Stage){Plain-Path $Stage;[void]@(List-Files $Stage);Remove-Item -LiteralPath $Stage -Recurse -Force;if(Test-Path -LiteralPath $Stage){throw 'stage-cleanup-failed'}}
}
function Read-Baseline([string]$Root){
    $base=Baseline-Path $Root;$manifest=Read-Json (Join-Path $base 'manifest.json')
    if($manifest.schema -eq 'iris-source-baseline/v2'){return Read-ExtendedBaseline $Root $base $manifest}
    if($WorkspaceBinding){throw 'legacy-baseline-needs-explicit-adoption'}
    $info=Read-ExportState $Root
    if($manifest.schema -ne 'iris-source-baseline/v1' -or $manifest.exportReceiptSha256 -ne $info.receiptSha256 -or $manifest.target -ne $info.state.target -or @($manifest.items).Count -ne $info.items.Count){throw 'development-baseline-mismatch'}
    if($manifest.complete -ne ($info.state.state-eq 'complete') -or ($manifest.excluded|ConvertTo-Json -Compress)-cne ($info.excluded|ConvertTo-Json -Compress)){throw 'development-source-status-mismatch'}
    if($manifest.observedFrom-cne $info.state.startedAt -or $manifest.observedTo-cne $info.state.updatedAt){throw 'development-observation-mismatch'}
    $source=Source-Info $manifest.source $manifest.target
    for($i=0;$i -lt $info.items.Count;$i++){
        $item=$info.items[$i];$old=$manifest.items[$i]
        if($old.document -cne $item.document -or $old.path -cne $item.path -or $old.sha256 -ne $item.sha256 -or $old.bytes -ne $item.bytes){throw 'development-object-mismatch'}
        $file=Join-Safe $base $item.path
        if((Hash-File $file)-ne $item.sha256 -or (Get-Item -LiteralPath $file).Length-ne $item.bytes){throw 'original-baseline-drift'}
    }
    Assert-SourceSet $base $info.items
    return [pscustomobject]@{export=$info;directory=$base;source=$source;manifest=$manifest}
}
function Verify-Delivery([string]$Directory,$Baseline){
    Plain-Path $Directory;$manifest=Read-Json (Join-Path $Directory 'manifest.json')
    $manual=$manifest.schema -eq 'iris-source-delivery/v2' -and $manifest.sourceKind -eq 'manual-source'
    if($manifest.schema -notin @('iris-source-delivery/v1','iris-source-delivery/v2') -or $manifest.state-ne 'verified' -or (-not $manual -and $manifest.target-cnotmatch '^[a-f0-9]{64}$') -or -not @($manifest.items).Count -or $manifest.changedCount-ne @($manifest.items).Count -or $manifest.compileVerified -or $manifest.targetDriftVerified){throw 'delivery-manifest-invalid'}
    if($manifest.schema -eq 'iris-source-delivery/v2' -and $manifest.sourceKind -notin @('manual-source','export-receipt')){throw 'delivery-source-kind-invalid'}
    if($manifest.schema -eq 'iris-source-delivery/v2'){
        if($manifest.scopeSha256 -cnotmatch '^[a-f0-9]{64}$' -or ($manifest.workspaceBindingSha256 -and $manifest.workspaceBindingSha256 -cnotmatch '^[a-f0-9]{64}$')){throw 'delivery-scope-binding-invalid'}
        if($manual -and ($manifest.target -or $manifest.exportReceiptSha256 -or $manifest.completeSource)){throw 'manual-source-identity-invalid'}
        if(-not $manual -and $manifest.exportReceiptSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'delivery-receipt-invalid'}
        if($manifest.workspaceBindingSha256 -and ($manifest.localEvidence.schema -ne 'iris-local-delivery-evidence/v1' -or $manifest.localEvidence.gitDiffSha256 -cnotmatch '^[a-f0-9]{64}$' -or $manifest.localEvidence.hospitalAcceptance -ne 'pending')){throw 'delivery-local-evidence-invalid'}
    }
    [void](Source-Info $manifest.source $manifest.target)
    $expected=@{'manifest.json'=$true;'变更说明.md'=$true;'files.txt'=$true};$documents=@{};$beforeItems=@{}
    if($Baseline){
        if($manifest.exportReceiptSha256-ne $Baseline.export.receiptSha256 -or $manifest.target-ne $Baseline.manifest.target){throw 'delivery-baseline-mismatch'}
        if($manifest.schema -eq 'iris-source-delivery/v2' -and ($manifest.scopeSha256 -ne $Baseline.manifest.scopeSha256 -or $manifest.workspaceBindingSha256 -ne $Baseline.manifest.workspaceBindingSha256)){throw 'delivery-scope-binding-mismatch'}
        if($manifest.schema -eq 'iris-source-delivery/v2' -and ($manifest.batchId -cne $Baseline.manifest.batchId -or $manifest.sourceKind -ne $Baseline.manifest.sourceKind -or ($manifest.source|ConvertTo-Json -Compress)-cne ($Baseline.source|ConvertTo-Json -Compress) -or $manifest.completeSource -ne $Baseline.manifest.complete)){throw 'delivery-provenance-mismatch'}
        foreach($item in $Baseline.export.items){$beforeItems[$item.document]=$item}
    }
    foreach($item in $manifest.items){
        if((-not $manual -and $item.path-cne (Expected-Path $item.document)) -or $documents.ContainsKey($item.document) -or $item.beforeSha256-cnotmatch '^[a-f0-9]{64}$' -or $item.afterSha256-cnotmatch '^[a-f0-9]{64}$' -or $item.beforeSha256-eq $item.afterSha256){throw 'delivery-object-invalid'}
        if($manual){[void](Join-Safe $Directory $item.path);[void](Supported-Extension $item.path)}
        $documents[$item.document]=$true
        if($manifest.localEvidence){$actual=@($manifest.localEvidence.files|Where-Object{$_.path -ceq $item.path -and $_.sha256 -eq $item.afterSha256});if($actual.Count -ne 1){throw 'delivery-git-evidence-mismatch'}}
        foreach($pair in @(@('changes',$item.afterSha256),@('rollback',$item.beforeSha256))){
            $relative=$pair[0]+'/'+$item.path;$expected[$relative]=$true;$file=Join-Safe $Directory $relative
            if((Hash-File $file)-ne $pair[1] -or $manifest.files.$relative-ne $pair[1]){throw 'delivery-file-drift'}
            if($manifest.schema -eq 'iris-source-delivery/v2' -and (Get-Item -LiteralPath $file).Length -ne $(if($pair[0] -eq 'changes'){$item.afterBytes}else{$item.beforeBytes})){throw 'delivery-file-size-mismatch'}
            Check-Text $item ([IO.File]::ReadAllBytes($file))
        }
        if($Baseline -and (-not $beforeItems.ContainsKey($item.document) -or $beforeItems[$item.document].sha256-ne $item.beforeSha256 -or $beforeItems[$item.document].path-cne $item.path)){throw 'delivery-original-mismatch'}
    }
    if((Hash-File (Join-Path $Directory '变更说明.md'))-ne $manifest.files.'变更说明.md'){throw 'delivery-notes-drift'}
    if((Hash-File (Join-Path $Directory 'files.txt'))-ne $manifest.files.'files.txt'){throw 'delivery-list-drift'}
    if($utf8.GetString([IO.File]::ReadAllBytes((Join-Path $Directory 'files.txt')))-cne (Delivery-List $manifest.items $manual)){throw 'delivery-list-scope-mismatch'}
    $files=@(List-Files $Directory)
    if($files.Count-ne $expected.Count){throw 'delivery-file-set-changed'}
    foreach($file in $files){$relative=$file.Substring($Directory.TrimEnd('\','/').Length+1).Replace('\','/');if(-not $expected.ContainsKey($relative)){throw 'delivery-file-set-changed'}}
    return $manifest
}

function Baseline-Path([string]$Root) {
    if($BaselineDirectory){$value=(Full-Path $BaselineDirectory).TrimEnd('\','/')}elseif($Root){$value=Join-Path $Root '.baseline'}else{throw 'baseline-directory-required'}
    Plain-Path $value;return $value
}
function Supported-Extension([string]$Relative) {
    $extension=[IO.Path]::GetExtension($Relative).ToLowerInvariant()
    if($extension -notin @('.cls','.mac','.inc','.int','.csp','.csr','.js','.css','.html','.htm')){throw 'source-type-unsupported'}
    if(@($Relative.Split('/')|Where-Object{$_ -in @('.git','.agents','.baseline')}).Count){throw 'private-source-path-forbidden'}
    return $extension
}
function Scope-Paths($Fallback) {
    $values=@($Fallback)
    if($ScopeFile){$scope=Read-Json (Full-Path $ScopeFile);if(-not $scope.files -or $scope.files -is [string]){throw 'source-scope-invalid'};$values=@($scope.files)}
    if(-not $values.Count){throw 'source-scope-required'}
    $seen=@{};foreach($value in $values){if($value -isnot [string] -or $seen.ContainsKey($value)){throw 'source-scope-invalid'};[void](Join-Safe ([IO.Path]::GetTempPath().TrimEnd('\','/')) $value);[void](Supported-Extension $value);$seen[$value]=$true}
    [Array]::Sort($values,[StringComparer]::Ordinal);return ,$values
}
function Scope-Hash($Paths) { return Hash-Bytes ($utf8.GetBytes((@($Paths)-join "`n"))) }
function Binding-Value([string]$Root) {
    if(-not $WorkspaceBinding){return $null}
    try{$bytes=[Convert]::FromBase64String($WorkspaceBinding);$value=$utf8.GetString($bytes)|ConvertFrom-Json}catch{throw 'workspace-binding-invalid'}
    foreach($name in @('workspaceRoot','sourceRoot','gitRoot')){if(-not $value.$name -or -not [IO.Path]::IsPathRooted([string]$value.$name)){throw 'workspace-binding-invalid'};Plain-Path ([string]$value.$name)}
    if($Root){foreach($parent in @($value.sourceRoot,$value.gitRoot)){if($Root -ine $parent -and -not $Root.StartsWith($parent.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'workspace-binding-source-mismatch'}}}
    return [pscustomobject]@{value=$value;sha256=(Hash-Bytes $bytes)}
}
function Read-ExtendedBaseline([string]$Root,[string]$Base,$Manifest) {
    if($Manifest.sourceKind -notin @('manual-source','export-receipt') -or -not @($Manifest.items).Count){throw 'development-baseline-invalid'}
    $paths=Scope-Paths @($Manifest.items|ForEach-Object{$_.path})
    if((Scope-Hash $paths) -ne $Manifest.scopeSha256 -or @($Manifest.items).Count -ne $paths.Count){throw 'source-scope-drift'}
    $binding=Binding-Value $Root
    if($Manifest.workspaceBindingSha256 -and (-not $binding -or $binding.sha256 -ne $Manifest.workspaceBindingSha256)){throw 'workspace-binding-changed'}
    if(-not $Manifest.workspaceBindingSha256 -and $binding){throw 'baseline-not-bound-to-workspace'}
    $source=Source-Info $Manifest.source $Manifest.target
    if($Manifest.sourceKind -eq 'manual-source' -and $source.kind -ne 'manual-source'){throw 'manual-source-identity-invalid'}
    $seen=@{};$documents=@{}
    foreach($item in @($Manifest.items)){
        if($seen.ContainsKey($item.path) -or -not $item.document -or $documents.ContainsKey($item.document) -or $item.path -notin $paths -or $item.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $item.bytes -le 0){throw 'development-object-mismatch'}
        $documents[$item.document]=$true
        $seen[$item.path]=$true;[void](Supported-Extension $item.path)
        if($Manifest.sourceKind -eq 'export-receipt' -and $item.path -cne (Expected-Path $item.document)){throw 'development-object-mismatch'}
        $file=Join-Safe $Base $item.path
        if((Hash-File $file) -ne $item.sha256 -or (Get-Item -LiteralPath $file).Length -ne $item.bytes){throw 'original-baseline-drift'}
        Check-Text $item ([IO.File]::ReadAllBytes($file))
    }
    if($Manifest.sourceKind -eq 'export-receipt' -and $Root){
        $receipt=Read-ExportState $Root
        if($receipt.receiptSha256 -ne $Manifest.exportReceiptSha256 -or $receipt.state.target -ne $Manifest.target){throw 'export-receipt-drift'}
        foreach($item in @($Manifest.items)){$matches=@($receipt.items|Where-Object{$_.path -ceq $item.path -and $_.document -ceq $item.document -and $_.sha256 -eq $item.sha256});if($matches.Count -ne 1){throw 'development-object-mismatch'}}
    }
    return [pscustomobject]@{directory=$Base;source=$source;manifest=$Manifest;export=[pscustomobject]@{items=@($Manifest.items);receiptSha256=$Manifest.exportReceiptSha256}}
}
function Prepare-Extended([string]$Root) {
    $binding=Binding-Value $Root;$items=@();$receipt=$null
    if($SourceDirectory){
        if(-not $OriginalDirectory -or -not $BatchId -or -not $ScopeFile){throw 'manual-source-original-batch-and-scope-required'}
        $original=(Full-Path $OriginalDirectory).TrimEnd('\','/');Plain-Path $original
        if($original -ieq $Root){throw 'manual-original-must-be-separate'}
        $source=Source-Info ([pscustomobject]@{kind='manual-source';batchId=$BatchId}) ''
        $paths=Scope-Paths @();$kind='manual-source';$targetIdentity=$null;$complete=$false;$excluded=@();$observedFrom=$null;$observedTo=$null
        foreach($relative in $paths){
            $before=Join-Safe $original $relative;$current=Join-Safe $Root $relative
            if(-not(Test-Path -LiteralPath $before -PathType Leaf) -or -not(Test-Path -LiteralPath $current -PathType Leaf)){throw 'source-add-delete-rename-unsupported'}
            $bytes=[IO.File]::ReadAllBytes($before);$document=$relative
            if((Supported-Extension $relative) -eq '.cls'){$text=$utf8.GetString($bytes);if($text -notmatch '(?m)^\s*Class\s+([%A-Za-z][%A-Za-z0-9]*(?:\.[%A-Za-z][%A-Za-z0-9]*)*)\b'){throw 'class-identity-missing'};$document=$Matches[1]+'.cls'}
            $item=[pscustomobject]@{document=$document;path=$relative;sha256=(Hash-Bytes $bytes);bytes=$bytes.Length};Check-Text $item $bytes
            if((Hash-File $current) -ne $item.sha256){throw 'source-changed-before-prepare'};$items+=$item
        }
    }else{
        $receipt=Read-ExportState $Root
        if($receipt.state.state-ne 'complete' -and -not $AllowPartial){throw 'incomplete-export-review-and-use-AllowPartial'}
        $sourceValue=$receipt.state.source
        if($AtelierUrl -or $Namespace){if(-not $AtelierUrl -or -not $Namespace){throw 'source-url-and-namespace-required-together'};$sourceValue=[pscustomobject]@{atelierUrl=$AtelierUrl;namespace=$Namespace}}
        if(-not $sourceValue){throw 'source-information-required'}
        $source=Source-Info $sourceValue $receipt.state.target;$kind='export-receipt';$targetIdentity=$receipt.state.target;$complete=$receipt.state.state-eq 'complete';$excluded=@($receipt.excluded);$observedFrom=$receipt.state.startedAt;$observedTo=$receipt.state.updatedAt
        $paths=Scope-Paths @($receipt.items|ForEach-Object{$_.path})
        foreach($relative in $paths){$match=@($receipt.items|Where-Object{$_.path -ceq $relative});if($match.Count -ne 1){throw 'source-scope-not-in-export'};$items+=$match[0]}
    }
    $documents=@{};foreach($item in $items){if($documents.ContainsKey($item.document)){throw 'duplicate-source-object'};$documents[$item.document]=$true}
    $target=Baseline-Path $Root;if(Test-Path -LiteralPath $target){throw 'development-baseline-already-exists'}
    $stage=$target+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try{
        [void][IO.Directory]::CreateDirectory($stage)
        foreach($item in $items){$file=Join-Safe $Root $item.path;$bytes=[IO.File]::ReadAllBytes($file);Check-Text $item $bytes;if((Hash-Bytes $bytes) -ne $item.sha256){throw 'source-changed-before-prepare'};Write-New (Join-Safe $stage $item.path) $bytes}
        $manifest=[ordered]@{schema='iris-source-baseline/v2';sourceKind=$kind;source=$source;target=$targetIdentity;batchId=$BatchId;exportReceiptSha256=$(if($receipt){$receipt.receiptSha256}else{$null});scopeSha256=(Scope-Hash $paths);workspaceBindingSha256=$(if($binding){$binding.sha256}else{$null});preparedAt=[DateTime]::UtcNow.ToString('o');observedFrom=$observedFrom;observedTo=$observedTo;complete=$complete;excluded=$excluded;items=@($items)}
        Write-New (Join-Path $stage 'manifest.json') ($utf8.GetBytes(($manifest|ConvertTo-Json -Depth 12)))
        foreach($item in $items){if((Hash-File (Join-Safe $Root $item.path)) -ne $item.sha256){throw 'source-drift-during-prepare'}}
        if($receipt -and (Hash-File (Join-Path $Root 'baseline-state.json')) -ne $receipt.receiptSha256){throw 'export-receipt-drift'}
        Plain-Path $target;[IO.Directory]::Move($stage,$target)
    }finally{Cleanup-Stage $stage $target}
    [pscustomobject]@{state='prepared';sourceKind=$kind;originalCount=$items.Count;baselineDirectory=$target;scopeSha256=$manifest.scopeSha256;completeSource=$complete}|ConvertTo-Json -Depth 6
}

$mutex=$null;$acquired=$false
try{
    if($env:OS-ne 'Windows_NT'){throw 'windows-powershell-required'}
    if($Mode-ne 'Prepare' -and ($AtelierUrl -or $Namespace -or $AllowPartial)){throw 'prepare-options-used-in-other-mode'}
    if($CurrentExportDirectory -and $Mode-ne 'Verify'){throw 'current-export-is-for-verify-only'}
    if($CurrentSourceDirectory -and $Mode-ne 'Verify'){throw 'current-source-is-for-verify-only'}
    if($ExportDirectory -and $SourceDirectory){throw 'source-input-options-conflict'}
    if($OriginalDirectory -and $Mode-ne 'Prepare'){throw 'original-directory-is-for-prepare-only'}
    $root=$null;$baseline=$null
    if($ExportDirectory -or $SourceDirectory){
        $root=(Full-Path $(if($SourceDirectory){$SourceDirectory}else{$ExportDirectory})).TrimEnd('\','/');Plain-Path $root
        if($root-eq [IO.Path]::GetPathRoot($root).TrimEnd('\','/')){throw 'export-must-not-be-volume-root'}
        $mutex=New-Object Threading.Mutex($false,('Local\IrisCodeOutput-'+(Hash-Bytes ($utf8.GetBytes($root.ToLowerInvariant())))))
        try{$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
        if(-not $acquired){throw 'another-export-or-source-operation-is-running'}
    }
    if($Mode -in @('Prepare','Pack') -and -not $root){throw 'ExportDirectory-required'}
    if($Mode-eq 'Prepare'){
        if($SourceDirectory -or $BaselineDirectory -or $ScopeFile -or $WorkspaceBinding -or $BatchId){Prepare-Extended $root;exit 0}
        $info=Read-ExportState $root
        if($info.state.state-ne 'complete' -and -not $AllowPartial){throw 'incomplete-export-review-and-use-AllowPartial'}
        $source=$info.state.source
        if($AtelierUrl -or $Namespace){if(-not $AtelierUrl -or -not $Namespace){throw 'source-url-and-namespace-required-together'};$source=[pscustomobject]@{atelierUrl=$AtelierUrl;namespace=$Namespace}}
        if(-not $source){$source=[pscustomobject]@{atelierUrl=(Read-Host 'Original Atelier root URL');namespace=(Read-Host 'Original Namespace')}}
        $source=Source-Info $source $info.state.target
        Assert-SourceSet $root $info.items
        $target=Join-Path $root '.baseline';if(Test-Path -LiteralPath $target){throw 'development-baseline-already-exists'}
        $stage=$target+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        try{
            [void][IO.Directory]::CreateDirectory($stage)
            foreach($item in $info.items){$file=Join-Safe $root $item.path;$bytes=[IO.File]::ReadAllBytes($file);if((Hash-Bytes $bytes)-ne $item.sha256 -or $bytes.Length-ne $item.bytes){throw 'source-changed-before-prepare'};Check-Text $item $bytes;Write-New (Join-Safe $stage $item.path) $bytes}
            $manifest=[ordered]@{schema='iris-source-baseline/v1';source=$source;target=$info.state.target;exportReceiptSha256=$info.receiptSha256;preparedAt=[DateTime]::UtcNow.ToString('o');observedFrom=$info.state.startedAt;observedTo=$info.state.updatedAt;complete=($info.state.state-eq 'complete');excluded=@($info.excluded);items=@($info.items)}
            Write-New (Join-Path $stage 'manifest.json') ($utf8.GetBytes(($manifest|ConvertTo-Json -Depth 10)))
            foreach($item in $info.items){if((Hash-File (Join-Safe $root $item.path))-ne $item.sha256 -or (Hash-File (Join-Safe $stage $item.path))-ne $item.sha256){throw 'source-drift-during-prepare'}}
            Assert-SourceSet $root $info.items
            if((Hash-File (Join-Path $root 'baseline-state.json'))-ne $info.receiptSha256){throw 'export-receipt-drift'}
            Plain-Path $target;[IO.Directory]::Move($stage,$target)
        }finally{Cleanup-Stage $stage $target}
        [pscustomobject]@{state='prepared';source=$source;originalCount=$info.items.Count;complete=$manifest.complete;excluded=@($info.excluded)}|ConvertTo-Json -Depth 8
    }elseif($Mode-eq 'Verify'){
        if(-not $OutputDirectory){throw 'OutputDirectory-required'}
        if($root -or $BaselineDirectory){$baseline=Read-Baseline $root}
        $receipt=Verify-Delivery ((Full-Path $OutputDirectory).TrimEnd('\','/')) $baseline
        $comparison=$null
        if($CurrentSourceDirectory){
            if($receipt.sourceKind -ne 'manual-source'){throw 'current-source-kind-mismatch'}
            $currentRoot=(Full-Path $CurrentSourceDirectory).TrimEnd('\','/');Plain-Path $currentRoot
            foreach($item in $receipt.items){$file=Join-Safe $currentRoot $item.path;if(-not(Test-Path -LiteralPath $file -PathType Leaf) -or (Hash-File $file) -ne $item.beforeSha256){throw 'current-source-differs-from-baseline'}}
            $comparison=[ordered]@{matches=$true;meaning='matches-the-provided-snapshot-not-a-live-lock'}
        }
        if($CurrentExportDirectory){
            $currentRoot=(Full-Path $CurrentExportDirectory).TrimEnd('\','/');$current=Read-ExportState $currentRoot
            if($current.state.target-ne $receipt.target){throw 'current-export-target-mismatch'}
            $byDocument=@{};foreach($item in $current.items){if((Hash-File (Join-Safe $currentRoot $item.path))-ne $item.sha256){throw 'current-export-file-drift'};$byDocument[$item.document]=$item}
            foreach($item in $receipt.items){
                if(-not $byDocument.ContainsKey($item.document)){throw ('current-source-not-fetched: '+$item.document)}
                if($byDocument[$item.document].sha256-ne $item.beforeSha256){throw ('current-source-differs-from-baseline: '+$item.document)}
            }
            $comparison=[ordered]@{matches=$true;observedFrom=$current.state.startedAt;observedTo=$current.state.updatedAt;meaning='matches-the-provided-snapshot-not-a-live-lock'}
        }
        [pscustomobject]@{state='verified';source=$receipt.source;changedCount=$receipt.changedCount;currentSnapshot=$comparison;targetDriftVerified=$false}|ConvertTo-Json -Depth 5
    }else{
        $baseline=Read-Baseline $root;if($baseline.manifest.schema -eq 'iris-source-baseline/v1'){Assert-SourceSet $root $baseline.export.items}
        $output=Join-Path $root 'delivery';if($OutputDirectory){$output=(Full-Path $OutputDirectory).TrimEnd('\','/')};Plain-Path $output
        if(Test-Path -LiteralPath $output){throw 'output-directory-must-be-new'}
        foreach($protected in @((Join-Path $root 'src'),$baseline.directory)){if($output.StartsWith($protected+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'delivery-inside-protected-source'}}
        $changed=@()
        foreach($item in $baseline.export.items){$current=Join-Safe $root $item.path;if(-not(Test-Path -LiteralPath $current -PathType Leaf)){throw 'source-add-delete-rename-unsupported'};$bytes=[IO.File]::ReadAllBytes($current);Check-Text $item $bytes;$hash=Hash-Bytes $bytes;if($hash-ne $item.sha256){$changed += [pscustomobject]@{document=$item.document;path=$item.path;beforeSha256=$item.sha256;afterSha256=$hash;beforeBytes=$item.bytes;afterBytes=$bytes.Length}}}
        if(-not $changed.Count){[pscustomobject]@{state='unchanged';changedCount=0;outputCreated=$false}|ConvertTo-Json;exit 0}
        if(-not $NotesFile){throw 'NotesFile-required'};$notesPath=Full-Path $NotesFile;Plain-Path $notesPath
        if((Get-Item -LiteralPath $notesPath).Length-gt 1048576){throw 'notes-too-large'};$notes=$utf8.GetString([IO.File]::ReadAllBytes($notesPath)).TrimStart([char]0xFEFF).Trim();if(-not $notes){throw 'notes-empty'}
        $stage=$output+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        try{
            [void][IO.Directory]::CreateDirectory($stage);$hashes=[ordered]@{}
            foreach($item in $changed){foreach($pair in @(@('changes',$root,$item.afterSha256),@('rollback',$baseline.directory,$item.beforeSha256))){$bytes=[IO.File]::ReadAllBytes((Join-Safe $pair[1] $item.path));if((Hash-Bytes $bytes)-ne $pair[2]){throw 'source-drift-during-pack'};$relative=$pair[0]+'/'+$item.path;Write-New (Join-Safe $stage $relative) $bytes;$hashes[$relative]=$pair[2]}}
            $lines=@('# 源码变更说明','',$notes,'','## 来源与范围','',('- Atelier：'+$baseline.source.atelierUrl),('- Namespace：'+$baseline.source.namespace),('- 修改对象数：'+$changed.Count),('- 来源完整：'+$baseline.manifest.complete),'- changes 仅含修改后的完整源码；rollback 为同一批对象的原始源码。','','## 对象摘要','')
            if($baseline.source.kind -eq 'manual-source'){$lines=@('# 源码变更说明','',$notes,'','## 来源与范围','',('- 人工接收批次：'+$baseline.source.batchId),'- 来源 URL、namespace 未确认，不声明医院全量源码。',('- 修改对象数：'+$changed.Count),'- changes/rollback 保留输入相对路径，不自动导入或编译。','','## 对象摘要','')}
            foreach($item in $changed){$lines+=@('- '+$item.document,('  - 本地路径：{0}'-f $item.path),('  - before: {0}'-f $item.beforeSha256),('  - after: {0}'-f $item.afterSha256))}
            $lines+=@('','## 还回现场','', '- 本包记录的是带出来源；它不自动选择部署目标或授予写入权限。','- 先核对地址与 Namespace，并用相同读取表示核对现场当前内容与 before 摘要；不一致先合并。','- 按项目原有方式导入类/例程、上传对应 Web 虚拟路径，再编译、验收。','- 未上传、编译或执行业务验收；离线 Verify 不证明现场没有并行修改。','- rollback 来自带出的基线，回退前也须核对现场后续变化。','')
            Write-New (Join-Path $stage '变更说明.md') ($utf8.GetBytes(($lines-join "`n")));$hashes['变更说明.md']=Hash-File (Join-Path $stage '变更说明.md')
            Write-New (Join-Path $stage 'files.txt') ($utf8.GetBytes((Delivery-List $changed ($baseline.source.kind -eq 'manual-source'))));$hashes['files.txt']=Hash-File (Join-Path $stage 'files.txt')
            $receipt=[ordered]@{schema='iris-source-delivery/v1';state='verified';source=$baseline.source;target=$baseline.manifest.target;exportReceiptSha256=$baseline.export.receiptSha256;createdAt=[DateTime]::UtcNow.ToString('o');observedFrom=$baseline.manifest.observedFrom;observedTo=$baseline.manifest.observedTo;completeSource=$baseline.manifest.complete;excluded=@($baseline.manifest.excluded);changedCount=$changed.Count;files=$hashes;items=@($changed);compileVerified=$false;targetDriftVerified=$false}
            if($baseline.manifest.schema -eq 'iris-source-baseline/v2'){$receipt.schema='iris-source-delivery/v2';$receipt.sourceKind=$baseline.manifest.sourceKind;$receipt.batchId=$baseline.manifest.batchId;$receipt.scopeSha256=$baseline.manifest.scopeSha256;$receipt.workspaceBindingSha256=$baseline.manifest.workspaceBindingSha256}
            if($WorkspaceEvidence){try{$receipt.localEvidence=$utf8.GetString([Convert]::FromBase64String($WorkspaceEvidence))|ConvertFrom-Json}catch{throw 'workspace-evidence-invalid'}}
            Write-New (Join-Path $stage 'manifest.json') ($utf8.GetBytes(($receipt|ConvertTo-Json -Depth 12)))
            [void](Verify-Delivery $stage $baseline)
            foreach($item in $baseline.export.items){if((Hash-File (Join-Safe $root $item.path))-ne $(if($changed.document-contains $item.document){($changed|Where-Object{$_.document-ceq $item.document}).afterSha256}else{$item.sha256})){throw 'source-drift-before-publication'}}
            if($baseline.manifest.schema -eq 'iris-source-baseline/v1'){Assert-SourceSet $root $baseline.export.items}
            Plain-Path $output;[IO.Directory]::Move($stage,$output)
        }finally{Cleanup-Stage $stage $output}
        [pscustomobject]@{state='verified';source=$baseline.source;changedCount=$changed.Count;outputDirectory=$output;compileVerified=$false;targetDriftVerified=$false}|ConvertTo-Json -Depth 5
    }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
finally{if($acquired){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}}
