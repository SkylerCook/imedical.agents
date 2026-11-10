#!/usr/bin/env python3
"""方法签名类型使用索引（type_usage.json）

扫描工作区方法图的节点签名，建立「类型全限定名 → 用到该类型的方法」的反向索引。
契约类型改动常落在 BLH/Service 方法的入参上（如 FeignPaPatMedicalInfoDTO 是
FeignPCAInfoDTO 的字段，而 FeignPCAInfoDTO 又是
SaveIhdPaPatDataAbstract#setPatientInfo 的入参），这类方法不在 Controller 签名里，
只靠签名反查找不到；查询期以本索引取 seed，沿方法图反向追到 Controller 入口。

约束:
  - 只取方法签名参数里的类型（节点 id 的括号段），不含方法体局部变量
  - 短名按文件 import / 同包 / 通配解析，且必须命中源码里真实存在的类
  - 索引键与方法图节点 ID 一致（去参形式 Class.method），可直接反向 BFS
  - 输出确定性排序，同一份源码重建应逐字节一致（meta.generatedAt 除外）
"""

import json
import re
from datetime import datetime
from pathlib import Path

from config import OUTPUT_DIR, PROJECT_ROOT
from build_type_nesting import parse_scope, resolve_type, scan_classes, strip_comments

WORKSPACE_ROOT = PROJECT_ROOT.parent
GRAPH_FILE = OUTPUT_DIR / "method_call_graph.jsonl"
OUTPUT_PATH = OUTPUT_DIR / "type_usage.json"

SIG_RE = re.compile(r"^([\w.$]+)\.([\w$]+)\((.*)\)$")
TYPE_TOKEN_RE = re.compile(r"[A-Za-z_$][\w$]*")


def graph_key(path):
    """绝对路径或工作区相对路径统一成 `src/backend/...` 键。"""
    text = str(path).replace("\\", "/")
    idx = text.find("/src/backend/")
    return text[idx + 1:] if idx >= 0 else text


def load_scope(rel, cache):
    if rel in cache:
        return cache[rel]
    scope = None
    try:
        text = (WORKSPACE_ROOT / rel).read_text(encoding="utf-8", errors="ignore")
        scope = parse_scope(strip_comments(text))
    except OSError:
        scope = None
    cache[rel] = scope
    return scope


def build():
    known, _files = scan_classes()
    cache = {}
    usage = {}
    methods = 0
    missing_scope = 0
    unresolved = 0
    with GRAPH_FILE.open(encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if rec.get("type") != "node":
                continue
            sig = SIG_RE.match(rec.get("id") or "")
            if not sig:
                continue
            methods += 1
            mid = f"{sig.group(1)}.{sig.group(2)}"
            scope = load_scope(graph_key(rec.get("file_path") or ""), cache)
            if not scope:
                missing_scope += 1
                continue
            hit = False
            for token in set(TYPE_TOKEN_RE.findall(sig.group(3))):
                for fqn in resolve_type(scope, token, known):
                    usage.setdefault(fqn, set()).add(mid)
                    hit = True
            if not hit and sig.group(3).strip():
                unresolved += 1

    out = {fqn: sorted(rows) for fqn, rows in sorted(usage.items())}
    doc = {
        "meta": {
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "methods": methods,
            "types": len(out),
            "refs": sum(len(v) for v in out.values()),
            "missingScopeMethods": missing_scope,
            "unresolvedMethods": unresolved,
            "scope": "method signature parameters, import-resolved, com.mediway only",
        },
        "types": out,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"[type-usage] {OUTPUT_PATH}")
    print(f"  方法 {methods} · 类型 {doc['meta']['types']} · 引用 {doc['meta']['refs']}"
          f" · 无作用域 {missing_scope} · 无命中 {unresolved}")


if __name__ == "__main__":
    build()
