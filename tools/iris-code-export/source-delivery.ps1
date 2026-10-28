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
    [switch]$AllowPartial
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
    $info=Read-ExportState $Root;$base=Join-Path $Root '.baseline';$manifest=Read-Json (Join-Path $base 'manifest.json')
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
    if($manifest.schema -ne 'iris-source-delivery/v1' -or $manifest.state-ne 'verified' -or $manifest.target-cnotmatch '^[a-f0-9]{64}$' -or -not @($manifest.items).Count -or $manifest.changedCount-ne @($manifest.items).Count -or $manifest.compileVerified -or $manifest.targetDriftVerified){throw 'delivery-manifest-invalid'}
    [void](Source-Info $manifest.source $manifest.target)
    $expected=@{'manifest.json'=$true;'变更说明.md'=$true;'files.txt'=$true};$documents=@{};$beforeItems=@{}
    if($Baseline){
        if($manifest.exportReceiptSha256-ne $Baseline.export.receiptSha256 -or $manifest.target-ne $Baseline.manifest.target){throw 'delivery-baseline-mismatch'}
        foreach($item in $Baseline.export.items){$beforeItems[$item.document]=$item}
    }
    foreach($item in $manifest.items){
        if($item.path-cne (Expected-Path $item.document) -or $documents.ContainsKey($item.document) -or $item.beforeSha256-cnotmatch '^[a-f0-9]{64}$' -or $item.afterSha256-cnotmatch '^[a-f0-9]{64}$' -or $item.beforeSha256-eq $item.afterSha256){throw 'delivery-object-invalid'}
        $documents[$item.document]=$true
        foreach($pair in @(@('changes',$item.afterSha256),@('rollback',$item.beforeSha256))){
            $relative=$pair[0]+'/'+$item.path;$expected[$relative]=$true;$file=Join-Safe $Directory $relative
            if((Hash-File $file)-ne $pair[1] -or $manifest.files.$relative-ne $pair[1]){throw 'delivery-file-drift'}
            Check-Text $item ([IO.File]::ReadAllBytes($file))
        }
        if($Baseline -and (-not $beforeItems.ContainsKey($item.document) -or $beforeItems[$item.document].sha256-ne $item.beforeSha256 -or $beforeItems[$item.document].path-cne $item.path)){throw 'delivery-original-mismatch'}
    }
    if((Hash-File (Join-Path $Directory '变更说明.md'))-ne $manifest.files.'变更说明.md'){throw 'delivery-notes-drift'}
    if((Hash-File (Join-Path $Directory 'files.txt'))-ne $manifest.files.'files.txt'){throw 'delivery-list-drift'}
    if($utf8.GetString([IO.File]::ReadAllBytes((Join-Path $Directory 'files.txt')))-cne (Download-List $manifest.items)){throw 'delivery-list-scope-mismatch'}
    $files=@(List-Files $Directory)
    if($files.Count-ne $expected.Count){throw 'delivery-file-set-changed'}
    foreach($file in $files){$relative=$file.Substring($Directory.TrimEnd('\','/').Length+1).Replace('\','/');if(-not $expected.ContainsKey($relative)){throw 'delivery-file-set-changed'}}
    return $manifest
}

$mutex=$null;$acquired=$false
try{
    if($env:OS-ne 'Windows_NT'){throw 'windows-powershell-required'}
    if($Mode-ne 'Prepare' -and ($AtelierUrl -or $Namespace -or $AllowPartial)){throw 'prepare-options-used-in-other-mode'}
    if($CurrentExportDirectory -and $Mode-ne 'Verify'){throw 'current-export-is-for-verify-only'}
    $root=$null;$baseline=$null
    if($ExportDirectory){
        $root=(Full-Path $ExportDirectory).TrimEnd('\','/');Plain-Path $root
        if($root-eq [IO.Path]::GetPathRoot($root).TrimEnd('\','/')){throw 'export-must-not-be-volume-root'}
        $mutex=New-Object Threading.Mutex($false,('Local\IrisCodeOutput-'+(Hash-Bytes ($utf8.GetBytes($root.ToLowerInvariant())))))
        try{$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
        if(-not $acquired){throw 'another-export-or-source-operation-is-running'}
    }
    if($Mode -in @('Prepare','Pack') -and -not $root){throw 'ExportDirectory-required'}
    if($Mode-eq 'Prepare'){
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
        if($root){$baseline=Read-Baseline $root}
        $receipt=Verify-Delivery ((Full-Path $OutputDirectory).TrimEnd('\','/')) $baseline
        $comparison=$null
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
        $baseline=Read-Baseline $root;Assert-SourceSet $root $baseline.export.items
        $output=Join-Path $root 'delivery';if($OutputDirectory){$output=(Full-Path $OutputDirectory).TrimEnd('\','/')};Plain-Path $output
        if(Test-Path -LiteralPath $output){throw 'output-directory-must-be-new'}
        foreach($protected in @((Join-Path $root 'src'),$baseline.directory)){if($output.StartsWith($protected+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'delivery-inside-protected-source'}}
        $changed=@()
        foreach($item in $baseline.export.items){$bytes=[IO.File]::ReadAllBytes((Join-Safe $root $item.path));Check-Text $item $bytes;$hash=Hash-Bytes $bytes;if($hash-ne $item.sha256){$changed += [pscustomobject]@{document=$item.document;path=$item.path;beforeSha256=$item.sha256;afterSha256=$hash;beforeBytes=$item.bytes;afterBytes=$bytes.Length}}}
        if(-not $changed.Count){[pscustomobject]@{state='unchanged';changedCount=0;outputCreated=$false}|ConvertTo-Json;exit 0}
        if(-not $NotesFile){throw 'NotesFile-required'};$notesPath=Full-Path $NotesFile;Plain-Path $notesPath
        if((Get-Item -LiteralPath $notesPath).Length-gt 1048576){throw 'notes-too-large'};$notes=$utf8.GetString([IO.File]::ReadAllBytes($notesPath)).TrimStart([char]0xFEFF).Trim();if(-not $notes){throw 'notes-empty'}
        $stage=$output+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        try{
            [void][IO.Directory]::CreateDirectory($stage);$hashes=[ordered]@{}
            foreach($item in $changed){foreach($pair in @(@('changes',$root,$item.afterSha256),@('rollback',$baseline.directory,$item.beforeSha256))){$bytes=[IO.File]::ReadAllBytes((Join-Safe $pair[1] $item.path));if((Hash-Bytes $bytes)-ne $pair[2]){throw 'source-drift-during-pack'};$relative=$pair[0]+'/'+$item.path;Write-New (Join-Safe $stage $relative) $bytes;$hashes[$relative]=$pair[2]}}
            $lines=@('# 源码变更说明','',$notes,'','## 来源与范围','',('- Atelier：'+$baseline.source.atelierUrl),('- Namespace：'+$baseline.source.namespace),('- 修改对象数：'+$changed.Count),('- 来源完整：'+$baseline.manifest.complete),'- changes 仅含修改后的完整源码；rollback 为同一批对象的原始源码。','','## 对象摘要','')
            foreach($item in $changed){$lines+=@('- '+$item.document,('  - 本地路径：{0}'-f $item.path),('  - before: {0}'-f $item.beforeSha256),('  - after: {0}'-f $item.afterSha256))}
            $lines+=@('','## 还回现场','', '- 本包记录的是带出来源；它不自动选择部署目标或授予写入权限。','- 先核对地址与 Namespace，并用相同读取表示核对现场当前内容与 before 摘要；不一致先合并。','- 按项目原有方式导入类/例程、上传对应 Web 虚拟路径，再编译、验收。','- 未上传、编译或执行业务验收；离线 Verify 不证明现场没有并行修改。','- rollback 来自带出的基线，回退前也须核对现场后续变化。','')
            Write-New (Join-Path $stage '变更说明.md') ($utf8.GetBytes(($lines-join "`n")));$hashes['变更说明.md']=Hash-File (Join-Path $stage '变更说明.md')
            Write-New (Join-Path $stage 'files.txt') ($utf8.GetBytes((Download-List $changed)));$hashes['files.txt']=Hash-File (Join-Path $stage 'files.txt')
            $receipt=[ordered]@{schema='iris-source-delivery/v1';state='verified';source=$baseline.source;target=$baseline.manifest.target;exportReceiptSha256=$baseline.export.receiptSha256;createdAt=[DateTime]::UtcNow.ToString('o');observedFrom=$baseline.manifest.observedFrom;observedTo=$baseline.manifest.observedTo;completeSource=$baseline.manifest.complete;excluded=@($baseline.manifest.excluded);changedCount=$changed.Count;files=$hashes;items=@($changed);compileVerified=$false;targetDriftVerified=$false}
            Write-New (Join-Path $stage 'manifest.json') ($utf8.GetBytes(($receipt|ConvertTo-Json -Depth 12)))
            [void](Verify-Delivery $stage $baseline)
            foreach($item in $baseline.export.items){if((Hash-File (Join-Safe $root $item.path))-ne $(if($changed.document-contains $item.document){($changed|Where-Object{$_.document-ceq $item.document}).afterSha256}else{$item.sha256})){throw 'source-drift-before-publication'}}
            Assert-SourceSet $root $baseline.export.items
            Plain-Path $output;[IO.Directory]::Move($stage,$output)
        }finally{Cleanup-Stage $stage $output}
        [pscustomobject]@{state='verified';source=$baseline.source;changedCount=$changed.Count;outputDirectory=$output;compileVerified=$false;targetDriftVerified=$false}|ConvertTo-Json -Depth 5
    }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
finally{if($acquired){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}}
