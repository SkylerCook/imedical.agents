#!/usr/bin/env python3
"""前后端链路衔接查询：HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller。

数据源：
- docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json（前端链路库）
- docs/agents/imedicalxc-doctor-codegraph/controller_endpoints.json（Controller 注解
  → URL 映射，由 scan_controller_endpoints.py 在构建期生成）

用法:
    python query_front_back_chain.py stats
    python query_front_back_chain.py page <页面片段>
    python query_front_back_chain.py element <元素 id / 文案片段>
    python query_front_back_chain.py url <URL 片段>
    python query_front_back_chain.py controller <Controller 名片段>
    python query_front_back_chain.py method <Controller.方法片段>
    python query_front_back_chain.py impact <impact.json>   # impact_analyzer --impact --json
    python query_front_back_chain.py commit-impact <code-impact.json> --label <label>

可选: --limit N（默认 20）, --detail（逐条展开多行）, --json
     --refresh-endpoints（重建 Controller 注解索引，默认直接读构建产物）
     commit-impact: --label / --output / --max-ui-entries / --ancestor-depth / --registry

page / element / url 输出全部链路；工作区没有对应 Controller 的条目保留并标注
「(工作区外: URL 首段)」，stats 的覆盖率只统计命中工作区 Controller 的链路。
url / method 查不到前端链路时，回退输出注解声明的后端端点并标注「无前端链路」。

commit-impact 消费周报的 code-impact-<label>.json，把每个提交的 entrypoints 反查成
「界面 HTML + 页面标题 + 操作元素 + 请求 + 后端方法」，并用 docs/knowledge/前端界面入口登记
的菜单登记补充父菜单路径；页面本身未登记时，沿 page_links 上溯到打开的父页面。
"""
import argparse
import json
import re
import sys
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import WORKSPACE_ROOT
from front.config import DB_FILE as FRONT_DB_FILE, FRONT_ROOT
from front.config import SERVICE_SEG_PREFIXES, norm_controller_seg
import scan_controller_endpoints as endpoints_index

ENDPOINT_FILE = endpoints_index.ENDPOINT_FILE
MAVEN_ENDPOINT_FILE = ENDPOINT_FILE.parent / "maven_controller_endpoints.json"
_maven_endpoint_cache = None
_maven_index_cache = None


def load_maven_index():
    """Maven 工件端点索引原文；缺失返回 None。"""
    global _maven_index_cache
    if _maven_index_cache is None:
        try:
            _maven_index_cache = json.loads(MAVEN_ENDPOINT_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _maven_index_cache = {}
    return _maven_index_cache or None


def load_maven_endpoints():
    """(Controller 全名, 方法名) → [{http, path}]；Maven 工件由 Step 3 生成，缺失时为空。"""
    global _maven_endpoint_cache
    if _maven_endpoint_cache is not None:
        return _maven_endpoint_cache
    index = defaultdict(list)
    try:
        data = json.loads(MAVEN_ENDPOINT_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        _maven_endpoint_cache = index
        return index
    for items in data.get("endpoints", {}).values():
        for ep in items:
            index[(ep["controller_fqn"], ep["method"])].append(ep)
    _maven_endpoint_cache = index
    return index


def load_index(refresh=False):
    """默认直接读构建产物；缺失、损坏或 --refresh-endpoints 时才扫描源码。"""
    if not refresh:
        cached = endpoints_index.load()
        if cached:
            return cached, False
    index = endpoints_index.scan()
    endpoints_index.save(index)
    return index, True


def _norm_controller_seg(seg):
    """前端常用相对 URL（appPath 运行期才拼），控制器段缺少服务前缀。"""
    return norm_controller_seg(seg)


def _prefer_page_service(candidates, page):
    """同一相对 URL 在 opcare/ipcare 都有实现时，按页面所属服务收敛。"""
    svc = (page or "").split("/", 1)[0].lower()
    if svc not in SERVICE_SEG_PREFIXES:
        return candidates
    picked = [b for b in candidates if svc in b["controller_fqn"].lower().split(".")]
    return picked or candidates


def build_seg_index(endpoints):
    """(控制器段去服务前缀, 方法段) → 端点列表；避免每条未命中 URL 全表扫描。"""
    index = defaultdict(list)
    for path, items in endpoints.items():
        ps = path.split("/")
        if len(ps) < 2:
            continue
        index[(_norm_controller_seg(ps[-2]), ps[-1])].extend(items)
    return index


def match_backend(endpoints, url, page="", seg_index=None):
    """精确匹配 → 整段后缀匹配 → 控制器段（去服务前缀）匹配。"""
    u = (url or "").strip("/").lower()
    if not u:
        return []
    if u in endpoints:
        return endpoints[u]
    segs = u.split("/")
    for i in range(1, len(segs)):
        suffix = "/".join(segs[i:])
        if suffix in endpoints:
            return endpoints[suffix]
    if len(segs) < 2:
        return []
    method, ctl = segs[-1], _norm_controller_seg(segs[-2])
    if seg_index is None:
        seg_index = build_seg_index(endpoints)
    candidates = seg_index.get((ctl, method), [])
    if not candidates:
        return []
    # 同一 Controller.方法 可能挂在多个 URL 上（数组映射/多服务），按方法去重
    seen, found = set(), []
    for item in candidates:
        key = (item["controller_fqn"], item["method"])
        if key not in seen:
            seen.add(key)
            found.append(item)
    return _prefer_page_service(found, page)


def load_front_db():
    if not FRONT_DB_FILE.exists():
        sys.exit(f"前端链路库不存在: {FRONT_DB_FILE}\n"
                 "请先运行 scripts/front/html_scan.py → js_scan.py → build_front_chain_db.py")
    return json.loads(FRONT_DB_FILE.read_text(encoding="utf-8"))


def request_paths(req):
    """一条请求可能对应多个 URL 变体（运行时分支二选一），旧库只有 url_path。"""
    paths = [p for p in (req.get("url_paths") or []) if p]
    if not paths and req.get("url_path"):
        paths = [req["url_path"]]
    return paths


def match_backend_all(endpoints, paths, page="", seg_index=None):
    out, seen = [], set()
    for path in paths:
        for item in match_backend(endpoints, path, page, seg_index):
            key = (item["controller_fqn"], item["method"], item["path"])
            if key not in seen:
                seen.add(key)
                out.append(item)
    return out


def chain_records(db, endpoints, seg_index=None):
    """展开为 (chain, request, backend 匹配列表)。"""
    if seg_index is None:
        seg_index = build_seg_index(endpoints)
    reqs = db["requests"]
    out = []
    for chain in db["chains"]:
        req = reqs.get(chain.get("request")) or {}
        out.append((chain, req,
                    match_backend_all(endpoints, request_paths(req), chain.get("page", ""),
                                      seg_index)))
    return out


ANONYMOUS_STEP_LABELS = {"handler": "匿名事件处理", "top_level": "页面顶层代码"}


def step_name(step, functions=None):
    """链路步骤的展示名。`__handler_N` / `__top_level__` 是扫描器的内部编号，
    源码里没有同名函数；这类步骤只保留真实文件与行号，名称留空由 kind 说明。"""
    name = (step.get("name") or "").strip()
    if name and not name.startswith("__"):
        return name, ("callback" if step.get("kind") == "callback" else "")
    func = (functions or {}).get(step.get("function") or "") or {}
    kind = func.get("kind") or ("handler" if name.startswith("__handler_") else "top_level")
    return "", kind


def js_path(chain, functions=None):
    parts = []
    for step in chain.get("path") or []:
        name, kind = step_name(step, functions)
        label = name or ANONYMOUS_STEP_LABELS.get(kind, "未命名")
        parts.append(f"{label} ({step['file'].split('/')[-1]}:{step.get('line', '')})")
    return " → ".join(parts)


def service_hint(url_path):
    """未匹配时用 URL 首段提示服务前缀，避免读者误以为链路缺失。"""
    segs = (url_path or "").strip("/").split("/")
    return segs[0] if segs and segs[0] else "未知服务"


# ---------------------------------------------------------------------------
# commit-impact：提交级入口 → 前端页面 → 菜单登记
# ---------------------------------------------------------------------------

REGISTRY_FILE = (WORKSPACE_ROOT / "docs" / "knowledge" / "前端界面入口登记"
                 / "界面入口登记表.md")
CONFIDENCE_RANK = {"menu": 0, "parent": 1, "none": 2}
SOURCE_RANK = {"inline": 0, "js_binding": 1, "config_bar": 2,
               "config:nurse_exec_button": 2, "js_toolbar": 3, "js_string": 4,
               "page_load": 9}


def _split_table_row(line):
    cells, buf, escaped = [], [], False
    for ch in line.strip().strip("|"):
        if escaped:
            buf.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == "|":
            cells.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    cells.append("".join(buf).strip())
    return cells


def _strip_code(value):
    value = value.strip()
    return value[1:-1] if value.startswith("`") and value.endswith("`") else value


def load_registry(path):
    """解析「前端界面入口登记表」的 Markdown 表格，返回 html -> 菜单行列表。

    只接受能在 `static/` 下找到文件的 HTML 行。`.csp` 是旧产品菜单里的页面名，
    前端仓库中不存在，不再按名称归并，避免菜单证据挂到不存在的页面上。
    该表由 build-front-registry.mjs 确定性生成，列固定为
    界面 HTML / 界面名称 / 父菜单路径 / 菜单管理模式 / 授权安全组。
    """
    rows = {}
    if not path or not Path(path).exists():
        return rows
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = _split_table_row(line)
        if len(cells) < 5:
            continue
        html = _strip_code(cells[0])
        if html in {"界面 HTML", "---", ""} or set(html) <= {"-"}:
            continue
        if html.lower().endswith(".csp") or not (FRONT_ROOT / html).is_file():
            continue
        row = {
            "name": cells[1],
            "parentPath": cells[2],
            "mode": cells[3],
            "groups": cells[4],
        }
        rows.setdefault(html, []).append(row)
    return rows


def incoming_page_links(db):
    out = defaultdict(list)
    for link in db.get("page_links") or []:
        to = (link.get("to") or "").strip()
        if to:
            out[to].append(link)
    return out


def element_labels(db):
    """页面元素 → 文案 / 事件 / 来源；elements 覆盖没有链路的配置按钮。"""
    labels = {}
    for key, item in (db.get("elements") or {}).items():
        labels[key] = {
            "label": item.get("label") or "",
            "event": item.get("event") or "",
            "source": item.get("handler_source") or "",
        }
    for chain in db.get("chains") or []:
        key = chain.get("element") or ""
        if key and key not in labels:
            labels[key] = {
                "label": chain.get("label") or "",
                "event": chain.get("event") or "",
                "source": chain.get("source") or "",
            }
    return labels


def access_for_page(page, registry, incoming, depth, labels=None):
    """页面 → 菜单访问位置。自身未登记时沿 page_links 上溯父页面。"""
    if page in registry:
        return {"confidence": "menu", "via": "html", "menus": registry[page], "parents": []}
    seen = {page}
    queue = deque([(page, 0)])
    parents = []
    while queue:
        current, level = queue.popleft()
        if level >= depth:
            continue
        for link in incoming.get(current, []):
            source = (link.get("from") or "").strip()
            if not source or source in seen:
                continue
            seen.add(source)
            element = link.get("element") or ""
            meta = (labels or {}).get(element) or {}
            item = {
                "page": source,
                "type": link.get("type") or "",
                "linkSource": link.get("source") or "",
                "element": element,
                "elementLabel": meta.get("label") or "",
                "elementEvent": meta.get("event") or "",
                "elementSource": meta.get("source") or "",
                "opener": link.get("opener") or "",
            }
            if source in registry:
                item["menus"] = registry[source]
                item["via"] = "html"
                parents.append(item)
            else:
                queue.append((source, level + 1))
    if parents:
        # 元素触发的入口优先于页面加载自动弹出的入口；同一父页面只保留一条。
        parents.sort(key=lambda p: (p["linkSource"] == "page_load", p["page"], p["element"]))
        unique = {}
        for item in parents:
            unique.setdefault(item["page"], item)
        return {"confidence": "parent", "via": "", "menus": [],
                "parents": list(unique.values())}
    return {"confidence": "none", "via": "", "menus": [], "parents": []}


def build_ui_entry(chain, req, backend, entry, db, registry, incoming, depth, labels):
    page = chain.get("page") or ""
    page_meta = (db.get("pages") or {}).get(page) or {}
    elem = chain.get("element") or ""
    elem_id = elem.split("#", 1)[-1]
    functions = db.get("functions") or {}
    js_steps = []
    for step in chain.get("path") or []:
        if not step.get("file") or not (FRONT_ROOT / step["file"]).is_file():
            continue
        name, kind = step_name(step, functions)
        js_steps.append({
            "name": name,
            "kind": kind,
            "file": step["file"],
            "line": step.get("line"),
        })
    return {
        "page": page,
        "pageTitle": page_meta.get("title") or "",
        "module": page_meta.get("module") or "",
        "source": chain.get("source") or "",
        "element": {
            "id": elem_id,
            "label": chain.get("label") or elem_id,
            "event": chain.get("event") or "",
        },
        "jsPath": js_steps,
        "request": {
            "method": req.get("method") or "",
            "paths": request_paths(req),
            "expr": req.get("url_expr") or "",
            "wrapper": req.get("wrapper") or "",
        },
        "backend": {
            "controller": backend.get("controller_fqn") or backend.get("controller") or "",
            "controllerShort": backend.get("controller") or "",
            "method": backend.get("method") or "",
            "http": backend.get("http") or "",
            "path": backend.get("path") or "",
            "file": backend.get("file") or "",
            "line": backend.get("line"),
            "source": backend.get("source") or "endpoint-index",
        },
        "entrypoint": {
            "controller": entry.get("controller") or "",
            "service": entry.get("service") or "",
            "http": entry.get("http") or "",
            "httpResolved": bool(entry.get("httpResolved")),
            "kind": entry.get("kind") or "",
            "heuristic": bool(entry.get("heuristic")),
        },
        "access": access_for_page(page, registry, incoming, depth, labels),
        "match": "controller",
    }


def _ui_preference(ui_entry):
    """同一组界面证据来自多个入口时的选优键（越小越贴合）。

    优先「入口服务与后端源码所在仓库一致」，其次「入口控制器与后端控制器同名」，
    最后「按 HTTP 路径命中」；末两项只做稳定兜底，不改变结论。
    """
    backend_file = (ui_entry["backend"].get("file") or "").replace("\\", "/").lower()
    service = (ui_entry["entrypoint"].get("service") or "").lower()
    controller = ui_entry["entrypoint"].get("controller") or ""
    entry_class = controller.rsplit(".", 1)[0] if "." in controller else ""
    return (
        0 if service and service in backend_file else 1,
        0 if entry_class and entry_class == (ui_entry["backend"].get("controllerShort") or "") else 1,
        0 if ui_entry.get("match") == "http" else 1,
        ui_entry["page"],
        ui_entry["element"]["id"],
    )


def _entry_key(entry):
    controller = (entry.get("controller") or "").strip()
    return controller if "." in controller else ""


def _entry_backend(entry):
    """URL 命中但端点索引未收录该服务时，用入口自带的类.方法作为后端证据。"""
    controller = (entry.get("controller") or "").strip()
    if "." not in controller:
        return None
    return {
        "controller": controller,
        "controller_fqn": "",
        "method": controller.rsplit(".", 1)[-1],
        "http": entry.get("http") or "",
        "path": "",
        "file": "",
        "source": "entrypoint",
    }


def _normalize_http(value):
    value = (value or "").strip()
    value = re.sub(r"^(?:GET|POST|PUT|DELETE|PATCH|ANY)\s+", "", value, flags=re.I)
    value = re.sub(r"\$\{[^}]*\}", "", value)
    return value.strip("/").lower()


def build_chain_index(records):
    index = defaultdict(list)
    for chain, req, backends in records:
        for backend in backends:
            index[f"{backend['controller']}.{backend['method']}"].append((chain, req, backend))
    return index


def build_method_index(endpoints):
    """(Controller 短名, 方法) → [(http, path)]；用于补全 code-impact 中 http 为空的入口。"""
    index = defaultdict(list)
    for path, items in endpoints.items():
        for item in items:
            controller = item.get("controller") or ""
            method = item.get("method") or ""
            if controller and method:
                index[(controller, method)].append((item.get("http") or "", path))
    return index


def _entry_http_candidates(entry, method_index):
    controller = (entry.get("controller") or "").strip()
    if "." not in controller:
        return []
    cls, method = controller.rsplit(".", 1)
    cls = cls.rsplit(".", 1)[-1]
    return [f"{http} {path}".strip() for http, path in method_index.get((cls, method), [])]


def build_http_index(records):
    index = defaultdict(list)
    for chain, req, backends in records:
        for path in request_paths(req):
            index[path.strip("/").lower()].append((chain, req, backends))
    return index


def _http_hits(http_index, entry):
    target = _normalize_http(entry.get("http"))
    if not target:
        return []
    hits = list(http_index.get(target) or [])
    if hits:
        return hits
    segs = target.split("/")
    for i in range(1, len(segs)):
        hits.extend(http_index.get("/".join(segs[i:])) or [])
    return hits


def _loose_key(value):
    """末两段（控制器段去服务前缀 + 方法）；只用于识别跨服务同名，不产生链路。"""
    segs = [s for s in _normalize_http(value).split("/") if s]
    if len(segs) < 2:
        return None
    return (_norm_controller_seg(segs[-2]), segs[-1])


def build_loose_index(records):
    index = defaultdict(set)
    for _chain, req, _backends in records:
        for path in request_paths(req):
            key = _loose_key(path)
            if key:
                index[key].add(path.strip("/").lower())
    return index


def _unmatched_reason(entry, loose_index, orphan_keys=None):
    """未命中原因，按优先级互斥归类；不改变匹配结果。"""
    controller = entry.get("controller") or ""
    if "ClientController" in controller.rsplit(".", 1)[0]:
        return "client-controller"
    if not (entry.get("http") or "").strip():
        return "feign-interface-mapping"
    # depth=-1 的兜底候选是方法名/类名关键词猜出来的控制器，与页面之间没有真实调用边
    if entry.get("indirect") and entry.get("heuristic") and entry.get("depth", -1) == -1:
        return "indirect-heuristic"
    key = _loose_key(entry.get("http"))
    if key and loose_index.get(key):
        return "cross-service-same-name"
    # 请求只出现在未被任何页面装载的脚本里（厂商接口层运行时注入），
    # 有前端调用代码但没有静态可达的页面元素
    if key and orphan_keys and f"{key[0]}/{key[1]}" in orphan_keys:
        return "front-orphan"
    return "no-front-call"


def cmd_commit_impact(records, index, db, args):
    impact_path = Path(args.keyword)
    if not impact_path.exists():
        sys.exit(f"提交取证文件不存在: {impact_path}")
    impact = json.loads(impact_path.read_text(encoding="utf-8"))
    registry = load_registry(args.registry)
    incoming = incoming_page_links(db)
    labels = element_labels(db)
    chain_index = build_chain_index(records)
    http_index = build_http_index(records)
    loose_index = build_loose_index(records)
    orphan_keys = set(db.get("orphan_request_keys") or ())
    method_index = build_method_index(index.get("endpoints") or {})

    out_commits = []
    totals = {"commits": 0, "commitsWithUi": 0, "entrypoints": 0,
              "matchedEntrypoints": 0, "unmatchedEntrypoints": 0,
              "unmatchedReasons": defaultdict(int)}
    unmatched_keys = set()
    page_conf = {}
    for commit in impact.get("commits") or []:
        totals["commits"] += 1
        entrypoints = commit.get("entrypoints") or []
        totals["entrypoints"] += len(entrypoints)
        ui_best, matched, unmatched = {}, set(), []
        for entry in entrypoints:
            key = _entry_key(entry)
            candidates = [entry]
            # code-impact 的入口可能缺少 http（仅控制器 + 方法），用端点索引按类.方法补全
            if not (entry.get("http") or "").strip():
                for http in _entry_http_candidates(entry, method_index):
                    item = dict(entry)
                    item["http"] = http
                    item["httpResolved"] = True
                    candidates.append(item)
            hits, resolved = [], entry
            for cand in candidates:
                hits = ([(*item, "controller") for item in chain_index.get(key, [])]
                        if key else [])
                if not hits:
                    for chain, req, backends in _http_hits(http_index, cand):
                        if backends:
                            hits.extend((chain, req, backend, "http") for backend in backends)
                        else:
                            # 外部服务（药房/护理/收费/医保等）的 Controller 不在工作区端点索引里，
                            # 但入口本身已给出类.方法与 URL，URL 命中即可作为界面证据
                            fallback = _entry_backend(cand)
                            if fallback:
                                hits.append((chain, req, fallback, "http"))
                if hits:
                    resolved = cand
                    break
            # 间接链路（Feign 调用方上溯）若只上溯到启发式入口（depth=-1 的兜底候选），
            # 页面与该 Feign 之间没有真实调用边，不能作为界面证据，只保留在取证入口里。
            # Step 5c 类型使用反查得到的入口虽然也是 heuristic+indirect，但有真实调用边（depth≥2），
            # URL 命中即页面可达，不能一并清空。
            if (hits and resolved.get("indirect") and resolved.get("heuristic")
                    and resolved.get("depth", -1) == -1):
                hits = []
            entry = resolved
            if hits:
                matched.add(key or entry.get("http") or "")
            elif key or entry.get("http"):
                # 未命中时也保留兜底解析到的 URL，便于区分「无页面调用」与「不知道入口 URL」
                fallback = candidates[1] if len(candidates) > 1 else None
                source = fallback or entry
                unmatched.append({
                    "controller": entry.get("controller") or "",
                    "service": entry.get("service") or "",
                    "http": source.get("http") or "",
                    "httpResolved": bool(source.get("httpResolved")),
                    "kind": entry.get("kind") or "",
                    "heuristic": bool(entry.get("heuristic")),
                    "indirect": bool(entry.get("indirect")),
                    "depth": entry.get("depth") if entry.get("indirect") else None,
                    "reason": "",
                })
            for chain, req, backend, match in hits:
                if not (FRONT_ROOT / (chain.get("page") or "")).is_file():
                    continue
                ui_entry = build_ui_entry(chain, req, backend, entry, db, registry, incoming,
                                          args.ancestor_depth, labels)
                ui_entry["match"] = match
                dedup = (ui_entry["page"], ui_entry["element"]["id"],
                         tuple(ui_entry["request"]["paths"]),
                         ui_entry["backend"]["controller"], ui_entry["backend"]["method"])
                # 同一 (页面, 元素, 请求, 后端) 可能由多个入口命中（同名控制器跨服务），
                # 按证据贴合度选一条，避免「先遍历到谁就留谁」
                rank = _ui_preference(ui_entry)
                prev = ui_best.get(dedup)
                if prev is None or rank < prev[0]:
                    ui_best[dedup] = (rank, ui_entry)
        ui = [item for _, item in ui_best.values()]
        for item in unmatched:
            item["reason"] = _unmatched_reason(item, loose_index, orphan_keys)
            totals["unmatchedReasons"][item["reason"]] += 1
            unmatched_keys.add((item["controller"], item["http"]))
        unmatched.sort(key=lambda item: (
            item["reason"], item["controller"], item["service"], item["http"],
            bool(item["httpResolved"])))
        totals["unmatchedEntrypoints"] += len(unmatched)
        # 截断按来源/页面/元素，不用访问位置排序：菜单置信度属于元数据，
        # 不应改变「哪些条目进入产物」，否则补登记会连带换掉页面集合。
        ui.sort(key=lambda item: (
            SOURCE_RANK.get(item["source"], 5),
            item["page"],
            item["element"]["id"],
            item["backend"]["controller"],
            item["backend"]["method"],
            tuple(item["request"]["paths"]),
        ))
        if len(ui) > args.max_ui_entries:
            # 按后端（控制器+方法）轮转取，不直接截断：同一控制器的几十个页面
            # 不能把其它后端仅存的一条证据挤出产物
            groups = {}
            for item in ui:
                groups.setdefault(
                    (item["backend"]["controller"], item["backend"]["method"]), []).append(item)
            picked, round_no = [], 0
            while len(picked) < args.max_ui_entries:
                added = False
                for items in groups.values():
                    if round_no < len(items):
                        picked.append(items[round_no])
                        added = True
                        if len(picked) >= args.max_ui_entries:
                            break
                if not added:
                    break
                round_no += 1
            ui = picked
        ui.sort(key=lambda item: (
            CONFIDENCE_RANK.get(item["access"]["confidence"], 9),
            SOURCE_RANK.get(item["source"], 5),
            item["page"],
            item["element"]["id"],
            item["backend"]["controller"],
            item["backend"]["method"],
            tuple(item["request"]["paths"]),
        ))
        for item in ui:
            page = item["page"]
            current = page_conf.get(page)
            rank = CONFIDENCE_RANK.get(item["access"]["confidence"], 9)
            if current is None or rank < CONFIDENCE_RANK.get(current, 9):
                page_conf[page] = item["access"]["confidence"]
        if ui:
            totals["commitsWithUi"] += 1
        totals["matchedEntrypoints"] += len(matched)
        out_commits.append({
            "hash": commit.get("hash") or "",
            "shortHash": commit.get("shortHash") or "",
            "repo": commit.get("repo") or "",
            "subject": commit.get("subject") or "",
            "entrypoints": len(entrypoints),
            "uiEntries": ui,
            "unmatchedEntrypoints": unmatched,
        })

    output = {
        "meta": {
            "label": args.label or impact.get("meta", {}).get("label") or "",
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": str(impact_path),
            "registry": str(args.registry),
            "frontChainDb": str(FRONT_DB_FILE),
            "endpointIndex": str(ENDPOINT_FILE),
            "endpointMeta": index.get("meta") or {},
            "stats": {
                "commits": totals["commits"],
                "commitsWithUi": totals["commitsWithUi"],
                "entrypoints": totals["entrypoints"],
                "matchedEntrypoints": totals["matchedEntrypoints"],
                "pages": len(page_conf),
                "pagesWithMenu": sum(1 for v in page_conf.values() if v == "menu"),
                "pagesWithParentMenu": sum(1 for v in page_conf.values() if v == "parent"),
                "pagesNoMenu": sum(1 for v in page_conf.values() if v == "none"),
                "unmatchedEntrypoints": totals["unmatchedEntrypoints"],
                "unmatchedUnique": len(unmatched_keys),
                "unmatchedReasons": dict(sorted(totals["unmatchedReasons"].items())),
            },
        },
        "commits": out_commits,
    }
    dest = Path(args.output) if args.output else impact_path.with_name(
        f"front-chains-{args.label or 'report'}.json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(output, ensure_ascii=False, indent=1), encoding="utf-8")
    stats = output["meta"]["stats"]
    print(f"[front-chains] {dest}")
    print(f"  提交 {stats['commits']}（有界面证据 {stats['commitsWithUi']}） · "
          f"入口 {stats['entrypoints']}（命中前端 {stats['matchedEntrypoints']}） · "
          f"页面 {stats['pages']}（菜单登记 {stats['pagesWithMenu']} / "
          f"父页面可达 {stats['pagesWithParentMenu']} / 无菜单 {stats['pagesNoMenu']}）")
    reasons = " / ".join(f"{k} {v}" for k, v in stats["unmatchedReasons"].items())
    print(f"  未命中 {stats['unmatchedEntrypoints']}（唯一 controller+http "
          f"{stats['unmatchedUnique']}）：{reasons or '无'}")


def _external_url_key(controller_id):
    """工作区外 Controller 无源码注解：类名去 Controller + 方法名作为 URL 末两段。"""
    parts = (controller_id or "").split(".")
    if len(parts) < 2:
        return None
    cls, method = parts[-2], parts[-1]
    cls = cls[:-len("Controller")] if cls.endswith("Controller") else cls
    return cls.lower(), method.lower()


def cmd_impact(records, index, args):
    """把 impact_analyzer --impact --json 的结果落到按钮上。"""
    path = Path(args.keyword)
    if not path.exists():
        sys.exit(f"影响分析文件不存在: {path}")
    impact = json.loads(path.read_text(encoding="utf-8"))
    entry = impact.get("entry") or {}
    ctrls = impact.get("upstream_controllers") or []

    ws_paths = set()
    ext_controllers = {}
    maven_endpoints = load_maven_endpoints()
    ext_paths = {}

    def add_external(controller_id):
        """工作区外 Controller 的注解 URL 优先于类名+方法名启发式。"""
        if not controller_id or "." not in controller_id:
            return
        fqn, method = controller_id.rsplit(".", 1)
        eps = maven_endpoints.get((fqn, method))
        if not eps and method.startswith("lambda$"):
            eps = maven_endpoints.get((fqn, method.split("$")[1]))
        for ep in eps or []:
            ext_paths.setdefault(ep["path"].strip("/").lower(), (fqn, method, ep.get("http", "")))

    for ctrl in ctrls:
        eps = ctrl.get("endpoints") or []
        if eps:
            ws_paths.update(ep["path"].strip("/").lower() for ep in eps)
            continue
        cid = ctrl.get("id") or ctrl.get("class_method")
        key = _external_url_key(cid)
        if key:
            ext_controllers[key] = cid
            add_external(cid)

    # 外部入站链路的根 Controller（工作区外，如 trbu.PatchecklevController）。
    # 只认落在上游 Controller 上的 Feign（<X>Client → <X>ClientController），
    # 下游路过 Feign 的 Maven 调用方与本入口的按钮无关。
    upstream_classes = {c.get("id", "").rsplit(".", 2)[-2] for c in ctrls if c.get("id")}
    upstream_classes |= {c["class_method"].split(".")[0] for c in ctrls if c.get("class_method")}

    groups = [(impact.get("maven_inbound_callers") or {}).get("callers") or []]
    for group in ("maven_biz", "workspace"):
        groups.append(((impact.get("external_callers") or {}).get(group) or {}).get("callers") or [])
    for callers in groups:
        for caller in callers:
            if caller.get("root_type") != "controller" or not caller.get("controller"):
                continue
            feign = (caller.get("feign_interface") or "").split(".")[-1]
            if not feign or f"{feign}Controller" not in upstream_classes:
                continue
            key = _external_url_key(caller["controller"])
            if key:
                ext_controllers.setdefault(key, caller["controller"])
            add_external(caller["controller"])

    rows = []
    for chain, req, backends in records:
        paths = [p.strip("/").lower() for p in request_paths(req)]
        hits = [b for b in backends if b["path"].strip("/").lower() in ws_paths]
        if not hits:
            for p in paths:
                found = ext_paths.get(p)
                if not found:
                    continue
                fqn, method, http = found
                hits = [{
                    "controller": fqn.rsplit(".", 1)[-1],
                    "controller_fqn": fqn,
                    "method": method,
                    "http": http,
                    "path": p,
                    "file": "",
                    "line": None,
                    "source": "annotation",
                }]
                break
        if not hits:
            for p in paths:
                segs = p.split("/")
                owner = ext_controllers.get(tuple(segs[-2:])) if len(segs) >= 2 else None
                if owner:
                    hits = [{
                        "controller": owner.split(".")[-2],
                        "controller_fqn": owner.rsplit(".", 1)[0],
                        "method": owner.rsplit(".", 1)[-1],
                        "http": "",
                        "path": p,
                        "file": "",
                        "line": None,
                        "source": "heuristic",
                    }]
                    break
        if hits:
            rows.append((chain, req, hits))

    print(f"后端入口: {entry.get('class_method') or entry.get('id') or '?'}")
    print(f"上游 Controller: {len(ctrls)} 个（工作区 URL {len(ws_paths)} 条 / "
          f"工作区外注解 URL {len(ext_paths)} 条 / 启发式候选 {len(ext_controllers)} 个）")
    seen, uniq = set(), []
    for chain, req, backends in sorted(rows, key=lambda x: (x[0]["page"], x[0]["element"])):
        key = (chain["page"], chain["element"], chain.get("request"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append((chain, req, backends))
    emit(uniq, args)


def one_line(chain, req, backends):
    elem_id = (chain.get("element") or "").split("#", 1)[-1]
    label = chain.get("label") or elem_id
    if chain.get("label") and elem_id and not elem_id.startswith("__"):
        label += f"#{elem_id}"
    paths = request_paths(req)
    url_text = " | ".join(f"{req.get('method', '')} {path}" for path in paths)
    backend = (" | ".join(f"{b['controller']}.{b['method']}" for b in backends)
               or f"(工作区外: {service_hint(paths[0] if paths else '')})")
    return (f"  [{chain['page']}] [{chain.get('source', '')}] {label}  "
            f"({js_path(chain)})  ⇒ {url_text}  → {backend}")


def print_detail(chain, req, backends):
    print(f"\n[{chain.get('source', '')}] {chain['page']}")
    elem_id = (chain.get("element") or "").split("#", 1)[-1]
    print(f"  元素: {chain.get('label') or elem_id} ({elem_id})  事件 {chain.get('event', '')}")
    for i, step in enumerate(chain.get("path") or []):
        print(f"    {'└─' if i == len(chain['path']) - 1 else '├─'} "
              f"{step['name']}  ({step['file']}:{step.get('line', '')})")
    paths = request_paths(req)
    for path in paths or [""]:
        print(f"  请求: {req.get('method', '')} {path}  "
              f"[{req.get('url_expr', '')} / {req.get('wrapper', '')}]")
    if backends:
        for b in backends:
            location = f"{b['file']}:{b['line']}" if b.get("file") else {
                "annotation": "Maven jar 注解", "heuristic": "启发式匹配",
            }.get(b.get("source"), "工作区外")
            print(f"  后端: {b['controller_fqn']}.{b['method']}  ({b['http']} {b['path']}, "
                  f"{location})")
    else:
        print(f"  后端: 工作区外服务 {service_hint(paths[0] if paths else '')}，"
              f"本地 19 个后端仓库无对应 Controller")


def emit(rows, args):
    if args.json:
        print(json.dumps([{"chain": c, "request": r, "backend": b} for c, r, b in rows],
                         ensure_ascii=False, indent=1))
        return
    if not rows:
        print("  (无链路)")
        return
    for chain, req, backends in rows[:args.limit]:
        if args.detail:
            print_detail(chain, req, backends)
        else:
            print(one_line(chain, req, backends))
    if len(rows) > args.limit:
        print(f"  ... 共 {len(rows)} 条，已截断")


def cmd_stats(records, index, db, seg_index=None):
    meta = index["meta"]
    matched = [r for r in records if r[2]]
    url_total = {p for r in db["requests"].values() for p in request_paths(r)}
    url_hit = {u for u in url_total if match_backend(index["endpoints"], u, "", seg_index)}
    pages = {c["page"] for c, _, b in matched}
    ctrls = {b["controller_fqn"] for _, _, bs in matched for b in bs}
    methods = {f"{b['controller_fqn']}.{b['method']}" for _, _, bs in matched for b in bs}
    by_source = {}
    for c, _, b in matched:
        if b:
            by_source[c.get("source", "")] = by_source.get(c.get("source", ""), 0) + 1
    print(f"后端端点索引: {meta['controllers']} 个 Controller / {meta['endpoints']} 个端点 "
          f"(缓存 {ENDPOINT_FILE.name})")
    print(f"前端链路库: {len(db['pages'])} 页面 / {len(db['chains'])} 链路 / {len(db['requests'])} 请求")
    print(f"链路落到工作区 Controller: {len(matched)} 条，涉及 {len(pages)} 个页面")
    print("  按来源: " + ", ".join(f"{k}={v}" for k, v in sorted(by_source.items())))
    print(f"URL 路径命中: {len(url_hit)} / {len(url_total)} = "
          f"{len(url_hit) / len(url_total) * 100:.1f}%")
    print(f"覆盖 Controller: {len(ctrls)} 个 / 方法 {len(methods)} 个")
    top = {}
    for _, _, bs in matched:
        for b in bs:
            top[b["controller"]] = top.get(b["controller"], 0) + 1
    print("\n命中链路最多的 Controller:")
    for name, n in sorted(top.items(), key=lambda kv: (-kv[1], kv[0]))[:10]:
        print(f"  {n:>5}  {name}")


def find_annotated(index, keyword, by="path", maven=None):
    """按注解声明的 URL 或 Controller.方法反查端点；不依赖前端是否调用。"""
    kw = keyword.strip().lower()
    out = []
    for ep in (ep for items in index["endpoints"].values() for ep in items):
        if by == "path":
            hit = kw in ep["path"].lower()
        else:
            hit = (kw in f"{ep['controller_fqn']}.{ep['method']}".lower()
                   or kw in f"{ep['controller']}.{ep['method']}".lower())
        if hit:
            out.append(dict(ep, origin="workspace"))
    if maven:
        for ep in (ep for items in maven["endpoints"].values() for ep in items):
            if by == "path":
                hit = kw in ep["path"].lower()
            else:
                hit = kw in f"{ep['controller_fqn']}.{ep['method']}".lower()
            if hit:
                out.append(dict(ep, origin="maven"))
    out.sort(key=lambda x: (x["path"], x["controller_fqn"], x["method"]))
    return out


def print_annotated(index, keyword, by, args, maven=None):
    eps = find_annotated(index, keyword, by, maven)
    if not eps:
        return False
    print(f"  后端注解端点（无前端链路，共 {len(eps)} 个）:")
    for ep in eps[:args.limit]:
        location = (f"{ep['file']}:{ep['line']}" if ep.get("file")
                    else "Maven jar" if ep.get("origin") == "maven" else "")
        print(f"    {ep['http']:<6} {ep['path']}  {ep['controller']}.{ep['method']}  ({location})")
    if len(eps) > args.limit:
        print(f"    ... 共 {len(eps)} 个，已截断")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command",
                        choices=["stats", "page", "element", "url", "controller", "method",
                                 "impact", "commit-impact"])
    parser.add_argument("keyword", nargs="?")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--detail", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--refresh-endpoints", action="store_true",
                        help="重建 Controller 注解索引（默认直接读构建产物）")
    parser.add_argument("--label", help="commit-impact 期号（默认取 code-impact 的 meta.label）")
    parser.add_argument("--output", help="commit-impact 输出路径（默认与 code-impact 同目录）")
    parser.add_argument("--max-ui-entries", type=int, default=40,
                        help="commit-impact 单提交最多输出的界面条目（默认 40）")
    parser.add_argument("--ancestor-depth", type=int, default=2,
                        help="commit-impact 沿 page_links 上溯查找菜单登记的层数（默认 2）")
    parser.add_argument("--registry", default=str(REGISTRY_FILE),
                        help="前端界面入口登记表路径（Markdown）")
    args = parser.parse_args()

    index, rebuilt = load_index(args.refresh_endpoints)
    if rebuilt:
        print(f"[端点索引已重建: {index['meta']['controllers']} Controller / "
              f"{index['meta']['endpoints']} 端点]", file=sys.stderr)

    seg_index = build_seg_index(index["endpoints"])
    db = load_front_db()
    records = chain_records(db, index["endpoints"], seg_index)

    if args.command == "stats":
        cmd_stats(records, index, db, seg_index)
        return
    if not args.keyword:
        parser.error(f"{args.command} 需要关键字")
    if args.command == "commit-impact":
        cmd_commit_impact(records, index, db, args)
        return
    if args.command == "impact":
        cmd_impact(records, index, args)
        return
    kw = args.keyword.lower()

    if args.command == "page":
        rows = [r for r in records if kw in r[0]["page"].lower()]
    elif args.command == "element":
        rows = [r for r in records
                if kw in (r[0].get("element") or "").lower()
                or kw in (r[0].get("label") or "").lower()]
    elif args.command == "url":
        rows = [r for r in records
                if any(kw in path.lower() for path in request_paths(r[1]))]
    elif args.command == "controller":
        rows = [r for r in records if any(kw in b["controller"].lower() for b in r[2])]
    else:
        rows = [r for r in records
                if any(kw in f"{b['controller']}.{b['method']}".lower() for b in r[2])]

    seen, uniq = set(), []
    for chain, req, backends in sorted(rows, key=lambda x: (x[0]["page"], x[0]["element"],
                                                            x[1].get("url_path", ""))):
        key = (chain["page"], chain["element"], chain.get("request"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append((chain, req, backends))
    emit(uniq, args)
    if not uniq and not args.json and args.command in ("url", "method"):
        by = "path" if args.command == "url" else "method"
        print(f"  前端链路库无匹配（{args.command} = {args.keyword}）")
        print_annotated(index, args.keyword, by, args, load_maven_index())


if __name__ == "__main__":
    main()
