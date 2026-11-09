#!/usr/bin/env python3
"""
合并工作区 + Maven 的调用图数据

输入：
- method_call_graph.jsonl (工作区)
- maven_biz_call_graph.jsonl (Maven)
- maven_biz_reverse_index.json (Maven)
- maven_biz_service_boundary.json (Maven)

输出：
- merged_call_graph.jsonl
- merged_reverse_index.json
- merged_service_boundary.json
"""
import json
from pathlib import Path
from collections import defaultdict
import logging
import sys

sys.path.insert(0, str(Path(__file__).parent))
from config import OUTPUT_DIR

sys.path.insert(0, str(Path(__file__).parent))
from config import is_system_class

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class CallGraphMerger:
    """调用图合并器"""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.merged_call_graph = defaultdict(list)
        self.merged_reverse_index = defaultdict(list)
        self.merged_service_boundary = {}
        self.filtered_count = 0

    @staticmethod
    def _extract_class(method_id: str) -> str:
        """从方法签名提取类名: pkg.Class.method(params)ret -> pkg.Class"""
        paren_idx = method_id.find('(')
        if paren_idx < 0:
            return method_id
        before_paren = method_id[:paren_idx]
        dot_idx = before_paren.rfind('.')
        if dot_idx < 0:
            return before_paren
        return before_paren[:dot_idx]

    def _is_filtered(self, method_id: str) -> bool:
        """检查方法是否属于系统/框架类，需要过滤"""
        cls = self._extract_class(method_id)
        return is_system_class(cls)

    def merge_all(self):
        """合并所有数据"""
        logger.info("开始合并调用图数据...")
        self._load_workspace_data()
        self._load_maven_data()
        self._deduplicate()
        self._build_service_boundary()

        logger.info(f"\n合并完成!")
        logger.info(f"  调用关系: {sum(len(v) for v in self.merged_call_graph.values())}")
        logger.info(f"  反向索引: {sum(len(v) for v in self.merged_reverse_index.values())}")
        logger.info(f"  服务边界: {len(self.merged_service_boundary)}")
        logger.info(f"  已过滤系统/框架关系: {self.filtered_count}")

    def _load_workspace_data(self):
        """加载工作区数据"""
        jsonl_path = self.data_dir / 'method_call_graph.jsonl'
        if not jsonl_path.exists():
            logger.warning(f"工作区数据不存在: {jsonl_path}")
            return

        logger.info(f"加载工作区数据: {jsonl_path}")
        count = 0
        with open(jsonl_path, 'r', encoding='utf-8') as f:
            for line in f:
                entry = json.loads(line)
                if entry.get('type') == 'edge':
                    source = entry['source']
                    target = entry['target']
                    if self._is_filtered(source) or self._is_filtered(target):
                        self.filtered_count += 1
                        continue
                    self.merged_call_graph[source].append(target)
                    self.merged_reverse_index[target].append(source)
                    count += 1

        logger.info(f"  工作区调用关系: {count}")

    def _load_maven_data(self):
        """加载 Maven 数据"""
        call_graph_path = self.data_dir / 'maven_biz_call_graph.jsonl'
        reverse_index_path = self.data_dir / 'maven_biz_reverse_index.json'
        service_boundary_path = self.data_dir / 'maven_biz_service_boundary.json'

        if call_graph_path.exists():
            logger.info(f"加载 Maven 调用图: {call_graph_path}")
            maven_count = 0
            with open(call_graph_path, 'r', encoding='utf-8') as f:
                for line in f:
                    entry = json.loads(line)
                    source = entry['source']
                    targets = entry['targets']
                    if self._is_filtered(source):
                        self.filtered_count += 1
                        continue
                    filtered_targets = []
                    for t in targets:
                        if self._is_filtered(t):
                            self.filtered_count += 1
                        else:
                            filtered_targets.append(t)
                    if filtered_targets:
                        self.merged_call_graph[source].extend(filtered_targets)
                        maven_count += len(filtered_targets)
            logger.info(f"  Maven 调用关系: {maven_count}")

        if reverse_index_path.exists():
            logger.info(f"加载 Maven 反向索引: {reverse_index_path}")
            with open(reverse_index_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for target, callers in data.items():
                    if self._is_filtered(target):
                        continue
                    filtered_callers = [c for c in callers if not self._is_filtered(c)]
                    if filtered_callers:
                        self.merged_reverse_index[target].extend(filtered_callers)

        if service_boundary_path.exists():
            logger.info(f"加载 Maven 服务边界: {service_boundary_path}")
            with open(service_boundary_path, 'r', encoding='utf-8') as f:
                self.merged_service_boundary = json.load(f)

    def _deduplicate(self):
        """去重"""
        logger.info("去重...")
        for key in self.merged_call_graph:
            self.merged_call_graph[key] = sorted(set(self.merged_call_graph[key]))
        for key in self.merged_reverse_index:
            self.merged_reverse_index[key] = sorted(set(self.merged_reverse_index[key]))

    def _build_service_boundary(self):
        """从调用图构建 Controller→Feign 服务边界映射"""
        logger.info("构建服务边界映射...")
        # 加载 Feign 接口数据
        feign_path = self.data_dir / 'feign_interfaces.json'
        feign_classes = {}
        if feign_path.exists():
            with open(feign_path, 'r', encoding='utf-8') as f:
                feign_data = json.load(f)
                for iface in feign_data.get('interfaces', []):
                    feign_classes[iface['class_name']] = iface['full_name']

        # 从调用图中提取所有类名
        all_classes = set()
        for source in self.merged_call_graph:
            # 方法签名格式: package.Class.method(params)returnType
            if '(' in source:
                cls_method = source.rsplit('.', 1)[0] if '.' in source else source
                all_classes.add(cls_method)
            for target in self.merged_call_graph[source]:
                if '(' in target:
                    cls_method = target.rsplit('.', 1)[0] if '.' in target else target
                    all_classes.add(cls_method)

        # 查找 Controller 类并匹配 Feign 接口
        for cls in sorted(all_classes):
            if 'Controller' not in cls:
                continue
            ctrl_simple = cls.split('.')[-1] if '.' in cls else cls
            base = ctrl_simple.replace('Controller', '')
            if base in feign_classes:
                self.merged_service_boundary[cls] = feign_classes[base]

        logger.info(f"  服务边界映射: {len(self.merged_service_boundary)}")

    def export_results(self, output_dir: Path):
        """导出合并结果"""
        output_dir.mkdir(parents=True, exist_ok=True)

        call_graph_path = output_dir / 'merged_call_graph.jsonl'
        with open(call_graph_path, 'w', encoding='utf-8') as f:
            for source in sorted(self.merged_call_graph):
                entry = {'type': 'calls', 'source': source,
                         'targets': sorted(self.merged_call_graph[source])}
                f.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + '\n')
        logger.info(f"✓ 合并调用图已导出: {call_graph_path}")

        reverse_index_path = output_dir / 'merged_reverse_index.json'
        with open(reverse_index_path, 'w', encoding='utf-8') as f:
            json.dump({k: sorted(v) for k, v in self.merged_reverse_index.items()},
                      f, ensure_ascii=False, indent=2, sort_keys=True)
        logger.info(f"✓ 合并反向索引已导出: {reverse_index_path}")

        service_boundary_path = output_dir / 'merged_service_boundary.json'
        with open(service_boundary_path, 'w', encoding='utf-8') as f:
            json.dump(self.merged_service_boundary, f, ensure_ascii=False,
                      indent=2, sort_keys=True)
        logger.info(f"✓ 合并服务边界已导出: {service_boundary_path}")


def main():
    data_dir = OUTPUT_DIR
    output_dir = data_dir

    merger = CallGraphMerger(data_dir)
    merger.merge_all()
    merger.export_results(output_dir)

    logger.info("\n" + "=" * 60)
    logger.info("数据合并完成!")
    logger.info("=" * 60)


if __name__ == '__main__':
    main()
