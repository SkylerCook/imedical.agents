#!/usr/bin/env python3
"""构建前端链路库：界面 → 操作元素 → JS 方法 → HTTP 请求。

输入（由 js_scan.py / html_scan.py 生成，menu_snapshot.json 可选）:
    front_js_index.jsonl  front_pages.jsonl  front_elements.jsonl  menu_snapshot.json
输出:
    front_chains.jsonl    每条「页面-操作-JS 调用路径-HTTP 请求」链路
    front_chain_db.json   页面 / 操作元素 / 可达函数 / 请求 / 链路索引
    front_scan_stats.json 规模与解析质量统计
    front_chain.graphml   可选（--graphml）

用法:
    python build_front_chain_db.py [--graphml] [--max-depth 6] [--max-requests 40]
"""
import argparse
import datetime as dt
import json
import posixpath
import re
import sys
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    CHAINS_FILE, CONFIG_INJECTION_FILE, DB_FILE, ELEMENTS_FILE, FRONT_ROOT_REL,
    GRAPHML_FILE, JS_INDEX_FILE, MENU_SNAPSHOT_FILE, OUTPUT_DIR, PAGES_FILE,
    STATS_FILE, normalize_router, utility_reason,
)
from config_injection import DYNAMIC_SCENARIOS, NO_MERGE_SCENARIOS

MAX_DEPTH = 6
MAX_REQUESTS = 40
# 单条请求/跳转最多保留的 URL 变体（运行时分支二选一，静态扫描并列保留）
MAX_URL_VARIANTS = 8

_NAV_LIKE = {"ShowHISUIWindow", "openHISUIWindow", "window.open", "showHISUIWindow"}
_JS_STATEMENTS = {
    "void", "return", "typeof", "delete", "new", "if", "else", "for", "while",
    "switch", "try", "throw", "function", "javascript",
}
_IDENT_RE = re.compile(r"^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)")
_CALL_EXPR_RE = re.compile(r"^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(")
_PREFIX_VARS = {
    "appPath", "AppPath", "websys_appPath", "websys_apppath", "webPath", "basePath",
    "baseAppPath", "ctx", "contextPath", "rootPath", "requestPath", "urlPrefix",
    "frontPath",
}
_URL_RUN_RE = re.compile(r"[A-Za-z0-9_$@.~/:-]+")
_PATH_CHARS_RE = re.compile(r"[A-Za-z0-9_$@.~:/%+-]+")
_CALL_VAR_RE = re.compile(r"^[A-Za-z_$][\w$]*\(\)$")

# URL 前缀变量取值不是业务路径，拼接时丢弃
_DROP_TERM_RE = re.compile(r"^(?:this\.)?[A-Za-z_$][\w$]*(?:\(\))?$")


def _read_jsonl(path):
    records = []
    if not path.exists():
        return records
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def _handler_ident(expr):
    """从 on* 属性表达式里取被调用的方法名，忽略参数与后续语句。"""
    expr = (expr or "").strip()
    if not expr:
        return ""
    m = _CALL_EXPR_RE.match(expr) or _IDENT_RE.match(expr)
    if not m:
        return ""
    ident = m.group(1)
    if ident in _JS_STATEMENTS or ident.split(".")[0] in _JS_STATEMENTS:
        return ""
    return ident


_CONTEXT_PREFIXES = ("his/", "imedical/his/", "imedical/")
_NON_PAGE_EXTS = {
    "csp", "rpx", "aspx", "jsp", "json", "xml", "txt", "csv",
    "xls", "xlsx", "doc", "docx", "pdf", "ppt", "pptx", "zip", "rar",
}
_HTML_TAIL_RE = re.compile(r"\.html?", re.I)
_HTML_SRC_RE = re.compile(r"""src\s*=\s*["']([^"']*)["']""", re.I)
_TEMPLATE_HEAD_RE = re.compile(r"""^\$\{[^}]*?["']([^"']+)["']""")


def normalize_open_url(url):
    """把弹窗/跳转地址还原成可比较的页面路径。

    处理三类实际写法：`${websys_frontPathCombine("x.html")}` 模板串（可能带
    尾随查询串）、`addTab(..., "<iframe src='x.html'>")` 的 HTML 片段、以及
    `insu.checkbjphbpop.htmlinput=` 这种拼接残留。
    """
    value = (url or "").strip()
    if value.startswith("${"):
        m = _TEMPLATE_HEAD_RE.match(value)
        value = m.group(1) if m else ""
    if value.startswith("<"):
        m = _HTML_SRC_RE.search(value)
        value = m.group(1) if m else ""
    m = _HTML_TAIL_RE.search(value)
    if m and len(value) > m.end() and value[m.end()] not in "/?#":
        value = value[:m.end()]
    return value.strip().replace("\\", "/")


def _path_variants(value):
    """逐层剥掉 `../` 与部署上下文前缀：`../../his/opcare/x.html` → `opcare/x.html`。"""
    out = []

    def add(candidate):
        if candidate and candidate not in out:
            out.append(candidate)

    add(value)
    trimmed = value
    while trimmed.startswith("../"):
        trimmed = trimmed[3:]
        add(trimmed)
    for base in list(out):
        for prefix in _CONTEXT_PREFIXES:
            if base.startswith(prefix) and len(base) > len(prefix):
                add(base[len(prefix):])
    return out


def page_target_candidates(page_file, url):
    """弹窗/菜单地址的候选页面：相对当前页、相对 base/（前端根）或相对 static 根。

    医生站弹窗多用 websys_frontPathCombine("../opcare/...")，以 base/ 为基准；
    菜单配置则常写 "../../../opcare/..."，以当前页面为基准。
    """
    value = normalize_open_url(url)
    if not value or value.startswith(("javascript:", "http://", "https://", "//",
                                     "about:", "mailto:", "tel:")):
        return []
    value = value.split("?", 1)[0].split("#", 1)[0]
    if not value or value.endswith((".csp", ".aspx", ".jsp")):
        return []
    absolute = value.startswith("/")
    if absolute:
        # 绝对路径优先按 static 根解释；医生站也有页面把根当成本页目录，补充兜底
        value = value.lstrip("/")
        if "/static/" in value:
            value = value.split("/static/", 1)[1]
    out = []

    def push(candidate):
        candidate = posixpath.normpath(candidate)
        if candidate and candidate != "." and not candidate.startswith("..") \
                and candidate not in out:
            out.append(candidate)

    for val in _path_variants(value):
        if absolute:
            push(val)
            push(posixpath.join(posixpath.dirname(page_file), val))
            push(posixpath.join("base", val))
            continue
        push(posixpath.join(posixpath.dirname(page_file), val))
        push(posixpath.join("base", val))
        push(val.lstrip("./"))
    return out


def _edit_distance_le1(a, b):
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    if len(a) == len(b):
        return a[i + 1:] == b[i + 1:]
    return a[i:] == b[i + 1:]


def resolve_page_target(page_file, url, page_set=None):
    """配置/弹窗 url 统一成 static 根相对路径；给了 page_set 时只返回真实存在的页面。"""
    candidates = page_target_candidates(page_file, url)
    if page_set is None:
        return candidates[0] if candidates else ""
    hit = next((c for c in candidates if c in page_set), "")
    if hit:
        return hit
    value = normalize_open_url(url).split("?", 1)[0].split("#", 1)[0]
    # 部署根不同（../../insu/... → ar/insu/...）时按最长尾段唯一回退；
    # 带目录的地址不会误连到区域变体（injr/43 → bj）。
    for variant in _path_variants(value.lstrip("/")):
        tails = [variant]
        # 模块改名（opspcol → emnur）时首段不同、其余目录一致
        if not variant.startswith("..") and "/" in variant:
            tails.append(variant.split("/", 1)[1])
        for tail in tails:
            if "/" not in tail:
                continue
            matches = [p for p in page_set if p == tail or p.endswith("/" + tail)]
            if len(matches) == 1:
                return matches[0]
    near = []
    for candidate in candidates:
        directory, _, name = candidate.rpartition("/")
        if not name or not directory:
            continue
        for p in page_set:
            if p.startswith(directory + "/") and "/" not in p[len(directory) + 1:] \
                    and _edit_distance_le1(p.rsplit("/", 1)[-1], name) \
                    and p not in near:
                near.append(p)
    if len(near) == 1:
        return near[0]
    # 相对片段（referral.html、consultque.html）按唯一同名页面回退；同名多义时不猜。
    name = candidates[0].rsplit("/", 1)[-1] if candidates else ""
    if name:
        matches = [p for p in page_set if p.rsplit("/", 1)[-1] == name]
        if len(matches) == 1:
            rel = value.lstrip("./")
            if "/" not in rel or matches[0].endswith("/" + rel):
                return matches[0]
    return ""


def classify_open_target(page_file, url, page_set):
    """返回 (页面, 未落地原因)：页面 / runtime（无地址或运行时变量） / non_page（非静态页面）。"""
    value = normalize_open_url(url)
    if not value:
        return "", "runtime"
    low = value.lower()
    if low.startswith(("http://", "https://", "//", "mailto:", "tel:", "about:",
                       "javascript:")):
        return "", "non_page"
    if value[0] in "_&?#":
        return "", "non_page"
    name = value.split("?", 1)[0].split("#", 1)[0].rsplit("/", 1)[-1]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in _NON_PAGE_EXTS:
        return "", "non_page"
    target = resolve_page_target(page_file, value, page_set)
    if target:
        return target, "page"
    if ext not in ("html", "htm"):
        return "", "non_page"
    return "", "unresolved"


def _is_nav(handler):
    return handler in _NAV_LIKE or handler.split(".")[0] in _NAV_LIKE or \
        handler.startswith("window.open")


class ChainBuilder:
    def __init__(self, max_depth, max_requests):
        self.max_depth = max_depth
        self.max_requests = max_requests
        self.js_records = {}
        self.fn_by_id = {}
        self.file_qualified = {}
        self.file_names = {}
        self.constants_by_file = {}
        self.bindings_by_file = {}
        self.toolbar_by_file = {}
        self.inline_by_file = {}
        self.bar_by_file = {}
        self.config_by_file = {}
        self.global_names = None
        self.global_suffix = None
        self.top_vars_by_file = {}
        self._resolve_cache = {}
        self._handler_cache = {}
        self.dropped_prefixes = set()

    # ── 载入 ────────────────────────────────────────────────────
    def load(self):
        for rec in _read_jsonl(JS_INDEX_FILE):
            if "error" in rec or "skipped" in rec:
                continue
            file = rec["file"]
            self.js_records[file] = rec
            self.top_vars_by_file[file] = set(rec.get("top_vars", []))
            qmap = {}
            nmap = defaultdict(list)
            for fn in rec.get("functions", []):
                fn["file"] = file
                fn["requests"] = fn.get("requests", [])
                fn["calls"] = fn.get("calls", [])
                fn["opens"] = fn.get("opens", [])
                self.fn_by_id[fn["id"]] = fn
                qmap[fn["qualified"]] = fn["id"]
                nmap[fn["name"]].append(fn["qualified"])
            self.file_qualified[file] = qmap
            self.file_names[file] = nmap
            self.constants_by_file[file] = defaultdict(list)
            for con in rec.get("constants", []):
                self.constants_by_file[file][con["name"]].append(con)
            self.bindings_by_file[file] = rec.get("bindings", [])
            self.toolbar_by_file[file] = rec.get("toolbar_bindings", [])
            self.inline_by_file[file] = rec.get("inline_elements", [])
            self.bar_by_file[file] = rec.get("bar_bindings", [])
            self.config_by_file[file] = rec.get("config_calls", [])

    # ── 方法解析 ────────────────────────────────────────────────
    def resolve_call(self, file, owner_qual, callee, allowed_files=None, member=False):
        allowed_key = tuple(allowed_files or ())
        if callee.startswith("@dispatch:"):
            key = (file, owner_qual, callee, allowed_key, False)
            cached = self._resolve_cache.get(key)
            if cached is not None:
                return cached or None
            result = self._resolve_dispatch(allowed_files, callee[len("@dispatch:"):])
            self._resolve_cache[key] = result or ""
            return result
        key = (file, owner_qual, callee, allowed_key, member)
        cached = self._resolve_cache.get(key)
        if cached is not None:
            return cached or None
        result = self._resolve_call(file, owner_qual, callee, allowed_files, member)
        self._resolve_cache[key] = result or ""
        return result

    def _resolve_dispatch(self, scripts, spec):
        """注册表成员解析：页面脚本内优先，其次全局唯一后缀（插件脚本是运行时注入的）。"""
        registry, _, key = spec.partition(".")
        if not registry or not key:
            return ""
        exact = f"{registry}.{key}"
        for script in scripts or ():
            qmap = self.file_qualified.get(script, {})
            if exact in qmap:
                return qmap[exact]
            for qual, fid in qmap.items():
                if qual.endswith("." + exact):
                    return fid
        ids = self._suffix_index().get(exact, [])
        unique = set(ids)
        return ids[0] if len(unique) == 1 else ""

    def _resolve_call(self, file, owner_qual, callee, allowed_files=None, member=False):
        qmap = self.file_qualified.get(file, {})
        if member and "." not in callee:
            # 运行时成员调用的裸方法名（`$(...).lookup()`）只认同文件唯一同名定义，
            # 不做全局回退——否则会挂到其他页面同名函数上（lookup 曾因此有 900 条入边）
            names = self.file_names.get(file, {}).get(callee, [])
            if len(names) == 1:
                return qmap[names[0]]
            return ""
        if callee in qmap:
            return qmap[callee]
        if callee.startswith("this.") or callee.startswith("self."):
            member = callee.split(".", 1)[1]
            prefix = owner_qual.rsplit(".", 1)[0] if "." in owner_qual else ""
            cand = f"{prefix}.{member}" if prefix else member
            if cand in qmap:
                return qmap[cand]
        if "." in callee:
            for qual, fid in qmap.items():
                if qual.endswith("." + callee):
                    return fid
        if "." not in callee:
            names = self.file_names.get(file, {}).get(callee, [])
            if len(names) == 1:
                return qmap[names[0]]
        return self._resolve_global(file, callee, allowed_files)

    def _pick(self, ids, allowed_files):
        unique = set(ids)
        if len(unique) == 1:
            return ids[0]
        if allowed_files:
            # 同名定义跨文件重复时，页面脚本集合内的唯一命中优先
            hits = [i for i in unique if i in self.fn_by_id
                    and self.fn_by_id[i]["file"] in allowed_files]
            if len(hits) == 1:
                return hits[0]
        return ""

    def _resolve_global(self, file, callee, allowed_files=None):
        if self.global_names is None:
            self.global_names = defaultdict(list)
            for f, qmap in self.file_qualified.items():
                for qual, fid in qmap.items():
                    self.global_names[qual].append(fid)
        # window.X / globalThis.X 与裸 X 是同一全局函数
        names = [callee]
        for prefix in ("window.", "globalThis."):
            if callee.startswith(prefix):
                names.append(callee[len(prefix):])
                break
        else:
            names += [f"window.{callee}", f"globalThis.{callee}"]
        for name in names:
            ids = self.global_names.get(name)
            if ids:
                found = self._pick(ids, allowed_files)
                if found:
                    return found
        if "." not in callee:
            return ""
        # Obj.method 的定义可能挂在更深命名空间（IIFE 返回对象）下，按成员后缀唯一匹配
        found = self._pick(self._suffix_index().get(callee, []), allowed_files)
        if found:
            return found
        # IIFE 把方法声明成裸函数、只通过命名空间对象对外暴露时（如
        # `var CardCommon_ControlObj = (function(){ ... return {"GetAccInfo": GetAccInfo} })()`），
        # 允许回退到裸方法名；但要求定义所在文件确实声明了该顶层变量。
        # `dg.datagrid(...)` / `$hm.dg.datagrid(...)` 的 datagrid 定义在别处、该文件也没有 `dg`，
        # 因此不会挂到 common.dict.js::datagrid 这类同名插件函数上。
        if callee.count(".") == 1:
            base, method = callee.split(".", 1)
            ids = [fid for fid in self.global_names.get(method, [])
                   if base in self.top_vars_by_file.get(self.fn_by_id[fid]["file"], ())]
            found = self._pick(ids, allowed_files)
            if found:
                return found
        return ""

    def _suffix_index(self):
        """按尾部 2~3 段建索引：Obj.Func / Namespace.Obj.Func 两种写法都能命中。"""
        if self.global_suffix is None:
            self.global_suffix = defaultdict(list)
            for qmap in self.file_qualified.values():
                for qual, fid in qmap.items():
                    parts = qual.split(".")
                    for size in range(2, min(3, len(parts)) + 1):
                        self.global_suffix[".".join(parts[-size:])].append(fid)
        return self.global_suffix

    def resolve_handler(self, scripts, handler):
        """事件 handler 必须先在页面脚本里解析，避免同名函数跨文件误配。"""
        key = (tuple(scripts), handler)
        cached = self._handler_cache.get(key)
        if cached is not None:
            return cached or ""
        found = ""
        for script in scripts:
            found = self.resolve_call(script, "", handler)
            if found:
                break
        if not found:
            found = self._resolve_global("", handler)
        self._handler_cache[key] = found
        return found

    # ── 常量 / URL 解析 ────────────────────────────────────────
    @staticmethod
    def _is_prefix_ref(ref):
        if ref in _PREFIX_VARS:
            return True
        return ref.rsplit(".", 1)[-1] in _PREFIX_VARS

    @staticmethod
    def scope_constants(consts, owner):
        """同一作用域内的全部同名常量：一个函数里的多次赋值代表运行时可选取值。"""
        scope = owner
        while scope:
            hits = [con for con in consts if con.get("owner") == scope]
            if hits:
                return hits
            scope = scope.rsplit(".", 1)[0] if "." in scope else ""
        return [con for con in consts if con.get("owner") in ("", "__top_level__")][:1]

    def _find_constant(self, file, key, allowed_files=None):
        """常量回填：同文件优先，跨文件只认限定名（UrlList.xxx），避免裸变量串味。"""
        consts = self.constants_by_file.get(file, {}).get(key)
        if consts:
            return file, consts
        if "." not in key or not allowed_files:
            return None, None
        for other in allowed_files:
            if other == file:
                continue
            consts = self.constants_by_file.get(other, {}).get(key)
            if consts:
                return other, consts
        return None, None

    def resolve_term_variants(self, file, terms, owner="", depth=0, seen=None,
                              allowed_files=None, module_hint=""):
        """把词项解析成所有可能的 URL 取值。

        与只取一条路径的旧逻辑相比，两类并列关系会展开成多个变体：
        - 三元分支无法按页面模块收敛（comoe/exam 的 `PAAdmType=="I"?ipcare:opcare`）；
        - 同一作用域内同名变量多次赋值（`switchMainSrc` 里的 LinkUrl）。
        同一条件（cond）在多处三元出现时收敛到同一分支，避免拼出 ipcare+Opcare 这类
        运行时不可能的组合。
        """
        variants = self._expand_terms(file, terms, owner, depth, seen,
                                      allowed_files, module_hint, {})
        out = []
        for value, _assign in variants:
            if value and value not in out:
                out.append(value)
        return out[:MAX_URL_VARIANTS]

    def _expand_terms(self, file, terms, owner, depth, seen, allowed_files,
                      module_hint, assign):
        """返回 [(值, 三元分支选择)]；assign 记录已确定的 `<条件> → 分支下标`。"""
        if depth > 6:
            return [("", dict(assign))]
        if seen is None:
            seen = set()
        variants = [("", dict(assign))]
        for term in terms or []:
            merged = []
            for prefix, current in variants:
                for value, update in self._term_options(
                        file, term, owner, depth, seen, allowed_files, module_hint, current):
                    next_assign = dict(current)
                    next_assign.update(update)
                    merged.append((prefix + value, next_assign))
            if merged:
                variants = merged[:MAX_URL_VARIANTS]
        return variants

    def _term_options(self, file, term, owner, depth, seen, allowed_files,
                      module_hint, assign):
        kind = term.get("t")
        value = term.get("v", "")
        if kind == "s":
            return [(value, {})]
        if kind == "x":
            # 等长三元分支：同一条件已选过分支就直接复用；否则按页面模块择一，模块无法判定时全部保留
            branches = term.get("v") or []
            cond = term.get("cond", "")
            idxs = list(range(len(branches)))
            if cond and cond in assign and assign[cond] < len(branches):
                idxs = [assign[cond]]
            elif module_hint:
                hits = [i for i, b in enumerate(branches) if any(
                    isinstance(t.get("v"), str) and module_hint.lower() in t.get("v", "").lower()
                    for t in b if t.get("t") == "s")]
                if len(hits) == 1:
                    idxs = hits
            out = []
            for i in idxs:
                update = {cond: i} if cond else {}
                for val, inner in self._expand_terms(
                        file, branches[i], owner, depth + 1, seen,
                        allowed_files, module_hint, {**assign, **update}):
                    if val:
                        out.append((val, {**inner, **update}))
            return out
        if kind != "r":
            # 未解析的表达式（方法调用、三元等）只有在自带路径字面量时才贡献路径
            if _CALL_VAR_RE.match(value) and self._is_prefix_ref(value.split("(", 1)[0]):
                return []
            if "/" in value and _PATH_CHARS_RE.fullmatch(value):
                return [(value, {})]
            return []
        ref = value
        # 先按同文件常量回填：appPath 等既可能是模块内 URL 基址，也可能是跨文件前缀；
        # 真解析不出的裸引用会在下面被丢弃，不必提前按名字判前缀。
        key = ref
        if ref.startswith("this."):
            prefix = owner.rsplit(".", 1)[0] if "." in owner else ""
            if prefix:
                key = prefix + ref[4:]
        con_file, consts = self._find_constant(file, key, allowed_files)
        if not consts or (con_file, key) in seen:
            # 运行时前缀（menuWin.baseAppPath 等）解析不出，但不影响后续字面量拼接
            if self._is_prefix_ref(ref):
                self.dropped_prefixes.add(ref)
            return []
        out = []
        for con in self.scope_constants(consts, owner):
            for val, inner in self._expand_terms(
                    con_file, con.get("terms"), owner, depth + 1,
                    seen | {(con_file, key)}, allowed_files, module_hint, assign):
                if val and (val, tuple(sorted(inner.items()))) not in out:
                    out.append((val, inner))
        return out

    @staticmethod
    def url_path(resolved, raw):
        # 只用回填结果；未解析时 raw 是拼接表达式（如 menuWin.baseAppPath+url），不是接口路径
        text = (resolved or "").strip().strip("'\"` ")
        if "://" in text:
            try:
                text = urlsplit(text).path or text
            except ValueError:
                pass
        text = text.split("?", 1)[0].split("#", 1)[0]
        text = text.replace("\\", "/")
        while text.startswith("../") or text.startswith("./"):
            text = text[3:] if text.startswith("../") else text[2:]
        if not text.startswith("/") and re.match(r"^[A-Za-z_$][\w$]*/", text) is None:
            runs = _URL_RUN_RE.findall(text)
            if runs:
                best = max(runs, key=len)
                if "/" in best and len(best) >= 3:
                    text = best
        text = text.lstrip("/")
        # 纯变量名/点路径说明 URL 常量未解析，不把 "url" 这类占位当接口路径
        if text and "/" not in text and re.match(r"^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$", text):
            return ""
        # 超长或含代码字符的串说明常量跨语句误拼，不是接口路径
        if len(text) > 300 or (text and not _PATH_CHARS_RE.fullmatch(text)):
            return ""
        return text

    def request_record(self, fn, req, idx, allowed_files=None, module_hint=""):
        self.dropped_prefixes = set()
        variants = self.resolve_term_variants(fn["file"], req.get("url_terms"),
                                              fn["qualified"],
                                              allowed_files=allowed_files,
                                              module_hint=module_hint)
        paths = []
        for variant in variants:
            path = self.url_path(variant, req.get("url_expr", ""))
            if path and path not in paths:
                paths.append(path)
        return {
            "id": f"{fn['id']}#r{idx}",
            "method": req.get("method", "GET"),
            "wrapper": req.get("wrapper", ""),
            "url_expr": req.get("url_expr", ""),
            "url_prefix": ",".join(sorted(self.dropped_prefixes)),
            "url_resolved": next((v for v in variants if v), ""),
            "url_path": paths[0] if paths else "",
            "url_paths": paths,
            "param_keys": req.get("param_keys", []),
            "file": fn["file"],
            "function": fn["id"],
            "line": req.get("line", 0),
        }

    # ── 链路遍历 ────────────────────────────────────────────────
    def explore(self, start_id, allowed_files=None):
        """从函数出发收集请求与页面打开；同一请求/打开只保留首次到达的最短路径。

        按调用深度逐层展开（BFS）：主操作（如保存）通常由 handler 直接调用，
        深度优先会让前面分支的深层请求先占满配额，把主请求挤掉。
        """
        results = []
        opens = []
        seen_req = set()
        seen_open = set()
        seen_fn = {start_id}
        queue = deque([(start_id, [start_id])])
        while queue and len(results) < self.max_requests:
            fn_id, path = queue.popleft()
            fn = self.fn_by_id.get(fn_id)
            if not fn:
                continue
            for idx, req in enumerate(fn["requests"]):
                sig = (fn_id, idx)
                if sig in seen_req:
                    continue
                seen_req.add(sig)
                results.append((list(path), fn, req, idx))
                if len(results) >= self.max_requests:
                    break
            for idx, op in enumerate(fn.get("opens", [])):
                sig = (fn_id, idx)
                if sig in seen_open:
                    continue
                seen_open.add(sig)
                opens.append((list(path), fn, op, idx))
            if len(path) - 1 >= self.max_depth:
                continue
            for call in fn["calls"]:
                target = self.resolve_call(fn["file"], fn["qualified"], call["callee"],
                                           allowed_files, call.get("member", False))
                if not target or target in seen_fn or target not in self.fn_by_id:
                    continue
                seen_fn.add(target)
                queue.append((target, path + [target]))
        return results, opens

    def open_records(self, page_file, fn, op, page_set, allowed_files=None, module_hint=""):
        variants = self.resolve_term_variants(fn["file"], op.get("url_terms"),
                                              fn["qualified"],
                                              allowed_files=allowed_files,
                                              module_hint=module_hint)
        recs = []
        seen = set()
        for variant in variants or [""]:
            target, reason = classify_open_target(page_file, variant, page_set)
            sig = (target, reason)
            if sig in seen:
                continue
            seen.add(sig)
            recs.append({
                "page": target,
                "reason": reason,
                "url": variant.split("?", 1)[0].lstrip("./") if variant else "",
                "opener": op.get("opener", ""),
                "function": fn["id"],
                "line": op.get("line", 0),
            })
        return recs

    @staticmethod
    def count_open_miss(unresolved, reason):
        """未落地分类：runtime（无地址/运行时变量）/ non_page（Caché .csp、报表、接口）/ unresolved。"""
        unresolved["open_targets" if reason == "unresolved" else f"open_targets_{reason}"] += 1

    def _element_opens(self, page_file, element_key, opened, page_set, allowed_files,
                       module_hint, add_page_link, unresolved):
        links = []
        seen = set()
        for _path, fn, op, _idx in opened:
            recs = self.open_records(page_file, fn, op, page_set, allowed_files, module_hint)
            page_rec = next((r for r in recs if r["page"]), None)
            if not page_rec:
                if recs:
                    self.count_open_miss(unresolved, recs[0]["reason"])
                continue
            for rec in recs:
                if not rec["page"]:
                    continue
                sig = (rec["page"], rec["opener"], rec["function"])
                if sig in seen:
                    continue
                seen.add(sig)
                links.append({"page": rec["page"], "opener": rec["opener"],
                              "function": rec["function"], "line": rec["line"]})
                add_page_link(page_file, rec["page"],
                              "跳转" if rec["opener"] == "iframe_src" else "弹出",
                              "element",
                              element=element_key, function=rec["function"],
                              line=rec["line"], opener=rec["opener"], url=rec["url"])
        links.sort(key=lambda x: (x["page"], x["function"], x["line"]))
        return links

    # ── 主构建 ──────────────────────────────────────────────────
    def build(self, pages, elements, menu_snapshot, config_snapshot):
        self.load()
        page_menu = (menu_snapshot or {}).get("page_menu", {})
        buttons_by_bar = defaultdict(list)
        for btn in (menu_snapshot or {}).get("buttons", []):
            buttons_by_bar[btn["bar_code"]].append(btn)
        config_groups = (config_snapshot or {}).get("groups", {})
        if not config_groups:
            # 兼容 import_menu_snapshot.py 的旧按钮快照
            for bar_code, btns in buttons_by_bar.items():
                config_groups[f"doc_btnbar::{bar_code}"] = [
                    {"scenario": "doc_btnbar", "grp": bar_code, "code": b["code"],
                     "name": b.get("name", ""), "handler": b.get("handler", ""),
                     "display_handler": "", "url": b.get("url", ""),
                     "active": b.get("active") in ("", "1", None), "hosp_dr": "", "extra": ""}
                    for b in btns
                ]
        config_stats = defaultdict(int)

        page_map = {p["file"]: p for p in pages if "file" in p and "error" not in p and "skipped" not in p}
        page_set = frozenset(page_map)
        page_links = {}
        link_stats = defaultdict(int)
        page_out_links = defaultdict(int)

        def add_page_link(src, dst, kind, source, element="", function="", line=0,
                          opener="", url=""):
            """界面 → 界面边：内嵌(frame) / 配置跳转(config) / 弹窗(element|page_load)。"""
            if not src or not dst or src == dst or dst not in page_set:
                return
            key = (src, dst, kind, source, element)
            if key in page_links:
                return
            rec = {"from": src, "to": dst, "type": kind, "source": source}
            if element:
                rec["element"] = element
            if function:
                rec["function"] = function
            if line:
                rec["line"] = line
            if opener:
                rec["opener"] = opener
            if url:
                rec["url"] = url
            page_links[key] = rec
            link_stats[kind] += 1
            page_out_links[src] += 1

        frames_referenced = defaultdict(set)
        for page in page_map.values():
            for target in page.get("frames", []):
                frames_referenced[target].add(page["file"])
                add_page_link(page["file"], target, "内嵌", "frame")

        # csp-include 是服务端片段包含：片段的脚本与元素在父页面里同样生效
        include_map = {}
        for page_file, page in page_map.items():
            targets = [t for t in page.get("includes", [])
                       if t != page_file and t in page_set]
            if targets:
                include_map[page_file] = targets
        for page_file, targets in include_map.items():
            for target in targets:
                add_page_link(page_file, target, "包含", "csp-include")

        def included_pages(page_file):
            """片段闭包（深度 ≤3，环引用去重），保持文档中出现顺序。"""
            out, seen = [], {page_file}
            queue = [(page_file, 0)]
            while queue:
                current, depth = queue.pop(0)
                if depth >= 3:
                    continue
                for target in include_map.get(current, []):
                    if target in seen:
                        continue
                    seen.add(target)
                    out.append(target)
                    queue.append((target, depth + 1))
            return out

        effective_scripts_cache = {}

        def effective_scripts(page_file):
            """父页面实际执行的脚本：自身脚本 + 片段脚本（去重保序）。"""
            if page_file not in effective_scripts_cache:
                scripts = list(page_map[page_file].get("scripts", []))
                for frag in included_pages(page_file):
                    scripts.extend(page_map[frag].get("scripts", []))
                seen = set()
                uniq = []
                for script in scripts:
                    if script and script not in seen:
                        seen.add(script)
                        uniq.append(script)
                effective_scripts_cache[page_file] = tuple(uniq)
            return effective_scripts_cache[page_file]

        elements_by_page = defaultdict(list)
        for elem in elements:
            elements_by_page[elem["page"]].append(elem)

        out_pages = {}
        out_elements = {}
        out_functions = {}
        out_requests = {}
        chains = []
        reachable = set()
        unresolved = defaultdict(int)
        total_actionable = 0
        resolved_handlers = 0

        page_bindings = {}
        page_inline = {}
        page_config_calls = {}
        for page_file, page in page_map.items():
            bind_map = defaultdict(list)
            inline_list = []
            config_calls = []
            for script in effective_scripts(page_file):
                for b in self.bindings_by_file.get(script, []):
                    bind_map[b["selector"]].append(b)
                inline_list.extend(self.inline_by_file.get(script, []))
                config_calls.extend(self.config_by_file.get(script, []))
            if not config_calls:
                # 旧索引只有 bar_bindings：按按钮栏场景兼容
                for script in effective_scripts(page_file):
                    for bar in self.bar_by_file.get(script, []):
                        config_calls.append({
                            "scenario": bar.get("scenario", "doc_btnbar"),
                            "group": bar.get("code", ""),
                            "line": bar.get("line", 0),
                            "form": "marybtnbar",
                        })
            page_bindings[page_file] = bind_map
            page_inline[page_file] = inline_list
            page_config_calls[page_file] = config_calls

        for page_file in sorted(page_map):
            page = page_map[page_file]
            bind_map = page_bindings[page_file]
            inline_list = page_inline[page_file]
            raw_elements = list(elements_by_page.get(page_file, []))
            for frag in included_pages(page_file):
                raw_elements.extend(elements_by_page.get(frag, []))
            page_scripts = effective_scripts(page_file)

            seen_sig = set()
            actionable = []
            for elem in raw_elements:
                elem_id = elem.get("id", "")
                handler = _handler_ident(elem.get("handler", ""))
                source = "inline" if handler else ""
                if not handler and elem_id:
                    found = bind_map.get("#" + elem_id)
                    if found:
                        # 后加载的脚本覆盖先前的绑定
                        handler = _handler_ident(found[-1].get("handler", ""))
                        source = "js_binding"
                event = elem.get("event", "click")
                sig = (elem_id, event, handler)
                if sig in seen_sig:
                    continue
                seen_sig.add(sig)
                if not handler:
                    continue
                if _is_nav(handler):
                    source = "navigation"
                key = self.element_key(page_file, elem_id, event, elem.get("line", 0))
                rec = {
                    "key": key,
                    "page": page_file,
                    "tag": elem.get("tag", ""),
                    "id": elem_id,
                    "label": elem.get("label", ""),
                    "event": event,
                    "handler": handler,
                    "handler_source": source,
                    "line": elem.get("line", 0),
                }
                if elem.get("page") and elem["page"] != page_file:
                    rec["origin_page"] = elem["page"]
                actionable.append(rec)

            # JS 字符串拼出的操作元素（按页面脚本归属）
            for idx, inline in enumerate(inline_list[:300]):
                handler = _handler_ident(inline.get("handler", ""))
                if not handler or _is_nav(handler):
                    continue
                key = f"{page_file}#__jsstr_{inline.get('line', 0)}_{idx}"
                if key in seen_sig:
                    continue
                seen_sig.add(key)
                actionable.append({
                    "key": key,
                    "page": page_file,
                    "tag": inline.get("tag", "a"),
                    "id": "",
                    "label": inline.get("label", ""),
                    "event": inline.get("event", "click"),
                    "handler": handler,
                    "handler_source": "js_string",
                    "line": inline.get("line", 0),
                })

            # JS 构造的 datagrid 工具栏按钮（toolbar 数组）
            toolbar_items = []
            for script in effective_scripts(page_file):
                toolbar_items.extend(self.toolbar_by_file.get(script, []))
            for idx, tb in enumerate(toolbar_items[:60]):
                handler = _handler_ident(tb.get("handler", ""))
                if not handler or _is_nav(handler):
                    continue
                key = f"{page_file}#__toolbar_{tb.get('line', 0)}_{idx}"
                if key in seen_sig:
                    continue
                seen_sig.add(key)
                actionable.append({
                    "key": key,
                    "page": page_file,
                    "tag": "a",
                    "id": "",
                    "label": tb.get("label", ""),
                    "event": "click",
                    "handler": handler,
                    "handler_source": "js_toolbar",
                    "line": tb.get("line", 0),
                })

            # 服务端配置注入：按钮栏 / 右键菜单 / 执行单按钮
            seen_config_groups = set()
            for call in page_config_calls.get(page_file, []):
                scenario = call.get("scenario", "")
                if not scenario or scenario in NO_MERGE_SCENARIOS:
                    if scenario not in NO_MERGE_SCENARIOS:
                        config_stats["unresolved_calls"] += 1
                    continue
                raw_expr = call.get("raw", "")
                if scenario in DYNAMIC_SCENARIOS:
                    # 分组键是运行时变量（当前单据/院区），该页面承载该场景全部配置
                    prefix = scenario + "::"
                    groups = [key[len(prefix):] for key in config_groups if key.startswith(prefix)]
                elif call.get("groups"):
                    # 本地渲染函数按类型实参映射到多个 menu_type
                    groups = list(call["groups"])
                elif call.get("group"):
                    groups = [call["group"]]
                elif raw_expr.startswith("attr:"):
                    # 分组键来自 DOM 属性（如 <div id="btnList1" barurl="...">）
                    attr_name = raw_expr.split(":", 1)[1].lower()
                    groups = sorted({(elem.get("config_attrs") or {}).get(attr_name, "")
                                     for elem in raw_elements} - {""})
                else:
                    groups = []
                if not groups:
                    config_stats["unresolved_calls"] += 1
                    continue
                for grp in groups:
                    if (scenario, grp) in seen_config_groups:
                        continue
                    seen_config_groups.add((scenario, grp))
                    config_stats["bound_groups"] += 1
                    rows = config_groups.get(f"{scenario}::{grp}", [])
                    if not rows:
                        config_stats["missing_groups"] += 1
                        continue
                    for btn in rows:
                        if not btn.get("active", True):
                            continue
                        handler = _handler_ident(btn.get("handler", ""))
                        nav_url = btn.get("url", "")
                        if not handler and not nav_url:
                            continue
                        key = self.element_key(page_file, btn.get("code", ""), "click", 0)
                        if key in seen_sig:
                            continue
                        seen_sig.add(key)
                        elem = {
                            "key": key,
                            "page": page_file,
                            "tag": "a",
                            "id": btn.get("code", ""),
                            "label": btn.get("name", ""),
                            "event": "click",
                            "handler": handler,
                            "handler_source": "config_bar" if scenario == "doc_btnbar"
                            else f"config:{scenario}",
                            "line": 0,
                            "scenario": scenario,
                            "group": grp,
                        }
                        config_stats["items"] += 1
                        if nav_url and not handler:
                            target = resolve_page_target(page_file, nav_url, page_set)
                            elem["nav_url"] = nav_url
                            if target:
                                elem["nav_target"] = target
                                config_stats["nav_links"] += 1
                                add_page_link(page_file, target, "跳转", "config",
                                              element=key, url=nav_url)
                            config_stats["nav_items"] += 1
                        actionable.append(elem)

            page_chains = 0
            page_req_ids = set()
            total_actionable += len(actionable)
            for elem in actionable:
                if not elem.get("handler"):
                    # 配置项只配置了跳转地址（如菜单/页面按钮），不产生接口链路
                    out_elements[elem["key"]] = {k: v for k, v in elem.items() if k != "key"} | {
                        "requests": [], "chain_count": 0}
                    continue
                fn_id = self.resolve_handler(page_scripts, elem["handler"])
                if not fn_id or fn_id not in self.fn_by_id:
                    unresolved["handlers"] += 1
                    elem["handler_fn"] = ""
                    out_elements[elem["key"]] = {k: v for k, v in elem.items() if k != "key"} | {
                        "requests": [], "chain_count": 0}
                    continue
                resolved_handlers += 1
                elem["handler_fn"] = fn_id
                reachable.add(fn_id)
                found, opened = self.explore(fn_id, page_scripts)
                chain_reqs = []
                for path, fn, req, idx in found:
                    reachable.update(path)
                    rec = self.request_record(fn, req, idx, page_scripts, page_file.split("/")[0])
                    if not rec["url_path"]:
                        unresolved["urls"] += 1
                        continue
                    out_requests[rec["id"]] = rec
                    page_req_ids.add(rec["id"])
                    chain_reqs.append({"id": rec["id"], "method": rec["method"],
                                       "url_path": rec["url_path"],
                                       "url_paths": rec["url_paths"]})
                    chains.append({
                        "page": page_file,
                        "element": elem["key"],
                        "label": elem.get("label", ""),
                        "event": elem["event"],
                        "source": elem["handler_source"],
                        "path": [{"function": fid,
                                  "name": self.fn_by_id[fid]["name"],
                                  "file": self.fn_by_id[fid]["file"],
                                  "line": self.fn_by_id[fid]["line"]} for fid in path],
                        "request": rec["id"],
                        "method": rec["method"],
                        "url_path": rec["url_path"],
                        "url_paths": rec["url_paths"],
                        "url_expr": rec["url_expr"],
                    })
                page_chains += len(chain_reqs)
                if opened:
                    elem["opens"] = self._element_opens(
                        page_file, elem["key"], opened, page_set, page_scripts,
                        page_file.split("/")[0], add_page_link, unresolved)
                out_elements[elem["key"]] = {k: v for k, v in elem.items() if k != "key"} | {
                    "requests": chain_reqs, "chain_count": len(chain_reqs)}

            # 页面加载：顶层脚本
            load_ids = []
            for script in effective_scripts(page_file):
                top = self.file_qualified.get(script, {}).get("__top_level__")
                if top:
                    load_ids.append(f"{script}::__top_level__")
            load_key = f"{page_file}#__page_load__"
            load_reqs = []
            for fn_id in load_ids:
                reachable.add(fn_id)
                load_found, load_opened = self.explore(fn_id, page_scripts)
                for path, fn, req, idx in load_found:
                    reachable.update(path)
                    rec = self.request_record(fn, req, idx, page_scripts, page_file.split("/")[0])
                    if not rec["url_path"]:
                        unresolved["urls"] += 1
                        continue
                    out_requests[rec["id"]] = rec
                    page_req_ids.add(rec["id"])
                    load_reqs.append({"id": rec["id"], "method": rec["method"],
                                      "url_path": rec["url_path"],
                                      "url_paths": rec["url_paths"]})
                    chains.append({
                        "page": page_file,
                        "element": load_key,
                        "label": "页面加载",
                        "event": "load",
                        "source": "page_load",
                        "path": [{"function": fid,
                                  "name": self.fn_by_id[fid]["name"],
                                  "file": self.fn_by_id[fid]["file"],
                                  "line": self.fn_by_id[fid]["line"]} for fid in path],
                        "request": rec["id"],
                        "method": rec["method"],
                        "url_path": rec["url_path"],
                        "url_paths": rec["url_paths"],
                        "url_expr": rec["url_expr"],
                    })
                for _path, fn, op, _idx in load_opened:
                    if fn["qualified"] == "__top_level__":
                        # IIFE/回调包装里的方法会挂到顶层，不能据此认定页面加载即弹窗
                        continue
                    recs = self.open_records(page_file, fn, op, page_set, page_scripts,
                                             page_file.split("/")[0])
                    if not any(r["page"] for r in recs):
                        if recs:
                            self.count_open_miss(unresolved, recs[0]["reason"])
                        continue
                    for rec in recs:
                        if not rec["page"]:
                            continue
                        add_page_link(page_file, rec["page"],
                                      "跳转" if rec["opener"] == "iframe_src" else "弹出",
                                      "page_load",
                                      element=load_key, function=rec["function"],
                                      line=rec["line"], opener=rec["opener"], url=rec["url"])
            page_chains += len(load_reqs)
            out_elements[load_key] = {
                "page": page_file, "tag": "", "id": "__page_load__", "label": "页面加载",
                "event": "load", "handler": "", "handler_source": "page_load", "line": 0,
                "requests": load_reqs, "chain_count": len(load_reqs)}

            menus = page_menu.get(page_file, [])
            role = self.page_role(page_file, page, menus, frames_referenced)
            out_pages[page_file] = {
                "title": page.get("title", ""),
                "comment_title": page.get("comment_title", ""),
                "module": page.get("module", ""),
                "role": role,
                "menus": menus,
                "frames": page.get("frames", []),
                "includes": page.get("includes", []),
                "scripts": len(effective_scripts(page_file)),
                "element_count": len(raw_elements),
                "actionable_count": len(actionable),
                "chain_count": page_chains,
                "request_count": len(page_req_ids),
                "link_count": page_out_links.get(page_file, 0),
            }

        # 可达函数子图
        for fn_id in sorted(reachable):
            fn = self.fn_by_id.get(fn_id)
            if not fn:
                continue
            calls = []
            for call in fn["calls"]:
                target = self.resolve_call(fn["file"], fn["qualified"], call["callee"],
                                           member=call.get("member", False))
                if not target:
                    unresolved["callees"] += 1
                    continue
                if target in reachable:
                    calls.append({"target": target, "line": call.get("line", 0)})
            reason = utility_reason(fn["file"], fn["name"])
            out_functions[fn_id] = {
                "file": fn["file"], "qualified": fn["qualified"], "name": fn["name"],
                "kind": fn["kind"], "parent": fn.get("parent", ""), "line": fn["line"],
                "category": "utility" if reason else "business",
                "calls": calls,
                "requests": [f"{fn_id}#r{i}" for i in range(len(fn["requests"]))],
            }
            if reason:
                out_functions[fn_id]["utility_rule"] = reason

        chains.sort(key=lambda c: (c["page"], c["element"], c["request"]))
        for el in out_elements.values():
            el["requests"].sort(key=lambda r: r["id"])

        stats = self.stats(page_map, elements, chains, out_functions, out_requests,
                           unresolved, total_actionable, resolved_handlers, config_stats)
        stats["page_links"] = len(page_links)
        stats["page_links_popup"] = link_stats.get("弹出", 0)
        stats["page_links_config"] = link_stats.get("跳转", 0)
        stats["page_links_frame"] = link_stats.get("内嵌", 0)
        stats["page_links_include"] = link_stats.get("包含", 0)
        stats["unresolved_open_targets"] = unresolved.get("open_targets", 0)
        stats["open_targets_runtime"] = unresolved.get("open_targets_runtime", 0)
        stats["open_targets_non_page"] = unresolved.get("open_targets_non_page", 0)
        page_link_list = sorted(
            page_links.values(),
            key=lambda r: (r["from"], r["to"], r["type"], r["source"], r.get("element", "")))
        db = {
            "meta": {
                "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
                "front_root": FRONT_ROOT_REL,
                "menu_source": (menu_snapshot or {}).get("source", ""),
                "counts": {k: v for k, v in stats.items() if isinstance(v, int)},
            },
            "pages": out_pages,
            "elements": out_elements,
            "functions": out_functions,
            "requests": out_requests,
            "chains": chains,
            "page_links": page_link_list,
        }
        return db, stats

    @staticmethod
    def element_key(page_file, elem_id, event, line):
        if elem_id:
            return f"{page_file}#{elem_id}"
        return f"{page_file}#__inline_{line}_{event}"

    @staticmethod
    def page_role(page_file, page, menus, frames_referenced):
        if menus:
            return "menu_page"
        if page_file in frames_referenced:
            return "embedded_page"
        name = page_file.rsplit("/", 1)[-1].lower()
        if page_file.startswith("base/"):
            return "component"
        if ".show." in name or ".hui." in name or name.endswith(".show.html"):
            return "sub_page"
        return "unclassified"

    def stats(self, page_map, elements, chains, functions, requests, unresolved,
              actionable, resolved_handlers, config_stats=None):
        utility_ids = {fid for fid, fn in functions.items() if fn.get("category") == "utility"}
        chain_fns = {node["function"] for chain in chains for node in chain["path"]}
        config_stats = config_stats or {}
        return {
            "pages": len(page_map),
            "elements_html": len(elements),
            "elements_actionable": actionable,
            "handlers_resolved": resolved_handlers,
            "functions_total": len(self.fn_by_id),
            "functions_reachable": len(functions),
            "utility_functions": len(utility_ids),
            "utility_chain_nodes": len(chain_fns & utility_ids),
            "requests": len(requests),
            "chains": len(chains),
            "config_groups_bound": config_stats.get("bound_groups", 0),
            "config_groups_missing": config_stats.get("missing_groups", 0),
            "config_items": config_stats.get("items", 0),
            "config_nav_items": config_stats.get("nav_items", 0),
            "config_nav_links": config_stats.get("nav_links", 0),
            "config_unresolved_calls": config_stats.get("unresolved_calls", 0),
            "unresolved_handlers": unresolved.get("handlers", 0),
            "unresolved_urls": unresolved.get("urls", 0),
            "unresolved_callees": unresolved.get("callees", 0),
            "skipped_js": sum(1 for r in _read_jsonl(JS_INDEX_FILE) if "skipped" in r or "error" in r),
        }


def _write_jsonl(path, records):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            f.write("\n")
    tmp.replace(path)


def _write_graphml(db):
    """节点=界面 / JS 方法 / HTTP 请求；边=页面引用与「界面 → 方法 → 请求」链路。

    工具类方法（config.utility_reason 判定）不进图，链路按剩余业务方法重连；
    整条链路都是工具方法时退化为「界面 → 请求」。
    """
    def esc(value):
        return (str(value).replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))

    pages = db["pages"]
    functions = db["functions"]
    requests = db["requests"]

    def is_utility(fn_id):
        return functions.get(fn_id, {}).get("category") == "utility"

    methods_by_page = defaultdict(dict)
    urls_by_page = defaultdict(set)
    chain_count = defaultdict(int)
    req_node = {}
    for chain in db["chains"]:
        page = chain["page"]
        rec = requests.get(chain["request"])
        if not rec or not rec.get("url_path"):
            continue
        chain_count[page] += 1
        # 工具类方法不进图；页面属性也只列业务方法，避免被框架方法淹没
        for node in chain["path"]:
            if not is_utility(node["function"]):
                methods_by_page[page][node["name"]] = node["function"]
        urls_by_page[page].add(rec["method"] + " " + rec["url_path"])
        # 同一接口地址只建一个节点，避免每个调用点复制一份
        req_node[chain["request"]] = "req:" + rec["method"] + " " + rec["url_path"]

    edges = set()
    relation = {}
    used_fns = set()
    used_reqs = set()
    for chain in db["chains"]:
        rid = req_node.get(chain["request"])
        if not rid:
            continue
        used_reqs.add(rid)
        path = [node["function"] for node in chain["path"] if not is_utility(node["function"])]
        if not path:
            # 整条链路都是工具方法时保留「界面 → 请求」，不断开可达性
            edges.add((chain["page"], rid))
            relation.setdefault((chain["page"], rid), "请求")
            continue
        used_fns.update(path)
        edges.add((chain["page"], "fn:" + path[0]))
        relation.setdefault((chain["page"], "fn:" + path[0]), "操作")
        for a, b in zip(path, path[1:]):
            edges.add(("fn:" + a, "fn:" + b))
            relation.setdefault(("fn:" + a, "fn:" + b), "调用")
        edges.add(("fn:" + path[-1], rid))
        relation.setdefault(("fn:" + path[-1], rid), "请求")
    # 界面 → 界面：内嵌 iframe、配置跳转、按钮/页面加载弹出的界面
    link_edges = 0
    for link in db.get("page_links", []):
        src, dst = link["from"], link["to"]
        if src not in pages or dst not in pages or src == dst:
            continue
        edges.add((src, dst))
        relation.setdefault((src, dst), link.get("type", ""))
        link_edges += 1

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
             '<key id="label" for="node" attr.name="label" attr.type="string"/>',
             '<key id="type" for="node" attr.name="类型" attr.type="string"/>',
             '<key id="page" for="node" attr.name="界面" attr.type="string"/>',
             '<key id="title" for="node" attr.name="标题" attr.type="string"/>',
             '<key id="module" for="node" attr.name="模块" attr.type="string"/>',
             '<key id="role" for="node" attr.name="页面角色" attr.type="string"/>',
             '<key id="menus" for="node" attr.name="菜单" attr.type="string"/>',
             '<key id="methods" for="node" attr.name="JS方法" attr.type="string"/>',
             '<key id="urls" for="node" attr.name="HTTP请求地址" attr.type="string"/>',
             '<key id="chains" for="node" attr.name="链路数" attr.type="int"/>',
             '<key id="file" for="node" attr.name="文件" attr.type="string"/>',
             '<key id="qualified" for="node" attr.name="限定名" attr.type="string"/>',
             '<key id="line" for="node" attr.name="行号" attr.type="int"/>',
             '<key id="method" for="node" attr.name="HTTP方法" attr.type="string"/>',
             '<key id="relation" for="edge" attr.name="关系" attr.type="string"/>',
             '<graph id="front" edgedefault="directed">']
    for page, meta in sorted(pages.items()):
        title = meta.get("title") or meta.get("comment_title") or page
        # 方法属性保留限定名便于回查源码；同页去重后按名称排序
        methods = sorted(methods_by_page.get(page, {}).values())
        urls = sorted(urls_by_page.get(page, {}))
        lines.append(
            f'<node id="{esc(page)}">'
            f'<data key="label">{esc(title)}</data>'
            f'<data key="type">界面</data>'
            f'<data key="page">{esc(page)}</data>'
            f'<data key="title">{esc(meta.get("title", ""))}</data>'
            f'<data key="module">{esc(meta.get("module", ""))}</data>'
            f'<data key="role">{esc(meta.get("role", ""))}</data>'
            f'<data key="menus">{esc(" | ".join(meta.get("menus", [])))}</data>'
            f'<data key="methods">{esc(" | ".join(methods))}</data>'
            f'<data key="urls">{esc(" | ".join(urls))}</data>'
            f'<data key="chains">{chain_count.get(page, 0)}</data>'
            f'</node>')

    for fn_id in sorted(used_fns):
        fn = functions.get(fn_id, {})
        lines.append(
            f'<node id="{esc("fn:" + fn_id)}">'
            f'<data key="label">{esc(fn.get("name") or fn_id)}</data>'
            f'<data key="type">JS方法</data>'
            f'<data key="file">{esc(fn.get("file", ""))}</data>'
            f'<data key="qualified">{esc(fn.get("qualified", ""))}</data>'
            f'<data key="line">{int(fn.get("line", 0) or 0)}</data>'
            f'</node>')

    for rid in sorted(used_reqs):
        method, _, url_path = rid[4:].partition(" ")
        lines.append(
            f'<node id="{esc(rid)}">'
            f'<data key="label">{esc(method + " " + url_path)}</data>'
            f'<data key="type">HTTP请求</data>'
            f'<data key="method">{esc(method)}</data>'
            f'<data key="urls">{esc(url_path)}</data>'
            f'</node>')

    for src, dst in sorted(edges):
        rel = relation.get((src, dst), "")
        data = f'<data key="relation">{esc(rel)}</data>' if rel else ""
        lines.append(f'<edge source="{esc(src)}" target="{esc(dst)}">{data}</edge>')
    lines += ["</graph>", "</graphml>"]
    GRAPHML_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    utility = sum(1 for fn in functions.values() if fn.get("category") == "utility")
    print(f"  → {GRAPHML_FILE} ({len(pages)} 界面 / {len(used_fns)} JS方法 / "
          f"{len(used_reqs)} HTTP请求节点 / {len(edges)} 边（界面→界面 {link_edges}）；"
          f"已剔除 {utility} 个工具类方法)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graphml", action="store_true", help="额外导出 GraphML")
    parser.add_argument("--max-depth", type=int, default=MAX_DEPTH)
    parser.add_argument("--max-requests", type=int, default=MAX_REQUESTS)
    args = parser.parse_args()

    pages = _read_jsonl(PAGES_FILE)
    elements = _read_jsonl(ELEMENTS_FILE)
    menu_snapshot = None
    if MENU_SNAPSHOT_FILE.exists():
        menu_snapshot = json.loads(MENU_SNAPSHOT_FILE.read_text(encoding="utf-8"))
    config_snapshot = None
    if CONFIG_INJECTION_FILE.exists():
        config_snapshot = json.loads(CONFIG_INJECTION_FILE.read_text(encoding="utf-8"))
    config_groups = len((config_snapshot or {}).get("groups", {}))
    print(f"载入页面 {len(pages)} / 元素 {len(elements)} / 菜单快照 "
          f"{'有' if menu_snapshot else '无'} / 配置注入 "
          f"{f'{config_groups} 组' if config_snapshot else '无'}")

    builder = ChainBuilder(args.max_depth, args.max_requests)
    db, stats = builder.build(pages, elements, menu_snapshot, config_snapshot)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(db, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    tmp = DB_FILE.with_suffix(".json.tmp")
    tmp.write_text(text + "\n", encoding="utf-8")
    tmp.replace(DB_FILE)
    _write_jsonl(CHAINS_FILE, db["chains"])
    STATS_FILE.write_text(json.dumps(stats, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
                          encoding="utf-8")
    if args.graphml:
        _write_graphml(db)

    print("完成: " + " / ".join(f"{k}={v}" for k, v in stats.items()))
    print(f"  → {DB_FILE} ({len(text) / 1024 / 1024:.1f} MB)")
    print(f"  → {CHAINS_FILE}")


if __name__ == "__main__":
    main()
