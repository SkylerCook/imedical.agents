#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$ExtensionDirectory,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$root=[IO.Path]::GetFullPath($ExtensionDirectory).TrimEnd('\')
$files=@(Get-ChildItem -LiteralPath $root -Force -Recurse)
if((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint -or @($files|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw '扩展备份包含链接，已保留原版本。'}
$manifest=Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$publisher=[Security.SecurityElement]::Escape($manifest.publisher)
$name=[Security.SecurityElement]::Escape($manifest.name)
$version=[Security.SecurityElement]::Escape($manifest.version)
$engine=[Security.SecurityElement]::Escape($manifest.engines.vscode)
$partial=$OutputFile+'.partial'
if((Test-Path -LiteralPath $OutputFile) -or (Test-Path -LiteralPath $partial)){throw 'backup-output-already-exists'}
function Add-Text($Zip,[string]$Name,[string]$Text) {
    $stream=$Zip.CreateEntry($Name).Open()
    $writer=New-Object IO.StreamWriter($stream,(New-Object Text.UTF8Encoding($false)))
    try {$writer.Write($Text)} finally {$writer.Dispose()}
}
try {
    $zip=[IO.Compression.ZipFile]::Open($partial,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach($file in @($files|Where-Object {-not $_.PSIsContainer})){
            $relative=$file.FullName.Substring($root.Length+1).Replace('\','/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,('extension/'+$relative),[IO.Compression.CompressionLevel]::Optimal)
        }
        Add-Text $zip '[Content_Types].xml' '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'
        Add-Text $zip 'extension.vsixmanifest' ('<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="'+$name+'" Version="'+$version+'" Publisher="'+$publisher+'"/><DisplayName>'+ $name+'</DisplayName><Description xml:space="preserve">Local recovery copy</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="'+$engine+'"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>')
    } finally {$zip.Dispose()}
    $zip=[IO.Compression.ZipFile]::OpenRead($partial)
    try {if(-not $zip.GetEntry('extension/package.json')){throw 'backup-package-json-missing'}} finally {$zip.Dispose()}
    Move-Item -LiteralPath $partial -Destination $OutputFile
} finally {if(Test-Path -LiteralPath $partial){Remove-Item -LiteralPath $partial -Force}}
