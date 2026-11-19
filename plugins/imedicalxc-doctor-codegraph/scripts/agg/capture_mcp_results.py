#!/usr/bin/env python3
"""从 Qoder 会话记录回填 kingbase-87-aggregation 查询结果，生成 MCP 导出 JSON。

用法:
    python capture_mcp_results.py --transcript <会话.jsonl> [--dump out.json]

脚本按 collect_sm_hsb.py 的 SQL 精确匹配会话里的 mcp_call 工具调用，
把对应的 tool_result 解析为 rows；分页数据集按页拼接。结果文件可直接：
    python collect_sm_hsb.py --from-json <dump.json>

大结果会被客户端保存为临时文件，脚本会自动读取 tool_result 里给出的路径。
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from collect_sm_hsb import DATASETS, pages_of

_PERSISTED_RE = re.compile(r"Full output (?:has been )?saved to:\s*(.+?\.(?:txt|json))", re.S)
_TOOL_NAME = "mcp__kingbase_87_aggregation__kb_query"


def _norm(sql):
    """折叠空白后比较，容忍工具调用里单行 SQL 与渲染出的多行 SQL 差异。

    空白全部忽略：手写 SQL 常在逗号/括号后少一个空格（如 ``COALESCE(x,'')``），
    只折叠连续空白仍会判为不同 SQL，导致回填漏页。
    """
    return re.sub(r"\s+", "", (sql or "").strip().rstrip(";"))


def _default_transcript():
    root = Path.home() / ".qoder" / "projects"
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(Path(__file__).resolve().parents[5]))
    for pattern in (slug, slug.replace("--", "-")):
        directory = root / pattern
        if directory.is_dir():
            files = sorted(directory.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
            if files:
                return files[-1]
    return None


def _iter_blocks(message):
    content = (message or {}).get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                yield block


def _load_transcript(path):
    uses = {}
    results = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            for block in _iter_blocks(entry.get("message")):
                if block.get("type") == "tool_use" and block.get("name") == "mcp_call":
                    data = block.get("input") or {}
                    if data.get("toolName") != _TOOL_NAME:
                        continue
                    sql = _norm((data.get("arguments") or {}).get("sql"))
                    if sql:
                        uses[block.get("id")] = sql
                elif block.get("type") == "tool_result":
                    results[block.get("tool_use_id")] = block.get("content")
    return uses, results


def _content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(parts)
    return ""


def _parse_rows(text):
    text = (text or "").strip()
    if not text:
        raise ValueError("空结果")
    if text.startswith("Error:"):
        raise ValueError(text)
    match = _PERSISTED_RE.search(text)
    if match:
        return _parse_rows(Path(match.group(1).strip()).read_text(encoding="utf-8"))
    start = text.find("{")
    if start < 0:
        raise ValueError(f"非 JSON 结果: {text[:120]}")
    payload = json.loads(text[start:])
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    if isinstance(payload, list):
        return payload
    raise ValueError("结果缺少 rows 数组")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transcript", help="会话 JSONL；缺省取当前项目最新会话")
    parser.add_argument("--dump", default=str(Path.home() / ".qoder" / "tmp" / "aggregation_mcp_dump.json"))
    args = parser.parse_args()

    transcript = Path(args.transcript) if args.transcript else _default_transcript()
    if not transcript or not transcript.is_file():
        parser.error("找不到会话记录，请显式传 --transcript")

    uses, results = _load_transcript(transcript)
    sql_to_slot = {}
    for dataset in DATASETS:
        for page, sql in pages_of(dataset):
            sql_to_slot[_norm(sql)] = (dataset["id"], page)

    collected = {}
    missing = []
    for tool_id, sql in uses.items():
        slot = sql_to_slot.get(sql)
        if not slot:
            continue
        dataset_id, page = slot
        if dataset_id in collected and page in collected[dataset_id]:
            continue
        content = results.get(tool_id)
        if content is None:
            missing.append(f"{dataset_id}#{page + 1} (无结果)")
            continue
        try:
            rows = _parse_rows(_content_text(content))
        except Exception as exc:  # noqa: BLE001 - 结果形态不可控，统一报告
            missing.append(f"{dataset_id}#{page + 1} ({exc})")
            continue
        collected.setdefault(dataset_id, {})[page] = rows

    dump = {}
    for dataset in DATASETS:
        pages = collected.get(dataset["id"])
        if not pages:
            missing.append(f"{dataset['id']} (未采集)")
            continue
        rows = []
        for page in sorted(pages):
            rows.extend(pages[page])
        dump[dataset["id"]] = rows

    out = Path(args.dump)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dump, ensure_ascii=False, sort_keys=True, indent=1) + "\n",
                   encoding="utf-8")
    print(f"会话 {transcript}")
    print(f"数据集 {len(dump)} 个 → {out}")
    for dataset in DATASETS:
        if dataset["id"] in dump:
            print(f"  {dataset['id']:<24} {len(dump[dataset['id']]):>5} 行")
    if missing:
        print("缺失:", "; ".join(missing))
        sys.exit(1)


if __name__ == "__main__":
    main()
