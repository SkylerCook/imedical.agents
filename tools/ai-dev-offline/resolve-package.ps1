#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Id,
    [ValidateSet('tools','extensions')][string]$Kind='tools',
    [string]$Location,
    [string]$CancelFile,
    [switch]$Optional
)
$ErrorActionPreference='Stop'
$manifestFile=if($Kind -eq 'tools'){'manifest.json'}else{'extensions.json'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot $manifestFile) -Raw -Encoding UTF8 | ConvertFrom-Json
$items=if($Kind -eq 'tools'){$manifest.components}else{$manifest.extensions}
$component=@($items|Where-Object id -eq $Id)
if($component.Count -ne 1){throw 'unknown-package-id'}
$component=$component[0]
if($component.file -notmatch '^[A-Za-z0-9._-]+$' -or $component.sha256 -notmatch '^[a-f0-9]{64}$' -or $component.bytes -le 0){throw 'invalid-package-manifest'}
function Check-Cancel {
    if($CancelFile -and (Test-Path -LiteralPath $CancelFile)){throw (New-Object OperationCanceledException('操作已取消，可以重新开始。'))}
}
function Matches([string]$File) {
    Check-Cancel
    if(-not(Test-Path -LiteralPath $File -PathType Leaf) -or (Get-Item -LiteralPath $File).Length -ne $component.bytes){return $false}
    $stream=[IO.File]::OpenRead($File);$sha=[Security.Cryptography.SHA256]::Create()
    try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}
    finally {$stream.Dispose();$sha.Dispose()}
    return $hash -eq $component.sha256
}
$roots=New-Object 'Collections.Generic.List[string]'
$archives=New-Object 'Collections.Generic.List[string]'
$errors=New-Object 'Collections.Generic.List[string]'
if($Location){
    $selected=[IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Location))
    if(Test-Path -LiteralPath $selected -PathType Leaf){
        if([IO.Path]::GetFileName($selected) -ieq $component.file -and (Matches $selected)){return [pscustomobject]@{path=$selected;id=$Id}}
        if([IO.Path]::GetExtension($selected) -ieq '.zip'){$archives.Add($selected)}
        $roots.Add([IO.Path]::GetDirectoryName($selected))
    } else {$roots.Add($selected)}
}
$roots.Add($PSScriptRoot)
$roots.Add((Split-Path -Parent $PSScriptRoot))
$directories=New-Object 'Collections.Generic.List[string]'
foreach($root in @($roots|Select-Object -Unique)){
    $directories.Add($root)
    foreach($suffix in @('packages','payload','extensions','packages/extensions','payload/extensions','assets')){$directories.Add((Join-Path $root $suffix))}
    if(Test-Path -LiteralPath $root -PathType Container){
        foreach($child in @(Get-ChildItem -LiteralPath $root -Directory | Where-Object Name -match '^(ai-dev-offline|packages|payload)')){
            $directories.Add($child.FullName)
            $directories.Add((Join-Path $child.FullName 'packages'))
            $directories.Add((Join-Path $child.FullName 'packages/extensions'))
        }
    }
}
foreach($directory in @($directories|Select-Object -Unique)){
    $file=Join-Path $directory $component.file
    if(Matches $file){return [pscustomobject]@{path=[IO.Path]::GetFullPath($file);id=$Id}}
    if(Test-Path -LiteralPath $file -PathType Leaf){$errors.Add('大小或 SHA256 不匹配：'+$file)}
    foreach($name in @('ai-dev-offline-packages.zip','ai-dev-offline-extensions.zip','ai-dev-base-windows-x64.zip')){
        $archive=Join-Path $directory $name
        if(Test-Path -LiteralPath $archive -PathType Leaf){$archives.Add($archive)}
    }
}
$cache=Join-Path $env:LOCALAPPDATA ('AiDevOffline/Packages/'+$component.sha256)
$cached=Join-Path $cache $component.file
if(Matches $cached){return [pscustomobject]@{path=$cached;id=$Id}}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
foreach($archive in @($archives|Select-Object -Unique)){
    Check-Cancel
    $zip=$null;$partial=$null;$cacheMutex=$null;$cacheLocked=$false
    try {
        $zip=[IO.Compression.ZipFile]::OpenRead($archive)
        $entries=@($zip.Entries|Where-Object {$_.Name -ieq $component.file})
        if($entries.Count -eq 0){continue}
        if($entries.Count -ne 1 -or $entries[0].Length -ne $component.bytes){throw '归档中的安装文件不唯一或大小不匹配。'}
        $sha=[Security.Cryptography.SHA256]::Create()
        try {$key=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cache.ToUpperInvariant()))).Replace('-','')} finally {$sha.Dispose()}
        $cacheMutex=New-Object Threading.Mutex($false,('Local\AiDevPackage-'+$key))
        while(-not $cacheLocked){Check-Cancel;try {$cacheLocked=$cacheMutex.WaitOne(200)} catch [Threading.AbandonedMutexException] {$cacheLocked=$true}}
        if(Matches $cached){return [pscustomobject]@{path=$cached;id=$Id}}
        $current=[IO.Path]::GetFullPath($cache)
        while($current){
            if((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '安装缓存目录不能是目录链接。'}
            $current=[IO.Path]::GetDirectoryName($current)
        }
        [void][IO.Directory]::CreateDirectory($cache)
        foreach($leftover in @(Get-ChildItem -LiteralPath $cache -File)){
            if($leftover.Name -match ('^'+[regex]::Escape($component.file)+'\.[a-f0-9]{32}\.partial$') -and -not($leftover.Attributes -band [IO.FileAttributes]::ReparsePoint)){
                Remove-Item -LiteralPath $leftover.FullName -Force
            }
        }
        $partial=$cached+'.'+[guid]::NewGuid().ToString('N')+'.partial'
        $inputStream=$entries[0].Open();$outputStream=[IO.File]::Open($partial,[IO.FileMode]::CreateNew)
        try {
            $buffer=New-Object byte[] (1024*1024)
            while(($count=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0){Check-Cancel;$outputStream.Write($buffer,0,$count)}
        } finally {$inputStream.Dispose();$outputStream.Dispose()}
        if(-not(Matches $partial)){throw '归档内安装文件的 SHA256 不匹配。'}
        Move-Item -LiteralPath $partial -Destination $cached -Force
        return [pscustomobject]@{path=$cached;id=$Id}
    } catch {
        if($_.Exception -is [OperationCanceledException]){throw}
        $errors.Add($archive+'：'+$_.Exception.Message)
    } finally {
        if($zip){$zip.Dispose()}
        if($partial -and (Test-Path -LiteralPath $partial)){Remove-Item -LiteralPath $partial -Force}
        if($cacheLocked){$cacheMutex.ReleaseMutex()}
        if($cacheMutex){$cacheMutex.Dispose()}
    }
}
$message='未找到可用的 '+$component.file+'。请点击「离线包…」选择原包 ZIP 或所在目录。'
if($errors.Count){$message+=' '+($errors -join '；')}
if($Optional){return [pscustomobject]@{path=$null;id=$Id;error=$message}}
throw $message
