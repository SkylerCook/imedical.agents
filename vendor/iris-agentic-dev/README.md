# iris-agentic-dev

This directory vendors the Windows x64 `iris-agentic-dev` MCP server used by IRIS/ObjectScript workflows.

## Layout

```text
vendor/iris-agentic-dev/
`-- windows-x64/
    `-- iris-agentic-dev.exe
```

In deployed business projects the executable is available at:

```text
.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe
```

Use that path as the `command` in the target project's `.mcp.json`, or as `mcp.serverPath` in `.agents/config/project-env.json` when generating `.mcp.json` with `sync-env-config.js`.

Do not store IRIS hosts, namespaces, usernames, passwords, tokens, TLS settings, or remote paths in this directory. Those connection facts belong only in the target project's local `.mcp.json` or equivalent private environment variables.
