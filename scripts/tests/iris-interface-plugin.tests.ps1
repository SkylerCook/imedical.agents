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
foreach ($packageName in @("python-docx", "pdfplumber", "openpyxl", "markitdown")) {
  Assert-Contains $optionalRequirements $packageName "requirements-optional.txt should include $packageName"
}
$thinIndexScript = Join-Path $pluginRoot "scripts/generate-plugin-thin-index.ps1"
Assert-True (Test-Path -LiteralPath $thinIndexScript -PathType Leaf) "thin-index wrapper should exist"
$thinIndexOutput = & $thinIndexScript -PluginPath $pluginRoot -ProjectRoot $repoRoot -Mode DryRun | Out-String
Assert-Contains $thinIndexOutput "iris_interface_index.md" "thin-index dry-run should include interface index rule"
Assert-Contains $thinIndexOutput "iris-interface-doc-ingest" "thin-index dry-run should include doc ingest skill"
Assert-NotContains $thinIndexOutput "candidate-assets.md" "references must not generate thin-index"
Assert-NotContains $thinIndexOutput "references/wiki" "wiki references must not generate thin-index"

$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("iris-interface-plugin-test-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
try {
  $fixturePath = Join-Path $workRoot "sample-interface.xlsx"
  $createFixture = @"
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from xml.sax.saxutils import escape

rows = [
    ["\u5b57\u6bb5\u540d", "\u5b57\u6bb5\u540d\u79f0", "\u6570\u636e\u7c7b\u578b", "\u957f\u5ea6", "\u662f\u5426\u5fc5\u586b", "\u5907\u6ce8"],
    ["PATIENT_NAME", "\u60a3\u8005\u59d3\u540d", "String", "50", "Y", "\u60a3\u8005\u59d3\u540d\u5b57\u6bb5"],
    ["VISIT_NO", "\u5c31\u8bca\u53f7", "String", "30", "N", "\u5c31\u8bca\u6d41\u6c34\u53f7"],
]

def cell_ref(row_index, col_index):
    return chr(ord("A") + col_index) + str(row_index)

sheet_rows = []
for row_index, row in enumerate(rows, start=1):
    cells = []
    for col_index, value in enumerate(row):
        ref = cell_ref(row_index, col_index)
        cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
    sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
sheet_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(sheet_rows) + '</sheetData></worksheet>'

with ZipFile(Path(r"$fixturePath"), "w", ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Patient" sheetId="1" r:id="rId1"/></sheets></workbook>')
    zf.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
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
  Assert-True ($parsed.views.Count -eq 1) "parsed.json should contain one view"
  Assert-True ($parsed.totalFields -eq 2) "parsed.json should contain two fields"
  $fieldsContent = Get-Content -Raw -Encoding UTF8 -Path $fieldsMd
  Assert-Contains $fieldsContent "PATIENT_NAME" "fields.md should include parsed field code"

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



