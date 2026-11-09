---
name: imedicalxc-doctor-codegraph-gen
description: |
  HIS 医生站代码调用图索引构建与增量更新。执行 6 步流水线：Feign 接口扫描 → 工作区方法级调用图 → Maven biz jar 扫描 → 合并 → 影响分析索引（impact_db.json）→ 两部分穿透数据库（penetration_db.json）。
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
  && python build_impact_db.py \
  && python build_penetration_db.py
```

| 步骤 | 脚本 | 耗时 | 输出 |
|---|---|---|---|
| Step 1 | `feign_scanner.py` | ~30s | `feign_interfaces.json` |
| Step 2 | `build_method_graph.py` | ~30-60s（2026-11-04 实测，旧环境可能 5-10min） | `method_call_graph.jsonl` + `.graphml` |
| Step 3 | `build_maven_biz_graph.py` | ~2s | `maven_biz_call_graph.jsonl`、`maven_biz_reverse_index.json`、`maven_biz_dispatch.json`、`maven_biz_scan_stats.json` |
| Step 4 | `merge_call_graphs.py` | ~2s | `merged_call_graph.jsonl`、`merged_reverse_index.json`、`merged_service_boundary.json` |
| Step 5 | `build_impact_db.py` | ~1-2s | `impact_db.json` |
| Step 6 | `build_penetration_db.py` | ~5-10s | `penetration_db.json`、`inbound_feign_penetration.graphml` |

Step 5 与 Step 6 都是查询 skill 的数据源，不要省略。`penetration_db.json` 是穿透口径的**唯一契约**，只包含两部分：

1. **工作区业务仓库内部调用关系**：`WORKSPACE_SERVICES`（comoe / ipcare / opcare / commr 等 13 个服务）方法之间的调用；调用 hiscore / hiscf 等外部仓库方法时，外部方法仅作为叶子节点保留，不继续展开。
2. **其他组 Maven jar → 本工作区 Feign**：从对方 Controller 出发，沿真实调用 + 接口/父类分派桥追溯到调用本工作区发布 Feign 接口的调用点；无 Controller 可达时退化为方法入口（`root_type=method`），并把上游片段写入 `partial_paths`。

`maven_penetration_graph.graphml` 已废弃（它按“保留服务内所有 Controller”扫全图，会把 `getFormwork` 这类与 Feign 无关的节点带进来）。

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

脚本不按文件粒度做增量；增量 = **只重跑受影响的流水线段**。Step 3/4/5/6 均为秒级到半分钟，无需节省。

| 变更源 | 需重跑 | 说明 |
|---|---|---|
| 工作区 Java 源码（业务逻辑） | Step 2 → Step 4 → Step 5 → Step 6 | Step 2 重建工作区图；Step 4 重建合并数据与服务边界；Step 6 重建两部分穿透 |
| 工作区 `@FeignClient` 接口定义 | Step 1 → Step 4 → Step 5 → Step 6 | Step 1 刷新接口/路径，Step 4 刷新 Controller 映射，Step 6 刷新入站链路 |
| Maven 本地仓库 biz jar（依赖升级、新增 jar） | Step 3 → Step 4 → Step 5 → Step 6 | 重新扫描字节码并合并；相关性过滤与分派桥自动重算 |
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
| `merged_call_graph.jsonl` | 合并后调用图 | Step 4 |
| `merged_reverse_index.json` | 合并后反向索引 | Step 4 |
| `merged_service_boundary.json` | Controller → Feign 映射 | Step 4 |
| `impact_db.json` | 影响分析索引数据库（查询主入口） | Step 5 |
| `penetration_db.json` | **两部分穿透数据库（查询主数据源）** | Step 6 |
| `inbound_feign_penetration.graphml` | 第二部分可视化（Maven Controller → 本工作区 Feign） | Step 6 |
| `full_call_graph.graphml` | 可选：工作区 + Maven 合并全图，仅供全景布局参考；含保留服务的服务内部边，**不能用作穿透口径** | `export_full_graphml.py` |

## 构建后验证

```bash
# 1. 产物存在且非空
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; [print(p.name, p.stat().st_size) for p in OUTPUT_DIR.iterdir() if p.is_file()]"

# 2. 主数据源可加载（30s 内）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; d=json.load(open(OUTPUT_DIR/'impact_db.json')); print('edges:', len(d['ws_edges']), 'maven:', len(d['maven_edges']))"

# 3. 查询冒烟（正式查询见 search skill）
python impact_analyzer.py insertMultiple --impact --select 1

# 4. 穿透两部分冒烟（应输出 workspace/inbound 节点/边与入站调用点）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; d=json.load(open(OUTPUT_DIR/'penetration_db.json')); print('workspace:', len(d['workspace']['nodes']), len(d['workspace']['edges'])); print('inbound:', d['stats']['inbound'])"

# 5. 相关性过滤生效（应输出 55 和 148676）
python -c "import sys,json; sys.path.insert(0,'.'); from config import OUTPUT_DIR; s=json.load(open(OUTPUT_DIR/'maven_biz_scan_stats.json')); print(len(s['filter']['kept_services']), s['call_relations'])"
```

## 关键配置（`scripts/config.py`）

| 常量 | 作用 |
|---|---|
| `WORKSPACE_REPOS` | 12 个业务子仓库（相对 `src/backend`） |
| `SYSTEM_PACKAGES` | 43 个系统/框架包前缀，扫描时过滤 |
| `MAVEN_REPO_PATHS` | Maven 仓库解析顺序 |
| `OUTPUT_DIR` | `PROJECT_ROOT.parent / docs / imedicalxc-doctor-codegraph`，基于 `Path(__file__)` 推导 |
| `SERVICE_MODULE_MAP` | 服务名 → 工程模块名（55 条），仅查询期使用 |
| `METHOD_DESCRIPTION_MAP` | 方法名 → 业务场景描述，仅查询期使用 |
| `FEIGN_INTERFACE_DESC` | Feign 接口 → 功能描述（219 条，来源腾讯文档《信创版微服务接口清单》），仅查询期使用 |

新增 Maven biz 服务时，同步补 `SERVICE_MODULE_MAP`；新增高频业务方法时补 `METHOD_DESCRIPTION_MAP`，否则影响分析报告只显示方法名。

## 当前规模（2026-11-04 相关性过滤后测量）

| 指标 | 数值 |
|---|---|
| 工作区节点 / 边（JSONL 原始签名） | 16,326 / 87,531 |
| `method_call_graph.graphml` 节点 / 边 | 53,354（16,100 声明 + 37,254 占位）/ 87,125（去重后） |
| impact_db 工作区节点 | 16,100（去重去参后） |
| Maven biz jar / 类 / 方法（扫描原始调用） | 326 / 12,120 / 137,396（459,260） |
| Maven 相关性过滤后服务 / 边 | 55 个服务保留（33 个直接调用 Feign + 22 个上游）、44 个剔除 / 148,676 边 |
| 服务边界映射 | 184 |
| Feign 接口 / 方法 | 226 / 404（226 个由本工作区业务仓库发布） |
| 穿透第一部分（工作区业务仓库 + 外部叶子） | 53,354 节点（9,947 个外部叶子）/ 87,125 边 |
| 穿透第二部分（Maven 入站 Feign） | 396 个调用点（353 条 Controller 根 / 43 条方法根）/ 90 个 Feign 接口 / 33 个 Maven 服务 / 约 630 条分派桥边（以 `stats.dispatch_edges_used` 为准） |
| 合并全图节点 / 边 | 125,415 / 202,251 |
| `impact_db.json` | 51.1 MB |
| `penetration_db.json` | 41.4 MB |

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
