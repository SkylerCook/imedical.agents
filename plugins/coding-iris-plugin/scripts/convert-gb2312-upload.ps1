<#
Detect encoding and convert UTF-8 files to GB2312 for upload.
- GB2312 files → skip, upload source directly
- UTF-8 files → convert to {name}.gb2312{ext} in same directory

Usage:
  .\convert-gb2312-upload.ps1 -Files @("path/to/xxx.csp", "path/to/xxx.js")

Output JSON array:
  [{"file":"...","encoding":"utf8|gb2312","converted":false|true,"uploadPath":"..."}]
#>

param(
    [Parameter(Mandatory=$true)]
    [string[]]$Files
)

$ErrorActionPreference = "Stop"
$gb = [Text.Encoding]::GetEncoding(936, [Text.EncoderFallback]::ExceptionFallback, [Text.DecoderFallback]::ExceptionFallback)
$utf8 = [Text.UTF8Encoding]::new($false, $true)

function Detect-Encoding {
    param([string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    # Try UTF-8 round-trip: valid UTF-8 bytes → string → bytes should match
    if ($bytes.Length -eq 0 -or -not ($bytes | Where-Object { $_ -gt 127 } | Select-Object -First 1)) {
        return "ascii"
    }
    if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) {
        return "unknown"
    }
    $decoder = [Text.UTF8Encoding]::new($false, $true)
    try {
        $utfText = $decoder.GetString($bytes)
        $reEncoded = $decoder.GetBytes($utfText)
        if ([Convert]::ToBase64String($reEncoded) -eq [Convert]::ToBase64String($bytes)) {
            return "utf8"
        }
    } catch {}
    try {
        $gbText = $gb.GetString($bytes)
        $gbRoundTrip = $gb.GetBytes($gbText)
        if ([Convert]::ToBase64String($gbRoundTrip) -eq [Convert]::ToBase64String($bytes)) {
            return "gb2312"
        }
    } catch {}
    return "unknown"
}

$results = @()
foreach ($file in $Files) {
    $resolved = Resolve-Path $file -ErrorAction Stop
    $dir = Split-Path $resolved -Parent
    $name = [IO.Path]::GetFileNameWithoutExtension($resolved)
    $ext = [IO.Path]::GetExtension($resolved)

    $encoding = Detect-Encoding -Path $resolved

    if ($encoding -eq "gb2312" -or $encoding -eq "ascii") {
        $results += @{
            file = $resolved
            encoding = $encoding
            converted = $false
            uploadPath = $resolved
        }
    } elseif ($encoding -eq "utf8") {
        $outPath = Join-Path $dir "$name.gb2312$ext"
        if (Test-Path -LiteralPath $outPath) {
            throw "GB2312 output already exists: $outPath"
        }
        $content = [IO.File]::ReadAllText($resolved, $utf8)
        try {
            $convertedBytes = $gb.GetBytes($content)
        }
        catch {
            throw "File contains characters that cannot be represented in GB2312/CP936: $resolved. $($_.Exception.Message)"
        }
        [IO.File]::WriteAllBytes($outPath, $convertedBytes)
        $results += @{
            file = $resolved
            encoding = "utf8"
            converted = $true
            uploadPath = $outPath
        }
    } else {
        throw "Unsupported or unknown source encoding: $resolved"
    }
}

Write-Output (ConvertTo-Json $results -Depth 2 -Compress)
