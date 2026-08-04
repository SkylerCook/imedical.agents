---
name: iris-codegraph
description: Use when building or querying the local IRIS/ObjectScript code graph for class, method, caller/callee, or impact analysis.
---

# IRIS CodeGraph

## Required Context

1. Read `.agents/plugins/iris-codegraph/rules/iris_codegraph_usage.md`.
2. Read `.agents/plugins/iris-codegraph/schema.md` when schema fields or edge meanings matter.
3. Confirm `coding-iris-plugin` is enabled in `.agents/config/plugin_profile.md`.
4. Confirm `.mcp.json` exists before building. If it is missing, stop at local plugin/query validation and report that graph build needs MCP connection facts.

## Build Flow

If `.iris-codegraph-cache/` is missing or stale, export class source through `coding-iris-plugin`:

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export-batch.js --module <module> --categories CLS
```

Then build:

```powershell
node .agents/plugins/iris-codegraph/scripts/iris-codegraph-build.js
```

The build writes `.iris-codegraph/graph-data.json` and `.iris-codegraph/iris-codegraph.db`.

## Query Flow

Use the narrowest command needed:

```powershell
node .agents/plugins/iris-codegraph/scripts/icg-query.js stats
node .agents/plugins/iris-codegraph/scripts/icg-query.js search <keyword>
node .agents/plugins/iris-codegraph/scripts/icg-query.js class <class-name-or-id>
node .agents/plugins/iris-codegraph/scripts/icg-query.js method <class-name>::<method-name>
node .agents/plugins/iris-codegraph/scripts/icg-query.js callers <name-or-id>
node .agents/plugins/iris-codegraph/scripts/icg-query.js callees <name-or-id>
node .agents/plugins/iris-codegraph/scripts/icg-query.js impact <class-name-or-file>
```

Open source files reported by the graph before making a final claim.

## Reporting Requirements

State whether the graph was freshly built, reused, or unavailable. Distinguish graph candidates from source-confirmed facts and from compile/runtime verification.

For ObjectScript or CSP code changes, this skill does not replace `.agents/config/iris_project_profile.md`, `.mcp.json`, `.agents/rules/iris_coding_index.md`, IRIS compile, or runtime/UI validation.
