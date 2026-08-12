Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function ConvertTo-AgentFullPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$BasePath = ""
  )

  $candidate = $Path
  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    if ([string]::IsNullOrWhiteSpace($BasePath)) {
      $BasePath = (Get-Location).Path
    }
    $candidate = Join-Path $BasePath $candidate
  }

  $full = [System.IO.Path]::GetFullPath($candidate)
  $root = [System.IO.Path]::GetPathRoot($full)
  $trimmed = $full.TrimEnd([char[]]@('\', '/'))
  if ($trimmed.Length -lt $root.TrimEnd([char[]]@('\', '/')).Length) {
    return $root
  }
  if ([string]::IsNullOrEmpty($trimmed)) { return $root }
  return $trimmed
}

function Test-AgentPathWithin {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $pathFull = ConvertTo-AgentFullPath -Path $Path
  $rootFull = ConvertTo-AgentFullPath -Path $Root
  if ($pathFull.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $pathFull.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function New-AgentValidationResult {
  param(
    [Parameter(Mandatory = $true)][string]$Status,
    [string]$Path = "",
    [string]$Expected = "",
    [string]$Actual = "",
    [string]$Reason = ""
  )

  [PSCustomObject][ordered]@{
    status = $Status
    path = $Path
    expected = $Expected
    actual = $Actual
    reason = $Reason
  }
}

function Get-AgentManifestProblems {
  param([object]$Manifest)

  $problems = New-Object System.Collections.Generic.List[string]
  if ($null -eq $Manifest) {
    $problems.Add("manifest is empty")
    return $problems.ToArray()
  }

  $propertyNames = @($Manifest.PSObject.Properties.Name)
  foreach ($required in @("schemaVersion", "mode", "workspace", "contextRoot", "capabilityRoot", "sharedDirectories", "localDirectories", "sourceRoots")) {
    if ($propertyNames -notcontains $required) { $problems.Add("missing " + $required) }
  }

  if (($propertyNames -contains "mode") -and ([string]$Manifest.mode -ne "workspace-overlay")) {
    $problems.Add("mode must be workspace-overlay")
  }
  foreach ($requiredText in @("workspace", "contextRoot", "capabilityRoot")) {
    if (($propertyNames -contains $requiredText) -and [string]::IsNullOrWhiteSpace([string]$Manifest.$requiredText)) {
      $problems.Add($requiredText + " must be non-empty")
    }
  }

  $shared = if ($propertyNames -contains "sharedDirectories") { @($Manifest.sharedDirectories) } else { @() }
  $local = if ($propertyNames -contains "localDirectories") { @($Manifest.localDirectories) } else { @() }
  foreach ($entry in @($shared + $local)) {
    if ([string]::IsNullOrWhiteSpace([string]$entry)) { $problems.Add("directory names must be non-empty") }
  }
  if ((@($shared | Group-Object { ([string]$_).ToLowerInvariant() } | Where-Object Count -gt 1)).Count -gt 0) {
    $problems.Add("sharedDirectories must be unique")
  }
  if ((@($local | Group-Object { ([string]$_).ToLowerInvariant() } | Where-Object Count -gt 1)).Count -gt 0) {
    $problems.Add("localDirectories must be unique")
  }
  $sharedNames = @($shared | ForEach-Object { ([string]$_).ToLowerInvariant() })
  foreach ($entry in $local) {
    if ($sharedNames -contains ([string]$entry).ToLowerInvariant()) {
      $problems.Add("sharedDirectories and localDirectories must not overlap")
    }
  }

  $sourceRoots = if ($propertyNames -contains "sourceRoots") { @($Manifest.sourceRoots) } else { @() }
  if ((@($sourceRoots)).Count -eq 0) { $problems.Add("sourceRoots must contain at least one entry") }
  foreach ($sourceRoot in $sourceRoots) {
    if ($null -eq $sourceRoot) {
      $problems.Add("sourceRoot must be an object")
      continue
    }
    $sourceProperties = @($sourceRoot.PSObject.Properties.Name)
    foreach ($required in @("name", "path", "target", "gitRoot")) {
      if (($sourceProperties -notcontains $required) -or [string]::IsNullOrWhiteSpace([string]$sourceRoot.$required)) {
        $problems.Add("sourceRoot " + $required + " must be non-empty")
      }
    }
  }
  if ((@($sourceRoots | Where-Object { $null -ne $_ -and $_.PSObject.Properties.Name -contains "name" } | Group-Object { ([string]$_.name).ToLowerInvariant() } | Where-Object Count -gt 1)).Count -gt 0) {
    $problems.Add("sourceRoot names must be unique")
  }

  return $problems.ToArray()
}

function New-AgentContextObject {
  param(
    [string]$Mode,
    [string]$WorkspaceName,
    [string]$WorkspaceRoot,
    [string]$ContextRoot,
    [string]$CapabilityRoot,
    [string]$ManifestPath,
    [object[]]$SharedDirectories,
    [object[]]$LocalDirectories,
    [object[]]$SourceRoots,
    [string[]]$GitRoots,
    [object]$Manifest,
    [string]$ManifestError = ""
  )

  [PSCustomObject][ordered]@{
    mode = $Mode
    workspaceName = $WorkspaceName
    workspaceRoot = $WorkspaceRoot
    contextRoot = $ContextRoot
    capabilityRoot = $CapabilityRoot
    manifestPath = $ManifestPath
    sharedDirectories = @($SharedDirectories)
    localDirectories = @($LocalDirectories)
    sourceRoots = @($SourceRoots)
    gitRoots = @($GitRoots)
    manifest = $Manifest
    manifestError = $ManifestError
  }
}

function Resolve-AgentWorkspaceContext {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  $workspaceRoot = ConvertTo-AgentFullPath -Path $ProjectRoot
  $manifestPath = Join-Path (Join-Path $workspaceRoot ".agents") "capability.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    $contextRoot = Join-Path $workspaceRoot ".agents"
    $sourceRoot = [PSCustomObject][ordered]@{
      name = "workspace"
      path = $workspaceRoot
      target = $workspaceRoot
      gitRoot = $workspaceRoot
    }
    return New-AgentContextObject -Mode "standard" -WorkspaceName ([System.IO.Path]::GetFileName($workspaceRoot)) -WorkspaceRoot $workspaceRoot -ContextRoot $contextRoot -CapabilityRoot $contextRoot -ManifestPath "" -SharedDirectories @() -LocalDirectories @() -SourceRoots @($sourceRoot) -GitRoots @($workspaceRoot) -Manifest $null
  }

  try {
    $raw = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
    $manifest = $raw | ConvertFrom-Json
  }
  catch {
    $defaultContext = Join-Path $workspaceRoot ".agents"
    return New-AgentContextObject -Mode "invalid" -WorkspaceName "" -WorkspaceRoot $workspaceRoot -ContextRoot $defaultContext -CapabilityRoot $defaultContext -ManifestPath $manifestPath -SharedDirectories @() -LocalDirectories @() -SourceRoots @() -GitRoots @() -Manifest $null -ManifestError $_.Exception.Message
  }

  $propertyNames = @($manifest.PSObject.Properties.Name)
  $contextRootValue = if (($propertyNames -contains "contextRoot") -and -not [string]::IsNullOrWhiteSpace([string]$manifest.contextRoot)) { [string]$manifest.contextRoot } else { ".agents" }
  $capabilityRootValue = if (($propertyNames -contains "capabilityRoot") -and -not [string]::IsNullOrWhiteSpace([string]$manifest.capabilityRoot)) { [string]$manifest.capabilityRoot } else { ".agents" }
  $contextRoot = ConvertTo-AgentFullPath -Path $contextRootValue -BasePath $workspaceRoot
  $capabilityRoot = ConvertTo-AgentFullPath -Path $capabilityRootValue -BasePath $workspaceRoot

  $sharedDirectories = New-Object System.Collections.Generic.List[object]
  if ($propertyNames -contains "sharedDirectories") {
    foreach ($name in @($manifest.sharedDirectories)) {
      $sharedDirectories.Add([PSCustomObject][ordered]@{
        name = [string]$name
        path = ConvertTo-AgentFullPath -Path ([string]$name) -BasePath $contextRoot
        target = ConvertTo-AgentFullPath -Path ([string]$name) -BasePath $capabilityRoot
      })
    }
  }

  $localDirectories = New-Object System.Collections.Generic.List[object]
  if ($propertyNames -contains "localDirectories") {
    foreach ($name in @($manifest.localDirectories)) {
      $localDirectories.Add([PSCustomObject][ordered]@{
        name = [string]$name
        path = ConvertTo-AgentFullPath -Path ([string]$name) -BasePath $contextRoot
      })
    }
  }

  $sourceRoots = New-Object System.Collections.Generic.List[object]
  if ($propertyNames -contains "sourceRoots") {
    foreach ($source in @($manifest.sourceRoots)) {
      if ($null -eq $source) { continue }
      $sourceProperties = @($source.PSObject.Properties.Name)
      $sourceName = if ($sourceProperties -contains "name") { [string]$source.name } else { "" }
      $sourcePath = if ($sourceProperties -contains "path") { [string]$source.path } else { "" }
      $sourceTarget = if ($sourceProperties -contains "target") { [string]$source.target } else { "" }
      $sourceGitRoot = if ($sourceProperties -contains "gitRoot") { [string]$source.gitRoot } else { "" }
      $sourceRoots.Add([PSCustomObject][ordered]@{
        name = $sourceName
        path = ConvertTo-AgentFullPath -Path $(if ($sourcePath) { $sourcePath } else { "." }) -BasePath $workspaceRoot
        target = ConvertTo-AgentFullPath -Path $(if ($sourceTarget) { $sourceTarget } else { "." }) -BasePath $workspaceRoot
        gitRoot = ConvertTo-AgentFullPath -Path $(if ($sourceGitRoot) { $sourceGitRoot } else { "." }) -BasePath $workspaceRoot
      })
    }
  }

  $gitRoots = New-Object System.Collections.Generic.List[string]
  foreach ($source in $sourceRoots) {
    if ((@($gitRoots | Where-Object { $_.Equals($source.gitRoot, [System.StringComparison]::OrdinalIgnoreCase) })).Count -eq 0) {
      $gitRoots.Add($source.gitRoot)
    }
  }

  $mode = if ($propertyNames -contains "mode") { [string]$manifest.mode } else { "invalid" }
  $workspaceName = if ($propertyNames -contains "workspace") { [string]$manifest.workspace } else { "" }
  return New-AgentContextObject -Mode $mode -WorkspaceName $workspaceName -WorkspaceRoot $workspaceRoot -ContextRoot $contextRoot -CapabilityRoot $capabilityRoot -ManifestPath $manifestPath -SharedDirectories $sharedDirectories.ToArray() -LocalDirectories $localDirectories.ToArray() -SourceRoots $sourceRoots.ToArray() -GitRoots $gitRoots.ToArray() -Manifest $manifest
}

function Get-AgentLinkTarget {
  param([Parameter(Mandatory = $true)][System.IO.FileSystemInfo]$Item)

  $targetValue = @($Item.Target) | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace([string]$targetValue)) { return "" }
  return ConvertTo-AgentFullPath -Path ([string]$targetValue) -BasePath $Item.Parent.FullName
}

function Test-AgentJunction {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedTarget,
    [Parameter(Mandatory = $true)][string]$NonJunctionStatus,
    [string]$MissingStatus = "junction-missing"
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return New-AgentValidationResult -Status $MissingStatus -Path $Path -Expected $ExpectedTarget -Reason "path is missing"
  }
  $item = Get-Item -Force -LiteralPath $Path
  $isReparsePoint = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  $linkType = if ($item.PSObject.Properties.Name -contains "LinkType") { [string]$item.LinkType } else { "" }
  if (-not $isReparsePoint -or $linkType -ne "Junction") {
    return New-AgentValidationResult -Status $NonJunctionStatus -Path $Path -Expected $ExpectedTarget -Actual $linkType -Reason "path is not an NTFS Junction"
  }
  $actualTarget = Get-AgentLinkTarget -Item $item
  $expectedFull = ConvertTo-AgentFullPath -Path $ExpectedTarget
  if (-not $actualTarget.Equals($expectedFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return New-AgentValidationResult -Status "junction-target-mismatch" -Path $Path -Expected $expectedFull -Actual $actualTarget -Reason "Junction target does not match manifest"
  }
  return New-AgentValidationResult -Status "junction-ok" -Path $Path -Expected $expectedFull -Actual $actualTarget -Reason "Junction target matches manifest"
}

function Test-AgentWorkspaceContext {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object]$Context)

  $results = New-Object System.Collections.Generic.List[object]
  if (-not [string]::IsNullOrWhiteSpace([string]$Context.manifestError)) {
    $results.Add((New-AgentValidationResult -Status "manifest-invalid" -Path $Context.manifestPath -Actual $Context.manifestError -Reason "capability manifest is not valid JSON"))
    return $results.ToArray()
  }

  if ($Context.mode -eq "workspace-overlay") {
    $manifestProperties = @($Context.manifest.PSObject.Properties.Name)
    if (($manifestProperties -contains "schemaVersion") -and ([int]$Context.manifest.schemaVersion -ne 1)) {
      $results.Add((New-AgentValidationResult -Status "schema-version-unsupported" -Path $Context.manifestPath -Expected "1" -Actual ([string]$Context.manifest.schemaVersion) -Reason "unsupported capability manifest schema"))
      return $results.ToArray()
    }
    $manifestProblems = @(Get-AgentManifestProblems -Manifest $Context.manifest)
    if ($manifestProblems.Count -gt 0) {
      $results.Add((New-AgentValidationResult -Status "manifest-invalid" -Path $Context.manifestPath -Actual ($manifestProblems -join "; ") -Reason "capability manifest violates schemaVersion 1 contract"))
      return $results.ToArray()
    }
  }

  $results.Add((New-AgentValidationResult -Status "workspace-context-resolved" -Path $Context.workspaceRoot -Expected $Context.mode -Actual $Context.mode -Reason "workspace context resolved"))

  if (-not (Test-Path -LiteralPath $Context.capabilityRoot -PathType Container)) {
    $results.Add((New-AgentValidationResult -Status "capability-root-missing" -Path $Context.capabilityRoot -Reason "CapabilityRoot directory is missing"))
  }
  elseif (-not (Test-Path -LiteralPath (Join-Path $Context.capabilityRoot ".git"))) {
    $results.Add((New-AgentValidationResult -Status "capability-git-missing" -Path $Context.capabilityRoot -Expected (Join-Path $Context.capabilityRoot ".git") -Reason "CapabilityRoot is not a Git deployment"))
  }

  foreach ($source in @($Context.sourceRoots)) {
    if (-not (Test-Path -LiteralPath $source.target -PathType Container)) {
      $results.Add((New-AgentValidationResult -Status "source-root-missing" -Path $source.target -Expected $source.name -Reason "declared source target is missing"))
    }
    if (-not (Test-Path -LiteralPath $source.gitRoot -PathType Container)) {
      $results.Add((New-AgentValidationResult -Status "git-root-missing" -Path $source.gitRoot -Expected $source.name -Reason "declared GitRoot is missing"))
    }
    if ($Context.mode -eq "workspace-overlay") {
      $results.Add((Test-AgentJunction -Path $source.path -ExpectedTarget $source.target -NonJunctionStatus "source-path-not-junction" -MissingStatus "source-path-missing"))
    }
  }

  if ($Context.mode -eq "workspace-overlay") {
    foreach ($shared in @($Context.sharedDirectories)) {
      $results.Add((Test-AgentJunction -Path $shared.path -ExpectedTarget $shared.target -NonJunctionStatus "shared-path-not-junction" -MissingStatus "shared-path-missing"))
    }
    foreach ($local in @($Context.localDirectories)) {
      if (-not (Test-Path -LiteralPath $local.path)) {
        $results.Add((New-AgentValidationResult -Status "local-path-missing" -Path $local.path -Reason "local directory is missing"))
        continue
      }
      $item = Get-Item -Force -LiteralPath $local.path
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $results.Add((New-AgentValidationResult -Status "local-path-is-link" -Path $local.path -Actual ([string]$item.LinkType) -Reason "local directory must be physical"))
      }
      elseif (-not $item.PSIsContainer) {
        $results.Add((New-AgentValidationResult -Status "local-path-not-directory" -Path $local.path -Reason "local path must be a directory"))
      }
      else {
        $results.Add((New-AgentValidationResult -Status "local-path-ok" -Path $local.path -Reason "local directory is physical"))
      }
    }
  }

  return $results.ToArray()
}

function Resolve-AgentGitRoot {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Context,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $pathFull = ConvertTo-AgentFullPath -Path $Path
  $matches = @($Context.sourceRoots | Where-Object { Test-AgentPathWithin -Path $pathFull -Root $_.target } | Sort-Object { $_.target.Length } -Descending)
  if ($matches.Count -eq 0) {
    throw ("Path is not inside a declared source root: " + $pathFull)
  }
  return $matches[0]
}

Export-ModuleMember -Function Resolve-AgentWorkspaceContext, Test-AgentWorkspaceContext, Resolve-AgentGitRoot
