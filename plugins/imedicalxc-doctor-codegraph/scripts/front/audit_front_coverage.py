#!/usr/bin/env python3
"""前端链路归属审计：确认 URL 是否都能落到「界面 → 操作元素 → JS 方法」。

只读 front_chain_db.json / front_pages.jsonl / front_js_index.jsonl，输出四类口径：
    1. 已解析 URL：页面 / 元素 / JS 路径引用完整性，handler 是否属于页面脚本
    2. 未解析 URL：从界面可达的请求点、不可达请求点、失败原因分类
    3. 触发点：页面/元素覆盖率，有 handler 但无请求的拆分
    4. 配置注入：分组绑定与缺失

用法:
    python audit_front_coverage.py [--json]
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import DB_FILE, FRONT_ROOT, JS_INDEX_FILE, PAGES_FILE

_MEMBER_CONST = re.compile(r"[A-Za-z_$][\w$]*(\.[\w$]+)+")
_BARE_VAR = re.compile(r"[A-Za-z_$][\w$]*")


def classify(expr):
    text = (expr or "").strip()
    if text[:1] in "'\"":
        return "字面量未通过字符集/长度校验"
    if _MEMBER_CONST.fullmatch(text):
        return "成员常量未回填"
    if _BARE_VAR.fullmatch(text):
        return "运行时变量"
    if "+" in text:
        return "拼接含未解析项"
    return "其他"


def audit_existence(db):
    """界面与 JS 方法必须落在 static 实体文件上，不允许名称合成的幽灵节点。"""
    missing = Counter()
    samples = {}

    def check(kind, rel):
        rel = (rel or "").strip()
        if not rel or (FRONT_ROOT / rel).is_file():
            return
        missing[kind] += 1
        bucket = samples.setdefault(kind, [])
        if len(bucket) < 5:
            bucket.append(rel)

    for page in db["pages"]:
        check("page", page)
    for fn in db["functions"].values():
        check("function_file", fn.get("file"))
    for chain in db["chains"]:
        check("chain_page", chain.get("page"))
        for step in chain.get("path") or []:
            check("chain_file", step.get("file"))
    for link in db.get("page_links") or []:
        check("link_from", link.get("from"))
        check("link_to", link.get("to"))

    return {"missing": dict(missing), "samples": samples,
            "ok": not missing}


def audit():
    db = json.load(open(DB_FILE, encoding="utf-8"))
    pages, elements, functions = db["pages"], db["elements"], db["functions"]
    requests, chains = db["requests"], db["chains"]
    meta = db.get("meta", {}).get("counts", {})

    page_scripts = {}
    for line in open(PAGES_FILE, encoding="utf-8"):
        rec = json.loads(line)
        page_scripts[rec.get("file", "")] = set(rec.get("scripts") or [])

    # 1. 已解析 URL 的引用完整性
    bad = Counter()
    weak = []
    for chain in chains:
        if chain["page"] not in pages:
            bad["page"] += 1
        if chain["element"] not in elements:
            bad["element"] += 1
        for step in chain["path"]:
            if step["function"] not in functions:
                bad["function"] += 1
                break
        first = chain["path"][0] if chain["path"] else None
        if first and first["file"] not in page_scripts.get(chain["page"], set()):
            weak.append(chain)
    used = {chain["request"] for chain in chains}
    paths = {(r["method"], r["url_path"]) for r in requests.values()}

    # 2. 未解析 URL：区分可达 / 不可达
    reachable = set(functions)
    raw_by_fn = {}
    total_raw = 0
    unreachable_raw = 0
    for line in open(JS_INDEX_FILE, encoding="utf-8"):
        rec = json.loads(line)
        if rec.get("error") or rec.get("skipped"):
            continue
        for fn in rec.get("functions", []):
            raw = fn.get("requests", [])
            total_raw += len(raw)
            if fn["id"] in reachable:
                if raw:
                    raw_by_fn[fn["id"]] = raw
            else:
                unreachable_raw += len(raw)

    unresolved = []
    for fid, raws in raw_by_fn.items():
        for idx, req in enumerate(raws):
            if f"{fid}#r{idx}" not in requests:
                unresolved.append((fid, req.get("line", 0), req.get("url_expr", "")))
    reasons = Counter(classify(expr) for _, _, expr in unresolved)
    expr_top = Counter(expr for _, _, expr in unresolved).most_common(10)

    # 3. 触发点覆盖
    actionable_pages = [k for k, v in pages.items() if v.get("actionable_count", 0) > 0]
    no_chain_pages = [k for k in actionable_pages if pages[k].get("chain_count", 0) == 0]
    with_handler = [e for e in elements.values() if e.get("handler")]
    unresolved_handler = [e for e in with_handler if not e.get("handler_fn")]
    empty_req = [e for e in with_handler if not e.get("requests")]
    fn_has_raw = {fid for fid, raws in raw_by_fn.items() if raws}
    empty_all_unresolved = [e for e in empty_req if e.get("handler_fn") in fn_has_raw]
    empty_no_request = len(empty_req) - len(empty_all_unresolved)
    handler_top = Counter(e["handler"] for e in unresolved_handler).most_common(10)

    return {
        "resolved": {
            "url_paths": len(paths),
            "request_records": len(requests),
            "chains": len(chains),
            "requests_without_chain": len([r for r in requests if r not in used]),
            "dangling": dict(bad),
            "weak_handler_scope": {
                "chains": len(weak),
                "pages": len({c["page"] for c in weak}),
                "url_paths": len({(c["method"], c["url_path"]) for c in weak}),
            },
        },
        "unresolved": {
            "raw_request_sites": total_raw,
            "reachable_unresolved_sites": len(unresolved),
            "reachable_unresolved_exprs": len({expr for _, _, expr in unresolved}),
            "reachable_unresolved_functions": len({fid for fid, _, _ in unresolved}),
            "unreachable_raw_sites": unreachable_raw,
            "reasons": dict(reasons.most_common()),
            "top_exprs": expr_top,
        },
        "triggers": {
            "pages": len(pages),
            "pages_actionable": len(actionable_pages),
            "pages_actionable_without_chain": len(no_chain_pages),
            "elements": len(elements),
            "elements_with_handler": len(with_handler),
            "handler_unresolved": len(unresolved_handler),
            "handler_unresolved_top": handler_top,
            "elements_handler_no_request": len(empty_req),
            "  all_urls_unresolved": len(empty_all_unresolved),
            "  handler_itself_has_no_request": empty_no_request,
        },
        # 4. 配置注入：分组是否都绑到了页面元素
        "config": {
            "groups_bound": meta.get("config_groups_bound", 0),
            "groups_missing": meta.get("config_groups_missing", 0),
            "items": meta.get("config_items", 0),
            "nav_items": meta.get("config_nav_items", 0),
            "nav_links": meta.get("config_nav_links", 0),
            "unresolved_calls": meta.get("config_unresolved_calls", 0),
        },
        # 5. 界面 → 界面：内嵌 / 配置跳转 / 弹窗
        "page_links": {
            "total": meta.get("page_links", 0),
            "popup": meta.get("page_links_popup", 0),
            "config": meta.get("page_links_config", 0),
            "frame": meta.get("page_links_frame", 0),
            "include": meta.get("page_links_include", 0),
            "unresolved_targets": meta.get("unresolved_open_targets", 0),
            "runtime_targets": meta.get("open_targets_runtime", 0),
            "non_page_targets": meta.get("open_targets_non_page", 0),
            "pages_with_popup": len({l["from"] for l in db.get("page_links", [])
                                    if l["type"] == "弹出"}),
            "isolated_pages": len([p for p in pages
                                   if not any(l["from"] == p or l["to"] == p
                                              for l in db.get("page_links", []))]),
        },
        # 6. 实体存在性：页面 / JS 文件 / 界面关系端点必须落在 static 下
        "existence": audit_existence(db),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()
    result = audit()
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=1))
        return 1 if not result["existence"]["ok"] else 0

    res, un, tr = result["resolved"], result["unresolved"], result["triggers"]
    print("[已解析 URL]")
    print(f"  URL 路径 {res['url_paths']} 个 / 请求记录 {res['request_records']} 条 / 链路 {res['chains']} 条")
    print(f"  无链路的请求记录: {res['requests_without_chain']}")
    print(f"  悬空引用: {res['dangling'] or '无'}")
    weak = res["weak_handler_scope"]
    print(f"  handler 不在页面脚本列表的链路: {weak['chains']} 条 / {weak['pages']} 页 / {weak['url_paths']} 个 URL")
    print("[未解析 URL]")
    print(f"  扫描到的请求点共 {un['raw_request_sites']} 处")
    print(f"  界面可达但地址解析失败: {un['reachable_unresolved_sites']} 处 / "
          f"{un['reachable_unresolved_functions']} 个函数 / {un['reachable_unresolved_exprs']} 种表达式")
    print(f"  无任何界面入口（不可达）: {un['unreachable_raw_sites']} 处")
    for reason, count in un["reasons"].items():
        print(f"    {reason}: {count}")
    print("  高频表达式:")
    for expr, count in un["top_exprs"]:
        print(f"    {count:6d}  {expr[:100]}")
    print("[触发点]")
    print(f"  页面 {tr['pages']} / 有可操作元素 {tr['pages_actionable']} / 可操作但无链路 {tr['pages_actionable_without_chain']}")
    print(f"  元素 {tr['elements']} / 有 handler {tr['elements_with_handler']} / handler 未解析 {tr['handler_unresolved']}")
    print(f"  有 handler 但 0 请求: {tr['elements_handler_no_request']}"
          f"（请求全部未解析 {tr['  all_urls_unresolved']} / handler 本身无请求 {tr['  handler_itself_has_no_request']}）")
    print("  handler 未解析 Top:", ", ".join(f"{n}×{c}" for n, c in tr["handler_unresolved_top"]))
    cf = result["config"]
    print("[配置注入]")
    print(f"  分组绑定 {cf['groups_bound']} / 缺失 {cf['groups_missing']}；配置项 {cf['items']}"
          f"（跳转 {cf['nav_items']}，页面跳转边 {cf['nav_links']}）；未解析调用 {cf['unresolved_calls']}")
    pl = result["page_links"]
    print("[界面关系]")
    print(f"  界面 → 界面边 {pl['total']}"
          f"（弹出 {pl['popup']} / 跳转 {pl['config']} / 内嵌 {pl['frame']} / 包含 {pl['include']}）")
    print(f"  有弹出关系的界面 {pl['pages_with_popup']}；无任何界面关系的页面 {pl['isolated_pages']}")
    print(f"  弹窗/跳转地址未落地 {pl['unresolved_targets']}"
          f"（运行时变量 {pl['runtime_targets']} / 非静态页面 {pl['non_page_targets']}）")
    ex = result["existence"]
    print("[实体存在性]")
    if ex["ok"]:
        print("  页面 / JS 文件 / 界面关系端点全部落在 static 下")
    else:
        for kind, count in sorted(ex["missing"].items()):
            print(f"  缺失 {kind}: {count} 处，示例: {', '.join(ex['samples'].get(kind, []))}")
    return 1 if not ex["ok"] else 0


if __name__ == "__main__":
    sys.exit(main())
