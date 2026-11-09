"""前端界面-操作-JS 方法-HTTP 请求链路索引配置。"""
import json
import re
from pathlib import Path

# front/config.py → front → scripts → 插件目录 → plugins → .agents → 工作区根
WORKSPACE_ROOT = Path(__file__).resolve().parents[5]

FRONT_ROOT = WORKSPACE_ROOT / "src" / "frontend" / "hisfront" / "static"
FRONT_ROOT_REL = "src/frontend/hisfront/static"

# 第三方/构建产物目录，不参与链路抽取
SKIP_DIR_NAMES = {
    "scripts_lib", "lib", "node_modules", "bower_components", "vendor",
    "dist", ".git", "__pycache__",
}

# 体积或形态判定为压缩/资源的文件不参与扫描
MAX_JS_FILE_MB = 2.0
MAX_HTML_FILE_MB = 4.0
MINIFIED_LINE_LEN = 1000

HTML_EXTS = {".html", ".htm"}
JS_EXTS = {".js"}


def _declared_output_dir() -> Path:
    manifest = Path(__file__).resolve().parents[2] / ".agents-plugin" / "plugin.json"
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        for entry in data.get("projectDirectories", []):
            if entry.get("id") == "front-codegraph-index" and entry.get("path"):
                return WORKSPACE_ROOT / entry["path"]
    except (OSError, ValueError):
        pass
    return WORKSPACE_ROOT / "docs" / "agents" / "imedicalxc-doctor-front-codegraph"


OUTPUT_DIR = _declared_output_dir()

# 扫描产物
JS_INDEX_FILE = OUTPUT_DIR / "front_js_index.jsonl"
PAGES_FILE = OUTPUT_DIR / "front_pages.jsonl"
ELEMENTS_FILE = OUTPUT_DIR / "front_elements.jsonl"
CHAINS_FILE = OUTPUT_DIR / "front_chains.jsonl"
DB_FILE = OUTPUT_DIR / "front_chain_db.json"
STATS_FILE = OUTPUT_DIR / "front_scan_stats.json"
MENU_SNAPSHOT_FILE = OUTPUT_DIR / "menu_snapshot.json"
CONFIG_INJECTION_FILE = OUTPUT_DIR / "config_injection_snapshot.json"
GRAPHML_FILE = OUTPUT_DIR / "front_chain.graphml"


def to_front_relative(path) -> str:
    """统一输出为 static 根的 POSIX 相对路径。"""
    p = Path(path)
    try:
        return p.resolve().relative_to(FRONT_ROOT.resolve()).as_posix()
    except (ValueError, OSError):
        return p.as_posix()


def to_workspace_relative(path) -> str:
    p = Path(path)
    try:
        return p.resolve().relative_to(WORKSPACE_ROOT.resolve()).as_posix()
    except (ValueError, OSError):
        return p.as_posix()


def module_of(rel_path: str) -> str:
    return rel_path.split("/", 1)[0] if "/" in rel_path else ""


# ── 工具类（非业务）JS 识别规则 ─────────────────────────────────
# 依据代码现状归纳的四层约定：框架目录 → 模块公共目录 → 公共函数库文件名 → 插件方法命名。
# 只按目录名（如 common）判断会误杀业务共享文件，故 common 仅与特定文件名组合生效；
# 模块公共目录按前缀白名单登记，避免 mchs/common/scripts/mchs_adm.js 这类业务公共脚本被误杀。
UTILITY_FRAMEWORK_DIR = "base/scripts/"
UTILITY_FRAMEWORK_EXCLUDE = "base/scripts/doc/plugins/"
UTILITY_DIR_SEGMENTS = (
    "/utils/", "/util/", "/tools/", "/tool/", "/hisui/",
    "/third-party/", "/ueditor/", "/xlsx/",
)
# 已逐个确认的模块公共库目录（均为 UI 组件/公共封装，不含业务页面逻辑）
UTILITY_DIR_PREFIXES = (
    "iphis/common/scripts/",       # iphis 字典/表格公共组件（common.dict 的 datagrid 等）
    "msup/common/scripts/",        # 药房公共（com.js / grideditor.js / presc.js …）
    "phm/common/scripts/",         # 药房公共（com.fun.js / component.js / phm.auth.js …）
    "clor/com/scripts/",           # 手术公共组件（frameWork.js / datagrid-*.js / reason.js …）
    "mrnr/nuremr/scripts/plugin/",  # 护理文书 datagrid 插件
    "ar/common/scripts/plugin/",    # ar 第三方插件（bignumber / echarts / hotkeys …）
)
# 精确到文件的公共组件（同名文件在业务目录中也存在，不能按 basename 全局判定）
UTILITY_EXACT_FILES = {
    "hai/scripts/component.js",
    "hai/scripts/detail-table.js",
    "hai/scripts/floatwindow.js",
    "mr/common/scripts/fs.desktopprint.js",
    "emtr/common/js/iconCommon.js",      # 患者信息条渲染组件
    "ct/common/scripts/dict.js",          # 字典表增删改查通用组件
}
# 运行时加载器/引导脚本：只做脚本装载与缓存，不含业务动作
UTILITY_LOADER_FILES = {
    "ar/insu/basesrv/scripts/insu.port.js",  # 医保端脚本加载器（Proxy 排队）
}
UTILITY_BASENAME_RE = re.compile(
    r"^(?:jquery.*|websys.*|.*\.websys|hisui.*|.*\.sysmgr|"
    r"pubfunction|funlib.*|session|laybutton|mock)\.js$"
    r"|^(?:jquery|common|com)\.hisui\.js$"
    r"|^.*import\.hisui\.js$"
    r"|^common[._-].*\.js$"
    r"|^commonfunc.*\.js$"
    r"|^datagrid[-._].*\.js$|^datagrid\.js$"
    r"|^validatebox.*\.js$"
    r"|^framework\.js$"
    r"|^jspdf.*\.js$"
    r"|^xc\..*\.js$"
    r"|.*\.min\.js$", re.I)
UTILITY_EXACT_BASENAMES = {"extend.js"}
UTILITY_COMMON_BASENAMES = {"public.js", "tools.js", "ux.js", "common.js"}
UTILITY_FUNCTION_PREFIXES = ("$",)


def utility_reason(rel_path: str, func_name: str = "") -> str:
    """返回工具类判定依据；空字符串表示业务代码。"""
    low = "/" + rel_path.lower()
    if low.startswith("/" + UTILITY_FRAMEWORK_DIR) and \
            not low.startswith("/" + UTILITY_FRAMEWORK_EXCLUDE):
        return "framework_dir"
    if rel_path in UTILITY_EXACT_FILES:
        return "common_component"
    if rel_path in UTILITY_LOADER_FILES:
        return "loader_script"
    if any(rel_path.startswith(prefix) for prefix in UTILITY_DIR_PREFIXES):
        return "module_common_dir"
    for seg in UTILITY_DIR_SEGMENTS:
        if seg in low:
            return "util_dir"
    base = rel_path.rsplit("/", 1)[-1].lower()
    if UTILITY_BASENAME_RE.match(base):
        return "framework_lib"
    if base in UTILITY_EXACT_BASENAMES:
        return "common_lib"
    if "util" in base:
        return "util_name"
    if base in UTILITY_COMMON_BASENAMES and "/common/" in low:
        return "common_lib"
    if func_name.startswith(UTILITY_FUNCTION_PREFIXES):
        return "plugin_method"
    return ""


def normalize_router(router: str) -> str:
    """菜单/图表/按钮 URL 归一化为 static 根相对路径。"""
    if not router:
        return ""
    value = router.strip().replace("\\", "/")
    value = value.split("?", 1)[0].split("#", 1)[0]
    while value.startswith("../") or value.startswith("./"):
        value = value[3:] if value.startswith("../") else value[2:]
    return value.lstrip("/")


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def iter_front_files(exts):
    """按确定顺序遍历前端源文件，跳过第三方目录与压缩产物。"""
    for path in sorted(FRONT_ROOT.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in exts:
            continue
        rel = to_front_relative(path)
        parts = rel.split("/")
        if any(part in SKIP_DIR_NAMES for part in parts[:-1]):
            continue
        # 打包进页面的第三方库（pdf.js / polyfill）不参与业务链路抽取，
        # 否则库内 `call()` 这类通用名会挂到业务页面的同名函数上
        if any(part.lower().startswith("pdfjs") for part in parts[:-1]):
            continue
        if path.name.lower().startswith("babel-polyfill"):
            continue
        if path.name.endswith(".min.js"):
            continue
        yield path, rel


def is_probably_minified(text: str, name: str) -> bool:
    if name.endswith(".min.js"):
        return True
    sample = text[:20000]
    lines = sample.split("\n")
    if not lines:
        return False
    longest = max((len(line) for line in lines[:200]), default=0)
    return longest > MINIFIED_LINE_LEN and len(lines) < 50
