#!/usr/bin/env python3
"""
查询谁调用了指定的 Feign 接口

数据来源：penetration_db.json（第一部分工作区 Feign 调用 + 第二部分 Maven 入站链路）

用法: python query_who_calls_feign.py <Feign 接口关键词>
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import OUTPUT_DIR


def _base_id(method_id: str) -> str:
    idx = method_id.find("(")
    return method_id[:idx] if idx > 0 else method_id


def _class_of(method_id: str) -> str:
    return _base_id(method_id).rsplit(".", 1)[0]


def load_feign_index(feign_path: Path):
    with open(feign_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    full_map = {}
    simple_map = defaultdict(list)
    for iface in data.get("interfaces", []):
        full = iface["full_name"]
        simple = iface.get("class_name") or full.rsplit(".", 1)[-1]
        full_map[full] = iface
        simple_map[simple].append(full)
    return full_map, simple_map


def short(method_id: str) -> str:
    class_name, _, method = method_id.rpartition(".")
    return f"{class_name.rsplit('.', 1)[-1]}.{method}" if class_name else method_id


def main():
    if len(sys.argv) < 2:
        print("用法: python query_who_calls_feign.py <Feign 接口关键词>")
        return
    client_name = sys.argv[1].strip()

    db_path = OUTPUT_DIR / "penetration_db.json"
    if not db_path.exists():
        print(f"[ERROR] 缺少穿透数据库: {db_path}")
        print("请先运行: python build_penetration_db.py")
        return

    feign_path = OUTPUT_DIR / "feign_interfaces.json"
    if not feign_path.exists():
        print(f"[ERROR] 缺少 Feign 接口索引: {feign_path}")
        return
    full_map, simple_map = load_feign_index(feign_path)

    if client_name in full_map:
        client_full = client_name
    elif client_name in simple_map:
        candidates = simple_map[client_name]
        if len(candidates) > 1:
            print(f"❌ Feign Client 短名不唯一: {client_name}")
            print("请使用全限定名之一:")
            for c in candidates:
                print(f"  {c}")
            return
        client_full = candidates[0]
    else:
        print(f"❌ 未找到 Feign Client: {client_name}")
        similar = [s for s in simple_map if client_name.lower() in s.lower()]
        if similar:
            print("相近的 Client:", ", ".join(sorted(similar)[:20]))
        return

    with open(db_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    ws_nodes = db.get("workspace", {}).get("nodes", {})
    ws_callers = []
    for edge in db.get("workspace", {}).get("edges", []):
        if edge["ct"] != "feign" or _class_of(edge["t"]) != client_full:
            continue
        ws_callers.append({"caller": edge["s"], "feign": edge["t"]})

    inbound = [
        chain for chain in db.get("inbound_feign", {}).get("chains", [])
        if _class_of(chain["feign"]) == client_full
    ]

    print(f"查询 Feign 接口: {client_full}")
    print("=" * 80)

    ws_by_svc = defaultdict(list)
    seen = set()
    for item in ws_callers:
        if (item["caller"], item["feign"]) in seen:
            continue
        seen.add((item["caller"], item["feign"]))
        service = ws_nodes.get(item["caller"], {}).get("service", "unknown")
        ws_by_svc[service].append(item)

    print(f"\n【工作区调用方】{sum(len(v) for v in ws_by_svc.values())} 个调用")
    if not ws_by_svc:
        print("  (工作区无调用)")
    for service in sorted(ws_by_svc, key=lambda s: -len(ws_by_svc[s])):
        items = ws_by_svc[service]
        print(f"\n  [{service}] {len(items)} 个")
        for item in items:
            print(f"    - {short(item['caller'])}  →  {short(item['feign'])}")

    print(f"\n【Maven 外部调用方】{len(inbound)} 个调用点")
    if not inbound:
        print("  (Maven 外部无入站调用)")
    mvn_by_svc = defaultdict(list)
    for chain in inbound:
        mvn_by_svc[chain["service"]].append(chain)
    for service in sorted(mvn_by_svc, key=lambda s: -len(mvn_by_svc[s])):
        items = mvn_by_svc[service]
        print(f"\n  [{service}] {len(items)} 个调用点")
        for chain in items:
            root = "Controller" if chain["root_type"] == "controller" else "内部方法"
            print(f"    - {short(chain['caller'])}  →  {short(chain['feign'])}  (入口: {root})")
            if chain.get("controller") and chain.get("paths"):
                path = chain["paths"][0]
                print(f"      链路: {' → '.join(short(node) for node in path)}")
            elif chain.get("partial_paths"):
                for path in chain["partial_paths"][:2]:
                    print(f"      上游: {' ← '.join(short(node) for node in path)}")


if __name__ == "__main__":
    main()
