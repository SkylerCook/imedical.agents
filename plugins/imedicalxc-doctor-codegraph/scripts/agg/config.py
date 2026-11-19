"""服务总线（sm_hsb）生产者/消费者绑定索引配置。"""
import json
import re
from pathlib import Path

# scripts/agg/config.py → agg → scripts → 插件目录 → plugins → .agents → 工作区根
WORKSPACE_ROOT = Path(__file__).resolve().parents[5]

SCHEMA = "sm_hsb"
DB_LABEL = "db_hsb"

# 接入系统主表中的两个特殊系统
HIS_SYSTEM_NAME = "HIS"
BUS_SYSTEM_NAME = "服务总线"

# 服务名/描述里的中文称谓 → 接入系统 access_name。
# 只做确定性命中：先按最长词匹配，命中即停；未命中保留原文，不猜系统。
SYSTEM_ALIASES = [
    ("检验外送", "LISDelivery"),
    ("第三方体检", "PE"),
    ("医保智能审核", "IMIR"),
    ("医保移动支付", "Insu"),
    ("血液净化", "血透"),
    ("辅助生殖", "辅助生殖"),
    ("手术麻醉", "AN"),
    ("互联网医院", "WeChat"),
    ("互联网平台", "WeChat"),
    ("DRG单病种", "DRGDIP"),
    ("单病种", "DRGDIP"),
    ("传染病", "NIF"),
    ("不良事件", "ADV"),
    ("自助机", "ATM"),
    ("煎药机", "DRUG"),
    ("急诊留观", "HIS"),
    ("床旁结算", "HIS"),
    ("病案", "EM"),
    ("检验", "LIS"),
    ("检查", "RIS"),
    ("病理", "PIS"),
    ("输血", "BLD"),
    ("体检", "PE"),
    ("院感", "HAI"),
    ("心电", "EKG"),
    ("重症", "ICUService"),
    ("ICU", "ICUService"),
    ("血糖", "DMGS"),
    ("血透", "血透"),
    ("麻醉", "AN"),
    ("互联网", "WeChat"),
    ("HIS", "HIS"),
    ("医生站", "HIS"),
    ("HRP", "HRP"),
]
SYSTEM_ALIASES.sort(key=lambda item: (-len(item[0]), item[0]))

# 服务名里声明的调用方："…给检验及HIS调用"
_DECLARED_CALL_RE = re.compile(r"给(.+?)调用")
# 声明目标里要去掉的尾缀（"检验系统" → "检验"）
_TARGET_SUFFIXES = ("系统", "平台", "部分", "接口", "公司")
_TARGET_SPLIT_RE = re.compile(r"[、,，/及和]")

# 密钥/凭据类字段：任何导出数据集都不得选取（脚本 SQL 里也不出现）
SENSITIVE_COLUMNS = (
    "service_password",
    "salt",
    "encrypted_reg_code",
    "register_code",
    "app_secret",
    "signature",
    "access_key",
    "access_secret",
    "system_secret",
    "encrypt_secret",
)


def _declared_output_dir() -> Path:
    manifest = Path(__file__).resolve().parents[2] / ".agents-plugin" / "plugin.json"
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        for entry in data.get("projectDirectories", []):
            if entry.get("id") == "aggregation-index" and entry.get("path"):
                return WORKSPACE_ROOT / entry["path"]
    except (OSError, ValueError):
        pass
    return WORKSPACE_ROOT / "docs" / "agents" / "imedicalxc-doctor-aggregation"


OUTPUT_DIR = _declared_output_dir()
RAW_FILE = OUTPUT_DIR / "aggregation_raw.json"
DB_FILE = OUTPUT_DIR / "aggregation_db.json"
STATS_FILE = OUTPUT_DIR / "aggregation_stats.json"

# 调用图侧端点索引：注册资源 URL → Controller 方法
CODEGRAPH_DOC_DIR = WORKSPACE_ROOT / "docs" / "agents" / "imedicalxc-doctor-codegraph"
CONTROLLER_INDEX_FILE = CODEGRAPH_DOC_DIR / "controller_endpoints.json"
MAVEN_CONTROLLER_INDEX_FILE = CODEGRAPH_DOC_DIR / "maven_controller_endpoints.json"


def normalize_target(term: str) -> str:
    value = re.sub(r"[（(].*?[)）]", "", term).strip()
    for suffix in _TARGET_SUFFIXES:
        if value.endswith(suffix) and len(value) > len(suffix):
            value = value[: -len(suffix)]
    return value.strip()


def declared_targets(service_name: str):
    """从服务名解析声明的调用方原文列表，保持出现顺序并去重。"""
    if not service_name:
        return []
    match = _DECLARED_CALL_RE.search(service_name)
    if not match:
        return []
    targets = []
    for part in _TARGET_SPLIT_RE.split(match.group(1)):
        term = normalize_target(part)
        if term and term not in targets:
            targets.append(term)
    return targets


def match_system(term: str, system_names):
    """称谓 → 接入系统 access_name；未命中返回空串。"""
    if not term:
        return ""
    value = normalize_target(term)
    upper = value.upper()
    for name in system_names:
        if value == name or upper == name.upper():
            return name
    for alias, canonical in SYSTEM_ALIASES:
        if alias in value or alias.upper() in upper:
            return canonical
    for name in sorted(system_names, key=len, reverse=True):
        if len(name) >= 2 and name.upper() in upper:
            return name
    return ""


def resource_module(url: str) -> str:
    """资源路径所属模块：/api/openapi/aggcare/... → aggc/re; 裸路径 → ''。"""
    segs = [s for s in (url or "").split("/") if s]
    for idx, seg in enumerate(segs):
        if seg.lower() == "openapi" and idx + 1 < len(segs):
            return segs[idx + 1]
    return segs[0] if len(segs) > 1 else ""
