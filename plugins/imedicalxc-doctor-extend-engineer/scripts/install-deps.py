#!/usr/bin/env python3
"""
install-deps.py — Maven 多模块项目依赖链预装工具

从目标模块出发，递归扫描项目内依赖，按拓扑序（叶子优先）逐模块 mvn install，
避免 --also-make 拉入有预存编译错误的无关模块。

用法:
    python install-deps.py <artifact-id>              # 安装某个模块的全部依赖链
    python install-deps.py <artifact-id> --dry-run    # 只看顺序，不执行
    python install-deps.py <artifact-id> --changed-only  # 仅安装源码比 jar 新的模块
    python install-deps.py <artifact-id> --project-root /path/to/project

环境变量:
    PROJECT_ROOT        项目根目录（默认当前工作目录，可被 --project-root 覆盖）
    JAVA_TOOL_OPTIONS   默认 "-Dfile.encoding=UTF-8"
    MVN_CMD             强制指定 Maven 命令路径
    M2_REPO / MAVEN_REPO  强制指定 Maven 本地仓库路径
"""

import xml.etree.ElementTree as ET
import os
import sys
import subprocess
from pathlib import Path
from collections import deque

# Maven POM XML 命名空间
NS = {"m": "http://maven.apache.org/POM/4.0.0"}
SETTINGS_NS = "http://maven.apache.org/SETTINGS/1.0.0"


# ============================================================
# 配置解析
# ============================================================
def _resolve_mvn():
    """探测可用的 Maven 命令。Windows 优先 mvn.cmd，否则 mvn。"""
    cmd = os.environ.get("MVN_CMD")
    if cmd:
        return cmd
    if sys.platform == "win32":
        for candidate in ["mvn.cmd", "mvn.bat"]:
            try:
                subprocess.run([candidate, "--version"],
                               capture_output=True, timeout=10)
                return candidate
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
    return "mvn"


def _resolve_project_root():
    """解析项目根目录：CLI --project-root > 环境变量 PROJECT_ROOT > 当前目录。"""
    # 从命令行参数中提取 --project-root
    for i, arg in enumerate(sys.argv):
        if arg == "--project-root" and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1])
    env = os.environ.get("PROJECT_ROOT")
    if env:
        return Path(env)
    return Path.cwd()


# ============================================================
# XML 工具
# ============================================================
def find_text(element, xpath, default=None):
    """在 element 下执行 xpath 查找（自动处理 Maven POM 命名空间），返回文本内容。"""
    found = element.find(xpath, NS)
    if found is not None and found.text:
        return found.text.strip()
    return default


# ============================================================
# 模块注册表
# ============================================================
def scan_module_registry(root):
    """
    扫描项目根目录下所有 pom.xml，建立 artifactId → 目录路径 的注册表。
    跳过 target/、archetype-resources/、.flattened-pom.xml 等构建产物。
    """
    registry = {}
    for pom_path in root.rglob("pom.xml"):
        parts = pom_path.parts
        if "target" in parts:
            continue
        if "archetype-resources" in parts:
            continue
        if "flattened" in pom_path.name.lower():
            continue
        try:
            tree = ET.parse(pom_path)
            artifact_id = find_text(tree.getroot(), "m:artifactId")
            if artifact_id and "$" not in artifact_id:
                registry[artifact_id] = pom_path.parent
        except ET.ParseError:
            pass
    return registry


def get_project_dependencies(pom_path, registry):
    """
    从 pom.xml 中提取所有在本地注册表中存在的依赖 artifactId。
    不再硬编码 groupId —— 只要是项目内的模块就算依赖。
    """
    try:
        tree = ET.parse(pom_path)
        deps = []
        for dep in tree.findall(".//m:dependency", NS):
            aid = find_text(dep, "m:artifactId")
            if aid and aid in registry:
                deps.append(aid)
        return deps
    except ET.ParseError:
        return []


# ============================================================
# 拓扑排序
# ============================================================
def topological_order(target, registry):
    """
    从 target 出发，递归收集所有项目内依赖，
    返回拓扑序列表（叶子→根，即无依赖的先装，被依赖的后装）。
    """
    graph = {}

    def collect(artifact_id):
        if artifact_id in graph:
            return
        pom_dir = registry.get(artifact_id)
        if not pom_dir:
            graph[artifact_id] = []
            return
        pom_file = pom_dir / "pom.xml"
        if not pom_file.exists():
            graph[artifact_id] = []
            return
        deps = get_project_dependencies(pom_file, registry)
        graph[artifact_id] = deps
        for d in deps:
            collect(d)

    collect(target)

    # Kahn 拓扑排序
    dep_count = {k: len(v) for k, v in graph.items()}
    reverse = {k: [] for k in graph}
    for artifact, deps in graph.items():
        for d in deps:
            if d in reverse:
                reverse[d].append(artifact)

    queue = deque([k for k, v in dep_count.items() if v == 0])
    result = []

    while queue:
        node = queue.popleft()
        result.append(node)
        for dependent in reverse.get(node, []):
            dep_count[dependent] -= 1
            if dep_count[dependent] == 0:
                queue.append(dependent)

    if len(result) != len(graph):
        unresolved = set(graph) - set(result)
        print(f"[WARN] 检测到循环依赖或缺失模块: {unresolved}")

    # 去掉 target 自身
    result = [x for x in result if x != target]
    return result


# ============================================================
# Maven 本地仓库与版本
# ============================================================
def _maven_local_repo():
    """探测 Maven 本地仓库路径。优先级: 环境变量 > settings.xml > 默认值。"""
    env_repo = os.environ.get("M2_REPO") or os.environ.get("MAVEN_REPO")
    if env_repo:
        return Path(env_repo)

    settings_paths = [
        Path.home() / ".m2" / "settings.xml",
        Path(os.environ.get("M2_HOME", os.environ.get("MAVEN_HOME", ""))) / "conf" / "settings.xml",
    ]
    for settings_path in settings_paths:
        if settings_path.exists():
            try:
                tree = ET.parse(settings_path)
                # 先尝试带命名空间
                el = tree.find(f".//{{{SETTINGS_NS}}}localRepository")
                if el is None:
                    el = tree.find(".//localRepository")
                if el is not None and el.text and el.text.strip():
                    return Path(el.text.strip())
            except ET.ParseError:
                pass

    return Path.home() / ".m2" / "repository"


def _pom_coordinates(pom_path):
    """
    从 pom.xml 读取 Maven 坐标 (groupId, version)。
    如果当前 pom 没有直接定义，则从 parent 继承。
    """
    try:
        tree = ET.parse(pom_path)
        root_el = tree.getroot()
        gid = find_text(root_el, "m:groupId")
        version = find_text(root_el, "m:version")
        parent = root_el.find("m:parent", NS)
        if not gid and parent is not None:
            gid = find_text(parent, "m:groupId")
        if not version and parent is not None:
            version = find_text(parent, "m:version")
        return (gid or "unknown", version or "unknown")
    except Exception:
        return ("unknown", "unknown")


def _jar_in_repo(artifact_id, module_path):
    """返回模块 jar 在本地仓库中的预期路径（从 pom.xml 读取 groupId/version）。"""
    pom = module_path / "pom.xml"
    if not pom.exists():
        return None
    gid, version = _pom_coordinates(pom)
    if gid == "unknown" or version == "unknown":
        return None
    group_path = gid.replace(".", "/")
    return _maven_local_repo() / group_path / artifact_id / version / f"{artifact_id}-{version}.jar"


def _source_newer_than_jar(artifact_id, module_path):
    """检查模块源码是否比本地仓库中的 jar 更新。"""
    jar = _jar_in_repo(artifact_id, module_path)
    if jar is None or not jar.exists():
        return True
    newest_source = 0
    for java_file in module_path.rglob("*.java"):
        if "target" in java_file.parts:
            continue
        mtime = java_file.stat().st_mtime
        if mtime > newest_source:
            newest_source = mtime
    if newest_source == 0:
        pom = module_path / "pom.xml"
        newest_source = pom.stat().st_mtime if pom.exists() else 0
    return newest_source > jar.stat().st_mtime


# ============================================================
# 安装
# ============================================================
def install_module(artifact_id, registry, mvn_cmd, changed_only=False):
    """对单个模块执行 mvn install -DskipTests。"""
    path = registry.get(artifact_id)
    if not path:
        print(f"  SKIP {artifact_id} — 未在项目中找到")
        return True

    pom = path / "pom.xml"
    if not pom.exists():
        print(f"  SKIP {artifact_id} — pom.xml 不存在")
        return True

    if changed_only and not _source_newer_than_jar(artifact_id, path):
        print(f"  SKIP {artifact_id} — 已是最新")
        return True

    java_opts = os.environ.get("JAVA_TOOL_OPTIONS", "-Dfile.encoding=UTF-8")
    print(f"  INSTALL {artifact_id} ... ", end="", flush=True)
    result = subprocess.run(
        [mvn_cmd, "install", "-DskipTests", "-f", str(pom), "-q"],
        capture_output=True, text=True,
        env={**os.environ, "JAVA_TOOL_OPTIONS": java_opts},
        timeout=600,
    )
    if result.returncode == 0:
        print("OK")
        return True
    else:
        lines = [l for l in result.stderr.split("\n") if l.strip()]
        print("FAIL")
        for line in lines[-5:]:
            print(f"    {line}")
        return False


# ============================================================
# 主入口
# ============================================================
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    if sys.argv[1] in ("--help", "-h"):
        print(__doc__)
        sys.exit(0)

    project_root = _resolve_project_root()
    mvn_cmd = _resolve_mvn()
    target = sys.argv[1]
    dry_run = "--dry-run" in sys.argv
    list_only = "--list" in sys.argv
    changed_only = "--changed-only" in sys.argv

    if not project_root.exists():
        print(f"[ERROR] 项目根目录不存在: {project_root}")
        sys.exit(1)

    print(f"[INFO] 项目根目录: {project_root}")
    print(f"[INFO] Maven 命令: {mvn_cmd}")
    print(f"[INFO] 扫描项目模块 ...")
    registry = scan_module_registry(project_root)
    print(f"[INFO] 找到 {len(registry)} 个模块")

    if target not in registry:
        print(f"[ERROR] 未找到目标模块: {target}")
        print(f"[HINT] 可用的 artifactId 列表（前30个）:")
        for i, aid in enumerate(sorted(registry.keys())):
            if i >= 30:
                break
            print(f"  - {aid}")
        sys.exit(1)

    print(f"[INFO] 目标: {target}")
    print(f"[INFO] 计算依赖拓扑 ...")
    order = topological_order(target, registry)

    if not order:
        print("[INFO] 无项目内依赖需要安装")
        return

    print(f"[INFO] 依赖链 ({len(order)} 个模块):")
    for i, aid in enumerate(order, 1):
        print(f"  {i:2d}. {aid}")

    if dry_run or list_only:
        return

    if changed_only:
        repo = _maven_local_repo()
        print(f"[INFO] Maven 本地仓库: {repo}")
        print(f"[INFO] --changed-only 模式：仅安装源码比 jar 新的模块")

    failed = []
    for aid in order:
        if not install_module(aid, registry, mvn_cmd, changed_only=changed_only):
            failed.append(aid)
            print(f"\n[STOP] {aid} 安装失败，中断后续模块")
            break

    if failed:
        print(f"\n[FAIL] 以下模块安装失败:")
        for f in failed:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print(f"\n[OK] 全部 {len(order)} 个依赖模块安装完成")


if __name__ == "__main__":
    main()
