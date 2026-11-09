"""
JAR 文件分析器
使用 javatools 纯 Python 字节码分析提取方法调用关系
"""
import io
import zipfile
import re
from pathlib import Path
from typing import List, Dict, Set, Optional, Tuple
from dataclasses import dataclass, field
import logging

from javatools import unpack_class

INVOKE_OPCODES = {182, 183, 184, 185}


def internal_to_dot(internal_name: str) -> str:
    return internal_name.replace('/', '.').replace('$', '.')


@dataclass
class JavaClass:
    name: str
    source_jar: Path
    is_interface: bool = False
    is_abstract: bool = False
    super_class: Optional[str] = None
    interfaces: List[str] = field(default_factory=list)
    methods: List["JavaMethod"] = field(default_factory=list)
    fields: List["JavaField"] = field(default_factory=list)

    @property
    def simple_name(self) -> str:
        return self.name.split(".")[-1]

    @property
    def package_name(self) -> str:
        parts = self.name.rsplit(".", 1)
        return parts[0] if len(parts) > 1 else ""


@dataclass
class JavaMethod:
    name: str
    descriptor: str
    return_type: str
    parameters: List[str]
    declaring_class: JavaClass
    is_static: bool = False
    is_abstract: bool = False
    calls: List[str] = field(default_factory=list)
    field_accesses: List[str] = field(default_factory=list)

    @property
    def signature(self) -> str:
        return f"{self.name}{self.descriptor}"

    @property
    def full_name(self) -> str:
        return f"{self.declaring_class.name}.{self.name}{self.descriptor}"


@dataclass
class JavaField:
    name: str
    field_type: str
    declaring_class: JavaClass
    is_static: bool = False


def _parse_descriptor(desc: str) -> str:
    """Convert a JVM type descriptor to human-readable format"""
    desc = desc.strip()
    if not desc:
        return 'void'
    if desc.startswith('['):
        return _parse_descriptor(desc[1:]) + '[]'
    primitives = {'B': 'byte', 'C': 'char', 'D': 'double', 'F': 'float',
                  'I': 'int', 'J': 'long', 'S': 'short', 'Z': 'boolean', 'V': 'void'}
    if desc in primitives:
        return primitives[desc]
    if desc.startswith('L') and desc.endswith(';'):
        return desc[1:-1].replace('/', '.')
    return desc


def _parse_method_params(descriptor: str) -> List[str]:
    """Extract parameter types from a method descriptor"""
    m = re.match(r'\(([^)]*)\)', descriptor)
    if not m:
        return []
    params_str = m.group(1)
    params = []
    i = 0
    while i < len(params_str):
        if params_str[i] == 'L':
            end = params_str.index(';', i)
            params.append(_parse_descriptor(params_str[i:end + 1]))
            i = end + 1
        elif params_str[i] == '[':
            j = i
            while j < len(params_str) and params_str[j] == '[':
                j += 1
            if j < len(params_str) and params_str[j] == 'L':
                end = params_str.index(';', j)
                params.append(_parse_descriptor(params_str[i:end + 1]))
                i = end + 1
            else:
                params.append(_parse_descriptor(params_str[i:j + 1]))
                i = j + 1
        else:
            params.append(_parse_descriptor(params_str[i]))
            i += 1
    return params


class JarAnalyzer:
    """JAR 文件分析器（javatools 实现）"""

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def analyze_jar(self, jar_path: Path) -> List[JavaClass]:
        if not jar_path.exists():
            raise FileNotFoundError(f"JAR file not found: {jar_path}")

        classes = []

        try:
            with zipfile.ZipFile(jar_path, 'r') as zf:
                class_files = [f for f in zf.namelist() if f.endswith('.class')]

                for class_file in class_files:
                    try:
                        java_class = self._analyze_class_in_jar(zf, class_file, jar_path)
                        if java_class:
                            classes.append(java_class)
                    except Exception as e:
                        self.logger.debug(f"Failed to analyze {class_file} in {jar_path}: {e}")

        except Exception as e:
            self.logger.error(f"Failed to open JAR {jar_path}: {e}")

        return classes

    def _analyze_class_in_jar(self, zf: zipfile.ZipFile, class_file: str, jar_path: Path) -> Optional[JavaClass]:
        data = zf.read(class_file)
        ci = unpack_class(io.BytesIO(data))

        class_internal = ci.get_this()
        if not class_internal:
            return None
        class_name = internal_to_dot(class_internal)

        java_class = JavaClass(
            name=class_name,
            source_jar=jar_path,
            is_interface=bool(ci.is_interface()),
            is_abstract=bool(ci.is_abstract()),
        )

        super_ref = ci.get_super()
        if super_ref:
            java_class.super_class = internal_to_dot(str(super_ref))

        interfaces = ci.get_interfaces()
        if interfaces:
            java_class.interfaces = [internal_to_dot(str(iface)) for iface in interfaces]

        for f in ci.fields:
            field_name = f.get_name()
            field_desc = f.get_descriptor()
            field_type = _parse_descriptor(field_desc)
            java_field = JavaField(
                name=field_name,
                field_type=field_type,
                declaring_class=java_class,
                is_static=bool(f.is_static()),
            )
            java_class.fields.append(java_field)

        for m in ci.methods:
            method_name = m.get_name()
            descriptor = m.get_descriptor()
            return_type = _parse_descriptor(descriptor[descriptor.rfind(')') + 1:])
            params = _parse_method_params(descriptor)

            java_method = JavaMethod(
                name=method_name,
                descriptor=descriptor,
                return_type=return_type,
                parameters=params,
                declaring_class=java_class,
                is_static=bool(m.is_static()),
                is_abstract=bool(m.is_abstract()),
            )

            code = m.get_code()
            if code:
                for offset, opcode, args in code.disassemble():
                    if opcode not in INVOKE_OPCODES or not args:
                        continue
                    cp_index = args[0]
                    try:
                        resolved = ci.cpool.deref_const(cp_index)
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
                    target_desc = method_info[1]
                    full_call = f"{target_class}.{target_method}{target_desc}"
                    java_method.calls.append(full_call)

            java_class.methods.append(java_method)

        return java_class


def main():
    import sys

    logging.basicConfig(level=logging.DEBUG)

    if len(sys.argv) < 2:
        print("Usage: python jar_analyzer.py <jar file>")
        sys.exit(1)

    jar_path = Path(sys.argv[1])
    analyzer = JarAnalyzer()

    print(f"Analyzing {jar_path}...")
    classes = analyzer.analyze_jar(jar_path)

    print(f"\nFound {len(classes)} classes")

    for java_class in classes[:5]:
        print(f"\n{java_class.name}:")
        print(f"  Methods: {len(java_class.methods)}")
        print(f"  Fields: {len(java_class.fields)}")

        for method in java_class.methods[:3]:
            print(f"    - {method.name}({', '.join(method.parameters)})")
            if method.calls:
                print(f"      Calls: {len(method.calls)}")


if __name__ == "__main__":
    main()
