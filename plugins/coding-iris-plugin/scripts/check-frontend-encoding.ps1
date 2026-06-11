<#
Check frontend source file encoding before and after IRIS/HIS frontend edits.

Use this script as a guard for legacy CSP/JS/CSS files that must remain GB2312/GBK.

Examples:
  .agents/scripts/check-frontend-encoding.ps1 -Files @("page.csp","page.js")
  .agents/scripts/check-frontend-encoding.ps1 -Files @("page.csp") -ExpectedEncoding gb2312 -ErrorOnMismatch

Output JSON:
  [{"file":"...","encoding":"gb2312|utf8","hasChinese":true|false,"expectedEncoding":"gb2312|utf8|any","status":"ok|warning|error","message":"..."}]
#>

param(
    [Parameter(Mandatory=$true)]
    [string[]]$Files,

    [ValidateSet("any", "gb2312", "utf8")]
    [string]$ExpectedEncoding = "any",

    [switch]$ErrorOnMismatch
)

$ErrorActionPreference = "Stop"

$gb2312 = [System.Text.Encoding]::GetEncoding("gb2312")
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
    $encoding = "gb2312"
    $text = ""

    try {
        $text = $utf8Strict.GetString($bytes)
        $roundTrip = $utf8Strict.GetBytes($text)
        if ([Convert]::ToBase64String($roundTrip) -eq [Convert]::ToBase64String($bytes)) {
            $encoding = "utf8"
        }
    }
    catch {
        $encoding = "gb2312"
    }

    if ($encoding -eq "gb2312") {
        $text = $gb2312.GetString($bytes)
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

    if ($ExpectedEncoding -ne "any" -and $info.encoding -ne $ExpectedEncoding) {
        if ($ExpectedEncoding -eq "gb2312" -and $info.encoding -eq "utf8" -and -not $info.hasNonAscii) {
            $status = "warning"
            $message = "ASCII-only file is UTF-8 compatible; confirm whether this legacy frontend file must be preserved as GB2312."
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
