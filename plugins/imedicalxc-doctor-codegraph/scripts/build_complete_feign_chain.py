#!/usr/bin/env python3
"""
构建完整的 Feign 调用链图（模块级推断 + Maven 服务穿透）

由于 BLH 框架通过反射调用，无法静态追踪完整链路。
采用模块级推断：
1. 从 Feign 调用边的源方法（Abstract）推断所属模块
2. 找到该模块的所有 Controller
3. 构建模块级调用链：[Module] Controller → Abstract → Feign → Target Service
4. 导出到 JSON + GraphML
"""
import json
import re
from pathlib import Path
from typing import Dict, List, Set, Tuple
from collections import defaultdict
from dataclasses import dataclass
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@dataclass
class FeignCallChain:
    """Feign 调用链（模块级）"""
    source_module: str
    source_package: str
    abstract_class: str
    abstract_method: str
    blh_class: str
    feign_interface: str
    feign_method: str
    target_service: str
    possible_controllers: List[str]  # 该模块的可能 Controller
    
    def to_dict(self):
        return {
            'source_module': self.source_module,
            'abstract': self.abstract_class.split('.')[-1],
            'abstract_method': self.abstract_method,
            'blh': self.blh_class.split('.')[-1] if self.blh_class else '',
            'feign': self.feign_interface.split('.')[-1],
            'feign_method': self.feign_method,
            'target_service': self.target_service,
            'possible_controllers': len(self.possible_controllers),
        }


class ModuleLevelFeignChainBuilder:
    """模块级 Feign 调用链构建器"""
    
    def __init__(self, workspace_root: Path, jsonl_path: Path):
        self.workspace_root = workspace_root
        self.jsonl_path = jsonl_path
        
        # 图数据
        self.nodes: Dict[str, Dict] = {}
        self.feign_edges: List[Tuple[str, str, str]] = []  # (source, target, feign_interface)
        
        # BLH/Abstract 继承关系
        self.blh_to_abstract: Dict[str, str] = {}
        self.abstract_to_blh: Dict[str, List[str]] = defaultdict(list)
        
        # 模块 → Controller 映射
        self.module_controllers: Dict[str, Set[str]] = defaultdict(set)
        
        # 最终调用链
        self.chains: List[FeignCallChain] = []
    
    def load_graph(self):
        """加载调用图数据"""
        logger.info(f"加载调用图: {self.jsonl_path}")
        
        with open(self.jsonl_path, 'r', encoding='utf-8') as f:
            for line in f:
                entry = json.loads(line)
                if entry.get('type') == 'node':
                    node_id = entry['id']
                    self.nodes[node_id] = entry
                    
                    # 识别 Controller 并按模块分组
                    class_name = entry.get('class', '')
                    if 'Controller' in class_name:
                        module = self.extract_module(class_name)
                        self.module_controllers[module].add(class_name)
                
                elif entry.get('type') == 'edge':
                    if entry.get('call_type') == 'feign':
                        source = entry['source']
                        target = entry['target']
                        feign_iface = entry.get('feign_interface', '')
                        self.feign_edges.append((source, target, feign_iface))
        
        logger.info(f"  节点: {len(self.nodes)}")
        logger.info(f"  Feign 调用边: {len(self.feign_edges)}")
        logger.info(f"  模块数: {len(self.module_controllers)}")
        logger.info(f"  Controller 总数: {sum(len(v) for v in self.module_controllers.values())}")
    
    def scan_inheritance(self):
        """扫描源码构建 BLH → Abstract 继承关系"""
        logger.info("\n扫描 BLH/Abstract 继承关系...")
        
        blh_files = {}
        abstract_files = {}
        
        for java_file in self.workspace_root.rglob("*.java"):
            try:
                content = java_file.read_text(encoding='utf-8', errors='ignore')
                
                pkg_match = re.search(r'^\s*package\s+([\w.]+)\s*;', content, re.MULTILINE)
                pkg = pkg_match.group(1) if pkg_match else ''
                
                if '/blh/ext/' in java_file.as_posix():
                    cls_match = re.search(r'public\s+class\s+(\w+BLH)\s+extends\s+(\w+)', content)
                    if cls_match:
                        blh_name = cls_match.group(1)
                        parent_name = cls_match.group(2)
                        full_blh = f"{pkg}.{blh_name}" if pkg else blh_name
                        blh_files[full_blh] = parent_name
                
                elif '/blh/' in java_file.as_posix() and 'Abstract' in java_file.name:
                    cls_match = re.search(r'public\s+abstract\s+class\s+(\w+Abstract)', content)
                    if cls_match:
                        abs_name = cls_match.group(1)
                        full_abs = f"{pkg}.{abs_name}" if pkg else abs_name
                        abstract_files[full_abs] = True
            
            except Exception:
                pass
        
        for blh_full, parent_name in blh_files.items():
            for abs_full in abstract_files:
                if abs_full.endswith(f".{parent_name}"):
                    self.blh_to_abstract[blh_full] = abs_full
                    self.abstract_to_blh[abs_full].append(blh_full)
                    break
        
        logger.info(f"  BLH 类: {len(blh_files)}")
        logger.info(f"  Abstract 类: {len(abstract_files)}")
        logger.info(f"  继承映射: {len(self.blh_to_abstract)}")
    
    def extract_module(self, class_name: str) -> str:
        """从类名提取模块名"""
        match = re.search(r'com\.mediway\.his\.(\w+)\.', class_name)
        if match:
            return match.group(1)
        return 'unknown'
    
    def extract_class_name(self, node_id: str) -> str:
        """从节点 ID 提取类名"""
        match = re.match(r'([\w.]+)\.(\w+)\(', node_id)
        if match:
            return match.group(1)
        parts = node_id.rsplit('.', 1)
        return parts[0] if len(parts) > 1 else node_id
    
    def extract_method_name(self, node_id: str) -> str:
        """从节点 ID 提取方法名"""
        match = re.search(r'\.(\w+)\(', node_id)
        if match:
            return match.group(1)
        parts = node_id.rsplit('.', 1)
        return parts[1].split('(')[0] if len(parts) > 1 else node_id
    
    def extract_feign_target_service(self, feign_interface: str) -> str:
        """从 Feign 接口名提取目标服务名"""
        match = re.search(r'com\.mediway\.his\.(\w+)\.api\.', feign_interface)
        if match:
            return match.group(1)
        match = re.search(r'com\.mediway\.his\.(\w+)\.', feign_interface)
        if match:
            return match.group(1)
        return 'unknown'
    
    def build_chains(self):
        """构建所有 Feign 调用链"""
        logger.info("\n构建模块级 Feign 调用链...")
        
        for source, target, feign_iface in self.feign_edges:
            abstract_class = self.extract_class_name(source)
            abstract_method = self.extract_method_name(source)
            feign_method = self.extract_method_name(target)
            target_service = self.extract_feign_target_service(feign_iface)
            source_module = self.extract_module(abstract_class)
            source_package = abstract_class.rsplit('.', 1)[0] if '.' in abstract_class else ''
            
            # 找到对应的 BLH 类
            blh_classes = self.abstract_to_blh.get(abstract_class, [])
            blh_class = blh_classes[0] if blh_classes else ''
            
            # 找到该模块的可能 Controller
            possible_controllers = list(self.module_controllers.get(source_module, set()))
            
            chain = FeignCallChain(
                source_module=source_module,
                source_package=source_package,
                abstract_class=abstract_class,
                abstract_method=abstract_method,
                blh_class=blh_class,
                feign_interface=feign_iface,
                feign_method=feign_method,
                target_service=target_service,
                possible_controllers=possible_controllers,
            )
            self.chains.append(chain)
        
        logger.info(f"  调用链: {len(self.chains)}")
    
    def export_to_json(self, output_path: Path):
        """导出到 JSON"""
        # 去重
        seen = set()
        unique_chains = []
        for chain in self.chains:
            key = (chain.abstract_class, chain.abstract_method, 
                   chain.feign_interface, chain.feign_method)
            if key not in seen:
                seen.add(key)
                unique_chains.append(chain)
        
        data = {
            'stats': {
                'total_nodes': len(self.nodes),
                'feign_edges': len(self.feign_edges),
                'modules': len(self.module_controllers),
                'total_controllers': sum(len(v) for v in self.module_controllers.values()),
                'blh_abstract_mappings': len(self.blh_to_abstract),
                'total_chains': len(self.chains),
                'unique_chains': len(unique_chains),
            },
            'modules': {
                module: list(controllers)
                for module, controllers in self.module_controllers.items()
            },
            'chains': [c.to_dict() for c in unique_chains],
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"\n✓ JSON 已导出: {output_path}")
        logger.info(f"  唯一调用链: {len(unique_chains)}")
        return unique_chains
    
    def export_to_graphml(self, output_path: Path, chains: List[FeignCallChain]):
        """导出到 GraphML"""
        graph_nodes = {}
        graph_edges = []
        
        for chain in chains:
            # Abstract 节点（完整包名）
            abs_id = f"abs:{chain.abstract_class}"
            graph_nodes[abs_id] = {
                'label': chain.abstract_class,
                'type': 'abstract',
                'module': chain.source_module,
                'package': chain.abstract_class.rsplit('.', 1)[0] if '.' in chain.abstract_class else '',
            }
            
            # BLH 节点（完整包名）
            if chain.blh_class:
                blh_id = f"blh:{chain.blh_class}"
                graph_nodes[blh_id] = {
                    'label': chain.blh_class,
                    'type': 'blh',
                    'module': chain.source_module,
                    'package': chain.blh_class.rsplit('.', 1)[0] if '.' in chain.blh_class else '',
                }
                graph_edges.append((blh_id, abs_id))
            
            # Feign 接口节点（完整包名）
            feign_id = f"feign:{chain.feign_interface}"
            graph_nodes[feign_id] = {
                'label': chain.feign_interface,
                'type': 'feign',
                'module': chain.target_service,
                'package': chain.feign_interface.rsplit('.', 1)[0] if '.' in chain.feign_interface else '',
            }
            graph_edges.append((abs_id, feign_id))
        
        unique_edges = list(set(graph_edges))
        
        # 生成 GraphML
        lines = ['<?xml version="1.0" encoding="UTF-8"?>']
        lines.append('<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">')
        lines.append('  <key id="label" for="node" attr.name="label" attr.type="string"/>')
        lines.append('  <key id="type" for="node" attr.name="type" attr.type="string"/>')
        lines.append('  <key id="module" for="node" attr.name="module" attr.type="string"/>')
        lines.append('  <key id="package" for="node" attr.name="package" attr.type="string"/>')
        lines.append('  <graph id="G" edgedefault="directed">')
        
        node_ids = sorted(graph_nodes.keys())
        node_id_map = {nid: f"n{i}" for i, nid in enumerate(node_ids)}
        
        for nid in node_ids:
            info = graph_nodes[nid]
            gid = node_id_map[nid]
            lines.append(f'    <node id="{gid}">')
            lines.append(f'      <data key="label">{self._esc(info["label"])}</data>')
            lines.append(f'      <data key="type">{info["type"]}</data>')
            lines.append(f'      <data key="module">{info.get("module", "")}</data>')
            lines.append(f'      <data key="package">{self._esc(info.get("package", ""))}</data>')
            lines.append(f'    </node>')
        
        for i, (src, tgt) in enumerate(unique_edges):
            if src in node_id_map and tgt in node_id_map:
                lines.append(f'    <edge id="e{i}" source="{node_id_map[src]}" target="{node_id_map[tgt]}"/>')
        
        lines.append('  </graph>')
        lines.append('</graphml>')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        
        logger.info(f"✓ GraphML 已导出: {output_path}")
        logger.info(f"  节点: {len(graph_nodes)}")
        logger.info(f"  边: {len(unique_edges)}")
    
    def _esc(self, text: str) -> str:
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    
    def print_summary(self, chains: List[FeignCallChain]):
        print("\n" + "=" * 80)
        print("模块级 Feign 调用链摘要（含 Maven 服务穿透）")
        print("=" * 80)
        
        print(f"\n总调用链: {len(chains)}")
        
        by_target = defaultdict(list)
        for chain in chains:
            by_target[chain.target_service].append(chain)
        
        print(f"目标服务数: {len(by_target)}")
        
        for service, service_chains in sorted(by_target.items()):
            print(f"\n【{service}】被调用 {len(service_chains)} 次")
            
            by_feign = defaultdict(list)
            for chain in service_chains:
                by_feign[chain.feign_interface].append(chain)
            
            for feign, feign_chains in sorted(by_feign.items())[:5]:
                feign_short = feign.split('.')[-1]
                print(f"  Feign: {feign_short} ({len(feign_chains)} 次)")
                
                by_module = defaultdict(set)
                for chain in feign_chains:
                    by_module[chain.source_module].add(chain.abstract_class.split('.')[-1])
                
                for module, abstracts in sorted(by_module.items()):
                    print(f"    ← {module} ({len(abstracts)} 个 Abstract 类)")


def main():
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    workspace_root = PROJECT_ROOT / "src" / "backend"
    jsonl_path = PROJECT_ROOT / "docs" / "imedicalxc-doctor-codegraph" / "method_call_graph.jsonl"
    output_dir = PROJECT_ROOT / "docs" / "imedicalxc-doctor-codegraph"
    
    builder = ModuleLevelFeignChainBuilder(workspace_root, jsonl_path)
    
    builder.load_graph()
    builder.scan_inheritance()
    builder.build_chains()
    
    unique_chains = builder.export_to_json(output_dir / "complete_feign_chains.json")
    builder.export_to_graphml(output_dir / "complete_feign_chain_graph.graphml", unique_chains)
    
    builder.print_summary(unique_chains)


if __name__ == "__main__":
    main()
