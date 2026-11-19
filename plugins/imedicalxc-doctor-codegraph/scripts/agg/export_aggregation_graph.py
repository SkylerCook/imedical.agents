#!/usr/bin/env python3
"""导出服务总线绑定图：概览图 + 请求级明细（自包含 HTML）+ GraphML + 请求码对照清单。

    python export_aggregation_graph.py [--db path] [--html path] [--graphml path] [--checklist path]

节点 = 接入系统（HIS 居中，未登记生产方用虚线节点），边 = 生产方 → 消费方，
按绑定聚合；点击某条边或某个系统，可下钻到「哪个服务的具体请求 / 消息被谁消费」。
HIS 侧绑定已挂接代码调用图的 Controller（bindings[].producer.controllers），
请求明细与对照清单表 A / 表 C 均有 HIS Controller 列，GraphML 边含 controllers 属性。
按 Controller 反查厂家影响范围请用 export_controller_impact.py。
对照清单为 Markdown 表格：逐绑定列出请求码，并按请求码反查绑定。
输出确定性：节点/边/明细排序固定，HTML 不含时间戳与外部依赖。
"""
import argparse
import html
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import DB_FILE, OUTPUT_DIR

UNKNOWN = "(未登记)"
DIRECTIONS = ("outbound", "inbound", "external", "internal", "unresolved-producer")
DIRECTION_LABELS = {
    "outbound": "HIS 生产 → 外部消费",
    "inbound": "外部生产 → HIS 消费",
    "external": "外部 ↔ 外部",
    "internal": "HIS 内部",
    "unresolved-producer": "生产方未登记",
}


def _load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _controller_labels(db):
    labels = {}
    for item in db.get("controllers") or []:
        labels[item["id"]] = f"{item['controller']}.{item['method']}"
    return labels


def aggregate(db):
    systems = {item["system"]: item for item in db["systems"]}
    controller_labels = _controller_labels(db)
    edges = {}
    for binding in db["bindings"]:
        producer = binding["producer"]["system"] or UNKNOWN
        consumer = binding["consumer"]["system"] or UNKNOWN
        key = (producer, consumer)
        edge = edges.get(key)
        if edge is None:
            edge = {
                "producer": producer,
                "consumer": consumer,
                "bindings": 0,
                "endpoints": 0,
                "requests": set(),
                "messages": set(),
                "routes": 0,
                "kinds": set(),
                "directions": set(),
                "services": set(),
                "controllers": set(),
            }
            edges[key] = edge
        evidence = binding.get("evidence", {})
        edge["bindings"] += 1
        edge["endpoints"] += int(evidence.get("matched_endpoints") or 0)
        edge["requests"].update(evidence.get("resource_codes") or [])
        edge["messages"].update(evidence.get("message_codes") or [])
        edge["routes"] += int(evidence.get("route_actions") or 0)
        edge["kinds"].update(binding.get("kinds") or [])
        edge["directions"].add(binding["direction"])
        edge["controllers"].update(controller_labels.get(ref, ref)
                                   for ref in binding["producer"].get("controllers") or [])
        for side in ("producer", "consumer"):
            service = binding[side].get("service")
            if service:
                edge["services"].add(service)

    rows = []
    for edge in edges.values():
        directions = sorted(edge["directions"])
        rows.append({
            "producer": edge["producer"],
            "consumer": edge["consumer"],
            "bindings": edge["bindings"],
            "endpoints": edge["endpoints"],
            "requests": len(edge["requests"]),
            "request_codes": sorted(edge["requests"]),
            "messages": len(edge["messages"]),
            "message_codes": sorted(edge["messages"]),
            "routes": edge["routes"],
            "kinds": sorted(edge["kinds"]),
            "directions": directions,
            "direction": directions[0] if len(directions) == 1 else "mixed",
            "services": sorted(edge["services"]),
            "controllers": sorted(edge["controllers"]),
        })
    rows.sort(key=lambda row: (row["producer"], row["consumer"]))

    weight = defaultdict(int)
    for row in rows:
        weight[row["producer"]] += row["bindings"]
        weight[row["consumer"]] += row["bindings"]
    for name in systems:
        weight.setdefault(name, 0)
    weight.setdefault(UNKNOWN, 0)
    nodes = []
    for name in sorted(weight):
        info = systems.get(name, {})
        nodes.append({
            "system": name,
            "kind": "unknown" if name == UNKNOWN else ("bus" if info.get("is_bus") else "system"),
            "his": bool(info.get("is_his")),
            "company": info.get("company", ""),
            "as_producer": info.get("as_producer", 0),
            "as_consumer": info.get("as_consumer", 0),
            "messages_produced": info.get("messages_produced", 0),
            "messages_consumed": info.get("messages_consumed", 0),
            "weight": weight[name],
        })
    return nodes, rows, build_details(db)


def build_details(db):
    messages = {item.get("code"): item for item in db.get("messages") or []}
    controller_labels = _controller_labels(db)
    rows = []
    for binding in db["bindings"]:
        evidence = binding.get("evidence", {})
        message_rows = []
        for code in evidence.get("message_codes") or []:
            message_rows.append({"code": code, "desc": (messages.get(code) or {}).get("desc", "")})
        message_rows.sort(key=lambda item: item["code"])
        producer = binding["producer"]
        rows.append({
            "id": binding["id"],
            "producer": producer["system"] or UNKNOWN,
            "producer_service": producer["service"],
            "producer_name": producer["service_name"],
            "consumer": binding["consumer"]["system"] or UNKNOWN,
            "consumer_service": binding["consumer"]["service"],
            "consumer_name": binding["consumer"]["service_name"],
            "direction": binding["direction"],
            "kinds": binding.get("kinds") or [],
            "confidence": binding.get("confidence", ""),
            "requests": sorted(evidence.get("resource_codes") or []),
            "messages": message_rows,
            "declared": sorted(evidence.get("declared_terms") or []),
            "matched": int(evidence.get("matched_endpoints") or 0),
            "routes": int(evidence.get("route_actions") or 0),
            "controllers": sorted(controller_labels.get(ref, ref)
                                  for ref in producer.get("controllers") or []),
            "controller_status": binding.get("controller_status", ""),
            "controller_missing": [
                {"code": row["code"], "name": row.get("name", ""), "path": row.get("path", "")}
                for row in producer.get("resources") or [] if row.get("status") != "resolved"
            ],
        })
    rows.sort(key=lambda row: (row["producer"], row["consumer"], row["id"]))
    return rows


_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>HIS 服务总线绑定图</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 "Microsoft YaHei", "PingFang SC", sans-serif;
         color: #1f2937; background: #f5f7fa; }
  header { padding: 14px 20px 10px; background: #fff; border-bottom: 1px solid #e3e8ef; }
  h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
  .meta { color: #667085; font-size: 12px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
             padding: 10px 20px; background: #fff; border-bottom: 1px solid #e3e8ef; }
  .toolbar label { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
  .toolbar input[type=search] { width: 200px; padding: 4px 8px; border: 1px solid #cfd6e0;
             border-radius: 4px; font: inherit; }
  .tabs { display: flex; gap: 6px; }
  .tab { border: 1px solid #cfd6e0; background: #fff; padding: 4px 12px; border-radius: 14px;
         cursor: pointer; font: inherit; color: #475467; }
  .tab.active { background: #2f6fed; color: #fff; border-color: #2f6fed; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; color: #475467; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  main { height: calc(100vh - 152px); min-height: 560px; background: #fff; }
  #graphView { display: flex; height: 100%; }
  #graphView[hidden], #detailView[hidden] { display: none; }
  #stage { flex: 1; position: relative; overflow: hidden; }
  svg { width: 100%; height: 100%; display: block; }
  aside { width: 400px; background: #fff; border-left: 1px solid #e3e8ef;
          overflow: auto; padding: 12px; }
  aside h2 { font-size: 13px; margin: 0 0 8px; color: #344054; }
  .pair { padding: 7px 8px; border: 1px solid #eef1f5; border-radius: 6px; margin-bottom: 6px;
          cursor: pointer; }
  .pair:hover, .pair.active { border-color: #2f6fed; background: #f3f7ff; }
  .pair .head { display: flex; justify-content: space-between; gap: 8px; }
  .pair .name { font-weight: 600; word-break: break-all; }
  .pair .stats { color: #667085; font-size: 12px; margin-top: 2px; }
  .tag { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 9px;
         background: #eef2f7; color: #475467; margin: 1px 2px 1px 0; }
  .mini { border: 1px solid #eef1f5; border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; }
  .mini .k { color: #667085; font-size: 11px; margin-top: 3px; }
  .code { display: inline-block; font-family: Consolas, monospace; font-size: 11px;
          background: #eef4ff; color: #1e4fc4; border-radius: 4px; padding: 1px 5px;
          margin: 1px 2px 1px 0; }
  .msg { display: inline-block; font-size: 11px; background: #fff4e8; color: #9a4b00;
         border-radius: 4px; padding: 1px 5px; margin: 1px 2px 1px 0; }
  .term { display: inline-block; font-size: 11px; background: #f4f0ff; color: #5b21b6;
          border-radius: 4px; padding: 1px 5px; margin: 1px 2px 1px 0; }
  .ctl { display: inline-block; font-family: Consolas, monospace; font-size: 11px;
         background: #e9f8f0; color: #116b46; border-radius: 4px; padding: 1px 5px;
         margin: 1px 2px 1px 0; }
  .miss { display: inline-block; font-size: 11px; background: #fdecec; color: #b42318;
          border-radius: 4px; padding: 1px 5px; margin: 1px 2px 1px 0; }
  .sub { color: #667085; font-size: 12px; word-break: break-all; }
  #detailView { height: 100%; overflow: auto; padding: 12px 20px 24px; }
  .detail-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
                color: #475467; flex-wrap: wrap; }
  .chip-filter { background: #eef4ff; color: #1e4fc4; border-radius: 10px; padding: 2px 8px;
                 font-size: 12px; }
  .chip-filter button { border: none; background: none; color: inherit; cursor: pointer;
                        font: inherit; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 12px; color: #667085; font-weight: 600; padding: 8px;
       border-bottom: 1px solid #e3e8ef; position: sticky; top: 0; background: #fff; }
  td { padding: 8px; border-bottom: 1px solid #f0f3f7; vertical-align: top; }
  td.req { min-width: 260px; }
  td.ctl-cell { min-width: 190px; }
  .linkbtn { border: none; background: none; color: #2f6fed; cursor: pointer; padding: 0;
             font: inherit; font-size: 12px; }
  #tip { position: absolute; pointer-events: none; z-index: 5; max-width: 340px;
         background: #111827; color: #f9fafb; padding: 7px 9px; border-radius: 5px;
         font-size: 12px; line-height: 1.45; display: none; white-space: pre-line; }
  .node-label { font-size: 11px; fill: #344054; paint-order: stroke; stroke: #fff;
                stroke-width: 3px; stroke-linejoin: round; pointer-events: none; }
  .edge { fill: none; }
  .edge-hit { fill: none; stroke: transparent; stroke-width: 12px; cursor: pointer; }
  .dim { opacity: .08 !important; }
  .edge.sel { opacity: 1 !important; stroke-width: 3px !important; }
  .node.sel circle { stroke: #111827; stroke-width: 3px; }
</style>
</head>
<body>
<header>
  <h1>HIS 服务总线生产者 / 消费者绑定图</h1>
  <div class="meta" id="meta"></div>
</header>
<div class="toolbar">
  <div class="tabs">
    <button class="tab active" data-view="graph">系统概览</button>
    <button class="tab" data-view="detail">请求明细</button>
  </div>
  <label><input type="checkbox" class="dir" value="outbound" checked><span class="dot" style="background:#2f6fed"></span>HIS 生产 → 外部</label>
  <label><input type="checkbox" class="dir" value="inbound" checked><span class="dot" style="background:#e8833a"></span>外部 → HIS 消费</label>
  <label><input type="checkbox" class="dir" value="external" checked><span class="dot" style="background:#7a8699"></span>外部 ↔ 外部</label>
  <label><input type="checkbox" class="dir" value="internal" checked><span class="dot" style="background:#3a9d6e"></span>HIS 内部</label>
  <label><input type="checkbox" class="dir" value="unresolved-producer" checked><span class="dot" style="background:#b0b7c3"></span>生产方未登记</label>
  <input type="search" id="search" placeholder="搜索系统 / 服务 / 请求 / 消息 / Controller">
</div>
<main>
  <div id="graphView">
    <div id="stage"><svg id="graph"></svg><div id="tip"></div></div>
    <aside>
      <h2>绑定对（<span id="pair-count">0</span>）</h2>
      <div id="pairs"></div>
      <div id="pair-detail"></div>
    </aside>
  </div>
  <section id="detailView" hidden>
    <div class="detail-bar">
      <span id="detail-count"></span>
      <span id="detail-filter"></span>
    </div>
    <table>
      <thead><tr><th>生产方</th><th>HIS Controller</th><th>具体请求 / 消息</th><th>消费方</th><th>依据</th></tr></thead>
      <tbody id="detail-body"></tbody>
    </table>
  </section>
</main>
<script>
const DATA = __DATA__;
const COLORS = { outbound: "#2f6fed", inbound: "#e8833a", external: "#7a8699",
                 internal: "#3a9d6e", "unresolved-producer": "#b0b7c3",
                 mixed: "#8b5cf6" };
const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("graph");
const tip = document.getElementById("tip");
const state = { dirs: new Set(DATA.directions), query: "", selected: null, node: null,
                pair: null, view: "graph" };
let positions = {};

function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function layout() {
  const width = 1100, height = 820;
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  const cx = width / 2, cy = height / 2;
  const others = DATA.nodes.filter(n => !n.his && n.kind !== "unknown");
  others.sort((a, b) => (b.weight - a.weight) || a.system.localeCompare(b.system));
  const inner = others.slice(0, Math.ceil(others.length / 2));
  const outer = others.slice(inner.length);
  positions = {};
  positions.HIS = { x: cx, y: cy, r: 30 };
  const ring = (list, radius, start) => {
    list.forEach((node, index) => {
      const angle = start + (index / Math.max(list.length, 1)) * Math.PI * 2;
      positions[node.system] = { x: cx + Math.cos(angle) * radius,
                                 y: cy + Math.sin(angle) * radius, r: node.r };
    });
  };
  inner.forEach(n => n.r = 13 + Math.min(9, Math.sqrt(n.weight)));
  outer.forEach(n => n.r = 11 + Math.min(7, Math.sqrt(n.weight)));
  ring(inner, 250, -Math.PI / 2);
  ring(outer, 375, -Math.PI / 2 + Math.PI / Math.max(outer.length, 1));
  if (positions["(未登记)"]) {
    positions["(未登记)"] = { x: 90, y: 70, r: 14 };
  } else {
    positions["(未登记)"] = { x: 90, y: 70, r: 14 };
  }
  DATA.nodes.filter(n => n.kind === "unknown").forEach(n => {
    positions[n.system] = { x: 90, y: 70, r: 14 };
  });
}
function edgePath(a, b, bend) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const offset = Math.min(70, 18 + len * 0.08) * bend;
  const cxp = mx + nx * offset, cyp = my + ny * offset;
  return "M" + a.x + "," + a.y + " Q" + cxp + "," + cyp + " " + b.x + "," + b.y;
}
function draw() {
  layout();
  svg.innerHTML = "";
  const defs = el("defs", {});
  const kinds = ["outbound", "inbound", "external", "internal", "unresolved-producer", "mixed"];
  kinds.forEach(kind => {
    const marker = el("marker", { id: "arrow-" + kind, viewBox: "0 0 10 10",
      refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    marker.appendChild(el("path", { d: "M0,0 L10,5 L0,10 z", fill: COLORS[kind] }));
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  const edgeLayer = el("g", {});
  const nodeLayer = el("g", {});
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);

  DATA.edges.forEach((edge, index) => {
    const a = positions[edge.producer], b = positions[edge.consumer];
    if (!a || !b) return;
    const bend = edge.producer < edge.consumer ? 1 : -1;
    const path = el("path", {
      class: "edge", d: edgePath(a, b, bend),
      stroke: COLORS[edge.direction] || COLORS.mixed,
      "stroke-width": 0.8 + Math.log2(1 + edge.bindings),
      opacity: 0.5,
      "stroke-dasharray": edge.direction === "unresolved-producer" ? "5 4" : "",
      "marker-end": "url(#arrow-" + (COLORS[edge.direction] ? edge.direction : "mixed") + ")",
      "data-index": index,
    });
    path.dataset.edge = index;
    edgeLayer.appendChild(path);
    const hit = el("path", { class: "edge-hit", d: path.getAttribute("d"), "data-hit": index });
    hit.addEventListener("mouseenter", event => showTip(event, edge));
    hit.addEventListener("mousemove", moveTip);
    hit.addEventListener("mouseleave", hideTip);
    hit.addEventListener("click", () => selectEdge(index));
    edgeLayer.appendChild(hit);
  });

  DATA.nodes.forEach(node => {
    const pos = positions[node.system];
    if (!pos) return;
    const group = el("g", { class: "node", "data-system": node.system });
    group.appendChild(el("circle", {
      cx: pos.x, cy: pos.y, r: pos.r,
      fill: node.his ? "#2f6fed" : (node.kind === "bus" ? "#8b5cf6" :
            (node.kind === "unknown" ? "#ffffff" : "#e8edf5")),
      stroke: node.kind === "unknown" ? "#b0b7c3" : (node.his ? "#1e4fc4" : "#b9c3d1"),
      "stroke-width": node.kind === "unknown" ? 2 : 1.5,
      "stroke-dasharray": node.kind === "unknown" ? "4 3" : "",
    }));
    if (node.his) {
      group.appendChild(el("text", { x: pos.x, y: pos.y + 5, "text-anchor": "middle",
        fill: "#fff", "font-size": "13", "font-weight": "700" })).textContent = "HIS";
    }
    const label = el("text", { x: pos.x, y: pos.y + pos.r + 14, "text-anchor": "middle",
      class: "node-label" });
    label.textContent = node.system;
    group.appendChild(label);
    group.addEventListener("mouseenter", event => showNodeTip(event, node));
    group.addEventListener("mousemove", moveTip);
    group.addEventListener("mouseleave", hideTip);
    group.addEventListener("click", () => toggleNode(node.system));
    nodeLayer.appendChild(group);
  });
  apply();
}
function edgeSummary(edge) {
  const parts = [edge.producer + " → " + edge.consumer,
    "绑定 " + edge.bindings + " · 端点 " + edge.endpoints +
    " · 消息 " + edge.messages + " · 路由 " + edge.routes,
    "kind: " + edge.kinds.join(", "),
    "方向: " + edge.directions.join(", ")];
  if (edge.request_codes.length) {
    parts.push("请求: " + edge.request_codes.slice(0, 6).join(", ") +
      (edge.request_codes.length > 6 ? " …共 " + edge.request_codes.length + " 个" : ""));
  }
  if (edge.message_codes.length) {
    parts.push("消息: " + edge.message_codes.slice(0, 6).join(", ") +
      (edge.message_codes.length > 6 ? " …共 " + edge.message_codes.length + " 个" : ""));
  }
  if (edge.controllers.length) {
    parts.push("HIS Controller: " + edge.controllers.slice(0, 4).join(", ") +
      (edge.controllers.length > 4 ? " …共 " + edge.controllers.length + " 个" : ""));
  }
  parts.push("点击查看该配对的请求明细");
  return parts.join("\\n");
}
function nodeSummary(node) {
  if (node.kind === "unknown") return "生产方未登记\\n仅消费侧有登记证据";
  return node.system + (node.his ? "（HIS）" : "") +
    "\\n生产绑定 " + node.as_producer + " · 消费绑定 " + node.as_consumer +
    "\\n消息生产 " + node.messages_produced + " · 消息消费 " + node.messages_consumed;
}
function showTip(event, edge) { tip.textContent = edgeSummary(edge); tip.style.display = "block"; moveTip(event); }
function showNodeTip(event, node) { tip.textContent = nodeSummary(node); tip.style.display = "block"; moveTip(event); }
function moveTip(event) {
  const box = svg.getBoundingClientRect();
  tip.style.left = (event.clientX - box.left + 14) + "px";
  tip.style.top = (event.clientY - box.top + 14) + "px";
}
function hideTip() { tip.style.display = "none"; }
function visible(edge) {
  if (!state.dirs.has(edge.direction) && edge.direction !== "mixed") return false;
  if (state.dirs.size === 0) return false;
  if (state.node && edge.producer !== state.node && edge.consumer !== state.node) return false;
  if (state.query) {
    const hay = (edge.producer + " " + edge.consumer + " " + edge.services.join(" ") + " " +
      edge.request_codes.join(" ") + " " + edge.message_codes.join(" ") + " " +
      edge.controllers.join(" ")).toLowerCase();
    if (!hay.includes(state.query)) return false;
  }
  return true;
}
function detailVisible(row) {
  if (state.dirs.size === 0 || !state.dirs.has(row.direction)) return false;
  if (state.pair && (row.producer !== state.pair[0] || row.consumer !== state.pair[1])) return false;
  if (state.query) {
    const hay = [row.producer, row.consumer, row.producer_service, row.producer_name,
      row.consumer_service, row.consumer_name, row.requests.join(" "),
      row.messages.map(m => m.code + " " + m.desc).join(" "), row.declared.join(" "),
      row.kinds.join(" "), row.controllers.join(" "),
      row.controller_missing.map(m => m.code + " " + m.name).join(" ")]
      .join(" ").toLowerCase();
    if (!hay.includes(state.query)) return false;
  }
  return true;
}
function apply() {
  document.querySelectorAll("path.edge").forEach(path => {
    path.classList.toggle("dim", !visible(DATA.edges[+path.dataset.index]));
  });
  document.querySelectorAll("path.edge-hit").forEach(path => {
    path.classList.toggle("dim", !visible(DATA.edges[+path.dataset.hit]));
  });
  document.querySelectorAll(".node circle").forEach(circle => {
    const system = circle.parentNode.dataset.system;
    const active = !state.node || state.node === system ||
      DATA.edges.some(e => visible(e) && (e.producer === system || e.consumer === system));
    circle.classList.toggle("dim", !active);
  });
  document.querySelectorAll("path.edge.sel").forEach(p => p.classList.remove("sel"));
  if (state.selected != null) {
    const sel = document.querySelector('path.edge[data-index="' + state.selected + '"]');
    if (sel) sel.classList.add("sel");
  }
  renderPairs();
  renderPairDetail();
  if (state.view === "detail") renderDetails();
}
function renderPairs() {
  const list = DATA.edges.filter(visible)
    .sort((a, b) => (b.bindings - a.bindings) || (a.producer + a.consumer).localeCompare(b.producer + b.consumer));
  document.getElementById("pair-count").textContent = list.length;
  const box = document.getElementById("pairs");
  box.innerHTML = "";
  list.forEach(edge => {
    const index = DATA.edges.indexOf(edge);
    const row = document.createElement("div");
    row.className = "pair" + (state.selected === index ? " active" : "");
    row.dataset.index = index;
    row.innerHTML = '<div class="head"><span class="name">' + esc(edge.producer) + " → " +
      esc(edge.consumer) + '</span><span class="tag" style="color:' +
      (COLORS[edge.direction] || COLORS.mixed) + '">' + esc(edge.direction) + "</span></div>" +
      '<div class="stats">绑定 ' + edge.bindings + " · 端点 " + edge.endpoints +
      " · 消息 " + edge.messages + " · 路由 " + edge.routes + "</div>" +
      '<div class="stats">' + esc(edge.kinds.join(", ")) + "</div>";
    row.addEventListener("mouseenter", event => showTip(event, edge));
    row.addEventListener("mousemove", moveTip);
    row.addEventListener("mouseleave", hideTip);
    row.addEventListener("click", () => selectEdge(index));
    box.appendChild(row);
  });
}
function chips(list, cls) {
  return list.map(value => '<span class="' + cls + '">' + esc(value) + "</span>").join("");
}
function msgChips(list) {
  return list.map(item => '<span class="msg" title="' + esc(item.desc) + '">' +
    esc(item.code) + (item.desc ? " " + esc(item.desc) : "") + "</span>").join("");
}
function requestCell(row) {
  let out = "";
  if (row.requests.length) out += chips(row.requests, "code");
  if (row.messages.length) out += msgChips(row.messages);
  if (row.declared.length) out += chips(row.declared, "term");
  if (!out) out = '<span class="sub">服务级声明（无请求码）</span>';
  return out;
}
function controllerCell(row) {
  let out = row.controllers.map(value => '<span class="ctl">' + esc(value) + "</span>").join("");
  row.controller_missing.forEach(item => {
    out += '<span class="miss" title="' + esc(item.name) + ' · 未在代码索引中命中">' +
      esc(item.code) + (item.path ? " (" + esc(item.path) + ")" : "") + "</span>";
  });
  if (out) return out;
  if (row.controller_status === "no-resource-code") {
    return '<span class="sub">服务级声明（无资源码）</span>';
  }
  if (row.controller_status === "not-his-producer") return '<span class="sub">—</span>';
  return '<span class="sub">未挂接</span>';
}
function pairDetailRow(row) {
  const what = [];
  if (row.requests.length) what.push("请求: " + chips(row.requests, "code"));
  if (row.messages.length) what.push("消息: " + msgChips(row.messages));
  if (row.declared.length) what.push("声明: " + chips(row.declared, "term"));
  if (!what.length) what.push('<span class="sub">服务级声明（无请求码）</span>');
  if (row.controllers.length) what.push("Controller: " + chips(row.controllers, "ctl"));
  return '<div class="mini">' + what.join('<div class="k"></div>') +
    '<div class="k">' + esc(row.kinds.join(", ")) + " · " + esc(row.confidence) +
    (row.routes ? " · 路由动作 " + row.routes : "") + "</div></div>";
}
function renderPairDetail() {
  const box = document.getElementById("pair-detail");
  if (!state.pair) { box.innerHTML = ""; return; }
  const rows = DATA.details.filter(row =>
    row.producer === state.pair[0] && row.consumer === state.pair[1]);
  let out = '<h2>该配对的请求明细（' + rows.length +
    '）<button class="linkbtn" id="to-detail">在请求明细中查看</button></h2>';
  rows.forEach(row => { out += pairDetailRow(row); });
  box.innerHTML = out;
  const button = document.getElementById("to-detail");
  if (button) button.addEventListener("click", () => switchView("detail"));
}
function renderDetails() {
  const rows = DATA.details.filter(detailVisible);
  document.getElementById("detail-count").textContent =
    "请求级明细 " + rows.length + " 条 / 共 " + DATA.details.length + " 条";
  const filter = document.getElementById("detail-filter");
  if (state.pair) {
    filter.innerHTML = '<span class="chip-filter">配对：' + esc(state.pair[0]) + " → " +
      esc(state.pair[1]) + ' <button id="clear-pair">×</button></span>';
    document.getElementById("clear-pair").addEventListener("click", () => {
      state.pair = null; apply();
    });
  } else {
    filter.innerHTML = "";
  }
  const body = document.getElementById("detail-body");
  body.innerHTML = "";
  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><div><b>' + esc(row.producer) + '</b></div><div class="sub">' +
        esc([row.producer_service, row.producer_name].filter(Boolean).join(" ")) + "</div></td>" +
      '<td class="ctl-cell">' + controllerCell(row) + "</td>" +
      '<td class="req">' + requestCell(row) + "</td>" +
      '<td><div><b>' + esc(row.consumer) + '</b></div><div class="sub">' +
        esc([row.consumer_service, row.consumer_name].filter(Boolean).join(" ")) + "</div></td>" +
      '<td><span class="tag" style="color:' + (COLORS[row.direction] || COLORS.mixed) + '">' +
        esc(row.direction) + "</span>" + esc(row.kinds.join(", ")) +
        ' <span class="tag">' + esc(row.confidence) + "</span>" +
        (row.matched > 1 ? ' <span class="tag">端点 ' + row.matched + "</span>" : "") +
        (row.routes ? ' <span class="tag">路由 ' + row.routes + "</span>" : "") +
      "</td>";
    body.appendChild(tr);
  });
}
function switchView(view) {
  state.view = view;
  document.getElementById("graphView").hidden = view !== "graph";
  document.getElementById("detailView").hidden = view !== "detail";
  document.querySelectorAll(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  apply();
}
function selectEdge(index) {
  state.selected = state.selected === index ? null : index;
  const edge = DATA.edges[index];
  state.pair = state.selected == null ? null : [edge.producer, edge.consumer];
  apply();
  if (edge) tip.textContent = edgeSummary(edge);
}
function toggleNode(system) {
  state.node = state.node === system ? null : system;
  state.selected = null;
  state.pair = null;
  apply();
}
document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});
document.querySelectorAll(".dir").forEach(box => {
  box.addEventListener("change", () => {
    state.dirs = new Set([...document.querySelectorAll(".dir:checked")].map(item => item.value));
    apply();
  });
});
document.getElementById("search").addEventListener("input", event => {
  state.query = event.target.value.trim().toLowerCase();
  apply();
});
document.getElementById("meta").textContent =
  DATA.meta.systems + " 个系统 · " + DATA.meta.bindings + " 条绑定 / " +
  DATA.details.length + " 条请求级明细 · " +
  (DATA.meta.controllers || 0) + " 个 HIS Controller · " +
  DATA.nodes.length + " 个节点 / " + DATA.edges.length + " 条聚合边 · 来源 " +
  DATA.meta.source + " · " + DATA.meta.database + "." + DATA.meta.schema;
draw();
</script>
</body>
</html>
"""


def render_html(db, nodes, edges, details):
    stats = db["meta"]["counts"]
    payload = {
        "meta": {
            "systems": stats["systems"],
            "bindings": stats["bindings"],
            "controllers": stats.get("controllers", 0),
            "source": db["meta"]["source"],
            "database": db["meta"]["database"],
            "schema": db["meta"]["schema"],
        },
        "directions": list(DIRECTIONS),
        "nodes": nodes,
        "edges": edges,
        "details": details,
    }
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    data = data.replace("</", "<\\/")
    return _HTML.replace("__DATA__", data)


def _cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def _side(system, service, name):
    parts = [system]
    if service:
        parts.append(service)
    if name:
        parts.append(name)
    return " · ".join(_cell(part) for part in parts)


def _controller_cell(row):
    parts = []
    if row["controllers"]:
        parts.append("<br>".join(_cell(c) for c in row["controllers"]))
    missing = "、".join((f"`{m['code']}`({m['path']})" if m["path"] else f"`{m['code']}`")
                       for m in row["controller_missing"])
    if missing:
        parts.append("未解析: " + missing)
    if not parts:
        if row["controller_status"] == "no-resource-code":
            parts.append("服务级声明")
        elif row["controller_status"] == "not-his-producer":
            parts.append("—")
    return "<br>".join(parts) if parts else "—"


def render_checklist(db, details):
    stats = db["meta"]["counts"]
    with_requests = [row for row in details if row["requests"]]
    message_only = [row for row in details if not row["requests"] and row["messages"]]
    neither = [row for row in details if not row["requests"] and not row["messages"]]

    index = defaultdict(list)
    for row in details:
        for code in row["requests"]:
            index[code].append(row)

    lines = [
        "# 服务总线请求码对照清单",
        "",
        "由 `export_aggregation_graph.py --checklist` 从 `aggregation_db.json` 确定性生成，请勿手工编辑。",
        "",
        "| 项目 | 值 |",
        "|---|---|",
        f"| 源库 | `{db['meta']['database']}.{db['meta']['schema']}`（{db['meta']['source']}） |",
        f"| 接入系统 / 绑定 | {stats['systems']} / {stats['bindings']} |",
        f"| 含请求码的绑定 | {len(with_requests)}（其中 {len(with_requests) - sum(1 for r in with_requests if r['messages'])} 条仅请求，"
        f"{sum(1 for r in with_requests if r['messages'])} 条请求 + 消息） |",
        f"| 仅消息码的绑定 | {len(message_only)} |",
        f"| 无请求 / 消息码的绑定 | {len(neither)} |",
        f"| 请求码 | {len(index)} 个，出现 {sum(len(v) for v in index.values())} 次 |",
    ]
    link = db["meta"].get("controller_link") or {}
    controllers = {item["id"]: item for item in db.get("controllers") or []}
    if link:
        lines += [
            f"| HIS Controller | {stats.get('controllers', 0)} 个方法挂在 "
            f"{link['bindings_with_controller']} 完全 / {link['bindings_partial']} 部分 / "
            f"{link['bindings_unresolved']} 未解析绑定上；请求码解析 "
            f"{link['codes_resolved']} / {link['codes_resolved'] + len(link['codes_unresolved'])} |",
        ]
    lines += [
        "",
        "口径：",
        "",
        "- 请求码取绑定 `evidence.resource_codes`，即总线 `published_matches` 中发布服务端点与注册服务端点求交后的命中码。",
        "- 同一请求码在两侧登记为同一字符串，总线不保存「生产方叫 A、消费方叫 B」两套命名；"
        "成对命名只出现在消息类绑定的 `MSGxxxx` + 消息描述。",
        "- 方向 `outbound` = HIS 生产 → 外部消费，`inbound` = 外部生产 → HIS 消费，`external` = 外部 ↔ 外部，"
        "`internal` = HIS 内部，`unresolved-producer` = 生产方未登记。",
        "",
        f"## 表 A：含请求码的 {len(with_requests)} 条绑定",
        "",
        "| 绑定 | 方向 | 依据 | 置信 | 生产方 | HIS Controller | 具体请求码 | 消费方 | 命中端点 | 路由 |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in with_requests:
        cells = [
            row["id"],
            row["direction"],
            ", ".join(row["kinds"]),
            row["confidence"],
            _side(row["producer"], row["producer_service"], row["producer_name"]),
            _controller_cell(row),
            ", ".join(f"`{code}`" for code in row["requests"]),
            _side(row["consumer"], row["consumer_service"], row["consumer_name"]),
            str(row["matched"]),
            str(row["routes"]),
        ]
        lines.append("| " + " | ".join(cells) + " |")
        if row["messages"]:
            msgs = "、".join(f"`{m['code']}` {m['desc']}".strip() for m in row["messages"])
            lines.append(f"| | | | | | | 消息：{_cell(msgs)} | | | |")

    lines += [
        "",
        f"## 表 B：没有请求码的 {len(message_only) + len(neither)} 条绑定",
        "",
        "| 绑定 | 方向 | 依据 | 置信 | 生产方 | 消息 / 说明 | 消费方 | 路由 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in sorted(message_only + neither,
                      key=lambda item: (item["producer"], item["consumer"], item["id"])):
        if row["messages"]:
            note = "、".join(f"`{m['code']}` {m['desc']}".strip() for m in row["messages"])
        else:
            note = "无请求码 / 消息码（依据：" + ", ".join(row["kinds"]) + "）"
        cells = [
            row["id"],
            row["direction"],
            ", ".join(row["kinds"]),
            row["confidence"],
            _side(row["producer"], row["producer_service"], row["producer_name"]),
            _cell(note),
            _side(row["consumer"], row["consumer_service"], row["consumer_name"]),
            str(row["routes"]),
        ]
        lines.append("| " + " | ".join(cells) + " |")

    code_controllers = defaultdict(set)
    for item in db.get("controllers") or []:
        for code in item.get("resource_codes") or []:
            code_controllers[code].add(f"{item['controller']}.{item['method']}")

    lines += [
        "",
        f"## 表 C：{len(index)} 个请求码反查（按绑定数降序）",
        "",
        "| 请求码 | 绑定数 | HIS Controller | 生产方 | 消费方 |",
        "|---|---|---|---|---|",
    ]
    for code in sorted(index, key=lambda item: (-len(index[item]), item)):
        rows = index[code]
        producers = sorted({_side(r["producer"], r["producer_service"], r["producer_name"]) for r in rows})
        consumers = sorted({_side(r["consumer"], r["consumer_service"], r["consumer_name"]) for r in rows})
        if code in code_controllers:
            ctl = "<br>".join(_cell(c) for c in sorted(code_controllers[code]))
        else:
            miss = sorted({m["path"] for r in rows for m in r["controller_missing"]
                           if m["code"] == code and m["path"]})
            ctl = "未解析: " + "、".join(f"`{code}`({p})" for p in miss) if miss else "未解析"
        lines.append(f"| `{code}` | {len(rows)} | {ctl} | {'<br>'.join(producers)} | {'<br>'.join(consumers)} |")
    return "\n".join(lines) + "\n"


def render_graphml(nodes, edges):
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns '
        'http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">',
        '<key id="n0" for="node" attr.name="system" attr.type="string"/>',
        '<key id="n1" for="node" attr.name="kind" attr.type="string"/>',
        '<key id="n2" for="node" attr.name="is_his" attr.type="boolean"/>',
        '<key id="n3" for="node" attr.name="as_producer" attr.type="int"/>',
        '<key id="n4" for="node" attr.name="as_consumer" attr.type="int"/>',
        '<key id="n5" for="node" attr.name="messages_produced" attr.type="int"/>',
        '<key id="n6" for="node" attr.name="messages_consumed" attr.type="int"/>',
        '<key id="n7" for="node" attr.name="weight" attr.type="int"/>',
        '<key id="e0" for="edge" attr.name="bindings" attr.type="int"/>',
        '<key id="e1" for="edge" attr.name="endpoints" attr.type="int"/>',
        '<key id="e2" for="edge" attr.name="messages" attr.type="int"/>',
        '<key id="e3" for="edge" attr.name="routes" attr.type="int"/>',
        '<key id="e4" for="edge" attr.name="kinds" attr.type="string"/>',
        '<key id="e5" for="edge" attr.name="directions" attr.type="string"/>',
        '<key id="e6" for="edge" attr.name="services" attr.type="string"/>',
        '<key id="e7" for="edge" attr.name="request_codes" attr.type="string"/>',
        '<key id="e8" for="edge" attr.name="message_codes" attr.type="string"/>',
        '<key id="e9" for="edge" attr.name="controllers" attr.type="string"/>',
        '<graph id="aggregation" edgedefault="directed">',
    ]
    for index, node in enumerate(nodes, 1):
        node_id = "n%04d" % index
        node["_id"] = node_id
        lines.append('<node id="%s">' % node_id)
        for key, name in (("n0", "system"), ("n1", "kind"), ("n2", "his")):
            value = node.get(name)
            if isinstance(value, bool):
                value = "true" if value else "false"
            lines.append('<data key="%s">%s</data>' % (key, html.escape(str(value), quote=False)))
        for key, name in (("n3", "as_producer"), ("n4", "as_consumer"),
                          ("n5", "messages_produced"), ("n6", "messages_consumed"),
                          ("n7", "weight")):
            lines.append('<data key="%s">%d</data>' % (key, int(node.get(name) or 0)))
        lines.append("</node>")
    by_name = {node["system"]: node["_id"] for node in nodes}
    for index, edge in enumerate(edges, 1):
        lines.append('<edge id="e%04d" source="%s" target="%s">' % (
            index, by_name[edge["producer"]], by_name[edge["consumer"]]))
        for key, name in (("e0", "bindings"), ("e1", "endpoints"), ("e2", "messages"),
                          ("e3", "routes")):
            lines.append('<data key="%s">%d</data>' % (key, int(edge.get(name) or 0)))
        for key, name in (("e4", "kinds"), ("e5", "directions"), ("e6", "services"),
                          ("e7", "request_codes"), ("e8", "message_codes")):
            value = ",".join(edge.get(name) or [])
            lines.append('<data key="%s">%s</data>' % (key, html.escape(value, quote=False)))
        if edge.get("controllers"):
            value = ",".join(edge["controllers"])
            lines.append('<data key="e9">%s</data>' % html.escape(value, quote=False))
        lines.append("</edge>")
    lines.append("</graph>")
    lines.append("</graphml>")
    return "\n".join(lines) + "\n"


def export_all(db, html_path=None, graphml_path=None, checklist_path=None):
    """写出 HTML / GraphML / 请求码对照清单，返回 (paths, nodes, edges, details)。"""
    nodes, edges, details = aggregate(db)
    html_path = Path(html_path or OUTPUT_DIR / "aggregation_graph.html")
    graphml_path = Path(graphml_path or OUTPUT_DIR / "aggregation_graph.graphml")
    checklist_path = Path(checklist_path or OUTPUT_DIR / "aggregation_request_checklist.md")
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(render_html(db, nodes, edges, details), encoding="utf-8")
    graphml_path.write_text(render_graphml(nodes, edges), encoding="utf-8")
    checklist_path.write_text(render_checklist(db, details), encoding="utf-8")
    return (html_path, graphml_path, checklist_path), nodes, edges, details


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DB_FILE))
    parser.add_argument("--html", default=str(OUTPUT_DIR / "aggregation_graph.html"))
    parser.add_argument("--graphml", default=str(OUTPUT_DIR / "aggregation_graph.graphml"))
    parser.add_argument("--checklist", default=str(OUTPUT_DIR / "aggregation_request_checklist.md"))
    args = parser.parse_args()

    db = _load(args.db)
    (html_path, graphml_path, checklist_path), nodes, edges, details = export_all(
        db, args.html, args.graphml, args.checklist)
    print(f"节点 {len(nodes)} / 聚合边 {len(edges)} / 请求级明细 {len(details)} → {html_path}")
    print(f"GraphML → {graphml_path}")
    print(f"请求码对照清单 → {checklist_path}")


if __name__ == "__main__":
    main()
