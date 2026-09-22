#!/usr/bin/env python3
"""Generate deterministic field match artifacts from parsed interface fields."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable


SUPPORTED_PARSED_SCHEMA = "iris-interface-doc-ingest/v2"
MATCH_SCHEMA = "iris-interface-field-match/v1"

BUILTIN_RULES: dict[str, tuple[str, float, str]] = {
    "patientid": ("patient.id", 0.98, "通用字段规则：患者唯一标识"),
    "patient_id": ("patient.id", 0.98, "通用字段规则：患者唯一标识"),
    "patientname": ("patient.name", 0.98, "通用字段规则：患者姓名"),
    "patient_name": ("patient.name", 0.98, "通用字段规则：患者姓名"),
    "visitno": ("visit.no", 0.95, "通用字段规则：就诊号"),
    "visit_no": ("visit.no", 0.95, "通用字段规则：就诊号"),
    "orderno": ("order.no", 0.95, "通用字段规则：订单号"),
    "order_no": ("order.no", 0.95, "通用字段规则：订单号"),
    "orderid": ("order.id", 0.95, "通用字段规则：订单标识"),
    "order_id": ("order.id", 0.95, "通用字段规则：订单标识"),
    "code": ("response.code", 0.94, "通用字段规则：响应状态码"),
    "msg": ("response.message", 0.94, "通用字段规则：响应消息"),
    "message": ("response.message", 0.94, "通用字段规则：响应消息"),
    "data": ("response.data", 0.9, "通用字段规则：响应数据"),
}

LOW_CONFIDENCE_HINTS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"visit|就诊|诊疗", re.IGNORECASE), "visit.identifier", "字段文本包含就诊语义"),
    (re.compile(r"order|订单|医嘱", re.IGNORECASE), "order.identifier", "字段文本包含订单/医嘱语义"),
    (re.compile(r"patient|患者|病人", re.IGNORECASE), "patient.identifier", "字段文本包含患者语义"),
]


def normalize_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"[^a-z0-9_\u4e00-\u9fff]+", "", text)


def escape_md(value: Any) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ")


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            data = json.load(handle)
    except FileNotFoundError as exc:
        raise RuntimeError(f"file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid JSON: {path}: {exc.msg}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"JSON root must be an object: {path}")
    return data


def load_feedback(path: Path | None, project_root: Path) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    feedback_path = path.resolve()
    if not is_relative_to(feedback_path, project_root):
        raise RuntimeError("feedback path must be inside project root")
    feedback = load_json(feedback_path)
    fields = feedback.get("fields", feedback)
    if not isinstance(fields, dict):
        raise RuntimeError("feedback JSON must contain an object field named 'fields' or be an object map")
    result: dict[str, dict[str, Any]] = {}
    for key, value in fields.items():
        if isinstance(value, str):
            item = {"candidate": value}
        elif isinstance(value, dict):
            item = dict(value)
        else:
            continue
        candidate = str(item.get("candidate") or "").strip()
        if not candidate:
            continue
        result[normalize_key(key)] = item
    return result


def field_text(field: dict[str, Any]) -> str:
    return " ".join(
        str(field.get(name) or "")
        for name in ["code", "name", "description", "jsonPath"]
    )


def low_confidence_candidate(field: dict[str, Any]) -> tuple[str, str] | None:
    text = field_text(field)
    for pattern, candidate, reason in LOW_CONFIDENCE_HINTS:
        if pattern.search(text):
            return candidate, reason
    return None


def match_field(field: dict[str, Any], feedback: dict[str, dict[str, Any]]) -> dict[str, Any]:
    code = str(field.get("code") or "").strip()
    name = str(field.get("name") or "").strip()
    keys = [normalize_key(code), normalize_key(name), normalize_key(field.get("jsonPath"))]

    for key in keys:
        if key in feedback:
            item = feedback[key]
            confidence = float(item.get("confidence") or 0.95)
            return {
                "code": code,
                "name": name,
                "jsonPath": field.get("jsonPath") or "",
                "matched": True,
                "candidate": str(item.get("candidate") or ""),
                "confidence": confidence,
                "reason": str(item.get("reason") or "项目本地反馈命中"),
                "matchSource": "local-feedback",
                "needsReview": confidence < 0.9,
            }

    for key in keys:
        if key in BUILTIN_RULES:
            candidate, confidence, reason = BUILTIN_RULES[key]
            return {
                "code": code,
                "name": name,
                "jsonPath": field.get("jsonPath") or "",
                "matched": True,
                "candidate": candidate,
                "confidence": confidence,
                "reason": reason,
                "matchSource": "builtin-rule",
                "needsReview": False,
            }

    candidate = low_confidence_candidate(field)
    if candidate:
        value, reason = candidate
        return {
            "code": code,
            "name": name,
            "jsonPath": field.get("jsonPath") or "",
            "matched": False,
            "candidate": value,
            "confidence": 0.62,
            "reason": reason,
            "matchSource": "low-confidence-candidate",
            "needsReview": True,
        }

    return {
        "code": code,
        "name": name,
        "jsonPath": field.get("jsonPath") or "",
        "matched": False,
        "candidate": "",
        "confidence": 0.0,
        "reason": "未找到可靠通用规则或项目本地反馈",
        "matchSource": "unmatched",
        "needsReview": True,
    }


def build_match(parsed: dict[str, Any], parsed_path: Path, feedback: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if parsed.get("schemaVersion") != SUPPORTED_PARSED_SCHEMA:
        raise RuntimeError(f"unsupported parsed schema: {parsed.get('schemaVersion')}")

    views = []
    all_matches: list[dict[str, Any]] = []
    for view in parsed.get("views") or []:
        fields = []
        for field in view.get("fields") or []:
            if isinstance(field, dict):
                match = match_field(field, feedback)
                fields.append(match)
                all_matches.append(match)
        views.append({
            "viewCode": view.get("viewCode") or "",
            "viewName": view.get("viewName") or "",
            "fields": fields,
        })

    matched_count = sum(1 for item in all_matches if item["matched"])
    feedback_count = sum(1 for item in all_matches if item["matchSource"] == "local-feedback")
    low_count = sum(1 for item in all_matches if item["matchSource"] == "low-confidence-candidate")
    unmatched_count = sum(1 for item in all_matches if item["matchSource"] == "unmatched")
    review_count = sum(1 for item in all_matches if item["needsReview"])

    return {
        "schemaVersion": MATCH_SCHEMA,
        "sourceParsed": str(parsed_path),
        "documentName": parsed.get("documentName") or parsed_path.parent.name,
        "totalFields": len(all_matches),
        "matchedCount": matched_count,
        "feedbackMatchedCount": feedback_count,
        "lowConfidenceCount": low_count,
        "unmatchedCount": unmatched_count,
        "needsReviewCount": review_count,
        "views": views,
    }


def match_markdown(result: dict[str, Any]) -> str:
    lines = [
        "# Field Match",
        "",
        "## 字段匹配摘要",
        "",
        f"- document: `{escape_md(result.get('documentName'))}`",
        f"- totalFields: `{result['totalFields']}`",
        f"- matched: `{result['matchedCount']}`",
        f"- localFeedback: `{result['feedbackMatchedCount']}`",
        f"- lowConfidenceCandidates: `{result['lowConfidenceCount']}`",
        f"- unmatched: `{result['unmatchedCount']}`",
        f"- needsReview: `{result['needsReviewCount']}`",
        "",
        "## 匹配结果",
        "",
    ]
    for view in result.get("views") or []:
        lines.extend([
            f"### {escape_md(view.get('viewName') or view.get('viewCode') or 'view')}",
            "",
            "| 字段代码 | 字段名称 | 候选 | 置信度 | 来源 | 需人工确认 | 原因 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ])
        for field in view.get("fields") or []:
            lines.append(
                "| "
                + " | ".join(
                    escape_md(value)
                    for value in [
                        field.get("code"),
                        field.get("name"),
                        field.get("candidate"),
                        field.get("confidence"),
                        field.get("matchSource"),
                        "Y" if field.get("needsReview") else "N",
                        field.get("reason"),
                    ]
                )
                + " |"
            )
        lines.append("")

    review_fields = [field for view in result.get("views") or [] for field in view.get("fields") or [] if field.get("needsReview")]
    lines.extend(["## 需人工确认", ""])
    if review_fields:
        lines.extend(f"- `{escape_md(item.get('code'))}`: {escape_md(item.get('reason'))}" for item in review_fields)
    else:
        lines.append("- 暂无。")

    unmatched = [field for field in review_fields if field.get("matchSource") == "unmatched"]
    lines.extend(["", "## 未匹配字段", ""])
    if unmatched:
        lines.extend(f"- `{escape_md(item.get('code'))}` {escape_md(item.get('name'))}" for item in unmatched)
    else:
        lines.append("- 暂无。")
    return "\n".join(lines).strip() + "\n"


def write_outputs(parsed_path: Path, result: dict[str, Any]) -> dict[str, Path]:
    out_dir = parsed_path.parent
    paths = {
        "json": out_dir / "field-match.json",
        "markdown": out_dir / "field-match.md",
    }
    paths["json"].write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    paths["markdown"].write_text(match_markdown(result), encoding="utf-8")
    return paths


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate field match artifacts from parsed interface JSON.")
    parser.add_argument("--parsed", required=True, help="Path to parsed.json from iris-interface-doc-ingest")
    parser.add_argument("--project-root", required=True, help="Target project root")
    parser.add_argument("--feedback", help="Optional target-project-local JSON feedback file")
    return parser.parse_args(argv)


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    parsed_path = Path(args.parsed).resolve()
    project_root = Path(args.project_root).resolve()
    feedback_path = Path(args.feedback) if args.feedback else None

    if not project_root.exists():
        print(f"ERROR: project root not found: {project_root}", file=sys.stderr)
        return 2

    try:
        parsed = load_json(parsed_path)
        feedback = load_feedback(feedback_path, project_root)
        result = build_match(parsed, parsed_path, feedback)
        paths = write_outputs(parsed_path, result)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print("field-match completed")
    print(f"field-match.json: {paths['json']}")
    print(f"field-match.md: {paths['markdown']}")
    print(f"totalFields: {result['totalFields']}")
    print(f"matchedCount: {result['matchedCount']}")
    print(f"lowConfidenceCount: {result['lowConfidenceCount']}")
    print(f"unmatchedCount: {result['unmatchedCount']}")
    print(f"needsReviewCount: {result['needsReviewCount']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
