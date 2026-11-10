#!/usr/bin/env python3
"""探索/导出服务端配置注入，生成 config_injection_snapshot.json。

配置注入的源头（按钮栏、右键菜单、执行单按钮）在不同模块组里形态不同，
场景登记在 config_injection.py。本脚本只做三件事：

    1. --list        列出已登记场景、依赖表、前端识别接口
    2. --emit-sql    输出每个场景的查询 SQL（供数据库 MCP 逐条执行）
    3. --from-db / --from-json  归一化后写入快照

MCP 工作流（推荐，凭据不进脚本）:
    python explore_config_injection.py --emit-sql
    # 在会话里用 mcp__kingbase_87__kb_query 执行上述 SQL
    # 把每个场景的 rows 存成 {"doc_btnbar": [...], "oe_view_right_menu": [...]}
    python explore_config_injection.py --from-json dump.json

--from-db 读取环境变量 KB_HOST KB_PORT KB_DATABASE KB_USER KB_PASSWORD [KB_SCHEMA=sm_his]
"""
import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import CONFIG_INJECTION_FILE
from config_injection import SCENARIOS, SCENARIO_BY_ID, normalize_rows, sql_for

_REQUIRED_ENV = ("KB_HOST", "KB_PORT", "KB_DATABASE", "KB_USER", "KB_PASSWORD")


def _db_connect():
    missing = [name for name in _REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        print("NEED_CREDS: 缺少数据库环境变量 " + ", ".join(missing), file=sys.stderr)
        print("或改用 --emit-sql + 数据库 MCP 导出 --from-json", file=sys.stderr)
        sys.exit(2)
    try:
        import psycopg2
    except ImportError:
        print("NEED_DEPS: 需要 psycopg2（或 psycopg2-binary）连接 Kingbase", file=sys.stderr)
        sys.exit(2)
    return psycopg2.connect(
        host=os.environ["KB_HOST"], port=os.environ["KB_PORT"],
        dbname=os.environ["KB_DATABASE"], user=os.environ["KB_USER"],
        password=os.environ["KB_PASSWORD"], connect_timeout=10,
    )


def _fetch_scenario(conn, scenario, schema):
    with conn.cursor() as cur:
        cur.execute(sql_for(scenario, schema))
        columns = [d[0] for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def _rows_of(payload):
    """兼容 MCP 结果对象 {rowCount, columns, rows} 与纯数组。"""
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    if isinstance(payload, list):
        return payload
    raise ValueError("期望 rows 数组或 {rows: [...]}")


def _load_json(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {"__single__": data}
    if isinstance(data, dict) and "rows" in data:
        return {"__single__": _rows_of(data)}
    if isinstance(data, dict) and isinstance(data.get("scenarios"), dict):
        data = data["scenarios"]
    if not isinstance(data, dict):
        raise ValueError("JSON 需为 {api/scenario: rows} 或 rows 数组")
    return {key: _rows_of(value) for key, value in data.items()}


def _resolve_scenario_key(key):
    """支持接口名（getBtnCfgData）或场景 id（doc_btnbar）。"""
    if key in SCENARIO_BY_ID:
        return key
    for scenario in SCENARIOS:
        if key in scenario.get("detect", []):
            return scenario["id"]
    return ""


def build_snapshot(raw_by_scenario, source):
    scenarios = {}
    all_rows = []
    groups = {}
    for scenario in SCENARIOS:
        raw = raw_by_scenario.get(scenario["id"], [])
        rows = normalize_rows(scenario, raw)
        if not rows:
            continue
        groups_by_key = {}
        for rec in rows:
            groups_by_key.setdefault(rec["grp"], []).append(rec)
        groups.update({f"{scenario['id']}::{grp}": items for grp, items in groups_by_key.items()})
        all_rows.extend(rows)
        scenarios[scenario["id"]] = {
            "label": scenario["label"],
            "binding": scenario["binding"],
            "detect": scenario["detect"],
            "tables": scenario["tables"],
            "groups": len(groups_by_key),
            "rows": len(rows),
            "handlers": sum(1 for r in rows if r["handler"]),
            "urls": sum(1 for r in rows if r["url"]),
        }
    return {
        "source": source,
        "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
        "scenarios": scenarios,
        "stats": {
            "scenarios": len(scenarios),
            "groups": len(groups),
            "rows": len(all_rows),
            "handlers": sum(1 for r in all_rows if r["handler"]),
            "urls": sum(1 for r in all_rows if r["url"]),
        },
        "groups": {key: groups[key] for key in sorted(groups)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true", help="列出登记场景")
    parser.add_argument("--emit-sql", action="store_true", help="输出各场景查询 SQL")
    parser.add_argument("--from-db", action="store_true", help="直连 Kingbase 导出")
    parser.add_argument("--from-json", help="导入数据库 MCP 查询结果 JSON")
    parser.add_argument("--scenario", help="只处理指定场景（--from-json 单接口结果时必填）")
    parser.add_argument("--schema", default=os.environ.get("KB_SCHEMA", "sm_his"))
    parser.add_argument("--out", default=str(CONFIG_INJECTION_FILE))
    args = parser.parse_args()

    if args.list:
        print(f"{'场景':<22}{'绑定方式':<24}{'依赖表':<52}前端识别接口")
        for scenario in SCENARIOS:
            print(f"{scenario['id']:<22}{scenario['binding']:<24}"
                  f"{','.join(scenario['tables']):<52}{','.join(scenario['detect']) or '-'}")
        return

    if args.emit_sql:
        chosen = [SCENARIO_BY_ID[args.scenario]] if args.scenario else SCENARIOS
        for scenario in chosen:
            print(f"-- scenario: {scenario['id']} ({scenario['label']})")
            print(sql_for(scenario, args.schema).rstrip(";") + ";")
            print()
        return

    if args.from_db and args.from_json:
        parser.error("--from-db 与 --from-json 只能二选一")
    if args.from_db:
        conn = _db_connect()
        try:
            chosen = [SCENARIO_BY_ID[args.scenario]] if args.scenario else SCENARIOS
            raw = {s["id"]: _fetch_scenario(conn, s, args.schema) for s in chosen}
        finally:
            conn.close()
        source = f"db:{os.environ.get('KB_HOST')}/{os.environ.get('KB_DATABASE')}/{args.schema}"
    elif args.from_json:
        loaded = _load_json(args.from_json)
        raw = {}
        for key, rows in loaded.items():
            if key == "__single__":
                if not args.scenario:
                    parser.error("JSON 为单场景 rows 数组时必须提供 --scenario")
                scenario_id = _resolve_scenario_key(args.scenario)
                if not scenario_id:
                    parser.error(f"未知场景或接口: {args.scenario}")
                raw.setdefault(scenario_id, []).extend(rows)
                continue
            scenario_id = _resolve_scenario_key(key)
            if not scenario_id:
                print(f"WARN: 跳过未知场景键 {key}", file=sys.stderr)
                continue
            raw.setdefault(scenario_id, []).extend(rows)
        source = f"json:{Path(args.from_json).name}"
    else:
        parser.error("需要 --from-db、--from-json、--emit-sql 或 --list")

    snapshot = build_snapshot(raw, source)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, indent=1) + "\n",
                   encoding="utf-8")
    stats = snapshot["stats"]
    print(f"场景 {stats['scenarios']} 个 / 分组 {stats['groups']} 个 / 配置项 {stats['rows']} 条 "
          f"（可点击 {stats['handlers']} / 跳转 {stats['urls']}）→ {out}")
    for scenario_id, item in snapshot["scenarios"].items():
        print(f"  {scenario_id}: 分组 {item['groups']} / 配置项 {item['rows']} / "
              f"handler {item['handlers']} / url {item['urls']}")


if __name__ == "__main__":
    main()
