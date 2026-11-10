---
name: imedicalxc-doctor-codegraph-gen
description: |
  HIS 医生站代码调用图索引构建与增量更新。执行流水线：Feign 接口扫描 → 工作区方法级调用图 → Maven biz jar 扫描 → 合并 → Controller 注解端点索引（controller_endpoints.json）→ 类型嵌套索引（type_nesting.json）→ 类型使用索引（type_usage.json）→ 影响分析索引（impact_db.json）→ 两部分穿透数据库（penetration_db.json）。
  Use when 首次初始化 codegraph 数据、拉取子仓库或升级 Maven 依赖后重建/增量更新索引、impact_db.json / penetration_db.json 缺失或过期、或需要重新生成调用图数据。
  纯查询与影响分析请使用 imedicalxc-doctor-codegraph-search。
---

# 医生站调用图索引：构建与增量更新

## 职责边界

- 本 skill 只负责**生成/刷新数据**（离线批处理）。
- 查询调用关系、变更影响分析、可视化解读 → `imedicalxc-doctor-codegraph-search`。
- 脚本目录：从项目根进入 `.agents/plugins/imedicalxc-doctor-codegraph/scripts`。
- 所有输出写入 `docs/agents/imedicalxc-doctor-codegraph/`（目录由插件 manifest 的 `projectDirectories` 声明，脚本从 manifest 解析）。

## 前置条件

1. Python 3 + `javatools`（`pip install javatools`，Maven 字节码扫描依赖）
2. Maven 本地仓库可解析，优先级：`MAVEN_REPO` 环境变量 → `settings.xml` 的 `localRepository` → `D:\java\maven...` / `~/.m2/repository`
3. 工作区 12 个业务子仓库已检出（`src/backend/**`，见 `config.py` 的 `WORKSPACE_REPOS`）
4. `docs/agents/imedicalxc-doctor-codegraph/` 可写

自检命令：

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python -c "from config import OUTPUT_DIR, MAVEN_REPO_PATHS, WORKSPACE_REPOS; print('输出:', OUTPUT_DIR); print('Maven:'); print(*MAVEN_REPO_PATHS, sep='\n'); print('仓库数:', len(WORKSPACE_REPOS))"
```

## 初始化：全量构建

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python feign_scanner.py \
  && python build_method_graph.py \
  && python build_maven_biz_graph.py \
  && python merge_call_graphs.py \
  && python scan_controller_endpoints.py \
  && python build_type_nesting.py \
  && python build_type_usage.py \
  && python build_impact_db.py \
  && python build_penetration_db.py
```

| 步骤 | 脚本 | 耗时 | 输出 |
|---|---|---|---|
| Step 1 | `feign_scanner.py` | ~30s | `feign_interfaces.json` |
| Step 2 | `build_method_graph.py` | ~30-60s（2026-11-04 实测，旧环境可能 5-10min） | `method_call_graph.jsonl` + `.graphml` |
| Step 3 | `build_maven_biz_graph.py` | ~4s | `maven_biz_call_graph.jsonl`、`maven_biz_reverse_index.json`、`maven_biz_dispatch.json`、`maven_controller_endpoints.json`、`maven_biz_scan_stats.json` |
| Step 4 | `merge_call_graphs.py` | ~2s | `merged_call_graph.jsonl`、`merged_reverse_index.json`、`merged_service_boundary.json` |
| Step 5 | `scan_controller_endpoints.py` | ~6s | `controller_endpoints.json`（方法记录含 `return_type` / `parameters`，类级 `type_scopes`） |
| Step 5b | `build_type_nesting.py` | ~40-60s | `type_nesting.json`（字段类型 → 外层类型反向索引，供契约类型向上展开嵌套） |
| Step 5c | `build_type_usage.py` | ~30s | `type_usage.json`（类型 → 使用该类型作方法签名参数的方法，供契约类型反向追 Controller） |
| Step 6 | `build_impact_db.py` | ~1-2s | `impact_db.json`（Controller 节点带注解 URL） |
| Step 7 | `build_penetration_db.py` | ~5-10s | `penetration_db.json`、`inbound_feign_penetration.graphml` |

Step 2 的节点除 `parent` / `ancestors` 外还带 `interfaces`，供查询侧在实现类、父类与接口声明之间展开同名方法。服务实现类继承 `BaseServiceImpl<Mapper, PO>` 时记录 Mapper 泛型，`this.baseMapper.xxx()` / `baseMapper.xxx()` 均生成 Mapper 调用边，不能只靠字段类型解析。

Step 5 把类级 `@RequestMapping` + 方法级 `@XxxMapping` 的 URL 关系固化成构建产物，同时记录方法的 `return_type` 与 `parameters`，并记录每个 Controller 的类型作用域（`type_scopes`：显式 import / 同包 / 通配 import）：前后端衔接与影响分析直接读取不再重扫，`scan_controller_endpoints.type_index()` 还能在内存里按类型**全限定名**反查 Controller 方法签名（纯 DTO/VO/PO 提交据此拿到契约入口），跨模块同名 DTO（如 ipcare/opcare 各自的 `FeignOeStopMultiDTO`）不会串号。Step 6、Step 7 都是查询 skill 的数据源，不要省略；Step 6 依赖 Step 5 的端点索引，缺失时只输出「跳过 Controller URL 关联」。`penetration_db.json` 是穿透口径的**唯一契约**，只包含两部分：

1. **工作区业务仓库内部调用关系**：`WORKSPACE_SERVICES`（comoe / ipcare / opcare / commr 等 13 个服务）方法之间的调用；调用 hiscore / hiscf 等外部仓库方法时，外部方法仅作为叶子节点保留，不继续展开。
2. **其他组 Maven jar → 本工作区 Feign**：从对方 Controller 出发，沿真实调用 + 接口/父类分派桥追溯到调用本工作区发布 Feign 接口的调用点；无 Controller 可达时退化为方法入口（`root_type=method`），并把上游片段写入 `partial_paths`。

`maven_penetration_graph.graphml` 已废弃（它按“保留服务内所有 Controller”扫全图，会把 `getFormwork` 这类与 Feign 无关的节点带进来）。

### 类型嵌套索引（Step 5b）

契约类型常以**字段**形式嵌在别的 DTO/VO 里（`FeignDiagnoseVO` 在 `FeignEncounterVO.diagnose`，再进 `FeignOrderLisReturnVO` → `FeignIBUSLisBaseReturnVO`）。只按方法签名反查会漏掉这类使用方，Step 5b 从工作区源码抽出「字段类型 → 外层类型」反向边，写成 `type_nesting.json`：

- 只登记 `class` / `interface` / `enum` / `record` 的实例字段（`static` 字段跳过），按 package / 显式 import / 通配 import 还原全限定名；同包猜测只接受已扫到的类，避免把 `List`、`String` 猜成 `pkg.List`
- 只沿**字段组合**向上展开，不展开 `extends` / `implements`；查询期最多 4 层（`query_commit_impact.MAX_NESTING_DEPTH`）
- 当前规模：38,768 源文件 / 38,534 类 / 7,782 个被嵌套类型 / 23,112 条边（2.7 MB）

查询侧（`query_commit_impact.py`）对变更类型先做签名直接匹配，再按本索引向外层类型补一轮；命中的明细带 `nestedVia`（如 `["FeignDiagnoseVO","FeignEncounterVO","FeignOrderLisReturnVO","FeignIBUSLisBaseReturnVO"]`）与 `matchFqn`，报告据此说明「是字段嵌套命中，不是直接签名」。索引缺失时自动退回只匹配签名，不报错。

### 类型使用索引（Step 5c）

契约类型还常**只出现在 BLH/Service 方法的入参**里，Controller 签名与 Feign 签名都不含它。典型链路：`FeignPaPatMedicalInfoDTO`（字段嵌套）→ `FeignPCAInfoDTO` → `SaveIhdPaPatDataAbstract#setPatientInfo(FeignPCAInfoDTO)` → `savePaPatData` → `PaPatIhdDataSaveClientController#save`。方法图里没有 DTO 节点，反向追不到这种「参数类型」关系，Step 5c 从方法图节点签名（`pkg.Class.method(SimpleType param, ...)` 的括号段）抽出「类型全限定名 → 使用它的方法」索引，写成 `type_usage.json`：

- 只登记**方法签名参数**，方法体里的局部变量不在内；短名按文件 import / 同包 / 通配 import 解析，且必须命中源码里真实存在的类
- 键与方法图节点 ID 一致（去参形式 `pkg.Class.method`），查询期可直接作反向 BFS 的 seed
- 当前规模：16,326 方法 / 3,224 个类型 / 12,784 条引用（1.4 MB）；5 个方法因源文件已删除/改名取不到作用域，3,642 个参数类型未解析到已知类（多为 JDK/框架类型）

查询侧（`query_commit_impact.py`）取「变更类型自身 + 字段嵌套 1 级外壳」作 seed（链长 ≤2 的外层），沿方法图反向 BFS ≤6 跳追 Controller（节点上限 500、每提交至多登记 40 个 Controller），只收有注解 URL 的 Controller，入口 `heuristic=true`、`indirect=true`、`via` 带 `usedBy:<Class.method>`。索引缺失时自动退回 Controller 签名反查，不报错。

### Maven 工件端点索引（Step 3）

Step 3 扫描 jar 时同步解析 Controller 的类级 `@RequestMapping` 与方法级映射注解，输出 `maven_controller_endpoints.json`（与 Step 5 的工作区索引同结构、同 URL 归一化口径）。它是**穿透链路的 URL 来源**：Step 7 给 `root_type=controller` 的链路附上 `endpoints`，查询 skill 的 `impact` 用它精确匹配工作区外按钮，取代「类名去 Controller + 方法名」的猜测。

- 只认 `value` / `path` 元素，忽略 `produces` / `consumes` / `name`；`@RequestMapping` 未声明 `method` 时记为 `ANY`
- lambda 合成方法（`lambda$xxx$N`）没有注解，回溯外层方法 `xxx` 取 URL
- 父类 / 接口上声明的映射暂不回溯（javac 字节码只携带本类声明），这类方法在穿透链路里仍无 URL；当前 353 条 Controller 根链路中 342 条带 URL

### Maven jar 选择（Step 3）

按 artifact 取最新 SNAPSHOT jar，只纳入可能含调用入口或接口的工件：

1. 工件名含 `-biz` / `-esb` / `-api`；
2. 或 jar 内含 `*Controller` / `*Contoller`（历史工程存在 `Contoller` 拼写，手机端 Controller 大量如此）。

Controller 与 ESB 适配器不一定在 `*-biz*.jar`（例如 `ipnur-nurseexecution-api` 的 `ExcuteBindOrderController`、`opar-esb` 的 `ArOPEsb*Controller`、`opspcol-mobile` 的 `OpspcolPadContoller`）；只扫 biz jar 会让这些链路没有入口。

### Maven 相关性过滤（Step 3 默认开启）

Step 3 导出前会剔除与医生站无关的 Maven 节点，规则：

1. **seed 服务**：服务内至少有一个方法调用医生站 `@FeignClient` 接口。
2. **上游服务闭包**：反向可达 seed 的服务一并保留（默认最多 6 跳）。链路入口 Controller 常在不直接调用 Feign 的服务中（如 `trbu`、`ipemr`、`opemr` 调用 `comem`/`comemr`），只保留 seed 会在服务边界把反向链路剪断。
3. **边界保留**：目标为医生站 Feign 接口的调用边始终保留。
4. **外部目标剔除**：目标不是 `com.mediway.his.*`（如 slf4j、fastjson）的边一并剔除。

按服务而不是按方法剪枝，是为了避免误删 BLH 框架反射调用的业务实现方法。调试或需要全量 Maven 数据时，可用 `python build_maven_biz_graph.py --no-filter` 跳过过滤。过滤结果（seed / 上游 / 剔除的服务名与边数）写入 `maven_biz_scan_stats.json` 的 `filter` 字段。


## 增量更新

脚本不按文件粒度做增量；增量 = **只重跑受影响的流水线段**。Step 3 之后均为秒级到半分钟，无需节省。

| 变更源 | 需重跑 | 说明 |
|---|---|---|
| 工作区 Java 源码（业务逻辑，Controller 映射未变） | Step 2 → Step 4 → Step 6 → Step 7 | Step 2 重建工作区图；Step 4 重建合并数据与服务边界；Step 7 重建两部分穿透 |
| 新增/修改 DTO/VO/PO 字段或类型 | Step 5b | 只重建 `type_nesting.json`；契约提交取证前必须刷新，否则字段嵌套命中会缺失 |
| 新增/修改方法签名（BLH/Service 入参类型） | Step 2 → Step 5c | Step 5c 依赖方法图节点签名，方法图重建后必须刷新 `type_usage.json`，否则参数类型反查会缺 seed 或指向旧方法 |
| 新增/修改 Controller 或映射注解 | Step 5 → Step 6 | Step 5 刷新注解 URL 索引；Step 6 把 URL 挂到方法节点。缺失产物时查询脚本仍可用 `--refresh-endpoints` 临时重建 |
| 工作区 `@FeignClient` 接口定义 | Step 1 → Step 4 → Step 6 → Step 7 | Step 1 刷新接口/路径，Step 4 刷新 Controller 映射，Step 7 刷新入站链路 |
| Maven 本地仓库 biz jar（依赖升级、新增 jar） | Step 3 → Step 4 → Step 6 → Step 7 | 重新扫描字节码并合并；相关性过滤与分派桥自动重算 |
| `config.py` 中的描述/映射常量 | 不重建 | `SERVICE_MODULE_MAP` / `METHOD_DESCRIPTION_MAP` / `FEIGN_INTERFACE_DESC` 由查询脚本运行时读取 |
| 无法判断 | 全量 | 直接执行初始化一键命令 |

### 新鲜度自检

从项目根执行，命中输出即表示索引落后：

```bash
# 工作区源码比主索引新
find src/backend src/frontend -name '*.java' \
  -newer docs/agents/imedicalxc-doctor-codegraph/impact_db.json -print -quit

# Maven jar 比 Maven 扫描结果新（MAVEN_REPO 未设置时按 config.py 解析出的路径替换）
find "$MAVEN_REPO/com/mediway" -name '*.jar' \
  -newer docs/agents/imedicalxc-doctor-codegraph/maven_biz_call_graph.jsonl -print -quit
```

无输出表示对应数据仍新鲜。

## 输出文件总览

| 文件 | 内容 | 来源 |
|---|---|---|
| `feign_interfaces.json` | Feign 接口定义（接口、方法签名、HTTP 路径） | Step 1 |
| `method_call_graph.jsonl` | 工作区方法级调用图 | Step 2 |
| `method_call_graph.graphml` | 图 1：工作区内部调用链（Gephi；节点 ID 归一化为 `package.Class.method`，重载合并、边端点补齐、平行边去重） | Step 2 |
| `maven_biz_call_graph.jsonl` | Maven biz 方法调用图（仅保留与医生站相关的服务） | Step 3 |
| `maven_biz_reverse_index.json` | Maven biz 反向索引 | Step 3 |
| `maven_biz_dispatch.json` | 接口/父类方法 → 实现/覆写方法的分派桥，以及方法 → 其 lambda 合成方法桥 | Step 3 |
| `maven_controller_endpoints.json` | Maven 工件 Controller 注解 URL 索引（`endpoints` URL → 方法）；穿透链路与工作区外按钮匹配的 URL 来源 | Step 3 |
| `merged_call_graph.jsonl` | 合并后调用图 | Step 4 |
| `merged_reverse_index.json` | 合并后反向索引 | Step 4 |
| `merged_service_boundary.json` | Controller → Feign 映射 | Step 4 |
| `controller_endpoints.json` | Controller 注解 URL 索引：`endpoints`（URL → 方法，方法记录含 `return_type` / `parameters`）、`type_scopes`（Controller 的 package / import / 通配 import，供全限定名解析）与 `meta`（源文件数/摘要）；`type_index()` 可据此按类型全限定名反查 Controller 签名 | Step 5 |
| `type_nesting.json` | 字段类型 → 外层类型的反向索引（`edges[fqn] = [[enclosingFqn, fieldName], ...]`），供契约类型按字段嵌套向上展开；`query_commit_impact.py` 直接读取 | Step 5b |
| `type_usage.json` | 类型 → 使用该类型作方法签名参数的方法（`types[fqn] = ["pkg.Class.method", ...]`），键与方法图节点 ID 同形，供契约类型反查 BLH/Service 参数并反向追 Controller；`query_commit_impact.py` 直接读取 | Step 5c |
| `impact_db.json` | 影响分析索引数据库（查询主入口）；Controller 方法节点带 `endpoints`（注解 URL） | Step 6 |
| `penetration_db.json` | **两部分穿透数据库（查询主数据源）** | Step 7 |
| `inbound_feign_penetration.graphml` | 第二部分可视化（Maven Controller → 本工作区 Feign） | Step 7 |
| `full_call_graph.graphml` | 可选：工作区 + Maven 合并全图，仅供全景布局参考；含保留服务的服务内部边，**不能用作穿透口径** | `export_full_graphml.py` |

## 构建后验证

```bash
# 1. 产物存在且非空
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; [print(p.name, p.stat().st_size) for p in OUTPUT_DIR.iterdir() if p.is_file()]"

# 2. 主数据源可加载（30s 内）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; d=json.load(open(OUTPUT_DIR/'impact_db.json')); print('edges:', len(d['ws_edges']), 'maven:', len(d['maven_edges']))"

# 3. 端点索引与源码一致（exit 0 = 一致）
python scan_controller_endpoints.py --check

# 3b. 类型嵌套索引（应输出 38768 38534 7782 23112）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; m=json.load(open(OUTPUT_DIR/'type_nesting.json'))['meta']; print(m['files'], m['classes'], m['types'], m['edges'])"

# 3c. 类型使用索引（应输出 16326 3224 12784 5）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; m=json.load(open(OUTPUT_DIR/'type_usage.json'))['meta']; print(m['methods'], m['types'], m['refs'], m['missingScopeMethods'])"

# 4. Maven 工件端点索引（应输出 1666 9255 9260）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; m=json.load(open(OUTPUT_DIR/'maven_controller_endpoints.json'))['meta']; print(m['controllers'], m['endpoints'], m['mappings'])"

# 5. 穿透链路的 Controller 根带 URL（应输出 353 342）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; s=json.load(open(OUTPUT_DIR/'penetration_db.json'))['stats']['inbound']; print(s['controller_rooted'], s['controller_rooted_with_url'])"

# 6. 查询冒烟（正式查询见 search skill）
python impact_analyzer.py insertMultiple --impact --select 1

# 7. 穿透两部分冒烟（应输出 workspace/inbound 节点/边与入站调用点）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; d=json.load(open(OUTPUT_DIR/'penetration_db.json')); print('workspace:', len(d['workspace']['nodes']), len(d['workspace']['edges'])); print('inbound:', d['stats']['inbound'])"

# 8. 相关性过滤生效（应输出 55 和 148676）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; s=json.load(open(OUTPUT_DIR/'maven_biz_scan_stats.json')); print(len(s['filter']['kept_services']), s['call_relations'])"
```

## 关键配置（`scripts/config.py`）

| 常量 | 作用 |
|---|---|
| `WORKSPACE_REPOS` | 12 个业务子仓库（相对 `src/backend`） |
| `SYSTEM_PACKAGES` | 43 个系统/框架包前缀，扫描时过滤 |
| `MAVEN_REPO_PATHS` | Maven 仓库解析顺序 |
| `OUTPUT_DIR` | 由插件 manifest 的 `projectDirectories[id=codegraph-index]` 解析（当前为 `docs/agents/imedicalxc-doctor-codegraph`），不要写死目录 |
| `SERVICE_MODULE_MAP` | 服务名 → 工程模块名（55 条），仅查询期使用 |
| `METHOD_DESCRIPTION_MAP` | 方法名 → 业务场景描述，仅查询期使用 |
| `FEIGN_INTERFACE_DESC` | Feign 接口 → 功能描述（219 条，来源腾讯文档《信创版微服务接口清单》），仅查询期使用 |

新增 Maven biz 服务时，同步补 `SERVICE_MODULE_MAP`；新增高频业务方法时补 `METHOD_DESCRIPTION_MAP`，否则影响分析报告只显示方法名。

## 当前规模（2026-11-09 修复 this/super 自调用后测量）

| 指标 | 数值 |
|---|---|
| 工作区节点 / 边（JSONL 原始签名） | 16,326 / 88,199 |
| `method_call_graph.graphml` 节点 / 边 | 53,357（16,100 声明 + 37,257 占位）/ 87,788（去重后） |
| impact_db 工作区节点 / 边 | 16,100（去重去参后）/ 88,199 |
| Maven biz jar / 类 / 方法（扫描原始调用） | 326 / 12,120 / 137,396（459,260） |
| Maven 相关性过滤后服务 / 边 | 55 个服务保留（33 个直接调用 Feign + 22 个上游）、44 个剔除 / 148,676 边 |
| 服务边界映射 | 184 |
| Feign 接口 / 方法 | 226 / 404（226 个由本工作区业务仓库发布） |
| 穿透第一部分（工作区业务仓库 + 外部叶子） | 53,357 节点（9,948 个外部叶子）/ 87,788 边 |
| 穿透第二部分（Maven 入站 Feign） | 396 个调用点（353 条 Controller 根 / 43 条方法根）/ 90 个 Feign 接口 / 33 个 Maven 服务 / 约 630 条分派桥边（以 `stats.dispatch_edges_used` 为准） |
| 穿透链路的 Controller 根带注解 URL | 342 / 353（其余 11 条映射声明在父类/接口，字节码不携带） |
| 合并全图节点 / 边 | 125,508 / 202,919 |
| `controller_endpoints.json` | 7.5 MB（1,681 源文件 / 1,680 Controller / 11,514 URL / 11,520 方法映射 + 1,680 类型作用域） |
| `type_nesting.json` | 2.7 MB（38,768 源文件 / 38,534 类 / 7,782 个被嵌套类型 / 23,112 条字段边） |
| `type_usage.json` | 1.4 MB（16,326 方法签名 / 3,224 个被使用类型 / 12,784 条引用 / 5 个无作用域方法 / 3,642 个未解析参数类型） |
| `maven_controller_endpoints.json` | 3.1 MB（326 jar / 1,666 Controller / 9,255 URL / 9,260 方法映射） |
| `impact_db.json` | 50.8 MB（含 Controller 方法注解 URL） |
| `penetration_db.json` | 41.6 MB |

保留的服务（55 个）：`admission`、`anappointment`、`ansurgeryschedule`、`api`、`appointment`、`arinv`、`audt`、`chpc`、`comar`、`comcons`、`comem`、`comemr`、`cons`、`cpw`、`dayappointment`、`daysurgeryschedule`、`daysurgerystation`、`emar`、`emcare`、`emdt`、`emnur`、`emph`、`emrdata`、`emrq`、`emsd`、`emtr`、`hisbsp`、`hispay`、`hissyscf`、`infoclct`、`insu`、`ipar`、`ipbmc`、`ipemr`、`ipnemr`、`ipnur`、`opar`、`opemr`、`opspcol`、`outappointment`、`outsurgeryschedule`、`ph`、`phm`、`plannedoperation`、`postopdiagnosis`、`preopdiagnosis`、`requ`、`rmis`、`server`、`stat`、`statistic`、`stro`、`surgeryschedule`、`trau`、`trbu`。

## 构建踩坑

1. **服务名取包路径第 4 段**：格式为 `com.mediway.his.SERVICE.xxx`，服务名是 `parts[3]` 而不是 `parts[2]`。
2. **字节码 invoke 指令解析**：`invokeinterface` 形如 `invokeinterface #129, 2`，正则需兼容逗号与操作数计数；普通调用 opcode 范围为 182-185，`invokedynamic`（186）单独处理（见第 11 条）。
3. **并发安全**：`scan_single_jar()` 必须是顶层函数，每个子进程创建独立的 `MavenBizScanner` 实例，父进程合并结果。
4. **impact_db 节点 ID 必须去参**：`ws_nodes` 的 key 含 `(params)RetType`，写入索引前需统一 `strip_params()`，否则与已去参的 `ws_edges` 无法匹配。
5. **biz jar 与 API jar 都要看**：biz jar 是实现（BLH/Service），API jar 是接口定义，只扫一类会缺半边视图。
6. **Step 2 耗时波动大**：本机实测约 30-60 秒；旧环境可能到 5-10 分钟。长时间无新日志不代表卡死，等进程退出再判断。
7. **相关性过滤按服务粒度，并保留上游闭包**：不要改成按方法可达性剪枝。BLH 通过反射按类名/方法名分发，静态图上没有入边的业务实现方法仍会在运行时被调用，按方法剪枝会静默丢失这些链路。seed 只认“该服务有方法直接调用医生站 Feign 接口”；`hiscore`、`nr` 等被调用方不计入 seed（否则会经公共基础包把整个 Maven 仓库连通回来），但反向可达 seed 的服务要作为上游保留，否则 Controller 入口会在服务边界被剪掉。
8. **GraphML 导出必须自洽**：节点 ID 直接写源码签名会含空格/泛型/注解，Gephi 导入时大量报 WARNING；边端点若未声明节点，Gephi 会自动补占位节点。`export_to_graphml()` 统一用 `_graph_id()` 截断到 `package.Class.method`，补齐占位节点（`synthetic=true`），并按 `(source,target)` 去重（Feign 边优先）。JSONL 与 impact_db 保持原始签名不变。
9. **穿透口径只有两部分**：`penetration_db.json` 的 `workspace` 只含 `WORKSPACE_SERVICES` 内部边 + 外部叶子；`inbound_feign` 只含以本工作区 Feign 接口为终点的链路。不要用“保留服务的全部 Controller 下游”当穿透结果——那会把与 Feign 无关的节点（如 `getFormwork`）带进来。
10. **远端操作边界**：本 skill 只读源码与本地 Maven 仓库，不触发编译、上传或数据库变更。
11. **lambda 不是普通调用边**：javac 把 lambda 体编译成 `lambda$<方法名>$N` 合成方法，通过 `invokedynamic` + `LambdaMetafactory` 调用，字节码里没有“所在方法 → lambda 方法”的 `invoke*` 边。Step 3 需要解析类的 `BootstrapMethods` 属性（引导方法第 2 个参数是实现方法的 `MethodHandle`），把桥写入 `maven_biz_dispatch.json`；否则反向追踪停在 lambda 节点，透传链被误判为 `root_type=method`。
12. **入口工件不只在 biz jar**：`-esb` / `-api` / `-mobile` 等工件都可能含 Controller；手机端还存在 `Contoller` 拼写。jar 选择与 `is_controller` 判断都要兼容，否则链路没有 Controller 根。
13. **method-rooted 不一定是漏扫**：`root_type=method` 的剩余链路通常是外部入口（apiout/ESB/HTTP 适配器）、BLH 按名反射调用、Spring 回调（如 `afterCompletion`）或公开服务方法。判断方法：在全部候选 jar 的常量池里按全限定名/方法名反查引用；无任何静态调用方即为动态或外部入口，记录在 `partial_paths` 即可。
14. **`this.` / `super.` 调用不要按关键字过滤**：接收者正则能匹配 `this.foo()` / `super.foo()`，而 `JAVA_KEYWORDS` 同时包含 `this`、`super`；若在进入 `_handle_receiver_call` 前统一跳过关键字，同类自调用（如 `opRegistAll → this.preOpRegist`）会整段丢边。当前只放行这两个接收者，其余关键字仍跳过。边存在不代表反向能覆盖：BLH 父子实现（`OpregBrokerAbstract` 与 `OpregistBrokerAbstract`）是不同的节点，查询侧要按实现族展开（见 search skill）。
15. **URL 只认注解不认方法名**：方法名与 URL 末段经常不同（`preOpRegist` 在类级 `/opreg/adm/opregBroker` 下），`scan_controller_endpoints.py` 必须同时解析类级 `@RequestMapping` 与方法级注解；`@RequestMapping` 的 `value/path` 之外的 `produces`/`consumes`/`name` 字符串不是 URL，不能当成端点。数组映射逐个产出端点，同一方法可对应多条 URL。
16. **端点索引是构建产物，不要在查询期重扫**：Step 5 的 `controller_endpoints.json` 带源码摘要；查询脚本默认直接读它，只有 `--refresh-endpoints` 或产物缺失时才扫描。把摘要校验放回每次查询会让单次查询退化到 30s+。
17. **Maven 工件的注解值要用常量池解引用**：`javatools` 的 `JavaAnnotation` 是 dict，值形如 `('s', idx)` 或 `('[', [...])`，字符串要经 `cpool.deref_const(idx)` 还原；`@RequestMapping` 的 `method` 是 `('e', (type_idx, const_idx))` 枚举。只解析 `value`/`path`，`@PostMapping` 等直接映射为对应动词。lambda 合成方法无注解，按 `lambda$<方法>$N` 回退到外层方法；父类/接口上声明的映射字节码不携带，这类链路保持无 URL，不要按方法名猜 URL。
18. **类型嵌套索引按类名集合解析，不按同名猜包**：`build_type_nesting.py` 先扫一遍所有 `class/interface/enum/record` 的全限定名，字段类型只在「显式 import → 同包 → 通配 import」里取命中集合的名字。第一版省掉集合校验，`List`、`String`、`LocalDate` 被猜成 `pkg.List` 等 1.5 万条假边。字段正则要跳过 `static`，否则常量表会把大量无关类串进来；只做字段组合，不展开 `extends`（继承由方法图的 `parent`/`ancestors` 负责）。
19. **参数里的类型要单独反查，不要指望调用边**：`new FeignPaPatMedicalInfoDTO().setId(..).setBirthTime(..)` 这类链式 builder 的接收者是 `new X()`，方法图接收者正则只认标识符，构造链一条边都不产生；DTO 也不是图节点。`FeignPaPatMedicalInfoDTO` 之所以能落到 `PaPatIhdDataSaveClientController#save`，靠的是它嵌在 `FeignPCAInfoDTO` 里、后者是 `SaveIhdPaPatDataAbstract#setPatientInfo` 的入参——`type_usage.json`（Step 5c）从方法签名参数取 seed 才能反向追到 Controller。seed 只取变更类型 + 1 级外壳：展开更多层会把整条患者域的共享 DTO 都拉进来，入口数翻倍且大多无页面。
