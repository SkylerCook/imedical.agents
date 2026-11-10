"""
图构建器
使用 NetworkX 构建方法调用链图
"""
import networkx as nx
from typing import List, Dict, Set, Optional, Tuple
from pathlib import Path
from dataclasses import dataclass
import logging

from core.jar_analyzer import JavaClass, JavaMethod


@dataclass
class GraphStatistics:
    """图统计信息"""
    node_count: int
    edge_count: int
    class_count: int
    method_count: int
    component_count: int
    max_degree: int


class CallGraphBuilder:
    """调用链图构建器"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.graph = nx.DiGraph()
        self._class_map: Dict[str, JavaClass] = {}
        self._method_map: Dict[str, JavaMethod] = {}
    
    def add_classes(self, classes: List[JavaClass]):
        """
        添加类到图
        
        Args:
            classes: JavaClass 列表
        """
        for java_class in classes:
            self._add_class(java_class)
    
    def _add_class(self, java_class: JavaClass):
        """添加单个类"""
        # 添加类节点
        class_node_id = f"class:{java_class.name}"
        self.graph.add_node(
            class_node_id,
            type="class",
            name=java_class.name,
            simple_name=java_class.simple_name,
            package=java_class.package_name,
            is_interface=java_class.is_interface,
            is_abstract=java_class.is_abstract,
            source_jar=str(java_class.source_jar),
        )
        
        # 记录类映射
        self._class_map[java_class.name] = java_class
        
        # 添加继承关系
        if java_class.super_class:
            super_node_id = f"class:{java_class.super_class}"
            # 确保父类节点存在
            if not self.graph.has_node(super_node_id):
                self.graph.add_node(super_node_id, type="class", name=java_class.super_class)
            self.graph.add_edge(class_node_id, super_node_id, type="extends")
        
        # 添加接口实现关系
        for interface in java_class.interfaces:
            interface_node_id = f"class:{interface}"
            if not self.graph.has_node(interface_node_id):
                self.graph.add_node(interface_node_id, type="class", name=interface)
            self.graph.add_edge(class_node_id, interface_node_id, type="implements")
        
        # 添加方法
        for method in java_class.methods:
            self._add_method(method)
    
    def _add_method(self, method: JavaMethod):
        """添加方法"""
        method_node_id = f"method:{method.full_name}"
        
        # 将列表转换为字符串（GraphML 不支持 list 类型）
        params_str = ",".join(method.parameters) if method.parameters else ""
        
        self.graph.add_node(
            method_node_id,
            type="method",
            name=method.name,
            full_name=method.full_name,
            descriptor=method.descriptor,
            return_type=method.return_type,
            parameters=params_str,  # 转换为字符串
            is_static=method.is_static,
            is_abstract=method.is_abstract,
            declaring_class=method.declaring_class.name,
        )
        
        # 记录方法映射
        self._method_map[method.full_name] = method
        
        # 添加方法与类的关系
        class_node_id = f"class:{method.declaring_class.name}"
        self.graph.add_edge(class_node_id, method_node_id, type="declares")
        
        # 添加方法调用关系
        for call in method.calls:
            # call 格式：ClassName.methodName(params)
            called_method_id = f"method:{call}"
            
            # 如果被调用方法不在图中，创建一个占位节点
            if not self.graph.has_node(called_method_id):
                # 解析调用信息
                parts = call.rsplit('.', 1)
                if len(parts) == 2:
                    called_class, method_sig = parts
                    method_name = method_sig.split('(')[0]
                    
                    self.graph.add_node(
                        called_method_id,
                        type="method",
                        name=method_name,
                        full_name=call,
                        declaring_class=called_class,
                        is_external=True,  # 标记为外部方法
                    )
            
            # 添加调用边
            self.graph.add_edge(method_node_id, called_method_id, type="calls")
    
    def get_statistics(self) -> GraphStatistics:
        """获取图统计信息"""
        class_nodes = [n for n, d in self.graph.nodes(data=True) if d.get('type') == 'class']
        method_nodes = [n for n, d in self.graph.nodes(data=True) if d.get('type') == 'method']
        
        # 计算最大度数
        max_degree = 0
        if self.graph.nodes():
            max_degree = max(dict(self.graph.degree()).values())
        
        # 计算连通分量
        undirected = self.graph.to_undirected()
        components = list(nx.connected_components(undirected))
        
        return GraphStatistics(
            node_count=self.graph.number_of_nodes(),
            edge_count=self.graph.number_of_edges(),
            class_count=len(class_nodes),
            method_count=len(method_nodes),
            component_count=len(components),
            max_degree=max_degree,
        )
    
    def find_callers(self, method_name: str) -> List[str]:
        """
        查找调用指定方法的所有方法
        
        Args:
            method_name: 方法名（支持部分匹配）
            
        Returns:
            调用者方法列表
        """
        callers = []
        
        for node_id, data in self.graph.nodes(data=True):
            if data.get('type') != 'method':
                continue
            
            # 查找调用边
            for successor in self.graph.successors(node_id):
                succ_data = self.graph.nodes[successor]
                if method_name in succ_data.get('name', '') or method_name in succ_data.get('full_name', ''):
                    callers.append(data.get('full_name', node_id))
                    break
        
        return callers
    
    def find_callees(self, method_name: str) -> List[str]:
        """
        查找指定方法调用的所有方法
        
        Args:
            method_name: 方法名（支持部分匹配）
            
        Returns:
            被调用方法列表
        """
        callees = []
        
        for node_id, data in self.graph.nodes(data=True):
            if data.get('type') != 'method':
                continue
            
            if method_name not in data.get('name', '') and method_name not in data.get('full_name', ''):
                continue
            
            # 查找调用边
            for successor in self.graph.successors(node_id):
                succ_data = self.graph.nodes[successor]
                if succ_data.get('type') == 'method':
                    callees.append(succ_data.get('full_name', successor))
        
        return callees
    
    def find_call_chain(self, from_method: str, to_method: str, max_depth: int = 10) -> List[List[str]]:
        """
        查找两个方法之间的调用链
        
        Args:
            from_method: 起始方法
            to_method: 目标方法
            max_depth: 最大深度
            
        Returns:
            调用链列表
        """
        # 查找节点
        from_node = None
        to_node = None
        
        for node_id, data in self.graph.nodes(data=True):
            if data.get('type') != 'method':
                continue
            if from_method in data.get('full_name', ''):
                from_node = node_id
            if to_method in data.get('full_name', ''):
                to_node = node_id
        
        if not from_node or not to_node:
            return []
        
        # 使用 DFS 查找路径
        try:
            paths = list(nx.all_simple_paths(self.graph, from_node, to_node, cutoff=max_depth))
            return paths
        except nx.NetworkXError:
            return []
    
    def export_to_graphml(self, output_path: Path):
        """
        导出图为 GraphML 格式
        
        Args:
            output_path: 输出文件路径
        """
        nx.write_graphml(self.graph, str(output_path))
        self.logger.info(f"Graph exported to {output_path}")
    
    def export_to_gexf(self, output_path: Path):
        """
        导出图为 GEXF 格式（ Gephi 可用）
        
        Args:
            output_path: 输出文件路径
        """
        nx.write_gexf(self.graph, str(output_path))
        self.logger.info(f"Graph exported to {output_path}")
    
    def get_external_dependencies(self) -> Set[str]:
        """
        获取所有外部依赖类
        
        Returns:
            外部依赖类名集合
        """
        external = set()
        
        for node_id, data in self.graph.nodes(data=True):
            if data.get('type') == 'method' and data.get('is_external'):
                external.add(data.get('declaring_class', ''))
        
        return external


def main():
    """测试函数"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    
    from core.jar_analyzer import JarAnalyzer
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python graph_builder.py <jar file>")
        sys.exit(1)
    
    jar_path = Path(sys.argv[1])
    
    # 分析 jar
    analyzer = JarAnalyzer()
    print(f"Analyzing {jar_path}...")
    classes = analyzer.analyze_jar(jar_path)
    
    # 构建图
    builder = CallGraphBuilder()
    builder.add_classes(classes)
    
    # 输出统计
    stats = builder.get_statistics()
    print(f"\nGraph Statistics:")
    print(f"  Nodes: {stats.node_count}")
    print(f"  Edges: {stats.edge_count}")
    print(f"  Classes: {stats.class_count}")
    print(f"  Methods: {stats.method_count}")
    print(f"  Components: {stats.component_count}")
    print(f"  Max Degree: {stats.max_degree}")
    
    # 导出图
    output_path = jar_path.with_suffix('.graphml')
    builder.export_to_graphml(output_path)
    print(f"\nGraph exported to {output_path}")


if __name__ == "__main__":
    main()
