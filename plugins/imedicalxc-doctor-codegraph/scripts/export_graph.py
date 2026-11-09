#!/usr/bin/env python3
"""
生成 Feign 调用图的 GraphML 文件
可用于 Gephi 等图分析工具
"""
import json
from pathlib import Path
from collections import defaultdict
import xml.etree.ElementTree as ET
from xml.dom import minidom


def generate_graphml(call_chains_path: Path, output_path: Path):
    """生成 GraphML 文件"""
    
    # 加载调用链数据
    with open(call_chains_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    chains = data['chains']
    
    # 统计服务间调用
    service_edges = defaultdict(lambda: {'count': 0, 'methods': []})
    services = set()
    
    for chain in chains:
        source = chain['caller_service']
        target = chain['target_service']
        
        services.add(source)
        services.add(target)
        
        edge_key = f"{source}|{target}"
        service_edges[edge_key]['count'] += 1
        service_edges[edge_key]['source'] = source
        service_edges[edge_key]['target'] = target
        service_edges[edge_key]['methods'].append({
            'caller_class': chain['caller_class'],
            'caller_method': chain['caller_method'],
            'feign_interface': chain['feign_interface'],
            'feign_method': chain['feign_method'],
        })
    
    # 创建 GraphML
    graphml = ET.Element('graphml')
    graphml.set('xmlns', 'http://graphml.graphdrawing.org/xmlns')
    graphml.set('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    graphml.set('xsi:schemaLocation', 'http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd')
    
    # 定义属性
    keys = [
        ('label', 'string', 'node', '服务名称'),
        ('type', 'string', 'node', '节点类型'),
        ('call_count', 'int', 'edge', '调用次数'),
        ('methods', 'string', 'edge', '调用方法列表'),
    ]
    
    for key_id, key_type, key_for, key_desc in keys:
        key_elem = ET.SubElement(graphml, 'key')
        key_elem.set('id', key_id)
        key_elem.set('attr.name', key_id)
        key_elem.set('attr.type', key_type)
        key_elem.set('for', key_for)
        desc_elem = ET.SubElement(key_elem, 'desc')
        desc_elem.text = key_desc
    
    # 创建图
    graph = ET.SubElement(graphml, 'graph')
    graph.set('id', 'FeignCallGraph')
    graph.set('edgedefault', 'directed')
    
    # 添加节点（服务）
    service_colors = {
        'opcare-mediway-server': '#4CAF50',
        'ipcare-mediway-server': '#2196F3',
        'aggcare-mediway-server': '#FF9800',
        'opreg-mediway-server': '#9C27B0',
        'hispa-mediway-server': '#F44336',
        'ma-mediway-server': '#00BCD4',
        'curc-mediway-server': '#8BC34A',
        'opalloc-mediway-server': '#FF5722',
        'comoe-mediway-server': '#607D8B',
    }
    
    for service in services:
        node = ET.SubElement(graph, 'node')
        node.set('id', service)
        
        # 标签
        label_data = ET.SubElement(node, 'data')
        label_data.set('key', 'label')
        label_data.text = service.replace('-mediway-server', '')
        
        # 类型
        type_data = ET.SubElement(node, 'data')
        type_data.set('key', 'type')
        type_data.text = 'service'
    
    # 添加边（调用关系）
    for idx, (edge_key, edge_data) in enumerate(service_edges.items()):
        edge = ET.SubElement(graph, 'edge')
        edge.set('id', f'e{idx}')
        edge.set('source', edge_data['source'])
        edge.set('target', edge_data['target'])
        
        # 调用次数
        count_data = ET.SubElement(edge, 'data')
        count_data.set('key', 'call_count')
        count_data.text = str(edge_data['count'])
        
        # 方法列表（简化）
        methods_summary = []
        for method in edge_data['methods'][:5]:  # 只显示前5个
            methods_summary.append(f"{method['caller_class']}.{method['caller_method']} → {method['feign_interface'].split('.')[-1]}.{method['feign_method']}")
        
        methods_data = ET.SubElement(edge, 'data')
        methods_data.set('key', 'methods')
        methods_data.text = '; '.join(methods_summary)
    
    # 格式化输出
    xml_str = ET.tostring(graphml, encoding='unicode')
    dom = minidom.parseString(xml_str)
    pretty_xml = dom.toprettyxml(indent='  ')
    
    # 写入文件
    output_path.write_text(pretty_xml, encoding='utf-8')
    print(f"✓ GraphML 已生成: {output_path}")
    print(f"  节点数: {len(services)}")
    print(f"  边数: {len(service_edges)}")


def generate_jsonl(call_chains_path: Path, output_path: Path):
    """生成 JSONL 格式的图数据"""
    
    # 加载调用链数据
    with open(call_chains_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    chains = data['chains']
    
    # 统计服务间调用
    service_edges = defaultdict(lambda: {'count': 0, 'methods': []})
    services = set()
    
    for chain in chains:
        source = chain['caller_service']
        target = chain['target_service']
        
        services.add(source)
        services.add(target)
        
        edge_key = f"{source}|{target}"
        service_edges[edge_key]['count'] += 1
        service_edges[edge_key]['source'] = source
        service_edges[edge_key]['target'] = target
    
    # 写入 JSONL
    with open(output_path, 'w', encoding='utf-8') as f:
        # 写入节点
        for service in services:
            node = {
                'type': 'node',
                'id': service,
                'label': service.replace('-mediway-server', ''),
                'node_type': 'service',
            }
            f.write(json.dumps(node, ensure_ascii=False) + '\n')
        
        # 写入边
        for edge_key, edge_data in service_edges.items():
            edge = {
                'type': 'edge',
                'source': edge_data['source'],
                'target': edge_data['target'],
                'call_count': edge_data['count'],
                'label': f"{edge_data['count']} 次调用",
            }
            f.write(json.dumps(edge, ensure_ascii=False) + '\n')
    
    print(f"✓ JSONL 已生成: {output_path}")
    print(f"  节点数: {len(services)}")
    print(f"  边数: {len(service_edges)}")


if __name__ == "__main__":
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    output_dir = PROJECT_ROOT / "docs" / "imedicalxc-doctor-codegraph"
    call_chains_path = output_dir / "feign_call_chains.json"
    
    # 生成 GraphML（Gephi 格式）
    graphml_path = output_dir / "feign_call_graph.graphml"
    generate_graphml(call_chains_path, graphml_path)
    
    # 生成 JSONL（通用格式）
    jsonl_path = output_dir / "feign_call_graph.jsonl"
    generate_jsonl(call_chains_path, jsonl_path)
