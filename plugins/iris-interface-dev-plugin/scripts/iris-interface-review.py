#!/usr/bin/env python3
"""Offline review gates for IRIS interface artifacts."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Iterable


DOT_LOOP_RE = re.compile(r"^\s*\.+\s*[A-Za-z]")


def review_code(path: Path) -> list[str]:
    issues: list[str] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        if DOT_LOOP_RE.match(line):
            issues.append(f"dot-loop:{path}:{line_no}: ObjectScript dot-loop body is forbidden for generated interface code")
    return issues


def review_parsed(path: Path) -> list[str]:
    issues: list[str] = []
    data = json.loads(path.read_text(encoding="utf-8"))
    views = data.get("views")
    if not isinstance(views, list) or not views:
        issues.append(f"parsed-empty:{path}: parsed.json has no views")
        return issues

    for view_index, view in enumerate(views, start=1):
        fields = view.get("fields") if isinstance(view, dict) else None
        if not isinstance(fields, list) or not fields:
            issues.append(f"fields-empty:{path}: view {view_index} has no fields")
            continue
        for field_index, field in enumerate(fields, start=1):
            code = str(field.get("code", "")).strip() if isinstance(field, dict) else ""
            name = str(field.get("name", "")).strip() if isinstance(field, dict) else ""
            if not code and not name:
                issues.append(f"field-empty:{path}: view {view_index} field {field_index} has neither code nor name")
    return issues


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Review IRIS interface artifacts.")
    parser.add_argument("--file", help="Generated ObjectScript or text file to scan")
    parser.add_argument("--parsed", help="parsed.json to validate")
    return parser.parse_args(argv)


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    issues: list[str] = []

    if args.file:
        file_path = Path(args.file).resolve()
        if not file_path.exists():
            print(f"ERROR: file not found: {file_path}", file=sys.stderr)
            return 2
        issues.extend(review_code(file_path))

    if args.parsed:
        parsed_path = Path(args.parsed).resolve()
        if not parsed_path.exists():
            print(f"ERROR: parsed file not found: {parsed_path}", file=sys.stderr)
            return 2
        issues.extend(review_parsed(parsed_path))

    if not args.file and not args.parsed:
        print("ERROR: provide --file and/or --parsed", file=sys.stderr)
        return 2

    if issues:
        print("iris-interface-review failed")
        for issue in issues:
            print(issue)
        return 1

    print("iris-interface-review passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
