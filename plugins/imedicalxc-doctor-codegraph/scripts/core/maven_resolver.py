"""
Maven 仓库解析器
定位 Maven 本地仓库中的依赖 jar 文件
"""
from pathlib import Path
from typing import List, Optional, Dict
from dataclasses import dataclass
import re

from core.pom_parser import MavenDependency


@dataclass
class ResolvedArtifact:
    """已解析的 Maven artifact"""
    dependency: MavenDependency
    jar_path: Optional[Path] = None
    pom_path: Optional[Path] = None
    sources_path: Optional[Path] = None
    
    @property
    def is_resolved(self) -> bool:
        """是否成功定位到 jar 文件"""
        return self.jar_path is not None and self.jar_path.exists()
    
    @property
    def group_path(self) -> str:
        """groupId 转换为路径格式"""
        return self.dependency.group_id.replace(".", "/")


class MavenResolver:
    """Maven 仓库解析器"""
    
    def __init__(self, repo_paths: List[Path]):
        """
        初始化解析器
        
        Args:
            repo_paths: Maven 仓库路径列表（按优先级排序）
        """
        self.repo_paths = [p for p in repo_paths if p.exists()]
        self._cache: Dict[str, ResolvedArtifact] = {}
    
    def resolve(self, dependency: MavenDependency) -> ResolvedArtifact:
        """
        解析单个依赖
        
        Args:
            dependency: Maven 依赖
            
        Returns:
            ResolvedArtifact 对象
        """
        cache_key = dependency.coordinate
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        artifact = ResolvedArtifact(dependency=dependency)
        
        # 在各个仓库中查找
        for repo_path in self.repo_paths:
            artifact_dir = self._get_artifact_dir(repo_path, dependency)
            if not artifact_dir.exists():
                continue
            
            # 查找 jar 文件
            jar_path = self._find_jar(artifact_dir, dependency)
            if jar_path:
                artifact.jar_path = jar_path
                
                # 查找 pom 文件
                artifact.pom_path = self._find_pom(artifact_dir, dependency)
                
                # 查找 sources jar
                artifact.sources_path = self._find_sources(artifact_dir, dependency)
                
                break
        
        self._cache[cache_key] = artifact
        return artifact
    
    def resolve_all(self, dependencies: List[MavenDependency]) -> List[ResolvedArtifact]:
        """
        批量解析依赖
        
        Args:
            dependencies: Maven 依赖列表
            
        Returns:
            ResolvedArtifact 列表
        """
        return [self.resolve(dep) for dep in dependencies]
    
    def _get_artifact_dir(self, repo_path: Path, dependency: MavenDependency) -> Path:
        """获取 artifact 在仓库中的目录"""
        group_path = dependency.group_id.replace(".", "/")
        return repo_path / group_path / dependency.artifact_id / dependency.version
    
    def _find_jar(self, artifact_dir: Path, dependency: MavenDependency) -> Optional[Path]:
        """查找 jar 文件"""
        # 标准命名：artifactId-version.jar
        standard_name = f"{dependency.artifact_id}-{dependency.version}.jar"
        standard_path = artifact_dir / standard_name
        if standard_path.exists():
            return standard_path
        
        # SNAPSHOT 版本：查找带时间戳的 jar
        if dependency.version.endswith("-SNAPSHOT"):
            pattern = f"{dependency.artifact_id}-{dependency.version.replace('-SNAPSHOT', '')}*.jar"
            jars = list(artifact_dir.glob(pattern))
            # 过滤掉 sources jar
            jars = [j for j in jars if not j.name.endswith("-sources.jar")]
            if jars:
                # 返回最新的
                return max(jars, key=lambda p: p.stat().st_mtime)
        
        return None
    
    def _find_pom(self, artifact_dir: Path, dependency: MavenDependency) -> Optional[Path]:
        """查找 pom 文件"""
        # 标准命名
        standard_name = f"{dependency.artifact_id}-{dependency.version}.pom"
        standard_path = artifact_dir / standard_name
        if standard_path.exists():
            return standard_path
        
        # SNAPSHOT 版本
        if dependency.version.endswith("-SNAPSHOT"):
            pattern = f"{dependency.artifact_id}-{dependency.version.replace('-SNAPSHOT', '')}*.pom"
            poms = list(artifact_dir.glob(pattern))
            if poms:
                return max(poms, key=lambda p: p.stat().st_mtime)
        
        return None
    
    def _find_sources(self, artifact_dir: Path, dependency: MavenDependency) -> Optional[Path]:
        """查找 sources jar"""
        # 标准命名
        standard_name = f"{dependency.artifact_id}-{dependency.version}-sources.jar"
        standard_path = artifact_dir / standard_name
        if standard_path.exists():
            return standard_path
        
        # SNAPSHOT 版本
        if dependency.version.endswith("-SNAPSHOT"):
            pattern = f"{dependency.artifact_id}-{dependency.version.replace('-SNAPSHOT', '')}*-sources.jar"
            sources = list(artifact_dir.glob(pattern))
            if sources:
                return max(sources, key=lambda p: p.stat().st_mtime)
        
        return None
    
    def get_statistics(self) -> Dict[str, int]:
        """获取解析统计"""
        total = len(self._cache)
        resolved = sum(1 for a in self._cache.values() if a.is_resolved)
        return {
            "total": total,
            "resolved": resolved,
            "unresolved": total - resolved,
        }
    
    def clear_cache(self):
        """清空缓存"""
        self._cache.clear()


def main():
    """测试函数"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    
    from config import MAVEN_REPO_PATHS
    from core.pom_parser import PomParser
    
    if len(sys.argv) < 2:
        print("Usage: python maven_resolver.py <pom.xml path>")
        sys.exit(1)
    
    pom_path = Path(sys.argv[1])
    
    # 解析 POM
    parser = PomParser()
    project = parser.parse(pom_path)
    
    print(f"Project: {project.coordinate}")
    print(f"Dependencies: {len(project.dependencies)}")
    
    # 解析依赖
    resolver = MavenResolver(MAVEN_REPO_PATHS)
    artifacts = resolver.resolve_all(project.dependencies)
    
    print("\nResolved artifacts:")
    for artifact in artifacts:
        status = "✓" if artifact.is_resolved else "✗"
        jar_info = artifact.jar_path.name if artifact.jar_path else "NOT FOUND"
        print(f"  {status} {artifact.dependency.coordinate}: {jar_info}")
    
    # 统计
    stats = resolver.get_statistics()
    print(f"\nStatistics:")
    print(f"  Total: {stats['total']}")
    print(f"  Resolved: {stats['resolved']}")
    print(f"  Unresolved: {stats['unresolved']}")


if __name__ == "__main__":
    main()
