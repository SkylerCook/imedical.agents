$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js"
$compileScript = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/iris-tools/compile.js"
$compilePathResolver = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/iris-tools/compile-paths.js"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Equals {
  param(
    [object]$Actual,
    [object]$Expected,
    [string]$Message
  )
  if ($Actual -ne $Expected) {
    throw "$Message Actual=[$Actual] Expected=[$Expected]"
  }
}

function Assert-Contains {
  param(
    [string]$Content,
    [string]$Expected,
    [string]$Message
  )
  if (-not $Content.Contains($Expected)) {
    throw $Message
  }
}

Assert-True (Test-Path -LiteralPath $scriptUnderTest -PathType Leaf) "prepare-deploy-manifest.js should exist"
& node --check $compileScript
Assert-Equals $LASTEXITCODE 0 "compile.js syntax should be valid"
& node --check $compilePathResolver
Assert-Equals $LASTEXITCODE 0 "compile path resolver syntax should be valid"

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("iris-deploy-manifest-test-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  New-Item -ItemType Directory -Force -Path (Join-Path $testRoot ".agents/config") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $testRoot "src/Sample/Package") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $testRoot "frontend/csp") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $testRoot "frontend/scripts") | Out-Null

  Set-Content -Encoding UTF8 -Path (Join-Path $testRoot ".agents/config/project-env.json") -Value @(
    "{",
    '  "iris": { "namespace": "TEST-NS" },',
    '  "web": {',
    '    "basePath": "imedical/web",',
    '    "cspBasePath": "imedical/web/csp"',
    "  }",
    "}"
  )
  Set-Content -Encoding UTF8 -Path (Join-Path $testRoot "src/Sample/Package/Order.cls") -Value "Class Sample.Package.Order Extends %Persistent {}"
  Set-Content -Encoding UTF8 -Path (Join-Path $testRoot "frontend/csp/order.page.csp") -Value "<html></html>"
  Set-Content -Encoding UTF8 -Path (Join-Path $testRoot "frontend/scripts/order.page.js") -Value "console.log('ok')"

  $json = & node $scriptUnderTest `
    --project-root $testRoot `
    --files "src/Sample/Package/Order.cls" "frontend/csp/order.page.csp" "frontend/scripts/order.page.js" | Out-String
  Assert-Equals $LASTEXITCODE 0 "Manifest generation should exit 0"

  $manifest = $json | ConvertFrom-Json
  Assert-Equals $manifest.schema "iris-deploy-manifest/v1" "Manifest schema should be stable"
  Assert-Equals $manifest.namespace "TEST-NS" "Manifest should read namespace from project-env"
  Assert-Equals $manifest.items.Count 3 "Manifest should include all requested files"

  $classItem = $manifest.items | Where-Object { $_.relativePath -eq "src/Sample/Package/Order.cls" }
  Assert-Equals $classItem.kind "iris-class" "CLS files should be classified as iris-class"
  Assert-Equals $classItem.documentName "Sample.Package.Order.cls" "CLS document name should derive from src path"
  Assert-Equals $classItem.requiresStorageStrip $true "Persistent class with Storage risk should request Storage strip check"

  $cspItem = $manifest.items | Where-Object { $_.relativePath -eq "frontend/csp/order.page.csp" }
  Assert-Equals $cspItem.kind "csp" "CSP files should be classified as csp"
  Assert-Equals $cspItem.virtualPath "imedical/web/csp/order.page.csp" "CSP virtual path should use web.cspBasePath"

  $jsItem = $manifest.items | Where-Object { $_.relativePath -eq "frontend/scripts/order.page.js" }
  Assert-Equals $jsItem.kind "web-asset" "JS files should be classified as web-asset"
  Assert-Equals $jsItem.webPath "imedical/web/scripts/order.page.js" "Web asset path should use web.basePath"

  $overlayRoot = Join-Path $testRoot "overlay"
  $backendRepo = Join-Path $testRoot "backend-repo"
  $frontendRepo = Join-Path $testRoot "frontend-repo"
  New-Item -ItemType Directory -Force -Path (Join-Path $overlayRoot ".agents/config"), (Join-Path $backendRepo "src"), (Join-Path $frontendRepo "src") | Out-Null
  Copy-Item -LiteralPath (Join-Path $testRoot ".agents/config/project-env.json") -Destination (Join-Path $overlayRoot ".agents/config/project-env.json")
  foreach ($repo in @($backendRepo, $frontendRepo)) {
    & git -C $repo init -q
    [System.IO.File]::WriteAllText((Join-Path $repo "src/same.js"), "console.log('base')", [System.Text.UTF8Encoding]::new($false))
    & git -C $repo add src/same.js
    & git -C $repo -c user.name=tests -c user.email=tests@example.invalid commit -q -m baseline
    [System.IO.File]::WriteAllText((Join-Path $repo "src/same.js"), "console.log('changed')", [System.Text.UTF8Encoding]::new($false))
  }
  $overlayManifest = @{
    schemaVersion = 1
    mode = "workspace-overlay"
    workspace = "deploy-test"
    contextRoot = ".agents"
    capabilityRoot = $repoRoot
    sharedDirectories = @("plugins", "vendor", "skills")
    localDirectories = @("config", "rules", "memory", "work")
    sourceRoots = @(
      @{ name = "backend"; path = "backend"; target = $backendRepo; gitRoot = $backendRepo },
      @{ name = "frontend"; path = "frontend"; target = $frontendRepo; gitRoot = $frontendRepo }
    )
  }
  [System.IO.File]::WriteAllText((Join-Path $overlayRoot ".agents/capability.json"), ($overlayManifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
  $resolvedCompilePath = & node -e 'const resolver=require(process.argv[1]); console.log(JSON.stringify(resolver.resolveCompilePaths(process.argv[2], {workspaceRoot:process.argv[3], sourceRoot:{name:process.argv[5], path:process.argv[4]}})))' $compilePathResolver "backend/src/Sample/Package.cls" $overlayRoot (Join-Path $overlayRoot "backend") "backend" | ConvertFrom-Json
  Assert-Equals ($resolvedCompilePath.localPath -replace '\\','/') "src/Sample/Package.cls" "Overlay logical path must resolve inside the backend source target"
  Assert-Equals $resolvedCompilePath.docName "Sample.Package.cls" "Overlay compile target must not retain the logical backend/src prefix"
  $overlayJson = & node $scriptUnderTest --project-root $overlayRoot --from-git | Out-String
  Assert-Equals $LASTEXITCODE 0 "Multi-GitRoot manifest generation should exit 0"
  $overlayDeploy = $overlayJson | ConvertFrom-Json
  Assert-Equals $overlayDeploy.items.Count 2 "Same repository-relative path from two Git roots must not overwrite"
  $backendItem = $overlayDeploy.items | Where-Object { $_.sourceRoot -eq "backend" }
  $frontendItem = $overlayDeploy.items | Where-Object { $_.sourceRoot -eq "frontend" }
  Assert-Equals $backendItem.relativePath "backend/src/same.js" "Backend path must map to WorkspaceRoot logical path"
  Assert-Equals $frontendItem.relativePath "frontend/src/same.js" "Frontend path must map to WorkspaceRoot logical path"
  Assert-Equals ([System.IO.Path]::GetFullPath($backendItem.gitRoot)) ([System.IO.Path]::GetFullPath($backendRepo)) "Backend item must preserve GitRoot"
  Assert-Equals ([System.IO.Path]::GetFullPath($frontendItem.gitRoot)) ([System.IO.Path]::GetFullPath($frontendRepo)) "Frontend item must preserve GitRoot"
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

Write-Host "iris deploy manifest tests passed"
