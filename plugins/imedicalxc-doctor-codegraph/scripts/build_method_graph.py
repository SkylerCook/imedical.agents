#!/usr/bin/env python3
"""
生成方法级别的 Feign 调用图

解析策略：
- 先剥离注释与字符串，避免把注释中的调用、字符串中的关键字当成代码。
- 按花括号层级提取类型（含嵌套类型）与成员方法，构造精确的方法作用域。
- 调用归因依赖接收者类型：字段/参数/局部变量先建类型表，再解析字段、参数、
  局部变量、this/super、静态类引用；无法解析的接收者直接跳过，不再回退到当前类。
- 无接收者的同类调用（getGroupOrderMap(dto)）按当前类及父类方法表解析。
- Feign 调用只接受接口中真实声明的方法，避免生成幻影 Feign 边界。
"""
import json
import re
from pathlib import Path
from typing import Dict, List, Set, Tuple
from collections import defaultdict
from dataclasses import dataclass, field
import xml.etree.ElementTree as ET
from xml.dom import minidom
import logging

from config import OUTPUT_DIR, to_repo_relative

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

JAVA_KEYWORDS = {
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
    'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
    'package', 'private', 'protected', 'public', 'record', 'return', 'short',
    'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
    'throws', 'transient', 'try', 'void', 'volatile', 'while', 'yield',
}

JAVA_PRIMITIVES = {
    'boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short', 'void', 'var',
}

JAVA_LANG = {
    'String', 'Object', 'Integer', 'Long', 'Short', 'Byte', 'Double', 'Float',
    'Boolean', 'Character', 'Number', 'Math', 'System', 'Thread', 'Exception',
    'RuntimeException', 'Throwable', 'Error', 'Class', 'Enum', 'Iterable',
    'Comparable', 'Runnable', 'CharSequence', 'StringBuilder', 'StringBuffer',
    'Void', 'Override', 'Deprecated', 'SuppressWarnings',
}

SYSTEM_PACKAGES = (
    'java.', 'javax.', 'sun.', 'com.sun.',
    'org.xml.', 'org.w3c.', 'org.omg.',
    'cn.hutool.',
    'com.alibaba.fastjson.', 'com.alibaba.excel.', 'com.alibaba.druid.',
    'com.alibaba.nacos.',
    'com.google.common.', 'com.google.gson.', 'com.google.zxing.',
    'com.beust.jcommander.',
    'com.fhs.',
    'com.github.xiaoymin.knife4j.',
    'dm.jdbc.',
    'io.jsonwebtoken.', 'io.micrometer.',
    'jodd.',
    'kotlin.',
    'net.sourceforge.pinyin4j.',
    'org.bouncycastle.',
    'org.springframework.', 'reactor.core.',
    'org.apache.commons.', 'org.apache.pdfbox.', 'org.apache.rocketmq.',
    'org.apache.http.', 'org.apache.poi.',
    'org.assertj.', 'org.eclipse.jetty.', 'org.junit.',
    'com.fasterxml.',
    'co.elastic.',
    'org.json.',
    'com.baomidou.',
    'com.mediway.hos.',
    'com.mediway.his.generator',
    'com.mediway.his.api.exception.',
    'com.mediway.his.api.entity.',
    'com.mediway.his.hisbase.',
    'com.mediway.his.server.',
    'com.mediway.his.common.cache.',
    'com.mediway.his.log.',
)


def _graph_id(method_id: str) -> str:
    """GraphML 节点 ID：去掉参数与返回类型，收敛为 package.Class.method"""
    idx = method_id.find('(')
    return method_id[:idx] if idx > 0 else method_id


def _service_of(method_id: str) -> str:
    parts = method_id.split('.')
    if len(parts) > 4 and parts[:3] == ['com', 'mediway', 'his']:
        return parts[3]
    return "unknown"


def _is_system_class(class_name: str) -> bool:
    if not class_name:
        return False
    if class_name in JAVA_LANG:
        return True
    return any(class_name.startswith(pkg) for pkg in SYSTEM_PACKAGES)


def _blank(match: re.Match) -> str:
    return re.sub(r'[^\n]', ' ', match.group(0))


def _strip_java(text: str) -> str:
    """把注释、字符串、字符字面量替换为等长空白，保留换行与位置"""
    text = re.sub(r'""".*?"""', _blank, text, flags=re.S)
    text = re.sub(r'/\*.*?\*/', _blank, text, flags=re.S)
    text = re.sub(r'//[^\n]*', _blank, text)
    text = re.sub(r'"(?:\\.|[^"\\\n])*"', _blank, text)
    text = re.sub(r"'(?:\\.|[^'\\\n])*'", _blank, text)
    return text


BLH_ANNOTATION_RE = re.compile(r'@(?:[\w.]+\.)?BLH\s*\(')


def _parse_blh_name(raw: str, stripped: str, decl_start: int) -> str:
    """取 class 关键字前最近的 @BLH(...) 的 value

    注解与其中的字符串在 stripped 中已被抹成空白，需按同一偏移回读原文。
    """
    start = max(stripped.rfind('}', 0, decl_start), stripped.rfind(';', 0, decl_start)) + 1
    window = raw[start:decl_start]
    matches = list(BLH_ANNOTATION_RE.finditer(window))
    if not matches:
        return ""
    open_idx = matches[-1].end() - 1
    depth = 0
    for j in range(open_idx, len(window)):
        ch = window[j]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                args = window[open_idx + 1:j]
                m = re.search(r'\bvalue\s*=\s*"([^"]*)"', args)
                if m:
                    return m.group(1).strip()
                m = re.match(r'\s*"([^"]*)"', args)
                return m.group(1).strip() if m else ""
    return ""


def _split_top_level(text: str, sep: str = ',') -> List[str]:
    """按顶层分隔符切分，忽略泛型/括号内的分隔符"""
    parts = []
    depth = 0
    start = 0
    for i, ch in enumerate(text):
        if ch in '<([{':
            depth += 1
        elif ch in '>)]}':
            depth = max(0, depth - 1)
        elif ch == sep and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return parts


def _strip_annotations(text: str) -> str:
    """把注解（含参数）替换为等长空白，避免注解参数中的花括号干扰成员切分"""
    out = list(text)
    i = 0
    n = len(text)
    while i < n:
        if text[i] != '@':
            i += 1
            continue
        m = re.match(r'@[\w.]+', text[i:])
        if not m:
            i += 1
            continue
        end = i + m.end()
        j = end
        while j < n and text[j] in ' \t\r\n':
            j += 1
        if j < n and text[j] == '(':
            close = _match_paren(text, j)
            if close >= 0:
                end = close + 1
        for k in range(i, end):
            if out[k] != '\n':
                out[k] = ' '
        i = end
    return ''.join(out)


def _match_paren(text: str, open_idx: int) -> int:
    depth = 0
    for i in range(open_idx, len(text)):
        ch = text[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return i
    return -1


def _strip_annotations_and_modifiers(head: str) -> str:
    s = head
    while True:
        m = re.match(r'\s*@[\w.]+(?:\s*\((?:[^()]|\([^()]*\))*\))?', s)
        if not m:
            break
        s = s[m.end():]
    while True:
        m = re.match(
            r'\s*(?:public|protected|private|static|final|abstract|synchronized|'
            r'native|default|strictfp|transient|volatile)\b',
            s,
        )
        if not m:
            break
        s = s[m.end():]
    return s.strip()


def _parse_var_decl(decl: str) -> Tuple[str, str]:
    """解析 `Type name`，返回 (type, name)；失败返回 ('','')"""
    m = re.search(r'([A-Za-z_]\w*)\s*$', decl.strip())
    if not m:
        return '', ''
    name = m.group(1)
    var_type = decl.strip()[:m.start()].strip()
    var_type = re.sub(r'^final\s+', '', var_type)
    if not var_type or not name or name in JAVA_KEYWORDS:
        return '', ''
    return var_type, name


def _parse_params(params: str) -> Dict[str, str]:
    out = {}
    for part in _split_top_level(params):
        p = part.strip()
        if not p:
            continue
        p = re.sub(r'^@[\w.]+(?:\([^)]*\))?\s*', '', p)
        var_type, name = _parse_var_decl(p)
        if var_type and name:
            out[name] = var_type
    return out


@dataclass
class MethodNode:
    """方法节点"""
    full_name: str  # package.Class.method(params)
    class_name: str
    method_name: str
    package: str
    service: str
    is_feign_interface: bool = False
    file_path: str = ""
    params: str = ""
    param_types: Dict[str, str] = field(default_factory=dict)
    body_start: int = -1
    body_end: int = -1


@dataclass
class ClassInfo:
    """类型信息（含嵌套类型）"""
    fqn: str
    simple_name: str
    package: str
    file_path: str
    service: str
    body_start: int
    body_end: int
    imports: Dict[str, str]
    outer: str = ""
    extends_raw: str = ""
    blh_name: str = ""
    is_feign: bool = False
    fields: Dict[str, str] = field(default_factory=dict)
    methods: List[MethodNode] = field(default_factory=list)


@dataclass
class MethodCall:
    """方法调用"""
    caller: str
    callee: str
    call_type: str  # "internal" | "feign"
    feign_interface: str = ""


class MethodGraphBuilder:
    """方法级调用图构建器"""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.nodes: Dict[str, MethodNode] = {}
        self.edges: List[MethodCall] = []

        self.feign_interfaces: Dict[str, Dict] = {}
        self.feign_methods: Dict[str, Set[str]] = defaultdict(set)
        self.feign_simple_to_fqn: Dict[str, str] = {}

        self.class_info: Dict[str, ClassInfo] = {}
        self.class_to_file: Dict[str, Path] = {}
        self.methods_by_class: Dict[str, Dict[str, List[MethodNode]]] = defaultdict(lambda: defaultdict(list))
        self.simple_to_fqns: Dict[str, List[str]] = defaultdict(list)
        self.parents: Dict[str, str] = {}
        self.file_types: Dict[str, List[str]] = defaultdict(list)

        self._seen_edges: Set[Tuple[str, str, str, str]] = set()
        self._skipped_calls = 0

        self.package_pattern = re.compile(r'^\s*package\s+([\w.]+)\s*;', re.MULTILINE)
        self.import_pattern = re.compile(r'^\s*import\s+(?!static\b)([\w.]+)\s*;', re.MULTILINE)
        self.type_pattern = re.compile(r'(?<![\w@])(class|interface|enum|record)\s+([A-Za-z_]\w*)')
        self.receiver_call_pattern = re.compile(r'(?<![\w.$])([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(')
        self.bare_call_pattern = re.compile(r'(?<![\w.$@])([A-Za-z_]\w*)\s*\(')
        self.local_var_pattern = re.compile(
            r'(?<![\w.$])(?:final\s+)?'
            r'((?:[A-Z][\w$]*|[a-z]\w*(?:\.[A-Z]\w*)+)(?:\s*<[^;{}()=]*>)?(?:\[\])*)'
            r'\s+([A-Za-z_]\w*)\s*(?=[=;,:)])'
        )

        # 方法级排除列表（噪声方法，非系统类但无分析价值）
        self.excluded_methods = (
            'BusinessEnum.busConvertEnum',
        )

    def _is_excluded_method(self, method_name: str) -> bool:
        return any(excluded in method_name for excluded in self.excluded_methods)

    def load_feign_interfaces(self, feign_json_path: Path):
        with open(feign_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        for iface in data['interfaces']:
            full_name = iface['full_name']
            self.feign_interfaces[full_name] = iface
            self.feign_simple_to_fqn[iface.get('class_name', full_name.split('.')[-1])] = full_name
            for method in iface['methods']:
                self.feign_methods[full_name].add(method['name'])

        logger.info(f"加载 {len(self.feign_interfaces)} 个 Feign 接口")

    def build_graph(self):
        repos = [
            "care/aggcare-mediway-boot",
            "care/cfmr-mediway",
            "care/cfoe-mediway",
            "care/commr-mediway",
            "care/comoe-mediway",
            "care/ipcare-mediway-boot",
            "care/opcare-mediway-boot",
            "curc-mediway-boot",
            "hispa-mediway-boot",
            "ma-mediway-boot",
            "opalloc-mediway-boot",
            "opreg-mediway-boot",
        ]

        for repo in repos:
            repo_path = self.workspace_root / repo
            if not repo_path.exists():
                continue
            logger.info(f"扫描仓库: {repo}")
            self._scan_directory(repo_path)

        logger.info(f"共发现 {len(self.nodes)} 个方法节点")
        self._build_indexes()

        for repo in repos:
            repo_path = self.workspace_root / repo
            if not repo_path.exists():
                continue
            logger.info(f"分析调用: {repo}")
            self._analyze_directory(repo_path)

        logger.info(f"共发现 {len(self.edges)} 条调用边（跳过无法解析的调用 {self._skipped_calls} 次）")

    # ── 第一遍：类型、字段、方法 ────────────────────────────────

    def _scan_directory(self, dir_path: Path):
        for java_file in sorted(dir_path.rglob("*.java")):
            try:
                self._scan_file(java_file)
            except Exception as e:
                logger.debug(f"扫描文件失败 {java_file}: {e}")

    def _scan_file(self, file_path: Path):
        if 'generator' in str(file_path).lower():
            return

        content = file_path.read_text(encoding='utf-8')
        stripped = _strip_java(content)
        is_feign_file = '@FeignClient' in stripped
        stripped = _strip_annotations(stripped)

        package_match = self.package_pattern.search(stripped)
        package_name = package_match.group(1) if package_match else ""

        imports = {}
        for imp in self.import_pattern.findall(stripped):
            simple = imp.split('.')[-1]
            if simple and simple != '*':
                imports[simple] = imp

        service = self._infer_service(file_path)
        brace_map = self._brace_map(stripped)
        types_in_file: List[ClassInfo] = []

        for match in self.type_pattern.finditer(stripped):
            kind = match.group(1)
            simple_name = match.group(2)
            open_idx = stripped.find('{', match.end())
            if open_idx < 0 or open_idx not in brace_map:
                continue
            close_idx = brace_map[open_idx]

            outer = self._enclosing_type(open_idx, types_in_file)
            prefix = outer.fqn if outer else package_name
            fqn = f"{prefix}.{simple_name}" if prefix else simple_name

            if _is_system_class(fqn):
                continue

            header = stripped[match.end():open_idx]
            extends_raw = self._parse_extends(header)

            info = ClassInfo(
                fqn=fqn,
                simple_name=simple_name,
                package=package_name,
                file_path=str(file_path),
                service=service,
                body_start=open_idx + 1,
                body_end=close_idx,
                imports=imports,
                outer=outer.fqn if outer else "",
                extends_raw=extends_raw,
                blh_name=_parse_blh_name(content, stripped, match.start()),
                is_feign=is_feign_file,
            )
            self.class_info[fqn] = info
            self.class_to_file[fqn] = file_path
            self.file_types[str(file_path)].append(fqn)
            types_in_file.append(info)

            self._parse_members(info, stripped)

    def _brace_map(self, text: str) -> Dict[int, int]:
        stack = []
        pairs = {}
        for m in re.finditer(r'[{}]', text):
            if m.group() == '{':
                stack.append(m.start())
            elif stack:
                pairs[stack.pop()] = m.start()
        return pairs

    def _enclosing_type(self, open_idx: int, types_in_file: List[ClassInfo]) -> ClassInfo:
        best = None
        for info in types_in_file:
            if info.body_start - 1 < open_idx < info.body_end:
                if best is None or info.body_start > best.body_start:
                    best = info
        return best

    def _parse_extends(self, header: str) -> str:
        m = re.search(r'\bextends\b([^{]*)', header)
        if not m:
            return ""
        first = _split_top_level(m.group(1))[0].strip()
        first = re.sub(r'<.*>', '', first).strip()
        first = first.split()[0] if first.split() else ''
        return first if first and first not in JAVA_KEYWORDS else ""

    def _parse_members(self, info: ClassInfo, stripped: str):
        depth = 0
        chunk_start = info.body_start
        i = info.body_start
        while i < info.body_end:
            ch = stripped[i]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    self._parse_member(info, stripped[chunk_start:i + 1], chunk_start)
                    chunk_start = i + 1
            elif ch == ';' and depth == 0:
                self._parse_member(info, stripped[chunk_start:i + 1], chunk_start)
                chunk_start = i + 1
            i += 1

    def _parse_member(self, info: ClassInfo, chunk: str, offset: int):
        chunk = chunk.rstrip()
        if not chunk:
            return

        body_open = chunk.find('{')
        head = chunk[:body_open] if body_open >= 0 else chunk.rstrip(';')
        head_clean = _strip_annotations_and_modifiers(head)
        if not head_clean:
            return
        if re.match(r'(class|interface|enum|record)\b', head_clean):
            return

        paren = head_clean.find('(')
        eq = head_clean.find('=')
        if paren < 0 or (eq >= 0 and eq < paren):
            self._parse_field(info, head_clean.split('=', 1)[0])
            return

        close_paren = _match_paren(head_clean, paren)
        if close_paren < 0:
            return

        pre = head_clean[:paren].strip()
        name_m = re.search(r'([A-Za-z_]\w*)\s*$', pre)
        if not name_m:
            return
        name = name_m.group(1)
        return_type = pre[:name_m.start()].strip()
        if not return_type or name in JAVA_KEYWORDS:
            return
        if name == info.simple_name:
            return  # 构造器

        params = head_clean[paren + 1:close_paren]
        params_norm = re.sub(r'\s+', ' ', params).strip()
        full_name = f"{info.fqn}.{name}({params_norm})"

        if body_open >= 0 and chunk.endswith('}'):
            body_start = offset + body_open + 1
            body_end = offset + len(chunk) - 1
        else:
            body_start = body_end = -1

        node = MethodNode(
            full_name=full_name,
            class_name=info.fqn,
            method_name=name,
            package=info.package,
            service=info.service,
            is_feign_interface=info.is_feign,
            file_path=info.file_path,
            params=params_norm,
            param_types=_parse_params(params),
            body_start=body_start,
            body_end=body_end,
        )
        info.methods.append(node)
        self.nodes[full_name] = node
        self.methods_by_class[info.fqn][name].append(node)

    def _parse_field(self, info: ClassInfo, decl: str):
        decl = decl.strip().rstrip(';').strip()
        if not decl or re.match(r'(class|interface|enum|record)\b', decl):
            return
        for part in _split_top_level(decl):
            var_type, name = _parse_var_decl(part)
            if var_type and name:
                info.fields[name] = var_type

    def _build_indexes(self):
        for fqn in self.class_info:
            simple = fqn.rsplit('.', 1)[-1]
            self.simple_to_fqns[simple].append(fqn)

        for fqn, info in self.class_info.items():
            if not info.extends_raw:
                continue
            parent = self._resolve_simple(info.extends_raw, info)
            if parent and parent != fqn:
                self.parents[fqn] = parent

        logger.info(f"类型: {len(self.class_info)}，其中带父类: {len(self.parents)}")

    # ── 第二遍：调用分析 ────────────────────────────────────────

    def _analyze_directory(self, dir_path: Path):
        for java_file in sorted(dir_path.rglob("*.java")):
            try:
                self._analyze_file_calls(java_file)
            except Exception as e:
                logger.debug(f"分析调用失败 {java_file}: {e}")

    def _analyze_file_calls(self, file_path: Path):
        if 'generator' in str(file_path).lower():
            return
        fqns = self.file_types.get(str(file_path))
        if not fqns:
            return

        content = file_path.read_text(encoding='utf-8')
        stripped = _strip_annotations(_strip_java(content))

        for fqn in fqns:
            info = self.class_info[fqn]
            for method in info.methods:
                if method.body_start >= 0:
                    self._analyze_method(info, method, stripped)

    def _analyze_method(self, info: ClassInfo, method: MethodNode, stripped: str):
        body = stripped[method.body_start:method.body_end]
        var_types = dict(self._fields_of(info.fqn))
        var_types.update(method.param_types)
        for m in self.local_var_pattern.finditer(body):
            var_type, name = _parse_var_decl(f"{m.group(1)} {m.group(2)}")
            if var_type and name:
                var_types[name] = var_type

        feign_fields = {}
        for var_name, raw_type in var_types.items():
            feign_fqn = self._resolve_feign_type(raw_type, info)
            if feign_fqn:
                feign_fields[var_name] = feign_fqn

        for m in self.receiver_call_pattern.finditer(body):
            receiver, called = m.group(1), m.group(2)
            if (receiver in JAVA_KEYWORDS and receiver not in ('this', 'super')) \
                    or called in JAVA_KEYWORDS:
                continue
            self._handle_receiver_call(info, method, receiver, called, var_types, feign_fields)

        for m in self.bare_call_pattern.finditer(body):
            name = m.group(1)
            if name in JAVA_KEYWORDS or name[0].isupper():
                continue
            before = body[:m.start(1)].rstrip()
            if before.endswith('new'):
                continue
            target = self._resolve_method(info.fqn, name)
            if target is None:
                self._skipped_calls += 1
                continue
            self._add_edge(method.full_name, target.full_name, "internal")

    def _handle_receiver_call(
        self,
        info: ClassInfo,
        method: MethodNode,
        receiver: str,
        called: str,
        var_types: Dict[str, str],
        feign_fields: Dict[str, str],
    ):
        if receiver in feign_fields:
            feign_fqn = feign_fields[receiver]
            signature = self._find_feign_method_signature(feign_fqn, called)
            if signature:
                self._add_edge(method.full_name, signature, "feign", feign_fqn)
            else:
                self._skipped_calls += 1
            return

        target_class = self._resolve_receiver_class(receiver, info, var_types)
        if not target_class:
            self._skipped_calls += 1
            return
        if _is_system_class(target_class):
            return

        target = self._resolve_method(target_class, called)
        if target is not None:
            self._add_edge(method.full_name, target.full_name, "internal")
        elif target_class != info.fqn:
            self._add_edge(method.full_name, f"{target_class}.{called}", "internal")
        else:
            self._skipped_calls += 1

    def _resolve_receiver_class(self, receiver: str, info: ClassInfo, var_types: Dict[str, str]) -> str:
        if receiver == 'this':
            return info.fqn
        if receiver == 'super':
            return self.parents.get(info.fqn, '')
        if receiver in var_types:
            return self._resolve_type(var_types[receiver], info)
        # 静态类引用：Foo.bar()
        return self._resolve_type(receiver, info)

    def _resolve_type(self, raw_type: str, info: ClassInfo) -> str:
        t = raw_type.strip()
        if not t:
            return ''
        t = re.sub(r'<.*>', '', t, flags=re.S)
        t = t.replace('...', '').replace('[]', '').strip()
        t = re.sub(r'^final\s+', '', t)
        if not t or t in JAVA_PRIMITIVES or t == 'var' or t.startswith('?'):
            return ''

        if '.' in t:
            if t in self.class_info:
                return t
            head, rest = t.split('.', 1)
            head_fqn = self._resolve_simple(head, info)
            if head_fqn:
                return f"{head_fqn}.{rest}"
            candidate = f"{info.package}.{t}" if info.package else t
            if candidate in self.class_info:
                return candidate
            return t

        return self._resolve_simple(t, info)

    def _resolve_simple(self, name: str, info: ClassInfo) -> str:
        if name in JAVA_LANG:
            return f"java.lang.{name}"
        if name in info.imports:
            return info.imports[name]
        candidate = f"{info.package}.{name}" if info.package else name
        if candidate in self.class_info:
            return candidate
        for fqn in self.file_types.get(info.file_path, []):
            if fqn.rsplit('.', 1)[-1] == name:
                return fqn
        matches = self.simple_to_fqns.get(name, [])
        if len(matches) == 1:
            return matches[0]
        return ''

    def _resolve_feign_type(self, raw_type: str, info: ClassInfo) -> str:
        resolved = self._resolve_type(raw_type, info)
        if resolved in self.feign_interfaces:
            return resolved
        simple = re.sub(r'<.*>', '', raw_type).strip().split('.')[-1]
        return self.feign_simple_to_fqn.get(simple, '')

    def _ancestor_chain(self, class_fqn: str) -> List[str]:
        """沿 extends 上溯的全部祖先 FQN（近→远），用于跨无方法中间类还原继承族"""
        chain = []
        visited = {class_fqn}
        current = self.parents.get(class_fqn, '')
        while current and current not in visited:
            visited.add(current)
            chain.append(current)
            current = self.parents.get(current, '')
        return chain

    def _resolve_method(self, class_fqn: str, method_name: str):
        current = class_fqn
        visited = set()
        while current and current not in visited:
            visited.add(current)
            methods = self.methods_by_class.get(current, {})
            if method_name in methods:
                return methods[method_name][0]
            current = self.parents.get(current, '')
        return None

    def _fields_of(self, class_fqn: str) -> Dict[str, str]:
        fields = {}
        visited = set()
        current = class_fqn
        while current and current not in visited:
            visited.add(current)
            info = self.class_info.get(current)
            if info:
                fields.update(info.fields)
            current = info.outer if info else ''
        current = self.parents.get(class_fqn, '')
        while current and current not in visited:
            visited.add(current)
            info = self.class_info.get(current)
            if info:
                fields.update(info.fields)
            current = self.parents.get(current, '')
        return fields

    def _find_feign_method_signature(self, feign_interface: str, method_name: str) -> str:
        current = feign_interface
        visited = set()
        while current and current not in visited:
            visited.add(current)
            iface_info = self.feign_interfaces.get(current)
            if iface_info:
                for method in iface_info.get('methods', []):
                    if method['name'] == method_name:
                        params = method.get('params', '')
                        return f"{current}.{method_name}({params})"
            current = self.parents.get(current, '')
        return ""

    def _add_edge(self, caller: str, callee: str, call_type: str, feign_interface: str = ""):
        if self._is_excluded_method(callee):
            return
        key = (caller, callee, call_type, feign_interface)
        if key in self._seen_edges:
            return
        self._seen_edges.add(key)
        self.edges.append(MethodCall(
            caller=caller,
            callee=callee,
            call_type=call_type,
            feign_interface=feign_interface,
        ))

    def _infer_service(self, file_path: Path) -> str:
        path_str = str(file_path)
        if "opcare-mediway-boot" in path_str:
            return "opcare"
        elif "ipcare-mediway-boot" in path_str:
            return "ipcare"
        elif "aggcare-mediway-boot" in path_str:
            return "aggcare"
        elif "opreg-mediway-boot" in path_str:
            return "opreg"
        elif "hispa-mediway-boot" in path_str:
            return "hispa"
        elif "ma-mediway-boot" in path_str:
            return "ma"
        elif "curc-mediway-boot" in path_str:
            return "curc"
        elif "opalloc-mediway-boot" in path_str:
            return "opalloc"
        elif "comoe-mediway" in path_str:
            return "comoe"
        elif "cfoe-mediway" in path_str:
            return "cfoe"
        elif "commr-mediway" in path_str:
            return "commr"
        elif "cfmr-mediway" in path_str:
            return "cfmr"
        else:
            return "unknown"

    # ── 导出 ────────────────────────────────────────────────────

    def export_to_graphml(self, output_path: Path):
        graph_nodes: Dict[str, Dict] = {}
        for node in self.nodes.values():
            gid = _graph_id(node.full_name)
            existing = graph_nodes.get(gid)
            if existing is None:
                graph_nodes[gid] = {
                    'label': f"{node.class_name.split('.')[-1]}.{node.method_name}",
                    'package': node.package,
                    'service': node.service,
                    'is_feign': node.is_feign_interface,
                    'synthetic': False,
                }
            elif node.is_feign_interface:
                existing['is_feign'] = True

        graph_edges: Dict[Tuple[str, str], Dict] = {}
        for edge in self.edges:
            source = _graph_id(edge.caller)
            target = _graph_id(edge.callee)
            if not source or not target:
                continue
            key = (source, target)
            existing = graph_edges.get(key)
            if existing is None or (edge.call_type == 'feign' and existing['call_type'] != 'feign'):
                graph_edges[key] = {
                    'call_type': edge.call_type,
                    'feign_interface': edge.feign_interface if edge.call_type == 'feign' else '',
                }

        synthetic_nodes: Set[str] = set()
        for source, target in graph_edges:
            for endpoint in (source, target):
                if endpoint in graph_nodes:
                    continue
                class_name, method_name = endpoint.rsplit('.', 1) if '.' in endpoint else (endpoint, endpoint)
                graph_nodes[endpoint] = {
                    'label': f"{class_name.rsplit('.', 1)[-1]}.{method_name}",
                    'package': class_name.rsplit('.', 1)[0] if '.' in class_name else "",
                    'service': _service_of(endpoint),
                    'is_feign': class_name in self.feign_interfaces,
                    'synthetic': True,
                }
                synthetic_nodes.add(endpoint)

        graphml = ET.Element('graphml')
        graphml.set('xmlns', 'http://graphml.graphdrawing.org/xmlns')

        keys = [
            ('label', 'string', 'node', '节点标签'),
            ('type', 'string', 'node', '节点类型'),
            ('package', 'string', 'node', '包名'),
            ('service', 'string', 'node', '所属服务'),
            ('is_feign', 'boolean', 'node', '是否Feign接口'),
            ('synthetic', 'boolean', 'node', '边端点补全的占位节点'),
            ('call_type', 'string', 'edge', '调用类型'),
            ('feign_interface', 'string', 'edge', 'Feign 接口'),
        ]

        for key_id, key_type, key_for, key_desc in keys:
            key_elem = ET.SubElement(graphml, 'key')
            key_elem.set('id', key_id)
            key_elem.set('attr.name', key_id)
            key_elem.set('attr.type', key_type)
            key_elem.set('for', key_for)

        graph = ET.SubElement(graphml, 'graph')
        graph.set('id', 'MethodCallGraph')
        graph.set('edgedefault', 'directed')

        for node_id in sorted(graph_nodes):
            node = graph_nodes[node_id]
            node_elem = ET.SubElement(graph, 'node')
            node_elem.set('id', node_id)
            for key, value in (
                ('label', node['label']),
                ('type', 'method'),
                ('package', node['package']),
                ('service', node['service']),
                ('is_feign', str(node['is_feign']).lower()),
                ('synthetic', str(node['synthetic']).lower()),
            ):
                data = ET.SubElement(node_elem, 'data')
                data.set('key', key)
                data.text = value

        for idx, key in enumerate(sorted(graph_edges)):
            source, target = key
            edge = graph_edges[key]
            edge_elem = ET.SubElement(graph, 'edge')
            edge_elem.set('id', f'e{idx}')
            edge_elem.set('source', source)
            edge_elem.set('target', target)

            call_type_data = ET.SubElement(edge_elem, 'data')
            call_type_data.set('key', 'call_type')
            call_type_data.text = edge['call_type']

            if edge['feign_interface']:
                feign_data = ET.SubElement(edge_elem, 'data')
                feign_data.set('key', 'feign_interface')
                feign_data.text = edge['feign_interface']

        xml_str = ET.tostring(graphml, encoding='unicode')
        dom = minidom.parseString(xml_str)
        pretty_xml = dom.toprettyxml(indent='  ')

        output_path.write_text(pretty_xml, encoding='utf-8')
        logger.info(f"✓ GraphML 已生成: {output_path}")
        logger.info(f"  节点数: {len(graph_nodes)}（其中占位节点 {len(synthetic_nodes)}）")
        logger.info(f"  边数: {len(graph_edges)}（原始 {len(self.edges)}，重载与重复边已合并）")

    def export_to_jsonl(self, output_path: Path):
        with open(output_path, 'w', encoding='utf-8') as f:
            for node_id in sorted(self.nodes):
                node = self.nodes[node_id]
                class_info = self.class_info.get(node.class_name)
                node_data = {
                    'type': 'node',
                    'id': node_id,
                    'label': f"{node.class_name.split('.')[-1]}.{node.method_name}",
                    'class': node.class_name,
                    'method': node.method_name,
                    'package': node.package,
                    'service': node.service,
                    'is_feign': node.is_feign_interface,
                    'file_path': to_repo_relative(node.file_path),
                    'parent': self.parents.get(node.class_name, ''),
                    'ancestors': self._ancestor_chain(node.class_name),
                    'blh_name': class_info.blh_name if class_info else '',
                }
                f.write(json.dumps(node_data, ensure_ascii=False, sort_keys=True) + '\n')

            sorted_edges = sorted(
                self.edges,
                key=lambda e: (e.caller, e.callee, e.call_type, e.feign_interface or ''),
            )
            for idx, edge in enumerate(sorted_edges):
                edge_data = {
                    'type': 'edge',
                    'id': f'e{idx}',
                    'source': edge.caller,
                    'target': edge.callee,
                    'call_type': edge.call_type,
                    'feign_interface': edge.feign_interface if edge.call_type == 'feign' else None,
                }
                f.write(json.dumps(edge_data, ensure_ascii=False, sort_keys=True) + '\n')

        logger.info(f"✓ JSONL 已生成: {output_path}")


if __name__ == "__main__":
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    workspace_root = PROJECT_ROOT / "src" / "backend"
    output_dir = OUTPUT_DIR
    feign_json_path = output_dir / "feign_interfaces.json"

    builder = MethodGraphBuilder(workspace_root)
    builder.load_feign_interfaces(feign_json_path)
    builder.build_graph()
    builder.export_to_graphml(output_dir / "method_call_graph.graphml")
    builder.export_to_jsonl(output_dir / "method_call_graph.jsonl")
