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
const fs = require("fs");
const os = require("os");
const path = require("path");
const helper = require(process.argv[2]);

const argsDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-mcp-args-"));
try {
  const argsFile = path.join(argsDir, "large.json");
  const expectedArgs = { code: "x".repeat(40000), confirmed: true };
  fs.writeFileSync(argsFile, JSON.stringify(expectedArgs), "utf8");
  assert.deepStrictEqual(helper.parseToolArgsInput(null, argsFile), expectedArgs);
  assert.throws(() => helper.parseToolArgsInput("{}", argsFile), /either inline JSON or --json-file/);
} finally {
  fs.rmSync(argsDir, { recursive: true, force: true });
}

const readCases = [
  ["capability_matrix", {}],
  ["compare_document", {}],
  ["compare_namespace", {}],
  ["global_preview", {}],
  ["hl7_schema_inspect", {}],
  ["hl7_schema_list", {}],
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
  ["iris_doc_search", { query: "SQLCODE -30" }],
  ["iris_database_list", {}],
  ["iris_database_stats", {}],
  ["iris_namespace_list", {}],
  ["iris_servers", {}],
  ["iris_test_server", {}],
  ["journal_search", {}],
  ["mermaid_class", {}],
  ["mermaid_production", {}],
  ["my_access", {}],
  ["query_audit_log", {}],
  ["resolve_storage", {}],
  ["stream_inspect", {}]
];

const writeCases = [
  ["global_kill", {}],
  ["iris_add_server", {}],
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
  ["iris_import_servers", {}],
  ["iris_namespace_create", {}],
  ["iris_remove_server", {}],
  ["iris_test", {}],
  ["iris_ws_close", {}],
  ["iris_ws_exec", {}],
  ["iris_ws_open", {}],
  ["iris_credential_manage", {}],
  ["skill_community_install", {}],
  ["skill_forget", {}],
  ["skill_optimize", {}],
  ["skill_propose", {}],
  ["skill_share", {}],
  ["future_unclassified_tool", {}]
];

const bundledV126Tools = [
  "agent_history", "agent_stats", "capability_matrix", "check_config", "compare_document",
  "compare_namespace", "docs_introspect", "extract_message_map_routing", "find_subclass_implementations",
  "global_kill", "global_preview", "hl7_schema_inspect", "hl7_schema_list", "iris_add_server",
  "iris_admin", "iris_business_rule_info", "iris_compile", "iris_containers", "iris_coverage",
  "iris_credential_list", "iris_credential_manage", "iris_database_list", "iris_database_stats",
  "iris_debug", "iris_doc", "iris_doc_search", "iris_execute", "iris_execute_method", "iris_generate",
  "iris_generate_class", "iris_generate_test", "iris_get_log", "iris_global", "iris_import_servers",
  "iris_info", "iris_interop_query", "iris_lookup_manage", "iris_lookup_transfer", "iris_macro",
  "iris_message_body", "iris_namespace_create", "iris_namespace_list", "iris_production",
  "iris_production_diff", "iris_production_item", "iris_query", "iris_remove_server", "iris_search",
  "iris_servers", "iris_source_control", "iris_symbols", "iris_symbols_local", "iris_table_info",
  "iris_test", "iris_test_server", "iris_ws_close", "iris_ws_exec", "iris_ws_open", "journal_search",
  "kb", "kb_index", "kb_recall", "mermaid_class", "mermaid_production", "my_access",
  "query_audit_log", "resolve_dynamic_dispatch", "resolve_storage", "skill", "skill_community",
  "skill_community_list", "skill_describe", "skill_forget", "skill_list", "skill_search",
  "stream_inspect", "telemetry_export_trace", "telemetry_query"
];
assert.strictEqual(bundledV126Tools.length, 78);
for (const tool of bundledV126Tools) {
  assert.strictEqual(helper.isClassifiedTool(tool), true, `${tool} should have an explicit v1.2.6 policy classification`);
}
assert.strictEqual(helper.isClassifiedTool("future_unclassified_tool"), false);

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
assert.strictEqual(summary.destructiveToolsEnabled, null);
assert.strictEqual(summary.serverVersion, null);
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
Assert-True ($helpOutput.Contains("--json-file")) "iris-mcp.js help should explain file-based tool arguments"

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
  Assert-True ($toolsOutput.Contains("capability_matrix")) "tools output should include v1.2.6 capability_matrix"
  Assert-True ($toolsOutput.Contains("compare_namespace")) "tools output should include v1.2.6 compare_namespace"
  $toolsLine = @($toolsOutput -split "`r?`n" | Where-Object { $_.StartsWith("TOOLS=") })[-1]
  $toolNames = @()
  foreach ($toolName in ($toolsLine.Substring(6) | ConvertFrom-Json)) { $toolNames += $toolName }
  Assert-True ($toolNames.Count -eq 67) "default --no-skills toolset should expose 67 tools"
  Assert-True (-not ($toolNames -contains "skill_list")) "default helper toolset should omit built-in skill tools"

  $skillsEnabledConfig = $mcpConfig | ConvertFrom-Json
  $skillsEnabledConfig.mcpServers."iris-agentic-dev".env | Add-Member -NotePropertyName IRIS_NO_SKILLS -NotePropertyValue "false"
  [System.IO.File]::WriteAllText(
    (Join-Path $testRoot ".mcp.json"),
    ($skillsEnabledConfig | ConvertTo-Json -Depth 8),
    (New-Object System.Text.UTF8Encoding($false))
  )
  Push-Location $testRoot
  try {
    $skillsEnabledOutput = & node $helperPath tools 2>&1 | Out-String
  } finally {
    Pop-Location
  }
  Assert-True ($LASTEXITCODE -eq 0) "tools should support explicit built-in skill opt-in"
  $skillsEnabledLine = @($skillsEnabledOutput -split "`r?`n" | Where-Object { $_.StartsWith("TOOLS=") })[-1]
  $skillsEnabledNames = @()
  foreach ($skillToolName in ($skillsEnabledLine.Substring(6) | ConvertFrom-Json)) { $skillsEnabledNames += $skillToolName }
  Assert-True ($skillsEnabledNames.Count -eq 78) "built-in skill opt-in should expose the full 78-tool v1.2.6 set"
  Assert-True ($skillsEnabledNames -contains "skill_list") "built-in skill opt-in should restore skill_list"
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

Write-Host "iris-mcp helper tests passed"
