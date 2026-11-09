#!/usr/bin/env python3
"""
扫描工作区源码中的 @FeignClient 注解
提取 Feign 接口信息和服务调用关系
"""
import re
from pathlib import Path
from typing import List, Dict, Set
from dataclasses import dataclass, field
import json
import logging

from config import OUTPUT_DIR, to_repo_relative

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class FeignMethod:
    """Feign 接口方法"""
    name: str
    http_method: str  # GET, POST, PUT, DELETE
    path: str
    return_type: str
    parameters: List[str] = field(default_factory=list)


@dataclass
class FeignInterface:
    """Feign 接口"""
    class_name: str
    package_name: str
    file_path: Path
    service_name: str  # @FeignClient 的 value
    service_path: str  # @FeignClient 的 path
    methods: List[FeignMethod] = field(default_factory=list)
    
    @property
    def full_name(self) -> str:
        return f"{self.package_name}.{self.class_name}"


class FeignScanner:
    """Feign 接口扫描器"""
    
    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.interfaces: List[FeignInterface] = []
        
        # 正则表达式
        self.feign_client_pattern = re.compile(
            r'@FeignClient\s*\(([^)]+)\)',
            re.MULTILINE | re.DOTALL
        )
        self.value_pattern = re.compile(r'value\s*=\s*"([^"]+)"')
        self.path_pattern = re.compile(r'path\s*=\s*"([^"]+)"')
        self.package_pattern = re.compile(r'^\s*package\s+([\w.]+)\s*;', re.MULTILINE)
        self.interface_pattern = re.compile(
            r'(?:public\s+)?interface\s+(\w+)'
        )
        self.method_pattern = re.compile(
            r'@(Get|Post|Put|Delete|Patch)Mapping\s*\(([^)]*)\)\s*'
            r'([\w<>\[\].]+)\s+(\w+)\s*\(([^)]*)\)',
            re.MULTILINE | re.DOTALL
        )
        self.request_mapping_pattern = re.compile(
            r'@RequestMapping\s*\(([^)]*)\)\s*'
            r'([\w<>\[\].]+)\s+(\w+)\s*\(([^)]*)\)',
            re.MULTILINE | re.DOTALL
        )
    
    def scan_all(self) -> List[FeignInterface]:
        """扫描所有工作区仓库"""
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
                logger.warning(f"仓库不存在: {repo_path}")
                continue
            
            logger.info(f"扫描仓库: {repo}")
            self._scan_directory(repo_path)
        
        logger.info(f"扫描完成，共发现 {len(self.interfaces)} 个 Feign 接口")
        return self.interfaces
    
    def _scan_directory(self, dir_path: Path):
        """扫描目录下的所有 Java 文件"""
        for java_file in sorted(dir_path.rglob("*.java")):
            try:
                self._scan_file(java_file)
            except Exception as e:
                logger.debug(f"扫描文件失败 {java_file}: {e}")
    
    def _scan_file(self, file_path: Path):
        """扫描单个 Java 文件"""
        content = file_path.read_text(encoding='utf-8')
        
        # 检查是否包含 @FeignClient
        if '@FeignClient' not in content:
            return
        
        # 提取 package
        package_match = self.package_pattern.search(content)
        package_name = package_match.group(1) if package_match else ""
        
        # 提取接口名
        interface_match = self.interface_pattern.search(content)
        if not interface_match:
            return
        class_name = interface_match.group(1)
        
        # 提取 @FeignClient 注解
        feign_match = self.feign_client_pattern.search(content)
        if not feign_match:
            return
        
        feign_args = feign_match.group(1)
        
        # 提取 value（服务名）
        value_match = self.value_pattern.search(feign_args)
        service_name = value_match.group(1) if value_match else ""
        
        # 提取 path
        path_match = self.path_pattern.search(feign_args)
        service_path = path_match.group(1) if path_match else ""
        
        # 创建 FeignInterface
        feign_interface = FeignInterface(
            class_name=class_name,
            package_name=package_name,
            file_path=file_path,
            service_name=service_name,
            service_path=service_path,
        )
        
        # 提取方法
        methods = self._extract_methods(content)
        feign_interface.methods = methods
        
        self.interfaces.append(feign_interface)
    
    def _extract_methods(self, content: str) -> List[FeignMethod]:
        """提取接口方法"""
        methods = []
        
        # 提取 @GetMapping, @PostMapping 等
        for match in self.method_pattern.finditer(content):
            http_method = match.group(1).upper()
            mapping_args = match.group(2)
            return_type = match.group(3)
            method_name = match.group(4)
            params_str = match.group(5)
            
            # 提取 path
            path = ""
            path_match = re.search(r'(?:value\s*=\s*)?"([^"]+)"', mapping_args)
            if path_match:
                path = path_match.group(1)
            
            # 解析参数
            parameters = [p.strip() for p in params_str.split(",") if p.strip()]
            
            methods.append(FeignMethod(
                name=method_name,
                http_method=http_method,
                path=path,
                return_type=return_type,
                parameters=parameters,
            ))
        
        # 提取 @RequestMapping
        for match in self.request_mapping_pattern.finditer(content):
            mapping_args = match.group(1)
            return_type = match.group(2)
            method_name = match.group(3)
            params_str = match.group(4)
            
            # 提取 method 和 path
            http_method = "GET"  # 默认
            method_match = re.search(r'method\s*=\s*RequestMethod\.(\w+)', mapping_args)
            if method_match:
                http_method = method_match.group(1)
            
            path = ""
            path_match = re.search(r'(?:value\s*=\s*)?"([^"]+)"', mapping_args)
            if path_match:
                path = path_match.group(1)
            
            parameters = [p.strip() for p in params_str.split(",") if p.strip()]
            
            methods.append(FeignMethod(
                name=method_name,
                http_method=http_method,
                path=path,
                return_type=return_type,
                parameters=parameters,
            ))
        
        return methods
    
    def export_to_json(self, output_path: Path):
        """导出为 JSON"""
        data = {
            "total_interfaces": len(self.interfaces),
            "services": {},
            "interfaces": []
        }
        
        # 按服务分组统计
        service_stats = {}
        for iface in self.interfaces:
            service_name = iface.service_name
            if service_name not in service_stats:
                service_stats[service_name] = 0
            service_stats[service_name] += 1
        
        data["services"] = service_stats
        
        # 导出接口详情
        for iface in sorted(self.interfaces, key=lambda i: i.full_name):
            iface_data = {
                "class_name": iface.class_name,
                "package_name": iface.package_name,
                "full_name": iface.full_name,
                "file_path": to_repo_relative(iface.file_path),
                "service_name": iface.service_name,
                "service_path": iface.service_path,
                "methods": [
                    {
                        "name": m.name,
                        "http_method": m.http_method,
                        "path": m.path,
                        "return_type": m.return_type,
                        "parameters": m.parameters,
                    }
                    for m in iface.methods
                ]
            }
            data["interfaces"].append(iface_data)
        
        output_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True),
            encoding='utf-8'
        )
        logger.info(f"导出到: {output_path}")
    
    def print_summary(self):
        """打印摘要"""
        print("\n" + "=" * 60)
        print("Feign 接口扫描摘要")
        print("=" * 60)
        print(f"总接口数: {len(self.interfaces)}")
        
        # 按服务分组
        service_map: Dict[str, List[FeignInterface]] = {}
        for iface in self.interfaces:
            service = iface.service_name
            if service not in service_map:
                service_map[service] = []
            service_map[service].append(iface)
        
        print(f"\n服务数量: {len(service_map)}")
        print("\n各服务接口数:")
        for service, ifaces in sorted(service_map.items(), key=lambda x: len(x[1]), reverse=True):
            print(f"  {service}: {len(ifaces)} 个接口")
        
        # 统计方法数
        total_methods = sum(len(iface.methods) for iface in self.interfaces)
        print(f"\n总方法数: {total_methods}")


def main():
    """主函数"""
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    workspace_root = PROJECT_ROOT / "src" / "backend"
    output_dir = OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    
    scanner = FeignScanner(workspace_root)
    scanner.scan_all()
    scanner.print_summary()
    scanner.export_to_json(output_dir / "feign_interfaces.json")


if __name__ == "__main__":
    main()
