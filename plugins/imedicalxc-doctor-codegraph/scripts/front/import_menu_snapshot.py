#!/usr/bin/env python3
"""导入菜单/按钮栏快照，为页面补充业务角色。

菜单是 HTML 页面用途的权威来源，但数据在 Kingbase 中，不适合在扫描期直连。
本脚本把菜单与配置按钮导出为 menu_snapshot.json，构建链路库时作为可选输入。

用法:
    python import_menu_snapshot.py --from-db
    python import_menu_snapshot.py --from-json menu_raw.json
    python import_menu_snapshot.py --from-json menu_raw.json --out custom.json

--from-db 读取以下环境变量（缺失时以 NEED_CREDS 退出，不读取任何本地凭据文件）:
    KB_HOST KB_PORT KB_DATABASE KB_USER KB_PASSWORD [KB_SCHEMA=sm_his]
"""
import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import MENU_SNAPSHOT_FILE, normalize_router

_REQUIRED_ENV = ("KB_HOST", "KB_PORT", "KB_DATABASE", "KB_USER", "KB_PASSWORD")


def _db_connect():
    missing = [name for name in _REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        print("NEED_CREDS: 缺少数据库环境变量 " + ", ".join(missing), file=sys.stderr)
        print("示例: KB_HOST=127.0.0.1 KB_PORT=54321 KB_DATABASE=db_his "
              "KB_USER=xxx KB_PASSWORD=xxx python import_menu_snapshot.py --from-db", file=sys.stderr)
        sys.exit(2)
    try:
        import psycopg2
    except ImportError:
        print("NEED_DEPS: 需要 psycopg2（或 psycopg2-binary）连接 Kingbase", file=sys.stderr)
        sys.exit(2)
    return psycopg2.connect(
        host=os.environ["KB_HOST"],
        port=os.environ["KB_PORT"],
        dbname=os.environ["KB_DATABASE"],
        user=os.environ["KB_USER"],
        password=os.environ["KB_PASSWORD"],
        connect_timeout=10,
    )


def _fetch_db(schema):
    conn = _db_connect()
    try:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT name, router, params, load_type, weight
            FROM {schema}.hos_sys_resource
            WHERE router LIKE '%html%'
              AND type IN ('M', 'B')
              AND COALESCE(is_deleted, 0) = 0
            ORDER BY weight, name
        """)
        menus = [dict(zip(("name", "router", "params", "load_type", "weight"), row))
                 for row in cur.fetchall()]
        cur.execute(f"""
            SELECT b.code, b.name, i.code, i.name, i.url, i.click_handler, i.active_flag
            FROM {schema}.cf_doc_config_btnbar b
            JOIN {schema}.cf_doc_config_btnbar_item i ON i.btnbar_dr = b.id
            ORDER BY b.code, i.sequece
        """)
        buttons = [dict(zip(("bar_code", "bar_name", "code", "name", "url", "handler", "active"), row))
                   for row in cur.fetchall()]
        return menus, buttons
    finally:
        conn.close()


def _fetch_json(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data, []
    return data.get("menus", []), data.get("buttons", [])


def _as_text(value):
    return "" if value is None else str(value).strip()


def _page_of(router):
    page = normalize_router(_as_text(router))
    return page if page.lower().endswith((".html", ".htm")) else ""


def normalize(menus, buttons, source):
    page_menu = {}
    norm_menus = []
    seen = set()
    for row in menus:
        name = _as_text(row.get("name"))
        router = _as_text(row.get("router"))
        page = _page_of(router)
        if not name or not page:
            continue
        key = (name, page)
        if key in seen:
            continue
        seen.add(key)
        norm_menus.append({
            "name": name,
            "page": page,
            "params": _as_text(row.get("params")),
            "load_type": _as_text(row.get("load_type")),
            "weight": row.get("weight"),
        })
        page_menu.setdefault(page, []).append(name)

    norm_buttons = []
    for row in buttons:
        handler = _as_text(row.get("handler"))
        if not handler:
            continue
        norm_buttons.append({
            "bar_code": _as_text(row.get("bar_code")),
            "bar_name": _as_text(row.get("bar_name")),
            "code": _as_text(row.get("code")),
            "name": _as_text(row.get("name")),
            "handler": handler,
            "url": _as_text(row.get("url")),
            "active": _as_text(row.get("active")),
        })

    return {
        "source": source,
        "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
        "menus": sorted(norm_menus, key=lambda m: (m["page"], m["name"])),
        "buttons": sorted(norm_buttons, key=lambda b: (b["bar_code"], b["code"], b["name"])),
        "page_menu": {page: sorted(names) for page, names in sorted(page_menu.items())},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-db", action="store_true", help="从 Kingbase 导出菜单与按钮栏")
    parser.add_argument("--from-json", help="从已有 JSON（含 menus/buttons 数组）导入")
    parser.add_argument("--schema", default=os.environ.get("KB_SCHEMA", "sm_his"))
    parser.add_argument("--out", default=str(MENU_SNAPSHOT_FILE))
    args = parser.parse_args()

    if args.from_db and args.from_json:
        parser.error("--from-db 与 --from-json 只能二选一")
    if args.from_db:
        menus, buttons = _fetch_db(args.schema)
        source = f"db:{os.environ.get('KB_HOST')}/{os.environ.get('KB_DATABASE')}/{args.schema}"
    elif args.from_json:
        menus, buttons = _fetch_json(args.from_json)
        source = f"json:{Path(args.from_json).name}"
    else:
        parser.error("需要 --from-db 或 --from-json")

    snapshot = normalize(menus, buttons, source)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, indent=1) + "\n",
                   encoding="utf-8")
    print(f"菜单 {len(snapshot['menus'])} 条 / 页面 {len(snapshot['page_menu'])} 个 / "
          f"按钮 {len(snapshot['buttons'])} 条 → {out}")


if __name__ == "__main__":
    main()
