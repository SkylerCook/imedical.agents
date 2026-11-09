#!/usr/bin/env python3
"""
扫描 Maven biz jar，构建方法调用图（支持并发扫描）
使用 javatools 纯 Python 字节码分析替代 javap 子进程调用（~1000x 加速）

输出：maven_biz_call_graph.jsonl, maven_biz_reverse_index.json, maven_biz_service_boundary.json
"""
import argparse
import json, io, re, struct, zipfile, sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
from dataclasses import dataclass, field
from multiprocessing import Pool, cpu_count
import logging

from javatools import unpack_class

sys.path.insert(0, str(Path(__file__).parent))
from config import is_system_class, OUTPUT_DIR, get_primary_maven_repo

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

INVOKE_OPCODES = {182, 183, 184, 185}
INVOKEDYNAMIC = 186
MAX_UPSTREAM_SERVICE_HOPS = 6


@dataclass
class MethodInfo:
    full_name: str
    class_name: str
    method_name: str
    params: str
    return_type: str
    is_static: bool = False


def internal_to_dot(internal_name: str) -> str:
    """Convert JVM internal name (com/xxx/Foo$Bar) to dot format (com.xxx.Foo.Bar)"""
    return internal_name.replace('/', '.').replace('$', '.')


MAPPING_VERBS = {
    "PostMapping": "POST", "GetMapping": "GET", "PutMapping": "PUT",
    "DeleteMapping": "DELETE", "PatchMapping": "PATCH",
}


def _annotation_simple_name(anno) -> str:
    return anno.pretty_type().rsplit('.', 1)[-1]


def _annotation_strings(cpool, value) -> List[str]:
    """注解元素值取字符串；兼容 ('s', idx) 与 ('[', [...]) 两种编码。"""
    tag, data = value
    if tag == 's':
        return [cpool.deref_const(data)]
    if tag == '[':
        out = []
        for item in data:
            out.extend(_annotation_strings(cpool, item))
        return out
    return []


def annotation_paths(anno, cpool) -> List[str]:
    """映射路径只取 value / path，忽略 produces / consumes / name。"""
    for key in ('value', 'path'):
        if key in anno:
            return [p for p in _annotation_strings(cpool, anno[key]) if p]
    return []


def annotation_verb(anno, simple_name: str, cpool) -> str:
    if simple_name in MAPPING_VERBS:
        return MAPPING_VERBS[simple_name]
    method = anno.get('method')
    if not method:
        return "ANY"
    tag, data = method
    items = data if tag == '[' else [method]
    for tag, data in items:
        if tag == 'e':
            return cpool.deref_const(data[1]) or "ANY"
    return "ANY"


def join_url(*parts) -> str:
    return "/".join(p.strip("/") for p in parts if p and p.strip("/")).lower()


def resolve_invoke_target(cpool, cp_index: int) -> Optional[Tuple[str, str, str, str]]:
    """
    Resolve a constant pool index for an invoke instruction.
    Returns (class_name_dot, method_name, params_descriptor, return_descriptor) or None.
    """
    try:
        resolved = cpool.deref_const(cp_index)
    except Exception:
        return None

    if not isinstance(resolved, tuple) or len(resolved) < 2:
        return None

    class_internal = resolved[0]
    method_info = resolved[1]

    if not isinstance(class_internal, str) or not isinstance(method_info, tuple):
        return None

    if len(method_info) < 2:
        return None

    method_name = method_info[0]
    method_descriptor = method_info[1]

    class_dot = internal_to_dot(class_internal)

    paren_idx = method_descriptor.find('(')
    if paren_idx < 0:
        return None
    params_desc = method_descriptor[paren_idx:]
    close_paren = params_desc.find(')')
    if close_paren < 0:
        return None
    params_part = params_desc[1:close_paren]
    return_part = params_desc[close_paren + 1:]

    return class_dot, method_name, params_part, return_part


def parse_bootstrap_methods(raw: bytes) -> List[Tuple[int, ...]]:
    """解析类的 BootstrapMethods 属性，返回每个引导方法的参数常量池索引。"""
    if not raw:
        return []
    try:
        (count,) = struct.unpack_from(">H", raw, 0)
        offset = 2
        table = []
        for _ in range(count):
            _ref, nargs = struct.unpack_from(">HH", raw, offset)
            offset += 4
            table.append(struct.unpack_from(">" + "H" * nargs, raw, offset))
            offset += 2 * nargs
        return table
    except Exception:
        return []


def resolve_lambda_target(cpool, bootstrap_methods: List[Tuple[int, ...]], cp_index: int) -> Optional[str]:
    """
    invokedynamic 指令 → 编译器生成的 lambda$xxx$N 合成方法全名。

    javac 把 lambda 体编译成合成方法，通过 invokedynamic + LambdaMetafactory 调用，
    字节码里没有“所在方法 → lambda 方法”的普通调用边，需要从引导方法参数还原。
    """
    try:
        resolved = cpool.deref_const(cp_index)
    except Exception:
        return None
    if not isinstance(resolved, tuple) or len(resolved) < 2:
        return None
    bsm_index = resolved[0]
    if not isinstance(bsm_index, int) or not 0 <= bsm_index < len(bootstrap_methods):
        return None

    args = bootstrap_methods[bsm_index]
    if len(args) < 2:
        return None
    try:
        impl = cpool.deref_const(args[1])
    except Exception:
        return None

    # CONSTANT_MethodHandle: (reference_kind, (class_internal, (name, descriptor)))
    if not isinstance(impl, tuple) or len(impl) < 2:
        return None
    ref = impl[1]
    if not isinstance(ref, tuple) or len(ref) < 2:
        return None
    class_internal, method_ref = ref
    if not isinstance(method_ref, tuple) or len(method_ref) < 2:
        return None
    method_name, descriptor = method_ref
    if not isinstance(method_name, str) or not method_name.startswith("lambda$"):
        return None

    paren_idx = descriptor.find('(')
    close_paren = descriptor.find(')')
    if paren_idx < 0 or close_paren < 0:
        return None
    params_desc = descriptor[paren_idx + 1:close_paren]
    return_desc = descriptor[close_paren + 1:]
    return f"{internal_to_dot(class_internal)}.{method_name}({params_desc}){return_desc}"


def _infer_service(method_id: str) -> str:
    parts = method_id.split('.')
    if len(parts) >= 4 and parts[0] == 'com' and parts[1] == 'mediway' and parts[2] == 'his':
        return parts[3]
    return 'unknown'


def _strip_signature(method_id: str) -> str:
    idx = method_id.find('(')
    return method_id[:idx] if idx > 0 else method_id


def _method_class(method_id: str) -> str:
    base = _strip_signature(method_id)
    return base.rsplit('.', 1)[0] if '.' in base else base


def load_workspace_feign_classes() -> set:
    """读取 Step 1 输出的医生站 Feign 接口全名集合。"""
    path = OUTPUT_DIR / "feign_interfaces.json"
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {i["full_name"] for i in data.get("interfaces", []) if i.get("full_name")}


def _has_controller_class(jar_path: Path) -> bool:
    # 历史工程存在 Contoller 拼写（少一个 r），手机端 Controller 大量如此
    try:
        with zipfile.ZipFile(jar_path) as zf:
            return any(name.endswith(('Controller.class', 'Contoller.class'))
                       for name in zf.namelist())
    except Exception:
        return False


def select_latest_jars(maven_repo: Path) -> List[Path]:
    """
    按 artifact 取最新 SNAPSHOT jar，并纳入入口/接口所在工件。

    Controller 与 ESB 适配器不一定在 *-biz*.jar 中（例如
    ipnur-nurseexecution-api 的 ExcuteBindOrderController、opar-esb 的
    ArOPEsb*Controller），只扫 biz jar 会让这些链路没有入口。
    """
    jars = sorted(j for j in maven_repo.rglob("*.jar")
                  if 'SNAPSHOT' in j.name and not j.name.endswith('-sources.jar'))

    by_artifact = defaultdict(list)
    for jar in jars:
        by_artifact[jar.parent.parent.name].append(jar)

    latest_jars = []
    for artifact, group in by_artifact.items():
        group.sort(key=lambda x: x.name, reverse=True)
        jar = group[0]
        if '-biz' in jar.name or '-esb' in jar.name or '-api' in jar.name or _has_controller_class(jar):
            latest_jars.append(jar)
    return sorted(latest_jars)



@dataclass
class ClassInfo:
    full_name: str
    package_name: str
    class_name: str
    is_interface: bool = False
    is_abstract: bool = False
    is_controller: bool = False
    annotations: List[str] = field(default_factory=list)
    methods: List[MethodInfo] = field(default_factory=list)
    feign_fields: List[str] = field(default_factory=list)
    super_name: str = ""
    interfaces: List[str] = field(default_factory=list)


class MavenBizScanner:
    def __init__(self, maven_repo: Path):
        self.maven_repo = maven_repo
        self.call_graph = defaultdict(list)
        self.reverse_index = defaultdict(list)
        self.lambda_bridges = defaultdict(set)
        self.service_boundary = {}
        self.class_info = {}
        self.method_info = {}
        self.method_to_service = {}
        self.feign_interfaces = set()
        self.controller_endpoints = {}
        self.filter_stats = {}
        self.stats = {'jars_scanned': 0, 'classes_analyzed': 0, 'methods_extracted': 0, 'calls_extracted': 0}

    def scan_all_biz_jars(self):
        logger.info("开始扫描 Maven biz jar...")
        latest_jars = select_latest_jars(self.maven_repo)
        logger.info(f"候选 jar（含 biz/esb/api/Controller 工件）: {len(latest_jars)}")

        for i, jar in enumerate(latest_jars, 1):
            logger.info(f"[{i}/{len(latest_jars)}] 扫描: {jar.name}")
            try:
                self._scan_jar(jar)
                self.stats['jars_scanned'] += 1
            except Exception as e:
                logger.warning(f"扫描失败 {jar.name}: {e}")

        logger.info(f"\n扫描完成!")
        logger.info(f"  JAR: {self.stats['jars_scanned']}")
        logger.info(f"  类: {self.stats['classes_analyzed']}")
        logger.info(f"  方法: {self.stats['methods_extracted']}")
        logger.info(f"  调用: {self.stats['calls_extracted']}")

    def _scan_jar(self, jar_path: Path):
        """Scan a jar file using javatools (reads directly from zip, no temp extraction)"""
        try:
            with zipfile.ZipFile(jar_path, 'r') as zf:
                for entry_name in zf.namelist():
                    if not entry_name.endswith('.class'):
                        continue
                    try:
                        data = zf.read(entry_name)
                        self._analyze_class_bytes(data)
                        self.stats['classes_analyzed'] += 1
                    except Exception as e:
                        logger.debug(f"分析类失败 {entry_name}: {e}")
        except Exception as e:
            logger.warning(f"解压失败 {jar_path.name}: {e}")

    def _analyze_class_bytes(self, data: bytes):
        """Analyze a single class from raw bytes using javatools"""
        ci = unpack_class(io.BytesIO(data))

        class_internal = ci.get_this()
        if not class_internal:
            return
        full_name = internal_to_dot(class_internal)
        package_name = '.'.join(full_name.split('.')[:-1])
        class_name = full_name.split('.')[-1]

        is_interface = bool(ci.is_interface())
        is_abstract = bool(ci.is_abstract())

        annotations = []
        for anno in ci.get_annotations():
            anno_str = str(anno)
            m = re.search(r'@([\w.]+)', anno_str)
            if m:
                annotations.append(m.group(1))

        is_controller = ('Controller' in class_name or 'Contoller' in class_name
                         or any('RestController' in a for a in annotations))

        methods = self._extract_methods(ci, full_name)

        if is_controller:
            self._extract_endpoints(ci, full_name, class_name)

        feign_fields = self._extract_feign_fields(ci)

        class_info = ClassInfo(
            full_name=full_name, package_name=package_name, class_name=class_name,
            is_interface=is_interface, is_abstract=is_abstract, is_controller=is_controller,
            annotations=annotations, methods=methods, feign_fields=feign_fields,
            super_name=internal_to_dot(ci.get_super()) if ci.get_super() else "",
            interfaces=[internal_to_dot(i) for i in ci.get_interfaces()],
        )
        self.class_info[full_name] = class_info

        if is_interface and any('FeignClient' in a for a in annotations):
            self.feign_interfaces.add(full_name)

        method_calls = self._extract_method_calls(ci, full_name)
        for caller, callees in method_calls.items():
            self.call_graph[caller].extend(callees)
            for callee in callees:
                self.reverse_index[callee].append(caller)
            self.stats['calls_extracted'] += len(callees)

        if is_controller:
            feign_interface = self._find_feign_for_controller(class_info)
            if feign_interface:
                self.service_boundary[full_name] = feign_interface

    def _extract_methods(self, ci, class_name: str) -> List[MethodInfo]:
        methods = []
        for m in ci.methods:
            method_name = m.get_name()
            descriptor = m.get_descriptor()
            is_static = bool(m.is_static())

            paren_idx = descriptor.find('(')
            if paren_idx < 0:
                continue
            close_paren = descriptor.find(')')
            if close_paren < 0:
                continue
            params_desc = descriptor[paren_idx + 1:close_paren]
            return_desc = descriptor[close_paren + 1:]

            full_name = f"{class_name}.{method_name}({params_desc}){return_desc}"
            method_info = MethodInfo(
                full_name=full_name, class_name=class_name, method_name=method_name,
                params=params_desc, return_type=return_desc, is_static=is_static
            )
            methods.append(method_info)
            self.method_info[full_name] = method_info

            parts = class_name.split('.')
            if len(parts) >= 4 and parts[0] == 'com' and parts[1] == 'mediway' and parts[2] == 'his':
                self.method_to_service[full_name] = parts[3]
            self.stats['methods_extracted'] += 1

        if 'BLH' in class_name or 'Service' in class_name:
            logger.debug(f"类 {class_name} 提取到 {len(methods)} 个方法")

        return methods

    def _extract_endpoints(self, ci, fqn: str, class_name: str):
        """Controller 类级 @RequestMapping + 方法级映射注解 → URL（与源码扫描口径一致）。"""
        base = ""
        for anno in ci.get_annotations():
            if _annotation_simple_name(anno) == "RequestMapping":
                paths = annotation_paths(anno, ci.cpool)
                base = paths[0] if paths else ""
                break

        endpoints = []
        for m in ci.methods:
            for anno in m.get_annotations():
                simple = _annotation_simple_name(anno)
                if simple not in MAPPING_VERBS and simple != "RequestMapping":
                    continue
                values = annotation_paths(anno, ci.cpool)
                if not values:
                    continue
                http = annotation_verb(anno, simple, ci.cpool)
                for value in values:
                    endpoints.append({
                        "path": join_url(base, value),
                        "http": http,
                        "controller": class_name,
                        "controller_fqn": fqn,
                        "method": m.get_name(),
                        "class_path": join_url(base),
                        "method_path": join_url(value),
                    })
        if endpoints:
            self.controller_endpoints[fqn] = {
                "class_path": join_url(base),
                "endpoints": endpoints,
            }

    def _extract_feign_fields(self, ci) -> List[str]:
        feign_fields = []
        for f in ci.fields:
            field_desc = f.get_descriptor()
            field_name = f.get_name()
            if 'Client' in field_desc or 'Feign' in field_desc:
                feign_fields.append(field_desc)
            for anno in f.get_annotations():
                anno_str = str(anno)
                if 'Resource' in anno_str or 'Autowired' in anno_str:
                    if 'Client' in field_desc or 'Feign' in field_desc:
                        if field_desc not in feign_fields:
                            feign_fields.append(field_desc)
        return feign_fields

    def _extract_method_calls(self, ci, current_class: str) -> Dict[str, List[str]]:
        calls = defaultdict(list)
        cpool = ci.cpool
        bootstrap_methods = parse_bootstrap_methods(ci.attribs.get("BootstrapMethods"))

        for m in ci.methods:
            method_name = m.get_name()
            descriptor = m.get_descriptor()

            paren_idx = descriptor.find('(')
            close_paren = descriptor.find(')')
            if paren_idx < 0 or close_paren < 0:
                continue
            params_desc = descriptor[paren_idx + 1:close_paren]
            return_desc = descriptor[close_paren + 1:]

            caller_method = f"{current_class}.{method_name}({params_desc}){return_desc}"

            code = m.get_code()
            if not code:
                continue

            for offset, opcode, args in code.disassemble():
                if opcode == INVOKEDYNAMIC and args:
                    lambda_target = resolve_lambda_target(cpool, bootstrap_methods, args[0])
                    if lambda_target:
                        self.lambda_bridges[caller_method].add(lambda_target)
                    continue
                if opcode not in INVOKE_OPCODES or not args:
                    continue

                cp_index = args[0]
                resolved = resolve_invoke_target(cpool, cp_index)
                if not resolved:
                    continue

                target_class, target_method, target_params, target_return = resolved
                if is_system_class(target_class):
                    continue

                target_full = f"{target_class}.{target_method}({target_params}){target_return}"
                calls[caller_method].append(target_full)

        return calls

    def _find_feign_for_controller(self, class_info: ClassInfo) -> str:
        package_parts = class_info.package_name.split('.')
        if len(package_parts) >= 4 and package_parts[0] == 'com' and package_parts[1] == 'mediway' and package_parts[2] == 'his':
            service = package_parts[3]
            feign_package = f"com.mediway.his.{service}.api"
            for feign_name in self.feign_interfaces:
                if feign_name.startswith(feign_package):
                    return feign_name
        return None

    def filter_unrelated(self, feign_classes: set) -> dict:
        """
        保留与医生站有关的 Maven 服务及其上游调用方。

        seed 服务 = 至少有一个方法调用医生站 Feign 接口的服务。
        链路的入口 Controller 往往位于不直接调用 Feign 的服务（trbu/ipemr/opemr 等），
        只保留 seed 会在服务边界把反向链路剪断，因此额外保留反向可达 seed 的服务。
        粒度选服务而非方法，避免剪掉 BLH 反射调用的业务实现方法。
        Feign 接口本身是医生站侧节点，始终保留其调用边。
        """
        if not feign_classes:
            self.filter_stats = {'enabled': False}
            return self.filter_stats

        seed_services = set()
        all_services = set()
        for caller, callees in self.call_graph.items():
            svc = _infer_service(caller)
            all_services.add(svc)
            all_services.update(_infer_service(t) for t in callees)
            if any(_method_class(t) in feign_classes for t in callees):
                seed_services.add(svc)
        all_services.discard('unknown')
        seed_services.discard('unknown')

        upstream_services = set()
        frontier = set(seed_services)
        for _ in range(MAX_UPSTREAM_SERVICE_HOPS):
            if not frontier:
                break
            next_frontier = set()
            for caller, callees in self.call_graph.items():
                caller_svc = _infer_service(caller)
                if caller_svc in seed_services or caller_svc in upstream_services:
                    continue
                if any(_infer_service(t) in frontier for t in callees):
                    next_frontier.add(caller_svc)
            next_frontier.discard('unknown')
            upstream_services |= next_frontier
            frontier = next_frontier

        keep_services = seed_services | upstream_services

        graph = defaultdict(list)
        dropped_edges = 0
        for caller, callees in self.call_graph.items():
            if _infer_service(caller) not in keep_services:
                continue
            for callee in callees:
                if _method_class(callee) in feign_classes or _infer_service(callee) in keep_services:
                    graph[caller].append(callee)
                else:
                    dropped_edges += 1

        self.call_graph = graph
        self.reverse_index = defaultdict(list)
        for caller, callees in graph.items():
            for callee in callees:
                self.reverse_index[callee].append(caller)

        self.filter_stats = {
            'enabled': True,
            'kept_services': sorted(keep_services),
            'seed_services': sorted(seed_services),
            'upstream_services': sorted(upstream_services),
            'dropped_services': sorted(all_services - keep_services),
            'dropped_edges': dropped_edges,
        }
        logger.info(
            f"相关性过滤: 保留 {len(keep_services)} 个服务"
            f"（直接调用 Feign {len(seed_services)} + 上游 {len(upstream_services)}）, "
            f"剔除 {len(all_services - keep_services)} 个服务, 剔除边 {dropped_edges}"
        )
        return self.filter_stats

    def build_dispatch_index(self) -> dict:
        """构建接口/父类方法 → 实现方法的静态分派桥，供反向 Controller 链路还原使用。"""
        kept = set(self.filter_stats.get("kept_services", []))
        services = kept or None

        def service_of(cls_name: str) -> str:
            return _infer_service(cls_name)

        declared = set()
        class_methods = {}
        for fn, ci in self.class_info.items():
            keys = {(m.method_name, m.params, m.return_type) for m in ci.methods}
            class_methods[fn] = keys
            for key in keys:
                declared.add((fn, key))

        supertype_cache = {}

        def supertypes(cls_name: str) -> set:
            if cls_name in supertype_cache:
                return supertype_cache[cls_name]
            seen = set()
            stack = [cls_name]
            while stack:
                current = stack.pop()
                info = self.class_info.get(current)
                if not info:
                    continue
                parents = ([info.super_name] if info.super_name else []) + list(info.interfaces)
                for parent in parents:
                    if parent and parent != "java.lang.Object" and parent not in seen:
                        seen.add(parent)
                        stack.append(parent)
            supertype_cache[cls_name] = seen
            return seen

        bridges = defaultdict(set)
        for fn, ci in self.class_info.items():
            if services is not None and service_of(fn) not in services:
                continue
            for name, params, ret in class_methods.get(fn, ()):
                for parent in supertypes(fn):
                    if (parent, (name, params, ret)) in declared:
                        bridges[f"{parent}.{name}({params}){ret}"].add(f"{fn}.{name}({params}){ret}")

        lambda_bridge_count = 0
        for caller, lambda_methods in self.lambda_bridges.items():
            if services is not None and service_of(caller) not in services:
                continue
            for lambda_method in lambda_methods:
                bridges[caller].add(lambda_method)
                lambda_bridge_count += 1

        controllers = sorted(
            fn for fn, ci in self.class_info.items()
            if ci.is_controller and (services is None or service_of(fn) in services)
        )
        return {
            "bridges": {src: sorted(dsts) for src, dsts in bridges.items()},
            "controllers": controllers,
            "kept_services": sorted(services) if services is not None else [],
            "lambda_bridges": lambda_bridge_count,
        }

    def export_results(self, output_dir: Path):
        output_dir.mkdir(parents=True, exist_ok=True)

        with open(output_dir / 'maven_biz_call_graph.jsonl', 'w', encoding='utf-8') as f:
            for caller in sorted(self.call_graph):
                callees = self.call_graph[caller]
                entry = {
                    'type': 'calls', 'source': caller, 'targets': sorted(callees),
                    'source_service': self.method_to_service.get(caller, 'unknown')
                }
                f.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + '\n')
        logger.info(f"✓ 调用图已导出: {output_dir / 'maven_biz_call_graph.jsonl'}")

        with open(output_dir / 'maven_biz_reverse_index.json', 'w', encoding='utf-8') as f:
            json.dump({k: sorted(v) for k, v in self.reverse_index.items()},
                      f, ensure_ascii=False, indent=2, sort_keys=True)
        logger.info(f"✓ 反向索引已导出: {output_dir / 'maven_biz_reverse_index.json'}")

        with open(output_dir / 'maven_biz_service_boundary.json', 'w', encoding='utf-8') as f:
            json.dump(self.service_boundary, f, ensure_ascii=False, indent=2, sort_keys=True)
        logger.info(f"✓ 服务边界已导出: {output_dir / 'maven_biz_service_boundary.json'}")

        dispatch = self.build_dispatch_index()
        with open(output_dir / 'maven_biz_dispatch.json', 'w', encoding='utf-8') as f:
            json.dump(dispatch, f, ensure_ascii=False, sort_keys=True)
        logger.info(
            f"✓ 分派桥已导出: {output_dir / 'maven_biz_dispatch.json'}"
            f"（{len(dispatch['bridges'])} 个父类型方法, {len(dispatch['controllers'])} 个 Controller）"
        )

        endpoint_index = self._build_endpoint_index()
        with open(output_dir / 'maven_controller_endpoints.json', 'w', encoding='utf-8') as f:
            json.dump(endpoint_index, f, ensure_ascii=False, separators=(",", ":"))
        meta = endpoint_index["meta"]
        logger.info(
            f"✓ Maven 端点索引已导出: {output_dir / 'maven_controller_endpoints.json'}"
            f"（{meta['controllers']} 个 Controller / {meta['endpoints']} 条 URL / "
            f"{meta['mappings']} 个方法映射）"
        )

        with open(output_dir / 'maven_biz_scan_stats.json', 'w', encoding='utf-8') as f:
            json.dump({
                'stats': self.stats,
                'classes': len(self.class_info),
                'methods': len(self.method_info),
                'call_relations': sum(len(v) for v in self.call_graph.values()),
                'service_boundaries': len(self.service_boundary),
                'dispatch_bridges': len(dispatch['bridges']),
                'lambda_bridges': dispatch.get('lambda_bridges', 0),
                'controller_endpoints': {
                    'controllers': meta['controllers'],
                    'endpoints': meta['endpoints'],
                    'mappings': meta['mappings'],
                },
                'filter': self.filter_stats,
            }, f, ensure_ascii=False, indent=2, sort_keys=True)
        logger.info(f"✓ 统计信息已导出: {output_dir / 'maven_biz_scan_stats.json'}")

    def _build_endpoint_index(self) -> dict:
        """URL → Controller 方法，口径与 scan_controller_endpoints.py 保持一致。"""
        endpoints = {}
        for fqn in sorted(self.controller_endpoints):
            for ep in self.controller_endpoints[fqn]["endpoints"]:
                endpoints.setdefault(ep["path"], []).append(ep)
        for items in endpoints.values():
            items.sort(key=lambda x: (x["controller_fqn"], x["method"], x["http"]))
        return {
            "meta": {
                "sources": self.stats['jars_scanned'],
                "controllers": len(self.controller_endpoints),
                "endpoints": len(endpoints),
                "mappings": sum(len(v) for v in endpoints.values()),
                "origin": "maven_biz",
            },
            "endpoints": dict(sorted(endpoints.items())),
        }


def scan_single_jar(jar_path: Path) -> Dict:
    """
    扫描单个 jar（独立函数，用于并发扫描）
    返回：{'call_graph': {...}, 'reverse_index': {...}, 'service_boundary': {...},
           'class_info': {...}, 'method_info': {...}, 'method_to_service': {...},
           'controller_endpoints': {...}, 'feign_interfaces': set(), 'stats': {...}}
    """
    scanner = MavenBizScanner(jar_path.parent.parent.parent)
    scanner._scan_jar(jar_path)

    return {
        'jar_name': jar_path.name,
        'call_graph': dict(scanner.call_graph),
        'reverse_index': dict(scanner.reverse_index),
        'lambda_bridges': {k: sorted(v) for k, v in scanner.lambda_bridges.items()},
        'service_boundary': scanner.service_boundary,
        'class_info': scanner.class_info,
        'method_info': scanner.method_info,
        'method_to_service': scanner.method_to_service,
        'controller_endpoints': scanner.controller_endpoints,
        'feign_interfaces': scanner.feign_interfaces,
        'stats': scanner.stats,
    }


def main():
    parser = argparse.ArgumentParser(description="扫描 Maven biz jar 并生成医生站调用图")
    parser.add_argument("--no-filter", action="store_true",
                        help="保留全部 Maven 服务，不做医生站相关性过滤")
    args = parser.parse_args()

    maven_repo = get_primary_maven_repo() / "com" / "mediway" / "his"
    output_dir = OUTPUT_DIR

    logger.info("开始扫描 Maven biz jar（javatools ASM 方案）...")
    latest_jars = select_latest_jars(maven_repo)
    logger.info(f"候选 jar（含 biz/esb/api/Controller 工件）: {len(latest_jars)}")

    num_workers = cpu_count()
    logger.info(f"CPU 核数: {num_workers}，使用 {num_workers} 个进程并发扫描...")

    all_results = []
    with Pool(num_workers) as pool:
        for i, result in enumerate(pool.imap_unordered(scan_single_jar, latest_jars), 1):
            logger.info(f"[{i}/{len(latest_jars)}] 完成: {result['jar_name']}")
            all_results.append(result)

    # 并发返回顺序不稳定，合并前按 jar 名排序，保证索引逐字节可复现
    all_results.sort(key=lambda r: r['jar_name'])

    logger.info("\n合并扫描结果...")
    merged_scanner = MavenBizScanner(maven_repo)

    for result in all_results:
        merged_scanner.stats['jars_scanned'] += 1
        merged_scanner.stats['classes_analyzed'] += result['stats']['classes_analyzed']
        merged_scanner.stats['methods_extracted'] += result['stats']['methods_extracted']
        merged_scanner.stats['calls_extracted'] += result['stats']['calls_extracted']

        for caller, callees in result['call_graph'].items():
            merged_scanner.call_graph[caller].extend(callees)

        for callee, callers in result['reverse_index'].items():
            merged_scanner.reverse_index[callee].extend(callers)

        for caller, lambda_methods in result['lambda_bridges'].items():
            merged_scanner.lambda_bridges[caller].update(lambda_methods)

        merged_scanner.service_boundary.update(result['service_boundary'])
        merged_scanner.class_info.update(result['class_info'])
        merged_scanner.method_info.update(result['method_info'])
        merged_scanner.method_to_service.update(result['method_to_service'])
        merged_scanner.controller_endpoints.update(result['controller_endpoints'])
        merged_scanner.feign_interfaces.update(result['feign_interfaces'])

    logger.info(f"\n扫描完成!")
    logger.info(f"  JAR: {merged_scanner.stats['jars_scanned']}")
    logger.info(f"  类: {merged_scanner.stats['classes_analyzed']}")
    logger.info(f"  方法: {merged_scanner.stats['methods_extracted']}")
    logger.info(f"  调用: {merged_scanner.stats['calls_extracted']}")

    if not args.no_filter:
        feign_classes = load_workspace_feign_classes()
        if feign_classes:
            merged_scanner.filter_unrelated(feign_classes)
        else:
            logger.warning("未找到 feign_interfaces.json，跳过相关性过滤（请先运行 feign_scanner.py）")

    merged_scanner.export_results(output_dir)

    logger.info("\n" + "=" * 60)
    logger.info("Maven biz jar 扫描完成!")
    logger.info("=" * 60)


if __name__ == '__main__':
    main()
