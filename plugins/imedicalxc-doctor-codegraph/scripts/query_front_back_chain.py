#!/usr/bin/env python3
"""前后端链路衔接查询：HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller。

数据源：
- docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json（前端链路库）
- 工作区 19 个后端仓库（12 业务 + 7 基础设施）的 *Controller.java（端点索引，缓存为
  docs/agents/imedicalxc-doctor-codegraph/front_back_endpoints.json）

用法:
    python query_front_back_chain.py stats
    python query_front_back_chain.py page <页面片段>
    python query_front_back_chain.py element <元素 id / 文案片段>
    python query_front_back_chain.py url <URL 片段>
    python query_front_back_chain.py controller <Controller 名片段>
    python query_front_back_chain.py method <Controller.方法片段>

可选: --limit N（默认 20）, --detail（逐条展开多行）, --json, --rebuild（重建端点缓存）

page / element / url 输出全部链路；工作区没有对应 Controller 的条目保留并标注
「(工作区外: URL 首段)」，stats 的覆盖率只统计命中工作区 Controller 的链路。
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import INFRA_REPOS, OUTPUT_DIR, WORKSPACE_REPOS, WORKSPACE_ROOT, to_repo_relative
from front.config import DB_FILE as FRONT_DB_FILE

ENDPOINT_FILE = OUTPUT_DIR / "front_back_endpoints.json"

PKG_RE = re.compile(r"^\s*package\s+([\w.]+);", re.M)
# public class 后可能跟 extends / implements，类名在 class 之后
CLASS_RE = re.compile(r"\b(?:public\s+)?(?:abstract\s+|final\s+)?class\s+(\w+)")
MAPPING_RE = re.compile(
    r"@(RequestMapping|PostMapping|GetMapping|PutMapping|DeleteMapping)\s*(?:\(([^)]*)\))?", re.S)
VALUE_RE = re.compile(r'"([^"]*)"')
DECL_RE = re.compile(
    r"(?:public|protected|private)\s+(?:static\s+|final\s+|synchronized\s+)*"
    r"[\w.<>\[\],?\s]+?\s(\w+)\s*\(", re.S)
VERB = {"PostMapping": "POST", "GetMapping": "GET", "PutMapping": "PUT", "DeleteMapping": "DELETE"}


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def _verbs(ann_name, args):
    if ann_name in VERB:
        return VERB[ann_name]
    found = re.findall(r"RequestMethod\.(\w+)", args or "")
    return found[0] if found else "ANY"


def _paths(args):
    """只取映射路径，跳过 produces/consumes/name 等字符串属性。"""
    if not args:
        return []
    named = re.search(r"\b(?:value|path)\s*=\s*(\{[^}]*\}|\"[^\"]*\")", args)
    if named:
        return VALUE_RE.findall(named.group(1))
    positional = re.split(r"\b(?:method|params|headers|consumes|produces|name|value|path)\s*=", args)[0]
    return VALUE_RE.findall(positional)


def _join(*parts):
    return "/".join(p.strip("/") for p in parts if p and p.strip("/")).lower()


def parse_controller(path):
    """解析单个 Controller 源文件，返回 (fqn, 端点列表)。"""
    text = strip_comments(path.read_text(encoding="utf-8", errors="ignore"))
    pm, cm = PKG_RE.search(text), CLASS_RE.search(text)
    if not (cm and "Controller" in cm.group(1)):
        return "", []
    pkg = pm.group(1) if pm else ""
    cls = cm.group(1)
    fqn = f"{pkg}.{cls}" if pkg else cls
    class_pos = cm.start()

    base = ""
    for m in MAPPING_RE.finditer(text[:class_pos]):
        if m.group(1) == "RequestMapping":
            vals = _paths(m.group(2))
            base = vals[0] if vals else ""
            break

    endpoints = []
    for m in MAPPING_RE.finditer(text, class_pos):
        decl = DECL_RE.search(text[m.end():m.end() + 600])
        if not decl:
            continue
        values = _paths(m.group(2))
        if not values:
            continue
        http = _verbs(m.group(1), m.group(2))
        for value in values:
            endpoints.append({
                "path": _join(base, value),
                "http": http,
                "controller": cls,
                "controller_fqn": fqn,
                "method": decl.group(1),
                "file": to_repo_relative(path),
                "line": text.count("\n", 0, m.start()) + 1,
            })
    return fqn, endpoints


def controller_files():
    files = []
    for repo in WORKSPACE_REPOS + INFRA_REPOS:
        root = WORKSPACE_ROOT / "src" / "backend" / repo
        if not root.is_dir():
            continue
        for p in root.rglob("*Controller.java"):
            if "src/main/java" in p.as_posix():
                files.append(p)
    return sorted(files)


def source_digest(files):
    """按源码内容（而非 mtime）判定新鲜度，保证不同机器/克隆上结果可复现。"""
    h = hashlib.sha256()
    for path in files:
        h.update(to_repo_relative(path).encode("utf-8"))
        h.update(hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


def build_index(files, digest):
    endpoints = {}
    classes = set()
    for path in files:
        fqn, eps = parse_controller(path)
        if fqn:
            classes.add(fqn)
        for ep in eps:
            endpoints.setdefault(ep["path"], []).append(ep)
    for items in endpoints.values():
        items.sort(key=lambda x: (x["controller_fqn"], x["method"], x["http"]))
    return {
        "meta": {
            "source_digest": digest,
            "sources": len(files),
            "repos": WORKSPACE_REPOS + INFRA_REPOS,
            "controllers": len(classes),
            "endpoints": len(endpoints),
            "mappings": sum(len(v) for v in endpoints.values()),
        },
        "endpoints": dict(sorted(endpoints.items())),
    }


def load_index(files, rebuild=False):
    digest = source_digest(files)
    if not rebuild and ENDPOINT_FILE.exists():
        try:
            cached = json.loads(ENDPOINT_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cached = None
        if cached and cached.get("meta", {}).get("source_digest") == digest:
            return cached, False
    index = build_index(files, digest)
    ENDPOINT_FILE.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    return index, True


def match_backend(endpoints, url):
    """精确匹配优先，其次逐段剥离网关/服务前缀做后缀匹配。"""
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
    return []


def load_front_db():
    if not FRONT_DB_FILE.exists():
        sys.exit(f"前端链路库不存在: {FRONT_DB_FILE}\n"
                 "请先运行 scripts/front/html_scan.py → js_scan.py → build_front_chain_db.py")
    return json.loads(FRONT_DB_FILE.read_text(encoding="utf-8"))


def chain_records(db, endpoints):
    """展开为 (chain, request, backend 匹配列表)。"""
    reqs = db["requests"]
    out = []
    for chain in db["chains"]:
        req = reqs.get(chain.get("request")) or {}
        out.append((chain, req, match_backend(endpoints, req.get("url_path"))))
    return out


def js_path(chain):
    return " → ".join(f"{s['name']} ({s['file'].split('/')[-1]}:{s.get('line', '')})"
                      for s in chain.get("path") or [])


def service_hint(url_path):
    """未匹配时用 URL 首段提示服务前缀，避免读者误以为链路缺失。"""
    segs = (url_path or "").strip("/").split("/")
    return segs[0] if segs and segs[0] else "未知服务"


def one_line(chain, req, backends):
    elem_id = (chain.get("element") or "").split("#", 1)[-1]
    label = chain.get("label") or elem_id
    if chain.get("label") and elem_id and not elem_id.startswith("__"):
        label += f"#{elem_id}"
    backend = (" | ".join(f"{b['controller']}.{b['method']}" for b in backends)
               or f"(工作区外: {service_hint(req.get('url_path'))})")
    return (f"  [{chain['page']}] [{chain.get('source', '')}] {label}  "
            f"({js_path(chain)})  ⇒ {req.get('method', '')} {req.get('url_path', '')}  → {backend}")


def print_detail(chain, req, backends):
    print(f"\n[{chain.get('source', '')}] {chain['page']}")
    elem_id = (chain.get("element") or "").split("#", 1)[-1]
    print(f"  元素: {chain.get('label') or elem_id} ({elem_id})  事件 {chain.get('event', '')}")
    for i, step in enumerate(chain.get("path") or []):
        print(f"    {'└─' if i == len(chain['path']) - 1 else '├─'} "
              f"{step['name']}  ({step['file']}:{step.get('line', '')})")
    print(f"  请求: {req.get('method', '')} {req.get('url_path', '')}  "
          f"[{req.get('url_expr', '')} / {req.get('wrapper', '')}]")
    if backends:
        for b in backends:
            print(f"  后端: {b['controller_fqn']}.{b['method']}  ({b['http']} {b['path']}, "
                  f"{b['file']}:{b['line']})")
    else:
        print(f"  后端: 工作区外服务 {service_hint(req.get('url_path'))}，"
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


def cmd_stats(records, index, db):
    meta = index["meta"]
    matched = [r for r in records if r[2]]
    url_total = {r.get("url_path") for r in db["requests"].values() if r.get("url_path")}
    url_hit = {u for u in url_total if match_backend(index["endpoints"], u)}
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


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command",
                        choices=["stats", "page", "element", "url", "controller", "method"])
    parser.add_argument("keyword", nargs="?")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--detail", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--rebuild", action="store_true", help="强制重建 Controller 端点缓存")
    args = parser.parse_args()

    files = controller_files()
    if not files:
        sys.exit(f"未找到 Controller 源文件，请确认工作区根目录: {WORKSPACE_ROOT}")
    index, rebuilt = load_index(files, args.rebuild)
    if rebuilt:
        print(f"[端点索引已重建: {index['meta']['controllers']} Controller / "
              f"{index['meta']['endpoints']} 端点]", file=sys.stderr)

    db = load_front_db()
    records = chain_records(db, index["endpoints"])

    if args.command == "stats":
        cmd_stats(records, index, db)
        return
    if not args.keyword:
        parser.error(f"{args.command} 需要关键字")
    kw = args.keyword.lower()

    if args.command == "page":
        rows = [r for r in records if kw in r[0]["page"].lower()]
    elif args.command == "element":
        rows = [r for r in records
                if kw in (r[0].get("element") or "").lower()
                or kw in (r[0].get("label") or "").lower()]
    elif args.command == "url":
        rows = [r for r in records if kw in (r[1].get("url_path") or "").lower()]
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


if __name__ == "__main__":
    main()
