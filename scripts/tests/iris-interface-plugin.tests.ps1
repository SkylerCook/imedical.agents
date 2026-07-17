$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$pluginRoot = Join-Path $repoRoot "plugins/iris-interface-dev-plugin"
$extractDocRoot = Join-Path $repoRoot "plugins/extract-doc"

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
Assert-True (($manifest.dependencies -contains "extract-doc")) "manifest should depend on extract-doc"
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

$optionalRequirementsPath = Join-Path $extractDocRoot "requirements-optional.txt"
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
Assert-True (Test-Path -LiteralPath (Join-Path $extractDocRoot "scripts/extract-doc-env-check.py") -PathType Leaf) "extract-doc env-check script should exist"
$envCheckScript = Join-Path $extractDocRoot "scripts/extract-doc-env-check.py"
$envCheckOutput = python -B $envCheckScript --file "sample.pdf" --json | Out-String
Assert-Contains $envCheckOutput "pdfplumber" "env-check should report pdfplumber"
Assert-Contains $envCheckOutput "installCommand" "env-check should report install command"
$skillContent = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $pluginRoot "skills/iris-interface-doc-ingest/SKILL.md")
Assert-Contains $skillContent "extract-doc-env-check.py" "doc-ingest skill should tell users to run extract-doc env check"
Assert-NotContains $skillContent "``r``n" "doc-ingest skill should not contain escaped newline text"
Assert-Contains $skillContent "extract-doc-env-check.py" "doc-ingest skill should mention extract-doc env-check script"
Assert-Contains $skillContent "skills/extract-doc-ingest/SKILL.md" "doc-ingest adapter should route format handling to extract-doc"
Assert-Contains $skillContent ".agents/plugins/extract-doc/scripts/extract-doc-ingest.py" "doc-ingest adapter should invoke the extract-doc parser"
Assert-Contains $skillContent "--output-root docs/output/iris-interface" "doc-ingest adapter should preserve the interface output root"
Assert-Contains $skillContent "--schema-version iris-interface-doc-ingest/v2" "doc-ingest adapter should preserve the interface schema"
Assert-NotContains $skillContent "把文档全文复制到会话上下文" "doc-ingest skill must not require copying full document text into context"
$parserBehaviorTest = @'
import importlib.util
import sys
from pathlib import Path

script = Path(r"__EXTRACT_DOC_ROOT__") / "scripts" / "extract-doc-ingest.py"
spec = importlib.util.spec_from_file_location("extract_doc_ingest", script)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

env_script = Path(r"__EXTRACT_DOC_ROOT__") / "scripts" / "extract-doc-env-check.py"
env_spec = importlib.util.spec_from_file_location("extract_doc_env_check", env_script)
env_mod = importlib.util.module_from_spec(env_spec)
sys.modules[env_spec.name] = env_mod
env_spec.loader.exec_module(env_mod)

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

json_example_rows = [
    ["\u53c2\u6570\u540d", "\u7c7b\u578b", "\u5fc5\u586b", "\u8bf4\u660e"],
    ["patientId", "String", "Y", "\u60a3\u8005\u6807\u8bc6"],
    ["\u8bf7\u6c42\u793a\u4f8b", "JSON", "N", '{"patientId":"P001"}'],
    ["\u8fd4\u56de\u793a\u4f8b", "JSON", "N", '{"code":"0","msg":"ok"}'],
]
json_example_fields, _, json_example_diags = mod.parse_rows_to_fields(json_example_rows)
assert [field.code for field in json_example_fields] == ["patientId"], json_example_fields
assert not json_example_diags, json_example_diags

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

parameter_name_rows = [
    ["\u53c2\u6570\u540d", "\u53c2\u6570\u540d\u79f0", "\u7c7b\u578b", "\u5fc5\u586b", "\u63cf\u8ff0"],
    ["patientId", "\u60a3\u8005ID", "String", "Y", "\u60a3\u8005\u552f\u4e00\u6807\u8bc6"],
]
parameter_name_fields, _, parameter_name_diags = mod.parse_rows_to_fields(parameter_name_rows)
assert len(parameter_name_fields) == 1, parameter_name_fields
assert parameter_name_fields[0].code == "patientId", parameter_name_fields[0]
assert parameter_name_fields[0].name == "\u60a3\u8005ID", parameter_name_fields[0]
assert parameter_name_fields[0].description == "\u60a3\u8005\u552f\u4e00\u6807\u8bc6", parameter_name_fields[0]
assert not parameter_name_diags, parameter_name_diags

parameter_code_rows = [
    ["\u5e8f\u53f7", "\u53c2\u6570\u4ee3\u7801", "\u53c2\u6570\u540d\u79f0", "\u53c2\u6570\u7c7b\u578b", "\u662f\u5426\u5fc5\u586b", "\u9700\u5fc5\u586b\u7cfb\u7edf", "\u8bf4\u660e"],
    ["1", "mdtrt_sn", "\u4f4f\u9662\u6d41\u6c34\u53f7", "\u5b57\u7b26\u578b", "Y", "\u533b\u4fdd\u667a\u80fd\u5ba1\u6838", "\u9662\u5185\u552f\u4e00\u53f7"],
]
parameter_code_fields, _, parameter_code_diags = mod.parse_rows_to_fields(parameter_code_rows)
assert len(parameter_code_fields) == 1, parameter_code_fields
assert parameter_code_fields[0].code == "mdtrt_sn", parameter_code_fields[0]
assert parameter_code_fields[0].name == "\u4f4f\u9662\u6d41\u6c34\u53f7", parameter_code_fields[0]
assert parameter_code_fields[0].fieldType == "\u5b57\u7b26\u578b", parameter_code_fields[0]
assert parameter_code_fields[0].required == "Y", parameter_code_fields[0]
assert parameter_code_fields[0].description == "\u9662\u5185\u552f\u4e00\u53f7", parameter_code_fields[0]
assert not parameter_code_diags, parameter_code_diags

data_item_rows = [
    ["\u6570\u636e\u9879\u4ee3\u7801", "\u6570\u636e\u9879\u540d\u79f0", "\u6570\u636e\u9879\u7c7b\u578b", "\u5907\u6ce8", "\u5fc5\u586b"],
    ["SFXMM", "\u6536\u8d39\u9879\u76ee\u7f16\u7801", "\u5b57\u7b26\u578b", "HIS\u5185\u90e8\u7801", "\u221a"],
]
data_item_fields, _, data_item_diags = mod.parse_rows_to_fields(data_item_rows)
assert len(data_item_fields) == 1, data_item_fields
assert data_item_fields[0].code == "SFXMM", data_item_fields[0]
assert data_item_fields[0].name == "\u6536\u8d39\u9879\u76ee\u7f16\u7801", data_item_fields[0]
assert data_item_fields[0].fieldType == "\u5b57\u7b26\u578b", data_item_fields[0]
assert data_item_fields[0].description == "HIS\u5185\u90e8\u7801", data_item_fields[0]
assert data_item_fields[0].required == "\u221a", data_item_fields[0]
assert not data_item_diags, data_item_diags

return_to_toc_rows = [
    ["\u5b57\u6bb5", "\u53c2\u6570\u7c7b\u578b", "\u662f\u5426\u5fc5\u586b", "\u63cf\u8ff0"],
    ["RETURN_CODE", "String", "Y", "\u6b63\u5e38\u5b57\u6bb5"],
    ["\u8fd4\u56de\u76ee\u5f55", "", "", ""],
]
return_to_toc_fields, _, return_to_toc_diags = mod.parse_rows_to_fields(return_to_toc_rows)
assert [field.code for field in return_to_toc_fields] == ["RETURN_CODE"], return_to_toc_fields
assert not return_to_toc_diags, return_to_toc_diags

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

docx_mixed_rows = [
    ["\u540d\u79f0", "mdc2_zy_patient_list", "mdc2_zy_patient_list"],
    ["\u529f\u80fd\u63cf\u8ff0", "\u6839\u636e\u5165\u53c2\u83b7\u53d6\u75c5\u4eba\u5217\u8868", "\u6839\u636e\u5165\u53c2\u83b7\u53d6\u75c5\u4eba\u5217\u8868"],
    ["\u5165\u53c2\u8868", "\u5165\u53c2\u8868", "\u5165\u53c2\u8868"],
    ["\u5b57\u6bb5\u540d", "\u6570\u636e\u7c7b\u578b", "\u5b57\u6bb5\u63cf\u8ff0"],
    ["startdate", "varchar(20)", "\u5f00\u59cb\u65e5\u671f"],
    ["\u51fa\u53c2\u8868", "\u51fa\u53c2\u8868", "\u51fa\u53c2\u8868"],
    ["\u5b57\u6bb5\u540d", "\u6570\u636e\u7c7b\u578b", "\u5141\u8bb8\u7a7a", "\u4e3b\u952e", "\u5b57\u6bb5\u63cf\u8ff0", "\u9ed8\u8ba4\u503c"],
    ["hiscode", "varchar(128)", "\u5426", "\u662f", "\u533b\u9662\u4ee3\u7801", "'0'"],
    ["ph\u3001taker\u3001taketime\u3001takerid\u4e3a\u9886\u53d6\u9ebb\u9189\u7cbe\u795e\u836f\u54c1\u76f8\u5173\u4fe1\u606f", "ph\u3001taker\u3001taketime\u3001takerid\u4e3a\u9886\u53d6\u9ebb\u9189\u7cbe\u795e\u836f\u54c1\u76f8\u5173\u4fe1\u606f"],
    ["\u6ce8\uff1a\u8be5\u5b58\u50a8\u8fc7\u7a0b\u6267\u884c\u67e5\u8be2\u7ed3\u679c\u4e2d\u4ee5patientid\u548cvisitid\u6765\u786e\u5b9a\u552f\u4e00\u6027", "\u6ce8\uff1a\u8be5\u5b58\u50a8\u8fc7\u7a0b\u6267\u884c\u67e5\u8be2\u7ed3\u679c\u4e2d\u4ee5patientid\u548cvisitid\u6765\u786e\u5b9a\u552f\u4e00\u6027"],
]
docx_segments = mod.parse_rows_to_context_segments(docx_mixed_rows, mod.PdfContext())
docx_fields = [field for _context, segment_fields, _diags, _headers in docx_segments for field in segment_fields]
assert [field.code for field in docx_fields] == ["startdate", "hiscode"], docx_fields
assert all(not field.code.startswith("\u6ce8\uff1a") for field in docx_fields), docx_fields
assert all(field.code != "\u51fa\u53c2\u8868" and field.code != "\u5b57\u6bb5\u540d" for field in docx_fields), docx_fields
hiscode_field = next(field for field in docx_fields if field.code == "hiscode")
assert hiscode_field.nullable == "\u5426", hiscode_field
assert hiscode_field.primaryKey == "\u662f", hiscode_field
assert hiscode_field.defaultValue == "'0'", hiscode_field
assert hiscode_field.required == "Y", hiscode_field
assert hiscode_field.requiredReason == "\u7531\u5141\u8bb8\u7a7a=\u5426\u63a8\u5bfc", hiscode_field.requiredReason
assert hiscode_field.rawColumns["\u5b57\u6bb5\u540d"] == "hiscode", hiscode_field.rawColumns
assert hiscode_field.rawColumns["\u9ed8\u8ba4\u503c"] == "'0'", hiscode_field.rawColumns
assert hiscode_field.classification == "mapped-field", hiscode_field.classification
assert hiscode_field.confidence == 1.0, hiscode_field.confidence
assert any("defaultValue" in warning for warning in hiscode_field.warnings), hiscode_field.warnings

class FakeCell:
    def __init__(self, text):
        self.text = text

class FakeRow:
    def __init__(self, values):
        self.cells = [FakeCell(value) for value in values]

class FakeTable:
    def __init__(self, rows):
        self.rows = [FakeRow(row) for row in rows]

class FakeDocument:
    paragraphs = []
    tables = [FakeTable(docx_mixed_rows)]

class FakeDocxModule:
    @staticmethod
    def Document(_path):
        return FakeDocument()

original_docx_module = sys.modules.get("docx")
sys.modules["docx"] = FakeDocxModule
try:
    _markdown, docx_views, _docx_diags, docx_converter = mod.parse_docx(Path("fake.docx"))
    assert docx_converter == "docx-built-in", docx_converter
    assert [field.code for view in docx_views for field in view.fields] == ["startdate", "hiscode"], docx_views
    assert len(docx_views) == 2, docx_views
    assert all("mdc2_zy_patient_list" in view.viewName for view in docx_views), [view.viewName for view in docx_views]
    assert all("\u6839\u636e\u5165\u53c2\u83b7\u53d6\u75c5\u4eba\u5217\u8868" in view.viewName for view in docx_views), [view.viewName for view in docx_views]
finally:
    if original_docx_module is None:
        del sys.modules["docx"]
    else:
        sys.modules["docx"] = original_docx_module

signature_fields = [mod.Field(code="method", name="\u7b7e\u540d\u65b9\u6cd5")]
mod.enrich_fields_for_context(signature_fields, mod.PdfContext(parameterObject="signature"))
assert signature_fields[0].jsonPath == "signature.method", signature_fields[0].jsonPath
assert signature_fields[0].jsonPathReason == "\u7531\u4e0a\u4e0b\u6587 signature \u63a8\u5bfc", signature_fields[0].jsonPathReason

calls = []
original_try_convert_doc = mod.try_convert_doc
original_try_markitdown = mod.try_markitdown
original_parse_document = mod.parse_document
try:
    mod.try_convert_doc = lambda path: calls.append("convert") or Path("converted.docx")
    mod.try_markitdown = lambda path: calls.append("markitdown") or "# fallback\n"
    mod.parse_document = lambda path: ("# converted\n", [mod.View(viewCode="docx", viewName="DOCX", fields=[])], [], "docx-built-in")
    _markdown, _views, _diagnostics, converter = mod.parse_doc(Path("legacy.doc"))
    assert converter == "docx-built-in", converter
    assert calls == ["convert"], calls
finally:
    mod.try_convert_doc = original_try_convert_doc
    mod.try_markitdown = original_try_markitdown
    mod.parse_document = original_parse_document

doc_requirement = env_mod.file_requirement(
    Path("legacy.doc"),
    {"markitdown": True, "python-docx": True, "pdfplumber": True, "openpyxl": True, "xlrd": True},
    {"soffice": False, "libreoffice": False, "pandoc": False},
)
assert doc_requirement["ready"] is False, doc_requirement
assert doc_requirement["status"] == "missing-converter", doc_requirement
assert "markitdown" not in doc_requirement["install"], doc_requirement
'@
$parserBehaviorTest = $parserBehaviorTest.Replace("__EXTRACT_DOC_ROOT__", $extractDocRoot)
$parserBehaviorTest | python -B -
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
  $createFixture | python -B -

  $ingestScript = Join-Path $extractDocRoot "scripts/extract-doc-ingest.py"
  $ingestOutput = python -B $ingestScript --file $fixturePath --project-root $workRoot --output-root "docs/output/iris-interface" --schema-version "iris-interface-doc-ingest/v2" 2>&1 | Out-String
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
  Assert-True ($parsed.schemaVersion -eq "iris-interface-doc-ingest/v2") "parsed.json schemaVersion should be v2"
  Assert-True ($parsed.views.Count -eq 2) "parsed.json should contain one view per XLSX sheet"
  Assert-True ($parsed.totalFields -eq 4) "parsed.json should contain fields from all XLSX sheets"
  $fieldsContent = Get-Content -Raw -Encoding UTF8 -Path $fieldsMd
  $firstField = $parsed.views[0].fields[0]
  Assert-True ($firstField.rawColumns."字段名" -eq "PATIENT_NAME") "field rawColumns should preserve original header values"
  Assert-True ($firstField.sourceLocation.sheet -eq "Patient") "XLSX field sourceLocation should include sheet name"
  Assert-True ($firstField.sourceLocation.row -eq 2) "XLSX field sourceLocation should include source row"
  Assert-True ($firstField.classification -eq "mapped-field") "field classification should be mapped-field"
  Assert-True ($firstField.confidence -eq 1.0) "field confidence should be deterministic for mapped rows"
  Assert-Contains $fieldsContent "追溯提示" "fields.md should include traceability summary column"
  $diagnosticsContent = Get-Content -Raw -Encoding UTF8 -Path $diagnosticsMd
  Assert-Contains $diagnosticsContent "fieldWarnings" "diagnostics.md should include field warning count"
  Assert-Contains $fieldsContent "PATIENT_NAME" "fields.md should include parsed field code from first sheet"
  Assert-Contains $fieldsContent "ORDER_ID" "fields.md should include parsed field code from second sheet"

  $fieldMatchParsed = Join-Path $workRoot "parsed-field-match.json"
  $fieldMatchParsedJson = @"
{
  "schemaVersion": "iris-interface-doc-ingest/v2",
  "sourceFile": "docs/input/synthetic.xlsx",
  "documentName": "synthetic",
  "converter": "synthetic",
  "viewCount": 1,
  "totalFields": 5,
  "views": [
    {
      "viewCode": "synthetic",
      "viewName": "Synthetic",
      "fields": [
        {
          "code": "patientId",
          "name": "患者ID",
          "fieldType": "String",
          "description": "患者唯一标识",
          "jsonPath": "request.patientId"
        },
        {
          "code": "orderStatus",
          "name": "订单状态",
          "fieldType": "String",
          "description": "本地反馈覆盖低置信候选",
          "jsonPath": "request.orderStatus"
        },
        {
          "code": "visitSerial",
          "name": "就诊流水",
          "fieldType": "String",
          "description": "就诊流水号",
          "jsonPath": "request.visitSerial"
        },
        {
          "code": "mysteryField",
          "name": "临时字段",
          "fieldType": "String",
          "description": "需要人工确认",
          "jsonPath": "request.mysteryField"
        },
        {
          "code": "RAW_DETAIL_SECRET_FIELD",
          "name": "不应该在控制台出现",
          "fieldType": "String",
          "description": "控制台泄漏检查",
          "jsonPath": "request.rawDetailSecretField"
        }
      ]
    }
  ],
  "diagnostics": []
}
"@
  Set-Content -Encoding UTF8 -Path $fieldMatchParsed -Value $fieldMatchParsedJson

  $fieldMatchFeedback = Join-Path $workRoot "field-feedback.json"
  $fieldMatchFeedbackJson = @"
{
  "fields": {
    "orderStatus": {
      "candidate": "order.status",
      "confidence": 0.96,
      "reason": "项目本地反馈"
    }
  }
}
"@
  Set-Content -Encoding UTF8 -Path $fieldMatchFeedback -Value $fieldMatchFeedbackJson

  $fieldMatchScript = Join-Path $pluginRoot "scripts/iris-interface-field-match.py"
  $fieldMatchOutput = python -B $fieldMatchScript --parsed $fieldMatchParsed --project-root $workRoot --feedback $fieldMatchFeedback 2>&1 | Out-String
  Assert-Contains $fieldMatchOutput "field-match completed" "field-match should report completion"
  Assert-Contains $fieldMatchOutput "field-match.json" "field-match output should report JSON path"
  Assert-Contains $fieldMatchOutput "field-match.md" "field-match output should report Markdown path"
  Assert-Contains $fieldMatchOutput "totalFields: 5" "field-match output should report total field count"
  Assert-NotContains $fieldMatchOutput "RAW_DETAIL_SECRET_FIELD" "field-match output should not dump field content to console"

  $fieldMatchJson = Join-Path $workRoot "field-match.json"
  $fieldMatchMd = Join-Path $workRoot "field-match.md"
  Assert-True (Test-Path -LiteralPath $fieldMatchJson -PathType Leaf) "field-match.json should be created beside parsed.json"
  Assert-True (Test-Path -LiteralPath $fieldMatchMd -PathType Leaf) "field-match.md should be created beside parsed.json"
  $fieldMatch = Get-Content -Raw -Encoding UTF8 -Path $fieldMatchJson | ConvertFrom-Json
  Assert-True ($fieldMatch.schemaVersion -eq "iris-interface-field-match/v1") "field-match schemaVersion should be v1"
  Assert-True ($fieldMatch.totalFields -eq 5) "field-match should preserve totalFields"
  Assert-True ($fieldMatch.matchedCount -eq 2) "field-match should count builtin and feedback matches"
  Assert-True ($fieldMatch.feedbackMatchedCount -eq 1) "field-match should count local feedback matches"
  Assert-True ($fieldMatch.lowConfidenceCount -eq 1) "field-match should count low confidence candidates"
  Assert-True ($fieldMatch.unmatchedCount -eq 2) "field-match should count unmatched fields"
  Assert-True ($fieldMatch.needsReviewCount -eq 3) "field-match should count manual review fields"
  $fieldMatchResults = @($fieldMatch.views[0].fields)
  $patientMatch = $fieldMatchResults | Where-Object { $_.code -eq "patientId" } | Select-Object -First 1
  Assert-True ($patientMatch.matched -eq $true) "patientId should match builtin rule"
  Assert-True ($patientMatch.matchSource -eq "builtin-rule") "patientId should use builtin-rule"
  Assert-True ($patientMatch.needsReview -eq $false) "builtin match should not require review"
  $feedbackMatch = $fieldMatchResults | Where-Object { $_.code -eq "orderStatus" } | Select-Object -First 1
  Assert-True ($feedbackMatch.matched -eq $true) "orderStatus should match local feedback"
  Assert-True ($feedbackMatch.matchSource -eq "local-feedback") "orderStatus should use local-feedback"
  Assert-True ($feedbackMatch.candidate -eq "order.status") "local feedback should set candidate"
  $lowMatch = $fieldMatchResults | Where-Object { $_.code -eq "visitSerial" } | Select-Object -First 1
  Assert-True ($lowMatch.matched -eq $false) "visitSerial should be a candidate, not a confirmed match"
  Assert-True ($lowMatch.matchSource -eq "low-confidence-candidate") "visitSerial should be low confidence"
  Assert-True ($lowMatch.needsReview -eq $true) "low confidence candidate should require review"
  $unmatched = $fieldMatchResults | Where-Object { $_.code -eq "mysteryField" } | Select-Object -First 1
  Assert-True ($unmatched.matched -eq $false) "mysteryField should be unmatched"
  Assert-True ($unmatched.matchSource -eq "unmatched") "mysteryField should be unmatched"
  $fieldMatchMdContent = Get-Content -Raw -Encoding UTF8 -Path $fieldMatchMd
  Assert-Contains $fieldMatchMdContent "字段匹配摘要" "field-match.md should include coverage summary"
  Assert-Contains $fieldMatchMdContent "需人工确认" "field-match.md should include manual review section"
  Assert-Contains $fieldMatchMdContent "未匹配字段" "field-match.md should include unmatched section"
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
  $reviewOutput = python -B $reviewScript --file $badCodePath 2>&1 | Out-String
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

