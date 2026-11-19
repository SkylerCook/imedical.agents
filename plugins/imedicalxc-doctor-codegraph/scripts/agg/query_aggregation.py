#!/usr/bin/env python3
"""查询服务总线生产者/消费者绑定库（aggregation_db.json）。

示例:
    python query_aggregation.py --stats
    python query_aggregation.py --system HIS
    python query_aggregation.py --producer HIS --direction outbound
    python query_aggregation.py --service REG0001
    python query_aggregation.py --message MSG0001
    python query_aggregation.py --kind message-subscription --consumer LIS
    python query_aggregation.py --search 检验 --json
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import DB_FILE


def _load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _evidence_text(binding, limit=3):
    evidence = binding.get("evidence", {})
    parts = []
    if evidence.get("matched_endpoints"):
        parts.append(f"端点{evidence['matched_endpoints']}")
    if evidence.get("message_codes"):
        codes = evidence["message_codes"]
        parts.append(f"消息{len(codes)}" + (f"({','.join(codes[:limit])}…)" if len(codes) > limit else f"({','.join(codes)})"))
    if evidence.get("route_actions"):
        parts.append(f"路由{evidence['route_actions']}")
    if evidence.get("declared_terms"):
        parts.append("声明:" + "/".join(evidence["declared_terms"]))
    return "; ".join(parts)


def _binding_line(binding):
    producer = binding["producer"]
    consumer = binding["consumer"]
    left = producer["system"] or "(未登记)"
    right = consumer["system"] or "(未登记)"
    if producer["service"]:
        left += f"/{producer['service']}"
    if consumer["service"]:
        right += f"/{consumer['service']}"
    kinds = ",".join(binding["kinds"])
    evidence = _evidence_text(binding)
    return (f"{binding['direction']:<20} {left} → {right}  "
            f"[{kinds}|{binding['confidence']}]" + (f"  {evidence}" if evidence else ""))


def _filter_bindings(db, args):
    rows = db["bindings"]
    if args.system:
        rows = [b for b in rows if args.system in (b["producer"]["system"], b["consumer"]["system"])]
    if args.producer:
        rows = [b for b in rows if b["producer"]["system"] == args.producer]
    if args.consumer:
        rows = [b for b in rows if b["consumer"]["system"] == args.consumer]
    if args.direction:
        rows = [b for b in rows if b["direction"] == args.direction]
    if args.kind:
        rows = [b for b in rows if args.kind in b["kinds"]]
    if args.service:
        rows = [b for b in rows
                if args.service in (b["producer"]["service"], b["consumer"]["service"])]
    if args.search:
        needle = args.search.lower()
        rows = [b for b in rows
                if needle in json.dumps(b, ensure_ascii=False).lower()]
    if args.limit:
        rows = rows[: args.limit]
    return rows


def _print_system(db, name):
    system = next((s for s in db["systems"] if s["system"] == name), None)
    if not system:
        print(f"未找到接入系统: {name}")
        return
    print(f"# {system['system']}  ({system['system_id']})  company={system['company'] or '-'}")
    print(f"生产绑定 {system['as_producer']} / 消费绑定 {system['as_consumer']}")
    print(f"outbound={system['outbound']} inbound={system['inbound']} "
          f"external={system['external']} internal={system['internal']} "
          f"gap(producer)={system['unresolved_producer']} gap(consumer)={system['unresolved_consumer']}")
    print(f"生产服务: {', '.join(system['services_produced']) or '-'}")
    print(f"消费服务: {', '.join(system['services_consumed']) or '-'}")
    print(f"端点 生产 {system['endpoints_produced']} / 消费 {system['endpoints_consumed']}")
    print(f"消息 生产 {system['messages_produced']} / 消费 {system['messages_consumed']}")


def _print_service(db, code):
    service = next((s for s in db["services"]["registered"] if s["code"] == code), None)
    side = "registered"
    if not service:
        service = next((s for s in db["services"]["published"] if s["code"] == code), None)
        side = "published"
    if not service:
        print(f"未找到服务: {code}")
        return
    print(f"# {code} [{side}] {service['name']}  system={service['system'] or '-'}")
    if side == "published":
        print(f"描述: {service['desc']}")
    modules = ", ".join(f"{(k or '(root)')}={v}" for k, v in service["modules"].items()) or "-"
    print(f"端点 {service['endpoints']} / 模块 {modules}")
    consumers = service.get("declared_consumers") or []
    print("声明调用方: " + (", ".join(
        f"{c['term']}→{c['system'] or '未匹配'}" for c in consumers) or "-"))


def _print_message(db, code):
    message = next((m for m in db["messages"] if m["code"] == code), None)
    if not message:
        print(f"未找到消息: {code}")
        return
    print(f"# {code} {message['desc']}")
    print(f"生产: {message['producer_system'] or '(未登记)'}"
          + (f" / {message['producer_service']}" if message["producer_service"] else ""))
    print(f"消费: {', '.join(message['consumers']) or '-'}")
    print(f"订阅组: {', '.join(message['groups']) or '-'}")
    print(f"路由目标: {', '.join(message['routes']) or '-'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DB_FILE))
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--system")
    parser.add_argument("--producer")
    parser.add_argument("--consumer")
    parser.add_argument("--service")
    parser.add_argument("--message")
    parser.add_argument("--direction")
    parser.add_argument("--kind")
    parser.add_argument("--search")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--json", action="store_true", help="输出 JSON 而非文本")
    args = parser.parse_args()

    db = _load(args.db)
    meta = db["meta"]

    if args.message:
        if args.json:
            print(json.dumps(next((m for m in db["messages"] if m["code"] == args.message), None),
                             ensure_ascii=False, indent=1))
        else:
            _print_message(db, args.message)
        return

    if args.service:
        if args.json:
            service = next((s for s in db["services"]["registered"] + db["services"]["published"]
                            if s["code"] == args.service), None)
            print(json.dumps(service, ensure_ascii=False, indent=1))
        else:
            _print_service(db, args.service)

    if args.system and not args.json:
        _print_system(db, args.system)
        print()

    if args.stats or not any((args.system, args.producer, args.consumer, args.service,
                              args.direction, args.kind, args.search, args.message)):
        if args.json:
            print(json.dumps(meta, ensure_ascii=False, indent=1))
        else:
            counts = meta["counts"]
            print("# 服务总线绑定索引")
            print(f"来源 {meta['source']} / {meta['database']}.{meta['schema']}")
            print("规模: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
            by_direction = {}
            by_confidence = {}
            for binding in db["bindings"]:
                by_direction[binding["direction"]] = by_direction.get(binding["direction"], 0) + 1
                by_confidence[binding["confidence"]] = by_confidence.get(binding["confidence"], 0) + 1
            print("方向: " + ", ".join(f"{k}={v}" for k, v in sorted(by_direction.items())))
            print("置信: " + ", ".join(f"{k}={v}" for k, v in sorted(by_confidence.items())))
        return

    rows = _filter_bindings(db, args)
    if args.json:
        print(json.dumps({"query": vars(args), "count": len(rows), "bindings": rows},
                         ensure_ascii=False, indent=1))
        return
    print(f"绑定 {len(rows)} 条")
    for binding in rows:
        print(_binding_line(binding))


if __name__ == "__main__":
    main()
