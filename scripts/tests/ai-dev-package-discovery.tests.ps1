#requires -Version 5.1
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../tools/ai-dev-offline'))
$parent=if(Test-Path -LiteralPath 'D:/tmp'){'D:\tmp\Codex'}else{Join-Path ([IO.Path]::GetTempPath()) 'Codex'}
$root=Join-Path $parent ('ai-dev-discovery-'+[guid]::NewGuid().ToString('N'))
$local=$env:LOCALAPPDATA
$checks=0
function Assert($Value,[string]$Message){if(-not $Value){throw $Message};$script:checks++}
try {
    $fixture=Join-Path $root 'tools';[void][IO.Directory]::CreateDirectory($fixture)
    $env:LOCALAPPDATA=Join-Path $root 'local'
    Copy-Item -LiteralPath (Join-Path $source 'resolve-package.ps1') -Destination $fixture
    $bytes=[Text.Encoding]::UTF8.GetBytes('offline fixture')
    $sha=[Security.Cryptography.SHA256]::Create()
    try {$digest=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    @{schemaVersion=1;components=@(@{id='node';file='node.zip';bytes=$bytes.Length;sha256=$digest})}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath "$fixture/manifest.json" -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $archive=Join-Path $root '现场 原包.zip'
    $zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
    try {$stream=$zip.CreateEntry('extra/packages/node.zip').Open();try {$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}}finally{$zip.Dispose()}
    $script=Join-Path $fixture 'resolve-package.ps1'
    $found=& $script -Id node -Location $archive
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($found.path)) -eq [Convert]::ToBase64String($bytes)) 'selected ZIP not extracted exactly'
    $time=(Get-Item -LiteralPath $found.path).LastWriteTimeUtc
    $again=& $script -Id node -Location $archive
    Assert ((Get-Item -LiteralPath $again.path).LastWriteTimeUtc -eq $time) 'cached original was unnecessarily rewritten'
    $cached=$found.path
    Remove-Item -LiteralPath $cached
    $partial=$cached+'.'+[guid]::NewGuid().ToString('N')+'.partial'
    [IO.File]::WriteAllText($partial,'interrupted copy')
    Copy-Item -LiteralPath $archive -Destination (Join-Path $root 'ai-dev-offline-packages.zip')
    $found=& $script -Id node
    Assert (Test-Path -LiteralPath $found.path) 'nearby ZIP not discovered'
    Assert (-not(Test-Path -LiteralPath $partial)) 'stale interrupted extraction not recovered'
    $found=& $script -Id node -Location (Join-Path $root 'missing-old-location')
    Assert (Test-Path -LiteralPath $found.path) 'missing previous location blocked automatic discovery'
    $legacy=Join-Path $fixture 'payload';[void][IO.Directory]::CreateDirectory($legacy)
    [IO.File]::WriteAllBytes((Join-Path $legacy 'node.zip'),$bytes)
    $found=& $script -Id node
    Assert ($found.path -eq (Join-Path $legacy 'node.zip')) 'legacy payload no longer supported'
    $cancel=Join-Path $root 'cancel';[IO.File]::WriteAllText($cancel,'cancel')
    $cancelled=$false
    try {& $script -Id node -CancelFile $cancel|Out-Null}catch{$cancelled=$true}
    Assert $cancelled 'cancelled import still ran'
    Remove-Item -LiteralPath (Join-Path $root 'ai-dev-offline-packages.zip'),$cached
    [IO.File]::WriteAllText((Join-Path $legacy 'node.zip'),'corrupt')
    $missing=& $script -Id node -Optional
    Assert (-not $missing.path -and $missing.error.Contains('SHA256')) 'corrupt material did not explain verification failure'
    Remove-Item -LiteralPath (Join-Path $legacy 'node.zip')

    $invalidVersioned=Join-Path $root 'ai-dev-offline-packages-1.0.0.zip'
    $zip=[IO.Compression.ZipFile]::Open($invalidVersioned,[IO.Compression.ZipArchiveMode]::Create)
    $invalidBytes=[byte[]]$bytes.Clone()
    $invalidBytes[0]=$invalidBytes[0] -bxor 1
    try {$stream=$zip.CreateEntry('packages/node.zip').Open();try {$stream.Write($invalidBytes,0,$invalidBytes.Length)}finally{$stream.Dispose()}}finally{$zip.Dispose()}
    $missing=& $script -Id node -Optional
    Assert (-not $missing.path -and $missing.error.Contains($invalidVersioned) -and $missing.error.Contains('SHA256')) 'versioned archive must pass digest verification'

    Copy-Item -LiteralPath $archive -Destination (Join-Path $root 'ai-dev-offline-packages-2.0.0.zip')
    $found=& $script -Id node
    Assert ((Get-FileHash -LiteralPath $found.path -Algorithm SHA256).Hash -eq $digest) 'matching versioned archive not discovered'
    Write-Host "$checks package discovery checks passed on Windows PowerShell $($PSVersionTable.PSVersion)"
} finally {
    $env:LOCALAPPDATA=$local
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($root)) -ne $parent){throw 'unsafe test cleanup'}
    if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
