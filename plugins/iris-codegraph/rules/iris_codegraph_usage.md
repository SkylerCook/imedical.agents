---
name: iris_codegraph_usage
description: Use iris-codegraph for local IRIS/ObjectScript graph build and query, while preserving IRIS source, MCP, compile, and runtime verification boundaries.
task-affinity:
  - iris
  - objectscript
  - codegraph
  - impact-analysis
  - caller-callee
related:
  - .agents/plugins/iris-codegraph/skills/iris-codegraph/SKILL.md
  - .agents/plugins/iris-codegraph/schema.md
---

# IRIS CodeGraph Usage

## Purpose

`iris-codegraph` builds and queries a local SQLite graph at `.iris-codegraph/iris-codegraph.db` for IRIS/ObjectScript backend code. It complements frontend CodeGraph and does not replace IRIS coding rules, MCP facts, source inspection, compile, or runtime validation.

## Build Prerequisites

- `coding-iris-plugin` is enabled and its IRIS export tooling is available.
- `.mcp.json` exists in the target project and contains the actual IRIS connection facts.
- Class source has been exported to `.iris-codegraph-cache/` with `export-batch.js`.
- Python 3 is available for SQLite write and fallback query execution.

Example export:

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export-batch.js --module <module> --categories CLS
```

Build the graph:

```powershell
node .agents/plugins/iris-codegraph/scripts/iris-codegraph-build.js
```

## Query Commands

```powershell
node .agents/plugins/iris-codegraph/scripts/icg-query.js stats
node .agents/plugins/iris-codegraph/scripts/icg-query.js search <keyword>
node .agents/plugins/iris-codegraph/scripts/icg-query.js class <class-name-or-id>
node .agents/plugins/iris-codegraph/scripts/icg-query.js method <class-name>::<method-name>
node .agents/plugins/iris-codegraph/scripts/icg-query.js callers <name-or-id>
node .agents/plugins/iris-codegraph/scripts/icg-query.js callees <name-or-id>
node .agents/plugins/iris-codegraph/scripts/icg-query.js impact <class-name-or-file>
```

Set `ICG_DB` only when the database is not at `.iris-codegraph/iris-codegraph.db`.

## Known Limits

The current version recognizes class, method, property, and parameter nodes plus `contains`, `extends`, and static `##class(Package.Class).Method()` calls.

It does not fully cover dynamic dispatch, `$classmethod`, routines, macros, Global reads/writes, embedded SQL, CSP `#server()`, REST routing, generated code, or runtime injection.

## Verification Boundary

Treat graph output as candidate evidence. For final conclusions, read the actual `.cls`, `.csp`, `.mac`, `.inc`, config, or related source files and cite concrete paths and line numbers.

When changing code, distinguish:

- graph-derived candidates
- source-confirmed facts
- compile/runtime/UI verification still required

Do not write server address, namespace, credentials, tokens, or remote paths into this plugin or its generated graph notes.
