#requires -Version 5.1
<#
.SYNOPSIS
现场聚合源码 XML 的离线拆分、增量交付、回退包及一致性核对。
.EXAMPLE
.\edit-export-xml.ps1 -Mode Unpack -InputXml .\export.xml -WorkDirectory D:\work\iris-edit
.EXAMPLE
.\edit-export-xml.ps1 -Mode Pack -WorkDirectory D:\work\iris-edit -NotesFile .\notes.md -OutputDirectory D:\delivery\change
.EXAMPLE
.\edit-export-xml.ps1 -Mode Verify -WorkDirectory D:\work\iris-edit -OutputDirectory D:\delivery\change
.NOTES
无 IRIS/Node.js/MCP/外网依赖。只修改 XML 源码节点，不手工转换 UDL。
Pack 只交付修改对象，生成 changes.xml、rollback.xml、变更说明.md、manifest.json。
保留原 package.xml；不新增、删除或重命名顶层对象。输出目录必须不存在。
#>
[CmdletBinding()]
param(
    [ValidateSet('Unpack', 'Pack', 'Verify')][string]$Mode = 'Unpack',
    [string]$InputXml,
    [Parameter(Mandatory = $true)][string]$WorkDirectory,
    [string]$OutputDirectory,
    [string]$NotesFile,
    [string]$BaselineDirectory,
    [string]$WorkspaceBinding,
    [string]$BatchId,
    [string]$ScopeFile,
    [string]$WorkspaceEvidence
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false, $true)
$sourceKinds = @('Class', 'Routine', 'CSP', 'CSPBase64')

function Full-Path([string]$Path) { return [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)) }
function Assert-PlainPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -Force -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'linked-path-forbidden' }
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}
function Hash-Bytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Hash-File([string]$Path) { Assert-PlainPath $Path; return Hash-Bytes ([IO.File]::ReadAllBytes($Path)) }
function Hash-Node($Node) { return Hash-Bytes ($utf8.GetBytes($Node.OuterXml)) }
function Get-Sources($Doc) { return @($Doc.DocumentElement.ChildNodes | Where-Object { $_.NodeType -eq [Xml.XmlNodeType]::Element -and $_.get_Name() -cin $sourceKinds }) }
function Get-Projects($Doc) { return @($Doc.DocumentElement.ChildNodes | Where-Object { $_.NodeType -eq [Xml.XmlNodeType]::Element -and $_.get_Name() -ceq 'Project' }) }
function Get-Identity($Node) {
    $kind = $Node.get_Name(); $name = $Node.GetAttribute('name'); $type = $Node.GetAttribute('type').ToUpperInvariant()
    if ($kind -eq 'Class') { $fields = @('CLS', $name) }
    elseif ($kind -eq 'Routine') {
        if (-not $type -and $name -match '\.(mac|int|inc|bas)$') { $type = $Matches[1].ToUpperInvariant() }
        if ($type -cnotin @('MAC', 'INT', 'INC', 'BAS')) { throw 'unsupported-routine-type' }
        $suffix = '.' + $type.ToLowerInvariant()
        if ($name.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase)) { $name = $name.Substring(0, $name.Length - 4) }
        $fields = @($type, $name)
    } else { $fields = @('CSP', $Node.GetAttribute('application').TrimEnd('/') + '/' + $name) }
    return (($fields | ForEach-Object { '{0}:{1}' -f $_.Length, $_ }) -join '|')
}
function Get-PayloadHash($Node) {
    if ($Node.get_Name() -eq 'Class') { return Hash-Node $Node }
    if ($Node.SelectNodes('*').Count) { throw 'source-text-has-element-children' }
    if ($Node.get_Name() -eq 'CSPBase64') {
        $text = $Node.InnerText -replace '\s', ''
        if ($text -cnotmatch '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$') { throw 'invalid-csp-base64' }
        $bytes = [Convert]::FromBase64String($text)
        if ([Convert]::ToBase64String($bytes) -cne $text) { throw 'invalid-csp-base64' }
        return Hash-Bytes $bytes
    }
    return Hash-Bytes ($utf8.GetBytes($Node.InnerText))
}
function Read-Export([string]$Path) {
    Assert-PlainPath $Path
    $settings = New-Object Xml.XmlReaderSettings
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersInDocument = 134217728
    $reader = [Xml.XmlReader]::Create($Path, $settings)
    try {
        $doc = New-Object Xml.XmlDocument
        $doc.PreserveWhitespace = $true; $doc.XmlResolver = $null; $doc.Load($reader)
    } finally { $reader.Dispose() }
    if ($doc.DocumentElement.get_Name() -cne 'Export' -or $doc.DocumentElement.NamespaceURI) { throw 'iris-export-required' }
    $seen = @{}; $projects = @{}; $count = 0
    foreach ($node in @($doc.DocumentElement.ChildNodes)) {
        if ($node.NodeType -ne [Xml.XmlNodeType]::Element) {
            if ($node.NodeType -in @([Xml.XmlNodeType]::Text, [Xml.XmlNodeType]::CDATA) -and $node.InnerText.Trim()) { throw 'unexpected-export-text' }
            continue
        }
        if ($node.get_Name() -ceq 'Project') {
            $name = $node.GetAttribute('name')
            if ($projects.ContainsKey($name)) { throw 'duplicate-project-metadata' }; $projects[$name] = $true
            continue
        }
        if ($node.get_Name() -cnotin $sourceKinds) { throw 'unsupported-export-object' }
        if (-not $node.GetAttribute('name') -or $node.NamespaceURI) { throw 'export-object-name-required' }
        if ($node.get_Name() -in @('CSP', 'CSPBase64')) {
            $app = $node.GetAttribute('application'); $name = $node.GetAttribute('name')
            if (-not $app.StartsWith('/') -or $app.Contains('\') -or $name.StartsWith('/') -or $name.Contains('\') -or
                ($app.Trim('/') + '/' + $name).Split('/') -contains '..') { throw 'invalid-web-identity' }
        }
        $identity = Get-Identity $node
        if ($seen.ContainsKey($identity)) { throw 'duplicate-export-object' }
        $seen[$identity] = $true; $count++
        [void](Get-PayloadHash $node)
    }
    if (-not $count) {
        if ($projects.Count) { throw 'scope-catalog-has-no-source-use-full-export' }
        throw 'empty-export'
    }
    return ,$doc
}
function New-Package($Template) {
    $doc = New-Object Xml.XmlDocument
    $doc.PreserveWhitespace = $true
    [void]$doc.AppendChild($doc.ImportNode($Template.DocumentElement, $false))
    return ,$doc
}
function Write-NewXml($Doc, [string]$Path) {
    Assert-PlainPath $Path
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $settings = New-Object Xml.XmlWriterSettings
        $settings.Encoding = $utf8; $settings.Indent = $false; $settings.NewLineHandling = [Xml.NewLineHandling]::None
        $writer = [Xml.XmlWriter]::Create($stream, $settings)
        try { $Doc.Save($writer) } finally { $writer.Dispose() }
    } finally { $stream.Dispose() }
}
# Preserve the input container and newline convention; do not alter CDATA payload semantics.
function Write-DeliveryXml($Selected, $Template, [string]$TemplatePath, [string]$Path, [bool]$Original) {
    $selectedNodes = @(Get-Sources $Selected)
    $allNodes = @(Get-Sources $Template)
    if ($Original -and $selectedNodes.Count -eq $allNodes.Count -and @(Get-Projects $Template).Count -eq 0) {
        [IO.File]::Copy($TemplatePath, $Path, $false)
        return
    }
    $package = $Template.CloneNode($true)
    $byIdentity = @{}
    foreach ($node in $selectedNodes) { $byIdentity[(Get-Identity $node)] = $node }
    foreach ($node in @($package.DocumentElement.ChildNodes)) {
        if ($node.NodeType -ne [Xml.XmlNodeType]::Element) { continue }
        if ($node.get_Name() -eq 'Project' -or -not $byIdentity.ContainsKey((Get-Identity $node))) {
            [void]$package.DocumentElement.RemoveChild($node)
        } else {
            [void]$package.DocumentElement.ReplaceChild($package.ImportNode($byIdentity[(Get-Identity $node)], $true), $node)
        }
    }
    $originalText = [IO.File]::ReadAllText($TemplatePath, $utf8)
    $text = $package.OuterXml
    if ($originalText.StartsWith('<?xml')) {
        $declaration = [regex]::Match($originalText, '^<\?xml[^?]*\?>').Value
        $text = [regex]::Replace($text, '^<\?xml[^?]*\?>', [Text.RegularExpressions.MatchEvaluator]{ param($m) $declaration })
    }
    $newline = "`n"
    if ($originalText.Contains("`r`n")) { $newline = "`r`n" }
    elseif ($originalText.Contains("`r")) { $newline = "`r" }
    $text = $text.Replace("`r`n", "`n").Replace("`r", "`n").Replace("`n", $newline)
    $bytes = $utf8.GetBytes($text)
    $originalBytes = [IO.File]::ReadAllBytes($TemplatePath)
    if ($originalBytes.Length -ge 3 -and $originalBytes[0] -eq 239 -and $originalBytes[1] -eq 187 -and $originalBytes[2] -eq 191) {
        $bytes = [byte[]](@(239,187,191) + $bytes)
    }
    [IO.File]::WriteAllBytes($Path, $bytes)
}
function Remove-OwnedStage([string]$Stage, [string]$Destination) {
    if ([IO.Path]::GetDirectoryName($Stage) -ne [IO.Path]::GetDirectoryName($Destination) -or -not $Stage.StartsWith($Destination + '.') -or -not $Stage.EndsWith('.tmp')) { throw 'stage-path-invalid' }
    if (Test-Path -LiteralPath $Stage) {
        Assert-PlainPath $Stage
        foreach ($child in @(Get-ChildItem -LiteralPath $Stage -Force -Recurse)) {
            if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'stage-linked-child' }
        }
        Remove-Item -LiteralPath $Stage -Recurse -Force
        if (Test-Path -LiteralPath $Stage) { throw 'stage-cleanup-failed' }
    }
}
function Verify-Delivery([string]$Directory, $Template, [string]$TemplateHash) {
    Assert-PlainPath $Directory
    $names = @('changes.xml', 'rollback.xml', '变更说明.md', 'manifest.json')
    $files = @(Get-ChildItem -LiteralPath $Directory -Force)
    if ($files.Count -ne $names.Count -or @($files | Where-Object { $_.PSIsContainer -or $_.Name -cnotin $names }).Count) { throw 'delivery-file-set-mismatch' }
    $manifestPath = Join-Path $Directory 'manifest.json'; Assert-PlainPath $manifestPath
    $receipt = [IO.File]::ReadAllText($manifestPath, $utf8) | ConvertFrom-Json
    if ($receipt.schema -ne 'iris-offline-delivery/v1' -or $receipt.state -ne 'verified' -or $receipt.sourceSha256 -ne $TemplateHash -or
        $receipt.projectMetadataExcluded -ne @(Get-Projects $Template).Count -or $receipt.irisImportVerified -or $receipt.compileVerified -or $receipt.businessVerified -or $receipt.targetDriftVerified -or
        $receipt.changedCount -lt 1 -or $receipt.changedCount -ne @($receipt.objects).Count) { throw 'delivery-manifest-invalid' }
    foreach ($name in @('changes.xml', 'rollback.xml', '变更说明.md')) {
        if ((Hash-File (Join-Path $Directory $name)) -ne $receipt.files.$name) { throw 'delivery-file-drift' }
    }
    $changes = Read-Export (Join-Path $Directory 'changes.xml'); $rollback = Read-Export (Join-Path $Directory 'rollback.xml')
    if (@(Get-Projects $changes).Count -or @(Get-Projects $rollback).Count) { throw 'delivery-project-metadata-forbidden' }
    if ($changes.DocumentElement.CloneNode($false).OuterXml -cne $Template.DocumentElement.CloneNode($false).OuterXml -or
        $rollback.DocumentElement.CloneNode($false).OuterXml -cne $Template.DocumentElement.CloneNode($false).OuterXml) { throw 'delivery-container-mismatch' }
    $after = @(Get-Sources $changes); $before = @(Get-Sources $rollback); $originals = @{}
    foreach ($node in @(Get-Sources $Template)) { $originals[(Get-Identity $node)] = $node }
    if ($after.Count -ne $receipt.changedCount -or $before.Count -ne $after.Count -or $receipt.unchangedCount -ne ($originals.Count - $after.Count)) { throw 'delivery-object-set-mismatch' }
    for ($i = 0; $i -lt $after.Count; $i++) {
        $entry = $receipt.objects[$i]; $identity = Get-Identity $after[$i]
        if ($identity -cne $entry.identity -or $identity -cne (Get-Identity $before[$i]) -or $after[$i].get_Name() -cne $before[$i].get_Name() -or -not $originals.ContainsKey($identity) -or
            (Hash-Node $before[$i]) -ne (Hash-Node $originals[$identity]) -or (Hash-Node $after[$i]) -ne $entry.afterSha256 -or
            (Hash-Node $before[$i]) -ne $entry.beforeSha256 -or $entry.afterSha256 -eq $entry.beforeSha256 -or
            (Get-PayloadHash $after[$i]) -ne $entry.afterPayloadSha256 -or (Get-PayloadHash $before[$i]) -ne $entry.beforePayloadSha256) { throw 'delivery-object-mismatch' }
    }
    return $receipt
}

$root = Full-Path $WorkDirectory; Assert-PlainPath $root
$base = $root
if ($BaselineDirectory) { $base = Full-Path $BaselineDirectory; Assert-PlainPath $base; if ($base -eq $root -or $base.StartsWith($root.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'baseline-must-be-outside-editable-xml' } }
$bindingHash = $null
if ($WorkspaceBinding) {
    if (-not $BaselineDirectory) { throw 'private-baseline-required' }
    try { $bindingBytes = [Convert]::FromBase64String($WorkspaceBinding); $binding = $utf8.GetString($bindingBytes) | ConvertFrom-Json } catch { throw 'workspace-binding-invalid' }
    foreach ($field in @('workspaceRoot','sourceRoot','gitRoot')) { if (-not [IO.Path]::IsPathRooted([string]$binding.$field)) { throw 'workspace-binding-invalid' }; Assert-PlainPath $binding.$field }
    foreach ($field in @('sourceRoot','gitRoot')) { $parent = $binding.$field.TrimEnd('\','/'); if ($root -ine $parent -and -not $root.StartsWith($parent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'workspace-binding-source-mismatch' } }
    $bindingHash = Hash-Bytes $bindingBytes
}
function Scope-Files($Inventory) {
    $values = @($Inventory.objects | ForEach-Object { $_.file })
    if ($Inventory.scopeFiles) { $values = @($Inventory.scopeFiles) }
    if ($ScopeFile) { Assert-PlainPath (Full-Path $ScopeFile); $selection = [IO.File]::ReadAllText((Full-Path $ScopeFile), $utf8) | ConvertFrom-Json; $values = @($selection.files) }
    $seen = @{}; foreach ($value in $values) { if ($value -isnot [string] -or $seen.ContainsKey($value) -or $value -cnotmatch '^objects/[0-9]{6}\.xml$' -or $value -cnotin @($Inventory.objects | ForEach-Object { $_.file })) { throw 'xml-scope-invalid' }; $seen[$value] = $true }
    if (-not $values.Count) { throw 'xml-source-scope-empty' }; [Array]::Sort($values, [StringComparer]::Ordinal); return ,$values
}
if ($Mode -eq 'Unpack') {
    if (-not $InputXml) { throw 'InputXml-required' }
    $inputPath = Full-Path $InputXml; $doc = Read-Export $inputPath; $inputHash = Hash-File $inputPath
    if (Test-Path -LiteralPath $root) { throw 'work-directory-must-be-new' }
    if ($BaselineDirectory -and (Test-Path -LiteralPath $base)) { throw 'development-baseline-already-exists' }
    if ($WorkspaceBinding -and -not $BatchId) { throw 'xml-input-batch-required' }
    $stage = $root + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    $baseStage = $stage
    if ($BaselineDirectory) { $baseStage = $base + '.' + [guid]::NewGuid().ToString('N') + '.tmp' }
    try {
        [void][IO.Directory]::CreateDirectory((Join-Path $stage 'objects'))
        [void][IO.Directory]::CreateDirectory($baseStage)
        [IO.File]::Copy($inputPath, (Join-Path $baseStage 'package.xml'), $false)
        if ((Hash-File (Join-Path $baseStage 'package.xml')) -ne $inputHash) { throw 'input-changed-during-unpack' }
        $doc = Read-Export (Join-Path $baseStage 'package.xml')
        $inventory = @(); $index = 0
        foreach ($node in @(Get-Sources $doc)) {
            $index++; $single = New-Package $doc
            [void]$single.DocumentElement.AppendChild($single.ImportNode($node, $true))
            $relative = 'objects/{0:D6}.xml' -f $index
            Write-NewXml $single (Join-Path $stage $relative)
            $inventory += [ordered]@{file = $relative; kind = $node.get_Name(); name = $node.GetAttribute('name'); type = $node.GetAttribute('type');
                application = $node.GetAttribute('application'); identity = (Get-Identity $node); sourceSha256 = (Hash-Node $node)}
        }
        $projectCount = @(Get-Projects $doc).Count; $sourceKind = 'source'
        if ($projectCount) { $sourceKind = 'source-with-project' }
        $receipt = [ordered]@{schema = 'iris-offline-xml/v2'; templateSha256 = $inputHash; count = $index; sourceKind = $sourceKind; projectMetadataCount = $projectCount; objects = @($inventory)}
        if ($BaselineDirectory) { $scope = Scope-Files ([pscustomobject]$receipt); $receipt.scopeFiles = $scope; $receipt.scopeSha256 = Hash-Bytes ($utf8.GetBytes(($scope -join "`n"))); $receipt.workspaceBindingSha256 = $bindingHash; $receipt.batchId = $BatchId }
        [IO.File]::WriteAllText((Join-Path $baseStage 'inventory.json'), ($receipt | ConvertTo-Json -Depth 8), $utf8)
        if ($BaselineDirectory) { Assert-PlainPath $base; [IO.Directory]::Move($baseStage, $base) }
        Assert-PlainPath $root; [IO.Directory]::Move($stage, $root)
        $receipt | ConvertTo-Json -Depth 8
    } finally { Remove-OwnedStage $stage $root; if ($BaselineDirectory) { Remove-OwnedStage $baseStage $base } }
} else {
    $inventoryPath = Join-Path $base 'inventory.json'; $template = Join-Path $base 'package.xml'
    Assert-PlainPath $inventoryPath; Assert-PlainPath $template
    $inventory = [IO.File]::ReadAllText($inventoryPath, $utf8) | ConvertFrom-Json
    $templateHash = Hash-File $template
    if ($inventory.schema -ne 'iris-offline-xml/v2' -or $templateHash -ne $inventory.templateSha256) { throw 'template-drift' }
    if ($inventory.workspaceBindingSha256 -ne $bindingHash) { throw 'workspace-binding-changed' }
    $scope = @($inventory.objects | ForEach-Object { $_.file })
    if ($inventory.scopeSha256) { $scope = Scope-Files $inventory; if ((Hash-Bytes ($utf8.GetBytes(($scope -join "`n")))) -ne $inventory.scopeSha256) { throw 'xml-scope-drift' } }
    elseif ($ScopeFile -or $WorkspaceBinding) { throw 'legacy-baseline-needs-explicit-adoption' }
    $doc = Read-Export $template; $nodes = @(Get-Sources $doc)
    if ($nodes.Count -ne $inventory.count -or @($inventory.objects).Count -ne $nodes.Count -or @(Get-Projects $doc).Count -ne $inventory.projectMetadataCount) { throw 'inventory-scope-mismatch' }
    $output = Join-Path $root 'delivery'; if ($OutputDirectory) { $output = Full-Path $OutputDirectory }
    Assert-PlainPath $output
    if ($Mode -eq 'Verify') {
        $receipt = Verify-Delivery $output $doc $templateHash
        if ($inventory.scopeSha256 -and ($receipt.scopeSha256 -ne $inventory.scopeSha256 -or $receipt.workspaceBindingSha256 -ne $bindingHash -or $receipt.batchId -cne $inventory.batchId)) { throw 'delivery-scope-binding-mismatch' }
        $allowed = @($inventory.objects | Where-Object { $_.file -cin $scope } | ForEach-Object { $_.identity })
        if (@($receipt.objects | Where-Object { $_.identity -cnotin $allowed }).Count) { throw 'delivery-outside-task-scope' }
        if ($bindingHash -and ($receipt.localEvidence.schema -ne 'iris-local-delivery-evidence/v1' -or $receipt.localEvidence.gitDiffSha256 -cnotmatch '^[a-f0-9]{64}$' -or $receipt.localEvidence.hospitalAcceptance -ne 'pending')) { throw 'delivery-local-evidence-invalid' }
        [pscustomobject]@{state = 'verified'; changedCount = $receipt.changedCount; unchangedCount = $receipt.unchangedCount; irisImportVerified = $false} | ConvertTo-Json
    } else {
        if (Test-Path -LiteralPath $output) { throw 'output-directory-must-be-new' }
        $objectRoot = Join-Path $root 'objects'; Assert-PlainPath $objectRoot
        $files = @(Get-ChildItem -LiteralPath $objectRoot -Force)
        if ($files.Count -ne $nodes.Count -or @($files | Where-Object { $_.PSIsContainer }).Count) { throw 'object-set-changed' }
        if ($output -eq $root -or $output.StartsWith($objectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $output -eq $objectRoot) { throw 'delivery-in-work-source' }
        $changes = New-Package $doc; $rollback = New-Package $doc; $entries = @()
        for ($i = 0; $i -lt $nodes.Count; $i++) {
            $relative = 'objects/{0:D6}.xml' -f ($i + 1); $file = Join-Path $root $relative
            $old = $nodes[$i]; $entry = $inventory.objects[$i]
            if ($entry.file -cne $relative -or $entry.identity -cne (Get-Identity $old) -or $entry.sourceSha256 -ne (Hash-Node $old)) { throw 'inventory-object-mismatch' }
            $part = Read-Export $file; $items = @(Get-Sources $part)
            if ($items.Count -ne 1 -or @(Get-Projects $part).Count -or (Get-Identity $items[0]) -cne (Get-Identity $old) -or $items[0].get_Name() -cne $old.get_Name()) { throw 'object-identity-changed' }
            if ($part.DocumentElement.CloneNode($false).OuterXml -cne $doc.DocumentElement.CloneNode($false).OuterXml) { throw 'object-container-changed' }
            $new = $items[0]; $beforeHash = Hash-Node $old; $afterHash = Hash-Node $new
            if ($relative -cnotin $scope) { continue }
            if ($beforeHash -eq $afterHash) { continue }
            [void]$changes.DocumentElement.AppendChild($changes.ImportNode($new, $true))
            [void]$rollback.DocumentElement.AppendChild($rollback.ImportNode($old, $true))
            $entries += [ordered]@{identity = (Get-Identity $old); kind = $old.get_Name(); name = $old.GetAttribute('name'); application = $old.GetAttribute('application');
                beforeSha256 = $beforeHash; afterSha256 = $afterHash; beforePayloadSha256 = (Get-PayloadHash $old); afterPayloadSha256 = (Get-PayloadHash $new)}
        }
        if (-not $entries.Count) {
            [pscustomobject]@{state = 'unchanged'; changedCount = 0; outputCreated = $false} | ConvertTo-Json
        } else {
            if (-not $NotesFile) { throw 'NotesFile-required-for-changed-delivery' }
            $notesPath = Full-Path $NotesFile; Assert-PlainPath $notesPath
            if ((Get-Item -LiteralPath $notesPath).Length -gt 1048576) { throw 'notes-too-large' }
            $notes = [IO.File]::ReadAllText($notesPath, $utf8).Trim()
            if (-not $notes) { throw 'change-notes-empty' }
            $stage = $output + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
            try {
                [void][IO.Directory]::CreateDirectory($stage)
                Write-DeliveryXml $changes $doc $template (Join-Path $stage 'changes.xml') $false
                Write-DeliveryXml $rollback $doc $template (Join-Path $stage 'rollback.xml') $true
                $lines = @('# 变更说明', '', $notes, '', '## 交付范围', '', ('- 修改对象：{0}；未修改对象：{1}。' -f $entries.Count, ($nodes.Count - $entries.Count)),
                    '- changes.xml 只含修改后的完整对象；rollback.xml 只含这些对象的原定义。', '- Project 元数据及未修改资源不进入交付。', ('- 原始 XML SHA-256：{0}' -f $templateHash), '', '## 对象摘要', '')
                foreach ($entry in $entries) {
                    $label = ($entry.kind + ' ' + $entry.application + ' ' + $entry.name) -replace '[\r\n`]', ' '
                    $lines += @('- ' + $label, ('  - before: {0}' -f $entry.beforeSha256), ('  - after: {0}' -f $entry.afterSha256))
                }
                $lines += @('', '## 验证与现场操作', '', '- 已核对 XML 可解析、交付/回退对象一一对应、范围与内容摘要。',
                    '- 未执行 IRIS 导入、编译或业务验收；尚未核对现场自导出以来的漂移。', '- 带回现场后先比较当前对象与导出基线，再按项目授权、备份及隔离验证流程导入。',
                    '- rollback.xml 是本次输入中相应对象的旧定义；回退前仍需核对现场变化，不能盲目覆盖。', '')
                [IO.File]::WriteAllText((Join-Path $stage '变更说明.md'), ($lines -join "`n"), $utf8)
                $fileHashes = [ordered]@{}
                foreach ($name in @('changes.xml', 'rollback.xml', '变更说明.md')) { $fileHashes[$name] = Hash-File (Join-Path $stage $name) }
                $receipt = [ordered]@{schema = 'iris-offline-delivery/v1'; state = 'verified'; sourceSha256 = $templateHash; createdAt = [DateTime]::UtcNow.ToString('o');
                    changedCount = $entries.Count; unchangedCount = $nodes.Count - $entries.Count; projectMetadataExcluded = @(Get-Projects $doc).Count;
                    files = $fileHashes; objects = @($entries); irisImportVerified = $false; compileVerified = $false; businessVerified = $false; targetDriftVerified = $false}
                if ($inventory.scopeSha256) { $receipt.scopeSha256 = $inventory.scopeSha256; $receipt.workspaceBindingSha256 = $bindingHash; $receipt.batchId = $inventory.batchId }
                if ($WorkspaceEvidence) {
                    try { $receipt.localEvidence = $utf8.GetString([Convert]::FromBase64String($WorkspaceEvidence)) | ConvertFrom-Json } catch { throw 'workspace-evidence-invalid' }
                    foreach ($relative in $scope) { $matches = @($receipt.localEvidence.files | Where-Object { $_.path -ceq $relative -and $_.sha256 -eq (Hash-File (Join-Path $root $relative)) }); if ($matches.Count -ne 1) { throw 'delivery-git-evidence-mismatch' } }
                }
                if ($bindingHash -and $receipt.localEvidence.schema -ne 'iris-local-delivery-evidence/v1') { throw 'delivery-local-evidence-invalid' }
                [IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), ($receipt | ConvertTo-Json -Depth 10), $utf8)
                [void](Verify-Delivery $stage $doc $templateHash)
                if ((Hash-File $template) -ne $templateHash) { throw 'template-drift-during-pack' }
                Assert-PlainPath $output; [IO.Directory]::Move($stage, $output)
                [pscustomobject]@{state = 'verified'; changedCount = $entries.Count; unchangedCount = $nodes.Count - $entries.Count; outputDirectory = $output; irisImportVerified = $false} | ConvertTo-Json
            } finally { Remove-OwnedStage $stage $output }
        }
    }
}
