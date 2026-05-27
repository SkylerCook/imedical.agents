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
$gb = [Text.Encoding]::GetEncoding('gb2312')
$utf8 = New-Object System.Text.UTF8Encoding ($false)

function Detect-Encoding {
    param([string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    # Try UTF-8 round-trip: valid UTF-8 bytes → string → bytes should match
    $decoder = [Text.UTF8Encoding]::new($false, $false)  # no BOM, no replacement fallback
    try {
        $utfText = $decoder.GetString($bytes)
        $reEncoded = $decoder.GetBytes($utfText)
        if ([Convert]::ToBase64String($reEncoded) -eq [Convert]::ToBase64String($bytes)) {
            return "utf8"
        }
    } catch {
        # Invalid UTF-8 bytes → it's GB2312
    }
    return "gb2312"
}

$results = @()
foreach ($file in $Files) {
    $resolved = Resolve-Path $file -ErrorAction Stop
    $dir = Split-Path $resolved -Parent
    $name = [IO.Path]::GetFileNameWithoutExtension($resolved)
    $ext = [IO.Path]::GetExtension($resolved)

    $encoding = Detect-Encoding -Path $resolved

    if ($encoding -eq "gb2312") {
        $results += @{
            file = $resolved
            encoding = "gb2312"
            converted = $false
            uploadPath = $resolved
        }
    } else {
        $outPath = Join-Path $dir "$name.gb2312$ext"
        $content = [IO.File]::ReadAllText($resolved, $utf8)
        [IO.File]::WriteAllText($outPath, $content, $gb)
        $results += @{
            file = $resolved
            encoding = "utf8"
            converted = $true
            uploadPath = $outPath
        }
    }
}

Write-Output (ConvertTo-Json $results -Depth 2 -Compress)
