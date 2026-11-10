#!/usr/bin/env python3
"""
扫描 Maven 本地仓库中的 API jar 包（简化版 - 只扫描关键服务）
使用 javatools 纯 Python 字节码分析替代 javap 子进程调用

提取模块信息、Feign 接口定义、Controller 类和方法调用关系
"""
import json
import re
import io
import zipfile
from pathlib import Path
from typing import List, Dict, Set, Optional
from dataclasses import dataclass, field
from collections import defaultdict
import logging

from javatools import unpack_class

sys.path.insert(0, str(Path(__file__).parent))
from config import OUTPUT_DIR, get_primary_maven_repo

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

INVOKE_OPCODES = {182, 183, 184, 185}


def internal_to_dot(internal_name: str) -> str:
    return internal_name.replace('/', '.').replace('$', '.')


@dataclass
class MavenModule:
    group_id: str
    artifact_id: str
    version: str
    jar_path: Path
    module_type: str
    packages: Set[str] = field(default_factory=set)
    classes: Set[str] = field(default_factory=set)


@dataclass
class FeignInterface:
    full_name: str
    package_name: str
    class_name: str
    service_name: str
    methods: List[Dict] = field(default_factory=list)
    source_module: str = ""


@dataclass
class ControllerClass:
    full_name: str
    package_name: str
    class_name: str
    request_mappings: List[Dict] = field(default_factory=list)
    source_module: str = ""


@dataclass
class ClassInfo:
    full_name: str
    package_name: str
    class_name: str
    is_interface: bool = False
    is_abstract: bool = False
    annotations: List[str] = field(default_factory=list)
    methods: List[Dict] = field(default_factory=list)
    field_types: Set[str] = field(default_factory=set)
    method_calls: List[Dict] = field(default_factory=list)
    source_module: str = ""


class MavenApiScanner:
    def __init__(self, maven_repo: Path):
        self.maven_repo = maven_repo
        self.modules: Dict[str, MavenModule] = {}
        self.classes: Dict[str, ClassInfo] = {}
        self.feign_interfaces: List[FeignInterface] = []
        self.controllers: List[ControllerClass] = []
        self.stats = {
            'jars_scanned': 0,
            'classes_analyzed': 0,
            'feign_found': 0,
            'controllers_found': 0,
        }

    def scan_specific_jars(self, jar_paths: List[Path]):
        logger.info(f"开始扫描 {len(jar_paths)} 个指定的 jar 包")

        for i, jar_path in enumerate(jar_paths, 1):
            logger.info(f"[{i}/{len(jar_paths)}] 扫描: {jar_path.name}")
            try:
                self._scan_jar(jar_path)
                self.stats['jars_scanned'] += 1
            except Exception as e:
                logger.warning(f"扫描 jar 失败 {jar_path.name}: {e}")

        logger.info(f"\n扫描完成!")
        logger.info(f"  JAR 包: {self.stats['jars_scanned']}")
        logger.info(f"  类: {self.stats['classes_analyzed']}")
        logger.info(f"  模块: {len(self.modules)}")
        logger.info(f"  Feign 接口: {self.stats['feign_found']}")
        logger.info(f"  Controller: {self.stats['controllers_found']}")

    def _scan_jar(self, jar_path: Path):
        parts = jar_path.parts
        try:
            repo_idx = None
            for i, part in enumerate(parts):
                if part == 'mediway':
                    repo_idx = i
                    break

            if repo_idx is None:
                return

            group_parts = ['com', 'mediway']
            for i in range(repo_idx + 1, len(parts) - 2):
                group_parts.append(parts[i])
            group_id = '.'.join(group_parts)

            artifact_id = parts[-2]
            version = parts[-1].replace('.jar', '')

            if artifact_id.endswith('-api'):
                module_type = 'api'
            elif artifact_id.endswith('-service') or artifact_id.endswith('-boot'):
                module_type = 'service'
            else:
                module_type = 'common'

            module_key = f"{group_id}:{artifact_id}:{version}"

            if module_key not in self.modules:
                module = MavenModule(
                    group_id=group_id,
                    artifact_id=artifact_id,
                    version=version,
                    jar_path=jar_path,
                    module_type=module_type,
                )
                self.modules[module_key] = module

            self._extract_jar_content(jar_path, module_key)

        except Exception as e:
            logger.debug(f"解析 jar 路径失败 {jar_path}: {e}")

    def _extract_jar_content(self, jar_path: Path, module_key: str):
        with zipfile.ZipFile(jar_path, 'r') as zf:
            for entry_name in zf.namelist():
                if not entry_name.endswith('.class'):
                    continue
                if '$' in entry_name:
                    continue

                try:
                    data = zf.read(entry_name)
                    self._analyze_class_bytes(data, module_key)
                except Exception as e:
                    logger.debug(f"分析 class 失败 {entry_name}: {e}")

    def _analyze_class_bytes(self, data: bytes, module_key: str):
        ci = unpack_class(io.BytesIO(data))

        class_internal = ci.get_this()
        if not class_internal:
            return
        full_class_name = internal_to_dot(class_internal)
        package_name = '.'.join(full_class_name.split('.')[:-1])
        class_name = full_class_name.split('.')[-1]

        is_interface = bool(ci.is_interface())
        is_abstract = bool(ci.is_abstract())

        annotations = []
        for anno in ci.get_annotations():
            anno_str = str(anno)
            m = re.search(r'@([\w.]+)', anno_str)
            if m:
                annotations.append(m.group(1))

        methods = []
        for m in ci.methods:
            method_name = m.get_name()
            descriptor = m.get_descriptor()
            paren_idx = descriptor.find('(')
            close_paren = descriptor.find(')')
            if paren_idx < 0 or close_paren < 0:
                continue
            params_desc = descriptor[paren_idx + 1:close_paren]
            return_desc = descriptor[close_paren + 1:]
            methods.append({
                'name': method_name,
                'params': params_desc,
                'return_type': return_desc,
            })

        field_types = set()
        for f in ci.fields:
            field_desc = f.get_descriptor()
            field_types.add(field_desc)

        method_calls = self._extract_method_calls(ci)

        class_info = ClassInfo(
            full_name=full_class_name,
            package_name=package_name,
            class_name=class_name,
            is_interface=is_interface,
            is_abstract=is_abstract,
            annotations=annotations,
            methods=methods,
            field_types=field_types,
            method_calls=method_calls,
            source_module=module_key,
        )

        self.classes[full_class_name] = class_info
        self.stats['classes_analyzed'] += 1

        if module_key in self.modules:
            self.modules[module_key].packages.add(package_name)
            self.modules[module_key].classes.add(full_class_name)

        if any('FeignClient' in a for a in annotations):
            self._process_feign_interface(class_info)
            self.stats['feign_found'] += 1

        if any('RestController' in a or 'Controller' in a for a in annotations):
            self._process_controller(class_info)
            self.stats['controllers_found'] += 1

    def _extract_method_calls(self, ci) -> List[Dict]:
        calls = []
        cpool = ci.cpool

        for m in ci.methods:
            code = m.get_code()
            if not code:
                continue

            for offset, opcode, args in code.disassemble():
                if opcode not in INVOKE_OPCODES or not args:
                    continue

                cp_index = args[0]
                try:
                    resolved = cpool.deref_const(cp_index)
                except Exception:
                    continue

                if not isinstance(resolved, tuple) or len(resolved) < 2:
                    continue

                target_class_internal = resolved[0]
                method_info = resolved[1]

                if not isinstance(target_class_internal, str) or not isinstance(method_info, tuple):
                    continue
                if len(method_info) < 2:
                    continue

                target_class = internal_to_dot(target_class_internal)
                target_method = method_info[0]
                target_descriptor = method_info[1]

                paren_idx = target_descriptor.find('(')
                close_paren = target_descriptor.find(')')
                if paren_idx < 0 or close_paren < 0:
                    continue
                target_params = target_descriptor[paren_idx + 1:close_paren]
                target_return = target_descriptor[close_paren + 1:]

                calls.append({
                    'target_class': target_class,
                    'target_method': target_method,
                    'target_params': target_params,
                    'target_return': target_return,
                })

        return calls

    def _process_feign_interface(self, class_info: ClassInfo):
        service_name = class_info.class_name.replace('Client', '').replace('Feign', '').lower()

        feign_iface = FeignInterface(
            full_name=class_info.full_name,
            package_name=class_info.package_name,
            class_name=class_info.class_name,
            service_name=service_name,
            methods=class_info.methods,
            source_module=class_info.source_module,
        )

        self.feign_interfaces.append(feign_iface)
        logger.debug(f"发现 Feign 接口: {class_info.full_name} ({len(class_info.methods)} 个方法)")

    def _process_controller(self, class_info: ClassInfo):
        controller = ControllerClass(
            full_name=class_info.full_name,
            package_name=class_info.package_name,
            class_name=class_info.class_name,
            request_mappings=[],
            source_module=class_info.source_module,
        )

        self.controllers.append(controller)
        logger.debug(f"发现 Controller: {class_info.full_name}")

    def export_to_json(self, output_path: Path):
        data = {
            'stats': self.stats,
            'modules': {
                key: {
                    'group_id': m.group_id,
                    'artifact_id': m.artifact_id,
                    'version': m.version,
                    'jar_path': str(m.jar_path),
                    'module_type': m.module_type,
                    'packages': list(m.packages),
                    'classes': list(m.classes),
                }
                for key, m in self.modules.items()
            },
            'classes': {
                name: {
                    'full_name': c.full_name,
                    'package_name': c.package_name,
                    'class_name': c.class_name,
                    'is_interface': c.is_interface,
                    'annotations': c.annotations,
                    'methods': c.methods,
                    'field_types': list(c.field_types),
                    'method_calls': c.method_calls,
                    'source_module': c.source_module,
                }
                for name, c in self.classes.items()
            },
            'feign_interfaces': [
                {
                    'full_name': f.full_name,
                    'package_name': f.package_name,
                    'class_name': f.class_name,
                    'service_name': f.service_name,
                    'methods': f.methods,
                    'source_module': f.source_module,
                }
                for f in self.feign_interfaces
            ],
            'controllers': [
                {
                    'full_name': c.full_name,
                    'package_name': c.package_name,
                    'class_name': c.class_name,
                    'source_module': c.source_module,
                }
                for c in self.controllers
            ],
        }

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"\n✓ 扫描结果已导出: {output_path}")
        logger.info(f"  模块数: {len(self.modules)}")
        logger.info(f"  类数: {len(self.classes)}")
        logger.info(f"  Feign 接口数: {len(self.feign_interfaces)}")
        logger.info(f"  Controller 数: {len(self.controllers)}")


if __name__ == "__main__":
    maven_repo = get_primary_maven_repo() / "com" / "mediway"

    if not maven_repo.exists():
        logger.error(f"Maven 仓库不存在: {maven_repo}")
        exit(1)

    output_dir = OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    all_api_jars = []
    for jar in maven_repo.rglob("*.jar"):
        if '-api' in jar.name and not jar.name.endswith('-sources.jar') and 'SNAPSHOT' in jar.name:
            all_api_jars.append(jar)

    by_artifact = defaultdict(list)
    for j in all_api_jars:
        artifact = j.parent.parent.name
        by_artifact[artifact].append(j)

    jar_paths = []
    for artifact, jars in by_artifact.items():
        jars.sort(key=lambda x: x.name, reverse=True)
        jar_paths.append(jars[0])

    logger.info(f"找到 {len(jar_paths)} 个 API jar（去重后）")

    if not jar_paths:
        logger.error("未找到任何 API jar")
        exit(1)

    scanner = MavenApiScanner(maven_repo)
    scanner.scan_specific_jars(jar_paths)

    scanner.export_to_json(output_dir / "maven_api_scan.json")
