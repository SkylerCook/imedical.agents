$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptUnderTest = Join-Path $repoRoot "plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js"

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
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

Write-Host "iris deploy manifest tests passed"
