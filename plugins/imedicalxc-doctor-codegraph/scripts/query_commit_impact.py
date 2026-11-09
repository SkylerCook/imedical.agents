#!/usr/bin/env python3
"""
提交级代码影响取证（供 imedicalxc-doctor-commit-report 调用）

输入: raw-commits-<label>.json（collect-commits.js 产出）
输出: code-impact-<label>.json（结构化证据，不含业务判断）

流程:
  1. 定位: git show -U0 取新旧侧变更行 → 解析对应版本源码的方法区间 → 变更方法 Class.method
  2. 检索: 一次加载 impact_db + penetration_db，批量做影响分析
  3. 契约补充: 对仅命中 DTO/VO/PO 的提交，先按 feign_interfaces.json 方法签名
     产出 typeFeignMatches，再按 controller_endpoints.json 的 Controller 方法签名
     反查（返回类型/入参）合成 Controller 入口，弥补方法图无入口的问题
  4. 聚合: 按提交去重合并入口 / 本组调用方 / 外部调用方，同一证据保留 via 来源方法

证据边界（写入输出 meta.boundaries，供报告如实标注）:
  - 仅 Java 方法级调用图；DTO/VO/PO、前端页面、public 基础设施、资源文件不在图内
  - BLH 反射分发的静态链可能缺失（追踪器已用同名覆写与启发式补链）
  - Maven 侧只保留直调医生站 Feign 的服务
"""

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from config import OUTPUT_DIR, PROJECT_ROOT, WORKSPACE_SERVICES, get_module_for_service, to_repo_relative  # noqa: E402
from impact_analyzer import ImpactDB, get_class_method, get_service  # noqa: E402
import scan_controller_endpoints as endpoints_index  # noqa: E402

REPO_ROOT = PROJECT_ROOT.parent
COMMIT_REPORT_CONFIG = PROJECT_ROOT / "plugins" / "imedicalxc-doctor-commit-report" / "config" / "commit-report.json"


def load_codegraph_defaults():
    """读取 commit-report 的 codegraph 配置作为默认参数（显式 CLI 参数优先）"""
    try:
        cfg = json.loads(COMMIT_REPORT_CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return cfg.get("codegraph") or {}

# ────────────────────────────────────────────────────────────────
#  git 辅助
# ────────────────────────────────────────────────────────────────


def git(repo_abs, *args):
    return subprocess.run(
        ["git", "-C", str(repo_abs), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


def git_show(repo_abs, rev, path=None):
    args = ["show", rev]
    if path:
        args.append(path)
    r = git(repo_abs, *args)
    return r.stdout if r.returncode == 0 else ""


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def parse_diff(diff_text):
    """解析 -U0 diff，返回 {file: {"old": set, "new": set, "deleted": bool, "binary": bool}}"""
    files = {}
    cur = None
    minus_path = None
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            cur = None
            minus_path = None
            continue
        if line.startswith("--- "):
            minus_path = line[4:].strip()
            if minus_path.startswith("a/"):
                minus_path = minus_path[2:]
            continue
        if line.startswith("+++ "):
            path = line[4:].strip()
            deleted = path == "/dev/null"
            if deleted:
                path = minus_path
                if not path or path == "/dev/null":
                    cur = None
                    continue
            elif path.startswith("b/"):
                path = path[2:]
            cur = path
            files.setdefault(cur, {"old": set(), "new": set(), "deleted": False, "binary": False})
            files[cur]["deleted"] = deleted
            continue
        if line.startswith("Binary files") and cur:
            files[cur]["binary"] = True
            continue
        m = HUNK_RE.match(line)
        if m and cur:
            old_start, old_cnt = int(m.group(1)), int(m.group(2) or 1)
            new_start, new_cnt = int(m.group(3)), int(m.group(4) or 1)
            if old_cnt:
                files[cur]["old"].update(range(old_start, old_start + old_cnt))
            if new_cnt:
                files[cur]["new"].update(range(new_start, new_start + new_cnt))
    return files


# ────────────────────────────────────────────────────────────────
#  Java 方法区间解析（注释/字符串感知）
# ────────────────────────────────────────────────────────────────


def mask_code(content):
    """注释与字符串/字符字面量替换为空格，保留换行与行号"""
    out = []
    i, n = 0, len(content)
    state = None
    while i < n:
        c = content[i]
        nx = content[i + 1] if i + 1 < n else ""
        if state is None:
            if c == "/" and nx == "/":
                state = "line"; out.append("  "); i += 2; continue
            if c == "/" and nx == "*":
                state = "block"; out.append("  "); i += 2; continue
            if c == '"':
                state = "str"; out.append(" "); i += 1; continue
            if c == "'":
                state = "char"; out.append(" "); i += 1; continue
            out.append(c); i += 1; continue
        if state == "line":
            if c == "\n":
                state = None; out.append("\n")
            else:
                out.append(" ")
            i += 1; continue
        if state == "block":
            if c == "*" and nx == "/":
                state = None; out.append("  "); i += 2; continue
            out.append("\n" if c == "\n" else " "); i += 1; continue
        if state in ("str", "char"):
            quote = '"' if state == "str" else "'"
            if c == "\\":
                out.append("  "); i += 2; continue
            if c == quote:
                state = None; out.append(" "); i += 1; continue
            out.append("\n" if c == "\n" else " "); i += 1; continue
    return "".join(out)


CONTROL_WORDS = {
    "if", "for", "while", "switch", "catch", "return", "new", "else", "do",
    "try", "throw", "assert", "case", "super", "this", "synchronized",
}
SIG_RE = re.compile(r"([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:throws\s+[\w.,\s<>\[\]]+)?$")
CLASS_RE = re.compile(
    r"(?:public\s+|protected\s+|private\s+|static\s+|final\s+|abstract\s+|sealed\s+|non-sealed\s+)*"
    r"(class|interface|enum|record|@interface)\s+(\w+)"
)
PKG_RE = re.compile(r"^\s*package\s+([\w.]+)\s*;", re.M)


def class_info(content):
    pkg = PKG_RE.search(content)
    cls = CLASS_RE.search(mask_code(content))
    return (pkg.group(1) if pkg else ""), (cls.group(2) if cls else ""), (cls.group(1) if cls else "")


def parse_methods(content, is_interface=False):
    """返回 [{"name","start","end","signature_only"}]（1-based 行号）"""
    if not content.strip():
        return []
    clean = mask_code(content)
    cl = clean.split("\n")
    depth_before = []
    depth = 0
    for ln in cl:
        depth_before.append(depth)
        depth += ln.count("{") - ln.count("}")
    methods = []
    i = 0
    total = len(cl)
    while i < total:
        seg = ""
        brace_line = None
        semi_line = None
        for k in range(i, min(i + 6, total)):
            s = cl[k]
            if "{" in s:
                seg += s[:s.index("{")]
                brace_line = k
                break
            if ";" in s:
                seg += s[:s.index(";")]
                semi_line = k
                break
            seg += s + " "
        compact = " ".join(seg.split())
        m = SIG_RE.search(compact)
        if not m:
            i += 1
            continue
        name = m.group(1)
        before = compact[:m.start(1)].rstrip()
        if (
            name in CONTROL_WORDS
            or not before
            or before.endswith(".")
            or re.search(r"\b(class|interface|enum|record)\b", before)
        ):
            i += 1
            continue

        if brace_line is not None:
            target = depth_before[i]
            rel = 0
            end = None
            for k in range(brace_line, total):
                rel += cl[k].count("{") - cl[k].count("}")
                if rel <= 0 and k >= brace_line:
                    end = k
                    break
            if end is None:
                i += 1
                continue
            methods.append({"name": name, "start": i + 1, "end": end + 1, "signature_only": False})
            i = end + 1
            continue

        # 接口/抽象方法：无方法体，按签名行记录（Feign 契约变更用）
        if semi_line is not None and is_interface and depth_before[i] == 1:
            methods.append({"name": name, "start": i + 1, "end": semi_line + 1, "signature_only": True})
            i = semi_line + 1
            continue
        i += 1
    return methods


def intersect_methods(methods, lines):
    hits = []
    for m in methods:
        cnt = sum(1 for x in lines if m["start"] <= x <= m["end"])
        if cnt:
            hits.append({**m, "changedLines": cnt})
    return hits


# ────────────────────────────────────────────────────────────────
#  影响取证
# ────────────────────────────────────────────────────────────────


def fmt_http(info):
    method = (info.get("http_method") or "").strip()
    path = (info.get("http_path") or "").strip()
    return f"{method} {path}".strip()


def feign_http(db, iface_full, method_name):
    info = db.feign_full.get(iface_full) or {}
    m = (info.get("methods") or {}).get(method_name) or {}
    prefix = info.get("path") or ""
    path = m.get("path") or ""
    http = (m.get("http") or "").strip()
    full = f"{prefix}/{path}".replace("//", "/") if prefix or path else ""
    return f"{http} {full}".strip()


TYPE_TOKEN_RE = re.compile(r"(?<!@)\b[A-Z][A-Za-z0-9_$]*\b")
JAVA_PKG_RE = re.compile(r"^\s*package\s+([\w.]+);", re.M)
JAVA_IMPORT_RE = re.compile(r"^\s*import\s+(?!static\b)([\w.]+?)(\.\*)?\s*;", re.M)


def java_type_scope(path):
    """读取 Java 源文件的 package / 显式 import / 通配 import，用于类型全限定名解析。"""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="ignore")[:8000]
    except OSError:
        return {}
    pkg = JAVA_PKG_RE.search(text)
    imports, wildcards = {}, []
    for m in JAVA_IMPORT_RE.finditer(text):
        target, wildcard = m.group(1), m.group(2)
        if wildcard:
            wildcards.append(target)
        else:
            imports[target.rsplit(".", 1)[-1]] = target
    return {"package": pkg.group(1) if pkg else "", "imports": imports, "wildcards": wildcards}


def resolve_java_type(scope, name):
    """签名类型短名 → 候选全限定名（显式 import / 同包 / 通配 import）。"""
    if not scope:
        return {name}
    fqns = set()
    if name in (scope.get("imports") or {}):
        fqns.add(scope["imports"][name])
    if scope.get("package"):
        fqns.add(f"{scope['package']}.{name}")
    for wildcard in scope.get("wildcards") or []:
        fqns.add(f"{wildcard}.{name}")
    return fqns


def load_feign_type_index():
    """类型全限定名 → Feign 接口方法签名的使用关系

    扫描 feign_interfaces.json 的 return_type / parameters，再按接口源码的
    package / import 解析成全限定名；避免不同模块同名 DTO 串到对方 Feign 接口。
    接口源码缺失时退化为 package_name + 短名。返回:
      {type_fqn: {(feign, method): {feign, feignFull, service, servicePath,
                                    method, http, usage[]}}}
    """
    path = OUTPUT_DIR / "feign_interfaces.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    index = defaultdict(dict)
    for iface in data.get("interfaces", []):
        fname = iface.get("class_name") or ""
        full = iface.get("full_name") or ""
        service = iface.get("service_name") or ""
        service_path = iface.get("service_path") or ""
        scoped = iface.get("file_path") and Path(iface["file_path"]).exists()
        scope = java_type_scope(iface["file_path"]) if scoped else {
            "package": iface.get("package_name") or "", "imports": {}, "wildcards": []}
        for m in iface.get("methods", []):
            ret_types = set(TYPE_TOKEN_RE.findall(m.get("return_type") or ""))
            param_types = set()
            for p in m.get("parameters") or []:
                param_types.update(TYPE_TOKEN_RE.findall(p or ""))
            for t in ret_types | param_types:
                usage = sorted(
                    (["return"] if t in ret_types else [])
                    + (["parameter"] if t in param_types else [])
                )
                key = (fname, m.get("name") or "")
                for fqn in resolve_java_type(scope, t):
                    rec = index[fqn].get(key)
                    if rec is None:
                        rec = index[fqn][key] = {
                            "feign": fname,
                            "feignFull": full,
                            "service": service,
                            "servicePath": service_path,
                            "method": m.get("name") or "",
                            "http": f"{m.get('http_method') or ''} {m.get('path') or ''}".strip(),
                            "usage": [],
                        }
                    rec["usage"] = sorted(set(rec["usage"]) | set(usage))
    return index


def match_type_feigns(type_files, type_index, repo_abs):
    """按类型全限定名匹配 Feign 方法签名，返回 (feign 短名集合, 明细列表)"""
    feigns = set()
    matches = {}
    for rel in type_files:
        simple = Path(rel).stem
        full = type_full_name(repo_abs, rel)
        for (fname, method), rec in (type_index.get(full) or {}).items():
            feigns.add(fname)
            key = (full, fname, method)
            if key not in matches:
                matches[key] = {"file": rel, "type": simple, "typeFqn": full, **rec}
    rows = sorted(matches.values(), key=lambda x: (x["feign"], x["method"], x["type"]))
    return feigns, rows


def feign_caller_entrypoints(db, type_matches, depth, with_maven, max_callers=40):
    """类型命中的 Feign 接口 → 工作区调用方 → 入口，补出间接页面链路。

    纯契约提交的直接 Controller 入口只覆盖服务端签名；页面经「本服务
    Controller → BLH → Feign」调用契约时，链路上没有 DTO 节点，需要在
    Feign 接口的调用方方法上再跑一次上游入口分析。合成的入口带
    indirect=true 与 feign:<接口>.<方法>，表示页面不直调该契约。
    """
    targets = {}
    for m in type_matches:
        key = (m.get("feignFull", ""), m.get("method", ""))
        targets.setdefault(key, set()).add(m.get("type", ""))

    callers = {}
    for edge in getattr(db, "ws_feign_edges", []):
        target = (edge.get("t") or "").split("(", 1)[0]
        cls, _, method = target.rpartition(".")
        for (feign_full, feign_method), types in targets.items():
            if cls == feign_full and method == feign_method:
                rec = callers.setdefault(edge["s"], {"types": set(), "feigns": set()})
                rec["types"].update(types)
                rec["feigns"].add(f"{feign_full.rsplit('.', 1)[-1]}.{feign_method}")

    entrypoints, rows = [], []
    for caller in sorted(callers)[:max_callers]:
        info = callers[caller]
        ev = analyze_method(db, caller, depth, with_maven)
        via = [f"type:{t}" for t in sorted(info["types"])] + \
              [f"feign:{f}" for f in sorted(info["feigns"])]
        for ep in ev["entrypoints"]:
            entrypoints.append({
                **ep,
                "heuristic": bool(ep.get("heuristic")),
                "indirect": True,
                "via": via + list(ep.get("via") or [])[:1],
            })
        rows.append({
            "caller": caller,
            "service": get_service(caller),
            "types": sorted(info["types"]),
            "feigns": sorted(info["feigns"]),
            "entrypoints": len(ev["entrypoints"]),
        })
    rows.sort(key=lambda x: (x["service"], x["caller"]))
    return entrypoints, rows


def load_controller_type_index():
    """类型全限定名 → Controller 方法签名使用关系（来自 controller_endpoints.json）"""
    data = endpoints_index.load()
    if not data:
        return {}
    return endpoints_index.type_index(data["endpoints"], data.get("type_scopes"))


def type_full_name(repo_abs, rel):
    """按类型文件的 package 声明还原全限定名，供 Controller 签名反查。"""
    try:
        text = (repo_abs / rel).read_text(encoding="utf-8", errors="ignore")[:2000]
    except OSError:
        return ""
    m = re.search(r"^\s*package\s+([\w.]+);", text, re.M)
    simple = Path(rel).stem
    return f"{m.group(1)}.{simple}" if m else simple


def match_type_controllers(type_files, type_index, repo_abs):
    """按类型全限定名反查 Controller 签名，合成 Controller 入口

    纯契约提交没有方法节点，方法图给不出入口；这里用返回类型/入参命中
    直接产出 Controller 入口，交给前端链路衔接页面。heuristic=true 标明
    该入口来自签名反查而非调用图追踪。按全限定名匹配，避免跨模块同名
    DTO（如 ipcare/opcare 各自的 FeignOeStopMultiDTO）串到对方 Controller。
    """
    entrypoints, matches = [], {}
    for rel in type_files:
        simple = Path(rel).stem
        full = type_full_name(repo_abs, rel)
        for rec in type_index.get(full) or []:
            key = (full, rec["controller_fqn"], rec["method"], rec["path"])
            if key in matches:
                continue
            http = f'{rec["http"]} {rec["path"]}'.strip()
            matches[key] = {
                "file": rel,
                "type": simple,
                "typeFqn": full,
                "controller": rec["controller"],
                "controllerFqn": rec["controller_fqn"],
                "method": rec["method"],
                "http": http,
                "usage": rec["usage"],
            }
            entrypoints.append({
                "kind": "controller",
                "controller": f'{rec["controller"]}.{rec["method"]}',
                "service": get_service(rec["controller_fqn"]),
                "feign": "",
                "http": http,
                "heuristic": True,
                "depth": 0,
                "via": [f"type:{simple}"],
                "type": simple,
                "typeFqn": full,
                "usage": rec["usage"],
            })
    rows = sorted(matches.values(), key=lambda x: (x["controllerFqn"], x["method"], x["http"]))
    entrypoints.sort(key=lambda x: (x["controller"], x["http"]))
    return entrypoints, rows


def analyze_method(db, nid, depth, with_maven):
    """返回单方法的精简证据（不含中文结论）

    入站（谁调用我）只取入口自身与上游 Controller 对应的 Feign 接口；
    下游 Feign 单独归入 downstreamFeigns，不能混进契约与调用方。
    """
    info = db.ws_nodes.get(nid, {})
    svc = info.get("service") or get_service(nid)
    fwd = db.trace_ws_forward(nid, depth)
    reachable = fwd["reachable"] - {nid}
    ws_set = set(WORKSPACE_SERVICES)
    ws_reachable = [m for m in reachable if get_service(m) in ws_set]

    entrypoints = []
    inbound_targets = []  # (iface_full, method_name) —— 入站契约
    downstream_feigns = []

    if info.get("is_feign"):
        iface = nid.rsplit(".", 1)[0]
        method = nid.rsplit(".", 1)[-1]
        inbound_targets.append((iface, method))
        entrypoints.append({
            "kind": "feign",
            "controller": get_class_method(nid),
            "service": svc,
            "feign": iface.rsplit(".", 1)[-1],
            "http": feign_http(db, iface, method),
            "heuristic": False,
            "depth": 0,
        })

    try:
        controllers = db.trace_upstream_to_controllers(nid, max_depth=max(depth, 15))
    except Exception:
        controllers = []
    for c in controllers:
        cid = c.get("controller")
        if not cid:
            continue
        ci = db.get_controller_feign_info(cid) or {}
        iface = ci.get("feign_interface") or ""
        method = cid.rsplit(".", 1)[-1]
        entrypoints.append({
            "kind": "controller",
            "controller": get_class_method(cid),
            "service": get_service(cid),
            "feign": iface.rsplit(".", 1)[-1],
            "http": fmt_http(ci),
            "heuristic": bool(c.get("heuristic")),
            "depth": c.get("depth", -1),
        })
        if iface:
            inbound_targets.append((iface, method))

    for fc in fwd["feign_crossings"]:
        iface = fc.get("feign_interface") or ""
        target = fc.get("feign_target") or ""
        if iface:
            downstream_feigns.append({
                "feign": iface.rsplit(".", 1)[-1],
                "method": target.rsplit(".", 1)[-1] if "." in target else "",
                "caller": get_class_method(fc.get("caller", "")),
            })

    workspace_callers = []
    external_callers = []
    if with_maven:
        seen = set()
        for iface, method in inbound_targets:
            if not iface or (iface, method) in seen:
                continue
            seen.add((iface, method))
            try:
                ext = db.find_feign_external_callers(iface, method_name=method)
            except Exception:
                continue
            for c in ext.get("workspace", []):
                workspace_callers.append({
                    "service": c.get("service", ""),
                    "module": get_module_for_service(c.get("service", "")),
                    "caller": get_class_method(c.get("caller", "")),
                    "sameService": c.get("service") == svc,
                    "feign": iface.rsplit(".", 1)[-1],
                })
            for c in ext.get("maven_biz", []):
                external_callers.append({
                    "service": c.get("service", ""),
                    "module": get_module_for_service(c.get("service", "")),
                    "caller": get_class_method(c.get("caller", "")),
                    "controller": get_class_method(c.get("controller", "")) if c.get("controller") else "",
                    "rootType": c.get("root_type", ""),
                    "feign": iface.rsplit(".", 1)[-1],
                    "path": (c.get("paths") or [[]])[0][-1] if c.get("paths") else "",
                })

    return {
        "entry": {"id": nid, "class_method": get_class_method(nid), "service": svc},
        "entrypoints": entrypoints,
        "workspaceCallers": workspace_callers,
        "externalCallers": external_callers,
        "downstreamFeigns": downstream_feigns,
        "downstream": {
            "count": len(ws_reachable),
            "aggregate": "workspace_reachable_methods",
            "services": sorted({get_service(m) for m in ws_reachable} | {svc}),
        },
        "feignInterfaces": sorted({f.rsplit(".", 1)[-1] for f, _ in inbound_targets if f}),
    }


# ────────────────────────────────────────────────────────────────
#  提交级定位与聚合
# ────────────────────────────────────────────────────────────────


def normalize(path):
    return str(path).replace("\\", "/").lower()


def load_graph_index(db):
    by_file = defaultdict(dict)
    for nid, info in db.ws_nodes.items():
        fp = info.get("file_path")
        if fp:
            by_file[normalize(fp)][get_class_method(nid)] = nid
    return by_file


def classify_skip(rel_path, exists_in_graph):
    p = rel_path.replace("\\", "/")
    low = p.lower()
    if not low.endswith(".java"):
        return "frontend" if low.startswith("src/frontend") or "/static/" in low or low.endswith((".js", ".html", ".css")) else "resource"
    if "/public/" in f"/{low}":
        return "public_layer"
    if re.search(r"/(dto|vo|po|model|entity)/", f"/{low}") or re.search(r"(DTO|VO|PO)$", Path(p).stem):
        return "type_contract"
    if not exists_in_graph:
        return "not_in_graph"
    return "no_method_change"


def locate_commit(repo_abs, commit, by_file, max_methods):
    """返回 (methods, skipped, truncated)"""
    all_files = commit.get("files", [])
    ok = git(repo_abs, "rev-parse", "--is-inside-work-tree")
    if ok.returncode != 0:
        return [], [{"file": f["path"], "reason": "repo_unavailable"} for f in all_files], []
    exists = git(repo_abs, "cat-file", "-e", f"{commit['hash']}^{{commit}}")
    if exists.returncode != 0:
        return [], [{"file": f["path"], "reason": "commit_unavailable"} for f in all_files], []

    java_files = [f["path"] for f in all_files if str(f.get("path", "")).endswith(".java")]
    if not java_files:
        return [], [{"file": f["path"], "reason": classify_skip(f["path"], False)} for f in all_files], []

    diff = git(repo_abs, "show", "-U0", "--pretty=format:", "--no-color", commit["hash"], "--", *java_files).stdout
    ranges = parse_diff(diff)

    candidates = []
    skipped = []
    for rel, r in ranges.items():
        if r.get("binary"):
            skipped.append({"file": rel, "reason": "binary"})
            continue
        graph_methods = by_file.get(normalize(to_repo_relative(Path(repo_abs) / rel)), {})
        if not graph_methods:
            skipped.append({"file": rel, "reason": classify_skip(rel, False)})
            continue

        new_content = git_show(repo_abs, f"{commit['hash']}:{rel}")
        old_content = git_show(repo_abs, f"{commit['hash']}^:{rel}") if r["old"] else ""
        pkg, cls, kind = class_info(new_content or old_content)
        if not cls:
            skipped.append({"file": rel, "reason": "parse_failed"})
            continue

        hits = []
        if new_content and r["new"]:
            hits += intersect_methods(parse_methods(new_content, kind == "interface"), r["new"])
        if old_content and r["old"]:
            hits += intersect_methods(parse_methods(old_content, kind == "interface"), r["old"])

        seen = set()
        for h in hits:
            cm = f"{cls}.{h['name']}"
            if cm in seen:
                continue
            seen.add(cm)
            nid = graph_methods.get(cm)
            candidates.append({
                "class_method": cm,
                "id": nid or "",
                "file": rel,
                "startLine": h["start"],
                "endLine": h["end"],
                "changedLines": h["changedLines"],
                "inGraph": bool(nid),
            })
        if not hits:
            skipped.append({"file": rel, "reason": "no_method_change"})

    candidates.sort(key=lambda x: x["changedLines"], reverse=True)
    in_graph = [c for c in candidates if c["inGraph"]]
    out_graph = [c for c in candidates if not c["inGraph"]]
    for c in out_graph:
        skipped.append({"file": c["file"], "method": c["class_method"], "reason": "not_in_graph"})

    kept = in_graph[:max_methods]
    truncated = [c["class_method"] for c in in_graph[max_methods:]]
    return kept, skipped, truncated


def merge_unique(items, key_fn):
    seen = {}
    for it in items:
        k = key_fn(it)
        if k in seen:
            seen[k]["via"] = sorted(set(seen[k].get("via", [])) | set(it.get("via", [])))
        else:
            seen[k] = it
    return list(seen.values())


def index_fresh(index_mtime, commit_date):
    try:
        dt = datetime.fromisoformat(commit_date.replace("Z", "+00:00"))
        return dt.timestamp() <= index_mtime
    except Exception:
        return True


def build(raw_path, output_path, label, max_methods, depth, with_maven):
    raw = json.loads(Path(raw_path).read_text(encoding="utf-8"))
    commits = raw.get("commits", raw) if isinstance(raw, dict) else raw
    label = label or (raw.get("label") if isinstance(raw, dict) else None)
    if not label:
        m = re.search(r"raw-commits-(.+)\.json$", Path(raw_path).name)
        label = m.group(1) if m else "unknown"

    impact_path = OUTPUT_DIR / "impact_db.json"
    if not impact_path.exists():
        raise SystemExit(f"[ERROR] 缺少索引: {impact_path}，请先运行 imedicalxc-doctor-codegraph-gen")
    db = ImpactDB()
    by_file = load_graph_index(db)
    feign_type_index = load_feign_type_index()
    controller_type_index = load_controller_type_index()
    index_mtime = impact_path.stat().st_mtime

    result_commits = []
    stats = defaultdict(int)
    for commit in commits:
        repo_abs = (REPO_ROOT / commit["repo"]).resolve()
        methods, skipped, truncated = locate_commit(repo_abs, commit, by_file, max_methods)

        entrypoints = []
        workspace = []
        external = []
        downstream_feigns = []
        downstream_services = set()
        downstream_count = 0
        feigns = set()
        method_rows = []
        for m in methods:
            ev = analyze_method(db, m["id"], depth, with_maven)
            cm = m["class_method"]
            for e in ev["entrypoints"]:
                entrypoints.append({**e, "via": [cm]})
            for c in ev["workspaceCallers"]:
                workspace.append({**c, "via": [cm]})
            for c in ev["externalCallers"]:
                external.append({**c, "via": [cm]})
            for f in ev["downstreamFeigns"]:
                downstream_feigns.append({**f, "via": [cm]})
            downstream_services.update(ev["downstream"]["services"])
            downstream_count = max(downstream_count, ev["downstream"]["count"])
            feigns.update(ev["feignInterfaces"])
            method_rows.append({
                "classMethod": cm,
                "file": m["file"],
                "changedLines": m["changedLines"],
                "entrypoints": len(ev["entrypoints"]),
                "workspaceCallers": len(ev["workspaceCallers"]),
                "externalCallers": len(ev["externalCallers"]),
                "downstream": ev["downstream"]["count"],
            })

        # 去重键必须带 service：门诊/住院存在同名 Controller（如 MRDiagnosEntryController），
        # 只按类名+方法+URL 合并会把两个服务的入口吞成一个，保留谁取决于遍历顺序
        entrypoints = merge_unique(
            entrypoints, lambda x: (x["kind"], x.get("service", ""), x["controller"], x.get("http", "")))
        workspace = merge_unique(workspace, lambda x: (x["service"], x["caller"]))
        external = merge_unique(external, lambda x: (x["service"], x["caller"]))
        downstream_feigns = merge_unique(downstream_feigns, lambda x: (x["feign"], x["method"]))

        # 取证产物按稳定键排序，保证同一份数据重跑逐条一致（报告取首条证据）
        entrypoints.sort(key=lambda x: (
            x["kind"], x.get("service", ""), x["controller"], x.get("http", ""),
            x.get("depth", -1), bool(x.get("heuristic"))))
        workspace.sort(key=lambda x: (x["service"], x["caller"], x["feign"]))
        external.sort(key=lambda x: (x["service"], x["caller"], x["feign"], x.get("path", "")))
        downstream_feigns.sort(key=lambda x: (x["feign"], x["method"], x["caller"]))

        type_files = [s["file"] for s in skipped if s.get("reason") == "type_contract"]
        type_feigns, type_matches = match_type_feigns(type_files, feign_type_index, repo_abs)
        type_entrypoints, type_controller_matches = match_type_controllers(
            type_files, controller_type_index, repo_abs)
        type_feign_entrypoints, type_feign_callers = feign_caller_entrypoints(
            db, type_matches, depth, with_maven)
        synthesized = type_entrypoints + type_feign_entrypoints
        if synthesized:
            entrypoints = merge_unique(
                entrypoints + synthesized,
                lambda x: (x["kind"], x.get("service", ""), x["controller"], x.get("http", "")))
            entrypoints.sort(key=lambda x: (
                x["kind"], x.get("service", ""), x["controller"], x.get("http", ""),
                x.get("depth", -1), bool(x.get("heuristic")), bool(x.get("indirect"))))
        kept_methods = [m for m in methods if m["inGraph"]]
        confidence = "graph" if kept_methods else ("partial" if type_files else "none")

        result_commits.append({
            "hash": commit["hash"],
            "shortHash": commit["hash"][:8],
            "repo": commit["repo"],
            "author": commit.get("author") or commit.get("authorName") or "",
            "date": commit.get("date", ""),
            "subject": commit.get("subject", ""),
            "indexFresh": index_fresh(index_mtime, commit.get("date", "")),
            "source": "graph" if kept_methods else "fallback",
            "confidence": confidence,
            "methods": method_rows,
            "entrypoints": entrypoints,
            "workspaceCallers": workspace,
            "externalCallers": external,
            "downstreamFeigns": downstream_feigns,
            "contract": {
                "feignInterfaces": sorted(feigns | type_feigns),
                "typeFiles": type_files,
                "typeFeignMatches": type_matches,
                "typeFeignCallers": type_feign_callers,
                "typeControllerMatches": type_controller_matches,
            },
            "downstream": {"count": downstream_count, "services": sorted(s for s in downstream_services if s)},
            "skippedFiles": skipped,
            "truncatedMethods": truncated,
        })
        stats["commits"] += 1
        stats["methodsAnalyzed"] += len(kept_methods)
        stats["withGraphEvidence"] += 1 if kept_methods else 0
        stats["skippedFiles"] += len(skipped)
        stats["typeFeignMatches"] += len(type_matches)
        stats["typeFeignCallers"] += len(type_feign_callers)
        stats["typeControllerMatches"] += len(type_controller_matches)

    doc = {
        "meta": {
            "label": label,
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "index": {"path": str(impact_path), "builtAt": datetime.fromtimestamp(index_mtime).astimezone().isoformat(timespec="seconds")},
            "source": "graph",
            "stats": dict(stats),
            "boundaries": [
                "仅 Java 方法级调用图；DTO/VO/PO、前端页面、public 基础设施与资源文件不在图内",
                "BLH 反射分发可能断链，追踪器以同名覆写与启发式补链",
                "Maven 侧只保留直调医生站 Feign 的服务，未命中不等于无交互",
                "下游数量为入口方法可达方法数，不代表全部需回归范围",
                "契约类型的 Feign 使用方按 feign_interfaces.json 方法签名 + 接口源码 package/import 解析的全限定类型名匹配，不同模块同名 DTO 不会串口；嵌套在 VO 字段里的类型不在签名中，未命中不等于无使用方",
                "契约类型命中的 Feign 接口会再沿工作区调用方上溯入口（indirect=true、via 带 feign:<接口>.<方法>），补出「页面 → 本地 Controller → BLH → Feign」的间接链路",
                "契约类型的 Controller 使用方按 controller_endpoints.json 的全限定类型名反查（heuristic 入口）；仅出现在 VO 嵌套字段、局部变量或实现类内部时不在签名中，未命中不等于无页面入口",
            ],
        },
        "commits": result_commits,
    }
    Path(output_path).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] {output_path}")
    print(f"  提交: {stats['commits']} | 有图证据: {stats['withGraphEvidence']} | 分析方法: {stats['methodsAnalyzed']} | 跳过文件: {stats['skippedFiles']}")
    return doc


def main():
    cg = load_codegraph_defaults()
    parser = argparse.ArgumentParser(description="提交级代码影响取证")
    parser.add_argument("raw_commits", help="raw-commits-<label>.json 路径")
    parser.add_argument("--label", help="期号（缺省从文件名解析）")
    parser.add_argument("--output", help="输出文件路径（缺省与输入同目录 code-impact-<label>.json）")
    parser.add_argument(
        "--max-methods-per-commit",
        type=int,
        default=cg.get("maxMethodsPerCommit", 10),
        help=f"单提交最多分析方法数（默认 {cg.get('maxMethodsPerCommit', 10)}，取自 commit-report 配置）",
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=cg.get("depth", 10),
        help=f"下游追踪深度（默认 {cg.get('depth', 10)}，取自 commit-report 配置）",
    )
    parser.add_argument("--no-maven", action="store_true", help="跳过 Maven 入站调用方")
    args = parser.parse_args()

    raw_path = Path(args.raw_commits)
    if not raw_path.exists():
        raise SystemExit(f"[ERROR] 输入不存在: {raw_path}")

    label = args.label
    if not label:
        m = re.search(r"raw-commits-(.+)\.json$", raw_path.name)
        label = m.group(1) if m else "unknown"
    output = Path(args.output) if args.output else raw_path.parent / f"code-impact-{label}.json"

    build(raw_path, output, label, args.max_methods_per_commit, args.depth, not args.no_maven)


if __name__ == "__main__":
    main()
