#!/usr/bin/env python3
"""
生成 Feign 调用关系可视化 HTML
"""
import json
from pathlib import Path
from collections import defaultdict

def generate_visualization(call_chains_path: Path, output_path: Path):
    """生成可视化 HTML"""
    
    # 加载调用链数据
    with open(call_chains_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    chains = data['chains']
    
    # 统计服务间调用次数
    service_edges = defaultdict(int)
    for chain in chains:
        source = chain['caller_service']
        target = chain['target_service']
        if source != target:  # 排除自调用
            service_edges[(source, target)] += 1
    
    # 构建 Cytoscape.js 数据
    nodes = []
    edges = []
    
    # 收集所有服务
    services = set()
    for (source, target) in service_edges.keys():
        services.add(source)
        services.add(target)
    
    # 创建节点
    service_colors = {
        'opcare-mediway-server': '#4CAF50',
        'ipcare-mediway-server': '#2196F3',
        'aggcare-mediway-server': '#FF9800',
        'opreg-mediway-server': '#9C27B0',
        'hispa-mediway-server': '#F44336',
        'ma-mediway-server': '#00BCD4',
        'curc-mediway-server': '#8BC34A',
        'opalloc-mediway-server': '#FF5722',
        'comoe-mediway-server': '#607D8B',
    }
    
    for service in services:
        color = service_colors.get(service, '#9E9E9E')
        nodes.append({
            'data': {
                'id': service,
                'label': service.replace('-mediway-server', ''),
                'color': color,
            }
        })
    
    # 创建边
    for (source, target), weight in service_edges.items():
        edges.append({
            'data': {
                'source': source,
                'target': target,
                'weight': weight,
                'label': f'{weight} 次调用',
            }
        })
    
    # 生成 HTML
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Feign 调用关系图</title>
    <script src="https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js"></script>
    <style>
        body {{
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }}
        #cy {{
            width: 100%;
            height: 600px;
            border: 1px solid #ccc;
            background: white;
            border-radius: 5px;
        }}
        .legend {{
            margin-top: 20px;
            padding: 15px;
            background: white;
            border-radius: 5px;
            border: 1px solid #ccc;
        }}
        .legend-item {{
            display: inline-block;
            margin-right: 20px;
            margin-bottom: 10px;
        }}
        .legend-color {{
            display: inline-block;
            width: 20px;
            height: 20px;
            margin-right: 5px;
            border-radius: 3px;
            vertical-align: middle;
        }}
        .stats {{
            margin-top: 20px;
            padding: 15px;
            background: white;
            border-radius: 5px;
            border: 1px solid #ccc;
        }}
        h2 {{
            margin-top: 0;
            color: #333;
        }}
    </style>
</head>
<body>
    <h2>Feign 跨服务调用关系图</h2>
    <div id="cy"></div>
    
    <div class="legend">
        <h3>服务图例</h3>
        {''.join([f'<div class="legend-item"><span class="legend-color" style="background: {color};"></span>{service.replace("-mediway-server", "")}</div>' for service, color in service_colors.items() if service in services])}
    </div>
    
    <div class="stats">
        <h3>统计数据</h3>
        <p><strong>服务总数:</strong> {len(services)}</p>
        <p><strong>调用关系数:</strong> {len(service_edges)}</p>
        <p><strong>调用点总数:</strong> {data['total_call_sites']}</p>
        <h4>调用频率 Top 10:</h4>
        <ul>
            {''.join([f'<li>{source.replace("-mediway-server", "")} → {target.replace("-mediway-server", "")}: {count} 次</li>' for (source, target), count in sorted(service_edges.items(), key=lambda x: x[1], reverse=True)[:10]])}
        </ul>
    </div>
    
    <script>
        var cy = cytoscape({{
            container: document.getElementById('cy'),
            
            elements: {{
                nodes: {json.dumps(nodes)},
                edges: {json.dumps(edges)}
            }},
            
            style: [
                {{
                    selector: 'node',
                    style: {{
                        'label': 'data(label)',
                        'background-color': 'data(color)',
                        'width': 50,
                        'height': 50,
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'color': '#333',
                        'font-size': '12px',
                        'text-wrap': 'wrap',
                        'text-max-width': '80px'
                    }}
                }},
                {{
                    selector: 'edge',
                    style: {{
                        'width': 2,
                        'line-color': '#ccc',
                        'target-arrow-color': '#ccc',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': '10px',
                        'text-rotation': 'autorotate'
                    }}
                }}
            ],
            
            layout: {{
                name: 'cose',
                animate: false,
                nodeRepulsion: 10000,
                idealEdgeLength: 150,
                edgeElasticity: 100
            }}
        }});
        
        // 点击节点高亮相关边
        cy.on('tap', 'node', function(evt) {{
            var node = evt.target;
            cy.elements().removeClass('highlighted');
            node.connectedEdges().addClass('highlighted');
            node.addClass('highlighted');
        }});
        
        // 点击空白处取消高亮
        cy.on('tap', function(evt) {{
            if (evt.target === cy) {{
                cy.elements().removeClass('highlighted');
            }}
        }});
    </script>
</body>
</html>'''
    
    output_path.write_text(html, encoding='utf-8')
    print(f"✓ 可视化已生成: {output_path}")


if __name__ == "__main__":
    PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
    output_dir = PROJECT_ROOT / "docs" / "imedicalxc-doctor-codegraph"
    call_chains_path = output_dir / "feign_call_chains.json"
    visualization_path = output_dir / "feign_call_graph.html"
    
    generate_visualization(call_chains_path, visualization_path)
