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
   - 导出前做相关性过滤：保留直接调用医生站 Feign 接口的服务及其上游调用方，剔除外部库目标边（`--no-filter` 可关闭）

3. **数据合并与索引生成**
   - 合并工作区与 Maven 数据，构建 Controller → Feign 服务边界映射
   - 生成 `impact_db.json`（基础查询数据源）
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

### 后端六步

| 步骤 | 脚本 | 耗时 | 输出 |
|---|---|---|---|
| Step 1 | `feign_scanner.py` | ~30s | `feign_interfaces.json` |
| Step 2 | `build_method_graph.py` | ~30-60s（本机实测） | `method_call_graph.jsonl` / `.graphml` |
| Step 3 | `build_maven_biz_graph.py` | ~2s | `maven_biz_*.jsonl/json`（含 `maven_biz_dispatch.json`） |
| Step 4 | `merge_call_graphs.py` | ~2s | `merged_*.jsonl/json` |
| Step 5 | `build_impact_db.py` | ~1-2s | `impact_db.json` |
| Step 6 | `build_penetration_db.py` | ~5-10s | `penetration_db.json`、`inbound_feign_penetration.graphml` |

**当前规模（2026-11, javatools 方案 + 相关性过滤）**:
- Maven biz: 326 jar, 12,120 类, 137,396 方法；原始调用 459,260，过滤后 148,676（55 个相关服务 = 33 直接调用者 + 22 上游 / 44 个剔除）
- 合并后: 158,928 调用关系, 161 服务边界
- `impact_db.json`: 58.5 MB（过滤前 85.8 MB）
- 穿透第一部分: 103,136 节点（62 个外部叶子）/ 118,258 边
- 穿透第二部分: 396 个调用点（353 条 Controller 根 / 43 条方法根）/ 90 个 Feign 接口 / 33 个 Maven 服务 / 约 630 条分派桥边（以 stats 为准）

### 前端五步

| 步骤 | 脚本 | 耗时 | 输出 |
|---|---|---|---|
| Step 1 | `html_scan.py` | ~30s（6,253 页） | `front_pages.jsonl`、`front_elements.jsonl` |
| Step 2 | `js_scan.py` | ~3min（9,810 JS / 8 进程） | `front_js_index.jsonl` |
| Step 3（可选） | `import_menu_snapshot.py --from-db` | ~5s | `menu_snapshot.json` |
| Step 4（可选） | `explore_config_injection.py --from-db` | ~10s（5 场景） | `config_injection_snapshot.json` |
| Step 5 | `build_front_chain_db.py [--graphml]` | ~2-3min | `front_chain_db.json`、`front_chains.jsonl`、`front_scan_stats.json`、`front_chain.graphml`（可选） |

**当前规模（2026-11-06 全量构建，含动态分派与界面关系）**：6,253 页面 / 184,945 元素（23,011 可交互）/ 22,825 个元素带 handler（1,410 未解析）；188,414 函数（36,242 可达，其中工具类 805）；12,212 请求（7,122 个 URL 路径）；28,711 链路；界面→界面 1,031 条（弹出 942 / 内嵌 81 / 跳转 8，440 页有弹出关系；地址未落地 17 处 / 运行时变量 271 / 非静态页面 161）；配置注入 5 场景 / 99 组 / 409 项（并入链路 115 组 / 350 项）；`front_chain_db.json` 52.4 MiB。GraphML 导出剔除工具类方法（18,335 JS方法节点 / 7,122 HTTP请求节点 / 41,902 边）。

## 脚本位置

所有核心脚本位于 `.agents/plugins/imedicalxc-doctor-codegraph/scripts/` 目录。

| 脚本 | 功能 |
|---|---|
| `feign_scanner.py` | Step 1: 扫描工作区 Feign 接口定义 |
| `build_method_graph.py` | Step 2: 构建工作区方法级调用图 |
| `build_maven_biz_graph.py` | Step 3: Maven biz jar 并发扫描 |
| `merge_call_graphs.py` | Step 4: 合并工作区 + Maven 数据 |
| `build_impact_db.py` | Step 5: 生成影响分析索引 |
| `build_penetration_db.py` | Step 6: 生成两部分穿透数据库 |
| `impact_analyzer.py` | 变更影响分析 / 影响范围分析 |
| `query_*.py` | 调用者、Feign 调用、Feign 使用方查询 |
| `query_commit_impact.py` | 提交级批量取证：定位改动方法 → 入站/下游取证 → 按提交聚合（周报联动） |
| `query_front_back_chain.py` | 前后端链路衔接：HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller |
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
python feign_scanner.py && python build_method_graph.py && python build_maven_biz_graph.py && python merge_call_graphs.py && python build_impact_db.py && python build_penetration_db.py

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

## 依赖

- Python 3.x
- javatools（`pip install javatools`）— 纯 Python 字节码分析库
- Maven 本地仓库（环境变量 `MAVEN_REPO`，未设置时 fallback 到本地 Maven 目录）
