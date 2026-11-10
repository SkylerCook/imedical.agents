"""
POM 文件解析器
解析 pom.xml 提取项目信息和依赖声明
"""
import xml.etree.ElementTree as ET
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Dict
import re


@dataclass
class MavenDependency:
    """Maven 依赖"""
    group_id: str
    artifact_id: str
    version: str
    scope: str = "compile"
    optional: bool = False
    
    @property
    def coordinate(self) -> str:
        """返回 Maven 坐标字符串"""
        return f"{self.group_id}:{self.artifact_id}:{self.version}"
    
    def __hash__(self):
        return hash(self.coordinate)
    
    def __eq__(self, other):
        if not isinstance(other, MavenDependency):
            return False
        return self.coordinate == other.coordinate


@dataclass
class MavenProject:
    """Maven 项目信息"""
    group_id: str
    artifact_id: str
    version: str
    packaging: str = "jar"
    parent: Optional[MavenDependency] = None
    modules: List[str] = field(default_factory=list)
    dependencies: List[MavenDependency] = field(default_factory=list)
    properties: Dict[str, str] = field(default_factory=dict)
    pom_path: Optional[Path] = None
    
    @property
    def coordinate(self) -> str:
        """返回 Maven 坐标字符串"""
        return f"{self.group_id}:{self.artifact_id}:{self.version}"
    
    @property
    def base_dir(self) -> Optional[Path]:
        """返回 POM 文件所在目录"""
        return self.pom_path.parent if self.pom_path else None


class PomParser:
    """POM 文件解析器"""
    
    # Maven POM XML 命名空间
    NS = {"m": "http://maven.apache.org/POM/4.0.0"}
    
    def __init__(self):
        self._property_pattern = re.compile(r"\$\{([^}]+)\}")
    
    def parse(self, pom_path: Path) -> MavenProject:
        """
        解析 pom.xml 文件
        
        Args:
            pom_path: pom.xml 文件路径
            
        Returns:
            MavenProject 对象
        """
        if not pom_path.exists():
            raise FileNotFoundError(f"POM file not found: {pom_path}")
        
        tree = ET.parse(pom_path)
        root = tree.getroot()
        
        # 检测是否有命名空间
        ns = self.NS if root.tag.startswith("{") else {}
        
        # 解析基本信息
        project = MavenProject(
            group_id=self._get_text(root, "groupId", ns) or "",
            artifact_id=self._get_text(root, "artifactId", ns) or "",
            version=self._get_text(root, "version", ns) or "",
            packaging=self._get_text(root, "packaging", ns, "jar"),
            pom_path=pom_path,
        )
        
        # 解析 properties
        project.properties = self._parse_properties(root, ns)
        
        # 解析 parent
        parent_elem = root.find("m:parent", ns) if ns else root.find("parent")
        if parent_elem is not None:
            project.parent = self._parse_dependency(parent_elem, ns, project.properties)
            # 如果项目没有 groupId/version，从 parent 继承
            if not project.group_id and project.parent:
                project.group_id = project.parent.group_id
            if not project.version and project.parent:
                project.version = project.parent.version
        
        # 添加 Maven 内置属性
        project.properties["project.version"] = project.version
        project.properties["project.groupId"] = project.group_id
        project.properties["project.artifactId"] = project.artifact_id
        if project.parent:
            project.properties["project.parent.version"] = project.parent.version
            project.properties["project.parent.groupId"] = project.parent.group_id
        
        # 解析 modules
        modules_elem = root.find("m:modules", ns) if ns else root.find("modules")
        if modules_elem is not None:
            for module in modules_elem.findall("m:module", ns) if ns else modules_elem.findall("module"):
                if module.text:
                    project.modules.append(module.text.strip())
        
        # 解析 dependencies
        deps_elem = root.find("m:dependencies", ns) if ns else root.find("dependencies")
        if deps_elem is not None:
            for dep_elem in deps_elem.findall("m:dependency", ns) if ns else deps_elem.findall("dependency"):
                dep = self._parse_dependency(dep_elem, ns, project.properties)
                if dep:
                    project.dependencies.append(dep)
        
        return project
    
    def _get_text(self, elem, tag: str, ns: dict, default: str = "") -> str:
        """获取子元素文本"""
        if ns:
            child = elem.find(f"m:{tag}", ns)
        else:
            child = elem.find(tag)
        return child.text.strip() if child is not None and child.text else default
    
    def _parse_properties(self, root, ns: dict) -> Dict[str, str]:
        """解析 properties"""
        props = {}
        props_elem = root.find("m:properties", ns) if ns else root.find("properties")
        if props_elem is not None:
            for prop in props_elem:
                tag = prop.tag.replace("{http://maven.apache.org/POM/4.0.0}", "")
                if prop.text:
                    props[tag] = prop.text.strip()
        return props
    
    def _parse_dependency(self, dep_elem, ns: dict, properties: Dict[str, str]) -> Optional[MavenDependency]:
        """解析单个依赖"""
        group_id = self._get_text(dep_elem, "groupId", ns)
        artifact_id = self._get_text(dep_elem, "artifactId", ns)
        version = self._get_text(dep_elem, "version", ns)
        scope = self._get_text(dep_elem, "scope", ns, "compile")
        optional = self._get_text(dep_elem, "optional", ns, "false") == "true"
        
        if not group_id or not artifact_id:
            return None
        
        # 解析版本中的属性占位符
        version = self._resolve_property(version, properties)
        group_id = self._resolve_property(group_id, properties)
        
        return MavenDependency(
            group_id=group_id,
            artifact_id=artifact_id,
            version=version,
            scope=scope,
            optional=optional,
        )
    
    def _resolve_property(self, value: str, properties: Dict[str, str]) -> str:
        """解析属性占位符 ${xxx}"""
        if not value:
            return value
        
        def replace(match):
            prop_name = match.group(1)
            return properties.get(prop_name, match.group(0))
        
        return self._property_pattern.sub(replace, value)
    
    def parse_recursive(self, base_path: Path) -> List[MavenProject]:
        """
        递归解析目录下的所有 pom.xml
        
        Args:
            base_path: 基础目录
            
        Returns:
            MavenProject 列表
        """
        projects = []
        
        # 查找当前目录的 pom.xml
        pom_path = base_path / "pom.xml"
        if pom_path.exists():
            try:
                project = self.parse(pom_path)
                projects.append(project)
                
                # 递归解析子模块
                for module in project.modules:
                    module_path = base_path / module
                    if module_path.exists():
                        projects.extend(self.parse_recursive(module_path))
            except Exception as e:
                print(f"Warning: Failed to parse {pom_path}: {e}")
        
        return projects


def main():
    """测试函数"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python pom_parser.py <pom.xml path>")
        sys.exit(1)
    
    pom_path = Path(sys.argv[1])
    parser = PomParser()
    project = parser.parse(pom_path)
    
    print(f"Project: {project.coordinate}")
    print(f"Packaging: {project.packaging}")
    print(f"Modules: {project.modules}")
    print(f"\nDependencies ({len(project.dependencies)}):")
    for dep in project.dependencies:
        print(f"  - {dep.coordinate} [{dep.scope}]")


if __name__ == "__main__":
    main()
