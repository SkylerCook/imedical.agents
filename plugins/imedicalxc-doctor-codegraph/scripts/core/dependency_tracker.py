"""
依赖追踪器
从工作区源码出发，递归追踪跨服务调用链
"""
from pathlib import Path
from typing import List, Dict, Set, Optional, Tuple
from collections import deque
from dataclasses import dataclass, field
import logging

from core.pom_parser import PomParser, MavenProject
from core.maven_resolver import MavenResolver, ResolvedArtifact
from core.jar_analyzer import JarAnalyzer, JavaClass
from core.source_analyzer import SourceAnalyzer


@dataclass
class DependencyInfo:
    """依赖信息"""
    source_type: str  # "workspace" | "maven" | "internal_repo"
    source_path: Path
    classes: List[JavaClass] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)  # 依赖的 artifact 坐标


class DependencyTracker:
    """依赖追踪器"""
    
    def __init__(
        self,
        workspace_root: Path,
        maven_repos: List[Path],
        max_depth: int = 10,
    ):
        self.workspace_root = workspace_root
        self.maven_repos = maven_repos
        self.max_depth = max_depth
        
        self.logger = logging.getLogger(__name__)
        
        # 分析器
        self.pom_parser = PomParser()
        self.maven_resolver = MavenResolver(maven_repos)
        self.jar_analyzer = JarAnalyzer()
        self.source_analyzer = SourceAnalyzer()
        
        # 已分析的依赖（避免重复）
        self.analyzed: Set[str] = set()
        
        # 依赖图
        self.dependencies: Dict[str, DependencyInfo] = {}
        
        # 类名到依赖的映射
        self.class_to_dep: Dict[str, str] = {}
    
    def track_from_workspace(self, workspace_repos: List[str]) -> Dict[str, DependencyInfo]:
        """
        从工作区仓库出发追踪依赖
        
        Args:
            workspace_repos: 工作区仓库相对路径列表（如 ["care/comoe-mediway"]）
        
        Returns:
            依赖信息字典
        """
        self.logger.info(f"开始从 {len(workspace_repos)} 个工作区仓库追踪依赖")
        
        # 队列：(仓库路径, 深度)
        queue = deque()
        
        # 初始化：添加工作区仓库
        for repo_rel in workspace_repos:
            repo_path = self.workspace_root / repo_rel
            if not repo_path.exists():
                self.logger.warning(f"仓库不存在: {repo_path}")
                continue
            
            dep_key = f"workspace:{repo_rel}"
            if dep_key in self.analyzed:
                continue
            
            self.analyzed.add(dep_key)
            queue.append((repo_path, 0, dep_key))
        
        # BFS 追踪
        while queue:
            repo_path, depth, dep_key = queue.popleft()
            
            if depth > self.max_depth:
                self.logger.warning(f"达到最大深度 {self.max_depth}，停止追踪")
                continue
            
            self.logger.info(f"[深度 {depth}] 分析: {dep_key}")
            
            # 分析当前依赖
            dep_info = self._analyze_dependency(repo_path, dep_key)
            if not dep_info:
                continue
            
            self.dependencies[dep_key] = dep_info
            
            # 注册类名映射
            for cls in dep_info.classes:
                self.class_to_dep[cls.name] = dep_key
            
            # 追踪子依赖
            for sub_dep in dep_info.dependencies:
                if sub_dep in self.analyzed:
                    continue
                
                self.analyzed.add(sub_dep)
                
                # 解析子依赖路径
                sub_path = self._resolve_dep_path(sub_dep)
                if sub_path:
                    queue.append((sub_path, depth + 1, sub_dep))
                else:
                    self.logger.debug(f"无法解析依赖路径: {sub_dep}")
        
        self.logger.info(f"追踪完成，共分析 {len(self.dependencies)} 个依赖")
        return self.dependencies
    
    def _analyze_dependency(self, repo_path: Path, dep_key: str) -> Optional[DependencyInfo]:
        """分析单个依赖"""
        if repo_path.is_file() and repo_path.suffix == ".jar":
            # Maven jar 文件
            return self._analyze_jar(repo_path, dep_key)
        elif repo_path.is_dir():
            # 源码目录
            return self._analyze_source(repo_path, dep_key)
        else:
            self.logger.warning(f"未知的依赖类型: {repo_path}")
            return None
    
    def _analyze_jar(self, jar_path: Path, dep_key: str) -> DependencyInfo:
        """分析 Maven jar"""
        self.logger.debug(f"分析 JAR: {jar_path.name}")
        
        classes = self.jar_analyzer.analyze_jar(jar_path)
        
        return DependencyInfo(
            source_type="maven",
            source_path=jar_path,
            classes=classes,
            dependencies=[],  # jar 的依赖需要从 pom 解析
        )
    
    def _analyze_source(self, repo_path: Path, dep_key: str) -> DependencyInfo:
        """分析源码仓库"""
        self.logger.debug(f"分析源码: {repo_path.name}")
        
        # 检查是否是父 pom（包含子模块）
        pom_path = repo_path / "pom.xml"
        is_parent_pom = False
        modules = []
        
        if pom_path.exists():
            try:
                project = self.pom_parser.parse(pom_path)
                if project.packaging == "pom" and project.modules:
                    is_parent_pom = True
                    modules = project.modules
                    self.logger.info(f"  发现父 POM，包含 {len(modules)} 个子模块")
            except Exception as e:
                self.logger.warning(f"解析 pom.xml 失败: {e}")
        
        # 如果是父 pom，递归分析子模块
        if is_parent_pom:
            all_classes = []
            all_dependencies = []
            
            for module_name in modules:
                module_path = repo_path / module_name
                if not module_path.exists():
                    self.logger.warning(f"  子模块不存在: {module_path}")
                    continue
                
                module_dep_key = f"{dep_key}/{module_name}"
                module_info = self._analyze_source(module_path, module_dep_key)
                
                all_classes.extend(module_info.classes)
                all_dependencies.extend(module_info.dependencies)
                
                # 注册子模块
                self.dependencies[module_dep_key] = module_info
                for cls in module_info.classes:
                    self.class_to_dep[cls.name] = module_dep_key
            
            return DependencyInfo(
                source_type="workspace",
                source_path=repo_path,
                classes=all_classes,
                dependencies=all_dependencies,
            )
        
        # 普通源码目录
        classes = self.source_analyzer.analyze_directory(repo_path)
        
        # 解析 pom.xml 获取依赖
        dependencies = []
        if pom_path.exists():
            try:
                project = self.pom_parser.parse(pom_path)
                for dep in project.dependencies:
                    dep_coord = f"{dep.group_id}:{dep.artifact_id}:{dep.version}"
                    dependencies.append(dep_coord)
            except Exception as e:
                self.logger.warning(f"解析 pom.xml 失败: {e}")
        
        return DependencyInfo(
            source_type="workspace",
            source_path=repo_path,
            classes=classes,
            dependencies=dependencies,
        )
    
    def _resolve_dep_path(self, dep_coord: str) -> Optional[Path]:
        """解析依赖坐标到路径"""
        # 尝试从 Maven 仓库解析
        parts = dep_coord.split(":")
        if len(parts) >= 3:
            group_id, artifact_id, version = parts[0], parts[1], parts[2]
            
            # 创建 MavenDependency 对象
            from core.pom_parser import MavenDependency
            dep = MavenDependency(group_id=group_id, artifact_id=artifact_id, version=version)
            
            # 在 Maven 仓库中查找
            artifact = self.maven_resolver.resolve(dep)
            if artifact.is_resolved:
                self.logger.debug(f"  ✓ 解析成功: {dep_coord} -> {artifact.jar_path}")
                return artifact.jar_path
            else:
                self.logger.debug(f"  ✗ 解析失败: {dep_coord} (jar 不存在)")
        
        # 尝试从工作区解析
        # 这里可以添加内部仓库的映射逻辑
        
        return None
    
    def get_all_classes(self) -> List[JavaClass]:
        """获取所有分析到的类"""
        classes = []
        for dep_info in self.dependencies.values():
            classes.extend(dep_info.classes)
        return classes
    
    def get_class_source(self, class_name: str) -> Optional[str]:
        """获取类的来源依赖"""
        return self.class_to_dep.get(class_name)
