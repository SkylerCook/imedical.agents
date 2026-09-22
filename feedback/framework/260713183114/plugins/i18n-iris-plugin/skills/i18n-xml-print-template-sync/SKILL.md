---
name: i18n-xml-print-template-sync
description: Use when a print i18n task is confirmed to involve IRIS XML print templates such as PrintTemp, PreviewXMLName, GetXMLTemplateId, User.DHCXMLPConfig, or creating {Template}-EN variants.
---

# XML Print Template Sync

Use this skill to coordinate the server-side XML print template workflow:

```text
IRIS User.DHCXMLPConfig source template
  -> export XPC_FileData to references/xmlPrintTemp/
  -> translate visible defaultvalue text with i18n-xml-template
  -> write {Template}-{LANG} back to User.DHCXMLPConfig
  -> verify metadata, XML parseability, and Chinese defaultvalue residue
```

## Required Context

Read these before acting:

1. `.agents/config/i18n_project_profile.md`
2. Target module code/config that produces `PrintTemp`, `PreviewXMLName`, or calls `GetXMLTemplateId(...)`.

Read these only when the condition applies:

- Before triggering this skill from a broader print i18n task, read `i18n_link_tracing.md` and confirm the actual rendering path is an XML template.
- Before translating exported XML content, read `.agents/plugins/i18n-iris-plugin/skills/i18n-xml-template/SKILL.md`.
- Before generating target-language text, read `.agents/plugins/i18n-iris-plugin/rules/i18n_translation_quality.md`.
- Before server read/write, read `.mcp.json` and verify the concrete MCP capability names available in the current session.

Do not store server addresses, accounts, passwords, tokens, namespaces, or remote paths in plugin files.

## Trigger Rules

Use this skill when:

- The user asks to create or verify XML print template language variants such as `Template-EN`.
- A print i18n request says print documents do not support multiple languages.
- Investigation finds `PrintTemp`, `PreviewXMLName`, `GetXMLName(PrintType)`, `GetXMLTemplateId(PrintTemp)`, or `DHCDoc.OPDoc.TreatPrint`.
- The user provides one or more template codes manually.

**前置约束**：必须先通过 `i18n_link_tracing.md` 的链路定位确认实际渲染路径为 XML 模板，才能触发本 skill。不要把本 skill 作为所有打印 i18n 的默认入口。

This skill only handles XML template records. Backend print fixed Chinese text is a separate code i18n task.

## Script

Run from the target project root:

```powershell
.agents/plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1 `
  -TemplateNames NewDHCDocOrderDirectPrint `
  -TargetLanguage EN `
  -ObjectScriptToolName iris_execute
```

Useful modes:

```powershell
# Read-only metadata and residue report.
.agents/plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1 `
  -TemplateNames NewDHCDocOrderDirectPrint `
  -TargetLanguage EN `
  -ObjectScriptToolName iris_execute `
  -VerifyOnly

# Discover static outpatient overview print templates from config.
.agents/plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1 `
  -DiscoverFromConfig `
  -TargetLanguage EN `
  -ObjectScriptToolName iris_execute `
  -VerifyOnly

# Discover actual runtime templates from captured print JSON.
.agents/plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1 `
  -DiscoverFromPrintJson docs/xmlPrintTemp/sample-print-data.json `
  -TargetLanguage EN `
  -ObjectScriptToolName iris_execute `
  -VerifyOnly

# Write only after translated files exist under docs/xmlPrintTemp/.
.agents/plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1 `
  -TemplateNames NewDHCDocOrderDirectPrint `
  -TargetLanguage EN `
  -ObjectScriptToolName iris_execute `
  -Apply

# Overwrite existing target template and back it up first.
.agents/plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1 `
  -TemplateNames NewDHCDocOrderDirectPrint `
  -TargetLanguage EN `
  -ObjectScriptToolName iris_execute `
  -Apply `
  -Overwrite
```

`-Apply` 默认先沿用兼容的单次内联保存。若 MCP 内层返回临时类
`Execute+...<SYNTAX>`，脚本会自动切换为分块 fallback；可通过
`-ApplyChunkSize` 调整 Base64 分块大小，默认每块 `6000` 个字符。

## Workflow

1. Identify templates from one or more sources:
   - Explicit `-TemplateNames`.
   - `-DiscoverFromConfig` for outpatient overview static `PreviewXMLName`.
   - `-DiscoverFromPrintJson` for actual runtime `PrintTemp`.
2. Run `-VerifyOnly` first to check whether `{Template}-{LANG}` already exists and whether metadata is complete.
3. Run dry-run export to create:
   - `references/xmlPrintTemp/{Template}.txt`
   - `docs/xmlPrintTemp/sync-xml-print-template-manifest.json`
   - `docs/xmlPrintTemp/sync-xml-print-template-prompt.md`
4. Use `i18n-xml-template` to generate `docs/xmlPrintTemp/{Template}-{LANG}.txt`.
5. Review generated XML:
   - XML parses.
   - Only user-visible `defaultvalue` text changed.
   - `defaultvalue` source-language residue is acceptable or zero.
   - Font names, coordinates, barcodes, variables, and printer settings are preserved.
6. Run `-Apply` only with explicit authorization for the current run. The Coordinator should request this authorization at workflow startup; if the run manifest already covers the target language and template scope, consume it without asking again.
   - New target templates may use the startup `translation-data-write` authorization.
   - `-Overwrite`, environment changes, deletion, or rollback always require a new confirmation.
7. Run `-VerifyOnly` again after apply.

## Apply Failure Convergence

When the source query, export, and local translation have succeeded but server save fails, preserve all completed local artifacts. Do not restart discovery, export, or translation.

- Inspect the MCP tool's inner stdout/status, not only the outer transport result.
- A generated temporary class error such as `Execute+...<SYNTAX>` is an ObjectScript payload compilation failure, not an MCP transport failure.
- If the failing payload embeds a complete XML document or Base64 string, do not repeatedly retry equivalent long inline code. One retry is allowed only for an obvious, bounded quoting defect; otherwise converge immediately.
- Prefer a project-provided template save API when one is already available and verified for the target record type.
- Otherwise use the script's automatic chunked fallback: it splits the Base64 payload across multiple short MCP calls into `^CacheTemp`, keyed by a unique task token. One final short `iris_execute` call validates the chunk count, concatenates, decodes, and saves the target record. The script cleans the task node in `finally`, including save failures.
- Reuse the existing translated XML, manifest, and overwrite backup. Do not regenerate them during the save fallback.
- After a successful fallback save, perform one read-only metadata query/export and complete XML parse/residue verification. Do not repeat the earlier discovery and translation stages.

Offline regression coverage is in
`scripts/tests/sync-xml-print-template.Tests.ps1`. It verifies normal inline save,
single-attempt convergence after temporary `<SYNTAX>`, chunk count, and cleanup on
both successful and failed fallback saves.

Do not record the temporary Global key, namespace, server details, or payload contents in reusable rules or reports.

## Write-Back Rules

The target record is written to `User.DHCXMLPConfig` with:

```text
XPC_Flag        = {SourceTemplate}-{LANG}
XPC_Note1       = {Source XPC_Note1}({LanguageDisplayName})
XPC_Note2       = ""
XPC_Lang_Code   = EN
XPC_Origin_Flag = {SourceTemplate}
XPC_FileData    = translated XML stream
```

Existing target records are not overwritten unless `-Overwrite` is passed. Overwrite mode must back up the old target XML to `docs/xmlPrintTemp/backups/`.

Language display names are resolved by the script. The mapping comes from `.agents/config/i18n_project_profile.md` 的语言目录（服务器 `^SS("LAN",id)` 实际数据）。脚本默认读取 `-I18nProfilePath .agents/config/i18n_project_profile.md`，必要时可显式传入其它 profile 路径。不在本文件硬编码语言列表，避免两处维护。

profile 不存在或未在语言目录中找到的语言 code 使用大写形式作为 display name。

If non-visible Chinese system fields such as `fontname="宋体"` become mojibake through MCP UTF-8 transport, use XML numeric entities such as `fontname="&#23435;&#20307;"` to preserve the same XML value without storing raw Chinese bytes.

## Verification Requirements

Before reporting success, state:

- Source template and target template names.
- Target record ID when available.
- Metadata values for `XPC_Lang_Code` and `XPC_Origin_Flag`.
- XML parse result.
- `defaultvalue` source-language residue count.
- Whether layout files or backup files were generated.
