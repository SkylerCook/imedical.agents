param(
  [string]$ProjectRoot = ".",
  [string]$ContextRoot = "",
  [ValidateSet("DryRun", "Write")]
  [string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"
$preferredCommand = ".agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe"

function Resolve-FullPath {
  param(
    [string]$BasePath,
    [string]$Path
  )

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function New-PreferenceResult {
  param(
    [string]$Status,
    [string]$Target,
    [string]$Reason
  )

  [PSCustomObject]@{
    status = $Status
    target = $Target
    reason = $Reason
  }
}

function Read-JsonFile {
  param([string]$Path)

  $originalBytes = [System.IO.File]::ReadAllBytes($Path)
  $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  return [PSCustomObject]@{
    path = $Path
    original = $text
    originalBytes = $originalBytes
    value = ($text | ConvertFrom-Json)
  }
}

function ConvertTo-StableJson {
  param([object]$Value)

  return (($Value | ConvertTo-Json -Depth 100) + [Environment]::NewLine)
}

function Set-JsonProperty {
  param(
    [object]$Object,
    [string]$Name,
    [object]$Value
  )

  if ($Object.PSObject.Properties.Name -contains $Name) {
    $Object.$Name = $Value
  }
  else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Write-JsonFilesAtomically {
  param([object[]]$Files)

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $prepared = New-Object System.Collections.Generic.List[object]
  $replaced = New-Object System.Collections.Generic.List[object]

  try {
    foreach ($file in $Files) {
      $serialized = ConvertTo-StableJson -Value $file.value
      $null = $serialized | ConvertFrom-Json
      $tempPath = $file.path + ".tmp-" + [System.Guid]::NewGuid().ToString("N")
      [System.IO.File]::WriteAllText($tempPath, $serialized, $utf8NoBom)
      $prepared.Add([PSCustomObject]@{
        path = $file.path
        tempPath = $tempPath
        originalBytes = $file.originalBytes
      })
    }

    foreach ($file in $prepared) {
      Move-Item -LiteralPath $file.tempPath -Destination $file.path -Force
      $replaced.Add($file)
    }
  }
  catch {
    foreach ($file in $replaced) {
      [System.IO.File]::WriteAllBytes($file.path, $file.originalBytes)
    }
    foreach ($file in $prepared) {
      if (Test-Path -LiteralPath $file.tempPath) {
        Remove-Item -LiteralPath $file.tempPath -Force
      }
    }
    throw
  }
}

function Restore-JsonFiles {
  param([object[]]$Files)

  foreach ($file in $Files) {
    [System.IO.File]::WriteAllBytes($file.path, $file.originalBytes)
  }
}

function Get-McpServerEntry {
  param(
    [object]$McpConfig,
    [string]$ConfiguredServerName
  )

  if (($null -eq $McpConfig) -or ($null -eq $McpConfig.mcpServers)) {
    return $null
  }

  $preferredNames = New-Object System.Collections.Generic.List[string]
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredServerName)) {
    $preferredNames.Add($ConfiguredServerName)
  }
  if (-not $preferredNames.Contains("iris-agentic-dev")) {
    $preferredNames.Add("iris-agentic-dev")
  }

  $matches = New-Object System.Collections.Generic.List[object]
  foreach ($serverName in $preferredNames) {
    $property = $McpConfig.mcpServers.PSObject.Properties[$serverName]
    if (($null -ne $property) -and ($null -ne $property.Value)) {
      $matches.Add([PSCustomObject]@{ name = $serverName; server = $property.Value })
    }
  }

  if ($matches.Count -eq 0) {
    foreach ($property in $McpConfig.mcpServers.PSObject.Properties) {
      $command = [string]$property.Value.command
      if ([string]::IsNullOrWhiteSpace($command)) {
        continue
      }
      $leaf = [System.IO.Path]::GetFileName(($command -replace "/", [System.IO.Path]::DirectorySeparatorChar))
      if ($leaf -in @("iris-agentic-dev", "iris-agentic-dev.exe")) {
        $matches.Add([PSCustomObject]@{ name = $property.Name; server = $property.Value })
      }
    }
  }

  if ($matches.Count -gt 1) {
    throw "Multiple iris-agentic-dev MCP server candidates were found; automatic command selection is unsafe."
  }
  if ($matches.Count -eq 1) {
    return $matches[0]
  }
  return $null
}

$projectRootFull = Resolve-FullPath -BasePath (Get-Location) -Path $ProjectRoot
$contextRootFull = if ([string]::IsNullOrWhiteSpace($ContextRoot)) {
  Join-Path $projectRootFull ".agents"
}
else {
  Resolve-FullPath -BasePath $projectRootFull -Path $ContextRoot
}
$mcpPath = Join-Path $projectRootFull ".mcp.json"
$projectEnvPath = Join-Path $contextRootFull "config/project-env.json"
$mcpExists = Test-Path -LiteralPath $mcpPath -PathType Leaf
$projectEnvExists = Test-Path -LiteralPath $projectEnvPath -PathType Leaf

if ((-not $mcpExists) -and (-not $projectEnvExists)) {
  New-PreferenceResult -Status "mcp-vendor-command-not-configured" -Target ".mcp.json" -Reason "No existing MCP or project-env configuration was found; no connection config was created"
  return
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  New-PreferenceResult -Status "mcp-vendor-command-skipped-platform" -Target ".mcp.json" -Reason "Bundled iris-agentic-dev is Windows x64 only; existing project command was preserved"
  return
}

$vendorExecutable = Join-Path $projectRootFull ($preferredCommand -replace "/", [System.IO.Path]::DirectorySeparatorChar)
if (-not (Test-Path -LiteralPath $vendorExecutable -PathType Leaf)) {
  New-PreferenceResult -Status "mcp-vendor-executable-missing" -Target $preferredCommand -Reason "Existing MCP configuration was preserved because the bundled executable is missing"
  return
}

$projectEnvFile = $null
if ($projectEnvExists) {
  try {
    $projectEnvFile = Read-JsonFile -Path $projectEnvPath
  }
  catch {
    New-PreferenceResult -Status "mcp-vendor-config-invalid" -Target ".agents/config/project-env.json" -Reason $_.Exception.Message
    return
  }
}

$mcpFile = $null
if ($mcpExists) {
  try {
    $mcpFile = Read-JsonFile -Path $mcpPath
  }
  catch {
    New-PreferenceResult -Status "mcp-vendor-config-invalid" -Target ".mcp.json" -Reason $_.Exception.Message
    return
  }
}

$configuredServerName = ""
$projectEnvMcp = $null
if (($null -ne $projectEnvFile) -and ($null -ne $projectEnvFile.value.mcp)) {
  $projectEnvMcp = $projectEnvFile.value.mcp
  $configuredServerName = [string]$projectEnvMcp.serverName
}

try {
  $mcpServerEntry = if ($null -ne $mcpFile) { Get-McpServerEntry -McpConfig $mcpFile.value -ConfiguredServerName $configuredServerName } else { $null }
}
catch {
  New-PreferenceResult -Status "mcp-vendor-command-ambiguous" -Target ".mcp.json" -Reason $_.Exception.Message
  return
}

$filesToWrite = New-Object System.Collections.Generic.List[object]
$targets = New-Object System.Collections.Generic.List[string]
$observedTargets = New-Object System.Collections.Generic.List[string]

if ($null -ne $mcpServerEntry) {
  $observedTargets.Add(".mcp.json")
  if ([string]$mcpServerEntry.server.command -ne $preferredCommand) {
    Set-JsonProperty -Object $mcpServerEntry.server -Name "command" -Value $preferredCommand
    $filesToWrite.Add($mcpFile)
    $targets.Add(".mcp.json")
  }
}

if ($null -ne $projectEnvMcp) {
  $observedTargets.Add(".agents/config/project-env.json")
  if ([string]$projectEnvMcp.serverPath -ne $preferredCommand) {
    Set-JsonProperty -Object $projectEnvMcp -Name "serverPath" -Value $preferredCommand
    $filesToWrite.Add($projectEnvFile)
    $targets.Add(".agents/config/project-env.json")
  }
}

if (($null -eq $mcpServerEntry) -and ($null -eq $projectEnvMcp)) {
  New-PreferenceResult -Status "mcp-vendor-command-not-configured" -Target ".mcp.json" -Reason "No iris-agentic-dev MCP server entry was found; no configuration was changed"
  return
}

if ($filesToWrite.Count -eq 0) {
  New-PreferenceResult -Status "mcp-vendor-command-unchanged" -Target ($observedTargets -join ", ") -Reason "Existing MCP configuration already prefers the bundled vendor executable"
  return
}

$targetText = $targets -join ", "
if ($Mode -eq "DryRun") {
  New-PreferenceResult -Status "mcp-vendor-command-planned" -Target $targetText -Reason ("Would set only the iris-agentic-dev executable path to " + $preferredCommand)
  return
}

try {
  Write-JsonFilesAtomically -Files $filesToWrite

  if ($targets.Contains(".mcp.json")) {
    $verifiedMcpFile = Read-JsonFile -Path $mcpPath
    $verifiedMcpServerEntry = Get-McpServerEntry -McpConfig $verifiedMcpFile.value -ConfiguredServerName $configuredServerName
    if (($null -eq $verifiedMcpServerEntry) -or ([string]$verifiedMcpServerEntry.server.command -ne $preferredCommand)) {
      throw "Post-write verification failed for .mcp.json."
    }
  }

  if ($targets.Contains(".agents/config/project-env.json")) {
    $verifiedProjectEnvFile = Read-JsonFile -Path $projectEnvPath
    if (($null -eq $verifiedProjectEnvFile.value.mcp) -or ([string]$verifiedProjectEnvFile.value.mcp.serverPath -ne $preferredCommand)) {
      throw "Post-write verification failed for .agents/config/project-env.json."
    }
  }

  New-PreferenceResult -Status "mcp-vendor-command-applied" -Target $targetText -Reason ("Set only the iris-agentic-dev executable path to " + $preferredCommand + "; connection fields were preserved")
}
catch {
  $failureReason = $_.Exception.Message
  try {
    Restore-JsonFiles -Files $filesToWrite
  }
  catch {
    $failureReason = $failureReason + "; rollback failed: " + $_.Exception.Message
  }
  New-PreferenceResult -Status "mcp-vendor-command-write-failed" -Target $targetText -Reason $failureReason
}
