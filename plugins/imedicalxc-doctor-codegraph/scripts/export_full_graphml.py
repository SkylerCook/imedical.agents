#!/usr/bin/env python3
"""
导出完整合并调用图（工作区 + Maven biz jar）为 GraphML

输入: merged_call_graph.jsonl, feign_interfaces.json
输出: full_call_graph.graphml
"""
import json
import xml.sax.saxutils as saxutils
from pathlib import Path
from collections import defaultdict
import logging
import sys

sys.path.insert(0, str(Path(__file__).parent))
from config import is_system_class, OUTPUT_DIR

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def esc(s):
    return saxutils.escape(str(s))


def esc_attr(s):
    return saxutils.quoteattr(str(s))


def infer_service(method_id: str) -> str:
    parts = method_id.split('.')
    if len(parts) >= 4 and parts[0] == 'com' and parts[1] == 'mediway' and parts[2] == 'his':
        return parts[3]
    return 'unknown'


def infer_source(method_id: str) -> str:
    service = infer_service(method_id)
    workspace_services = {'opcare', 'ipcare', 'aggcare', 'hispa', 'curc', 'ma',
                          'opalloc', 'opreg', 'cfmr', 'cfoe', 'commr', 'comoe'}
    return 'workspace' if service in workspace_services else 'maven'


def infer_type(method_id: str) -> str:
    if '.feign.' in method_id or 'Client' in method_id.split('.')[-1]:
        return 'feign'
    if '.controller.' in method_id or '.web.' in method_id:
        return 'controller'
    if '.blh.' in method_id:
        return 'blh'
    if '.service.' in method_id:
        return 'service'
    if '.mapper.' in method_id or '.dao.' in method_id:
        return 'mapper'
    return 'method'


def export_full_graphml(data_dir: Path, output_path: Path):
    logger.info("加载合并调用图...")
    call_graph = defaultdict(list)
    all_nodes = set()

    jsonl_path = data_dir / 'merged_call_graph.jsonl'
    filtered_nodes = 0
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            entry = json.loads(line)
            source = entry['source']
            targets = entry.get('targets', [])
            if is_system_class(source):
                filtered_nodes += 1
                continue
            all_nodes.add(source)
            for t in targets:
                if is_system_class(t):
                    filtered_nodes += 1
                    continue
                all_nodes.add(t)
                call_graph[source].append(t)

    logger.info(f"  节点数: {len(all_nodes)}")
    logger.info(f"  边数: {sum(len(v) for v in call_graph.values())}")
    logger.info(f"  已过滤系统节点/边: {filtered_nodes}")

    # 统计服务
    services = defaultdict(int)
    sources = defaultdict(int)
    for node in all_nodes:
        svc = infer_service(node)
        src = infer_source(node)
        services[svc] += 1
        sources[src] += 1
    logger.info(f"  涉及服务: {len(services)}")
    for svc, cnt in sorted(services.items(), key=lambda x: -x[1])[:15]:
        logger.info(f"    {svc}: {cnt} 节点")
    logger.info(f"  来源分布: workspace={sources.get('workspace',0)}, maven={sources.get('maven',0)}")

    # 构建 GraphML
    logger.info("生成 GraphML...")
    sorted_nodes = sorted(all_nodes)
    node_id_map = {nid: f"n{i}" for i, nid in enumerate(sorted_nodes)}

    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">')
    lines.append('  <key id="d0" for="node" attr.name="label" attr.type="string"/>')
    lines.append('  <key id="d1" for="node" attr.name="shortLabel" attr.type="string"/>')
    lines.append('  <key id="d2" for="node" attr.name="type" attr.type="string"/>')
    lines.append('  <key id="d3" for="node" attr.name="service" attr.type="string"/>')
    lines.append('  <key id="d4" for="node" attr.name="source" attr.type="string"/>')
    lines.append('  <graph id="G" edgedefault="directed">')

    for nid in sorted_nodes:
        gid = node_id_map[nid]
        short_label = nid.split('.')[-1] if '.' in nid else nid
        if '(' in short_label:
            short_label = short_label.split('(')[0]
        node_type = infer_type(nid)
        node_service = infer_service(nid)
        node_source = infer_source(nid)

        lines.append(f'    <node id={esc_attr(gid)}>')
        lines.append(f'      <data key="d0">{esc(nid)}</data>')
        lines.append(f'      <data key="d1">{esc(short_label)}</data>')
        lines.append(f'      <data key="d2">{esc(node_type)}</data>')
        lines.append(f'      <data key="d3">{esc(node_service)}</data>')
        lines.append(f'      <data key="d4">{esc(node_source)}</data>')
        lines.append(f'    </node>')

    edge_count = 0
    for src in sorted(call_graph):
        src_gid = node_id_map[src]
        for tgt in sorted(call_graph[src]):
            if tgt in node_id_map:
                tgt_gid = node_id_map[tgt]
                lines.append(f'    <edge id="e{edge_count}" source={esc_attr(src_gid)} target={esc_attr(tgt_gid)}/>')
                edge_count += 1

    lines.append('  </graph>')
    lines.append('</graphml>')

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    logger.info(f"✓ GraphML 已导出: {output_path}")
    logger.info(f"  节点: {len(node_id_map)}")
    logger.info(f"  边: {edge_count}")


def main():
    data_dir = OUTPUT_DIR
    output_path = data_dir / "full_call_graph.graphml"
    export_full_graphml(data_dir, output_path)


if __name__ == '__main__':
    main()
