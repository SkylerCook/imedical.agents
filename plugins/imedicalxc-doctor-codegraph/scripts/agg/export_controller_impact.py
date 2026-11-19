#!/usr/bin/env python3
"""导出 HIS 发布 Controller → 厂家接口影响矩阵。

    python export_controller_impact.py [--db path] [--out path]

输入 aggregation_db.json（bindings[].producer.controllers 已挂接 Controller），
输出 Markdown：先给「改动某个 Controller 会影响哪些厂家 / 接口」的汇总矩阵，
再给扁平明细表、未解析请求码与不能挂 Controller 的绑定清单。
输出确定性：行排序固定，无时间戳。
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import DB_FILE, OUTPUT_DIR


def _cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def _group_detail(db):
    """(controller_id, 厂家系统, 厂家服务, 资源码) → 受影响接口明细。"""
    detail = {}
    for binding in db["bindings"]:
        producer = binding["producer"]
        consumer_res = {row["code"]: row for row in binding["consumer"].get("resources") or []}
        for row in producer.get("resources") or []:
            if row.get("status") != "resolved":
                continue
            hit = consumer_res.get(row["code"]) or {}
            for controller_id in row.get("controllers") or []:
                key = (controller_id, binding["consumer"]["system"] or "(未登记)",
                       binding["consumer"].get("service") or "",
                       row["code"])
                item = detail.setdefault(key, {
                    "system": binding["consumer"]["system"] or "(未登记)",
                    "service": binding["consumer"].get("service") or "",
                    "service_name": binding["consumer"].get("service_name") or "",
                    "code": row["code"],
                    "name": hit.get("name", ""),
                    "url": hit.get("url", ""),
                    "bindings": set(),
                })
                item["bindings"].add(binding["id"])
    return detail


def _unresolved(db):
    """未解析请求码 → 受影响厂家接口。"""
    rows = defaultdict(lambda: {
        "code": "", "name": "", "path": "", "services": set(), "bindings": set(),
    })
    for binding in db["bindings"]:
        producer = binding["producer"]
        consumer_res = {row["code"]: row for row in binding["consumer"].get("resources") or []}
        for row in producer.get("resources") or []:
            if row.get("status") == "resolved":
                continue
            item = rows[row["code"]]
            item["code"] = row["code"]
            if not item["name"]:
                item["name"] = row.get("name", "")
            if not item["path"]:
                item["path"] = row.get("path", "")
            hit = consumer_res.get(row["code"]) or {}
            service = binding["consumer"]["system"] or "(未登记)"
            if binding["consumer"].get("service"):
                service += " · " + binding["consumer"]["service"]
            if hit.get("name"):
                service += " · " + hit["name"]
            item["services"].add(service)
            item["bindings"].add(binding["id"])
    return [rows[code] for code in sorted(rows)]


def render(db):
    stats = db["meta"]["counts"]
    link = db["meta"].get("controller_link") or {}
    controllers = db.get("controllers") or []
    by_id = {item["id"]: item for item in controllers}
    detail = _group_detail(db)
    unresolved = _unresolved(db)

    lines = [
        "# HIS 发布 Controller 影响矩阵",
        "",
        "由 `export_controller_impact.py` 从 `aggregation_db.json` 确定性生成，请勿手工编辑。",
        "",
        "回答的问题：**改动某个 HIS 发布的 Controller，会影响哪些厂家的哪些接口**。",
        "链路：Controller 方法 → 注册端点 URL → 服务总线资源码 → 厂家发布服务（厂家在总线上登记的接口名 / 中文名 / ESB 路径）。",
        "",
        "| 项目 | 值 |",
        "|---|---|",
        f"| 源库 | `{db['meta']['database']}.{db['meta']['schema']}`（{db['meta']['source']}） |",
        f"| HIS 生产绑定 | {link.get('his_producer_bindings', 0)} |",
        f"| 挂接 Controller 方法 | {stats.get('controllers', 0)}（{len(controllers)} 个唯一方法） |",
        f"| 绑定挂接情况 | 完全解析 {link.get('bindings_with_controller', 0)} · "
        f"部分 {link.get('bindings_partial', 0)} · 未解析 {link.get('bindings_unresolved', 0)} · "
        f"服务级声明 {link.get('bindings_without_codes', 0)} |",
        f"| 请求码 | 解析 {link.get('codes_resolved', 0)} / "
        f"{link.get('codes_resolved', 0) + len(link.get('codes_unresolved') or {})} |",
        "",
        f"## 汇总矩阵：{len(controllers)} 个 Controller → 受影响厂家",
        "",
        "改动左侧 Controller（或其 `file:line` 对应方法）时，右侧厂家系统经服务总线消费的接口受影响。",
        "",
        "| Controller | 位置 | HIS 服务 | 对外请求码 | 受影响厂家 | 绑定 |",
        "|---|---|---|---|---|---|",
    ]
    for item in controllers:
        location = item["file"] + (":" + str(item["line"]) if item["line"] else "")
        if item["origin"] == "maven":
            location = (location + " " if location else "") + "(Maven jar 索引，无源码位置)"
        cells = [
            f"`{item['controller']}.{item['method']}`",
            _cell(location) or "—",
            ", ".join(item["services"]),
            ", ".join(f"`{code}`" for code in item["resource_codes"]),
            "<br>".join(_cell(name) for name in item["systems"]) or "—",
            str(len(item["bindings"])),
        ]
        lines.append("| " + " | ".join(cells) + " |")

    lines += [
        "",
        f"## 明细矩阵：Controller → 厂家接口（{len(detail)} 行）",
        "",
        "一行 = 某厂家系统消费某 Controller 暴露的一个接口。`接口名` 是厂家在总线发布服务上登记的中文名。",
        "",
        "| Controller | 厂家系统 | 厂家服务 | 资源码 | 接口名 | ESB 路径 | 绑定 |",
        "|---|---|---|---|---|---|---|",
    ]
    for key in sorted(detail):
        controller_id = key[0]
        item = by_id.get(controller_id) or {}
        row = detail[key]
        label = f"{item.get('controller', '?')}.{item.get('method', '?')}"
        service = row["service"] + (" · " + row["service_name"] if row["service_name"] else "")
        cells = [
            f"`{label}`",
            _cell(row["system"]),
            _cell(service),
            f"`{row['code']}`",
            _cell(row["name"]) or "—",
            _cell(row["url"]) or "—",
            ", ".join(sorted(row["bindings"])),
        ]
        lines.append("| " + " | ".join(cells) + " |")

    lines += [
        "",
        f"## 未解析请求码（{len(unresolved)} 个）：代码索引未收录，无法定位 Controller",
        "",
        "这些请求码的后端模块未纳入工作区 / Maven jar 代码索引（多为第三方模块源码不在本工程），"
        "改动其 HIS 侧实现时本节列出的厂家接口仍需人工评估。",
        "",
        "| 请求码 | 后端模块 | HIS 侧中文名 | 受影响厂家接口 | 绑定 |",
        "|---|---|---|---|---|",
    ]
    for row in unresolved:
        cells = [
            f"`{row['code']}`",
            _cell(row["path"]) or "—",
            _cell(row["name"]) or "—",
            "<br>".join(_cell(service) for service in sorted(row["services"])) or "—",
            ", ".join(sorted(row["bindings"])),
        ]
        lines.append("| " + " | ".join(cells) + " |")

    declared = [binding for binding in db["bindings"]
                if binding.get("controller_status") == "no-resource-code"]
    lines += [
        "",
        f"## 服务级声明 / 消息绑定（{len(declared)} 条）：无请求码，无法挂 Controller",
        "",
        "这些 HIS 生产绑定只有服务级声明或消息码，没有端点级请求码，因此定位不到具体 Controller"
        "（消息类绑定生产方是消息发布方而非 REST Controller）。",
        "",
        "| 绑定 | 方向 | 依据 | HIS 服务 | 消费方 |",
        "|---|---|---|---|---|",
    ]
    for binding in declared:
        producer = binding["producer"]
        consumer = binding["consumer"]
        cells = [
            binding["id"],
            binding["direction"],
            ", ".join(binding.get("kinds") or []),
            _cell(" · ".join(part for part in (producer["service"], producer["service_name"]) if part)),
            _cell(" · ".join(part for part in (consumer["system"], consumer["service"],
                                               consumer["service_name"]) if part)),
        ]
        lines.append("| " + " | ".join(cells) + " |")

    non_his = defaultdict(int)
    for binding in db["bindings"]:
        if binding.get("controller_status") == "not-his-producer":
            non_his[binding["direction"]] += 1
    lines += [
        "",
        "## 不适用：非 HIS 生产绑定",
        "",
        "HIS 是消费方的绑定（inbound）没有 HIS 发布的 Controller 可挂；外部系统之间的绑定同理。按方向计数："
        + "，".join(f"{direction} {count}" for direction, count in sorted(non_his.items()))
        + "。",
        "",
    ]
    return "\n".join(lines) + "\n"


def export_impact(db, out_path=None):
    """写出 Controller 影响矩阵，返回路径。"""
    out = Path(out_path or OUTPUT_DIR / "aggregation_controller_impact.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(db), encoding="utf-8")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DB_FILE))
    parser.add_argument("--out", default=str(OUTPUT_DIR / "aggregation_controller_impact.md"))
    args = parser.parse_args()

    db = json.loads(Path(args.db).read_text(encoding="utf-8"))
    out = export_impact(db, args.out)
    print(f"Controller {len(db.get('controllers') or [])} → {out}")


if __name__ == "__main__":
    main()
