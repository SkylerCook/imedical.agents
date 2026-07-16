# iris-external-reg

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
