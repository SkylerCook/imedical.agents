#!/usr/bin/env python3
"""
生成递归跨服务 Feign 调用链可视化 HTML（Cytoscape.js）

输入: recursive_feign_chains.json
输出: recursive_feign_chains.html（交互式可视化）
"""
import json
import sys
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from config import OUTPUT_DIR


def generate_visualization(data_dir: Path, output_path: Path):
    chains_path = data_dir / 'recursive_feign_chains.json'
    if not chains_path.exists():
        print(f"错误: {chains_path} 不存在")
        sys.exit(1)

    with open(chains_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    chains = data.get('chains', [])
    stats = data.get('stats', {})

    # --- 聚合服务级边 ---
    service_edge_count = defaultdict(int)
    service_edge_chains = defaultdict(list)
    all_services = set()

    for idx, chain in enumerate(chains):
        path = chain.get('path', [])
        if not path:
            continue
        caller_svc = path[0].get('service', 'unknown')
        target_svc = path[-1].get('service', 'unknown')
        all_services.add(caller_svc)
        all_services.add(target_svc)
        if caller_svc != target_svc:
            key = (caller_svc, target_svc)
            service_edge_count[key] += 1
            service_edge_chains[key].append(idx)

    # --- 聚合方法级边（从 chain steps） ---
    method_edges = set()
    method_nodes = set()
    for chain in chains:
        steps = chain.get('chain', [])
        for step in steps:
            method_nodes.add(step.get('method', ''))
            next_method = step.get('calls', '')
            if next_method:
                method_edges.add((step.get('method', ''), next_method))

    # --- 颜色方案 ---
    service_colors = {
        'opcare': '#4CAF50', 'ipcare': '#2196F3', 'aggcare': '#FF9800',
        'opreg': '#9C27B0', 'hispa': '#F44336', 'ma': '#00BCD4',
        'curc': '#8BC34A', 'opalloc': '#FF5722', 'comoe': '#607D8B',
        'cfoe': '#795548', 'cfmr': '#E91E63', 'commr': '#3F51B5',
        'comar': '#009688', 'ipnur': '#FFC107', 'emcare': '#673AB7',
        'insu': '#CDDC39', 'ipar': '#FF6F00', 'phar': '#00ACC1',
    }

    def get_color(svc):
        short = svc.replace('-mediway-server', '').replace('-mediway', '')
        return service_colors.get(short, '#9E9E9E')

    def short_name(svc):
        return svc.replace('-mediway-server', '').replace('-mediway', '')

    # --- 构建 Cytoscape 元素（服务级视图） ---
    cy_nodes = []
    for svc in sorted(all_services):
        count = 0
        for c in chains:
            p = c.get('path', [])
            if any(step.get('service') == svc for step in p):
                count += 1
        cy_nodes.append({
            'data': {
                'id': svc,
                'label': short_name(svc),
                'color': get_color(svc),
                'chainCount': count,
            }
        })

    cy_edges = []
    for (src, tgt), cnt in service_edge_count.items():
        cy_edges.append({
            'data': {
                'id': f'{src}->{tgt}',
                'source': src,
                'target': tgt,
                'weight': cnt,
                'label': str(cnt),
            }
        })

    # --- 构建链详情表数据 ---
    chain_details = []
    for idx, chain in enumerate(chains):
        path = chain.get('path', [])
        if not path:
            continue
        caller_svc = path[0].get('service', '?')
        target_svc = path[-1].get('service', '?')
        path_str = ' → '.join([p.get('service', '?') for p in path])
        cross = caller_svc != target_svc
        entry_method = path[0].get('id', '')
        feign_call = ''
        for p in path:
            if p.get('type') == 'feign':
                feign_call = p.get('id', '')
                break
        chain_details.append({
            'id': idx,
            'entry': entry_method,
            'caller': caller_svc,
            'target': target_svc,
            'feignCall': feign_call,
            'path': path_str,
            'length': len(path),
            'cross': cross,
        })

    cross_count = sum(1 for c in chain_details if c.get('cross', False))

    # --- 生成 HTML ---
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HIS 跨服务 Feign 调用链可视化</title>
<script src="https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js"></script>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #1a1a2e; color: #e0e0e0; }}
.header {{ background: #16213e; padding: 16px 24px; border-bottom: 2px solid #0f3460; }}
.header h1 {{ font-size: 20px; color: #e94560; }}
.header .stats {{ font-size: 13px; color: #a0a0a0; margin-top: 4px; }}
.container {{ display: flex; height: calc(100vh - 80px); }}
.graph-panel {{ flex: 1; position: relative; }}
#cy {{ width: 100%; height: 100%; background: #1a1a2e; }}
.side-panel {{ width: 420px; background: #16213e; border-left: 2px solid #0f3460; display: flex; flex-direction: column; }}
.panel-tabs {{ display: flex; border-bottom: 1px solid #0f3460; }}
.panel-tab {{ padding: 10px 16px; cursor: pointer; font-size: 13px; border-bottom: 2px solid transparent; }}
.panel-tab.active {{ border-bottom-color: #e94560; color: #e94560; }}
.panel-content {{ flex: 1; overflow-y: auto; padding: 12px; }}
.search-box {{ width: 100%; padding: 8px 12px; background: #0f3460; border: 1px solid #1a4080; color: #e0e0e0; border-radius: 4px; margin-bottom: 12px; font-size: 13px; }}
.chain-item {{ padding: 8px 10px; margin-bottom: 6px; background: #1a1a2e; border-radius: 4px; border-left: 3px solid #0f3460; cursor: pointer; font-size: 12px; }}
.chain-item:hover {{ border-left-color: #e94560; }}
.chain-item.cross {{ border-left-color: #FF9800; }}
.chain-entry {{ color: #4CAF50; font-weight: bold; word-break: break-all; }}
.chain-path {{ color: #a0a0a0; margin-top: 2px; word-break: break-all; }}
.chain-meta {{ color: #666; margin-top: 2px; font-size: 11px; }}
.node-detail {{ padding: 12px; }}
.node-detail h3 {{ color: #e94560; margin-bottom: 8px; }}
.node-detail .field {{ margin-bottom: 6px; font-size: 13px; }}
.node-detail .label {{ color: #a0a0a0; }}
.legend {{ padding: 12px; }}
.legend h3 {{ color: #e94560; margin-bottom: 8px; font-size: 14px; }}
.legend-item {{ display: inline-flex; align-items: center; margin: 3px 8px 3px 0; font-size: 12px; }}
.legend-dot {{ width: 12px; height: 12px; border-radius: 50%; margin-right: 4px; }}
.filter-row {{ display: flex; gap: 8px; margin-bottom: 12px; }}
.filter-btn {{ padding: 4px 10px; background: #0f3460; border: 1px solid #1a4080; color: #e0e0e0; border-radius: 3px; cursor: pointer; font-size: 12px; }}
.filter-btn.active {{ background: #e94560; border-color: #e94560; }}
.tooltip {{ position: absolute; background: #16213e; border: 1px solid #e94560; padding: 8px 12px; border-radius: 4px; font-size: 12px; pointer-events: none; z-index: 100; max-width: 400px; display: none; }}
</style>
</head>
<body>
<div class="header">
  <h1>HIS 跨服务 Feign 递归调用链</h1>
  <div class="stats">
    总调用链: {stats.get('total_chains', len(chains))} |
    跨服务链: {cross_count} |
    服务数: {len(all_services)} |
    服务间调用关系: {len(service_edge_count)}
  </div>
</div>
<div class="container">
  <div class="graph-panel">
    <div id="cy"></div>
    <div class="tooltip" id="tooltip"></div>
  </div>
  <div class="side-panel">
    <div class="panel-tabs">
      <div class="panel-tab active" data-tab="chains">调用链列表</div>
      <div class="panel-tab" data-tab="legend">服务图例</div>
      <div class="panel-tab" data-tab="detail">节点详情</div>
    </div>
    <div class="panel-content" id="tab-chains">
      <input class="search-box" id="search" placeholder="搜索方法名、服务名..." />
      <div class="filter-row">
        <div class="filter-btn active" data-filter="all">全部</div>
        <div class="filter-btn" data-filter="cross">仅跨服务</div>
      </div>
      <div id="chain-list"></div>
    </div>
    <div class="panel-content" id="tab-legend" style="display:none">
      <div class="legend">
        <h3>服务节点（{len(all_services)} 个）</h3>
        {''.join([f'<div class="legend-item"><span class="legend-dot" style="background:{get_color(s)}"></span>{short_name(s)}</div>' for s in sorted(all_services)])}
      </div>
    </div>
    <div class="panel-content" id="tab-detail" style="display:none">
      <div class="node-detail" id="node-detail">
        <p style="color:#666">点击图中的节点查看详情</p>
      </div>
    </div>
  </div>
</div>

<script>
const nodesData = {json.dumps(cy_nodes, ensure_ascii=False)};
const edgesData = {json.dumps(cy_edges, ensure_ascii=False)};
const chainDetails = {json.dumps(chain_details, ensure_ascii=False)};

const cy = cytoscape({{
  container: document.getElementById('cy'),
  elements: {{ nodes: nodesData, edges: edgesData }},
  style: [
    {{
      selector: 'node',
      style: {{
        'label': 'data(label)',
        'background-color': 'data(color)',
        'width': 'mapData(chainCount, 1, 500, 25, 70)',
        'height': 'mapData(chainCount, 1, 500, 25, 70)',
        'text-valign': 'center',
        'text-halign': 'center',
        'color': '#e0e0e0',
        'font-size': '11px',
        'text-wrap': 'wrap',
        'text-max-width': '80px',
        'border-width': 2,
        'border-color': '#0f3460',
      }}
    }},
    {{
      selector: 'edge',
      style: {{
        'width': 'mapData(weight, 1, 200, 1, 8)',
        'line-color': '#334',
        'target-arrow-color': '#667',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '9px',
        'color': '#888',
        'text-rotation': 'autorotate',
        'text-background-color': '#1a1a2e',
        'text-background-opacity': 1,
        'text-background-padding': '2px',
      }}
    }},
    {{
      selector: 'node.highlighted',
      style: {{
        'border-color': '#e94560',
        'border-width': 4,
        'z-index': 999,
      }}
    }},
    {{
      selector: 'edge.highlighted',
      style: {{
        'line-color': '#e94560',
        'target-arrow-color': '#e94560',
        'width': 4,
        'z-index': 999,
      }}
    }},
    {{
      selector: 'node.dimmed',
      style: {{ 'opacity': 0.2 }}
    }},
    {{
      selector: 'edge.dimmed',
      style: {{ 'opacity': 0.1 }}
    }}
  ],
  layout: {{
    name: 'cose',
    animate: false,
    nodeRepulsion: 15000,
    idealEdgeLength: 180,
    edgeElasticity: 100,
    gravity: 0.25,
    numIter: 1500,
  }},
}});

// --- Tab switching ---
document.querySelectorAll('.panel-tab').forEach(tab => {{
  tab.addEventListener('click', () => {{
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none');
    document.getElementById('tab-' + tab.dataset.tab).style.display = 'block';
  }});
}});

// --- Chain list ---
function renderChainList(filter, search) {{
  const list = document.getElementById('chain-list');
  let items = chainDetails;
  if (filter === 'cross') items = items.filter(c => c.cross);
  if (search) {{
    const q = search.toLowerCase();
    items = items.filter(c => c.entry.toLowerCase().includes(q) || c.caller.includes(q) || c.target.includes(q) || c.path.toLowerCase().includes(q));
  }}
  list.innerHTML = items.slice(0, 200).map(c => `
    <div class="chain-item ${{c.cross ? 'cross' : ''}}" data-id="${{c.id}}">
      <div class="chain-entry">${{c.entry.split('.').pop() || c.entry}}</div>
      <div class="chain-path">${{c.caller}} → ${{c.target}} (${{c.length}} 步)</div>
      <div class="chain-meta">${{c.path}}</div>
    </div>
  `).join('');
  if (items.length > 200) {{
    list.innerHTML += `<div style="padding:8px;color:#666;font-size:12px">... 还有 ${{items.length - 200}} 条</div>`;
  }}
}}
renderChainList('all', '');

document.getElementById('search').addEventListener('input', e => {{
  const filter = document.querySelector('.filter-btn.active').dataset.filter;
  renderChainList(filter, e.target.value);
}});

document.querySelectorAll('.filter-btn').forEach(btn => {{
  btn.addEventListener('click', () => {{
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderChainList(btn.dataset.filter, document.getElementById('search').value);
  }});
}});

// --- Node interaction ---
const tooltip = document.getElementById('tooltip');

cy.on('mouseover', 'node', e => {{
  const node = e.target;
  const data = node.data();
  const inEdges = node.incomingEdges().length;
  const outEdges = node.outgoingEdges().length;
  tooltip.innerHTML = `<strong>${{data.label}}</strong><br>关联链: ${{data.chainCount}}<br>入边: ${{inEdges}} | 出边: ${{outEdges}}`;
  tooltip.style.display = 'block';
  const rect = document.getElementById('cy').getBoundingClientRect();
  tooltip.style.left = (e.renderedPosition.x + rect.left + 10) + 'px';
  tooltip.style.top = (e.renderedPosition.y + rect.top - 30) + 'px';
}});

cy.on('mouseout', 'node', () => {{ tooltip.style.display = 'none'; }});

cy.on('tap', 'node', e => {{
  const node = e.target;
  cy.elements().removeClass('highlighted dimmed');
  node.addClass('highlighted');
  node.connectedEdges().addClass('highlighted');
  node.neighborhood().addClass('highlighted');
  cy.elements().not(node.connectedEdges().union(node.neighborhood()).union(node)).addClass('dimmed');

  // Show detail
  const data = node.data();
  const detail = document.getElementById('node-detail');
  const inList = node.incomingEdges().map(e => e.source().data('label')).join(', ');
  const outList = node.outgoingEdges().map(e => e.target().data('label')).join(', ');
  detail.innerHTML = `
    <h3>${{data.label}}</h3>
    <div class="field"><span class="label">全名:</span> ${{data.id}}</div>
    <div class="field"><span class="label">关联调用链:</span> ${{data.chainCount}}</div>
    <div class="field"><span class="label">被调用方:</span> ${{inList || '无'}}</div>
    <div class="field"><span class="label">调用方:</span> ${{outList || '无'}}</div>
  `;
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="detail"]').classList.add('active');
  document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none');
  document.getElementById('tab-detail').style.display = 'block';
}});

cy.on('tap', e => {{
  if (e.target === cy) {{
    cy.elements().removeClass('highlighted dimmed');
  }}
}});

// Edge weight → line width scaling
cy.on('layoutstop', () => {{
  const maxW = Math.max(...edgesData.map(e => e.data.weight), 1);
  cy.edges().forEach(e => {{
    const w = e.data('weight');
    e.style('width', Math.max(1, Math.min(8, (w / maxW) * 8)));
  }});
}});
</script>
</body>
</html>'''

    output_path.write_text(html, encoding='utf-8')
    print(f"✓ 可视化 HTML 已生成: {output_path}")
    print(f"  服务节点: {len(all_services)}")
    print(f"  服务间边: {len(service_edge_count)}")
    print(f"  调用链: {len(chains)} (跨服务 {cross_count})")


def main():
    data_dir = OUTPUT_DIR
    output_path = data_dir / "recursive_feign_chains.html"
    generate_visualization(data_dir, output_path)


if __name__ == '__main__':
    main()
