#!/usr/bin/env python3
"""
递归穿透追踪跨服务 Feign 调用链

输入：
- merged_call_graph.jsonl
- merged_reverse_index.json
- merged_service_boundary.json

输出：
- recursive_feign_chains.json
- recursive_feign_chain_graph.graphml
"""
import json
import sys
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Set
from dataclasses import dataclass, field
import logging

sys.path.insert(0, str(Path(__file__).parent))
from config import OUTPUT_DIR

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@dataclass
class ChainNode:
    """调用链节点"""
    type: str  # method / feign / controller
    id: str
    service: str
    source: str  # workspace / maven


@dataclass
class CallChain:
    """调用链"""
    nodes: List[ChainNode] = field(default_factory=list)

    def to_dict(self):
        return {
            'length': len(self.nodes),
            'path': [
                {'type': n.type, 'id': n.id, 'service': n.service, 'source': n.source}
                for n in self.nodes
            ],
        }


class RecursiveFeignTracer:
    """递归 Feign 追踪器"""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.call_graph = defaultdict(list)
        self.reverse_index = defaultdict(list)
        self.service_boundary = {}
        self.method_service = {}
        self.feign_interfaces = set()
        self.all_chains = []

    def load_data(self):
        """加载合并后的数据"""
        logger.info("加载数据...")

        call_graph_path = self.data_dir / 'merged_call_graph.jsonl'
        if call_graph_path.exists():
            with open(call_graph_path, 'r', encoding='utf-8') as f:
                for line in f:
                    entry = json.loads(line)
                    source = entry['source']
                    targets = entry['targets']
                    self.call_graph[source].extend(targets)

        reverse_index_path = self.data_dir / 'merged_reverse_index.json'
        if reverse_index_path.exists():
            with open(reverse_index_path, 'r', encoding='utf-8') as f:
                self.reverse_index = defaultdict(list, json.load(f))

        service_boundary_path = self.data_dir / 'merged_service_boundary.json'
        if service_boundary_path.exists():
            with open(service_boundary_path, 'r', encoding='utf-8') as f:
                self.service_boundary = json.load(f)

        for controller, feign in self.service_boundary.items():
            self.feign_interfaces.add(feign)

        # 加载已知 Feign 接口（从工作区扫描和 Maven API 扫描）
        feign_interfaces_path = self.data_dir / 'feign_interfaces.json'
        if feign_interfaces_path.exists():
            with open(feign_interfaces_path, 'r', encoding='utf-8') as f:
                feign_data = json.load(f)
                for iface in feign_data.get('interfaces', []):
                    self.feign_interfaces.add(iface.get('full_name', ''))

        maven_api_scan_path = self.data_dir / 'maven_api_scan.json'
        if maven_api_scan_path.exists():
            with open(maven_api_scan_path, 'r', encoding='utf-8') as f:
                api_data = json.load(f)
                for iface in api_data.get('feign_interfaces', []):
                    self.feign_interfaces.add(iface.get('full_name', ''))

        # 从调用关系中发现更多 Feign 接口
        for source, targets in self.call_graph.items():
            for target in targets:
                if self._is_feign(target):
                    self.feign_interfaces.add(target.rsplit('.', 1)[0] if '.' in target else target)

        logger.info(f"  调用关系: {sum(len(v) for v in self.call_graph.values())}")
        logger.info(f"  反向索引: {sum(len(v) for v in self.reverse_index.values())}")
        logger.info(f"  服务边界: {len(self.service_boundary)}")
        logger.info(f"  Feign 接口: {len(self.feign_interfaces)}")

    def trace_all(self, start_methods: List[str] = None, max_depth: int = 10):
        """追踪所有调用链"""
        logger.info("开始递归追踪...")

        if start_methods is None:
            # 优化：只从直接调用 Feign 的方法开始，而非所有工作区方法
            start_methods = [m for m in self.call_graph.keys()
                           if self._infer_source(m) == 'workspace' and self._get_feign_calls(m)]

        logger.info(f"  起始方法（调用 Feign 的）: {len(start_methods)}")

        for i, start_method in enumerate(start_methods, 1):
            if i % 100 == 0:
                logger.info(f"  进度: {i}/{len(start_methods)}")
            chains = self._trace_recursive(start_method, max_depth)
            self.all_chains.extend(chains)

        logger.info(f"\n追踪完成! 共 {len(self.all_chains)} 条调用链")

    def _trace_recursive(self, start_method: str, max_depth: int) -> List[CallChain]:
        """递归追踪单个起始方法（正向穿透）"""
        chains = []
        visited = set()  # 防止循环

        def _get_class_methods(class_name: str) -> List[str]:
            """获取某个类的所有方法（从 call_graph 的 key 中匹配）"""
            prefix = class_name + '.'
            return [k for k in self.call_graph if k.startswith(prefix)]

        def _get_all_callees(method_id: str) -> List[str]:
            """获取一个方法调用的所有目标（含内部+Feign）"""
            return self.call_graph.get(method_id, [])

        def dfs_forward(current_method: str, depth: int, path: List[ChainNode], visited_services: Set[str]):
            """正向追踪：从方法 → Feign → Controller → 实现方法 → ..."""
            if depth > max_depth or current_method in visited:
                return
            visited.add(current_method)

            current_service = self._infer_service(current_method)

            # 获取当前方法调用的 Feign 接口
            feign_calls = self._get_feign_calls(current_method)

            if not feign_calls:
                # 没有 Feign 调用，检查是否有内部调用可以继续追踪
                all_callees = _get_all_callees(current_method)
                internal_callees = [c for c in all_callees if not self._is_feign(c)]

                if internal_callees and depth < max_depth:
                    # 继续追踪内部调用（Controller → BLH → Service）
                    for callee in internal_callees[:5]:
                        callee_service = self._infer_service(callee)
                        if callee_service == current_service or callee_service == 'unknown':
                            new_path = path + [
                                ChainNode(
                                    type='method', id=current_method,
                                    service=current_service, source=self._infer_source(current_method),
                                ),
                            ]
                            dfs_forward(callee, depth + 1, new_path, visited_services.copy())
                    visited.discard(current_method)
                    return

                # 完全没有后续调用，链结束
                if len(path) > 1:
                    chains.append(CallChain(nodes=path.copy()))
                visited.remove(current_method)
                return

            for feign_target in feign_calls:
                # 提取 Feign 接口类名
                feign_class = feign_target.rsplit('.', 1)[0] if '(' in feign_target else feign_target.rsplit('.', 1)[0]

                # 推断目标服务
                target_service = self._infer_service(feign_class)

                # 避免在同一服务内循环
                if target_service in visited_services and target_service == current_service:
                    continue

                new_path = path + [
                    ChainNode(
                        type='method', id=current_method,
                        service=current_service, source=self._infer_source(current_method),
                    ),
                    ChainNode(
                        type='feign', id=feign_class,
                        service=target_service, source='workspace',
                    ),
                ]

                # 查找暴露此 Feign 的 Controller
                controller = self._find_controller_for_feign(feign_class)

                if controller:
                    controller_service = self._infer_service(controller)
                    new_path.append(ChainNode(
                        type='controller', id=controller,
                        service=controller_service, source=self._infer_source(controller),
                    ))

                    # 关键修复：查找 Controller 类下所有方法的调用
                    controller_methods = _get_class_methods(controller)

                    if controller_methods:
                        # 收集 Controller 调用的所有实现方法（BLH/Service）
                        impl_methods = []
                        for cm in controller_methods:
                            callees = _get_all_callees(cm)
                            for c in callees:
                                if not self._is_feign(c):
                                    impl_methods.append(c)

                        if impl_methods:
                            new_visited = visited_services.copy()
                            new_visited.add(controller_service)
                            # 递归追踪 Controller → BLH → Service → 下一层 Feign
                            for impl_method in impl_methods[:5]:
                                dfs_forward(impl_method, depth + 1, new_path.copy(), new_visited)
                        else:
                            chains.append(CallChain(nodes=new_path))
                    else:
                        # Controller 方法不在 call_graph 中（可能是工作区未扫描 Controller 出边）
                        # 尝试通过类名推断 BLH/Service 并查找
                        blh_methods = self._find_blh_for_controller(controller)
                        if blh_methods:
                            new_visited = visited_services.copy()
                            new_visited.add(controller_service)
                            for blh_m in blh_methods[:5]:
                                dfs_forward(blh_m, depth + 1, new_path.copy(), new_visited)
                        else:
                            chains.append(CallChain(nodes=new_path))
                else:
                    # 没有找到 Controller，链结束
                    chains.append(CallChain(nodes=new_path))

            visited.remove(current_method)

        dfs_forward(start_method, 0, [], set())
        return chains

    def _find_blh_for_controller(self, controller_class: str) -> List[str]:
        """通过命名约定查找 Controller 对应的 BLH 类的方法"""
        # Controller: com.mediway.his.opcare.xxx.IpBookMedicalRecordClientController
        # BLH: com.mediway.his.opcare.xxx.blh.IpBookMedicalRecordBLH
        # 或 Service: com.mediway.his.opcare.xxx.service.IpBookMedicalRecordService
        parts = controller_class.split('.')
        simple_name = parts[-1].replace('Controller', '')

        blh_methods = []
        for key in self.call_graph:
            key_parts = key.split('.')
            key_simple = key_parts[-1].split('(')[0] if key_parts else ''
            key_class = '.'.join(key_parts[:-1]) if len(key_parts) > 1 else ''
            if '.blh.' in key_class or '.service.' in key_class:
                if simple_name.replace('Client', '') in key_class:
                    blh_methods.append(key)

        return blh_methods

    def _find_controller_for_feign(self, feign_class: str) -> str:
        """查找暴露指定 Feign 接口的 Controller"""
        # 从 service_boundary 中查找
        for controller, feign in self.service_boundary.items():
            if feign == feign_class or feign_class.startswith(feign + '.'):
                return controller
        
        # 尝试通过命名约定匹配
        feign_simple = feign_class.split('.')[-1]
        for controller in self.service_boundary.keys():
            ctrl_simple = controller.split('.')[-1]
            # e.g., IpBookMedicalRecordClient → IpBookMedicalRecordClientController
            if feign_simple in ctrl_simple or ctrl_simple.replace('Controller', '') == feign_simple:
                return controller
        
        return None

    def _get_feign_calls(self, method_id: str) -> List[str]:
        """获取方法调用的 Feign 接口"""
        calls = self.call_graph.get(method_id, [])
        return [c for c in calls if self._is_feign(c)]

    def _is_feign(self, method_or_class_name: str) -> bool:
        """判断是否是 Feign 接口调用（支持 Class.method 和 Class.method(params)returnType 格式）"""
        if method_or_class_name in self.feign_interfaces:
            return True
        # 检查类名部分匹配（target 可能是 FeignClass.method 格式）
        for feign in self.feign_interfaces:
            if method_or_class_name.startswith(feign + '.') or method_or_class_name.startswith(feign + '('):
                return True
        # 提取类名部分（去掉最后的方法名或签名）
        parts = method_or_class_name.split('.')
        # 检查每个部分是否匹配 Feign 接口命名模式
        for part in parts:
            if part.endswith('Client') or part.endswith('FeignClient') or 'FeignClient' in part:
                return True
        # 检查是否包含 feign 包路径
        if '.feign.' in method_or_class_name:
            return True
        return False

    def _find_controller_upward(self, method_id: str, max_depth: int = 10) -> str:
        """向上查找 Controller"""
        visited = set()

        def dfs(current: str, depth: int) -> str:
            if depth > max_depth or current in visited:
                return None
            visited.add(current)

            if self._is_controller(current):
                return current

            callers = self.reverse_index.get(current, [])
            for caller in callers:
                controller = dfs(caller, depth + 1)
                if controller:
                    return controller

            return None

        return dfs(method_id, 0)

    def _is_controller(self, class_name: str) -> bool:
        """判断是否是 Controller"""
        return 'Controller' in class_name or class_name in self.service_boundary

    def _infer_service(self, method_id: str) -> str:
        """推断方法所属服务（包格式: com.mediway.his.SERVICE.xxx）"""
        parts = method_id.split('.')
        if len(parts) >= 4 and parts[0] == 'com' and parts[1] == 'mediway' and parts[2] == 'his':
            return parts[3]
        return 'unknown'

    def _infer_source(self, method_id: str) -> str:
        """推断方法来源"""
        service = self._infer_service(method_id)
        workspace_services = {'opcare', 'ipcare', 'aggcare', 'hispa', 'curc', 'ma', 'opalloc', 'opreg',
                              'cfmr', 'cfoe', 'commr', 'comoe'}
        return 'workspace' if service in workspace_services else 'maven'

    def export_results(self, output_dir: Path):
        """导出结果"""
        output_dir.mkdir(parents=True, exist_ok=True)

        json_path = output_dir / 'recursive_feign_chains.json'
        services = list(set(n.service for chain in self.all_chains for n in chain.nodes))
        data = {
            'stats': {
                'total_chains': len(self.all_chains),
                'services_involved': services,
            },
            'chains': [chain.to_dict() for chain in self.all_chains],
        }
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        logger.info(f"✓ 调用链已导出: {json_path}")

        graphml_path = output_dir / 'recursive_feign_chain_graph.graphml'
        self._export_graphml(graphml_path)
        logger.info(f"✓ GraphML 已导出: {graphml_path}")

    def _export_graphml(self, output_path: Path):
        """导出为 GraphML"""
        import xml.sax.saxutils as saxutils

        nodes = {}
        edges = []

        for chain in self.all_chains:
            for i, node in enumerate(chain.nodes):
                node_id = f"{node.type}:{node.id}"
                nodes[node_id] = {
                    'label': node.id.split('.')[-1],
                    'type': node.type,
                    'service': node.service,
                    'source': node.source,
                }

                if i > 0:
                    prev_node = chain.nodes[i - 1]
                    prev_id = f"{prev_node.type}:{prev_node.id}"
                    edges.append((prev_id, node_id))

        def esc(s):
            return saxutils.escape(str(s))

        def esc_attr(s):
            return saxutils.quoteattr(str(s))

        lines = ['<?xml version="1.0" encoding="UTF-8"?>']
        lines.append('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">')
        lines.append('  <key id="label" for="node" attr.name="label" attr.type="string"/>')
        lines.append('  <key id="type" for="node" attr.name="type" attr.type="string"/>')
        lines.append('  <key id="service" for="node" attr.name="service" attr.type="string"/>')
        lines.append('  <key id="source" for="node" attr.name="source" attr.type="string"/>')
        lines.append('  <graph id="G" edgedefault="directed">')

        node_ids = sorted(nodes.keys())
        node_id_map = {nid: f"n{i}" for i, nid in enumerate(node_ids)}

        for nid in node_ids:
            info = nodes[nid]
            gid = node_id_map[nid]
            lines.append(f'    <node id={esc_attr(gid)}>')
            lines.append(f'      <data key="label">{esc(info["label"])}</data>')
            lines.append(f'      <data key="type">{esc(info["type"])}</data>')
            lines.append(f'      <data key="service">{esc(info["service"])}</data>')
            lines.append(f'      <data key="source">{esc(info["source"])}</data>')
            lines.append(f'    </node>')

        unique_edges = list(set(edges))
        for i, (src, tgt) in enumerate(unique_edges):
            if src in node_id_map and tgt in node_id_map:
                lines.append(f'    <edge id="e{i}" source={esc_attr(node_id_map[src])} target={esc_attr(node_id_map[tgt])}/>')

        lines.append('  </graph>')
        lines.append('</graphml>')

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))


def main():
    data_dir = OUTPUT_DIR
    output_dir = data_dir

    tracer = RecursiveFeignTracer(data_dir)
    tracer.load_data()
    tracer.trace_all()
    tracer.export_results(output_dir)

    logger.info("\n" + "=" * 60)
    logger.info("递归穿透追踪完成!")
    logger.info("=" * 60)


if __name__ == '__main__':
    main()
