$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$pluginRoot = Join-Path $repoRoot "plugins/iris-interface-dev-plugin"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Contains {
  param(
    [string]$Content,
    [string]$Expected,
    [string]$Message
  )
  if (-not $Content.Contains($Expected)) {
    throw $Message
  }
}

function Assert-NotContains {
  param(
    [string]$Content,
    [string]$Unexpected,
    [string]$Message
  )
  if ($Content.Contains($Unexpected)) {
    throw $Message
  }
}

Assert-True (Test-Path -LiteralPath $pluginRoot -PathType Container) "iris-interface-dev-plugin should exist"

$manifestPath = Join-Path $pluginRoot ".agents-plugin/plugin.json"
Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) "plugin manifest should exist"
$manifest = Get-Content -Raw -Encoding UTF8 -Path $manifestPath | ConvertFrom-Json
Assert-True ($manifest.name -eq "iris-interface-dev-plugin") "manifest name should be iris-interface-dev-plugin"
Assert-True ($manifest.initSkill -eq "iris-interface-init") "manifest initSkill should be iris-interface-init"
Assert-True (($manifest.dependencies -contains "coding-iris-plugin")) "manifest should depend on coding-iris-plugin"

foreach ($skillName in @(
  "iris-interface-init",
  "iris-interface-doc-ingest",
  "iris-interface-field-match",
  "iris-interface-dev-plan"
)) {
  Assert-True (Test-Path -LiteralPath (Join-Path $pluginRoot "skills/$skillName/SKILL.md") -PathType Leaf) "missing skill $skillName"
}

foreach ($ruleName in @(
  "iris_interface_index.md",
  "iris_interface_workflow.md",
  "iris_interface_review.md"
)) {
  Assert-True (Test-Path -LiteralPath (Join-Path $pluginRoot "rules/$ruleName") -PathType Leaf) "missing rule $ruleName"
}

$largeRule = Get-ChildItem -LiteralPath (Join-Path $pluginRoot "rules") -File | Where-Object { $_.Length -gt 20000 } | Select-Object -First 1
Assert-True ($null -eq $largeRule) "rules/ should not contain large wiki-like files"

$optionalRequirementsPath = Join-Path $pluginRoot "requirements-optional.txt"
Assert-True (Test-Path -LiteralPath $optionalRequirementsPath -PathType Leaf) "requirements-optional.txt should exist"
$optionalRequirements = Get-Content -Raw -Encoding UTF8 -Path $optionalRequirementsPath
foreach ($packageName in @("python-docx", "pdfplumber", "openpyxl", "markitdown", "xlrd")) {
  Assert-Contains $optionalRequirements $packageName "requirements-optional.txt should include $packageName"
}
$thinIndexScript = Join-Path $pluginRoot "scripts/generate-plugin-thin-index.ps1"
Assert-True (Test-Path -LiteralPath $thinIndexScript -PathType Leaf) "thin-index wrapper should exist"
$thinIndexOutput = & $thinIndexScript -PluginPath $pluginRoot -ProjectRoot $repoRoot -Mode DryRun | Out-String
Assert-Contains $thinIndexOutput "iris_interface_index.md" "thin-index dry-run should include interface index rule"
Assert-Contains $thinIndexOutput "iris-interface-doc-ingest" "thin-index dry-run should include doc ingest skill"
Assert-NotContains $thinIndexOutput "candidate-assets.md" "references must not generate thin-index"
Assert-NotContains $thinIndexOutput "references/wiki" "wiki references must not generate thin-index"
Assert-True (Test-Path -LiteralPath (Join-Path $pluginRoot "scripts/iris-interface-env-check.py") -PathType Leaf) "env-check script should exist"
$envCheckScript = Join-Path $pluginRoot "scripts/iris-interface-env-check.py"
$envCheckOutput = python $envCheckScript --file "sample.pdf" --json | Out-String
Assert-Contains $envCheckOutput "pdfplumber" "env-check should report pdfplumber"
Assert-Contains $envCheckOutput "installCommand" "env-check should report install command"
$skillContent = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $pluginRoot "skills/iris-interface-doc-ingest/SKILL.md")
Assert-Contains $skillContent "iris-interface-env-check.py" "doc-ingest skill should tell users to run env check"
Assert-NotContains $skillContent "``r``n" "doc-ingest skill should not contain escaped newline text"
foreach ($fileTypeLabel in @("PDF：", "DOCX：", "XLSX：", "XLS：", "DOC：")) {
  Assert-Contains $skillContent $fileTypeLabel "doc-ingest skill should describe $fileTypeLabel handling"
}
Assert-Contains $skillContent "iris-interface-env-check.py" "doc-ingest skill should mention env-check script"
Assert-Contains $skillContent "多 sheet" "doc-ingest skill should mention XLSX multi-sheet handling"
Assert-NotContains $skillContent "把文档全文复制到会话上下文" "doc-ingest skill must not require copying full document text into context"
$parserBehaviorTest = @'
import importlib.util
import sys
from pathlib import Path

script = Path(r"__PLUGIN_ROOT__") / "scripts" / "iris-interface-doc-ingest.py"
spec = importlib.util.spec_from_file_location("iris_interface_doc_ingest", script)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

revision_rows = [
    ["\u65e5\u671f", "\u7248\u672c\u53f7", "\u4fee\u8ba2\u8bf4\u660e", "\u4fee\u8ba2\u4eba"],
    ["2024-03-05", "1.0.3", "1\u30013.1.5\u6dfb\u52a0\u7f3a\u6f0f\u5b57\u6bb5\u63cf\u8ff0\uff0c\u4fee\u6539\u91cd\u540d\u5b57\u6bb5\u3002", "\u5f20\u4e09"],
    ["2024-06-21", "1.1.0", "\u6dfb\u52a0\u53c2\u6570\uff1ahospitalCode\u7528\u4e8e\u63a5\u6536\u533b\u7597\u673a\u6784\u4ee3\u7801\u3002", "\u674e\u56db"],
]
revision_fields, _, _ = mod.parse_rows_to_fields(revision_rows)
assert revision_fields == [], "revision history table must not be parsed as interface fields"

error_code_rows = [['code', 'message', 'description'], ['-501', 'missing appID', 'missing appID parameter']]
error_code_fields, _, _ = mod.parse_rows_to_fields(error_code_rows)
assert error_code_fields == [], "error code table must not be parsed as interface fields"

continuation_rows = [
    ["\u5305\u88c5\u91cf", "*packageCount", "Y", "\u8bf7\u586b\u5165\u6570\u5b57\u5982 200\uff0c150,100\u3002"],
    ["\u64cd\u4f5c\u4eba\u5458", "operator", "N", ""],
]
fields, _, diagnostics = mod.parse_rows_to_fields(
    continuation_rows,
    inherited_headers=["\u63cf\u8ff0", "\u5b57\u6bb5\u540d\u79f0", "\u662f\u5426\u5fc5\u586b", "\u5b57\u6bb5\u8bf4\u660e"],
)
assert [field.code for field in fields] == ["*packageCount", "operator"], fields
assert fields[0].name == "\u5305\u88c5\u91cf"
assert fields[0].required == "Y"
assert not diagnostics, diagnostics

context = mod.PdfContext()
mod.update_pdf_context_from_text(
    context,
    "\u63a5\u53e3\u8bf4\u660e\n3\n\u5904\u65b9\u8ba2\u5355\u57fa\u672c\u4fe1\u606f\u63a8\u9001\u63a5\u53e3\n3.1\n3.1.5 \u53c2\u6570\u8bf4\u660e",
)
label = mod.pdf_context_label(context, "Page 14 Table 1")
assert label == "3.1 \u5904\u65b9\u8ba2\u5355\u57fa\u672c\u4fe1\u606f\u63a8\u9001\u63a5\u53e3 / 3.1.5 \u53c2\u6570\u8bf4\u660e / Page 14 Table 1", label

mod.update_pdf_context_from_text(context, "prescriptions \u53c2\u6570")
mod.enrich_fields_for_context(fields, context)
assert fields[0].jsonPath == "data.prescriptions.packageCount", fields[0].jsonPath
assert fields[0].requiredByMarker is True
assert fields[0].requiredMismatch is False
mismatch_fields, _, _ = mod.parse_rows_to_fields(
    [["\u63cf\u8ff0", "\u5b57\u6bb5\u540d\u79f0", "\u662f\u5426\u5fc5\u586b", "\u5b57\u6bb5\u8bf4\u660e"], ["\u6d4b\u8bd5", "*mustField", "N", ""]]
)
assert mismatch_fields[0].requiredMismatch is True

header_rows = [
    ["\u53c2\u6570\u540d", "\u4e2d\u6587\u540d", "\u7c7b\u578b", "\u5fc5\u586b", "\u8bf4\u660e"],
    ["X-GMAuth", "\u6388\u6743\u4fe1\u606f", "String", "Y", "\u7b7e\u540d"],
]
header_fields, _, header_diags = mod.parse_rows_to_fields(header_rows)
assert len(header_fields) == 1, header_fields
assert header_fields[0].code == "X-GMAuth", header_fields[0]
assert header_fields[0].name == "\u6388\u6743\u4fe1\u606f", header_fields[0]
assert not header_diags, header_diags

header_context = mod.PdfContext()
mod.update_pdf_context_from_text(header_context, "3.2 \u8bf7\u6c42\u5934\u516c\u5171\u53c2\u6570")
mod.enrich_fields_for_context(header_fields, header_context)
assert header_fields[0].jsonPath == "headers.X-GMAuth", header_fields[0].jsonPath

response_context = mod.PdfContext()
mod.update_pdf_context_from_text(response_context, "3.5 \u54cd\u5e94\u6d88\u606f\u8bf4\u660e\n\u54cd\u5e94\u53c2\u6570\u8bf4\u660e")
response_rows = [
    ["\u53c2\u6570", "\u7c7b\u578b", "\u5fc5\u586b", "\u8bf4\u660e"],
    ["msg", "string", "Y", "\u63a5\u53e3\u8c03\u7528\u7ed3\u679c\u63cf\u8ff0"],
    ["data", "json", "N", "\u4e1a\u52a1\u7ed3\u679c"],
]
response_fields, _, response_diags = mod.parse_rows_to_fields(response_rows)
assert [field.code for field in response_fields] == ["msg", "data"], response_fields
assert not response_diags, response_diags
mod.enrich_fields_for_context(response_fields, response_context)
assert [field.jsonPath for field in response_fields] == ["response.msg", "response.data"], [field.jsonPath for field in response_fields]

error_rows = [
    ["\u72b6\u6001\u7801", "\u63cf\u8ff0"],
    ["1001", "\u7b7e\u540d\u9519\u8bef"],
]
error_fields, _, error_diags = mod.parse_rows_to_fields(error_rows)
assert error_fields == [], error_fields
assert error_diags == ["\u975e\u5b57\u6bb5\u8868\uff0c\u5df2\u8df3\u8fc7"], error_diags

mixed_rows = [
    ["\u63a5\u53e3\u540d\u79f0", "/api/imessage/third/notify/", "", "", ""],
    ["\u8bf7\u6c42\u53c2\u6570\uff08\u52a0\u5bc6\u524d\uff09", "\u53c2\u6570\u540d\u79f0", "\u5fc5\u586b", "\u6570\u636e\u7c7b\u578b", "\u63cf\u8ff0"],
    ["", "n_type", "Y", "string", "\u56fa\u5b9a\u683c\u5f0f:PUSH_CLINIC_RESERVATION"],
    ["", "notify_no", "Y", "string", "\u6d88\u606f\u552f\u4e00 ID"],
    ["\u8fd4\u56de\u7ed3\u679c", "\u53c2\u6570\u540d\u79f0", "\u5fc5\u586b", "\u6570\u636e\u7c7b\u578b", "\u63cf\u8ff0"],
    ["", "code", "Y", "INT", "\u63a5\u53e3\u8c03\u7528\u72b6\u6001"],
    ["", "msg", "Y", "String", "\u63cf\u8ff0\u4fe1\u606f"],
]
mixed_segments = mod.parse_rows_to_context_segments(mixed_rows, mod.PdfContext())
mixed_fields = [field for _context, segment_fields, _diags, _headers in mixed_segments for field in segment_fields]
assert [field.code for field in mixed_fields] == ["n_type", "notify_no", "code", "msg"], mixed_fields
assert [field.jsonPath for field in mixed_fields] == ["request.n_type", "request.notify_no", "response.code", "response.msg"], [field.jsonPath for field in mixed_fields]
assert [context.interfaceTitle for context, segment_fields, _diags, _headers in mixed_segments if segment_fields] == ["PUSH_CLINIC_RESERVATION", "PUSH_CLINIC_RESERVATION"]
assert all(field.code != "/api/imessage/third/notify/" for field in mixed_fields)

signature_fields = [mod.Field(code="method", name="\u7b7e\u540d\u65b9\u6cd5")]
mod.enrich_fields_for_context(signature_fields, mod.PdfContext(parameterObject="signature"))
assert signature_fields[0].jsonPath == "signature.method", signature_fields[0].jsonPath
'@
$parserBehaviorTest = $parserBehaviorTest.Replace("__PLUGIN_ROOT__", $pluginRoot)
$parserBehaviorTest | python -
if ($LASTEXITCODE -ne 0) { throw "parser behavior regression test failed" }
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("iris-interface-plugin-test-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
try {
  $fixturePath = Join-Path $workRoot "sample-interface.xlsx"
  $createFixture = @"
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from xml.sax.saxutils import escape

sheets = [
    ("Patient", [
        ["\u5b57\u6bb5\u540d", "\u5b57\u6bb5\u540d\u79f0", "\u6570\u636e\u7c7b\u578b", "\u957f\u5ea6", "\u662f\u5426\u5fc5\u586b", "\u5907\u6ce8"],
        ["PATIENT_NAME", "\u60a3\u8005\u59d3\u540d", "String", "50", "Y", "\u60a3\u8005\u59d3\u540d\u5b57\u6bb5"],
        ["VISIT_NO", "\u5c31\u8bca\u53f7", "String", "30", "N", "\u5c31\u8bca\u6d41\u6c34\u53f7"],
    ]),
    ("Order", [
        ["\u5b57\u6bb5\u540d", "\u5b57\u6bb5\u540d\u79f0", "\u6570\u636e\u7c7b\u578b", "\u957f\u5ea6", "\u662f\u5426\u5fc5\u586b", "\u5907\u6ce8"],
        ["ORDER_ID", "\u8ba2\u5355\u53f7", "String", "40", "Y", "\u8ba2\u5355\u552f\u4e00\u6807\u8bc6"],
        ["ORDER_STATUS", "\u8ba2\u5355\u72b6\u6001", "String", "20", "N", "\u8ba2\u5355\u72b6\u6001"],
    ]),
]

def cell_ref(row_index, col_index):
    return chr(ord("A") + col_index) + str(row_index)

def sheet_xml(rows):
    sheet_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for col_index, value in enumerate(row):
            ref = cell_ref(row_index, col_index)
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(sheet_rows) + '</sheetData></worksheet>'

workbook_sheets = ''.join(f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>' for index, (name, _rows) in enumerate(sheets, start=1))
workbook_rels = ''.join(f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>' for index, _sheet in enumerate(sheets, start=1))
overrides = ''.join(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for index, _sheet in enumerate(sheets, start=1))

with ZipFile(Path(r"$fixturePath"), "w", ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + overrides + '</Types>')
    zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + workbook_sheets + '</sheets></workbook>')
    zf.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + workbook_rels + '</Relationships>')
    for index, (_name, rows) in enumerate(sheets, start=1):
        zf.writestr(f"xl/worksheets/sheet{index}.xml", sheet_xml(rows))
"@
  $createFixture | python -

  $ingestScript = Join-Path $pluginRoot "scripts/iris-interface-doc-ingest.py"
  $ingestOutput = python $ingestScript --file $fixturePath --project-root $workRoot 2>&1 | Out-String
  Assert-Contains $ingestOutput "source.md" "ingest output should report source.md path"
  Assert-Contains $ingestOutput "parsed.json" "ingest output should report parsed.json path"
  Assert-NotContains $ingestOutput "PATIENT_NAME" "ingest output should not dump field content to console"

  $outDir = Join-Path $workRoot "docs/output/iris-interface/sample-interface"
  $sourceMd = Join-Path $outDir "source.md"
  $parsedJson = Join-Path $outDir "parsed.json"
  $fieldsMd = Join-Path $outDir "fields.md"
  $diagnosticsMd = Join-Path $outDir "diagnostics.md"
  foreach ($path in @($sourceMd, $parsedJson, $fieldsMd, $diagnosticsMd)) {
    Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "expected output file missing: $path"
  }

  $parsed = Get-Content -Raw -Encoding UTF8 -Path $parsedJson | ConvertFrom-Json
  Assert-True ($parsed.views.Count -eq 2) "parsed.json should contain one view per XLSX sheet"
  Assert-True ($parsed.totalFields -eq 4) "parsed.json should contain fields from all XLSX sheets"
  $fieldsContent = Get-Content -Raw -Encoding UTF8 -Path $fieldsMd
  Assert-Contains $fieldsContent "PATIENT_NAME" "fields.md should include parsed field code from first sheet"
  Assert-Contains $fieldsContent "ORDER_ID" "fields.md should include parsed field code from second sheet"

  $badCodePath = Join-Path $workRoot "bad.cls"
  Set-Content -Encoding UTF8 -Path $badCodePath -Value @(
    "Class Demo.Bad Extends %RegisteredObject",
    "{",
    "ClassMethod Test()",
    "{",
    "    f  s rowId=`$o(^Demo(rowId)) q:rowId=""""  d",
    "    .s data=`$g(^Demo(rowId))",
    "    ..d OutRow",
    "    q $$$OK",
    "}",
    "}"
  )
  $reviewScript = Join-Path $pluginRoot "scripts/iris-interface-review.py"
  $reviewOutput = python $reviewScript --file $badCodePath 2>&1 | Out-String
  Assert-Contains $reviewOutput "dot-loop" "review should identify dot-loop output"
  $reviewExit = $LASTEXITCODE
  Assert-True ($reviewExit -ne 0) "review should fail when dot-loop output exists"
}
finally {
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
}

Write-Host "iris-interface-plugin tests passed"










