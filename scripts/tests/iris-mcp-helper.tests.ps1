$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$helperPath = Join-Path $repoRoot "scripts/iris-mcp.js"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

Assert-True (Test-Path -LiteralPath $helperPath -PathType Leaf) "iris-mcp.js helper is missing"
Assert-True ($null -ne (Get-Command node -ErrorAction SilentlyContinue)) "node is required for iris-mcp helper tests"

$nodeTest = @'
const assert = require("assert");
const helper = require(process.argv[2]);

const readCases = [
  ["iris_doc", {}],
  ["iris_doc", { mode: "fragment" }],
  ["iris_query", { mode: "read", query: "SELECT 1" }],
  ["iris_query", { mode: "read", query: "WITH x AS (SELECT 1) SELECT * FROM x" }],
  ["iris_query", { mode: "count", table: "Sample.Person" }],
  ["iris_query", { mode: "explain", query: "SELECT 1" }],
  ["iris_global", { action: "get" }],
  ["iris_global", { action: "list" }],
  ["iris_containers", { action: "list" }],
  ["iris_admin", { action: "list_users" }],
  ["iris_admin", { action: "database_status" }],
  ["iris_source_control", { action: "status" }],
  ["iris_source_control", { action: "menu" }],
  ["iris_lookup_manage", { action: "get" }],
  ["iris_lookup_manage", { action: "list_tables" }],
  ["iris_lookup_transfer", { action: "export" }],
  ["iris_production", { action: "status" }],
  ["iris_production", { action: "check" }],
  ["iris_production_item", { action: "get_settings" }],
  ["skill", { action: "list" }],
  ["skill", { action: "search" }],
  ["skill_community", { action: "list" }],
  ["kb", { action: "recall" }],
  ["iris_doc_search", { query: "SQLCODE -30" }]
];

const writeCases = [
  ["iris_doc", { mode: "put" }],
  ["iris_doc", { mode: "delete" }],
  ["iris_doc", { mode: "insert" }],
  ["iris_doc", { mode: "delete_lines" }],
  ["iris_query", { mode: "write", query: "UPDATE Sample.Person SET Name='x'" }],
  ["iris_query", { mode: "read", query: "DELETE FROM Sample.Person" }],
  ["iris_query", { mode: "read", query: "SELECT 1", force: true }],
  ["iris_global", { action: "set" }],
  ["iris_global", { action: "kill" }],
  ["iris_containers", { action: "select" }],
  ["iris_containers", { action: "start" }],
  ["iris_containers", { action: "unknown" }],
  ["iris_admin", { action: "create_user" }],
  ["iris_admin", { action: "unknown" }],
  ["iris_source_control", { action: "checkout" }],
  ["iris_source_control", { action: "execute" }],
  ["iris_lookup_manage", { action: "set" }],
  ["iris_lookup_manage", { action: "delete" }],
  ["iris_lookup_transfer", { action: "import" }],
  ["iris_production", { action: "start" }],
  ["iris_production", { action: "stop" }],
  ["iris_production", { action: "update" }],
  ["iris_production", { action: "recover" }],
  ["iris_production_item", { action: "enable" }],
  ["iris_production_item", { action: "disable" }],
  ["iris_production_item", { action: "set_settings" }],
  ["skill", { action: "forget" }],
  ["skill", { action: "propose" }],
  ["skill_community", { action: "install" }],
  ["kb", { action: "index" }],
  ["iris_compile", {}],
  ["iris_coverage", { mode: "check" }],
  ["iris_coverage", { mode: "run" }],
  ["iris_execute", {}],
  ["iris_execute_method", {}],
  ["iris_generate_class", {}],
  ["iris_generate_test", {}],
  ["iris_test", {}],
  ["iris_credential_manage", {}],
  ["skill_community_install", {}],
  ["skill_forget", {}],
  ["skill_optimize", {}],
  ["skill_propose", {}],
  ["skill_share", {}],
  ["future_unclassified_tool", {}]
];

for (const [tool, args] of readCases) {
  assert.strictEqual(helper.isWriteLike(tool, args), false, `${tool} should be read-like`);
}
for (const [tool, args] of writeCases) {
  assert.strictEqual(helper.isWriteLike(tool, args), true, `${tool} should require --allow-write`);
}

const summary = helper.summarizeCheck({
  connected: true,
  connection_source: "config_file",
  config_file: "workspace/.iris-agentic-dev.toml",
  host: "configured",
  namespace: "USER",
  port: 52773,
  objectscript_workspace: "workspace",
  write_tools_enabled: false,
  fallback_warning: "verify target",
  capabilities: {
    private_web_server: false,
    atelier_rest: false,
    compile_path: "docker_exec",
    webgateway_url: null
  }
});
assert.strictEqual(summary.connected, true);
assert.strictEqual(summary.connectionSource, "config_file");
assert.strictEqual(summary.workspaceHintLoaded, true);
assert.strictEqual(summary.capabilities.privateWebServer, false);
assert.strictEqual(summary.capabilities.atelierRest, false);
assert.strictEqual(summary.capabilities.compilePath, "docker_exec");
assert.strictEqual(summary.capabilities.webgatewayConfigured, false);
assert.deepStrictEqual(summary.warnings, ["verify target"]);

const disconnected = helper.summarizeCheck({ connected: false, capabilities: {} });
assert.strictEqual(disconnected.warnings.length, 1);
assert.match(disconnected.warnings[0], /not connected/);

console.log("node policy assertions passed");
'@

$nodeTestPath = Join-Path ([System.IO.Path]::GetTempPath()) ("iris-mcp-helper-policy-" + [System.Guid]::NewGuid().ToString("N") + ".js")
try {
  [System.IO.File]::WriteAllText(
    $nodeTestPath,
    $nodeTest,
    (New-Object System.Text.UTF8Encoding($false))
  )
  & node $nodeTestPath $helperPath
  Assert-True ($LASTEXITCODE -eq 0) "Node policy assertions failed"
} finally {
  if (Test-Path -LiteralPath $nodeTestPath -PathType Leaf) {
    Remove-Item -LiteralPath $nodeTestPath -Force
  }
}

$helpOutput = & node $helperPath --help 2>&1 | Out-String
Assert-True ($LASTEXITCODE -eq 0) "iris-mcp.js --help should not require .mcp.json"
Assert-True ($helpOutput.Contains("check")) "iris-mcp.js help should list check"
Assert-True ($helpOutput.Contains("--allow-write")) "iris-mcp.js help should explain --allow-write"

$exePath = Join-Path $repoRoot "vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe"
Assert-True (Test-Path -LiteralPath $exePath -PathType Leaf) "Bundled iris-agentic-dev.exe is missing"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("iris-mcp-helper-test-" + [System.Guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
try {
  $mcpConfig = @{
    mcpServers = @{
      "iris-agentic-dev" = @{
        command = $exePath
        env = @{
          IRIS_HOST = "127.0.0.1"
          IRIS_WEB_PORT = "1"
          IRIS_NAMESPACE = "USER"
        }
      }
    }
  } | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText(
    (Join-Path $testRoot ".mcp.json"),
    $mcpConfig,
    (New-Object System.Text.UTF8Encoding($false))
  )

  Push-Location $testRoot
  try {
    $toolsOutput = & node $helperPath tools 2>&1 | Out-String
  } finally {
    Pop-Location
  }

  Assert-True ($LASTEXITCODE -eq 0) "tools should remain available when the IRIS target is disconnected"
  Assert-True ($toolsOutput.Contains("CHECK=")) "tools output should include the check summary"
  Assert-True ($toolsOutput.Contains("TOOLS=")) "tools output should include the tool list"
  Assert-True ($toolsOutput.Contains("iris_coverage")) "tools output should include iris_coverage"
  Assert-True ($toolsOutput.Contains("iris_doc_search")) "tools output should include iris_doc_search"
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

Write-Host "iris-mcp helper tests passed"
