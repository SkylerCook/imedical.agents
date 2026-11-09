---
name: imedicalxc-doctor-codegraph-search
description: |
  HIS 医生站代码调用图检索。基于已生成的 impact_db.json / penetration_db.json / 调用图 JSONL / 前端链路库，提供变更影响分析（6 段式）、方法调用者与被调用者查询、Feign 接口使用方查询、跨服务依赖追踪、提交级批量取证（周报联动）、前后端链路衔接（HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller）。
  Use when 查谁调用了某方法、某方法影响哪些下游、某 Controller 对应哪个 Feign 接口、某 Feign 被哪些工作区服务或 Maven 模块调用、需要按服务/模块汇总影响范围、给定一批 git 提交需要结构化的入口/调用方/下游 Feign 证据、或需要从某个 HTML 页面/按钮/URL 追到后端 Controller 的完整链路。
  索引未生成或已过期时，先用 imedicalxc-doctor-codegraph-gen 构建；前端链路库缺失时先用 imedicalxc-doctor-codegraph-front-gen 构建。
---

# 医生站调用图检索

## 职责边界

- 本 skill 只**消费**已生成的数据，不构建索引；唯一例外是 `query_front_back_chain.py` 会按需缓存 Controller 端点索引（见查询 8），它只是源码扫描缓存，不改变调用图口径。
- 后端索引缺失、`impact_db.json` 过期或源码有更新 → 先执行 `imedicalxc-doctor-codegraph-gen`。
- 前端链路库 `front_chain_db.json` 缺失或前端有更新 → 先执行 `imedicalxc-doctor-codegraph-front-gen`；本 skill 只消费，不重新扫描前端。
- 脚本目录：`.agents/plugins/imedicalxc-doctor-codegraph/scripts`；产物目录：`docs/agents/imedicalxc-doctor-codegraph/`（manifest `projectDirectories` 的 `codegraph-index` 声明）。
- 所有方法 ID 采用 `Class.method`；仅原始 JSONL 中含完整签名。

## 查询前检查

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts
python -c "import sys; sys.path.insert(0,'.'); from config import OUTPUT_DIR; print((OUTPUT_DIR/'impact_db.json').exists(), (OUTPUT_DIR/'penetration_db.json').exists(), (OUTPUT_DIR/'feign_interfaces.json').exists(), (OUTPUT_DIR/'merged_service_boundary.json').exists())"
```

数据源按查询类型区分：

| 查询 | 必需文件 |
|---|---|
| `impact_analyzer.py --impact` | `impact_db.json` + `penetration_db.json` + `feign_interfaces.json` + `merged_service_boundary.json` |
| `impact_analyzer.py`（基础模式） | `impact_db.json` + `penetration_db.json`（`--no-maven` 时只需要 `impact_db.json`） |
| `query_callers.py` | `method_call_graph.jsonl` |
| `query_feign_client.py` / `query_method_feign.py` | `method_call_graph.jsonl` |
| `query_who_calls_feign.py` | `penetration_db.json` |
| `query_commit_impact.py`（提交批量取证） | `impact_db.json` + `penetration_db.json` + `feign_interfaces.json`（另需目标仓库本地检出，用 `git show` 读提交版本源码） |
| `query_front_back_chain.py`（前后端衔接） | `docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json` + 工作区 19 个后端仓库（12 业务 + 7 基础设施）的 `*Controller.java`（端点索引自动缓存为 `docs/agents/imedicalxc-doctor-codegraph/front_back_endpoints.json`） |
| Gephi 可视化 | 对应 `.graphml` |

## 查询选型

| 问题 | 命令 |
|---|---|
| 改这个方法会影响哪些服务/模块？（推荐） | `impact_analyzer.py <方法> --impact` |
| 这个方法的下游调用链是什么？ | `impact_analyzer.py <方法>` |
| 谁调用了这个方法？ | `impact_analyzer.py <方法> --reverse` 或 `query_callers.py <方法>` |
| 这个方法调用了哪些 Feign？ | `query_method_feign.py <方法>` |
| 这个 Feign 接口被谁调用？ | `query_who_calls_feign.py <Client>`（工作区 + Maven 入站链路） |
| 这个 Feign Client 的调用面有多大？ | `query_feign_client.py <Client>` |
| 一批提交分别影响了哪些入口/调用方？（周报联动） | `query_commit_impact.py <raw-commits.json>` |
| 这个 HTML 页面/按钮最终落到哪个后端 Controller？ | `query_front_back_chain.py page <页面片段>` / `element <id或文案>` |
| 这个后端 Controller 方法被哪些页面/按钮触发？ | `query_front_back_chain.py controller <名>` / `method <Class.method>` |
| 某个前端请求 URL 的完整「页面 → 元素 → JS → Controller」链路？ | `query_front_back_chain.py url <片段> --detail` |
| 前后端链路覆盖率、命中最多的 Controller？ | `query_front_back_chain.py stats` |
| 需要图布局/人工探索 | Gephi 导入 `.graphml` |

`impact_analyzer.py` 直接读 `impact_db.json`（~51 MB，加载数秒），优先用它；`query_callers.py` / `query_method_feign.py` 是逐行扫描 36.5 MB JSONL 的轻量脚本；`query_who_calls_feign.py` 读 `penetration_db.json`（~41 MB）；`query_front_back_chain.py` 读 `front_chain_db.json`（~52 MB）+ 端点缓存（约 5.5 MB，命中约 2 秒）。

## 查询 1：变更影响分析（`--impact`，推荐）

```bash
# 模糊搜索方法名
python impact_analyzer.py insertMultiple --impact

# 指定 Class.method，选择第 N 个匹配
python impact_analyzer.py CtOeRecLocDriveComAbstract.getRecLocByLoc --impact --select 5

# 限定服务
python impact_analyzer.py getRecLocByLoc --impact --service comoe

# 加深追踪（默认深度 10；Controller 追踪默认 15）
python impact_analyzer.py saveOrGetPatient --impact --depth 15

# 导出 JSON
python impact_analyzer.py insertMultiple --impact --select 1 --json result.json
```

**6 段式报告**：

```
一、下游调用链              BFS 正向追踪可达的工作区方法，按服务分组
二、上游追踪 → Controller   反向 BFS 到 Controller 端点（含 BLH 继承 + 启发式匹配）
三、Controller → Feign 映射 Controller 的 Feign 接口 + 下游实际触达的 Feign 边界（含入口方法自身）
四、Maven biz 外部调用方    来自 penetration_db.json 的入站链路：对方 Controller → … → 调用点（含模块名）
五、工作区跨服务调用方      哪些工作区其他模块经 Feign 调用了该接口（含模块名）
六、影响范围汇总            下游方法数、Controller 数、Feign 数、外部调用数、涉及服务/模块
```

示例（节选）：

```
变更影响分析: InsertOeOrdItemAbstract.insertMultiple
  所属服务: comoe

一、下游调用链 (1815 个方法)
  BLH 覆写/并行实现 (31 个): IpCareInsertOeOrdItemAbstract.creat [ipcare], …
  [comoe] 1204 个方法:
    L1  InsertOeOrdItemAbstract.checkExamItem

二、上游追踪 → Controller 端点 (14 个)
  L??  [ipcare] [Feign] IpCareOeOrdItemEntryClientController.saveMultiple [启发式]

三、Controller → Feign 接口映射 (2 个)
  Feign: IpCareOeOrdItemEntryClient — 保存医嘱（功能描述来自 config.py）
    HTTP: POST .../ipcare/api/oeord/oeOrdItemEntry/saveMultiple

四、Maven biz 外部调用方 (13 个)
  [anappointment] (ipor-mediway-boot) 5 个调用:
    - AnAppointmentBLH.saveAppointmentForOrd — 为医嘱保存预约信息
      → IpCareOeOrdItemEntryClient

五、工作区跨服务调用方 (11 个)
  [aggcare] (aggcare-mediway-boot) 4 个调用

六、影响范围汇总
  下游方法: 1815 | Controller: 14 | Feign 接口: 2 | Maven 外部: 13 | 工作区跨服务: 11
```

**BLH 框架处理**：

- 正向 BFS 每遇到 `Abstract` 方法都会展开跨服务同名实现；类名相近（如 `InsertOeOrdItemAbstract` ↔ `IpCareInsertOeOrdItemAbstract`）的覆写计入下游并标注 `[BLH覆写]`，避免抽象方法本身无方法体导致漏算。
- 下游列表先输出一行 `BLH 覆写/并行实现 (N 个)`，列出被展开的方法及服务；这些方法是并行入口，深度为 `L0` 或与抽象方法同级。
- 反向追踪使用更宽的匹配（同名 + 双方均在 Abstract 类中，不要求类名相近），以兼容 `OpCareSaveOeOrdItemAbstract` 这类类名不同但承载入口的 BLH 类。
- BLH 通过反射调用，静态图可能无法连到 Controller；此时降级为按类名/方法名关键词做启发式匹配。
- 启发式结果标注 `[启发式]`，深度显示 `??`，需要在报告中明确其不确定性。

## 查询 2：影响范围分析（基础模式）

```bash
python impact_analyzer.py saveOrGetPatient
python impact_analyzer.py ImportDataAbstract.saveOrGetPatient --select 1
python impact_analyzer.py getPaPat --service opcare
python impact_analyzer.py saveOrGetPatient --reverse --select 1
python impact_analyzer.py saveOrGetPatient --select 1 --json result.json
python impact_analyzer.py saveOrGetPatient --select 1 --no-maven   # 跳过 Maven 入站链路
```

输出四段：工作区内部影响 → Feign 边界 → Maven 入站调用方 → 反向追踪（`--reverse` 时）。

第三节与 `--impact` 第四节同源，均来自 `penetration_db.json` 的入站链路，不再对保留服务的全部内部方法做正向 BFS。

## 查询 3：调用者查询

```bash
python query_callers.py QueryPaAdmClient.getAdmAge
python query_callers.py saveOrGetPatient
```

数据源 `method_call_graph.jsonl`。输出目标节点、调用者列表（类/服务/文件/调用类型/Feign 接口）、调用方服务分布。

## 查询 4：方法 → Feign 调用

```bash
python query_method_feign.py OpCareExamEntryClientAbstract.saveExamApply
```

按 Feign 接口分组，输出调用次数、目标服务、目标类、调用的方法名与详细调用列表。

## 查询 5：Feign 使用方查询

```bash
python query_who_calls_feign.py QueryPaAdmClient
python query_who_calls_feign.py IpCareOeOrdItemEntryClient
```

接口名支持短名或全限定名；短名在多个服务重复时（如 `QueryOeOrdItemClient`）会列出候选并退出，不静默返回 0。非 Feign 名称会直接报“未找到 Feign Client”。

数据源 `penetration_db.json`，输出两段：

- **工作区调用方**：`workspace` 部分中指向该 Feign 的调用边，按调用方类/服务分组。
- **Maven 外部调用方**：`inbound_feign` 部分中以该 Feign 为终点的链路，按服务分组，并尽量给出 `Controller → … → 调用点` 的入站路径；无 Controller 上游时标注“服务内部方法（无 Controller 上游）”。

需要单接口级别的 grep 时：

```bash
# 某方法调用了哪些 Feign
grep '"call_type": "feign"' docs/agents/imedicalxc-doctor-codegraph/method_call_graph.jsonl \
  | grep '<方法名>' \
  | python -c "import json,sys; [print(json.loads(l)['target']) for l in sys.stdin]"

# 谁调用了某 Feign
grep '"call_type": "feign"' docs/agents/imedicalxc-doctor-codegraph/method_call_graph.jsonl \
  | grep '<Feign接口名>' \
  | python -c "import json,sys; [print(json.loads(l)['source']) for l in sys.stdin]"
```

## 查询 6：Gephi 可视化

穿透只有两部分，对应两份图：

**图 1：工作区业务仓库内部调用** → `method_call_graph.graphml`

1. 导入 `method_call_graph.graphml`
2. 按 `type` 着色：method=蓝、feign=红、controller=绿、blh=橙、service=紫
3. 按 `service` 分组布局
4. 运行 ForceAtlas2

**图 2：Maven 调用方 → 本工作区 Feign** → `inbound_feign_penetration.graphml`

1. 导入后按 `type` 着色（controller=绿 / method=蓝 / feign=红）
2. 红色节点是本工作区发布的 Feign 接口（链路终点）
3. 边 `call_type`：`call`=字节码直调、`dispatch`=接口/父类分派桥或 lambda 合成方法桥、`feign`=Feign 边界

> `full_call_graph.graphml` 是工作区 + 保留服务的全景图，包含大量与 Feign 无关的服务内部边（例如 `getFormwork`），仅供布局参考，**不能作为穿透结论**。

## 查询 7：提交级批量取证（周报联动，`query_commit_impact.py`）

给 commit-report 的周报提供证据：输入 `raw-commits-<label>.json`，对每条提交定位改动的 Java 方法（按提交版本源码计算方法行区间，与 diff 变更行求交），再逐方法做入站/下游取证，最后按提交聚合。输出 JSON，**不做业务判断**。

```bash
# 在仓库根目录执行
python .agents/plugins/imedicalxc-doctor-codegraph/scripts/query_commit_impact.py \
  docs/agents/commit-reports/<label>/raw-commits-<label>.json --label <label>

# 可选参数
--max-methods-per-commit 10   # 单提交最多分析方法数，超出记入 truncatedMethods
--depth 10                    # 下游 BFS 深度
--no-maven                    # 跳过 Maven 入站调用方
--output <path>               # 默认与输入同目录 code-impact-<label>.json
```

输入要求：`raw-commits` 每条含 `repo`（相对仓库根）、`hash`、`files[].path`；目标仓库需在本地检出（脚本用 `git show <hash>:<path>` 读提交版本源码，`git show <hash>^:<path>` 读父版本）。

输出结构（提交级聚合，方法级明细并列）：

```json
{
  "meta": {"label": "...", "generatedAt": "...", "index": {"path": "...", "builtAt": "..."},
           "stats": {"commits": 3, "methodsAnalyzed": 5, "withGraphEvidence": 2, "skippedFiles": 4},
           "boundaries": ["..."]},
  "commits": [{
    "hash": "...", "shortHash": "...", "repo": "...", "author": "...", "date": "...", "subject": "...",
    "indexFresh": true, "source": "graph|fallback", "confidence": "graph|partial|none",
    "methods": [{"classMethod": "Class.method", "file": "...", "changedLines": 12,
                 "entrypoints": 1, "workspaceCallers": 4, "externalCallers": 11, "downstream": 3337}],
    "entrypoints": [{"kind": "controller", "controller": "...", "service": "ipcare",
                     "feign": "IpCareOeOrdItemEntryClient", "http": "POST ...", "heuristic": false,
                     "depth": 0, "via": ["Class.method"]}],
    "workspaceCallers": [{"service": "aggcare", "module": "aggcare-mediway-boot",
                          "caller": "Class.method", "sameService": false, "feign": "...", "via": ["..."]}],
    "externalCallers": [{"service": "ph", "module": "外部 Maven 依赖", "caller": "...",
                         "controller": "...", "rootType": "controller|method", "feign": "...",
                         "path": "...", "via": ["..."]}],
    "downstreamFeigns": [{"feign": "...", "method": "...", "caller": "...", "via": ["..."]}],
    "contract": {"feignInterfaces": ["..."], "typeFiles": ["...DTO.java", "...PO.java"],
                 "typeFeignMatches": [{"type": "FeignQueryOeOrdDTO", "file": ".../FeignQueryOeOrdDTO.java",
                                       "feign": "QueryOeOrdItemClient", "feignFull": "...",
                                       "service": "...", "servicePath": "...",
                                       "method": "getOrdItemList", "http": "POST getOrdItemList",
                                       "usage": ["parameter"]}]},
    "downstream": {"count": 3337, "aggregate": "workspace_reachable_methods",
                   "services": ["comoe", "..."]},
    "skippedFiles": [{"file": "...", "reason": "frontend|type_contract|public_layer|not_in_graph|no_method_change|resource|parse_failed|binary|repo_unavailable|commit_unavailable"}],
    "truncatedMethods": []
  }]
}
```

字段语义：

- `entrypoints` = 上游入口（入口方法自身是 Feign 接口时计入口；Controller 端点含 Feign 映射与 HTTP 路径）
- `workspaceCallers` = 工作区经 Feign 的回调方；`sameService` 区分同服务/跨服务
- `externalCallers` = Maven 外部调用方（`penetration_db` 入站链路，`rootType=method` 表示无 Controller 上游）
- `caller` 是调用方方法名证据；面向测试/交付的文案须由消费方翻译为业务场景（如 `PracticeOrderAbstract.insertPracticeOrder` → 「实习生开立医嘱」），不得直接粘贴方法名或契约名
- `downstreamFeigns` = 该方法**跨出**的 Feign 边界，不是入口契约，不要与 `contract.feignInterfaces` 混用
- `contract.typeFeignMatches` = 契约类型短名在 Feign 方法签名（`return_type` / `parameters`）中的使用明细；`usage` 区分 `return` / `parameter`。它只证明「该类型是哪个 Feign 接口的形状」，**不代表存在调用方**；要确认调用方仍须走 `query_who_calls_feign.py` / `externalCallers`。未命中不代表无使用：嵌套在 VO 字段里的类型不出现在签名中，同名类型也可能合并。
- `contract.feignInterfaces` = 方法级入口对应的 Feign 契约与类型签名命中的 Feign 接口合集
- `downstream.count` = 各改动方法可达工作区方法数的最大值（已按 `WORKSPACE_SERVICES` 过滤），仅作规模参考，不是并集、也不等于回归范围
- `confidence`：`graph` 有方法级证据；`partial` 仅契约文件（DTO/VO/PO）命中；`none` 无可入图方法
- `via` 将聚合项回溯到 `methods[]`，保证结论可追溯

> 不是所有改动都能入图：前端（hisfront）、DTO/VO/PO、public 基础设施不在图内；BLH 反射断链以同名覆写 + 启发式补链（`heuristic=true`）。消费方（周报）必须在结论中标注「无调用图证据」，不得把空结果解读为「无影响」。

**从证据落到前端页面**（消费方写【回归】/【联调】前执行）：

- **Controller 可搜前端**：把 `entrypoints[].http` 的路径或 `controller` 的方法名拿到 `src/frontend/hisfront/static/` 检索，命中后记录文件与行号（例：`cardReportOrCancelLoss` → `static/opreg/opreg-pat/scripts/doc.reportloss.js:9` 卡挂失/启用）。通用方法名（如 `getScheduleInfo`、`getDrugList`）会大量误命中，必须叠加服务目录或完整 HTTP 路径消歧。
- **Feign 不可直接搜前端**：Feign 接口名不出现在前端代码中。要落到页面，须先经 `workspaceCallers` / `externalCallers` 找到消费方 Controller，再用 Controller 证据检索；找不到消费方时只能写「无页面入口证据」，不得把 Feign 名当成页面。
- **纯契约提交**：`typeFeignMatches` 为空且无 Controller 证据时写「未发现活动调用方，代码审阅即可」；非空时只写命中的 Feign 方法及其业务场景，调用方是否存在须另查 `workspaceCallers` / `externalCallers`，页面入口仍须追到 Controller 后才可写。

## 查询 8：前后端链路衔接（`query_front_back_chain.py`）

把前端链路库（HTML 页面 → 操作元素 → JS 方法 → HTTP 请求）与工作区 19 个后端仓库（12 业务 + 7 基础设施）的 Controller 端点按 URL 对齐，输出完整链路：**HTML 页面 → 元素 → JS 调用路径 → 请求 → Controller 方法**。这是唯一跨前端/后端索引的查询。基础设施仓库必须纳入：`cfsv` / `ct` / `hiscf` 等公共配置接口是每个页面加载都会调用的，漏扫会把本地源码误标成「工作区外」。

```bash
# 覆盖率与规模（首次运行自动构建端点索引）
python query_front_back_chain.py stats

# 页面 → 元素 → JS → 请求 → Controller（页面视角）
python query_front_back_chain.py page doc.examapply

# 元素 id 或按钮文案（跨页面反查同一按钮）
python query_front_back_chain.py element bt_sendreq

# 请求 URL → 全部触发入口
python query_front_back_chain.py url saveExamApply --detail

# 后端 Controller → 哪些页面/按钮会打到它
python query_front_back_chain.py controller AntApplyController
python query_front_back_chain.py method AntApplyController.getPoisonControl

# 端点索引重建（新增/修改 Controller 后）
python query_front_back_chain.py stats --rebuild
```

输出形态（默认一行一条，`--detail` 展开调用栈）：

```
[inline] comoe/exam/html/doc.examapply.html
  元素: 发送 (bt_sendreq)  事件 click
    ├─ sendExaReq  (comoe/exam/scripts/doc.apply.exam.js:1525)
    └─ sendExaReqDetail  (comoe/exam/scripts/doc.apply.exam.js:1540)
  请求: POST ipcare/exam/examEntryController/saveExamApply  [serviceUrl.saveExamApply / $ipost]
  后端: com.mediway.his.ipcare.oeord.controller.repApply.IpcareExamEntryController.saveExamApply
        (POST ipcare/exam/examentrycontroller/saveexamapply, …IpcareExamEntryController.java:74)
```

**对齐规则**：前端 URL 与 `类级 @RequestMapping + 方法级 @PostMapping/@GetMapping/...` 拼出的路径比对，先精确匹配，再逐段剥离网关/服务前缀做后缀匹配（前端常带 `ipcare/`、`ma/` 等服务前缀，后端类级路径不含）。`path`/`value` 属性都识别，`produces`/`consumes` 等字符串属性不参与路径。同一路径对应多个 Controller 时全部列出。

**未命中不要从结果里消失**：`page` / `element` / `url` 输出该页面（元素 / URL）的**全部**链路，工作区没有对应 Controller 的条目落在行尾标注 `→ (工作区外: <URL 首段>)`，例如 `mrdia` / `his` / `phm`。只有 `stats` 的覆盖率按「命中工作区 Controller」统计。验证示例：`page doc.diagnos.entry` 返回 9 条，其中 6 条是配置按钮打 `mrdia/mrDiagnosEntry/*`，标注为工作区外。

**`stats` 口径（2026-11 实测，19 仓库）**：1,680 个 Controller / 11,457 个端点；6,253 页面 / 28,711 链路 / 12,212 请求；**7,431 条链路落到工作区 Controller**（页面加载 4,416 / js_binding 1,883 / inline 585 / config_bar 457 / js_string 59 / 护理执行单配置 31），涉及 1,963 个页面；URL 路径命中 1,938 / 7,093 = **27.3%**，覆盖 571 个 Controller / 1,933 个方法。只扫 12 个业务仓库时为 639 Controller / 3,051 端点、2,895 条链路、7.8%，可见基础设施仓库占前端调用面的大头。

**为什么只有 27.3%**：剩余前端 URL 首段集中在 `api` / `ar` / `msup` / `mrm` / `mchs` / `phkm` / `comcph` / `emnur` / `ipnur-station` / `cons` / `phpreadt` / `ipnur` / `cbph` / `emrq` / `phprev`，这些医疗/药事/护理/接口平台产品不在本地 19 个后端仓库里。这些链路在前端库里仍是完整的「页面 → 元素 → JS → 请求」，只是本工作区没有对应 Controller 源码。报告里必须写成「不属于本工作区后端仓库」，不能写成「链路缺失」。

**端点缓存**：`front_back_endpoints.json`（`codegraph-index` 目录）记录 `meta.source_digest / sources / repos / controllers / endpoints / mappings` 与 `endpoints[path] = [{http, controller, controller_fqn, method, file, line}]`。新鲜度按 19 个仓库 `*Controller.java` 的**内容摘要**判定（不看 mtime），摘要一致直接复用，不一致自动重建；整表约 5.5 MB，重建约 3.7 秒，命中缓存约 2 秒。内容确定性生成（路径与映射排序），可与源码版本一起比对。它是查询侧缓存，不是调用图口径，不影响 `impact_db.json` / `penetration_db.json`。

## 数据格式

> **数据边界**：`maven_*` 与 `impact_db.maven_edges` 已在生成阶段过滤，只包含与医生站 Feign 调用相关的服务（55 个：33 个直接调用者 + 22 个上游调用方）。`penetration_db.json` 再收敛为两部分：工作区业务仓库内部调用 + 以本工作区 Feign 为终点的入站链路。因此：
> - 某服务没有出现在 Maven 结果中，表示它没有静态直调医生站 Feign，不等于运行时不交互（HTTP、MQ、DB、反射均不在图内）。
> - 被保留服务的下游链会在服务边界处截断（例如 `ipnur → nr/hiscore` 的公共库调用不落库），不要据此推断“无下游”。
> - `penetration_db.json` 的 `workspace` 只保留业务仓库内部边，`hiscore` / `hiscf` 等方法只作为外部叶子出现。
> - BLH 通过反射分发，静态图上没有入边的方法仍可能被调用；缺少边时优先查源码或 `BLH` 覆写关系，不要直接判定未使用。

### `method_call_graph.jsonl`

节点字段：`id`（`package.Class.method(params)returnType`）、`label`（`Class.method`）、`class`、`method`、`package`、`service`、`is_feign`、`file_path`。

边字段：`source`、`target`、`call_type`（`internal` / `feign`）、`feign_interface`（仅 feign 边）。

### `maven_biz_call_graph.jsonl`

```json
{"type":"calls","source":"com.mediway.his.ipnur.xxx.Method.<unknown>","targets":["com.mediway.his.xxx.Other.method()V"],"source_service":"ipnur"}
```

### `merged_service_boundary.json`

`{Controller 全名: Feign 接口全名}`：

```json
{"com.mediway.his.aggcare.doctor.controller.external.AggcareAntInfoClientController":"com.mediway.his.aggcare.api.external.feign.AggcareAntInfoClient"}
```

### `impact_db.json`

```json
{
  "ws_edges": [{"s":"调用方ID","t":"被调方ID","ct":"internal|feign","fi":"Feign接口名"}],
  "ws_nodes": {"方法ID":{"label":"短名","service":"服务名","is_feign":true,"file_path":"路径"}},
  "maven_edges": [{"s":"调用方","t":"被调方","svc":"Maven服务名"}],
  "feign_interfaces": {"接口短名":{"full":"全限定名","methods":["方法列表"]}},
  "service_boundary": {"Controller全名":"Feign接口全名"}
}
```

`impact_db.json` 中方法 ID 已去参（`Class.method`），与原始 JSONL 的完整签名不同；查询时用方法名或 `Class.method` 即可。

### `penetration_db.json`（查询主数据源）

只有两部分，方法 ID 均为 `package.Class.method`：

```json
{
  "workspace": {
    "nodes": {"方法ID": {"label":"短名","class":"类全名","method":"方法","service":"comoe","external":false,"is_feign":false}},
    "edges": [{"s":"调用方","t":"被调方","ct":"internal|feign|external"}]
  },
  "inbound_feign": {
    "nodes": {"方法ID": {"service":"ipnur","is_feign":false,"is_controller":true}},
    "edges": [{"s":"调用方","t":"被调方","svc":"ipnur","ct":"call|dispatch|feign"}],
    "chains": [{"feign":"本工作区Feign方法","publisher":"ipcare","caller":"Maven调用点","service":"ipnur","root_type":"controller|method","controller":"Controller方法","paths":[["Controller","…","调用点"]],"partial_paths":[["最深上游","…","调用点"]]}],
    "stats": {"call_sites":396,"controller_rooted":353,"method_rooted":43,"method_rooted_with_upstream":43,"feign_interfaces":90,"services":["ipnur","…"],"dispatch_edges_used":638}
  },
  "stats": {"workspace_nodes":53354,"workspace_edges":87125,"workspace_external_nodes":9947,"inbound":{}}
}
```

- `workspace.external=true` 的节点是 `hiscore` / `hiscf` 等外部仓库叶子，只有入边、不展开。
- `inbound_feign.chains[].paths` 是 `Controller → … → 调用点` 的节点序列；`root_type=method` 表示静态图上没有 Controller 上游，此时 `partial_paths` 给出从最深可达祖先到调用点的上游片段（`[上游, …, 调用点]`，左被右调用）。剩余方法根通常是外部入口（apiout/ESB/HTTP 适配器）、BLH 按名反射、Spring 回调或公开服务方法，而不是链路上真的没有调用者。
- 链路中出现的 `lambda$xxx$N` 是 javac 生成的 lambda 合成方法，Step 3 通过 `BootstrapMethods` 建立了“所在方法 → lambda 方法”的桥，可继续向上追踪到 Controller。
- `impact_db.json` 的 `maven_edges` 与 `penetration_db.json` 不同：前者是 Step 4 合并产物，后者是查询穿透时唯一应引用的口径。

## 解读与报告要求

1. **第四/五节不是下游**：它们表示“谁通过 Feign 调用了该接口”。对 Feign 接口方法（如 `AggcareCtOeRecLocClient.getRecLocByLoc`），外部调用方为空是正常的——它是被调端点，不是调用方。
2. **入口为 Feign 接口时**：分析器会把入口自身加入 Feign 映射，第四/五节仍会输出；若为空，先确认 `is_feign` 标记或包路径含 `feign`。
3. **入口方法自己就在调 Feign**：下游链路触达的 Feign 边界会自动补进第三节映射，第四节会给出 Maven 入站链路（如 `switchAdmOrd → IpCareOeOrdItemEntryClient`），不需要 Controller 映射命中。
4. **穿透口径**：第四节 Maven 调用方只来自 `penetration_db.json` 的 `inbound_feign`，不会包含与 Feign 无关的 Maven 节点；不要用 `full_call_graph.graphml` 或 `maven_*` 服务内部边替代。
5. **模块名映射**：`[服务名] (模块名)` 来自 `config.py` 的 `SERVICE_MODULE_MAP`（55 条）。聚合服务（admission/appointment 等）归 `ipor-mediway-boot`，库模块（comemr/arinv）归 `*-mediway`；未知服务显示“外部 Maven 依赖”。
6. **业务描述**：`METHOD_DESCRIPTION_MAP` 与 `FEIGN_INTERFACE_DESC` 来自腾讯文档《信创版微服务接口清单》。未命中时不显示描述，需结合方法名、类名与 Feign 功能自行推断，并在结论中标注为推断。
7. **下游数量含 DTO/PO/VO 取值器**：下游列表会包含 `XxxDTO.getYyy` / `XxxPO.setYyy` 等真实调用，数量可能上千；评估业务影响时先按 Service/BLH/Feign 类筛选，不要用总数直接判断改造面。
8. **证据分层**：静态调用图是候选证据。给出结论前，对关键方法打开 `file_path` 指向的源码确认；源码不在工作区的 Maven 模块只能标注为“依赖包内行为”。
9. **启发式结果**：`[启发式]` 与 `??` 深度表示静态链断裂后的关键词匹配，报告中必须注明。
10. **数据新鲜度**：查询结果与代码不一致时，先按 gen skill 的新鲜度自检确认索引是否过期，不要用旧图下结论。
11. **入站 ≠ 下游**：`entrypoints` / `workspaceCallers` / `externalCallers` 表示「谁调用了它」，`downstreamFeigns` 表示「它又调了谁」。给入口方法做影响评估时，前者是调用方、后者是下游，不可互换。
12. **提交批量取证的方法定位按提交版本**：`query_commit_impact.py` 用 `git show <hash>:<path>` 解析方法边界，同一文件在后续提交被重构时（如方法拆分）行区间会不同，以证据里的 `changedLines` / `classMethod` 为准，不要拿当前工作区源码核对行号。
13. **前后端链路结论必须五段齐全**：HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → Controller。缺任一段要说明原因：`config_bar` 元素无 HTML id（来自配置表）、URL 属于工作区外产品（无后端源码，行尾标注 `(工作区外: <URL 首段>)`）、内联 `onclick` 无元素 id。只给「元素 → URL」或「URL → Controller」的结论都不是前端链路。

## 检索踩坑

1. **Feign 匹配不能只看最后一段**：target 格式为 `FeignClass.method`，`split('.')[-1]` 是方法名；需检查全部路径段与 `.feign.` 包路径。
2. **正向穿透而非反向追踪**：从 `method → Feign → 目标服务 Controller` 是正向；从 Feign 反查调用方会形成循环。
3. **BLH 覆写检测不要用 `Abstract` 过滤**：覆写方法恰好定义在各服务的 `XxxAbstract` 中，应按“同名方法出现在不同服务”判定。
4. **启发式 Controller 匹配要跨服务**：入口在 `comoe`，Controller 可能在 `opcare`/`ipcare`；搜索范围必须包含入口服务与 BLH 覆写所在服务。
5. **排除 DTO/VO 误命中**：关键词（如 `save`）会命中方法签名里的 `SaveMultipleOeOrdItemDTO`；匹配 Controller 时过滤 `DTO`/`VO`/`Model`/`Entity`。
6. **大文件加载**：`impact_db.json` 约 51 MB、`penetration_db.json` 约 41 MB，首次加载数秒属正常；`query_callers.py` / `query_method_feign.py` 每次全量扫描 JSONL，重复查询优先用 `impact_analyzer.py`。
7. **前后端衔接必须带页面路径**：`query_front_back_chain.py` 的每条链路都以 `[HTML 页面]` 开头；只给元素和 URL 的结论无法回到界面，验收时会被当作后端结论。用 `--detail` 展开调用栈。
8. **`config_bar` 元素在 HTML 里查不到 id 是正常的**：按钮来自 `doc_btnbar` 配置表（`config_injection_snapshot.json`），运行期由 `getBtnCfgData` 注入页面；核验应查配置快照里的 `code` / `handler` / `name`，不要到 HTML 里搜 id 后判定「链路错误」。`config_bar` 链路按 handler 的静态可达请求展开，多个按钮共用初始化函数（如 `GetPromptHtml`）时会出现相同 URL 列表，判断「这个按钮到底发哪个请求」需回源码或抓包确认。
9. **`page_load` 链路也是真实入口**：`stats` 里 1,305 条落到 Controller 的链路来自页面加载，不是按钮触发；评估「这个页面调了哪些接口」时不能只看 `inline` / `js_binding` / `config_bar`。
10. **27.3% 是跨仓库口径不是漏扫**：URL 首段为 `api` / `ar` / `msup` / `mrm` / `mchs` / `phkm` / `comcph` / `emnur` / `ipnur-station` 等的请求不在本地 19 个后端仓库内，前端链路仍然完整；报告须写「不属于本工作区后端仓库」，不能写「无链路」。
11. **端点索引与接口改动同步**：新增或改了 Controller 映射后，`front_back_endpoints.json` 会在下次查询时自动重建；若查询结果仍是旧路径，先 `--rebuild` 再判断是否真的不匹配。`produces` / `consumes` 里的字符串不是路径，不要把它们当端点核对。
