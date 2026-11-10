#!/usr/bin/env python3
"""
查询指定方法调用了哪些 Feign 接口

用法: python query_method_feign.py <方法名或 Class.method>
"""
import json
import sys
from pathlib import Path
from collections import defaultdict


def _base_id(method_id: str) -> str:
    idx = method_id.find('(')
    return method_id[:idx] if idx > 0 else method_id


def query_method_feign_calls(jsonl_path: Path, method_keyword: str):
    """查询指定方法调用的 Feign 接口（先精确匹配，无结果再模糊匹配）"""

    nodes = {}
    edges = []

    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            data = json.loads(line)
            if data['type'] == 'node':
                nodes[data['id']] = data
            elif data['type'] == 'edge':
                edges.append(data)

    query = _base_id(method_keyword.strip())
    has_class = '.' in query

    def matches(node_id: str) -> bool:
        base = _base_id(node_id)
        if has_class:
            return base == query or base.endswith(f".{query}")
        return base.rsplit('.', 1)[-1] == query

    target_node_ids = [nid for nid in nodes if matches(nid)]
    fuzzy = False
    if not target_node_ids:
        fuzzy = True
        target_node_ids = [
            nid for nid in nodes
            if query in _base_id(nid)
        ]

    matched_sources = set(target_node_ids)
    feign_calls = [
        e for e in edges
        if e['source'] in matched_sources and e['call_type'] == 'feign'
    ]

    return nodes, target_node_ids, feign_calls, fuzzy


def main():
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    jsonl_path = PROJECT_ROOT / "docs" / "imedicalxc-doctor-codegraph" / "method_call_graph.jsonl"
    if len(sys.argv) < 2:
        print("用法: python query_method_feign.py <方法名或 Class.method>")
        return
    method_keyword = sys.argv[1]
    
    print(f"查询方法: {method_keyword}")
    print("=" * 80)
    
    nodes, target_ids, feign_calls, fuzzy = query_method_feign_calls(jsonl_path, method_keyword)
    
    if not target_ids:
        print("\n❌ 未找到匹配的方法节点")
        return
    
    # 显示目标方法信息
    print(f"\n【目标方法】找到 {len(target_ids)} 个匹配节点")
    if fuzzy:
        print("  (未找到精确匹配，以下为模糊匹配结果)")
    for node_id in sorted(target_ids):
        node = nodes[node_id]
        print(f"  方法: {node['label']}")
        print(f"  类: {node['class']}")
        print(f"  服务: {node['service']}")
        print(f"  文件: {node['file_path']}")
        print()
    
    # 显示 Feign 调用
    print(f"\n【Feign 调用】共 {len(feign_calls)} 个直接调用")
    
    if not feign_calls:
        print("  该方法没有直接调用 Feign 接口")
        print("  提示: Controller 边界推导出的 Feign 映射请用")
        print("        python impact_analyzer.py <方法> --impact 的第三节查看")
        return
    
    # 按 Feign 接口分组
    feign_interfaces = defaultdict(list)
    for call in feign_calls:
        feign_interface = call.get('feign_interface', 'unknown')
        feign_interfaces[feign_interface].append(call)
    
    print(f"\n【调用的 Feign 接口】共 {len(feign_interfaces)} 个")
    for idx, (interface, calls) in enumerate(feign_interfaces.items(), 1):
        # 获取接口信息
        callee_node = nodes.get(calls[0]['target'], {})
        
        print(f"\n{idx}. {interface}")
        print(f"   调用次数: {len(calls)}")
        if callee_node:
            print(f"   目标服务: {callee_node.get('service', 'N/A')}")
            print(f"   目标类: {callee_node.get('class', 'N/A')}")
        
        # 显示调用的方法
        methods = set()
        for call in calls:
            target = call['target']
            if '.' in target:
                method_name = target.split('.')[-1].split('(')[0]
                methods.add(method_name)
        
        print(f"   调用方法: {', '.join(sorted(methods))}")
    
    # 详细调用列表
    print(f"\n【详细调用列表】")
    for idx, call in enumerate(feign_calls, 1):
        caller_node = nodes.get(call['source'], {})
        callee_node = nodes.get(call['target'], {})
        
        caller_label = caller_node.get('label', call['source'])
        callee_label = callee_node.get('label', call['target'])
        feign_interface = call.get('feign_interface', 'N/A')
        
        print(f"  {idx}. {caller_label} → {feign_interface}")


if __name__ == "__main__":
    main()
