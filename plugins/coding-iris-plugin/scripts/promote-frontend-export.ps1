param(
  [Parameter(Mandatory=$true)]
  [string]$StagedFile,
  [Parameter(Mandatory=$true)]
  [string]$DestinationFile,
  [Parameter(Mandatory=$true)]
  [ValidateSet("gb2312", "utf8")]
  [string]$ExpectedEncoding,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $StagedFile -ErrorAction Stop).Path
$destination = [System.IO.Path]::GetFullPath($DestinationFile)
if ((Test-Path -LiteralPath $destination) -and -not $Force) {
  throw "Destination already exists; explicit -Force confirmation is required: $destination"
}

$bytes = [System.IO.File]::ReadAllBytes($source)
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$text = $utf8.GetString($bytes)
$outputEncoding = $utf8
if ($ExpectedEncoding -eq "gb2312") {
  $outputEncoding = [System.Text.Encoding]::GetEncoding(936, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
}

try {
  $outputBytes = $outputEncoding.GetBytes($text)
  $null = $outputEncoding.GetString($outputBytes)
}
catch {
  throw "Staged content cannot be represented as $ExpectedEncoding. Destination was not changed. $($_.Exception.Message)"
}

$parent = Split-Path -Parent $destination
if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}
$tempPath = "$destination.codex-encoding-$([Guid]::NewGuid().ToString('N')).tmp"
try {
  [System.IO.File]::WriteAllBytes($tempPath, $outputBytes)
  Move-Item -LiteralPath $tempPath -Destination $destination -Force
}
finally {
  if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
}

Write-Output ([PSCustomObject]@{
  stagedFile = $source
  destinationFile = $destination
  encoding = $ExpectedEncoding
  promoted = $true
} | ConvertTo-Json -Compress)
