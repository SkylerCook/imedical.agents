---
name: codegraph_query_usage
description: Use CodeGraph SQLite queries as candidate evidence for indexed frontend or script-side code paths, then verify against source and tests.
task-affinity:
  - codegraph
  - caller-callee
  - impact-analysis
  - frontend-code-location
related:
  - .agents/plugins/codegraph-query/skills/codegraph-query/SKILL.md
---

# CodeGraph Query Usage

## When To Use

Use `codegraph-query` when a task involves indexed frontend or script-side symbol location, caller/callee lookup, route discovery, or initial impact analysis from `.codegraph/codegraph.db`.

Before relying on results, run:

```powershell
codegraph status --json .
```

Confirm the index is initialized, complete, and has no pending changes. If the index is stale, run the normal CodeGraph sync path before querying.

## Commands

Run from the project root:

```powershell
node .agents/plugins/codegraph-query/scripts/cg-query.js stats
node .agents/plugins/codegraph-query/scripts/cg-query.js search <keyword>
node .agents/plugins/codegraph-query/scripts/cg-query.js file <path>
node .agents/plugins/codegraph-query/scripts/cg-query.js show <name-or-id>
node .agents/plugins/codegraph-query/scripts/cg-query.js callers <name>
node .agents/plugins/codegraph-query/scripts/cg-query.js callees <name>
node .agents/plugins/codegraph-query/scripts/cg-query.js impact <path>
node .agents/plugins/codegraph-query/scripts/cg-query.js routes [keyword]
```

Set `CG_DB` only when the database is not at `.codegraph/codegraph.db`.

## Verification Boundary

CodeGraph output is candidate evidence. Final conclusions must cite real files and, when code changes are made, must be verified with the relevant tests or project-specific checks.

Do not treat missing callers as proof that no callers exist. Check language coverage, ignored files, dynamic calls, generated files, configuration, and source text.

For IRIS/ObjectScript, CSP server code, macros, Globals, embedded SQL, or remote IRIS behavior, use IRIS coding rules, `iris-codegraph` when available, MCP tools, `rg`, source inspection, compile, and runtime verification as appropriate.
