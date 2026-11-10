#!/usr/bin/env python3
"""
查询指定 Feign Client 所有方法的调用情况

用法: python query_feign_client.py <Client 短名或全限定名>
"""
import json
import sys
from pathlib import Path
from collections import defaultdict


def _base_id(method_id: str) -> str:
    idx = method_id.find('(')
    return method_id[:idx] if idx > 0 else method_id


def load_feign_index(feign_path: Path):
    with open(feign_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    full_map = {}
    simple_map = defaultdict(list)
    for iface in data.get('interfaces', []):
        full = iface['full_name']
        simple = iface.get('class_name') or full.rsplit('.', 1)[-1]
        full_map[full] = iface
        simple_map[simple].append(full)
    return full_map, simple_map


def query_feign_client(jsonl_path: Path, client_full_name: str):
    nodes = {}
    edges = []

    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            data = json.loads(line)
            if data['type'] == 'node':
                nodes[data['id']] = data
            elif data['type'] == 'edge':
                edges.append(data)

    matched = []
    invalid = 0
    for edge in edges:
        feign_interface = edge.get('feign_interface') or ''
        if feign_interface:
            hit = feign_interface == client_full_name
        else:
            target_class = _base_id(edge.get('target', '')).rsplit('.', 1)[0]
            hit = edge.get('call_type') == 'feign' and target_class == client_full_name
        if not hit:
            continue
        if edge.get('call_type') != 'feign':
            invalid += 1
            continue
        matched.append(edge)

    return nodes, matched, invalid


def main():
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    output_dir = PROJECT_ROOT / "docs" / "imedicalxc-doctor-codegraph"
    jsonl_path = output_dir / "method_call_graph.jsonl"
    feign_path = output_dir / "feign_interfaces.json"

    if len(sys.argv) < 2:
        print("用法: python query_feign_client.py <Client 短名或全限定名>")
        return

    client_name = sys.argv[1].strip()
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

    iface = full_map[client_full]
    declared_methods = [m.get('name', '') for m in iface.get('methods', [])]

    print(f"查询 Feign Client: {client_full}")
    print("=" * 80)
    print(f"  声明方法数: {len(declared_methods)}")

    nodes, edges, invalid = query_feign_client(jsonl_path, client_full)

    method_calls = defaultdict(list)
    for edge in edges:
        method_name = _base_id(edge['target']).rsplit('.', 1)[-1]
        method_calls[method_name].append(edge)

    print(f"  被调用方法数: {len(method_calls)}")
    print(f"  总调用次数: {len(edges)}")
    if invalid:
        print(f"  忽略非法 Feign 边: {invalid}")

    if not edges:
        print("\n  该 Feign Client 暂无工作区内的直接调用边。")
        print("  跨服务/外部调用方请用 query_who_calls_feign.py 查询。")
        return

    print("\n【各方法调用次数】")
    for method, calls in sorted(method_calls.items(), key=lambda x: len(x[1]), reverse=True):
        declared = "" if method in declared_methods else "  [未在接口声明]"
        print(f"  {method}: {len(calls)} 次{declared}")

    print("\n【调用方服务分布】")
    service_count = defaultdict(int)
    for edge in edges:
        caller_node = nodes.get(edge['source'], {})
        service_count[caller_node.get('service', 'unknown')] += 1
    for service, count in sorted(service_count.items(), key=lambda x: x[1], reverse=True):
        print(f"  {service}: {count} 次")

    print("\n【详细调用列表（前 20 条）】")
    for idx, edge in enumerate(edges[:20], 1):
        caller_node = nodes.get(edge['source'], {})
        callee_node = nodes.get(edge['target'], {})
        caller_label = caller_node.get('label', _base_id(edge['source']))
        callee_label = callee_node.get('label', edge['target'])
        caller_service = caller_node.get('service', 'unknown')
        print(f"  {idx}. {caller_service}.{caller_label} → {callee_label}")


if __name__ == "__main__":
    main()
