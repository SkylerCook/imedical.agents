#!/usr/bin/env python3
"""
查询指定方法的调用者

用法: python query_callers.py <方法名或 Class.method>
"""
import json
import sys
from pathlib import Path
from typing import List, Dict, Set
from collections import defaultdict


def _base_id(method_id: str) -> str:
    idx = method_id.find('(')
    return method_id[:idx] if idx > 0 else method_id


def find_callers(jsonl_path: Path, target_method: str) -> Dict:
    """查找调用指定方法的所有调用者（先精确匹配，无结果再模糊匹配）"""

    nodes = {}
    edges = []

    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            data = json.loads(line)
            if data['type'] == 'node':
                nodes[data['id']] = data
            elif data['type'] == 'edge':
                edges.append(data)

    query = _base_id(target_method.strip())
    has_class = '.' in query

    def matches(node_id: str) -> bool:
        base = _base_id(node_id)
        if has_class:
            return base == query or base.endswith(f".{query}")
        return base.rsplit('.', 1)[-1] == query

    targets = {nid for nid in nodes if matches(nid)}
    fuzzy = False
    if not targets:
        fuzzy = True
        if has_class:
            targets = {nid for nid in nodes if query in _base_id(nid)}
        else:
            targets = {nid for nid in nodes if query in _base_id(nid).rsplit('.', 1)[-1]}

    target_bases = {_base_id(nid) for nid in targets}
    if not target_bases:
        # 目标可能是未建模的合成叶子（如 Lombok 生成的 DTO 访问器）
        for e in edges:
            base = _base_id(e['target'])
            hit = (base == query or base.endswith(f".{query}")) if has_class else base.rsplit('.', 1)[-1] == query
            if hit:
                target_bases.add(base)

    callers = [
        e for e in edges
        if _base_id(e['target']) in target_bases
    ]

    return {
        'nodes': nodes,
        'targets': targets,
        'fuzzy': fuzzy,
        'callers': callers,
    }


def main():
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    jsonl_path = PROJECT_ROOT / "docs" / "imedicalxc-doctor-codegraph" / "method_call_graph.jsonl"
    if len(sys.argv) < 2:
        print("用法: python query_callers.py <方法名或 Class.method>")
        return
    target_method = sys.argv[1]
    
    print(f"查询方法: {target_method}")
    print("=" * 80)
    
    result = find_callers(jsonl_path, target_method)
    
    # 显示目标方法节点
    print("\n【目标方法节点】")
    if result['fuzzy']:
        print("  (未找到精确匹配，以下为模糊匹配结果)")
    if not result['targets'] and result['callers']:
        print("  (目标方法未单独建模，按调用边精确匹配)")
    for node_id in sorted(result['targets']):
        node = result['nodes'][node_id]
        print(f"  方法: {node['label']}")
        print(f"  类: {node['class']}")
        print(f"  包: {node['package']}")
        print(f"  服务: {node['service']}")
        print(f"  文件: {node['file_path']}")
        print()
    
    # 显示调用者
    print(f"\n【调用者列表】共 {len(result['callers'])} 个调用")
    for idx, edge in enumerate(result['callers'], 1):
        caller_id = edge['source']
        callee_id = edge['target']
        
        caller_node = result['nodes'].get(caller_id, {})
        callee_node = result['nodes'].get(callee_id, {})
        
        print(f"\n调用 {idx}:")
        print(f"  调用方: {caller_node.get('label', caller_id)}")
        print(f"    - 类: {caller_node.get('class', 'N/A')}")
        print(f"    - 服务: {caller_node.get('service', 'N/A')}")
        print(f"    - 文件: {caller_node.get('file_path', 'N/A')}")
        print(f"  被调用: {callee_node.get('label', callee_id)}")
        print(f"    - 类: {callee_node.get('class', 'N/A')}")
        print(f"    - 服务: {callee_node.get('service', 'N/A')}")
        print(f"  调用类型: {edge['call_type']}")
        if edge.get('feign_interface'):
            print(f"  Feign 接口: {edge['feign_interface']}")
    
    # 统计调用方服务分布
    print("\n\n【调用方服务分布】")
    service_count = defaultdict(int)
    for edge in result['callers']:
        caller_node = result['nodes'].get(edge['source'], {})
        service = caller_node.get('service', 'unknown')
        service_count[service] += 1
    
    for service, count in sorted(service_count.items(), key=lambda x: x[1], reverse=True):
        print(f"  {service}: {count} 次")


if __name__ == "__main__":
    main()
