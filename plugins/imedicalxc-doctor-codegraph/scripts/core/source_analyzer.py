"""
Java 源码分析器
解析 .java 文件，提取类、方法、调用关系
"""
import re
from pathlib import Path
from typing import List, Dict, Set, Optional
from dataclasses import dataclass, field
import logging

from core.jar_analyzer import JavaClass, JavaMethod, JavaField


@dataclass
class SourceLocation:
    """源码位置"""
    file_path: Path
    line_number: int
    column: int = 0


class SourceAnalyzer:
    """Java 源码分析器"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        
        # 正则表达式模式
        self.package_pattern = re.compile(r'^\s*package\s+([\w.]+)\s*;', re.MULTILINE)
        self.import_pattern = re.compile(r'^\s*import\s+(?:static\s+)?([\w.*]+)\s*;', re.MULTILINE)
        self.class_pattern = re.compile(
            r'(?:public|private|protected)?\s*(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)'
            r'(?:\s+extends\s+([\w.]+))?'
            r'(?:\s+implements\s+([\w.,\s]+))?'
        )
        self.method_pattern = re.compile(
            r'(?:@[\w.]+(?:\([^)]*\))?\s*)*'  # 注解
            r'(?:public|private|protected)?\s*'
            r'(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?'
            r'([\w<>\[\].]+)\s+'  # 返回类型
            r'(\w+)\s*'  # 方法名
            r'\(([^)]*)\)\s*'  # 参数
            r'(?:throws\s+[\w.,\s]+)?\s*\{'  # throws 和 {
        )
        self.annotation_pattern = re.compile(r'@(\w+)(?:\(([^)]*)\))?')
        self.method_call_pattern = re.compile(
            r'(\w+)\s*\.\s*(\w+)\s*\('  # obj.method(
            r'|'
            r'(\w+)\s*\('  # method(
        )
    
    def analyze_file(self, file_path: Path) -> List[JavaClass]:
        """分析单个 Java 源码文件"""
        try:
            content = file_path.read_text(encoding='utf-8')
            return self._analyze_content(content, file_path)
        except Exception as e:
            self.logger.warning(f"Failed to analyze {file_path}: {e}")
            return []
    
    def analyze_directory(self, dir_path: Path) -> List[JavaClass]:
        """分析目录下所有 Java 源码文件"""
        classes = []
        for java_file in dir_path.rglob("*.java"):
            # 跳过测试代码
            if "test" in java_file.parts or "tests" in java_file.parts:
                continue
            classes.extend(self.analyze_file(java_file))
        return classes
    
    def _analyze_content(self, content: str, file_path: Path) -> List[JavaClass]:
        """分析 Java 源码内容"""
        # 提取 package
        package_match = self.package_pattern.search(content)
        package_name = package_match.group(1) if package_match else ""
        
        # 提取 imports
        imports = self.import_pattern.findall(content)
        
        # 提取类
        classes = []
        for class_match in self.class_pattern.finditer(content):
            class_name = class_match.group(1)
            super_class = class_match.group(2)
            interfaces_str = class_match.group(3)
            
            full_class_name = f"{package_name}.{class_name}" if package_name else class_name
            
            # 判断是类还是接口
            is_interface = "interface" in class_match.group(0)
            is_abstract = "abstract" in class_match.group(0)
            
            # 解析接口列表
            interfaces = []
            if interfaces_str:
                interfaces = [i.strip() for i in interfaces_str.split(",")]
            
            # 创建 JavaClass
            java_class = JavaClass(
                name=full_class_name,
                source_jar=file_path,  # 用文件路径代替 jar 路径
                is_interface=is_interface,
                is_abstract=is_abstract,
                super_class=super_class,
                interfaces=interfaces,
            )
            
            # 提取方法
            methods = self._extract_methods(content, java_class, imports)
            java_class.methods = methods
            
            classes.append(java_class)
        
        return classes
    
    def _extract_methods(self, content: str, java_class: JavaClass, imports: List[str]) -> List[JavaMethod]:
        """提取方法及其调用关系"""
        methods = []
        
        # 查找所有方法定义
        for method_match in self.method_pattern.finditer(content):
            return_type = method_match.group(1)
            method_name = method_match.group(2)
            params_str = method_match.group(3)
            
            # 解析参数
            parameters = self._parse_parameters(params_str)
            
            # 生成方法描述符
            descriptor = self._generate_descriptor(parameters, return_type)
            
            # 判断方法修饰符
            method_start = content.rfind('\n', 0, method_match.start())
            method_prefix = content[method_start:method_match.start()]
            is_static = "static" in method_prefix
            is_abstract = "abstract" in method_prefix
            
            # 创建 JavaMethod
            method = JavaMethod(
                name=method_name,
                descriptor=descriptor,
                return_type=return_type,
                parameters=parameters,
                declaring_class=java_class,
                is_static=is_static,
                is_abstract=is_abstract,
            )
            
            # 提取方法体内的调用
            method_body = self._extract_method_body(content, method_match.end())
            if method_body:
                calls = self._extract_calls(method_body, java_class, imports)
                method.calls = calls
            
            methods.append(method)
        
        return methods
    
    def _parse_parameters(self, params_str: str) -> List[str]:
        """解析参数列表"""
        if not params_str or not params_str.strip():
            return []
        
        parameters = []
        for param in params_str.split(","):
            param = param.strip()
            if not param:
                continue
            # 提取类型（去掉参数名和注解）
            parts = param.split()
            if len(parts) >= 2:
                param_type = parts[-2]  # 倒数第二个是类型
                # 去掉注解
                param_type = re.sub(r'@\w+\s*', '', param_type)
                parameters.append(param_type)
        
        return parameters
    
    def _generate_descriptor(self, parameters: List[str], return_type: str) -> str:
        """生成方法描述符（简化版）"""
        param_types = []
        for p in parameters:
            # 转换 Java 类型为描述符格式
            p = p.strip()
            if p == "int":
                param_types.append("I")
            elif p == "long":
                param_types.append("J")
            elif p == "boolean":
                param_types.append("Z")
            elif p == "void":
                param_types.append("V")
            elif p.endswith("[]"):
                param_types.append("[" + self._type_to_descriptor(p[:-2]))
            else:
                param_types.append(self._type_to_descriptor(p))
        
        return_type_desc = self._type_to_descriptor(return_type)
        
        return f"({''.join(param_types)}){return_type_desc}"
    
    def _type_to_descriptor(self, type_name: str) -> str:
        """将类型名转换为描述符"""
        type_name = type_name.strip()
        if type_name == "int":
            return "I"
        elif type_name == "long":
            return "J"
        elif type_name == "boolean":
            return "Z"
        elif type_name == "byte":
            return "B"
        elif type_name == "char":
            return "C"
        elif type_name == "short":
            return "S"
        elif type_name == "float":
            return "F"
        elif type_name == "double":
            return "D"
        elif type_name == "void":
            return "V"
        elif type_name.endswith("[]"):
            return "[" + self._type_to_descriptor(type_name[:-2])
        else:
            # 对象类型：Ljava/lang/String;
            type_name = type_name.replace(".", "/")
            return f"L{type_name};"
    
    def _extract_method_body(self, content: str, start_pos: int) -> Optional[str]:
        """提取方法体"""
        # 找到方法体的开始 {
        brace_start = content.find('{', start_pos)
        if brace_start == -1:
            return None
        
        # 匹配括号
        depth = 1
        pos = brace_start + 1
        while pos < len(content) and depth > 0:
            if content[pos] == '{':
                depth += 1
            elif content[pos] == '}':
                depth -= 1
            pos += 1
        
        if depth == 0:
            return content[brace_start:pos]
        return None
    
    def _extract_calls(self, method_body: str, current_class: JavaClass, imports: List[str]) -> List[str]:
        """从方法体中提取调用关系"""
        calls = set()
        
        # 查找方法调用
        for match in self.method_call_pattern.finditer(method_body):
            if match.group(1):  # obj.method( 形式
                obj_name = match.group(1)
                method_name = match.group(2)
            elif match.group(3):  # method( 形式
                method_name = match.group(3)
                obj_name = None
            else:
                continue
            
            # 尝试解析调用的类
            called_class = self._resolve_called_class(obj_name, current_class, imports)
            if called_class:
                calls.add(f"{called_class}.{method_name}")
        
        return list(calls)
    
    def _resolve_called_class(self, obj_name: Optional[str], current_class: JavaClass, imports: List[str]) -> Optional[str]:
        """解析调用对象的类名"""
        if obj_name is None:
            # 直接方法调用，可能是当前类的方法
            return current_class.name
        
        # 简单启发式：根据变量名推断类型
        # 实际应该做数据流分析，这里简化处理
        
        # 如果变量名是类名的小写形式，尝试匹配 import
        obj_lower = obj_name.lower()
        for imp in imports:
            if imp.endswith(".*"):
                continue
            class_name = imp.split(".")[-1]
            if class_name.lower() == obj_lower:
                return imp
        
        return None
