#!/usr/bin/env python3
"""
构建影响分析数据库 (impact_db.json)

从 method_call_graph.jsonl / maven_biz_call_graph.jsonl / feign_interfaces.json
提取精简索引，供 impact_analyzer.py 快速加载。

用法:
    python build_impact_db.py
"""

import json
import sys
from pathlib import Path
from collections import defaultdict

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
from config import OUTPUT_DIR


def strip_params(method_id: str) -> str:
    idx = method_id.find('(')
    return method_id[:idx] if idx > 0 else method_id


def build():
    print("构建影响分析数据库...")
    print()

    # ── 1. 工作区调用图 ──────────────────────────────────────────
    ws_jsonl = OUTPUT_DIR / "method_call_graph.jsonl"
    if not ws_jsonl.exists():
        print(f"[ERROR] 缺少 {ws_jsonl}，请先运行 build_method_graph.py")
        sys.exit(1)

    ws_edges = []
    ws_nodes = {}
    feign_set = set()

    print(f"[1/4] 加载工作区调用图: {ws_jsonl.name}")
    with open(ws_jsonl, "r", encoding="utf-8") as f:
        for line in f:
            obj = json.loads(line)
            tp = obj.get("type")
            if tp == "node":
                nid = strip_params(obj["id"])
                ws_nodes[nid] = {
                    "label": obj.get("label", ""),
                    "service": obj.get("service", "unknown"),
                    "is_feign": obj.get("is_feign", False),
                    "file_path": obj.get("file_path", ""),
                    "parent": obj.get("parent", ""),
                }
                if obj.get("ancestors"):
                    ws_nodes[nid]["ancestors"] = obj["ancestors"]
                if obj.get("blh_name"):
                    ws_nodes[nid]["blh_name"] = obj["blh_name"]
                if obj.get("is_feign"):
                    feign_set.add(nid)
            elif tp == "edge":
                ws_edges.append({
                    "s": strip_params(obj["source"]),
                    "t": strip_params(obj["target"]),
                    "ct": obj.get("call_type", "internal"),
                    "fi": obj.get("feign_interface", ""),
                })

    print(f"  节点: {len(ws_nodes)}, 边: {len(ws_edges)}, Feign: {len(feign_set)}")

    # Controller 方法的注解 URL 直接挂到节点上，影响分析无需再查端点索引
    endpoint_json = OUTPUT_DIR / "controller_endpoints.json"
    if endpoint_json.exists():
        print(f"[1/4] 加载 Controller 注解端点: {endpoint_json.name}")
        with open(endpoint_json, "r", encoding="utf-8") as f:
            edata = json.load(f)
        by_method = defaultdict(list)
        for path, items in edata.get("endpoints", {}).items():
            for ep in items:
                by_method[f"{ep['controller_fqn']}.{ep['method']}"].append({
                    "http": ep.get("http", ""),
                    "path": path,
                })
        hit = 0
        for nid, node in ws_nodes.items():
            eps = by_method.get(nid)
            if eps:
                node["endpoints"] = sorted(eps, key=lambda x: (x["path"], x["http"]))
                hit += 1
        print(f"  方法→URL 映射 {len(by_method)} 个，命中工作区节点 {hit} 个")
    else:
        print("[1/4] controller_endpoints.json 不存在，跳过 Controller URL 关联"
              "（先运行 scan_controller_endpoints.py）")

    # ── 2. Feign 接口定义 ────────────────────────────────────────
    feign_json = OUTPUT_DIR / "feign_interfaces.json"
    feign_methods = {}

    if feign_json.exists():
        print(f"[2/4] 加载 Feign 接口: {feign_json.name}")
        with open(feign_json, "r", encoding="utf-8") as f:
            fdata = json.load(f)
        for iface in fdata.get("interfaces", []):
            cn = iface.get("class_name", "")
            full_class = iface.get("full_class_name", cn)
            methods = [m.get("name", "") for m in iface.get("methods", [])]
            feign_methods[cn] = {"full": full_class, "methods": methods}
            if full_class != cn:
                feign_methods[full_class] = feign_methods[cn]
        print(f"  接口: {len(feign_methods)}")
    else:
        print("[2/4] Feign 接口文件不存在，跳过")

    # ── 3. Maven biz 调用图 ──────────────────────────────────────
    maven_jsonl = OUTPUT_DIR / "maven_biz_call_graph.jsonl"
    maven_edges = []

    if maven_jsonl.exists():
        print(f"[3/4] 加载 Maven biz 调用图: {maven_jsonl.name}")
        with open(maven_jsonl, "r", encoding="utf-8") as f:
            for line in f:
                obj = json.loads(line)
                if obj.get("type") == "calls":
                    src = strip_params(obj["source"])
                    svc = obj.get("source_service", "unknown")
                    for tgt in obj.get("targets", []):
                        maven_edges.append({
                            "s": src,
                            "t": strip_params(tgt),
                            "svc": svc,
                        })
        print(f"  边: {len(maven_edges)}")
    else:
        print("[3/4] Maven biz 调用图不存在，跳过")

    # ── 4. 服务边界 ──────────────────────────────────────────────
    boundary_json = OUTPUT_DIR / "merged_service_boundary.json"
    boundary = {}
    if boundary_json.exists():
        print(f"[4/4] 加载服务边界: {boundary_json.name}")
        with open(boundary_json, "r", encoding="utf-8") as f:
            boundary = json.load(f)
        print(f"  映射: {len(boundary)}")
    else:
        print("[4/4] 服务边界文件不存在，跳过")

    # ── 写出 ─────────────────────────────────────────────────────
    db = {
        "ws_edges": ws_edges,
        "ws_nodes": ws_nodes,
        "maven_edges": maven_edges,
        "feign_interfaces": feign_methods,
        "service_boundary": boundary,
    }

    out = OUTPUT_DIR / "impact_db.json"
    print(f"\n写入 {out} ...")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, sort_keys=True)

    size_mb = out.stat().st_size / 1024 / 1024
    print(f"完成! 文件大小: {size_mb:.1f} MB")


if __name__ == "__main__":
    build()
