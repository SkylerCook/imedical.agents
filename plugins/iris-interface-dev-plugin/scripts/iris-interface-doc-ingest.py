#!/usr/bin/env python3
"""Parse interface documents into Markdown and structured artifacts."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import zipfile
from xml.etree import ElementTree as ET
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Iterable


CODE_HEADERS = {"\u5b57\u6bb5\u540d", "\u5b57\u6bb5\u4ee3\u7801", "\u5b57\u6bb5\u7f16\u7801", "\u6570\u636e\u5b57\u6bb5\u540d", "\u6570\u636e\u5143\u82f1\u6587\u540d\u79f0", "\u4ee3\u7801", "field", "field name", "code"}
NAME_HEADERS = {"\u5b57\u6bb5\u540d\u79f0", "\u4e2d\u6587\u540d", "\u6570\u636e\u9879\u540d\u79f0", "\u5b57\u6bb5\u63cf\u8ff0", "\u6570\u636e\u5143\u4e2d\u6587\u540d\u79f0", "\u540d\u79f0", "name"}
TYPE_HEADERS = {"\u6570\u636e\u7c7b\u578b", "\u7c7b\u578b", "\u5b57\u6bb5\u7c7b\u578b", "type", "datatype", "data type"}
LENGTH_HEADERS = {"\u957f\u5ea6", "\u6570\u636e\u957f\u5ea6", "\u5b57\u6bb5\u957f\u5ea6", "length", "len"}
REQUIRED_HEADERS = {"\u662f\u5426\u5fc5\u586b", "\u5fc5\u586b", "\u662f\u5426\u5fc5\u987b", "\u975e\u7a7a", "required", "mandatory", "not null"}
DESC_HEADERS = {"\u5907\u6ce8", "\u8bf4\u660e", "\u5b57\u6bb5\u8bf4\u660e", "\u63cf\u8ff0", "description", "remark", "remarks"}

@dataclass
class Field:
    code: str
    name: str
    fieldType: str = ""
    length: str = ""
    required: str = ""
    description: str = ""
    sourceHeaderMap: dict[str, str] | None = None


@dataclass
class View:
    viewCode: str
    viewName: str
    fields: list[Field]


def normalize_header(value: Any) -> str:
    text = str(value or "").strip()
    return re.sub(r"\s+", " ", text).lower()


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)


def slugify(path: Path) -> str:
    stem = path.stem.strip().lower()
    stem = re.sub(r"[^a-z0-9\u4e00-\u9fff._-]+", "-", stem)
    stem = re.sub(r"-+", "-", stem).strip("-._")
    return stem or "interface-document"


def markdown_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    lines = [
        "| " + " | ".join(escape_md(cell) for cell in header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in normalized[1:]:
        lines.append("| " + " | ".join(escape_md(cell) for cell in row) + " |")
    return "\n".join(lines)


def escape_md(text: str) -> str:
    return str(text).replace("|", "\\|")


def header_index(headers: list[str], choices: set[str]) -> int | None:
    normalized_choices = {normalize_header(choice) for choice in choices}
    for index, header in enumerate(headers):
        normalized = normalize_header(header)
        if normalized in normalized_choices:
            return index
    for index, header in enumerate(headers):
        normalized = normalize_header(header)
        if any(choice in normalized for choice in normalized_choices if choice):
            return index
    return None


def find_header_row(rows: list[list[str]]) -> int | None:
    for index, row in enumerate(rows):
        headers = [normalize_header(cell) for cell in row]
        has_code_or_name = header_index(headers, CODE_HEADERS) is not None or header_index(headers, NAME_HEADERS) is not None
        has_type_or_desc = header_index(headers, TYPE_HEADERS) is not None or header_index(headers, DESC_HEADERS) is not None
        if has_code_or_name and has_type_or_desc:
            return index
    return None


def parse_rows_to_fields(rows: list[list[str]]) -> tuple[list[Field], dict[str, str], list[str]]:
    diagnostics: list[str] = []
    header_row = find_header_row(rows)
    if header_row is None:
        return [], {}, ["未识别字段表头"]

    headers = rows[header_row]
    code_i = header_index(headers, CODE_HEADERS)
    name_i = header_index(headers, NAME_HEADERS)
    type_i = header_index(headers, TYPE_HEADERS)
    length_i = header_index(headers, LENGTH_HEADERS)
    required_i = header_index(headers, REQUIRED_HEADERS)
    desc_i = header_index(headers, DESC_HEADERS)
    header_map = {
        "code": headers[code_i] if code_i is not None else "",
        "name": headers[name_i] if name_i is not None else "",
        "fieldType": headers[type_i] if type_i is not None else "",
        "length": headers[length_i] if length_i is not None else "",
        "required": headers[required_i] if required_i is not None else "",
        "description": headers[desc_i] if desc_i is not None else "",
    }

    fields: list[Field] = []
    for row in rows[header_row + 1 :]:
        if not any(cell_text(cell) for cell in row):
            continue
        get = lambda i: cell_text(row[i]) if i is not None and i < len(row) else ""
        field = Field(
            code=get(code_i),
            name=get(name_i),
            fieldType=get(type_i),
            length=get(length_i),
            required=get(required_i),
            description=get(desc_i),
            sourceHeaderMap=header_map,
        )
        if field.code or field.name:
            fields.append(field)

    if not fields:
        diagnostics.append("表头已识别，但未抽取到字段行")
    return fields, header_map, diagnostics


def parse_xlsx(path: Path) -> tuple[str, list[View], list[str], str]:
    if has_module("openpyxl"):
        return parse_xlsx_openpyxl(path)
    return parse_xlsx_openxml(path)


def has_module(module_name: str) -> bool:
    try:
        __import__(module_name)
        return True
    except ImportError:
        return False


def parse_xlsx_openpyxl(path: Path) -> tuple[str, list[View], list[str], str]:
    from openpyxl import load_workbook

    workbook = load_workbook(path, data_only=True, read_only=True)
    markdown_parts = [f"# {path.name}", ""]
    views: list[View] = []
    diagnostics: list[str] = []

    for sheet in workbook.worksheets:
        rows = [[cell_text(value) for value in row] for row in sheet.iter_rows(values_only=True)]
        rows = [trim_trailing_empty(row) for row in rows if any(cell_text(cell) for cell in row)]
        markdown_parts.extend([f"## {sheet.title}", ""])
        if rows:
            markdown_parts.append(markdown_table(rows))
            markdown_parts.append("")
        fields, _header_map, field_diags = parse_rows_to_fields(rows)
        diagnostics.extend([f"{sheet.title}: {item}" for item in field_diags])
        if fields:
            views.append(View(viewCode=sheet.title, viewName=sheet.title, fields=fields))

    if not views:
        diagnostics.append("\u672a\u4ece XLSX \u4e2d\u62bd\u53d6\u5230\u5b57\u6bb5\u89c6\u56fe")
    return "\n".join(markdown_parts).strip() + "\n", views, diagnostics, "xlsx-openpyxl-optional"


def parse_xlsx_openxml(path: Path) -> tuple[str, list[View], list[str], str]:
    with zipfile.ZipFile(path) as archive:
        shared_strings = read_shared_strings(archive)
        sheets = read_workbook_sheets(archive)
        rels = read_workbook_relationships(archive)
        markdown_parts = [f"# {path.name}", ""]
        views: list[View] = []
        diagnostics: list[str] = []

        for sheet_index, (sheet_name, rel_id) in enumerate(sheets, start=1):
            target = rels.get(rel_id, f"worksheets/sheet{sheet_index}.xml")
            sheet_path = "xl/" + target.lstrip("/")
            sheet_path = sheet_path.replace("xl/xl/", "xl/")
            if sheet_path not in archive.namelist():
                diagnostics.append(f"{sheet_name}: \u672a\u627e\u5230\u5de5\u4f5c\u8868 XML {sheet_path}")
                continue
            rows = read_sheet_rows(archive, sheet_path, shared_strings)
            rows = [trim_trailing_empty(row) for row in rows if any(cell_text(cell) for cell in row)]
            markdown_parts.extend([f"## {sheet_name}", ""])
            if rows:
                markdown_parts.append(markdown_table(rows))
                markdown_parts.append("")
            fields, _header_map, field_diags = parse_rows_to_fields(rows)
            diagnostics.extend([f"{sheet_name}: {item}" for item in field_diags])
            if fields:
                views.append(View(viewCode=sheet_name, viewName=sheet_name, fields=fields))

    if not views:
        diagnostics.append("\u672a\u4ece XLSX \u4e2d\u62bd\u53d6\u5230\u5b57\u6bb5\u89c6\u56fe")
    return "\n".join(markdown_parts).strip() + "\n", views, diagnostics, "xlsx-openxml-built-in"


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    values: list[str] = []
    for item in root.findall("x:si", ns):
        texts = [node.text or "" for node in item.findall(".//x:t", ns)]
        values.append("".join(texts))
    return values


def read_workbook_sheets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    root = ET.fromstring(archive.read("xl/workbook.xml"))
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_key = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    sheets: list[tuple[str, str]] = []
    for sheet in root.findall(".//x:sheet", ns):
        sheets.append((sheet.attrib.get("name", "Sheet"), sheet.attrib.get(rel_key, "")))
    return sheets


def read_workbook_relationships(archive: zipfile.ZipFile) -> dict[str, str]:
    rel_path = "xl/_rels/workbook.xml.rels"
    if rel_path not in archive.namelist():
        return {}
    root = ET.fromstring(archive.read(rel_path))
    rels: dict[str, str] = {}
    for rel in root:
        rel_id = rel.attrib.get("Id", "")
        target = rel.attrib.get("Target", "")
        if rel_id and target:
            rels[rel_id] = target
    return rels


def read_sheet_rows(archive: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(archive.read(sheet_path))
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: list[list[str]] = []
    for row in root.findall(".//x:row", ns):
        values: list[str] = []
        for cell in row.findall("x:c", ns):
            col_index = column_index(cell.attrib.get("r", ""))
            while len(values) < col_index:
                values.append("")
            values.append(read_cell_value(cell, shared_strings, ns))
        rows.append(values)
    return rows


def column_index(ref: str) -> int:
    letters = re.sub(r"[^A-Z]", "", ref.upper())
    index = 0
    for letter in letters:
        index = index * 26 + (ord(letter) - ord("A") + 1)
    return max(index - 1, 0)


def read_cell_value(cell: ET.Element, shared_strings: list[str], ns: dict[str, str]) -> str:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        texts = [node.text or "" for node in cell.findall(".//x:t", ns)]
        return cell_text("".join(texts))
    value_node = cell.find("x:v", ns)
    value = value_node.text if value_node is not None else ""
    if cell_type == "s" and value:
        try:
            return cell_text(shared_strings[int(value)])
        except (ValueError, IndexError):
            return ""
    return cell_text(value)

def trim_trailing_empty(row: list[str]) -> list[str]:
    result = list(row)
    while result and not cell_text(result[-1]):
        result.pop()
    return result


def parse_docx(path: Path) -> tuple[str, list[View], list[str], str]:
    try:
        import docx
    except ImportError as exc:
        raise RuntimeError("缺少 python-docx，无法解析 DOCX") from exc

    document = docx.Document(str(path))
    markdown_parts = [f"# {path.name}", ""]
    all_views: list[View] = []
    diagnostics: list[str] = []

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            markdown_parts.extend([text, ""])

    for index, table in enumerate(document.tables, start=1):
        rows = [[cell_text(cell.text) for cell in row.cells] for row in table.rows]
        markdown_parts.extend([f"## 表格 {index}", "", markdown_table(rows), ""])
        fields, _header_map, field_diags = parse_rows_to_fields(rows)
        diagnostics.extend([f"表格 {index}: {item}" for item in field_diags])
        if fields:
            all_views.append(View(viewCode=f"table-{index}", viewName=f"表格 {index}", fields=fields))

    if not all_views:
        diagnostics.append("未从 DOCX 表格中抽取到字段视图")
    return "\n".join(markdown_parts).strip() + "\n", all_views, diagnostics, "docx-built-in"


def parse_pdf(path: Path) -> tuple[str, list[View], list[str], str]:
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("缺少 pdfplumber，无法解析 PDF") from exc

    markdown_parts = [f"# {path.name}", ""]
    views: list[View] = []
    diagnostics: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if text.strip():
                markdown_parts.extend([f"## Page {page_index}", "", text.strip(), ""])
            for table_index, table in enumerate(page.extract_tables() or [], start=1):
                rows = [[cell_text(cell) for cell in row] for row in table]
                markdown_parts.extend([f"### Page {page_index} Table {table_index}", "", markdown_table(rows), ""])
                fields, _header_map, field_diags = parse_rows_to_fields(rows)
                diagnostics.extend([f"Page {page_index} Table {table_index}: {item}" for item in field_diags])
                if fields:
                    views.append(View(viewCode=f"p{page_index}-t{table_index}", viewName=f"Page {page_index} Table {table_index}", fields=fields))

    if not views:
        diagnostics.append("未从 PDF 表格中抽取到字段视图")
    return "\n".join(markdown_parts).strip() + "\n", views, diagnostics, "pdf-built-in"


def parse_doc(path: Path) -> tuple[str, list[View], list[str], str]:
    markitdown_markdown = try_markitdown(path)
    if markitdown_markdown:
        diagnostics = ["MarkItDown \u4ec5\u751f\u6210 Markdown\uff1bDOC \u7ed3\u6784\u5316\u5b57\u6bb5\u62bd\u53d6\u9700\u8981\u8f6c\u4e3a DOCX \u540e\u590d\u6838"]
        return markitdown_markdown, [], diagnostics, "markitdown-optional"

    converted = try_convert_doc(path)
    if converted is None:
        raise RuntimeError("DOC \u89e3\u6790\u9700\u8981 MarkItDown\u3001LibreOffice \u6216 Pandoc\uff1b\u8bf7\u5b89\u88c5\u8f6c\u6362\u5668\u6216\u624b\u52a8\u8f6c\u4e3a DOCX")
    return parse_document(converted)


def try_markitdown(path: Path) -> str | None:
    try:
        from markitdown import MarkItDown
    except ImportError:
        return None

    try:
        result = MarkItDown().convert(str(path))
        text = getattr(result, "text_content", "") or ""
    except Exception:
        return None

    if not text.strip():
        return None
    return f"# {path.name}\n\n" + text.strip() + "\n"


def try_convert_doc(path: Path) -> Path | None:
    temp_dir = path.parent / f".{path.stem}-converted"
    temp_dir.mkdir(exist_ok=True)

    libreoffice = shutil.which("soffice") or shutil.which("libreoffice")
    if libreoffice:
        subprocess.run(
            [libreoffice, "--headless", "--convert-to", "docx", "--outdir", str(temp_dir), str(path)],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        candidate = temp_dir / f"{path.stem}.docx"
        if candidate.exists():
            return candidate

    pandoc = shutil.which("pandoc")
    if pandoc:
        candidate = temp_dir / f"{path.stem}.docx"
        subprocess.run([pandoc, str(path), "-o", str(candidate)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if candidate.exists():
            return candidate

    return None


def parse_document(path: Path) -> tuple[str, list[View], list[str], str]:
    suffix = path.suffix.lower()
    if suffix == ".xlsx":
        return parse_xlsx(path)
    if suffix == ".docx":
        return parse_docx(path)
    if suffix == ".pdf":
        return parse_pdf(path)
    if suffix == ".doc":
        return parse_doc(path)
    raise RuntimeError(f"不支持的文件类型: {suffix}")


def artifact_json(source: Path, doc_name: str, views: list[View], diagnostics: list[str], converter: str) -> dict[str, Any]:
    view_dicts = []
    total_fields = 0
    for view in views:
        fields = [asdict(field) for field in view.fields]
        total_fields += len(fields)
        view_dicts.append({"viewCode": view.viewCode, "viewName": view.viewName, "fields": fields})

    return {
        "schemaVersion": "iris-interface-doc-ingest/v1",
        "sourceFile": str(source),
        "documentName": doc_name,
        "converter": converter,
        "viewCount": len(view_dicts),
        "totalFields": total_fields,
        "views": view_dicts,
        "diagnostics": diagnostics,
    }


def fields_markdown(views: list[View]) -> str:
    lines = ["# Fields", ""]
    for view in views:
        lines.extend([f"## {view.viewName}", "", "| 字段代码 | 字段名称 | 类型 | 长度 | 必填 | 备注 |", "| --- | --- | --- | --- | --- | --- |"])
        for field in view.fields:
            lines.append(
                "| "
                + " | ".join(
                    escape_md(value)
                    for value in [field.code, field.name, field.fieldType, field.length, field.required, field.description]
                )
                + " |"
            )
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def diagnostics_markdown(parsed: dict[str, Any]) -> str:
    lines = [
        "# Diagnostics",
        "",
        f"- converter: `{parsed['converter']}`",
        f"- views: `{parsed['viewCount']}`",
        f"- fields: `{parsed['totalFields']}`",
        "",
        "## Notes",
        "",
    ]
    diagnostics = parsed.get("diagnostics") or []
    if diagnostics:
        lines.extend(f"- {item}" for item in diagnostics)
    else:
        lines.append("- 未发现解析级错误；字段语义匹配仍需后续诊断。")
    return "\n".join(lines).strip() + "\n"


def write_artifacts(source: Path, project_root: Path, output_root: str) -> dict[str, Path]:
    markdown, views, diagnostics, converter = parse_document(source)
    doc_name = slugify(source)
    out_dir = project_root / output_root / doc_name
    out_dir.mkdir(parents=True, exist_ok=True)

    parsed = artifact_json(source, doc_name, views, diagnostics, converter)
    paths = {
        "source": out_dir / "source.md",
        "parsed": out_dir / "parsed.json",
        "fields": out_dir / "fields.md",
        "diagnostics": out_dir / "diagnostics.md",
    }
    paths["source"].write_text(markdown, encoding="utf-8")
    paths["parsed"].write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    paths["fields"].write_text(fields_markdown(views), encoding="utf-8")
    paths["diagnostics"].write_text(diagnostics_markdown(parsed), encoding="utf-8")
    return paths


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Parse interface document artifacts to disk.")
    parser.add_argument("--file", required=True, help="Source DOCX/PDF/XLSX/DOC file")
    parser.add_argument("--project-root", default=".", help="Target project root")
    parser.add_argument("--output-root", default="docs/output/iris-interface", help="Output root relative to project root")
    return parser.parse_args(argv)


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    source = Path(args.file).resolve()
    project_root = Path(args.project_root).resolve()
    if not source.exists():
        print(f"ERROR: source file not found: {source}", file=sys.stderr)
        return 2

    try:
        paths = write_artifacts(source, project_root, args.output_root)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print("iris-interface-doc-ingest completed")
    for key in ["source", "parsed", "fields", "diagnostics"]:
        print(f"{key}: {paths[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))


