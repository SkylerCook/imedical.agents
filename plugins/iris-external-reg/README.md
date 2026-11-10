# iris-external-reg

For help requests (`--help`, show usage), all skills owned by this plugin follow the [shared help protocol](../../docs/guides/capability-help.md) and stop before enablement, connection checks, or business preconditions. Normal capability updates distribute the source definitions; existing thin indexes continue reading their source. Help does not enable the plugin.

`iris-external-reg` is a reusable workflow for IRIS third-party appointment registration integrations.

It packages the former `skills/iris-external-reg` capability as a normal `.agents` plugin:

- document handoff through `extract-doc`
- execution plan generation for RegInterface work
- implementation rules for `DHCDoc.Interface.Outside.RegInterface`
- reference material for `DHCExternalService.RegInterface`
- JSON/XML conversion notes and verification guidance

## Dependencies

- `extract-doc`: document conversion and structured local artifacts
- `coding-iris-plugin`: IRIS/ObjectScript coding, review, upload, compile, deployment, and remote verification workflows

## Standard Layout

```text
iris-external-reg/
|-- .agents-plugin/
|-- AGENTS.md
|-- README.md
|-- rules/
|-- references/
|-- skills/
`-- scripts/
```

## Main Skill

Read the real skill before using this plugin:

```text
.agents/plugins/iris-external-reg/skills/iris-external-reg/SKILL.md
```

Project-side discovery is exposed through the thin-index generated at:

```text
.agents/skills/iris-external-reg/SKILL.md
```

## Document Ingestion

Use `extract-doc` for source documents:

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file <document-path> --strict
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file <document-path> `
  --project-root . `
  --output-root docs/output/iris-external-reg `
  --schema-version iris-external-reg/v1
```

Only report artifact paths and extraction diagnostics in conversation. Do not paste the full converted document.

## Activation and updates

Existing projects receive this plugin through the normal `.agents/scripts/update-agents.ps1` flow, but the directory is only `available` until initialization is complete. Use `project-context-maintenance` to initialize and enable `extract-doc` and `coding-iris-plugin` first, then validate this plugin and run `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin iris-external-reg -Status enabled`. Re-run the updater to generate its rule and skill thin-index entries.

项目知识库接入后，文档摄取复用 extract-doc 的目录声明；已有显式输出保持。目录及授权见[项目知识库目录治理](../../docs/guides/project-knowledge-layout.md)。
