#!/usr/bin/env python3
"""导出服务总线（db_hsb.sm_hsb）生产者/消费者证据，生成 aggregation_raw.json。

总线库不在工作区，扫描期不直连。推荐用 MCP 逐条执行 SQL，再由
capture_mcp_results.py 从会话记录回填：

    python collect_sm_hsb.py --emit-sql
    # 在会话里用 kingbase-87-aggregation 的 kb_query 执行每条 SQL
    python capture_mcp_results.py --transcript <会话.jsonl>
    python build_aggregation_db.py

也可直连导出（凭据只从环境变量读取）：

    KB_HOST=... KB_PORT=54321 KB_DATABASE=db_hsb KB_USER=... KB_PASSWORD=... \\
        python collect_sm_hsb.py --from-db

或导入已有的 {"dataset_id": rows} JSON：

    python collect_sm_hsb.py --from-json dump.json
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import DB_LABEL, RAW_FILE, SCHEMA

_REQUIRED_ENV = ("KB_HOST", "KB_PORT", "KB_DATABASE", "KB_USER", "KB_PASSWORD")

# 每个数据集只取绑定关系需要的列；密钥/凭据列一律不出现（见 config.SENSITIVE_COLUMNS）。
# 大表（消息 566 行）分页拉取，其余数据集按服务/模块聚合，行数有界。
DATASETS = [
    {
        "id": "systems",
        "title": "接入系统",
        "expected": 26,
        "sql": """
SELECT id, access_name, company, status, is_system, system_key, organ_code, index_uri
FROM {schema}.sys_access_system_organ
WHERE COALESCE(del_flag, '0') = '0'
ORDER BY access_name, id
""",
    },
    {
        "id": "registered_services",
        "title": "注册服务（服务提供方）",
        "expected": 33,
        "sql": """
SELECT id, service_buscode, service_code, service_name, service_type, service_status,
       service_provider, service_poolsize, service_queues, service_timeout,
       consumer_pool_size, retry_count
FROM {schema}.registered_service
ORDER BY service_code, id
""",
    },
    {
        "id": "registered_endpoints",
        "title": "注册服务端点（按服务+模块聚合）",
        "expected": 111,
        "sql": """
SELECT s.service_code,
       s.service_provider,
       COALESCE(NULLIF(
           CASE WHEN r.resource_url LIKE '/api/openapi/%'
                THEN split_part(r.resource_url, '/', 4)
                ELSE split_part(ltrim(COALESCE(r.resource_url, ''), '/'), '/', 1)
           END, ''), '') AS module,
       count(*) AS n,
       string_agg(r.resource_code, ',' ORDER BY r.resource_code) AS codes
FROM {schema}.registered_service_restresource r
JOIN {schema}.registered_service_rest rr ON rr.id = r.rest_id
JOIN {schema}.registered_service s ON s.id = rr.service_id
GROUP BY s.service_code, s.service_provider, module
ORDER BY s.service_code, module
""",
    },
    {
        "id": "published_services",
        "title": "发布服务（服务调用方）",
        "expected": 28,
        "sql": """
SELECT id, service_buscode, service_code, service_name, service_desc, service_status,
       service_type, service_provider, service_poolsize
FROM {schema}.published_service
ORDER BY service_code, id
""",
    },
    {
        "id": "published_endpoints",
        "title": "发布服务端点（按服务+模块聚合）",
        "expected": 483,
        "sql": """
SELECT p.service_code,
       p.service_provider,
       COALESCE(NULLIF(
           CASE WHEN pr.resource_url LIKE '/api/openapi/%'
                THEN split_part(pr.resource_url, '/', 4)
                ELSE split_part(ltrim(COALESCE(pr.resource_url, ''), '/'), '/', 1)
           END, ''), '') AS module,
       count(*) AS n,
       string_agg(pr.resource_code, ',' ORDER BY pr.resource_code) AS codes
FROM {schema}.published_service_restresource pr
JOIN {schema}.published_service_rest r ON r.id = pr.rest_id
JOIN {schema}.published_service p ON p.id = r.service_id
GROUP BY p.service_code, p.service_provider, module
ORDER BY p.service_code, module
""",
    },
    {
        "id": "published_matches",
        "title": "发布端点与注册端点的资源码交集",
        "expected": 438,
        "sql": """
SELECT t.published_code, t.consumer_system_id, t.registered_code, t.producer_system_id,
       t.module, count(*) AS n, string_agg(t.resource_code, ',' ORDER BY t.resource_code) AS codes
FROM (
    SELECT DISTINCT p.service_code AS published_code,
           p.service_provider AS consumer_system_id,
           s.service_code AS registered_code,
           s.service_provider AS producer_system_id,
           pr.resource_code,
           COALESCE(NULLIF(
               CASE WHEN pr.resource_url LIKE '/api/openapi/%'
                    THEN split_part(pr.resource_url, '/', 4)
                    ELSE split_part(ltrim(COALESCE(pr.resource_url, ''), '/'), '/', 1)
               END, ''), '') AS module
    FROM {schema}.published_service_restresource pr
    JOIN {schema}.published_service_rest r ON r.id = pr.rest_id
    JOIN {schema}.published_service p ON p.id = r.service_id
    JOIN {schema}.registered_service_restresource rr ON rr.resource_code = pr.resource_code
    JOIN {schema}.registered_service_rest r2 ON r2.id = rr.rest_id
    JOIN {schema}.registered_service s ON s.id = r2.service_id
) t
GROUP BY t.published_code, t.consumer_system_id, t.registered_code,
         t.producer_system_id, t.module
ORDER BY t.published_code, t.registered_code, t.module
""",
    },
    {
        "id": "registered_resources",
        "title": "注册端点明细（资源码 + 真实后端路径 + 中文名）",
        "expected": 672,
        "page_size": 400,
        "sql": """
SELECT s.service_code,
       s.service_provider,
       r.resource_code,
       COALESCE(r.resource_url, '') AS resource_url,
       COALESCE(r.resource_name, '') AS resource_name,
       COALESCE(r.resource_type, '') AS resource_type
FROM {schema}.registered_service_restresource r
JOIN {schema}.registered_service_rest rr ON rr.id = r.rest_id
JOIN {schema}.registered_service s ON s.id = rr.service_id
ORDER BY s.service_code, r.resource_code, r.resource_url
LIMIT {limit} OFFSET {offset}
""",
    },
    {
        "id": "published_resources",
        "title": "发布端点明细（资源码 + 总线路径 + 中文名）",
        "expected": 493,
        "page_size": 400,
        "sql": """
SELECT p.service_code,
       p.service_provider,
       r.resource_code,
       COALESCE(r.resource_url, '') AS resource_url,
       COALESCE(r.resource_name, '') AS resource_name,
       COALESCE(r.resource_type, '') AS resource_type
FROM {schema}.published_service_restresource r
JOIN {schema}.published_service_rest pr ON pr.id = r.rest_id
JOIN {schema}.published_service p ON p.id = pr.service_id
ORDER BY p.service_code, r.resource_code, r.resource_url
LIMIT {limit} OFFSET {offset}
""",
    },
    {
        "id": "consumer_groups",
        "title": "消息订阅消费组",
        "expected": 59,
        "sql": """
SELECT q.group_code, q.description, q.group_type, q.service_code, q.service_name,
       q.system_id, count(*) AS n, string_agg(q.topic, ',' ORDER BY q.topic) AS topics
FROM (
    SELECT c.group AS group_code,
           c.description,
           CASE WHEN c.group LIKE 'REG%' THEN 'registered' ELSE 'published' END AS group_type,
           COALESCE(rs.service_code, ps.service_code) AS service_code,
           COALESCE(rs.service_name, ps.service_name) AS service_name,
           COALESCE(rs.service_provider, ps.service_provider) AS system_id,
           t.name AS topic
    FROM {schema}.message_center_subscribe sub
    JOIN {schema}.message_mq_consumer c ON c.id = sub.consumer_id
    JOIN {schema}.message_mq_topic t ON t.id = sub.topic_id
    LEFT JOIN {schema}.registered_service rs ON rs.service_code = c.group
    LEFT JOIN {schema}.published_service ps ON ps.service_code = c.group
    WHERE c.group LIKE 'REG%' OR c.group LIKE 'PUB%'
) q
GROUP BY q.group_code, q.description, q.group_type, q.service_code, q.service_name, q.system_id
ORDER BY q.group_code
""",
    },
    {
        "id": "messages",
        "title": "消息定义",
        "expected": 566,
        "page_size": 400,
        "sql": """
SELECT m.id, m.message_code, m.message_desc, m.mq_topic, m.service_id,
       s.service_code, s.service_provider
FROM {schema}.message_list m
LEFT JOIN {schema}.registered_service s ON s.id = m.service_id
ORDER BY m.message_code, m.id
LIMIT {limit} OFFSET {offset}
""",
    },
    {
        "id": "message_routes",
        "title": "消息路由动作",
        "expected": 351,
        "sql": """
SELECT COALESCE(m.message_code, '') AS message_code,
       a.service_id,
       s.service_code,
       s.service_provider,
       COALESCE(a.sync_type, '') AS sync_type,
       count(*) AS n
FROM {schema}.message_rule_action a
LEFT JOIN {schema}.message_list m ON m.id::text = a.message_id
LEFT JOIN {schema}.registered_service s ON s.id = a.service_id
WHERE (a.del_flag IS NULL OR a.del_flag::text = '0')
GROUP BY m.message_code, a.service_id, s.service_code, s.service_provider, a.sync_type
ORDER BY message_code, s.service_code
""",
    },
    {
        "id": "flows",
        "title": "BPL 流程",
        "expected": 21,
        "sql": """
SELECT id, flow_code, flow_name, flow_status, flow_type, flow_timeout, flow_poolsize, flow_queues
FROM {schema}.arrange_service
ORDER BY flow_code, id
""",
    },
    {
        "id": "openapi",
        "title": "开放接口目录",
        "expected": 66,
        "sql": """
SELECT id, code, name, remark, url, state, http_method, max_call_minute, auth_type, api_category_code
FROM {schema}.hos_sys_openapi_info
WHERE (is_delete IS NULL OR is_delete::text = '0')
ORDER BY code, id
""",
    },
    {
        "id": "apps",
        "title": "门户应用",
        "expected": 4,
        "sql": """
SELECT id, app_code, app_name, app_type, access_url, rear_server_url, url_prefix,
       integrate_way, source_code, remark
FROM {schema}.hos_system_app
WHERE (is_deleted IS NULL OR is_deleted::text = '0')
ORDER BY app_code, id
""",
    },
    {
        "id": "interfaces",
        "title": "接口配置",
        "expected": 6,
        "sql": """
SELECT i.id, i.code, i.name, i.type, i.category, i.way, i.protocol, i.url,
       i.system_id::text AS system_id, a.app_code, a.app_name, i.is_actived
FROM {schema}.hos_sys_interface i
LEFT JOIN {schema}.hos_system_app a ON a.id::text = i.system_id::text
WHERE (i.is_deleted IS NULL OR i.is_deleted::text = '0')
ORDER BY i.code, i.id
""",
    },
    {
        "id": "executors",
        "title": "执行器",
        "expected": 2,
        "sql": """
SELECT id, name, address, ip, port, https_port, status, enable_status,
       log_level, job_group_id, machine_address, remark
FROM {schema}.ds_server
ORDER BY id
""",
    },
    {
        "id": "table_counts",
        "title": "核心表行数（新鲜度校验）",
        "expected": 12,
        "sql": """
SELECT 'registered_service' AS table_name, count(*) AS n FROM {schema}.registered_service
UNION ALL SELECT 'published_service', count(*) FROM {schema}.published_service
UNION ALL SELECT 'registered_service_restresource', count(*) FROM {schema}.registered_service_restresource
UNION ALL SELECT 'published_service_restresource', count(*) FROM {schema}.published_service_restresource
UNION ALL SELECT 'message_list', count(*) FROM {schema}.message_list
UNION ALL SELECT 'message_rule', count(*) FROM {schema}.message_rule
UNION ALL SELECT 'message_rule_action', count(*) FROM {schema}.message_rule_action
UNION ALL SELECT 'message_center_subscribe', count(*) FROM {schema}.message_center_subscribe
UNION ALL SELECT 'message_mq_consumer', count(*) FROM {schema}.message_mq_consumer
UNION ALL SELECT 'arrange_service', count(*) FROM {schema}.arrange_service
UNION ALL SELECT 'hos_sys_openapi_info', count(*) FROM {schema}.hos_sys_openapi_info
UNION ALL SELECT 'hos_sys_interface', count(*) FROM {schema}.hos_sys_interface
ORDER BY table_name
""",
    },
]

DATASET_BY_ID = {d["id"]: d for d in DATASETS}


def render_sql(dataset, limit=None, offset=None):
    sql = dataset["sql"].replace("{schema}", SCHEMA).strip().rstrip(";")
    if limit is not None:
        sql = sql.replace("{limit}", str(limit)).replace("{offset}", str(offset))
    return sql


def pages_of(dataset):
    """返回 [(page_index, sql)]；分页数据集按 expected 生成，其余单条。"""
    size = dataset.get("page_size")
    if not size:
        return [(0, render_sql(dataset))]
    expected = int(dataset.get("expected") or 0)
    pages = []
    offset = 0
    while True:
        pages.append((len(pages), render_sql(dataset, size, offset)))
        offset += size
        if expected and offset >= expected:
            break
        if not expected and len(pages) >= 10:
            break
    return pages


def _rows_of(payload):
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    if isinstance(payload, list):
        return payload
    raise ValueError("期望 rows 数组或 {rows: [...]}")


def _db_connect():
    missing = [name for name in _REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        print("NEED_CREDS: 缺少数据库环境变量 " + ", ".join(missing), file=sys.stderr)
        print("或改用 --emit-sql + kingbase-87-aggregation MCP 导出 --from-json", file=sys.stderr)
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


def _fetch_dataset(conn, dataset):
    rows = []
    size = dataset.get("page_size")
    offset = 0
    while True:
        sql = render_sql(dataset, size, offset) if size else render_sql(dataset)
        with conn.cursor() as cur:
            cur.execute(sql)
            columns = [d[0] for d in cur.description]
            page = [dict(zip(columns, row)) for row in cur.fetchall()]
        rows.extend(page)
        if not size or len(page) < size or len(rows) >= int(dataset.get("expected") or 0):
            break
        offset += size
    return rows


def _load_json(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("datasets"), dict):
        data = data["datasets"]
    if not isinstance(data, dict):
        raise ValueError("JSON 需为 {dataset_id: rows} 或 {datasets: {...}}")
    return {key: _rows_of(value) for key, value in data.items()}


def build_snapshot(raw_by_dataset, source):
    datasets = {}
    for dataset in DATASETS:
        rows = raw_by_dataset.get(dataset["id"], [])
        datasets[dataset["id"]] = rows
    return {
        "source": source,
        "schema": SCHEMA,
        "database": DB_LABEL,
        "datasets": datasets,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="列出数据集")
    parser.add_argument("--emit-sql", action="store_true", help="输出每个数据集的查询 SQL")
    parser.add_argument("--from-db", action="store_true", help="直连 Kingbase 导出")
    parser.add_argument("--from-json", help="从 MCP 回填的 {dataset_id: rows} JSON 导入")
    parser.add_argument("--out", default=str(RAW_FILE))
    args = parser.parse_args()

    if args.list:
        for dataset in DATASETS:
            pages = len(pages_of(dataset))
            print(f"{dataset['id']:<24} {dataset['title']}  expect={dataset.get('expected', '?')}  pages={pages}")
        return

    if args.emit_sql:
        for dataset in DATASETS:
            pages = pages_of(dataset)
            for index, sql in pages:
                suffix = f" page {index + 1}/{len(pages)}" if len(pages) > 1 else ""
                print(f"### {dataset['id']} ({dataset['title']}){suffix}")
                print(sql + ";")
                print()
        return

    if bool(args.from_db) == bool(args.from_json):
        parser.error("需要 --from-db 或 --from-json（二选一）")
    if args.from_db:
        conn = _db_connect()
        try:
            raw = {dataset["id"]: _fetch_dataset(conn, dataset) for dataset in DATASETS}
        finally:
            conn.close()
        source = f"db:{os.environ.get('KB_HOST')}/{DB_LABEL}/{SCHEMA}"
    else:
        raw = _load_json(args.from_json)
        source = f"json:{Path(args.from_json).name}"

    snapshot = build_snapshot(raw, source)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, indent=1) + "\n",
                   encoding="utf-8")
    print(f"数据集 {len(snapshot['datasets'])} 个 → {out}")
    for dataset in DATASETS:
        print(f"  {dataset['id']:<24} {len(snapshot['datasets'][dataset['id']]):>5} 行")


if __name__ == "__main__":
    main()
