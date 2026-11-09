# AGENTS.md - imedicalxc-doctor-codegraph

本插件提供 HIS 医生站代码调用图分析能力，拆分为三个 skill：后端索引构建/增量更新（gen）、数据检索/影响分析（search）、前端界面操作链路构建（front-gen）。

## 插件信息

- **名称**: imedicalxc-doctor-codegraph
- **版本**: 0.1.0（事实来源为 `.agents-plugin/plugin.json`）
- **类型**: skill plugin
- **入口 skill**:
  - `imedicalxc-doctor-codegraph-gen` — 后端调用图初始化、增量更新
  - `imedicalxc-doctor-codegraph-search` — 后端检索、影响分析
  - `imedicalxc-doctor-codegraph-front-gen` — 前端「界面 → 操作 → JS 方法 → HTTP 请求」链路构建

## 目录结构

```
.agents/plugins/imedicalxc-doctor-codegraph/
├── AGENTS.md                    # 本文件
├── README.md                    # 插件说明
├── skills/
│   ├── imedicalxc-doctor-codegraph-gen/
│   │   └── SKILL.md             # 后端构建与增量更新
│   ├── imedicalxc-doctor-codegraph-search/
│   │   └── SKILL.md             # 检索与影响分析
│   └── imedicalxc-doctor-codegraph-front-gen/
│       └── SKILL.md             # 前端链路构建与增量更新
├── rules/                       # 规则文件（可选）
└── scripts/                     # 后端脚本
    └── front/                   # 前端扫描与查询脚本
```

## 核心能力

### 索引构建（gen）

1. **源码内部调用链梳理**（方法级精度）
   - 从 12 个业务仓库出发，提取所有 Java 类和方法
   - 构建方法级调用图（精确到 `package.Class.method(params)returnType`）
   - 识别 Feign 接口注入（@Autowired、@Resource、private final + @RequiredArgsConstructor）
   - 追踪方法内部的 Feign 调用和内部方法调用

2. **Maven biz jar 并发扫描**
   - 扫描 Maven 本地仓库中的 biz/esb/api 及含 Controller 的 jar（实现代码与入口）
   - 使用 javatools 纯 Python 字节码分析（替代 javap 子进程调用，~240x 加速）
   - 按 CPU 核数分配并发进程（多进程，326 jar ~2 秒）
   - 提取类信息、注解、方法声明、方法调用关系
   - 解析 Controller 类级/方法级映射注解，输出 `maven_controller_endpoints.json`（URL ↔ 方法）；`@RequestMapping` 未声明 method 记为 `ANY`，lambda 合成方法回溯外层方法
   - 导出前做相关性过滤：保留直接调用医生站 Feign 接口的服务及其上游调用方，剔除外部库目标边（`--no-filter` 可关闭）

3. **数据合并与索引生成**
   - 合并工作区与 Maven 数据，构建 Controller → Feign 服务边界映射
   - 解析 Controller 类级 / 方法级映射注解，生成 `controller_endpoints.json`（URL ↔ 后端方法），查询期不再扫源码
   - 生成 `impact_db.json`（基础查询数据源，Controller 节点带 `endpoints`）
   - 生成 `penetration_db.json`（穿透查询数据源，只有两部分：工作区业务仓库内部调用 + Maven Controller → 本工作区 Feign 入站链路）
   - 支持按变更源只重跑受影响的流水线段（增量更新）

### 数据检索（search）

4. **调用关系查询**
   - 变更影响分析（6 段式报告：下游 → Controller → Feign → 外部调用方 → 汇总）
   - 查询指定方法的调用者（谁调用了这个方法）
   - 查询指定方法调用了哪些 Feign 接口
   - 查询 Feign 接口的所有使用方

### 前端链路构建（front-gen）

5. **界面 → 操作 → JS 方法 → HTTP 请求**
   - 扫描 `src/frontend/hisfront/static` 全部 HTML/JS（跳过 `scripts_lib`、`lib`、`node_modules`、`dist`）
   - 操作元素来源：HTML 内联 `on*`、JS 事件绑定（`click/on/bind/delegate`、hisui 插件）、JS 字符串拼出的元素、服务端配置注入、页面加载入口
   - 服务端配置注入按场景登记（`config_injection.py`）：按钮栏 `doc_btnbar`、医嘱右键菜单 `oe_view_right_menu`、医嘱列表菜单 `oe_view_menu`、护理执行单按钮 `nurse_exec_button`、通用页面配置 `page_config`；各场景的配置表、前端识别方式、分组键都不同
   - 零依赖 JS 词法分析：函数定义/调用、URL 常量回填、请求封装（`$ipost/$iget/$iexport/$.ajax/fetch` 等）
   - 菜单快照可选：`hos_sys_resource` 路由匹配页面；配置注入快照可选：配置表 → handler / 跳转地址
   - 调用链按调用深度 BFS 展开（主操作请求优先），本期只输出 URL 路径，不关联后端 Controller / Feign

## 流水线

### 后端七步

| 步骤 | 脚本 | 耗时 | 输出 |
|---|---|---|---|
| Step 1 | `feign_scanner.py` | ~30s | `feign_interfaces.json` |
| Step 2 | `build_method_graph.py` | ~30-60s（本机实测） | `method_call_graph.jsonl` / `.graphml` |
| Step 3 | `build_maven_biz_graph.py` | ~4s | `maven_biz_*.jsonl/json`（含 `maven_biz_dispatch.json`）、`maven_controller_endpoints.json` |
| Step 4 | `merge_call_graphs.py` | ~2s | `merged_*.jsonl/json` |
| Step 5 | `scan_controller_endpoints.py` | ~2s | `controller_endpoints.json`（URL ↔ Controller 方法） |
| Step 6 | `build_impact_db.py` | ~1-2s | `impact_db.json`（依赖 Step 5 的端点索引） |
| Step 7 | `build_penetration_db.py` | ~5-10s | `penetration_db.json`、`inbound_feign_penetration.graphml` |

**当前规模（2026-11-09, javatools 方案 + 相关性过滤）**:
- Maven biz: 326 jar, 12,120 类, 137,396 方法；原始调用 459,260，过滤后 148,676（55 个相关服务 = 33 直接调用者 + 22 上游 / 44 个剔除）
- 工作区方法图: 16,326 节点 / 88,199 边；GraphML 53,357 节点 / 87,788 边
- 合并后: 125,508 节点 / 202,919 边, 184 服务边界
- 端点索引: 工作区 1,681 个源文件 → 1,680 个 Controller / 11,457 条 URL / 11,463 个方法映射；Maven 工件 326 jar → 1,666 个 Controller / 9,255 条 URL / 9,260 个方法映射；`impact_db` 中 3,043 个 Controller 节点带 `endpoints`
- `controller_endpoints.json`: 5.8 MB；`maven_controller_endpoints.json`: 3.1 MB
- `impact_db.json`: 50.8 MB（过滤前 85.8 MB）
- 穿透第一部分: 53,357 节点（9,948 个外部叶子）/ 87,788 边
- 穿透第二部分: 396 个调用点（353 条 Controller 根，其中 342 条带注解 URL / 43 条方法根）/ 90 个 Feign 接口 / 33 个 Maven 服务 / 约 630 条分派桥边（以 stats 为准）

### 前端五步

| 步骤 | 脚本 | 耗时 | 输出 |
|---|---|---|---|
| Step 1 | `html_scan.py` | ~30s（6,243 页） | `front_pages.jsonl`、`front_elements.jsonl` |
| Step 2 | `js_scan.py` | ~3min（9,810 JS / 8 进程） | `front_js_index.jsonl` |
| Step 3（可选） | `import_menu_snapshot.py --from-db` | ~5s | `menu_snapshot.json` |
| Step 4（可选） | `explore_config_injection.py --from-db` | ~10s（5 场景） | `config_injection_snapshot.json` |
| Step 5 | `build_front_chain_db.py [--graphml]` | ~2-3min | `front_chain_db.json`、`front_chains.jsonl`、`front_scan_stats.json`、`front_chain.graphml`（可选） |

**当前规模（2026-11-09 全量构建，含动态分派、片段合并与界面关系）**：6,243 页面 / 183,361 元素（27,535 可交互）/ handler 27,520（26,022 绑定函数 / 1,498 未解析）；193,188 函数（39,645 可达，其中工具类 822）；12,474 请求（7,318 个「方法+路径」）；30,120 链路；界面→界面 1,570 条（弹出 1,045 / 跳转 416 / 内嵌 81 / 包含 28，461 页有弹出关系；地址未落地 37 处 / 运行时变量 766 / 非静态页面 384）；配置注入 5 场景 / 99 组 / 366 项并入链路（跳转 15 / 页面跳转边 10）；`front_chain_db.json` 59.8 MiB。GraphML 导出剔除工具类方法（19,019 JS方法节点 / 7,318 HTTP请求节点 / 43,955 边）。

## 脚本位置

所有核心脚本位于 `.agents/plugins/imedicalxc-doctor-codegraph/scripts/` 目录。

| 脚本 | 功能 |
|---|---|
| `feign_scanner.py` | Step 1: 扫描工作区 Feign 接口定义 |
| `build_method_graph.py` | Step 2: 构建工作区方法级调用图 |
| `build_maven_biz_graph.py` | Step 3: Maven biz jar 并发扫描；解析 Controller 映射注解输出 `maven_controller_endpoints.json` |
| `merge_call_graphs.py` | Step 4: 合并工作区 + Maven 数据 |
| `scan_controller_endpoints.py` | Step 5: 解析 Controller 类级/方法级映射注解，生成 URL ↔ 方法索引（`--check` 校验一致性） |
| `build_impact_db.py` | Step 6: 生成影响分析索引（Controller 节点附 `endpoints`） |
| `build_penetration_db.py` | Step 7: 生成两部分穿透数据库 |
| `impact_analyzer.py` | 变更影响分析 / 影响范围分析 |
| `query_*.py` | 调用者、Feign 调用、Feign 使用方查询 |
| `query_commit_impact.py` | 提交级批量取证：定位改动方法 → 入站/下游取证 → 按提交聚合（周报联动） |
| `query_front_back_chain.py` | 前后端链路衔接：HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller；`impact` 子命令从后端方法反查受影响按钮（含跨仓库 Feign 间接入口），`commit-impact` 子命令把提交入口批量落到界面与菜单访问位置 |
| `export_full_graphml.py` | 可选：合并全图（仅供布局参考） |
| `build_recursive_feign_chain.py` | 可选：递归跨服务穿透（历史脚本） |

前端脚本位于 `scripts/front/`：

| 脚本 | 功能 |
|---|---|
| `html_scan.py` | Step 1: 扫描 HTML 页面、脚本引用、iframe 与操作元素 |
| `js_scan.py` | Step 2: JS 词法分析（函数、调用、事件绑定、URL 常量、请求、弹窗/新开页、配置注入识别） |
| `import_menu_snapshot.py` | Step 3: 从 Kingbase 导入菜单（可选，环境变量传凭据） |
| `explore_config_injection.py` | Step 4: 按场景导出服务端配置注入（`--emit-sql` / `--from-json` / `--from-db`） |
| `build_front_chain_db.py` | Step 5: 解析 handler/调用/URL/配置注入/界面关系，生成前端链路库 |
| `query_front_chain.py` | 查询页面、元素、函数、URL、界面关系（`links`）、菜单链路 |
| `audit_front_coverage.py` | 构建后归属审计：已解析 URL 完整性、未解析 URL 分类、触发点覆盖率、配置注入绑定、界面关系 |

## 输出位置

后端输出位于 `docs/agents/imedicalxc-doctor-codegraph/`（`projectDirectories` 的 `codegraph-index`），前端输出位于 `docs/agents/imedicalxc-doctor-front-codegraph/`（`front-codegraph-index`）。目录均由 `.agents-plugin/plugin.json` 声明，脚本直接解析该声明，不另维护路径副本；索引数据跟随项目源码版本提交，不随能力包分发。

索引为确定性生成：同一源码与 Maven 仓库重复构建逐字节一致（文件遍历、并发扫描结果、序列化顺序均排序）；节点 `file_path` 为工作区相对路径，可直接进行版本比较。

## 使用方式

通过 skill 调用：

- `/imedicalxc-doctor-codegraph-gen` — 首次初始化或增量更新后端索引
- `/imedicalxc-doctor-codegraph-search` — 查询调用关系与变更影响
- `/imedicalxc-doctor-codegraph-front-gen` — 构建或更新前端「界面 → 操作 → JS 方法 → HTTP 请求」链路

全量刷新命令：
```bash
# 后端
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python feign_scanner.py && python build_method_graph.py && python build_maven_biz_graph.py && python merge_call_graphs.py && python scan_controller_endpoints.py && python build_impact_db.py && python build_penetration_db.py

# 前端（菜单快照与配置注入可选，凭据只走环境变量或 Kingbase MCP）
cd front
python html_scan.py && python js_scan.py && python build_front_chain_db.py
```

## 关键踩坑记录

1. **javap 类声明不在第一行**: `javap -p -v -c` 输出首行是 `Classfile /path/...`，类声明在第 4-5 行。必须搜索前 10 行。
2. **服务名在包路径索引 3**: `com.mediway.his.SERVICE.xxx`，`parts[3]` 是服务名，不是 `parts[2]`。
3. **Feign 匹配需检查所有路径段**: target 格式是 `FeignClass.method`，`split('.')[-1]` 是方法名不是类名。
4. **正向穿透而非反向追踪**: 从 Feign 找 Controller（正向），不是从 Feign 找 caller（反向会循环）。
5. **并发安全**: `scan_single_jar()` 必须是独立函数，每个子进程创建独立的 Scanner 实例。
6. **穿透口径只有两部分**: `penetration_db.json` 的 `workspace` 只含 `WORKSPACE_SERVICES` 内部边 + 外部叶子；`inbound_feign` 只含以本工作区 Feign 为终点的入站链路。不要用保留服务的全部 Controller 下游当穿透结果。
7. **接口实现需要分派桥**: 字节码 invoke 连不上 Controller → Service 接口 → Impl，`maven_biz_dispatch.json` 用接口/父类方法到实现/覆写方法的桥补齐反向 Controller 链路。
8. **前端 handler 必须绑定页面脚本上下文**: 全局按方法名查找会把同名函数解析到其他模块。
9. **前端 `new X()` 不是方法调用**: `new Event(...)` 曾误配到 `assessConfig.js::Event`，产生数千条假链路；词法阶段跳过前导 `new`。
10. **前端 URL 未解析时不要回退原始表达式**: `menuWin.baseAppPath+url` 不是接口路径，跨文件前缀变量也不拼进路径；宁可计入 `unresolved_urls`。
11. **前端工具类不能按 `common` 目录一刀切**: 框架副本散落在各模块（`*/scripts/jquery.hisui.js`、`*/common/scripts/websys.js`），而 `ar/common/scripts/interface.js`、`lock.js` 是业务代码；判定规则集中在 `config.utility_reason()`。
12. **配置注入按场景登记，不能只认 `marybtnbar`**: 按钮栏、医嘱右键菜单、护理执行单按钮的配置表/识别方式/分组键都不一样；右键菜单没有配置接口（随页面初始化数据下发），只能靠 `showGridRightMenu` 的类型实参映射；执行单按钮的分组键是单据 `nss_code` 且为运行时变量。
13. **配置快照的 MCP 查询单次最多 500 行**: `truncated: true` 时必须 `LIMIT 500 OFFSET n` 分页合并，否则配置项被静默截断。
14. **调用链遍历必须是 BFS**: 保存类请求由 handler 直接调用，DFS 会被前面分支的深层请求挤掉（表现为「保存按钮查不到 saveOeOrdItem」）。
15. **前端正则字面量必须整体词法化**: `/\\'/g`、`/"/g` 交给字符串规则会吞掉后文并破坏括号配对，`_find_matching` 返回 EOF 后文件尾部被静默丢弃；2026-11-05 因此漏掉 477 个文件的尾部（约 2.3 万函数）。改词法层后用 `audit_front_coverage.py` 复核。
16. **URL 只能从映射注解取**: Controller 的 URL 来自类级 `@RequestMapping` + 方法级 `@PostMapping/@GetMapping/@PutMapping/@DeleteMapping/@RequestMapping`，与 Java 方法名无关（`regPreAccount` ↔ `/opregist/regPreAccount` 只是巧合）；`produces` / `consumes` / `name` 里的字符串不是路径，解析时要忽略。`scan_controller_endpoints.py` 是唯一来源，查询期不要另写正则。
17. **端点索引是构建产物**: `controller_endpoints.json` 由 Step 5 生成并被 Step 6 和 `query_front_back_chain.py` 直接读取；接口改动后按增量表重跑 Step 5 → Step 6，临时排查才用 `--refresh-endpoints` 现场重扫，否则会出现「索引有、图里没有」的不一致。
18. **实现族按 `extends` 展开，不要按方法名合并**: `this.`/`super.` 自调用边已在图内（按 `info.fqn` 解析）。`build_method_graph.py` 的节点带 `parent` / `ancestors`（完整继承链，跨过无方法的中间类）并记录 `@BLH(value=...)` 为 `blh_name`；`impact_analyzer.py::_find_blh_family` 由此沿继承链取**同名覆写子类**（如 `ExamQueryAbstract.getExaReqPrintData` → `Ipcare/OpcareExamQueryAbstract`），兜底仅保留「同服务 + 同名方法 + 图上已有直连边」（`OpregBrokerAbstract` / `OpregistBrokerAbstract` 这类无继承关系的父子）。曾用「全工程同名 Abstract 一起反向追」兜底，会把无关类并进同一族：一次应急初始化方法变更因此挂出 13 个 tr-pilot 页面、`changePreOrdType` 变更挂出 27 个收费/检查申请入口。索引缺继承字段时才回退旧的类名后缀口径。
19. **前端扫描不要迭代 `set`**: `js_scan.py` 的 `PLUGIN_KEYS` 曾用 `set`，`for key in PLUGIN_KEYS` 的顺序随进程哈希种子变化，同一文件里两个回调的 `__handler_N` 编号会在两次构建间互换，并沿 `max_requests` 截断传导成链路数漂移（实测 ±70 条）。现改为有序 `tuple`；新增的键集合若参与迭代，一律用 `tuple`/有序列表，`set` 只用于成员判断。
20. **`commit-impact` 的菜单归并与截断**: 登记表的 `.csp` 入口按 stem 唯一归并到 HTML 页面（`access.via="csp"`，`menus[].csp` 指回原行），父页面上溯同样适用；归并只改访问位置，不增加 `matchedEntrypoints`。单提交 `uiEntries` 截断按「来源 → 页面 → 元素」选条目，不能把 `access.confidence` 放进截断排序——它是元数据，参与排序会让补登记连带换掉页面集合。未命中入口的 `reason` 按 `client-controller` → `feign-interface-mapping` → `cross-service-same-name` → `no-front-call` 互斥归类，其中跨服务同名只解释未命中，不得转成链路。

## 依赖

- Python 3.x
- javatools（`pip install javatools`）— 纯 Python 字节码分析库
- Maven 本地仓库（环境变量 `MAVEN_REPO`，未设置时 fallback 到本地 Maven 目录）
