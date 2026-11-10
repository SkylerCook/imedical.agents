#!/usr/bin/env python3
"""查询前端链路库 front_chain_db.json。

用法:
    python query_front_chain.py summary
    python query_front_chain.py page <页面路径片段>
    python query_front_chain.py element <元素 id / 文案片段>
    python query_front_chain.py function <JS 方法名>
    python query_front_chain.py url <URL 片段>
    python query_front_chain.py menu <菜单名片段>
    python query_front_chain.py links <页面路径片段>

可选: --limit N（默认 20）, --json（输出原始 JSON）
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import DB_FILE


def load_db():
    if not DB_FILE.exists():
        print(f"链路库不存在: {DB_FILE}", file=sys.stderr)
        print("请先运行 js_scan.py / html_scan.py / build_front_chain_db.py", file=sys.stderr)
        sys.exit(1)
    return json.loads(DB_FILE.read_text(encoding="utf-8"))


ANONYMOUS_STEP_LABELS = {"handler": "匿名事件处理", "top_level": "页面顶层代码"}


def step_label(step):
    """`__handler_N` / `__top_level__` 是扫描器内部编号，源码中没有同名函数。"""
    name = (step.get("name") or "").strip()
    if name and not name.startswith("__"):
        return name
    kind = "handler" if name.startswith("__handler_") else "top_level"
    return ANONYMOUS_STEP_LABELS[kind]


def chain_line(db, chain, limit=20, show_page=True):
    names = " → ".join(step_label(step) for step in chain["path"])
    elem_id = chain["element"].split("#", 1)[-1]
    label = chain.get("label") or elem_id
    if chain.get("label") and elem_id and not elem_id.startswith("__"):
        label += f"#{elem_id}"
    prefix = f"[{chain['page']}] " if show_page else ""
    line = f"  {prefix}[{chain['event']}] {label}"
    line += f"  ({names})  ⇒ {chain['method']} {chain['url_path']}"
    if chain["url_expr"] and chain["url_expr"] != chain["url_path"]:
        line += f"   [expr: {chain['url_expr']}]"
    return line


def print_chains(db, chains, limit):
    if not chains:
        print("  (无链路)")
        return
    for chain in chains[:limit]:
        print(chain_line(db, chain))
    if len(chains) > limit:
        print(f"  ... 共 {len(chains)} 条，已截断")


def cmd_summary(db):
    meta = db["meta"]
    counts = meta.get("counts", {})
    print(f"生成时间: {meta.get('generated_at')}")
    print(f"菜单来源: {meta.get('menu_source') or '(未导入 menu_snapshot.json)'}")
    print("规模: " + " / ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    modules = {}
    for page, info in db["pages"].items():
        mod = info.get("module") or "(root)"
        stat = modules.setdefault(mod, {"pages": 0, "chains": 0})
        stat["pages"] += 1
        stat["chains"] += info.get("chain_count", 0)
    print("\n按模块:")
    for mod, stat in sorted(modules.items(), key=lambda kv: -kv[1]["chains"]):
        print(f"  {mod:<12} 页面 {stat['pages']:>4}  链路 {stat['chains']:>6}")
    roles = {}
    for info in db["pages"].values():
        roles[info.get("role", "")] = roles.get(info.get("role", ""), 0) + 1
    print("\n页面角色: " + " / ".join(f"{k}={v}" for k, v in sorted(roles.items())))
    top = sorted(db["pages"].items(), key=lambda kv: -kv[1].get("chain_count", 0))[:10]
    print("\n链路最多的页面:")
    for page, info in top:
        print(f"  {info.get('chain_count', 0):>5}  {page}  {info.get('title', '')}")


def cmd_page(db, keyword, limit):
    hits = [(p, i) for p, i in db["pages"].items() if keyword.lower() in p.lower()]
    if not hits:
        print("未找到页面")
        return
    for page, info in sorted(hits)[:limit]:
        print(f"\n{page}")
        print(f"  标题: {info.get('title')}  | 角色: {info.get('role')}  | 模块: {info.get('module')}")
        if info.get("menus"):
            print(f"  菜单: {', '.join(info['menus'])}")
        if info.get("frames"):
            print(f"  内嵌: {', '.join(info['frames'][:6])}")
        links = [l for l in db.get("page_links", []) if l["from"] == page]
        if links:
            by_type = {}
            for l in links:
                by_type.setdefault(l["type"], []).append(l["to"])
            print("  指向界面: " + "；".join(
                f"{t} {len(v)}（{', '.join(sorted(set(v))[:4])}）" for t, v in sorted(by_type.items())))
        print(f"  元素 {info.get('element_count')} / 可操作 {info.get('actionable_count')} / "
              f"请求 {info.get('request_count')} / 链路 {info.get('chain_count')}")
        chains = [c for c in db["chains"] if c["page"] == page]
        by_elem = {}
        for c in chains:
            by_elem.setdefault((c["element"], c["label"], c["event"]), []).append(c)
        print("  操作链路:")
        shown = 0
        for (elem, label, event), items in by_elem.items():
            if shown >= limit:
                print("  ...")
                break
            print(f"    - {label or elem.split('#', 1)[-1]} [{event}]  {len(items)} 条请求")
            for c in items[:4]:
                print(chain_line(db, c, show_page=False))
            shown += 1


def cmd_element(db, keyword, limit):
    hits = [(k, e) for k, e in db["elements"].items()
            if keyword.lower() in k.lower() or keyword in (e.get("label") or "")]
    if not hits:
        print("未找到操作元素")
        return
    print(f"命中 {len(hits)} 个元素，展示前 {min(limit, len(hits))} 个:")
    for key, elem in sorted(hits)[:limit]:
        print(f"\n{key}")
        print(f"  标签 {elem.get('tag')} / 文案 {elem.get('label')} / 事件 {elem.get('event')} / "
              f"handler {elem.get('handler')}（{elem.get('handler_source')}）")
        print(f"  处理函数: {elem.get('handler_fn') or '(未解析)'}")
        chains = [c for c in db["chains"] if c["element"] == key]
        print_chains(db, chains, limit)


def cmd_function(db, keyword, limit):
    hits = [(k, f) for k, f in db["functions"].items() if keyword.lower() in k.lower()]
    if not hits:
        print("未找到可达函数（链路库只保留从界面可达的方法）")
        return
    callers = {}
    for fid, fn in db["functions"].items():
        for call in fn.get("calls", []):
            callers.setdefault(call["target"], []).append(fid)
    for fid, fn in sorted(hits)[:limit]:
        print(f"\n{fid}")
        print(f"  {fn['kind']}  {fn['file']}:{fn['line']}")
        if fn.get("parent"):
            print(f"  父作用域: {fn['parent']}")
        if callers.get(fid):
            print(f"  被调用: {', '.join(sorted(callers[fid])[:8])}")
        calls = [c["target"] for c in fn.get("calls", [])]
        if calls:
            print(f"  调用: {', '.join(sorted(calls)[:8])}")
        requests = [db["requests"][rid] for rid in fn.get("requests", []) if rid in db["requests"]]
        for req in requests:
            print(f"  请求: {req['method']} {req['url_path']}  ({req['wrapper']})")
        chains = [c for c in db["chains"] if any(s["function"] == fid for s in c["path"])]
        print("  相关链路:")
        print_chains(db, chains, min(limit, 6))


def cmd_url(db, keyword, limit):
    hits = [(rid, r) for rid, r in db["requests"].items() if keyword.lower() in r["url_path"].lower()]
    if not hits:
        print("未找到请求")
        return
    print(f"命中 {len(hits)} 个请求，展示前 {min(limit, len(hits))} 个:")
    by_req = {}
    for c in db["chains"]:
        by_req.setdefault(c["request"], []).append(c)
    for rid, req in sorted(hits)[:limit]:
        print(f"\n{req['method']} {req['url_path']}  ({req['wrapper']})")
        print(f"  定义: {req['file']}:{req['line']}")
        print(f"  表达式: {req['url_expr']}  →  {req['url_resolved']}")
        print("  触发链路:")
        print_chains(db, by_req.get(rid, []), min(limit, 6))


def cmd_menu(db, keyword, limit):
    hits = [(p, i) for p, i in db["pages"].items()
            if any(keyword in m for m in i.get("menus", []))]
    if not hits:
        print("未找到菜单关联页面（可能未导入 menu_snapshot.json）")
        return
    for page, info in sorted(hits, key=lambda kv: kv[0])[:limit]:
        print(f"  {page}\n    菜单: {', '.join(info['menus'])}  链路 {info.get('chain_count')}")


def cmd_links(db, keyword, limit):
    """界面 → 界面：内嵌 / 配置跳转 / 按钮或页面加载弹出 / 服务端片段包含。"""
    links = db.get("page_links", [])
    incoming = {}
    for l in links:
        incoming.setdefault(l["to"], []).append(l)
    pages = [p for p in db["pages"] if keyword.lower() in p.lower()][:limit]
    if not pages:
        print("未找到页面")
        return
    for page in pages:
        out = [l for l in links if l["from"] == page]
        inc = incoming.get(page, [])
        print(f"\n{page}")
        print(f"  弹出/跳转/内嵌/包含 → {len(out)} 个界面:")
        for l in out[:limit]:
            detail = l.get("element", "").split("#")[-1] or l.get("function", "").rsplit("::", 1)[-1]
            print(f"    [{l['type']}/{l['source']}] {l['to']}"
                  f"  (opener={l.get('opener', '')}, 触发={detail})")
        if len(out) > limit:
            print(f"    ... 共 {len(out)} 条")
        print(f"  被以下界面指向: {len(inc)}")
        for l in inc[:limit]:
            print(f"    [{l['type']}/{l['source']}] {l['from']}")
        if len(inc) > limit:
            print(f"    ... 共 {len(inc)} 条")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["summary", "page", "element", "function", "url", "menu", "links"])
    parser.add_argument("keyword", nargs="?")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    db = load_db()

    if args.command == "summary":
        cmd_summary(db)
        return
    if not args.keyword:
        parser.error(f"{args.command} 需要关键字")
    if args.command == "page":
        cmd_page(db, args.keyword, args.limit)
    elif args.command == "element":
        cmd_element(db, args.keyword, args.limit)
    elif args.command == "function":
        cmd_function(db, args.keyword, args.limit)
    elif args.command == "url":
        cmd_url(db, args.keyword, args.limit)
    elif args.command == "menu":
        cmd_menu(db, args.keyword, args.limit)
    elif args.command == "links":
        cmd_links(db, args.keyword, args.limit)


if __name__ == "__main__":
    main()
