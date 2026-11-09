# imedicalxc-doctor-codegraph

HIS 医生站代码调用图分析框架，拆分为三个 skill：

- `imedicalxc-doctor-codegraph-gen` — 后端索引构建与增量更新（六步流水线）
- `imedicalxc-doctor-codegraph-search` — 调用关系检索与变更影响分析
- `imedicalxc-doctor-codegraph-front-gen` — 前端「界面 → 操作 → JS 方法 → HTTP 请求」链路构建（五步流水线）

## 功能

- 从工作区源码构建方法级调用图（精确到 `package.Class.method(params)returnType`）
- 并发扫描 Maven 本地仓库中的 biz/esb/api/含 Controller 工件（多进程，326 jar ~2 秒）
- 生成阶段过滤与医生站无关的 Maven 服务（保留直接调用医生站 Feign 接口的服务及其上游调用方）
- 生成合并调用图、Controller → Feign 服务边界与 `impact_db.json` 索引
- 生成两部分穿透数据库 `penetration_db.json`：
  1. 工作区业务仓库内部方法调用（外部仓库方法只作叶子）
  2. 其他组 Maven jar 的 Controller → 本工作区 Feign 接口入站链路；无 Controller 可达时退化为方法入口并保留上游片段（`partial_paths`）
- 提供查询工具：变更影响分析、谁调用了某方法、某方法调用了哪些 Feign、Feign 接口使用方分析
- 前端：扫描 `static` 全部 HTML/JS，建立页面 → 操作元素 → 事件 handler → JS 调用链 → HTTP 请求链路
- 界面之间建立指向边：弹出（`websys_showModal` / `ShowHISUIWindow` / `windowOpenFrame` 等）、内嵌（静态 iframe）、跳转（配置下发），随 GraphML 一起导出
- 服务端配置下发的按钮/菜单按场景登记（按钮栏、医嘱右键菜单、护理执行单按钮等），从 Kingbase 导出配置快照后并入链路
- 前端请求只输出 URL 路径，不关联后端 Controller / Feign；菜单快照为可选输入
- 前后端链路衔接：按 URL 对齐前端链路库与工作区 Controller 端点，输出 HTML 页面 → 元素 → JS 方法 → HTTP 请求 → Controller（`query_front_back_chain.py`）

## 核心脚本

所有脚本位于 `.agents/plugins/imedicalxc-doctor-codegraph/scripts/` 目录：

| 脚本 | 功能 |
|---|---|
| `feign_scanner.py` | Step 1: 扫描工作区 Feign 接口定义 |
| `build_method_graph.py` | Step 2: 构建工作区方法级调用图 |
| `build_maven_biz_graph.py` | Step 3: Maven biz jar 并发扫描（javatools ASM） |
| `merge_call_graphs.py` | Step 4: 合并工作区 + Maven 数据 |
| `build_impact_db.py` | Step 5: 生成影响分析索引 |
| `build_penetration_db.py` | Step 6: 生成两部分穿透数据库与入站 Feign GraphML |
| `export_full_graphml.py` | 可选：工作区 + Maven 合并全量 GraphML（仅供布局参考） |
| `maven_api_scanner.py` | 扫描 Maven API jar 包（javatools ASM） |
| `build_complete_feign_chain.py` | 构建完整 Feign 调用链（含 BLH，历史脚本） |
| `impact_analyzer.py` | 变更影响分析 / 影响范围分析 |
| `query_callers.py` | 查询方法的调用者 |
| `query_feign_client.py` | 查询 Feign Client 的所有调用 |
| `query_method_feign.py` | 查询方法调用了哪些 Feign |
| `query_who_calls_feign.py` | 查询谁调用了指定 Feign |
| `query_commit_impact.py` | 提交级批量取证：定位改动方法 → 入站/下游取证 → 按提交聚合（供周报联动） |
| `query_front_back_chain.py` | 前后端链路衔接：HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller |

前端脚本位于 `scripts/front/`：

| 脚本 | 功能 |
|---|---|
| `html_scan.py` | Step 1: 扫描页面、脚本引用、iframe 与操作元素 |
| `js_scan.py` | Step 2: JS 词法分析（函数、调用、事件绑定、URL 常量、请求） |
| `import_menu_snapshot.py` | Step 3: 从 Kingbase 导入菜单（可选） |
| `explore_config_injection.py` | Step 4: 按场景导出服务端配置注入（按钮栏 / 右键菜单 / 执行单按钮，可选） |
| `build_front_chain_db.py` | Step 5: 生成前端链路库 |
| `query_front_chain.py` | 查询页面 / 元素 / 函数 / URL / 界面关系（`links`）/ 菜单链路 |
| `audit_front_coverage.py` | 构建后归属审计：已解析 URL 完整性、未解析 URL 分类、触发点覆盖率、配置注入绑定 |

## 输出文件

所有输出位于 `docs/agents/imedicalxc-doctor-codegraph/` 目录（manifest `projectDirectories` 声明，随项目源码版本提交）：

| 文件 | 内容 | 大小 |
|---|---|---|
| `feign_interfaces.json` | Feign 接口定义 | ~256KB |
| `method_call_graph.jsonl` | 工作区方法级调用图 | ~77MB |
| `method_call_graph.graphml` | 图 1：工作区业务仓库内部调用链（Gephi） | ~78MB |
| `maven_biz_call_graph.jsonl` | Maven biz 方法调用图（仅保留相关服务） | ~8.4MB |
| `maven_biz_dispatch.json` | 接口/父类方法 → 实现/覆写方法分派桥 + 方法 → lambda 合成方法桥 | ~7.2MB |
| `merged_call_graph.jsonl` | 合并后调用图 | ~18MB |
| `impact_db.json` | 影响分析索引（基础查询数据源） | ~33.9MB |
| `penetration_db.json` | **两部分穿透数据库（穿透查询数据源）** | ~41MB |
| `inbound_feign_penetration.graphml` | 图 2：Maven 调用方 → 本工作区 Feign | ~260KB |
| `full_call_graph.graphml` | 可选：工作区 + Maven 合并全图，含无关服务内部边，仅供布局参考 | ~45MB |

前端输出位于 `docs/agents/imedicalxc-doctor-front-codegraph/`（manifest `front-codegraph-index` 声明）：

| 文件 | 内容 | 大小 |
|---|---|---|
| `front_pages.jsonl` | 页面、脚本引用、iframe、元素 | ~32MB |
| `front_elements.jsonl` | 扁平化操作元素 | ~29MB |
| `front_js_index.jsonl` | 函数级全量索引（构建中间数据） | ~165MB |
| `menu_snapshot.json` | 菜单与路由（可选） | — |
| `config_injection_snapshot.json` | 服务端配置注入快照：场景 → 分组 → 配置项（handler/url/院区），5 场景 / 99 组 / 409 项 | ~138KB |
| `front_chain_db.json` | **前端链路查询主数据源**（含 `page_links` 界面关系） | ~81MB |
| `front_chains.jsonl` | 链路扁平视图 | ~42MB |
| `front_scan_stats.json` | 规模与未解析计数 | <1KB |
| `front_chain.graphml` | 有向图：节点=界面 / JS方法 / HTTP请求（工具类方法已剔除；界面节点带标题/模块/页面角色/菜单/方法列表/地址列表/链路数），边=界面→方法→请求 + 界面→界面（弹出/内嵌/跳转，`relation` 属性）（`--graphml`） | ~27MB |

## 使用方式

通过 skill 调用：

- `/imedicalxc-doctor-codegraph-gen` — 首次初始化或增量更新后端索引
- `/imedicalxc-doctor-codegraph-search` — 查询调用关系与变更影响
- `/imedicalxc-doctor-codegraph-front-gen` — 构建或更新前端链路

直接运行流水线：
```bash
# 后端六步
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python feign_scanner.py && python build_method_graph.py && python build_maven_biz_graph.py && python merge_call_graphs.py && python build_impact_db.py && python build_penetration_db.py

# 前端五步（菜单快照与配置注入可选，凭据走环境变量或 MCP）
cd front
python html_scan.py && python js_scan.py && python build_front_chain_db.py
```

## 技术细节

- 使用 **javatools** 纯 Python 字节码分析库（替代 javap 子进程调用，~240x 加速）
- 直接从 zip 读取 class 字节，无需解压到临时目录
- 通过 `code.disassemble()` 提取 invoke 指令（opcode 182-185）
- 通过 `cpool.deref_const()` 解析常量池引用获取调用目标
- 支持三种 Feign 注入方式：@Autowired、@Resource、@RequiredArgsConstructor
- 并发扫描：multiprocessing.Pool(cpu_count()) 按 CPU 核数分配进程
- 正向穿透算法：method → Feign → Controller（目标服务）

## 依赖

- Python 3.x
- `javatools`（`pip install javatools`）

## 配置

- 工作区仓库：12 个业务仓库（opcare、ipcare、aggcare、comoe、hispa 等）
- Maven 仓库路径：环境变量 `MAVEN_REPO`（fallback: 本地 Maven 仓库）
- 输出目录：`docs/agents/imedicalxc-doctor-codegraph/`（manifest `projectDirectories` 的 `codegraph-index` 声明，`config.py` 解析该声明）

## 当前规模（2026-11, javatools 方案 + 相关性过滤）

- Maven biz: 326 jar, 12,120 类, 137,396 方法；原始调用 459,260，过滤后 148,676（55 个相关服务 = 33 直接调用者 + 22 上游 / 44 个剔除）
- 工作区方法图: 16,326 节点 / 87,531 边（GraphML 53,354 节点 / 87,125 边）
- 合并后: 202,251 调用关系, 184 服务边界
- `impact_db.json`: 51.1 MB
- 穿透第一部分: 53,354 节点（9,947 个外部叶子）/ 87,125 边
- 穿透第二部分: 396 个调用点（353 条 Controller 根 / 43 条方法根）/ 90 个 Feign 接口 / 33 个 Maven 服务 / 约 630 条分派桥边（以 stats 为准）

### 前端（2026-11-06 全量构建）

- 页面: 6,253；元素 184,945（可交互 23,011）；22,825 个元素带 handler（21,588 已绑定函数 / 1,410 未解析）
- JS: 9,810 发现 / 9,328 扫描 / 482 跳过（压缩、超限、pdf.js / babel-polyfill 等第三方包）
- 函数: 188,414（链路库保留可达 36,242，工具类 805）
- 请求: 12,212 / 7,122 个 URL 路径（方法+路径去重；未解析 URL 5,696）；链路: 28,711
- 界面关系: 1,031 条（弹出 942 / 内嵌 81 / 跳转 8）；有弹出关系 440 页，无任何界面关系 5,417 页，弹窗/跳转地址未落地 17 处（运行时变量 271 / 非静态页面 161）
- 归属审计: 已解析 URL 全部有链路（0 悬空）；1,266 处可达请求点 URL 无法静态解析；1,018 个可操作页面无链路；17,048 个元素有 handler 但 0 请求（URL 全未解析 246 / handler 本身无请求 16,802）
- 配置注入: 5 场景 / 99 组 / 409 项；并入链路 115 组 / 350 项（跳转 13 项）
- `front_chain_db.json`: 52.4 MiB

动态分派（`*_Common_ControlObj.BeforeUpdate("X")` → `BeforeUpdateFuncs.X` 等）在扫描阶段生成 dispatch 边，构建阶段按页面脚本作用域回填注册表成员；界面之间另有弹出 / 内嵌 / 跳转三类边（`page_links` 与 GraphML 的 `relation` 属性），仅表示静态可达。插件脚本由 `cf_doc_interface_*` 配置在运行时注入，仍不在静态链路内。

## 性能对比

| 方案 | Phase 1 耗时 | 调用数 | 方法数 |
|---|---|---|---|
| javap 子进程（旧） | ~8 分钟 | 118,197 | 60,855 |
| javatools ASM（新） | **~1-2 秒** | **200,529** | **71,805** |
| 加速比 | **~240-480x** | 1.7x 更完整 | 1.18x 更完整 |
