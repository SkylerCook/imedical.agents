param(
  [string]$ProjectRoot = ".",
  [string]$AgentsRoot = ".agents",
  [ValidateSet("DryRun", "Write")]
  [string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"
$projectRootFull = [System.IO.Path]::GetFullPath($ProjectRoot)
$agentsRootFull = if ([System.IO.Path]::IsPathRooted($AgentsRoot)) { [System.IO.Path]::GetFullPath($AgentsRoot) } else { [System.IO.Path]::GetFullPath((Join-Path $projectRootFull $AgentsRoot)) }
$profilePath = Join-Path $agentsRootFull "config/iris_project_profile.md"
$utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)
$cp936Strict = [System.Text.Encoding]::GetEncoding(936, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param([string]$Status, [string]$Target, [string]$Reason)
  $results.Add([PSCustomObject]@{ status = $Status; target = $Target; reason = $Reason })
}

function Get-RelativePathPortable {
  param([string]$From, [string]$To)
  $fromUri = [Uri](([System.IO.Path]::GetFullPath($From).TrimEnd('\') + '\'))
  $toUri = [Uri][System.IO.Path]::GetFullPath($To)
  return [Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString()).Replace('\', '/').TrimEnd('/')
}

function Test-IsFrontendFile {
  param([System.IO.FileInfo]$File)
  return @('.csp', '.js', '.css') -contains $File.Extension.ToLowerInvariant()
}

function Get-EncodingKind {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -eq 0 -or -not ($bytes | Where-Object { $_ -gt 127 } | Select-Object -First 1)) { return "ascii" }
  if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) { return "unknown" }
  try {
    $text = $utf8Strict.GetString($bytes)
    if ([Convert]::ToBase64String($utf8Strict.GetBytes($text)) -eq [Convert]::ToBase64String($bytes)) { return "utf8" }
  } catch {}
  try {
    $text = $cp936Strict.GetString($bytes)
    if ([Convert]::ToBase64String($cp936Strict.GetBytes($text)) -eq [Convert]::ToBase64String($bytes)) { return "gb2312" }
  } catch {}
  return "unknown"
}

function Test-ExcludedPath {
  param([string]$Path)
  $relative = (Get-RelativePathPortable -From $projectRootFull -To $Path).ToLowerInvariant()
  return $relative -match '(^|/)(\.agents|\.git|node_modules|vendor|dist|build|target)(/|$)'
}

function Test-HasFrontendContent {
  param([string]$Root)
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return $false }
  return $null -ne (Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { Test-IsFrontendFile $_ } | Select-Object -First 1)
}

function Add-Candidate {
  param([hashtable]$Candidates, [string]$Path, [string]$Source, [string]$ExpectedMode)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  $full = [System.IO.Path]::GetFullPath($Path)
  if (Test-ExcludedPath -Path $full) { return }
  if (-not (Test-HasFrontendContent -Root $full)) { return }
  if (-not $Candidates.ContainsKey($full.ToLowerInvariant())) {
    $Candidates[$full.ToLowerInvariant()] = [PSCustomObject]@{ path = $full; source = $Source; expectedMode = $ExpectedMode }
  }
}

function Get-Candidates {
  $candidates = @{}
  $hospitalRoot = Join-Path $projectRootFull "src/imedical/web"
  Add-Candidate -Candidates $candidates -Path $hospitalRoot -Source "hospital-layout" -ExpectedMode "project-utf8"

  $gitLinks = @()
  try {
    $stageLines = @(git -C $projectRootFull ls-files --stage 2>$null)
    foreach ($line in $stageLines) {
      if ($line -match '^160000\s+[0-9a-f]+\s+\d+\t(.+)$') { $gitLinks += $Matches[1] }
    }
  } catch {}
  foreach ($relative in $gitLinks) {
    $path = Join-Path $projectRootFull $relative
    if ($relative.Replace('\', '/') -match '(^|/)frontend(/|$)') {
      if (-not (Test-HasFrontendContent -Root $path)) {
        Add-Result -Status "submodule-init-required" -Target $relative.Replace('\', '/') -Reason "frontend gitlink is not initialized or contains no frontend files"
      } else {
        Add-Candidate -Candidates $candidates -Path $path -Source "git-role" -ExpectedMode "standard-gb2312"
      }
    }
  }

  Get-ChildItem -LiteralPath $projectRootFull -Recurse -Depth 5 -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'frontend' -and -not (Test-ExcludedPath -Path $_.FullName) } |
    ForEach-Object {
      $frontendDir = $_.FullName
      $knownFolders = @('csp', 'scripts', 'css') | ForEach-Object { Join-Path $frontendDir $_ }
      if ($knownFolders | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -First 1) {
        Add-Candidate -Candidates $candidates -Path $frontendDir -Source "frontend-directory" -ExpectedMode "standard-gb2312"
      } else {
        Get-ChildItem -LiteralPath $frontendDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
          Add-Candidate -Candidates $candidates -Path $_.FullName -Source "frontend-directory" -ExpectedMode "standard-gb2312"
        }
      }
    }

  Get-ChildItem -LiteralPath $projectRootFull -Recurse -Depth 5 -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq '.git' -and -not (Test-ExcludedPath -Path $_.FullName) } |
    ForEach-Object {
      $repoRoot = Split-Path -Parent $_.FullName
      if ($repoRoot -ne $projectRootFull) {
        Add-Candidate -Candidates $candidates -Path $repoRoot -Source "nested-git-content" -ExpectedMode "standard-gb2312"
      }
    }
  return @($candidates.Values | Sort-Object path)
}

function Get-CandidateValidation {
  param($Candidate)
  $counts = @{ utf8 = 0; gb2312 = 0; unknown = 0; ascii = 0 }
  $sampled = 0
  $files = Get-ChildItem -LiteralPath $Candidate.path -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { (Test-IsFrontendFile $_) -and -not (Test-ExcludedPath -Path $_.FullName) } |
    Sort-Object FullName
  foreach ($file in $files) {
    $kind = Get-EncodingKind -Path $file.FullName
    $counts[$kind]++
    if ($kind -ne 'ascii') { $sampled++ }
    if ($sampled -ge 20) { break }
  }
  $detected = if ($counts.unknown -gt 0) { 'unknown' } elseif ($counts.utf8 -gt 0 -and $counts.gb2312 -gt 0) { 'mixed' } elseif ($counts.utf8 -gt 0) { 'utf8' } elseif ($counts.gb2312 -gt 0) { 'gb2312' } else { 'insufficient-evidence' }
  $mode = if ($detected -eq 'utf8') { 'project-utf8' } elseif ($detected -eq 'gb2312') { 'standard-gb2312' } else { $null }
  return [PSCustomObject]@{ candidate = $Candidate; detected = $detected; mode = $mode; counts = $counts }
}

function Get-ProfileMode {
  param([string]$Text)
  $match = [regex]::Match($Text, '(?m)^\s*-\s*前端编码模式\s*[：:]\s*(?<value>[^\r\n]+)')
  if ($match.Success) { return $match.Groups['value'].Value.Trim() }
  return $null
}

function Get-ProfileOverrides {
  param([string]$Text)
  $overrides = New-Object System.Collections.Generic.List[object]
  foreach ($line in ($Text -split "`r?`n")) {
    $match = [regex]::Match($line, '^\s*\|\s*`?(?<root>[^|`]+?)`?\s*\|\s*(?<mode>standard-gb2312|project-utf8)\s*\|\s*$')
    if ($match.Success) {
      $overrides.Add([PSCustomObject]@{ root = $match.Groups['root'].Value.Trim().Replace('\', '/').TrimEnd('/'); mode = $match.Groups['mode'].Value })
    }
  }
  return @($overrides | ForEach-Object { $_ })
}

function Get-NormalizedTextHash {
  param([string]$Path)
  $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF).Replace("`r`n", "`n").TrimEnd("`n") + "`n"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  return ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}

function Sync-EncodingWrapper {
  param([string]$Name, [string[]]$LegacyHashes)
  $target = Join-Path $agentsRootFull "scripts/$Name"
  $relativeTarget = Get-RelativePathPortable -From $projectRootFull -To $target
  $canonicalRelative = "../plugins/coding-iris-plugin/scripts/$Name"
  $wrapper = @"
# coding-iris-plugin managed wrapper
`$canonical = Join-Path `$PSScriptRoot '$canonicalRelative'
& `$canonical @args
exit `$LASTEXITCODE
"@
  $canWrite = $false
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    $canWrite = $true
  } else {
    $existing = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)
    if ($existing -match 'coding-iris-plugin managed wrapper') { return }
    $hash = Get-NormalizedTextHash -Path $target
    if ($LegacyHashes -contains $hash) { $canWrite = $true }
    else {
      Add-Result -Status "script-conflict" -Target $relativeTarget -Reason "existing encoding script is customized or unknown; not overwritten"
      return
    }
  }
  if ($Mode -eq 'Write' -and $canWrite) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    [System.IO.File]::WriteAllText($target, $wrapper.TrimStart() , [System.Text.UTF8Encoding]::new($false))
    Add-Result -Status "script-wrapper-applied" -Target $relativeTarget -Reason "now forwards to plugin canonical script"
  } elseif ($canWrite) {
    Add-Result -Status "script-wrapper-planned" -Target $relativeTarget -Reason "will forward to plugin canonical script"
  }
}

function Set-ProfileEncodingConfig {
  param([string]$Text, [string]$ModeValue, [array]$Validations)
  $managedHeader = '## Frontend encoding v2 (managed)'
  $headerIndex = $Text.IndexOf($managedHeader, [System.StringComparison]::Ordinal)
  if ($headerIndex -ge 0) { $Text = $Text.Substring(0, $headerIndex).TrimEnd() }

  $modePattern = '(?m)^\s*-\s*前端编码模式\s*[：:]\s*[^\r\n]+'
  if ($ModeValue) {
    $modeLine = "- 前端编码模式：$ModeValue"
    if ([regex]::IsMatch($Text, $modePattern)) { $Text = [regex]::Replace($Text, $modePattern, $modeLine, 1) }
    else { $Text = $Text.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $modeLine }
  }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('')
  $lines.Add('')
  $lines.Add($managedHeader)
  $lines.Add('')
  $lines.Add('<!-- generated by frontend-encoding-v2; byte validation remains the final gate -->')
  if ($Validations.Count -gt 1 -and (($Validations | Select-Object -ExpandProperty mode -Unique).Count -gt 1)) {
    $lines.Add('')
    $lines.Add('### 前端编码路径覆盖')
    $lines.Add('')
    $lines.Add('| 前端根目录 | 编码模式 |')
    $lines.Add('|---|---|')
    foreach ($validation in $Validations) {
      $relative = Get-RelativePathPortable -From $projectRootFull -To $validation.candidate.path
      $lines.Add("| ``$relative`` | $($validation.mode) |")
    }
  }
  return $Text.TrimEnd() + ($lines -join [Environment]::NewLine) + [Environment]::NewLine
}

if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
  Add-Result -Status "config-migration-review-required" -Target ".agents/config/iris_project_profile.md" -Reason "profile is missing"
  Sync-EncodingWrapper -Name "check-frontend-encoding.ps1" -LegacyHashes @('ec06244786350d3bab90e579eb305517eb93b7516192f22b3ed319fd605c3ed3')
  Sync-EncodingWrapper -Name "convert-gb2312-upload.ps1" -LegacyHashes @('7f7a07ca0b599f382f890f14ee0c0bbfbb591dab5530b78da3112d6b408fd56b')
  Write-Output (ConvertTo-Json @($results | ForEach-Object { $_ }) -Depth 5 -Compress)
  exit 0
}

$validations = @(Get-Candidates | ForEach-Object { Get-CandidateValidation -Candidate $_ })
foreach ($validation in $validations) {
  $relative = Get-RelativePathPortable -From $projectRootFull -To $validation.candidate.path
  if (-not $validation.mode) {
    Add-Result -Status "config-migration-review-required" -Target $relative -Reason ("byte validation=" + $validation.detected)
  } elseif ($validation.candidate.expectedMode -and $validation.candidate.expectedMode -ne $validation.mode) {
    Add-Result -Status "config-migration-conflict" -Target $relative -Reason ("candidate=" + $validation.candidate.expectedMode + "; bytes=" + $validation.mode)
  }
}

if ($validations.Count -eq 0) {
  Add-Result -Status "config-migration-review-required" -Target ".agents/config/iris_project_profile.md" -Reason "no frontend roots were discovered"
} elseif (@($results | Where-Object { $_.status -in @('config-migration-review-required', 'config-migration-conflict', 'submodule-init-required') }).Count -eq 0) {
  $modes = @($validations | Select-Object -ExpandProperty mode -Unique)
  $globalMode = if ($modes.Count -eq 1) { $modes[0] } else { $null }
  $profileText = [System.IO.File]::ReadAllText($profilePath, [System.Text.Encoding]::UTF8)
  $existingMode = Get-ProfileMode -Text $profileText
  $existingOverrides = @(Get-ProfileOverrides -Text $profileText)
  $existingConfigValidated = $false
  if ($existingOverrides.Count -gt 0) {
    $existingConfigValidated = $true
    foreach ($validation in $validations) {
      $relative = Get-RelativePathPortable -From $projectRootFull -To $validation.candidate.path
      $matches = @($existingOverrides | Where-Object { $relative -eq $_.root -or $relative.StartsWith($_.root + '/') } | Sort-Object { $_.root.Length } -Descending)
      $configuredMode = if ($matches.Count -gt 0) { $matches[0].mode } else { $existingMode }
      if ($configuredMode -notin @('standard-gb2312', 'project-utf8') -or $configuredMode -ne $validation.mode) {
        Add-Result -Status "config-migration-conflict" -Target $relative -Reason ("configured=" + $configuredMode + "; bytes=" + $validation.mode)
        $existingConfigValidated = $false
      }
    }
  } elseif ($existingMode -in @('standard-gb2312', 'project-utf8')) {
    $existingConfigValidated = @($validations | Where-Object { $_.mode -ne $existingMode }).Count -eq 0
    if (-not $existingConfigValidated) {
      Add-Result -Status "config-migration-conflict" -Target ".agents/config/iris_project_profile.md" -Reason ("configured=" + $existingMode + "; byte-validated roots disagree")
    }
  }

  if ($existingConfigValidated) {
    Add-Result -Status "config-migration-unchanged" -Target ".agents/config/iris_project_profile.md" -Reason "frontend encoding v2 is current"
  } elseif (@($results | Where-Object { $_.status -eq 'config-migration-conflict' }).Count -eq 0) {
    $newText = Set-ProfileEncodingConfig -Text $profileText -ModeValue $globalMode -Validations $validations
    if ($newText -eq $profileText) {
      Add-Result -Status "config-migration-unchanged" -Target ".agents/config/iris_project_profile.md" -Reason "frontend encoding v2 is current"
    } elseif ($Mode -eq 'Write') {
    [System.IO.File]::WriteAllText($profilePath, $newText, [System.Text.UTF8Encoding]::new($false))
    $reason = if ($existingMode -and $existingMode -notin @('TODO', 'standard-gb2312', 'project-utf8')) { "legacy mode preserved for review; generated byte-validated v2 config" } else { "generated byte-validated frontend encoding config" }
    Add-Result -Status "config-migration-applied" -Target ".agents/config/iris_project_profile.md" -Reason $reason
    } else {
      Add-Result -Status "config-migration-planned" -Target ".agents/config/iris_project_profile.md" -Reason "byte-validated frontend encoding config will be generated"
    }
  }
}

Sync-EncodingWrapper -Name "check-frontend-encoding.ps1" -LegacyHashes @('ec06244786350d3bab90e579eb305517eb93b7516192f22b3ed319fd605c3ed3')
Sync-EncodingWrapper -Name "convert-gb2312-upload.ps1" -LegacyHashes @('7f7a07ca0b599f382f890f14ee0c0bbfbb591dab5530b78da3112d6b408fd56b')
Write-Output (ConvertTo-Json @($results | ForEach-Object { $_ }) -Depth 6 -Compress)
