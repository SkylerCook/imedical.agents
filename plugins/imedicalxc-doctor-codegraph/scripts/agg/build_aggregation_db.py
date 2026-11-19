#!/usr/bin/env python3
"""把 aggregation_raw.json 归一化为服务总线生产者/消费者绑定库。

    python build_aggregation_db.py [--raw path] [--out path]

输出 aggregation_db.json（查询契约）与 aggregation_stats.json（构建统计与缺口）。
方向以 HIS 为参照：outbound / inbound / external / internal，
外加 unresolved-producer / unresolved-consumer 两类证据缺口。
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import controller_link
import export_aggregation_graph
import export_controller_impact
from config import (BUS_SYSTEM_NAME, CONTROLLER_INDEX_FILE, DB_FILE, HIS_SYSTEM_NAME,
                    MAVEN_CONTROLLER_INDEX_FILE, RAW_FILE, STATS_FILE, declared_targets,
                    match_system, normalize_target)

_DECLARED_OWNER_RE = re.compile(r"^发布(.+?)(?:REST|统一服务|服务)")

_CONFIDENCE_RANK = {"producer-only": 0, "consumer-only": 1, "declared": 2, "inferred": 3}

DIRECTION_LEGEND = {
    "outbound": "HIS 生产 → 外部系统消费",
    "inbound": "外部系统生产 → HIS 消费",
    "external": "双方均非 HIS（经总线互通的外部链路）",
    "internal": "双方均为 HIS（HIS 内部服务/消息流转）",
    "unresolved-producer": "消费方已登记，生产方未登记",
    "unresolved-consumer": "生产方已登记，消费方未登记",
}

CONFIDENCE_LEGEND = {
    "inferred": "两端均落到接入系统；生产方由发布端与注册端资源码交集推断",
    "declared": "关系由服务名/描述中的调用方声明，或由消息所属服务字段推得",
    "consumer-only": "仅消费方有登记",
    "producer-only": "仅生产方有登记",
}


def _text(value):
    return "" if value is None else str(value).strip()


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _codes(value):
    return [item for item in _text(value).split(",") if item]


def _direction(producer, consumer):
    if not producer and not consumer:
        return "unresolved-producer"
    if not producer:
        return "unresolved-producer"
    if not consumer:
        return "unresolved-consumer"
    if producer == BUS_SYSTEM_NAME or consumer == BUS_SYSTEM_NAME:
        return "internal"
    if producer == HIS_SYSTEM_NAME and consumer == HIS_SYSTEM_NAME:
        return "internal"
    if producer == HIS_SYSTEM_NAME:
        return "outbound"
    if consumer == HIS_SYSTEM_NAME:
        return "inbound"
    return "external"


def _declared_owner(service_desc):
    """发布描述里的生产方："发布互联网支付平台REST服务…" → 互联网支付平台。

    "发布REST服务…" 未指明生产方，不能把 REST 当成系统名。
    """
    desc = service_desc or ""
    if desc.startswith("发布REST"):
        return ""
    match = _DECLARED_OWNER_RE.search(desc)
    if not match:
        return ""
    term = normalize_target(match.group(1))
    return "" if term.upper().startswith("REST") else term


def _endpoint_map(rows):
    result = {}
    for row in rows:
        code = _text(row.get("service_code"))
        if not code:
            continue
        item = result.setdefault(code, {"count": 0, "modules": {}, "codes": []})
        n = _int(row.get("n"))
        module = _text(row.get("module"))
        item["count"] += n
        item["modules"][module] = item["modules"].get(module, 0) + n
        item["codes"].extend(_codes(row.get("codes")))
    for item in result.values():
        item["codes"] = sorted(set(item["codes"]))
    return result


class BindingBook:
    def __init__(self):
        self.items = {}

    def add(self, *, producer_system, producer_id="", producer_service="", producer_name="",
            consumer_system, consumer_id="", consumer_service="", consumer_name="",
            kind, confidence, term="", resource_codes=None, modules=None,
            matched_endpoints=0, message_codes=None, route_actions=0, route_messages=None):
        key = (producer_system or producer_id, producer_service,
               consumer_system or consumer_id, consumer_service)
        item = self.items.get(key)
        if item is None:
            item = {
                "producer": {
                    "system": producer_system,
                    "system_id": producer_id,
                    "service": producer_service,
                    "service_name": producer_name,
                },
                "consumer": {
                    "system": consumer_system,
                    "system_id": consumer_id,
                    "service": consumer_service,
                    "service_name": consumer_name,
                },
                "kinds": [],
                "confidence": confidence,
                "evidence": {
                    "matched_endpoints": 0,
                    "modules": {},
                    "resource_codes": [],
                    "message_codes": [],
                    "route_actions": 0,
                    "route_messages": [],
                    "declared_terms": [],
                },
            }
            self.items[key] = item
        if kind not in item["kinds"]:
            item["kinds"].append(kind)
        if _CONFIDENCE_RANK.get(confidence, 0) > _CONFIDENCE_RANK.get(item["confidence"], 0):
            item["confidence"] = confidence
        evidence = item["evidence"]
        evidence["matched_endpoints"] += matched_endpoints
        for module, n in (modules or {}).items():
            evidence["modules"][module] = evidence["modules"].get(module, 0) + n
        evidence["resource_codes"].extend(resource_codes or [])
        evidence["message_codes"].extend(message_codes or [])
        evidence["route_actions"] += route_actions
        evidence["route_messages"].extend(route_messages or [])
        if term and term not in evidence["declared_terms"]:
            evidence["declared_terms"].append(term)

    def finalize(self):
        result = []
        for item in self.items.values():
            evidence = item["evidence"]
            evidence["resource_codes"] = sorted(set(evidence["resource_codes"]))
            evidence["message_codes"] = sorted(set(evidence["message_codes"]))
            evidence["route_messages"] = sorted(set(evidence["route_messages"]))
            for key in ("matched_endpoints", "route_actions"):
                if not evidence[key]:
                    del evidence[key]
            for key in ("modules", "resource_codes", "message_codes", "route_messages",
                        "declared_terms"):
                if not evidence[key]:
                    del evidence[key]
            item["kinds"] = sorted(item["kinds"])
            item["direction"] = _direction(item["producer"]["system"],
                                           item["consumer"]["system"])
            result.append(item)
        result.sort(key=lambda b: (
            b["direction"], b["producer"]["system"], b["consumer"]["system"],
            b["producer"]["service"], b["consumer"]["service"]))
        for index, item in enumerate(result, 1):
            item["id"] = f"B{index:04d}"
        return result


def build(raw, controller_index=None):
    datasets = raw.get("datasets", {})
    systems = datasets.get("systems", [])
    sys_by_id = {_text(row.get("id")): row for row in systems}
    sys_names = [row.get("access_name") for row in systems]

    def sys_name(system_id):
        return _text((sys_by_id.get(_text(system_id)) or {}).get("access_name"))

    reg_endpoints = _endpoint_map(datasets.get("registered_endpoints", []))
    pub_endpoints = _endpoint_map(datasets.get("published_endpoints", []))

    registered = {}
    for row in datasets.get("registered_services", []):
        code = _text(row.get("service_code"))
        provider_id = _text(row.get("service_provider"))
        consumers = []
        for term in declared_targets(_text(row.get("service_name"))):
            consumers.append({"term": term, "system": match_system(term, sys_names)})
        endpoints = reg_endpoints.get(code, {"count": 0, "modules": {}, "codes": []})
        registered[code] = {
            "code": code,
            "name": _text(row.get("service_name")),
            "system": sys_name(provider_id),
            "system_id": provider_id,
            "type": _text(row.get("service_type")),
            "status": _text(row.get("service_status")),
            "endpoints": endpoints["count"],
            "modules": dict(sorted(endpoints["modules"].items())),
            "declared_consumers": consumers,
        }

    published = {}
    for row in datasets.get("published_services", []):
        code = _text(row.get("service_code"))
        consumer_id = _text(row.get("service_provider"))
        desc = _text(row.get("service_desc"))
        consumers = []
        for term in declared_targets(desc):
            consumers.append({"term": term, "system": match_system(term, sys_names)})
        owner_term = _declared_owner(desc)
        endpoints = pub_endpoints.get(code, {"count": 0, "modules": {}, "codes": []})
        published[code] = {
            "code": code,
            "name": _text(row.get("service_name")),
            "desc": desc,
            "system": sys_name(consumer_id),
            "system_id": consumer_id,
            "type": _text(row.get("service_type")),
            "status": _text(row.get("service_status")),
            "endpoints": endpoints["count"],
            "modules": dict(sorted(endpoints["modules"].items())),
            "declared_consumers": consumers,
            "declared_producer": {"term": owner_term, "system": match_system(owner_term, sys_names)},
        }

    messages = {}
    for row in datasets.get("messages", []):
        code = _text(row.get("message_code"))
        if not code:
            continue
        producer_id = _text(row.get("service_provider"))
        item = messages.setdefault(code, {
            "code": code,
            "desc": "",
            "producer_service": "",
            "producer_system": "",
            "producer_system_id": "",
            "consumers": set(),
            "groups": set(),
            "routes": set(),
        })
        if not item["desc"]:
            item["desc"] = _text(row.get("message_desc"))
        if producer_id and not item["producer_system_id"]:
            item["producer_system_id"] = producer_id
            item["producer_system"] = sys_name(producer_id)
            item["producer_service"] = _text(row.get("service_code"))

    groups = []
    for row in datasets.get("consumer_groups", []):
        group_code = _text(row.get("group_code"))
        service_code = _text(row.get("service_code"))
        system_id = _text(row.get("system_id"))
        topics = [code for code in _codes(row.get("topics")) if code]
        groups.append({
            "group": group_code,
            "description": _text(row.get("description")),
            "group_type": _text(row.get("group_type")),
            "service": service_code,
            "service_name": _text(row.get("service_name")),
            "system": sys_name(system_id),
            "system_id": system_id,
            "messages": len(topics),
            "message_codes": sorted(set(topics)),
        })
        for code in topics:
            item = messages.setdefault(code, {
                "code": code, "desc": "", "producer_service": "", "producer_system": "",
                "producer_system_id": "", "consumers": set(), "groups": set(), "routes": set(),
            })
            if sys_name(system_id):
                item["consumers"].add(sys_name(system_id))
            item["groups"].add(group_code)

    routes = []
    for row in datasets.get("message_routes", []):
        message_code = _text(row.get("message_code"))
        service_code = _text(row.get("service_code"))
        target_id = _text(row.get("service_provider"))
        n = _int(row.get("n"))
        routes.append({
            "message_code": message_code,
            "service": service_code,
            "service_name": _text((registered.get(service_code) or {}).get("name")),
            "system": sys_name(target_id),
            "system_id": target_id,
            "sync_type": _text(row.get("sync_type")),
            "actions": n,
        })
        if message_code:
            item = messages.setdefault(message_code, {
                "code": message_code, "desc": "", "producer_service": "", "producer_system": "",
                "producer_system_id": "", "consumers": set(), "groups": set(), "routes": set(),
            })
            if sys_name(target_id):
                item["routes"].add(sys_name(target_id))

    book = BindingBook()
    unresolved = {
        "declared_consumers": [],
        "declared_producers": [],
        "declaration_mismatch": [],
        "groups_without_service": [],
        "messages_without_producer": 0,
        "messages_without_consumer": [],
    }

    # 1) 发布端点 ∩ 注册端点：生产方由资源码交集推断，消费方取发布服务的登记方
    for row in datasets.get("published_matches", []):
        pub_code = _text(row.get("published_code"))
        reg_code = _text(row.get("registered_code"))
        pub = published.get(pub_code) or {}
        reg = registered.get(reg_code) or {}
        if not pub or not reg:
            continue
        module = _text(row.get("module"))
        n = _int(row.get("n"))
        book.add(
            producer_system=reg.get("system", ""),
            producer_id=reg.get("system_id", ""),
            producer_service=reg_code,
            producer_name=reg.get("name", ""),
            consumer_system=pub.get("system", ""),
            consumer_id=pub.get("system_id", ""),
            consumer_service=pub_code,
            consumer_name=pub.get("name", ""),
            kind="published-endpoint",
            confidence="inferred",
            resource_codes=_codes(row.get("codes")),
            modules={module: n} if module else {},
            matched_endpoints=n,
        )

    # 2) 注册服务名里的调用方声明
    for code, service in registered.items():
        for target in service["declared_consumers"]:
            if target["system"]:
                book.add(
                    producer_system=service["system"],
                    producer_id=service["system_id"],
                    producer_service=code,
                    producer_name=service["name"],
                    consumer_system=target["system"],
                    consumer_service="",
                    kind="service-declared",
                    confidence="declared",
                    term=target["term"],
                )
            else:
                unresolved["declared_consumers"].append({
                    "service": code, "service_name": service["name"],
                    "side": "registered", "term": target["term"],
                })

    # 3) 发布服务描述里的生产方/消费方声明
    for code, service in published.items():
        producer = service["declared_producer"]
        if producer["term"]:
            if producer["system"]:
                book.add(
                    producer_system=producer["system"],
                    producer_service="",
                    producer_name=producer["term"],
                    consumer_system=service["system"],
                    consumer_id=service["system_id"],
                    consumer_service=code,
                    consumer_name=service["name"],
                    kind="service-declared",
                    confidence="declared",
                    term=producer["term"],
                )
            else:
                unresolved["declared_producers"].append({
                    "service": code, "service_name": service["name"], "term": producer["term"],
                })
        for target in service["declared_consumers"]:
            if target["system"] and target["system"] != service["system"]:
                unresolved["declaration_mismatch"].append({
                    "service": code,
                    "declared": target["term"],
                    "declared_system": target["system"],
                    "registered_system": service["system"],
                })
            if not target["system"]:
                unresolved["declared_consumers"].append({
                    "service": code, "service_name": service["name"],
                    "side": "published", "term": target["term"],
                })

    # 4) 消息订阅：消费方取消费组所属服务的登记系统，生产方取消息所属服务
    for group in groups:
        if not group["service"]:
            unresolved["groups_without_service"].append({
                "group": group["group"], "description": group["description"],
            })
            continue
        for code in group["message_codes"]:
            message = messages.get(code) or {}
            producer_system = message.get("producer_system", "")
            book.add(
                producer_system=producer_system,
                producer_id=message.get("producer_system_id", ""),
                producer_service=message.get("producer_service", ""),
                consumer_system=group["system"],
                consumer_id=group["system_id"],
                consumer_service=group["service"],
                consumer_name=group["service_name"],
                kind="message-subscription",
                confidence="declared" if producer_system else "consumer-only",
                message_codes=[code],
            )

    # 5) 消息路由：消息 → 注册服务，消费方取注册服务的提供方
    for route in routes:
        if not route["service"]:
            continue
        message = messages.get(route["message_code"]) or {}
        producer_system = message.get("producer_system", "")
        book.add(
            producer_system=producer_system,
            producer_id=message.get("producer_system_id", ""),
            producer_service=message.get("producer_service", ""),
            consumer_system=route["system"],
            consumer_id=route["system_id"],
            consumer_service=route["service"],
            consumer_name=route["service_name"],
            kind="message-routing",
            confidence="declared" if producer_system else "consumer-only",
            route_actions=route["actions"],
            route_messages=[route["message_code"]],
        )

    bindings = book.finalize()
    controllers = []
    controller_stats = {}
    if controller_index is not None:
        controllers, controller_stats = controller_link.attach(
            bindings,
            datasets.get("registered_resources", []),
            datasets.get("published_resources", []),
            controller_index,
        )

    # 消息视图：生产方 + 消费方/订阅组/路由目标
    message_rows = []
    for code in sorted(messages):
        item = messages[code]
        if not item["producer_system_id"]:
            unresolved["messages_without_producer"] += 1
        if not item["consumers"] and not item["routes"]:
            unresolved["messages_without_consumer"].append(code)
        message_rows.append({
            "code": code,
            "desc": item["desc"],
            "producer_system": item["producer_system"],
            "producer_service": item["producer_service"],
            "consumers": sorted(item["consumers"]),
            "groups": sorted(item["groups"]),
            "routes": sorted(item["routes"]),
        })

    # 系统汇总
    summary = {}
    for row in systems:
        name = _text(row.get("access_name"))
        if not name:
            continue
        summary[name] = {
            "system": name,
            "system_id": _text(row.get("id")),
            "company": _text(row.get("company")),
            "is_his": name == HIS_SYSTEM_NAME,
            "is_bus": name == BUS_SYSTEM_NAME,
            "as_producer": 0,
            "as_consumer": 0,
            "outbound": 0,
            "inbound": 0,
            "external": 0,
            "internal": 0,
            "unresolved_producer": 0,
            "unresolved_consumer": 0,
            "services_produced": [],
            "services_consumed": [],
            "messages_produced": 0,
            "messages_consumed": 0,
            "endpoints_produced": 0,
            "endpoints_consumed": 0,
        }
    for binding in bindings:
        producer = binding["producer"]["system"]
        consumer = binding["consumer"]["system"]
        direction = binding["direction"].replace("-", "_")
        if producer in summary:
            item = summary[producer]
            item["as_producer"] += 1
            item[direction] = item.get(direction, 0) + 1
            if binding["producer"]["service"]:
                item["services_produced"].append(binding["producer"]["service"])
        if consumer in summary:
            item = summary[consumer]
            item["as_consumer"] += 1
            item[direction] = item.get(direction, 0) + 1
            if binding["consumer"]["service"]:
                item["services_consumed"].append(binding["consumer"]["service"])
    for code, service in registered.items():
        if service["system"] in summary:
            summary[service["system"]]["endpoints_produced"] += service["endpoints"]
    for code, service in published.items():
        if service["system"] in summary:
            summary[service["system"]]["endpoints_consumed"] += service["endpoints"]
    for message in message_rows:
        if message["producer_system"] in summary:
            summary[message["producer_system"]]["messages_produced"] += 1
        for system in message["consumers"]:
            if system in summary:
                summary[system]["messages_consumed"] += 1
    for item in summary.values():
        item["services_produced"] = sorted(set(item["services_produced"]))
        item["services_consumed"] = sorted(set(item["services_consumed"]))

    # 缺口：注册服务没有消费方证据
    consumed_services = {b["producer"]["service"] for b in bindings if b["producer"]["service"]}
    unresolved["services_without_consumer"] = [
        {"service": code, "service_name": service["name"], "system": service["system"]}
        for code, service in sorted(registered.items()) if code not in consumed_services
    ]
    unresolved["published_without_producer"] = [
        {"service": code, "service_name": service["name"], "system": service["system"]}
        for code, service in sorted(published.items())
        if not any(b["consumer"]["service"] == code and b["producer"]["system"]
                   for b in bindings)
    ]

    table_counts = {
        _text(row.get("table_name")): _int(row.get("n"))
        for row in datasets.get("table_counts", [])
    }

    db = {
        "meta": {
            "schema": raw.get("schema", ""),
            "database": raw.get("database", ""),
            "source": raw.get("source", ""),
            "direction_legend": DIRECTION_LEGEND,
            "confidence_legend": CONFIDENCE_LEGEND,
            "counts": {
                "systems": len(systems),
                "registered_services": len(registered),
                "published_services": len(published),
                "registered_endpoints": sum(item["count"] for item in reg_endpoints.values()),
                "published_endpoints": sum(item["count"] for item in pub_endpoints.values()),
                "messages": len(message_rows),
                "message_groups": len(groups),
                "message_routes": len(routes),
                "message_route_actions": sum(route["actions"] for route in routes),
                "bindings": len(bindings),
                "controllers": len(controllers),
                "bindings_with_controller": controller_stats.get("bindings_with_controller", 0),
                "his_resource_codes": (controller_stats.get("codes_resolved", 0)
                                       + len(controller_stats.get("codes_unresolved", {}))),
            },
            "controller_index": controller_index.summary() if controller_index else {},
            "controller_link": controller_stats,
            "table_counts": table_counts,
        },
        "systems": [summary[name] for name in sorted(summary)],
        "services": {
            "registered": [registered[code] for code in sorted(registered)],
            "published": [published[code] for code in sorted(published)],
        },
        "bindings": bindings,
        "controllers": controllers,
        "messages": message_rows,
        "message_groups": sorted(groups, key=lambda g: g["group"]),
        "message_routes": sorted(routes, key=lambda r: (r["message_code"], r["service"])),
        "catalogs": {
            "flows": datasets.get("flows", []),
            "openapi": datasets.get("openapi", []),
            "apps": datasets.get("apps", []),
            "interfaces": datasets.get("interfaces", []),
            "executors": datasets.get("executors", []),
        },
        "unresolved": unresolved,
    }
    return db


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", default=str(RAW_FILE))
    parser.add_argument("--out", default=str(DB_FILE))
    parser.add_argument("--stats", default=str(STATS_FILE))
    parser.add_argument("--controllers", default=str(CONTROLLER_INDEX_FILE))
    parser.add_argument("--maven-controllers", default=str(MAVEN_CONTROLLER_INDEX_FILE))
    parser.add_argument("--no-export", action="store_true",
                        help="只写 db/stats，不刷新 HTML/GraphML/清单/影响矩阵")
    args = parser.parse_args()

    raw = json.loads(Path(args.raw).read_text(encoding="utf-8"))
    controller_index = controller_link.ControllerIndex()
    controller_index.load(args.controllers, "workspace")
    controller_index.load(args.maven_controllers, "maven")
    if not controller_index.loaded:
        controller_index = None
    db = build(raw, controller_index)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(db, ensure_ascii=False, sort_keys=True, indent=1) + "\n",
                   encoding="utf-8")

    datasets = raw.get("datasets", {})
    stats = {
        "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
        "source": raw.get("source", ""),
        "counts": db["meta"]["counts"],
        "controller_index": db["meta"]["controller_index"],
        "controller_link": db["meta"]["controller_link"],
        "datasets": {key: len(value) for key, value in sorted(datasets.items())},
        "bindings_by_direction": {},
        "bindings_by_confidence": {},
        "bindings_by_kind": {},
    }
    for binding in db["bindings"]:
        stats["bindings_by_direction"][binding["direction"]] = \
            stats["bindings_by_direction"].get(binding["direction"], 0) + 1
        stats["bindings_by_confidence"][binding["confidence"]] = \
            stats["bindings_by_confidence"].get(binding["confidence"], 0) + 1
        for kind in binding["kinds"]:
            stats["bindings_by_kind"][kind] = stats["bindings_by_kind"].get(kind, 0) + 1
    Path(args.stats).write_text(
        json.dumps(stats, ensure_ascii=False, sort_keys=True, indent=1) + "\n", encoding="utf-8")

    print(f"系统 {len(db['systems'])} / 注册服务 {len(db['services']['registered'])} / "
          f"发布服务 {len(db['services']['published'])} / 绑定 {len(db['bindings'])} / "
          f"Controller {len(db['controllers'])}")
    link = db["meta"]["controller_link"]
    if link:
        print(f"Controller 挂接: HIS 生产绑定 {link['his_producer_bindings']}，"
              f"完全解析 {link['bindings_with_controller']}，部分 {link['bindings_partial']}，"
              f"未解析 {link['bindings_unresolved']}，无资源码 {link['bindings_without_codes']}")
        print(f"请求码: 解析 {link['codes_resolved']} / 未解析 {len(link['codes_unresolved'])}")
    print("方向:", ", ".join(f"{k}={v}" for k, v in sorted(stats["bindings_by_direction"].items())))
    print("置信:", ", ".join(f"{k}={v}" for k, v in sorted(stats["bindings_by_confidence"].items())))

    # 派生产物（HTML / GraphML / 清单 / 影响矩阵）随构建同步刷新，避免索引与视图脱节
    if not args.no_export:
        (html_path, graphml_path, checklist_path), nodes, edges, details = \
            export_aggregation_graph.export_all(db)
        impact_path = export_controller_impact.export_impact(db)
        print(f"→ {html_path}")
        print(f"→ {graphml_path}")
        print(f"→ {checklist_path}")
        print(f"→ {impact_path}")
    print(f"→ {out}")
    print(f"→ {args.stats}")


if __name__ == "__main__":
    main()
