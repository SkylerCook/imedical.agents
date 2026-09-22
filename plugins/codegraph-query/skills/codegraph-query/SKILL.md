---
name: codegraph-query
description: Use when querying an existing .codegraph/codegraph.db index for indexed symbol lookup, caller/callee checks, route lookup, or first-pass impact analysis.
---

# CodeGraph Query

## Required Context

1. Read `.agents/plugins/codegraph-query/rules/codegraph_query_usage.md`.
2. Run `codegraph status --json .` from the project root.
3. Confirm `initialized=true`, `index.state=complete`, and `pendingChanges` are empty before using query output as evidence.

If the index is stale, sync it with the normal CodeGraph CLI before continuing.

## Query Flow

Use the narrowest command that answers the current question:

```powershell
node .agents/plugins/codegraph-query/scripts/cg-query.js stats
node .agents/plugins/codegraph-query/scripts/cg-query.js search <keyword>
node .agents/plugins/codegraph-query/scripts/cg-query.js show <name-or-id>
node .agents/plugins/codegraph-query/scripts/cg-query.js callers <name>
node .agents/plugins/codegraph-query/scripts/cg-query.js callees <name>
node .agents/plugins/codegraph-query/scripts/cg-query.js impact <path>
node .agents/plugins/codegraph-query/scripts/cg-query.js routes [keyword]
```

Open the source files reported by the query before stating a conclusion. For broad impact questions, combine CodeGraph results with `rg`, project config, and tests.

## Output Requirements

When reporting results:

- State the CodeGraph index status and covered languages.
- Distinguish graph-derived candidates from source-confirmed facts.
- Cite source file paths and line numbers for final conclusions.
- Mention test or runtime verification separately.

Do not use this skill as the sole evidence for ObjectScript, CSP server code, macros, Globals, embedded SQL, dynamic calls, or remote IRIS behavior.
