# codegraph-query

`codegraph-query` exposes a lightweight read-only CLI and Agent routing entries for querying `.codegraph/codegraph.db`.

## Capabilities

- Inspect CodeGraph statistics and language coverage.
- Search nodes by name or file path.
- Show node details.
- List callers and callees for indexed JavaScript/PHP/Python symbols.
- Estimate 1-hop upstream impact for a changed indexed file.
- List indexed route nodes when present.

## Usage

Run from the business project root:

```powershell
node .agents/plugins/codegraph-query/scripts/cg-query.js stats
node .agents/plugins/codegraph-query/scripts/cg-query.js search savePatient
node .agents/plugins/codegraph-query/scripts/cg-query.js callers savePatient
node .agents/plugins/codegraph-query/scripts/cg-query.js impact src/path/file.js
```

Use `CG_DB` to point to a non-default database:

```powershell
$env:CG_DB = "D:\path\to\codegraph.db"
node .agents/plugins/codegraph-query/scripts/cg-query.js stats
```

## Plugin Mode

The plugin follows `plugin-reference-thin-index`:

1. Keep the plugin under `.agents/plugins/codegraph-query/`.
2. Generate shallow entries under `.agents/rules/` and `.agents/skills/`.
3. Agents reading a thin-index must continue to the real source file under this plugin.

Generate entries after enabling the plugin:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/codegraph-query/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/codegraph-query `
  -ProjectRoot . `
  -Mode DryRun
```

Then rerun with `-Mode Write` when the dry-run has no conflicts.

## Boundary

This plugin does not create `.codegraph/codegraph.db`; it only queries an existing CodeGraph index. Run `codegraph status --json .` first and use the normal CodeGraph CLI to sync or rebuild when the index is stale.

CodeGraph coverage is not complete IRIS coverage. ObjectScript, CSP server code, macros, Globals, SQL side effects, dynamic calls, and remote behavior require source and IRIS/MCP verification.

## Deployed Projects

Existing projects get this plugin by updating `.agents`. The directory being present means `available` only. To expose the shallow rule and skill entries, enable the plugin in `.agents/config/plugin_profile.md` and rebuild the plugin thin-index.

`codegraph-query` depends on `iris-codegraph` for IRIS/ObjectScript graph coverage. If `iris-codegraph` is not enabled, keep this plugin available only.
