#!/usr/bin/env python3
"""把服务总线绑定挂到 HIS 发布的 Controller 上。

注册端点（registered_service_restresource.resource_url）是 HIS 真实后端路径，
与代码调用图索引 controller_endpoints.json / maven_controller_endpoints.json 的
路径同构；归一化后一一对应，即可由「绑定 → 资源码 → 后端路径 → Controller 方法」
反推出某个 Controller 变更会影响哪些外部系统与接口。

归一化规则：小写、去首尾斜杠、去掉开头的 `${...}/` 上下文占位、各去掉一次
`api/` 与 `openapi/` 前缀。工作区索引优先于 Maven jar 索引（前者带 file/line）。
"""
import json
import re
from pathlib import Path

RESOLVED = "resolved"
AMBIGUOUS = "ambiguous"
NOT_INDEXED = "not-indexed"
NO_ENDPOINT = "no-endpoint"
INDEX_MISSING = "index-missing"

_CTX = re.compile(r"^\$\{[^}]+\}/")
_API = re.compile(r"^api/")
_OPENAPI = re.compile(r"^openapi/")


def normalize(url):
    text = (url or "").strip().lower().strip("/")
    text = _CTX.sub("", text)
    text = _API.sub("", text)
    text = _OPENAPI.sub("", text)
    return text


class ControllerIndex:
    """归一化路径 → Controller 方法；工作区与 Maven 索引合并，工作区优先。"""

    def __init__(self):
        self.by_path = {}
        self.loaded = []

    def load(self, path, origin):
        file = Path(path)
        if not file.is_file():
            return 0
        data = json.loads(file.read_text(encoding="utf-8"))
        count = 0
        for raw_path, items in data.get("endpoints", {}).items():
            key = normalize(raw_path)
            bucket = self.by_path.setdefault(key, [])
            for item in items:
                bucket.append({
                    "origin": origin,
                    "index_path": raw_path,
                    "controller": item.get("controller") or "",
                    "controller_fqn": item.get("controller_fqn") or "",
                    "method": item.get("method") or "",
                    "http": item.get("http") or "",
                    "file": item.get("file") or "",
                    "line": item.get("line") or 0,
                })
                count += 1
        self.loaded.append({"origin": origin, "path": str(file), "endpoints": count})
        return count

    def lookup(self, url):
        key = normalize(url)
        hits = self.by_path.get(key) or self.by_path.get("openapi/" + key) or []
        return key, hits

    def resolve(self, urls):
        """一个资源码可能登记多条 URL；只有落到唯一 Controller 方法才算解析成功。"""
        found = []
        seen = set()
        keys = []
        for url in urls:
            key, hits = self.lookup(url)
            keys.append(key)
            for hit in hits:
                signature = (hit["controller_fqn"] or hit["controller"], hit["method"])
                if signature in seen:
                    continue
                seen.add(signature)
                found.append({**hit, "url": url, "key": key})
        if not found:
            return NOT_INDEXED, [], keys
        if len(found) > 1:
            return AMBIGUOUS, found, keys
        return RESOLVED, found, keys

    def summary(self):
        return {
            "indexes": [{key: item[key] for key in ("origin", "endpoints")}
                        for item in self.loaded],
            "paths": len(self.by_path),
        }


def resource_index(rows):
    """(service_code, resource_code) → 端点明细；同时保留按资源码的唯一兜底表。"""
    by_key = {}
    by_code = {}
    for row in rows:
        service = (row.get("service_code") or "").strip()
        code = (row.get("resource_code") or "").strip()
        if not code:
            continue
        item = by_key.setdefault((service, code), {
            "code": code,
            "name": (row.get("resource_name") or "").strip(),
            "types": set(),
            "urls": set(),
        })
        if not item["name"]:
            item["name"] = (row.get("resource_name") or "").strip()
        if row.get("resource_type"):
            item["types"].add(row["resource_type"].strip())
        if row.get("resource_url"):
            item["urls"].add(row["resource_url"].strip())
        by_code.setdefault(code, []).append(item)
    for item in by_key.values():
        item["types"] = sorted(item["types"])
        item["urls"] = sorted(item["urls"])
    return by_key, by_code


def _lookup_resource(by_key, by_code, service, code):
    item = by_key.get((service, code))
    if item:
        return item
    candidates = by_code.get(code) or []
    return candidates[0] if len(candidates) == 1 else None


def _module_of(urls):
    """未命中索引时按 URL 首段说明缺哪个模块，保留原始大小写（iMedwayService）。"""
    for url in urls:
        segments = [s for s in (url or "").strip("/").split("/") if s]
        lowered = [s.lower() for s in segments]
        if "openapi" in lowered:
            position = lowered.index("openapi")
            if position + 1 < len(segments):
                return segments[position + 1]
        if segments:
            return segments[0]
    return ""


def attach(bindings, registered_resources, published_resources, index):
    """给绑定补 producer.controllers / producer.resources / consumer.resources。

    返回 (controllers, 统计)。controllers 按 (controller_fqn, method) 去重后编号 C0001…，
    记录受影响的绑定与消费系统，供影响矩阵直接消费。
    """
    reg_by_key, reg_by_code = resource_index(registered_resources)
    pub_by_key, _ = resource_index(published_resources)

    registry = {}
    stats = {
        "his_producer_bindings": 0,
        "bindings_with_controller": 0,
        "bindings_partial": 0,
        "bindings_unresolved": 0,
        "bindings_without_codes": 0,
        "codes_resolved": set(),
        "codes_unresolved": {},
        "status": {},
    }

    def register(entry, service, code):
        key = (entry["controller_fqn"] or entry["controller"], entry["method"])
        item = registry.get(key)
        if item is None:
            item = {
                "controller": entry["controller"],
                "controller_fqn": entry["controller_fqn"],
                "method": entry["method"],
                "http": entry["http"],
                "file": entry["file"],
                "line": entry["line"],
                "origin": entry["origin"],
                "index_path": entry["index_path"],
                "urls": set(),
                "resource_codes": set(),
                "services": set(),
                "bindings": set(),
                "systems": set(),
                "vendors": set(),
                "published_codes": set(),
            }
            registry[key] = item
        else:
            # 工作区索引带 file/line，覆盖 Maven 兜底命中的同签名方法
            if entry["origin"] == "workspace" and item["origin"] != "workspace":
                for field in ("file", "line", "origin", "index_path", "http"):
                    item[field] = entry[field]
        item["urls"].add(entry["url"])
        item["resource_codes"].add(code)
        item["services"].add(service)
        return key

    for binding in bindings:
        producer = binding["producer"]
        consumer = binding["consumer"]
        codes = binding["evidence"].get("resource_codes") or []

        if consumer["service"] and codes:
            rows = []
            for code in codes:
                item = _lookup_resource(pub_by_key, {}, consumer["service"], code)
                if item:
                    rows.append({
                        "code": code,
                        "name": item["name"],
                        "type": (item["types"] or [""])[0],
                        "url": (item["urls"] or [""])[0],
                    })
            if rows:
                consumer["resources"] = rows

        if producer["system"] != "HIS":
            binding["controller_status"] = "not-his-producer"
            stats["status"][binding["controller_status"]] = \
                stats["status"].get(binding["controller_status"], 0) + 1
            continue

        stats["his_producer_bindings"] += 1
        if not codes:
            binding["controller_status"] = "no-resource-code"
            stats["bindings_without_codes"] += 1
            stats["status"][binding["controller_status"]] = \
                stats["status"].get(binding["controller_status"], 0) + 1
            continue

        rows = []
        refs = []
        resolved_codes = 0
        for code in codes:
            item = _lookup_resource(reg_by_key, reg_by_code, producer["service"], code)
            urls = item["urls"] if item else []
            if not urls:
                status, entries, keys = NO_ENDPOINT, [], []
            elif index is None:
                status, entries, keys = INDEX_MISSING, [], [normalize(url) for url in urls]
            else:
                status, entries, keys = index.resolve(urls)
            row = {
                "code": code,
                "name": item["name"] if item else "",
                "type": ((item["types"] or [""])[0] if item else ""),
                "urls": urls,
                "status": status,
            }
            if status == RESOLVED:
                resolved_codes += 1
                row_refs = []
                for entry in entries:
                    signature = register(entry, producer["service"], code)
                    if signature not in row_refs:
                        row_refs.append(signature)
                row["controllers"] = row_refs
                for signature in row_refs:
                    if signature not in refs:
                        refs.append(signature)
                stats["codes_resolved"].add(code)
            else:
                row["path"] = _module_of(urls)
                if status == AMBIGUOUS:
                    row["candidates"] = sorted(
                        {(e["controller_fqn"], e["method"]) for e in entries})
                if code not in stats["codes_resolved"]:
                    stats["codes_unresolved"][code] = row["path"]
            rows.append(row)

        producer["resources"] = rows
        if refs:
            producer["controllers"] = sorted(refs)
        statuses = {row["status"] for row in rows}
        if resolved_codes == len(codes):
            binding_status = RESOLVED
        elif AMBIGUOUS in statuses:
            binding_status = AMBIGUOUS
        elif resolved_codes:
            binding_status = "partial"
        elif statuses == {NO_ENDPOINT}:
            binding_status = NO_ENDPOINT
        elif statuses == {INDEX_MISSING}:
            binding_status = INDEX_MISSING
        else:
            binding_status = NOT_INDEXED
        binding["controller_status"] = binding_status
        stats["status"][binding["controller_status"]] = \
            stats["status"].get(binding["controller_status"], 0) + 1
        if resolved_codes == len(codes):
            stats["bindings_with_controller"] += 1
        elif resolved_codes:
            stats["bindings_partial"] += 1
        else:
            stats["bindings_unresolved"] += 1

        for signature in refs:
            item = registry[signature]
            item["bindings"].add(binding["id"])
            if consumer["system"]:
                item["systems"].add(consumer["system"])
            if consumer["system_id"]:
                item["vendors"].add(consumer["system_id"])
            if consumer["service"]:
                item["published_codes"].add(consumer["service"])

    controllers = []
    for index_id, (_, item) in enumerate(sorted(registry.items()), 1):
        item["id"] = f"C{index_id:04d}"
        for field in ("urls", "resource_codes", "services", "bindings", "systems",
                      "vendors", "published_codes"):
            item[field] = sorted(item[field])
        controllers.append(item)
    by_signature = {(item["controller_fqn"] or item["controller"], item["method"]): item["id"]
                    for item in controllers}
    for binding in bindings:
        producer = binding["producer"]
        if producer.get("controllers"):
            producer["controllers"] = sorted(by_signature[tuple(signature)]
                                            for signature in producer["controllers"]
                                            if tuple(signature) in by_signature)
        for row in producer.get("resources", []):
            if row.get("controllers"):
                row["controllers"] = sorted(by_signature[tuple(signature)]
                                           for signature in row["controllers"]
                                           if tuple(signature) in by_signature)

    for code in stats["codes_resolved"]:
        stats["codes_unresolved"].pop(code, None)

    return controllers, {
        "his_producer_bindings": stats["his_producer_bindings"],
        "bindings_with_controller": stats["bindings_with_controller"],
        "bindings_partial": stats["bindings_partial"],
        "bindings_unresolved": stats["bindings_unresolved"],
        "bindings_without_codes": stats["bindings_without_codes"],
        "bindings_by_status": dict(sorted(stats["status"].items())),
        "codes_resolved": len(stats["codes_resolved"]),
        "codes_unresolved": dict(sorted(stats["codes_unresolved"].items())),
    }
