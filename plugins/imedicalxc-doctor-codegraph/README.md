# imedicalxc-doctor-codegraph

HIS 医生站代码调用图分析框架，拆分为三个 skill：

- `imedicalxc-doctor-codegraph-gen` — 后端索引构建与增量更新（流水线）
- `imedicalxc-doctor-codegraph-search` — 调用关系检索与变更影响分析
- `imedicalxc-doctor-codegraph-front-gen` — 前端「界面 → 操作 → JS 方法 → HTTP 请求」链路构建（五步流水线）

## 功能

- 从工作区源码构建方法级调用图（精确到 `package.Class.method(params)returnType`）
- 并发扫描 Maven 本地仓库中的 biz/esb/api/含 Controller 工件（多进程，326 jar ~2 秒）
- 生成阶段过滤与医生站无关的 Maven 服务（保留直接调用医生站 Feign 接口的服务及其上游调用方）
- 生成合并调用图、Controller → Feign 服务边界与 `impact_db.json` 索引
- 解析 Controller 类级 / 方法级映射注解，生成 `controller_endpoints.json`（URL ↔ 后端方法），供影响分析补充端点、供前后端衔接 O(1) 匹配
- 生成两部分穿透数据库 `penetration_db.json`：
  1. 工作区业务仓库内部方法调用（外部仓库方法只作叶子）
  2. 其他组 Maven jar 的 Controller → 本工作区 Feign 接口入站链路；无 Controller 可达时退化为方法入口并保留上游片段（`partial_paths`）
- 提供查询工具：变更影响分析、谁调用了某方法、某方法调用了哪些 Feign、Feign 接口使用方分析
- 前端：扫描 `static` 全部 HTML/JS，建立页面 → 操作元素 → 事件 handler → JS 调用链 → HTTP 请求链路
- 界面之间建立指向边：弹出（`websys_showModal` / `ShowHISUIWindow` / `windowOpenFrame` 等）、内嵌（静态 iframe）、跳转（配置下发），随 GraphML 一起导出
- 服务端配置下发的按钮/菜单按场景登记（按钮栏、医嘱右键菜单、护理执行单按钮等），从 Kingbase 导出配置快照后并入链路
- 前端请求只输出 URL 路径，不关联后端 Controller / Feign；菜单快照为可选输入
- 前后端链路衔接：按 URL 对齐前端链路库与 `controller_endpoints.json`，输出 HTML 页面 → 元素 → JS 方法 → HTTP 请求 → Controller（`query_front_back_chain.py`）；`impact` 子命令反向从后端方法查受影响按钮，工作区外 Controller 走 Feign 入站链路（启发式，输出中标注）

## 核心脚本

所有脚本位于 `.agents/plugins/imedicalxc-doctor-codegraph/scripts/` 目录：

| 脚本 | 功能 |
|---|---|
| `feign_scanner.py` | Step 1: 扫描工作区 Feign 接口定义 |
| `build_method_graph.py` | Step 2: 构建工作区方法级调用图 |
| `build_maven_biz_graph.py` | Step 3: Maven biz jar 并发扫描（javatools ASM）；解析 Controller 映射注解输出 `maven_controller_endpoints.json` |
| `merge_call_graphs.py` | Step 4: 合并工作区 + Maven 数据 |
| `scan_controller_endpoints.py` | Step 5: 解析 Controller 映射注解，生成 URL ↔ 方法索引（`--check` 校验） |
| `build_type_nesting.py` | Step 5b: 扫描 DTO/VO/PO 实例字段，生成「字段类型 → 外层类型」反向索引 `type_nesting.json`（契约类型按字段嵌套向上展开） |
| `build_type_usage.py` | Step 5c: 扫描方法图节点签名，生成「类型 → 使用该类型作入参的方法」反向索引 `type_usage.json`（契约类型反查 BLH/Service 参数） |
| `build_impact_db.py` | Step 6: 生成影响分析索引（Controller 节点附 `endpoints`） |
| `build_penetration_db.py` | Step 7: 生成两部分穿透数据库与入站 Feign GraphML |
| `export_full_graphml.py` | 可选：工作区 + Maven 合并全量 GraphML（仅供布局参考） |
| `maven_api_scanner.py` | 扫描 Maven API jar 包（javatools ASM） |
| `build_complete_feign_chain.py` | 构建完整 Feign 调用链（含 BLH，历史脚本） |
| `impact_analyzer.py` | 变更影响分析 / 影响范围分析 |
| `query_callers.py` | 查询方法的调用者 |
| `query_feign_client.py` | 查询 Feign Client 的所有调用 |
| `query_method_feign.py` | 查询方法调用了哪些 Feign |
| `query_who_calls_feign.py` | 查询谁调用了指定 Feign |
| `query_commit_impact.py` | 提交级批量取证：定位改动方法 → 入站/下游取证 → 按提交聚合（供周报联动） |
| `query_front_back_chain.py` | 前后端链路衔接：HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller；`impact` 从后端方法反查受影响按钮，`commit-impact` 把提交入口批量落到界面与菜单访问位置 |

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
| `maven_controller_endpoints.json` | **Maven 工件 URL ↔ Controller 方法索引**（类级/方法级映射注解；穿透链路与工作区外按钮匹配的 URL 来源） | ~3MB |
| `merged_call_graph.jsonl` | 合并后调用图 | ~29MB |
| `controller_endpoints.json` | **URL ↔ 后端方法索引**（由 Controller 类级/方法级映射注解解析） | ~5.5MB |
| `type_nesting.json` | **字段类型 → 外层类型反向索引**（DTO/VO 字段组合，供契约类型向上展开） | ~2.7MB |
| `type_usage.json` | **类型 → 方法签名入参使用索引**（键与方法图节点 ID 同形，供契约类型反查 BLH/Service 参数） | ~1.4MB |
| `impact_db.json` | 影响分析索引（基础查询数据源，Controller 节点带 `endpoints`） | ~51MB |
| `penetration_db.json` | **两部分穿透数据库（穿透查询数据源）** | ~41MB |
| `inbound_feign_penetration.graphml` | 图 2：Maven 调用方 → 本工作区 Feign | ~260KB |
| `full_call_graph.graphml` | 可选：工作区 + Maven 合并全图，含无关服务内部边，仅供布局参考 | ~45MB |

前端输出位于 `docs/agents/imedicalxc-doctor-front-codegraph/`（manifest `front-codegraph-index` 声明）：

| 文件 | 内容 | 大小 |
|---|---|---|
| `front_pages.jsonl` | 页面、脚本引用、iframe、`csp-include` 片段、元素 | ~31MB |
| `front_elements.jsonl` | 扁平化操作元素 | ~28MB |
| `front_js_index.jsonl` | 函数级全量索引（构建中间数据） | ~177MB |
| `menu_snapshot.json` | 菜单与路由（可选） | — |
| `config_injection_snapshot.json` | 服务端配置注入快照：场景 → 分组 → 配置项（handler/url/院区），5 场景 / 99 组 / 409 项 | ~138KB |
| `front_chain_db.json` | **前端链路查询主数据源**（含 `page_links` 界面关系） | ~60MB |
| `front_chains.jsonl` | 链路扁平视图 | ~24MB |
| `front_scan_stats.json` | 规模与未解析计数 | <1KB |
| `front_chain.graphml` | 有向图：节点=界面 / JS方法 / HTTP请求（工具类方法已剔除；界面节点带标题/模块/页面角色/菜单/方法列表/地址列表/链路数），边=界面→方法→请求 + 界面→界面（弹出/内嵌/跳转/包含，`relation` 属性）（`--graphml`） | ~19MB |

## 使用方式

通过 skill 调用：

- `/imedicalxc-doctor-codegraph-gen` — 首次初始化或增量更新后端索引
- `/imedicalxc-doctor-codegraph-search` — 查询调用关系与变更影响
- `/imedicalxc-doctor-codegraph-front-gen` — 构建或更新前端链路

直接运行流水线：
```bash
# 后端流水线
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python feign_scanner.py && python build_method_graph.py && python build_maven_biz_graph.py && python merge_call_graphs.py && python scan_controller_endpoints.py && python build_type_nesting.py && python build_type_usage.py && python build_impact_db.py && python build_penetration_db.py

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

## 当前规模（2026-11-09, javatools 方案 + 相关性过滤）

- Maven biz: 326 jar, 12,120 类, 137,396 方法；原始调用 459,260，过滤后 148,676（55 个相关服务 = 33 直接调用者 + 22 上游 / 44 个剔除）
- 工作区方法图: 16,326 节点 / 88,199 边（GraphML 53,357 节点 / 87,788 边）
- 合并后: 125,508 节点 / 202,919 边, 184 服务边界
- 端点索引: 工作区 1,681 个源文件 → 1,680 个 Controller / 11,514 条 URL / 11,520 个方法映射；Maven 工件 326 jar → 1,666 个 Controller / 9,255 条 URL / 9,260 个方法映射；`impact_db` 中 3,043 个 Controller 节点带 `endpoints`
- `impact_db.json`: 50.8 MB
- 穿透第一部分: 53,357 节点（9,948 个外部叶子）/ 87,788 边
- 穿透第二部分: 396 个调用点（353 条 Controller 根，其中 342 条带注解 URL / 43 条方法根）/ 90 个 Feign 接口 / 33 个 Maven 服务 / 约 630 条分派桥边（以 stats 为准）

### 前端（2026-11-09 全量构建）

- 页面: 6,243；元素 183,361（可交互 27,535）；handler 27,520（26,022 绑定到函数 / 1,498 未解析）
- JS: 9,810 发现 / 9,328 扫描 / 482 跳过（压缩、超限、pdf.js / babel-polyfill 等第三方包）
- 函数: 193,188（链路库保留可达 39,645，工具类 822；工具类链路节点 232）
- 请求: 12,474 / 7,318 个「方法+路径」（7,284 个路径；未解析 URL 5,774）；链路: 30,120
- 界面关系: 1,570 条（弹出 1,045 / 跳转 416 / 内嵌 81 / 包含 28）；有弹出关系 461 页，无任何界面关系 5,589 页，弹窗/跳转地址未落地 37 处（运行时变量 766 / 非静态页面 384）
- 归属审计: 已解析 URL 全部有链路（0 悬空）；1,246 处可达请求点 URL 无法静态解析；1,068 个可操作页面无链路；20,286 个元素有 handler 但 0 请求（URL 全未解析 231 / handler 本身无请求 20,055）
- 配置注入: 5 场景 / 99 组 / 366 项并入链路（跳转 15 / 页面跳转边 10），缺失分组 0
- `front_chain_db.json`: 59.8 MiB

动态分派（`*_Common_ControlObj.BeforeUpdate("X")` → `BeforeUpdateFuncs.X` 等）在扫描阶段生成 dispatch 边，构建阶段按页面脚本作用域回填注册表成员；界面之间另有弹出 / 内嵌 / 跳转 / 包含四类边（`page_links` 与 GraphML 的 `relation` 属性），仅表示静态可达。`包含` 来自服务端 `csp-include` 片段，片段的脚本与元素在父页面同样生效。插件脚本由 `cf_doc_interface_*` 配置在运行时注入，仍不在静态链路内。

## 性能对比

| 方案 | Phase 1 耗时 | 调用数 | 方法数 |
|---|---|---|---|
| javap 子进程（旧） | ~8 分钟 | 118,197 | 60,855 |
| javatools ASM（新） | **~1-2 秒** | **200,529** | **71,805** |
| 加速比 | **~240-480x** | 1.7x 更完整 | 1.18x 更完整 |
