#!/usr/bin/env python3
"""
构建穿透数据库 (penetration_db.json)

只沉淀两部分穿透关系：
  1. 工作区业务仓库内部的方法调用链；业务方法调用 hiscore/hiscf 等外部方法时，
     外部方法作为叶子节点保留，不继续展开。
  2. 其他组 Maven jar 调用本工作区业务仓库发布的 Feign 接口时，
     从对方 Controller 到本组 Feign 接口的调用链。

输入:
  - method_call_graph.jsonl（Step 2）
  - maven_biz_call_graph.jsonl（Step 3，已做服务级相关性过滤）
  - maven_biz_dispatch.json（Step 3，接口/父类方法 → 实现方法分派桥）
  - feign_interfaces.json（Step 1，本工作区发布的 Feign 接口）

输出:
  - penetration_db.json
  - inbound_feign_penetration.graphml（第二部分的可视化导出）
"""
import json
import logging
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import OUTPUT_DIR, WORKSPACE_SERVICES

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

MAX_PATHS_PER_CALL = 200
MAX_DEPTH = 40


def norm_id(method_id: str) -> str:
    """package.Class.method(params)Ret → package.Class.method"""
    idx = method_id.find('(')
    base = method_id[:idx] if idx > 0 else method_id
    if base.endswith('.<init>'):
        cls = base[:-len('.<init>')]
        return f"{cls}.{cls.rsplit('.', 1)[-1]}"
    if base.endswith('.<clinit>'):
        return base[:-len('.<clinit>')] + '.clinit'
    return base


def class_of(method_id: str) -> str:
    return method_id.rsplit('.', 1)[0] if '.' in method_id else method_id


def service_of(method_id: str) -> str:
    parts = method_id.split('.')
    if len(parts) > 4 and parts[:3] == ['com', 'mediway', 'his']:
        return parts[3]
    return "unknown"


def load_workspace_part(ws_path: Path, business_services: set) -> dict:
    nodes = {}
    edges = {}

    for line in open(ws_path, 'r', encoding='utf-8'):
        item = json.loads(line)
        if item.get('type') == 'node':
            nid = norm_id(item['id'])
            existing = nodes.get(nid)
            if existing is None:
                service = item.get('service') or service_of(nid)
                nodes[nid] = {
                    'label': item.get('label') or f"{class_of(nid).rsplit('.', 1)[-1]}.{nid.rsplit('.', 1)[-1]}",
                    'class': class_of(nid),
                    'method': nid.rsplit('.', 1)[-1],
                    'package': item.get('package') or class_of(nid).rsplit('.', 1)[0],
                    'service': service,
                    'external': service not in business_services,
                    'is_feign': bool(item.get('is_feign')),
                    'synthetic': False,
                }
            elif item.get('is_feign'):
                existing['is_feign'] = True
        elif item.get('type') == 'edge':
            source, target = norm_id(item['source']), norm_id(item['target'])
            target_service = service_of(target)
            call_type = item.get('call_type', 'internal')
            if call_type == 'feign':
                edge_type = 'feign'
            elif target_service in business_services:
                edge_type = 'internal'
            else:
                edge_type = 'external'
            key = (source, target)
            existing = edges.get(key)
            if existing is None or (edge_type == 'feign' and existing != 'feign'):
                edges[key] = edge_type

    for source, target in edges:
        for endpoint in (source, target):
            if endpoint in nodes:
                continue
            service = service_of(endpoint)
            class_name = class_of(endpoint)
            nodes[endpoint] = {
                'label': f"{class_name.rsplit('.', 1)[-1]}.{endpoint.rsplit('.', 1)[-1]}",
                'class': class_name,
                'method': endpoint.rsplit('.', 1)[-1],
                'package': class_name.rsplit('.', 1)[0] if '.' in class_name else '',
                'service': service,
                'external': service not in business_services,
                'is_feign': False,
                'synthetic': True,
            }

    return {
        'nodes': nodes,
        'edges': [{'s': s, 't': t, 'ct': ct} for (s, t), ct in sorted(edges.items())],
    }


def load_maven_graph(call_graph_path: Path, dispatch_path: Path):
    forward = defaultdict(set)
    reverse = defaultdict(set)
    service_map = {}
    real_edges = set()

    for line in open(call_graph_path, 'r', encoding='utf-8'):
        item = json.loads(line)
        source = norm_id(item.get('source', ''))
        if not source:
            continue
        service_map[source] = item.get('source_service') or service_of(source)
        for target_raw in item.get('targets', []):
            target = norm_id(target_raw)
            forward[source].add(target)
            reverse[target].add(source)
            real_edges.add((source, target))

    dispatch_edges = set()
    dispatch = json.load(open(dispatch_path, 'r', encoding='utf-8'))
    for source_raw, targets in dispatch.get('bridges', {}).items():
        source = norm_id(source_raw)
        for target_raw in targets:
            target = norm_id(target_raw)
            # 只按“是否存在”判断，不能用“是否有直接业务调用”判断：
            # 实现方法的业务行为可能全在 lambda 里（只有 dispatch 边），
            # 若要求 target 已在 forward 中，会因处理顺序丢掉接口 → 实现的桥。
            if source == target:
                continue
            if target not in forward[source]:
                forward[source].add(target)
                reverse[target].add(source)
                dispatch_edges.add((source, target))

    controllers = {norm_id(c) for c in dispatch.get('controllers', [])}
    return forward, reverse, service_map, real_edges, dispatch_edges, controllers


def find_controller_paths(caller: str, reverse: dict, controller_classes: set):
    """从调用方沿反向边向上枚举到 Controller 的路径，返回 controller→...→caller 列表。"""
    paths = []
    stack = [(caller, [caller])]
    steps = 0
    while stack and len(paths) < MAX_PATHS_PER_CALL and steps < 200000:
        current, path = stack.pop()
        steps += 1
        if class_of(current) in controller_classes:
            paths.append(list(reversed(path)))
            continue
        if len(path) >= MAX_DEPTH:
            continue
        for parent in sorted(reverse.get(current, ())):
            if parent in path:
                continue
            stack.append((parent, path + [parent]))
    return paths


def find_partial_paths(caller: str, reverse: dict, max_paths: int = 3):
    """无 Controller 上游时，返回从最深可达祖先到调用方的部分链路。"""
    deepest = []
    best_len = 0
    stack = [(caller, [caller])]
    steps = 0
    while stack and steps < 200000 and len(deepest) < max_paths:
        current, path = stack.pop()
        steps += 1
        parents = sorted(p for p in reverse.get(current, ()) if p not in path)
        if not parents:
            if len(path) > best_len:
                best_len = len(path)
                deepest = [list(reversed(path))]
            elif len(path) == best_len and len(deepest) < max_paths:
                deepest.append(list(reversed(path)))
            continue
        if len(path) >= MAX_DEPTH:
            continue
        for parent in parents:
            stack.append((parent, path + [parent]))
    return deepest


def load_maven_endpoints(path: Path) -> dict:
    """(controller_fqn, method) → [{http, path}]；产物缺失时返回空，保持旧行为。"""
    if not path.exists():
        logger.warning(f"未找到 {path.name}，穿透链路不带 URL（先运行 build_maven_biz_graph.py）")
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning(f"{path.name} 无法解析，穿透链路不带 URL")
        return {}
    index = defaultdict(list)
    for items in data.get("endpoints", {}).values():
        for ep in items:
            index[(ep["controller_fqn"], ep["method"])].append({
                "http": ep.get("http", ""),
                "path": ep["path"],
            })
    return index


def build_inbound_part(call_graph_path: Path, dispatch_path: Path, feign_path: Path,
                       business_services: set, endpoint_index: dict = None) -> dict:
    endpoint_index = endpoint_index or {}
    feign_data = json.load(open(feign_path, 'r', encoding='utf-8'))
    feign_classes = {
        i['full_name'] for i in feign_data.get('interfaces', [])
        if service_of(i['full_name']) in business_services
    }

    forward, reverse, service_map, real_edges, dispatch_edges, controllers = load_maven_graph(
        call_graph_path, dispatch_path
    )

    nodes = {}
    edges = {}

    def ensure_node(nid: str):
        if nid in nodes:
            return
        class_name = class_of(nid)
        nodes[nid] = {
            'label': f"{class_name.rsplit('.', 1)[-1]}.{nid.rsplit('.', 1)[-1]}",
            'class': class_name,
            'method': nid.rsplit('.', 1)[-1],
            'package': class_name.rsplit('.', 1)[0] if '.' in class_name else '',
            'service': service_map.get(nid) or service_of(nid),
            'is_feign': False,
            'is_controller': class_of(nid) in controllers,
        }

    chains = []
    call_sites = 0
    for source in sorted(forward):
        for target in sorted(forward[source]):
            if class_of(target) not in feign_classes:
                continue
            call_sites += 1
            ensure_node(source)
            ensure_node(target)
            nodes[target].update({
                'service': service_of(target),
                'is_feign': True,
                'external': False,
            })

            paths = find_controller_paths(source, reverse, controllers)
            partial_paths = []
            if paths:
                root_type = 'controller'
                controller = paths[0][0]
            else:
                root_type = 'method'
                controller = ''
                paths = [[source]]
                partial_paths = find_partial_paths(source, reverse)

            for path in paths + partial_paths:
                for node_id in path:
                    ensure_node(node_id)
                for left, right in zip(path, path[1:]):
                    key = (left, right)
                    if edges.get(key) != 'call':
                        edges[key] = 'call' if key in real_edges else 'dispatch'

            feign_edge = (source, target)
            edges[feign_edge] = 'feign'

            chain_endpoints = []
            if controller:
                ctrl_class = class_of(controller)
                method_name = controller.rsplit('.', 1)[-1]
                eps = endpoint_index.get((ctrl_class, method_name))
                if not eps and method_name.startswith('lambda$'):
                    # lambda 合成方法没有注解，URL 属于外层 Controller 方法
                    eps = endpoint_index.get((ctrl_class, method_name.split('$')[1]))
                chain_endpoints = sorted(eps or [], key=lambda ep: (ep['path'], ep['http']))

            chains.append({
                'feign': target,
                'publisher': service_of(target),
                'caller': source,
                'service': service_map.get(source) or service_of(source),
                'root_type': root_type,
                'controller': controller,
                'endpoints': chain_endpoints,
                'paths': paths,
                'partial_paths': partial_paths,
            })

    # 反向遍历依赖集合顺序，最终按稳定键排序，保证 db 可逐字节复现
    chains.sort(key=lambda c: (
        c['feign'], c['caller'], c['root_type'], c['controller'],
        tuple(tuple(p) for p in c['paths']),
        tuple(tuple(p) for p in c['partial_paths']),
    ))

    return {
        'nodes': nodes,
        'edges': [
            {'s': s, 't': t, 'svc': service_map.get(s) or service_of(s), 'ct': ct}
            for (s, t), ct in sorted(edges.items())
        ],
        'chains': chains,
        'stats': {
            'call_sites': call_sites,
            'controller_rooted': sum(1 for c in chains if c['root_type'] == 'controller'),
            'method_rooted': sum(1 for c in chains if c['root_type'] == 'method'),
            'method_rooted_with_upstream': sum(
                1 for c in chains if c['root_type'] == 'method' and c.get('partial_paths')
            ),
            'controller_rooted_with_url': sum(
                1 for c in chains if c['root_type'] == 'controller' and c.get('endpoints')
            ),
            'feign_interfaces': len({class_of(c['feign']) for c in chains}),
            'services': sorted({c['service'] for c in chains}),
            'dispatch_edges_used': sum(1 for ct in edges.values() if ct == 'dispatch'),
        },
    }


def export_graphml(part: dict, output_path: Path, graph_name: str):
    def esc(value):
        return (str(value).replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">')
    lines.append('  <key id="label" for="node" attr.name="label" attr.type="string"/>')
    lines.append('  <key id="type" for="node" attr.name="type" attr.type="string"/>')
    lines.append('  <key id="service" for="node" attr.name="service" attr.type="string"/>')
    lines.append('  <key id="call_type" for="edge" attr.name="call_type" attr.type="string"/>')
    lines.append(f'  <graph id="{graph_name}" edgedefault="directed">')

    for node_id in sorted(part['nodes']):
        info = part['nodes'][node_id]
        node_type = 'feign' if info.get('is_feign') else (
            'controller' if info.get('is_controller') else 'method')
        lines.append(f'    <node id="{esc(node_id)}">')
        lines.append(f'      <data key="label">{esc(info["label"])}</data>')
        lines.append(f'      <data key="type">{node_type}</data>')
        lines.append(f'      <data key="service">{esc(info["service"])}</data>')
        lines.append('    </node>')

    for idx, edge in enumerate(part['edges']):
        lines.append(
            f'    <edge id="e{idx}" source="{esc(edge["s"])}" target="{esc(edge["t"])}">'
            f'<data key="call_type">{esc(edge["ct"])}</data></edge>'
        )

    lines.append('  </graph>')
    lines.append('</graphml>')
    output_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    logger.info(f"✓ GraphML 已导出: {output_path}（节点 {len(part['nodes'])}，边 {len(part['edges'])}）")


def main():
    ws_path = OUTPUT_DIR / "method_call_graph.jsonl"
    maven_path = OUTPUT_DIR / "maven_biz_call_graph.jsonl"
    dispatch_path = OUTPUT_DIR / "maven_biz_dispatch.json"
    feign_path = OUTPUT_DIR / "feign_interfaces.json"
    for path in (ws_path, maven_path, dispatch_path, feign_path):
        if not path.exists():
            print(f"[ERROR] 缺少输入: {path}")
            sys.exit(1)

    feign_data = json.load(open(feign_path, 'r', encoding='utf-8'))
    business_services = set(WORKSPACE_SERVICES)

    logger.info("构建第一部分: 工作区业务仓库内部调用关系")
    workspace = load_workspace_part(ws_path, business_services)
    logger.info(
        f"  节点 {len(workspace['nodes'])}（外部叶子 "
        f"{sum(1 for n in workspace['nodes'].values() if n['external'])}），边 {len(workspace['edges'])}"
    )

    logger.info("构建第二部分: Maven 调用方 → 本工作区 Feign")
    endpoint_index = load_maven_endpoints(OUTPUT_DIR / "maven_controller_endpoints.json")
    inbound = build_inbound_part(maven_path, dispatch_path, feign_path, business_services,
                                 endpoint_index)
    logger.info(
        f"  调用点 {inbound['stats']['call_sites']}，Controller 根链路 "
        f"{inbound['stats']['controller_rooted']}（带 URL "
        f"{inbound['stats']['controller_rooted_with_url']}），非 Controller 根 "
        f"{inbound['stats']['method_rooted']}，服务 {len(inbound['stats']['services'])}"
    )

    db = {
        'workspace': workspace,
        'inbound_feign': inbound,
        'stats': {
            'workspace_nodes': len(workspace['nodes']),
            'workspace_edges': len(workspace['edges']),
            'workspace_external_nodes': sum(1 for n in workspace['nodes'].values() if n['external']),
            'inbound': inbound['stats'],
        },
    }
    out = OUTPUT_DIR / "penetration_db.json"
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, sort_keys=True)
    logger.info(f"✓ 穿透数据库已导出: {out}（{out.stat().st_size / 1024 / 1024:.1f} MB）")

    export_graphml(inbound, OUTPUT_DIR / "inbound_feign_penetration.graphml", "InboundFeignPenetration")


if __name__ == "__main__":
    main()
