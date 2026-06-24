#!/usr/bin/env python3
"""Check optional parser dependencies for iris-interface-dev-plugin."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Iterable

MODULES = {
    "python-docx": "docx",
    "pdfplumber": "pdfplumber",
    "openpyxl": "openpyxl",
    "markitdown": "markitdown",
    "xlrd": "xlrd",
}

TOOLS = ["soffice", "libreoffice", "pandoc"]
INSTALL_COMMAND = "python -m pip install -r .agents/plugins/iris-interface-dev-plugin/requirements-optional.txt"
LOCAL_INSTALL_COMMAND = "python -m pip install -r plugins/iris-interface-dev-plugin/requirements-optional.txt"


def has_module(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def module_status() -> dict[str, bool]:
    return {package: has_module(module) for package, module in MODULES.items()}


def tool_status() -> dict[str, bool]:
    return {tool: shutil.which(tool) is not None for tool in TOOLS}


def markitdown_can_convert(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        from markitdown import MarkItDown

        result = MarkItDown().convert(str(path))
        text = getattr(result, "text_content", "") or ""
        return bool(text.strip())
    except Exception:
        return False


def file_requirement(path: Path, modules: dict[str, bool], tools: dict[str, bool]) -> dict[str, Any]:
    suffix = path.suffix.lower()
    available_tools = [name for name, ok in tools.items() if ok]
    result: dict[str, Any] = {
        "file": str(path),
        "extension": suffix,
        "exists": path.exists(),
        "ready": False,
        "status": "unsupported",
        "message": "unsupported file type",
        "install": [],
        "manualAction": "",
    }

    if suffix == ".pdf":
        result.update(require_modules(modules, ["pdfplumber"], "PDF 解析需要 pdfplumber"))
    elif suffix == ".docx":
        result.update(require_modules(modules, ["python-docx"], "DOCX 解析需要 python-docx"))
    elif suffix == ".xlsx":
        result.update({"ready": True, "status": "ready", "message": "XLSX 可解析；安装 openpyxl 后可获得增强解析"})
        if not modules.get("openpyxl", False):
            result["install"] = ["openpyxl"]
    elif suffix == ".xls":
        if modules.get("xlrd", False):
            result.update({"ready": True, "status": "ready", "message": "XLS 可通过 xlrd 解析"})
        elif tools.get("soffice", False) or tools.get("libreoffice", False):
            result.update({"ready": True, "status": "ready", "message": "XLS 可通过 LibreOffice 转 XLSX 后解析"})
        else:
            result.update({"ready": False, "status": "missing-dependency", "message": "XLS 解析需要 xlrd，或安装 LibreOffice 转为 XLSX", "install": ["xlrd"], "manualAction": "也可以手动另存为 XLSX 后重试"})
    elif suffix == ".doc":
        if tools.get("soffice", False) or tools.get("libreoffice", False) or tools.get("pandoc", False):
            result.update({"ready": True, "status": "ready", "message": "DOC 可通过 LibreOffice/Pandoc 转 DOCX 后结构化解析"})
        elif modules.get("markitdown", False) and markitdown_can_convert(path):
            result.update({"ready": True, "status": "markdown-only", "message": "DOC 仅可通过 MarkItDown 生成 Markdown；未结构化字段，建议转为 DOCX 复核"})
        else:
            install = [] if modules.get("markitdown", False) else ["markitdown"]
            result.update({"ready": False, "status": "missing-converter", "message": "DOC 结构化解析需要 LibreOffice 或 Pandoc 转 DOCX；MarkItDown 仅作为可用时的 Markdown 降级", "install": install, "manualAction": "请安装 LibreOffice/Pandoc，或手动另存为 DOCX 后重试"})
    else:
        result.update({"ready": False, "status": "unsupported", "message": f"暂不支持的文件类型: {suffix or '<none>'}"})
    return result


def require_modules(modules: dict[str, bool], packages: list[str], message: str) -> dict[str, Any]:
    missing = [package for package in packages if not modules.get(package, False)]
    if missing:
        return {"ready": False, "status": "missing-dependency", "message": message, "install": missing}
    return {"ready": True, "status": "ready", "message": "ready", "install": []}


def build_report(files: list[Path]) -> dict[str, Any]:
    modules = module_status()
    tools = tool_status()
    return {
        "python": sys.executable,
        "modules": modules,
        "tools": tools,
        "files": [file_requirement(path, modules, tools) for path in files],
        "installCommand": INSTALL_COMMAND,
        "localInstallCommand": LOCAL_INSTALL_COMMAND,
    }


def markdown_report(report: dict[str, Any]) -> str:
    lines = ["# IRIS 接口文档解析环境自检", "", f"- Python: `{report['python']}`", "", "## Python 依赖", ""]
    for package, ok in report["modules"].items():
        lines.append(f"- `{package}`: {'可用' if ok else '缺失'}")
    lines.extend(["", "## 外部转换器", ""])
    for tool, ok in report["tools"].items():
        lines.append(f"- `{tool}`: {'可用' if ok else '缺失'}")
    lines.extend(["", "## 文件就绪状态", ""])
    if not report["files"]:
        lines.append("- 未指定文件；请使用 `--file <path>` 检查具体文档。")
    for item in report["files"]:
        lines.append(f"- `{item['file']}`: {item['status']} - {item['message']}")
        if item.get("install"):
            lines.append(f"  建议安装: `{', '.join(item['install'])}`")
        if item.get("manualAction"):
            lines.append(f"  手动处理: {item['manualAction']}")
    lines.extend([
        "",
        "## 建议命令",
        "",
        "在业务项目中:",
        "",
        f"```powershell\n{report['installCommand']}\n```",
        "",
        "在 imedical.agents 仓库内验证时:",
        "",
        f"```powershell\n{report['localInstallCommand']}\n```",
    ])
    return "\n".join(lines).strip() + "\n"


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check optional dependencies for IRIS interface document parsing.")
    parser.add_argument("--file", action="append", default=[], help="Document path to check. Can be specified multiple times.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of Markdown.")
    parser.add_argument("--strict", action="store_true", help="Exit with code 1 when any specified file is not ready.")
    return parser.parse_args(argv)


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    report = build_report([Path(value).resolve() for value in args.file])
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(markdown_report(report))
    if args.strict and any(not item.get("ready", False) for item in report["files"]):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
