<#
Check frontend source file encoding before and after IRIS/HIS frontend edits.

Use this script as a byte-level guard for UTF-8 and legacy GB2312/CP936 frontend files.

Examples:
  .agents/scripts/check-frontend-encoding.ps1 -Files @("page.csp","page.js")
  .agents/scripts/check-frontend-encoding.ps1 -Files @("page.csp") -ExpectedEncoding gb2312 -ErrorOnMismatch

Output JSON:
  [{"file":"...","encoding":"gb2312|utf8|ascii|unknown","hasChinese":true|false,"expectedEncoding":"gb2312|utf8|any","status":"ok|warning|error","message":"..."}]
#>

param(
    [Parameter(Mandatory=$true)]
    [string[]]$Files,

    [ValidateSet("any", "gb2312", "utf8")]
    [string]$ExpectedEncoding = "any",

    [switch]$ErrorOnMismatch
)

$ErrorActionPreference = "Stop"

$gb2312 = [System.Text.Encoding]::GetEncoding(936, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
$utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)

function Test-HasChinese {
    param([string]$Text)
    return ($Text -match "[\u4e00-\u9fff]")
}

function Test-HasNonAscii {
    param([string]$Text)
    return ($Text -match "[^\u0000-\u007f]")
}

function Test-SuspectedMojibake {
    param([string]$Text)
    return ($Text -match "[ÃÂÅåäæçèéê]")
}

function Get-FrontendEncodingInfo {
    param([string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $encoding = "unknown"
    $text = ""

    if ($bytes.Length -eq 0 -or -not ($bytes | Where-Object { $_ -gt 127 } | Select-Object -First 1)) {
        return @{
            encoding = "ascii"
            hasChinese = $false
            hasNonAscii = $false
            suspectedMojibake = $false
        }
    }

    if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) {
        return @{
            encoding = "unknown"
            hasChinese = $false
            hasNonAscii = $true
            suspectedMojibake = $false
        }
    }

    try {
        $text = $utf8Strict.GetString($bytes)
        $roundTrip = $utf8Strict.GetBytes($text)
        if ([Convert]::ToBase64String($roundTrip) -eq [Convert]::ToBase64String($bytes)) {
            $encoding = "utf8"
        }
    }
    catch {}

    if ($encoding -eq "unknown") {
        try {
            $text = $gb2312.GetString($bytes)
            $roundTrip = $gb2312.GetBytes($text)
            if ([Convert]::ToBase64String($roundTrip) -eq [Convert]::ToBase64String($bytes)) {
                $encoding = "gb2312"
            }
        }
        catch {}
    }

    return @{
        encoding = $encoding
        hasChinese = (Test-HasChinese -Text $text)
        hasNonAscii = (Test-HasNonAscii -Text $text)
        suspectedMojibake = (Test-SuspectedMojibake -Text $text)
    }
}

$results = @()
$hasError = $false

foreach ($file in $Files) {
    $resolved = Resolve-Path -LiteralPath $file -ErrorAction Stop
    $info = Get-FrontendEncodingInfo -Path $resolved
    $status = "ok"
    $message = "Encoding accepted."

    if ($info.encoding -eq "unknown") {
        $status = "error"
        $message = "Encoding is unknown or unsupported; refusing to infer UTF-8 or GB2312."
        $hasError = $true
    }
    elseif ($ExpectedEncoding -ne "any" -and $info.encoding -ne $ExpectedEncoding) {
        if ($info.encoding -eq "ascii") {
            $status = "warning"
            $message = "ASCII-only file cannot prove UTF-8 or GB2312; use the confirmed frontend encoding mode before adding non-ASCII text."
        }
        else {
            $status = "error"
            $message = "Encoding mismatch: expected $ExpectedEncoding but detected $($info.encoding)."
            $hasError = $true
        }
    }

    if ($info.suspectedMojibake) {
        if ($status -eq "ok") {
            $status = "warning"
            $message = "Suspected mojibake characters found; inspect visible Chinese text before delivery."
        }
        elseif ($status -eq "error") {
            $message = "$message Suspected mojibake characters found."
        }
    }

    $results += @{
        file = $resolved.Path
        encoding = $info.encoding
        hasChinese = $info.hasChinese
        hasNonAscii = $info.hasNonAscii
        suspectedMojibake = $info.suspectedMojibake
        expectedEncoding = $ExpectedEncoding
        status = $status
        message = $message
    }
}

Write-Output (ConvertTo-Json $results -Depth 3 -Compress)

if ($ErrorOnMismatch -and $hasError) {
    exit 1
}
else {
    exit 0
}
