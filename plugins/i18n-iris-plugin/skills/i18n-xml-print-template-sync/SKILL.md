---
name: i18n-xml-print-template-sync
description: Discover, export, verify, translate, and write back IRIS XML print templates for target-language variants such as EN. Use when a print i18n task involves PrintTemp, PreviewXMLName, GetXMLTemplateId, User.DHCXMLPConfig, or creating {Template}-EN XML print templates.
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
2. `.agents/plugins/i18n-iris-plugin/skills/i18n-xml-template/SKILL.md`
3. `.agents/plugins/i18n-iris-plugin/rules/i18n_translation_quality.md`
4. Target module code/config that produces `PrintTemp`, `PreviewXMLName`, or calls `GetXMLTemplateId(...)`.

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
6. Run `-Apply` only when the user explicitly asks to write server records.
7. Run `-VerifyOnly` again after apply.

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
