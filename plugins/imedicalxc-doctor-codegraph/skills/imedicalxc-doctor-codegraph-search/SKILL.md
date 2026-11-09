---
name: imedicalxc-doctor-codegraph-search
description: |
  HIS 医生站代码调用图检索。基于已生成的 impact_db.json / penetration_db.json / 调用图 JSONL / 前端链路库，提供变更影响分析（6 段式）、方法调用者与被调用者查询、Feign 接口使用方查询、跨服务依赖追踪、提交级批量取证（周报联动）、前后端链路衔接（HTML 页面 → 操作元素 → JS 方法 → HTTP 请求 → 后端 Controller），后端方法 → 受影响按钮（含经 Feign 间接入口），以及提交级入口 → 界面 → 菜单访问位置联动（结合前端界面入口登记）。
  Use when 查谁调用了某方法、某方法影响哪些下游、某 Controller 对应哪个 Feign 接口、某 Feign 被哪些工作区服务或 Maven 模块调用、需要按服务/模块汇总影响范围、给定一批 git 提交需要结构化的入口/调用方/下游 Feign 证据、需要从某个 HTML 页面/按钮/URL 追到后端 Controller 的完整链路、需要从改动的方法反查受影响的按钮、或需要把提交入口批量落到界面与菜单访问位置。
  索引未生成或已过期时，先用 imedicalxc-doctor-codegraph-gen 构建；前端链路库缺失时先用 imedicalxc-doctor-codegraph-front-gen 构建。
---

# 医生站调用图检索

## 职责边界

- 本 skill 只**消费**已生成的数据，不构建索引；唯一例外是 `query_front_back_chain.py` 在产物缺失或显式 `--refresh-endpoints` 时会重建 Controller 注解索引（见查询 8），并可按周报请求输出 `front-chains-<label>.json`（见查询 8.1），两者都不改变调用图口径。
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
| `query_front_back_chain.py`（前后端衔接） | `docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json` + `docs/agents/imedicalxc-doctor-codegraph/controller_endpoints.json`（gen 的 Step 5 产物；缺失时自动重建）+ `maven_controller_endpoints.json`（Step 3 产物，工作区外 Controller 的注解 URL，可选） |
| `query_front_back_chain.py impact`（后端方法 → 按钮） | 同上，另加 `impact_analyzer.py --impact --json` 导出文件 |
| `query_front_back_chain.py commit-impact`（提交 → 界面） | 同上，另加周报的 `code-impact-<label>.json` 与 `docs/knowledge/前端界面入口登记/界面入口登记表.md`（菜单与访问位置） |
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
| 一批提交分别影响哪些界面/按钮、从哪个菜单进入？（周报联动） | `query_front_back_chain.py commit-impact <code-impact.json> --label <label>` |
| 这个 HTML 页面/按钮最终落到哪个后端 Controller？ | `query_front_back_chain.py page <页面片段>` / `element <id或文案>` |
| 这个后端 Controller 方法被哪些页面/按钮触发？ | `query_front_back_chain.py controller <名>` / `method <Class.method>` |
| 改了这个后端方法，哪些按钮/页面受影响？（含间接入口，推荐） | `impact_analyzer.py <方法> --impact --json out.json` → `query_front_back_chain.py impact out.json` |
| 某个前端请求 URL 的完整「页面 → 元素 → JS → Controller」链路？ | `query_front_back_chain.py url <片段> --detail` |
| 前后端链路覆盖率、命中最多的 Controller？ | `query_front_back_chain.py stats` |
| 需要图布局/人工探索 | Gephi 导入 `.graphml` |

`impact_analyzer.py` 直接读 `impact_db.json`（~51 MB，加载数秒），优先用它；`query_callers.py` / `query_method_feign.py` 是逐行扫描 36.5 MB JSONL 的轻量脚本；`query_who_calls_feign.py` 读 `penetration_db.json`（~41 MB）；`query_front_back_chain.py` 读 `front_chain_db.json`（~60 MB）+ `controller_endpoints.json`（5.8 MB）+ `maven_controller_endpoints.json`（3.1 MB，按需加载），单次查询约 1 秒。

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

- 实现族按类继承展开：节点带 `parent` / `ancestors`（完整 `extends` 链，跨过无方法的中间类），沿链取**同名覆写子类**（如 `ExamQueryAbstract.getExaReqPrintData` → `Ipcare/OpcareExamQueryAbstract`）。
- 正向 BFS 每遇到带后代的 `Abstract` 方法都会把同名覆写子类一并展开并标注 `[BLH覆写]`，避免抽象方法本身无方法体导致漏算。
- 下游列表先输出一行 `BLH 覆写/并行实现 (N 个)`，列出被展开的方法及服务；这些方法是并行入口，深度为 `L0` 或与抽象方法同级。
- 反向追踪兜底只认「同服务 + 同名方法 + 图上已有直连边」（如 `OpregBrokerAbstract` / `OpregistBrokerAbstract` 这类无继承关系的父子）。不要按「全工程同名 Abstract」合并：BLH 里同名方法极多（`getData` / `save*` / `getInfo`），会把无关业务并进同一族，实测会让一次应急初始化变更挂出 13 个 tr-pilot 页面。
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

**从证据落到前端页面**（消费方写【必测】/【回归】/【联调】前执行）：

- **优先走确定性联动**：把 `code-impact-<label>.json` 直接交给查询 8.1 的 `commit-impact`，一次产出每个提交的 `uiEntries[]`（页面 / 元素 / 请求 / Controller / 菜单访问位置）与 `unmatchedEntrypoints[]`。周报不要逐条手工 grep；只有脚本缺失或需要核对单条链路时才用下面的手工方式。
- **手工兜底**：`entrypoints[].http` 或 `controller` 方法名可拿到 `src/frontend/hisfront/static/` 检索，命中后记录文件与行号（例：`cardReportOrCancelLoss` → `static/opreg/opreg-pat/scripts/doc.reportloss.js:9` 卡挂失/启用）。通用方法名（如 `getScheduleInfo`、`getDrugList`）会大量误命中，必须叠加服务目录或完整 HTTP 路径消歧。
- **Feign 不可直接搜前端**：Feign 接口名不出现在前端代码中。要落到页面，须先经 `workspaceCallers` / `externalCallers` 找到消费方 Controller，再用 Controller 证据检索；找不到消费方时只能写「无页面入口证据」，不得把 Feign 名当成页面。
- **纯契约提交**：`typeFeignMatches` 为空且无 Controller 证据时写「未发现活动调用方，代码审阅即可」；非空时只写命中的 Feign 方法及其业务场景，调用方是否存在须另查 `workspaceCallers` / `externalCallers`，页面入口仍须追到 Controller 后才可写。

## 查询 8：前后端链路衔接（`query_front_back_chain.py`）

把前端链路库（HTML 页面 → 操作元素 → JS 方法 → HTTP 请求）与工作区 19 个后端仓库（12 业务 + 7 基础设施）的 Controller 端点按 URL 对齐，输出完整链路：**HTML 页面 → 元素 → JS 调用路径 → 请求 → Controller 方法**。这是唯一跨前端/后端索引的查询。基础设施仓库必须纳入：`cfsv` / `ct` / `hiscf` 等公共配置接口是每个页面加载都会调用的，漏扫会把本地源码误标成「工作区外」。

```bash
# 覆盖率与规模（读 gen 的 Step 5 端点产物）
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

# 端点索引重建（新增/修改 Controller 后；正常应走 gen 的 Step 5 → Step 6）
python query_front_back_chain.py stats --refresh-endpoints
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

**未命中不要从结果里消失**：`page` / `element` / `url` 输出该页面（元素 / URL）的**全部**链路，工作区没有对应 Controller 的条目落在行尾标注 `→ (工作区外: <URL 首段>)`，例如 `his` / `phm` / `api`。只有 `stats` 的覆盖率按「命中工作区 Controller」统计。验证示例：`page doc.diagnos.entry` 返回 9 条，其中 6 条配置按钮的 `mrdia/mrDiagnosEntry/*` 经控制器段匹配落到 `opcare-mrdia` 的 `MRDiagnosEntryController`（`mrdia` 模块本身在 `ipcare`/`opcare` 仓库内）；同页 `his/api/...` 与 `phm/sys/...` 两条标注为工作区外。

**注解兜底（URL 名 ≠ 方法名）**：`url` / `method` 在前端链路库查不到时，从 `controller_endpoints.json`（工作区）与 `maven_controller_endpoints.json`（Maven 工件）输出注解声明的端点并标注「无前端链路」/「Maven jar」。例：`url regPreAccount` 命中工作区 ESB 端点；`method PatchecklevController.saveGroupHurtData` 命中 Maven 工件端点 `emtr/trim/trbu/patchecklev/savegrouphurtdata`。这类端点多是对外 ESB / 内部接口，前端没有页面，不能据此写成「链路缺失」。

**`stats` 口径（2026-11-09 复跑，19 仓库）**：1,680 个 Controller / 11,457 条 URL；6,243 页面 / 30,120 链路 / 12,474 请求；**9,371 条链路落到工作区 Controller**（页面加载 4,343 / js_binding 2,250 / config_bar 1,218 / js_toolbar 863 / inline 603 / js_string 63 / 护理执行单配置 31），涉及 2,073 个页面；URL 路径命中 2,384 / 7,442 = **32.0%**，覆盖 699 个 Controller / 2,496 个方法。只扫 12 个业务仓库时为 639 Controller / 3,051 端点、2,895 条链路、7.8%，可见基础设施仓库占前端调用面的大头。

**为什么只有 32.0%**：剩余前端 URL 首段集中在 `api` / `ar` / `msup` / `mrm` / `mchs` / `phkm` / `comcph` / `emnur` / `ipnur-station` / `cons` / `phpreadt` / `ipnur` / `cbph` / `emrq` / `phprev`，这些医疗/药事/护理/接口平台产品不在本地 19 个后端仓库里。这些链路在前端库里仍是完整的「页面 → 元素 → JS → 请求」，只是本工作区没有对应 Controller 源码。报告里必须写成「不属于本工作区后端仓库」，不能写成「链路缺失」。

**端点索引（构建产物）**：`controller_endpoints.json`（`codegraph-index` 目录，gen 的 Step 5）记录 `meta.source_digest / sources / repos / controllers / endpoints / mappings` 与 `endpoints[path] = [{http, controller, controller_fqn, method, class_path, method_path, file, line}]`。查询脚本默认直接读它（约 1 秒/次）；只有产物缺失或 `--refresh-endpoints` 时才重扫 19 个仓库的 `*Controller.java`（约 2 秒）并按内容摘要写回。它是构建产物、不是调用图口径，不影响 `impact_db.json` / `penetration_db.json`。

**Maven 工件端点索引**：`maven_controller_endpoints.json`（gen 的 Step 3）同结构，`meta.origin = "maven_biz"`，覆盖 326 个 jar 的 1,666 个 Controller / 9,255 条 URL，没有 `file/line`（来源是字节码）。它同时被 `penetration_db.json` 使用：`root_type=controller` 的链路带 `endpoints`（353 条中 342 条有 URL，其余映射声明在父类/接口，字节码不携带）。

### 查询 8.2：后端方法 → 受影响按钮（`impact`，含间接入口）

改动后端方法后，正确方向是从方法出发：先由影响分析拿到上游 Controller（已按 BLH 实现族展开反向追踪），再由注解 URL 和 Feign 入站链路落到按钮。

```bash
# 1) 影响分析 + 导出（上游 Controller 带注解 URL）
python impact_analyzer.py OpregBrokerAbstract.preOpRegist --impact --json /tmp/impact.json

# 2) 落到按钮
python query_front_back_chain.py impact /tmp/impact.json
```

`impact` 命令同时做三类匹配：

1. **工作区 Controller**：用 `upstream_controllers[].endpoints` 的注解 URL 与前端请求精确比对。
2. **工作区外 Maven 入站 Controller**（如 `trbu.PatchecklevController`）：只认 Feign 目标落在上游 Controller 上的链路（`<X>Client` ↔ `<X>ClientController`）；优先用 `maven_controller_endpoints.json` 里该方法的注解 URL 精确比对，注解缺失时才退回 `类名去 Controller + 方法名` 匹配 URL 末两段。`--detail` 中分别标注「Maven jar 注解」与「启发式匹配」。
3. **`--reverse` 的 BLH 实现族**：入口在 `OpregBrokerAbstract.preOpRegist` 时，反向会同时展开 `OpregistBrokerAbstract.preOpRegist`，因此 `opRegistAll → this.preOpRegist` 这条同业务另一入口也会被找到。族成员在报告「四、反向追踪」中单列；`--json` 输出在 `blh_family`。

验证场景（改「预挂号」）：直接 5 个页面（`doc.opregistmain` / `doc.allocopregist` / `doc.rapidregist` / `iphis.doc.rapidregist` / `doc.pilotpro.rapidregist`）+ `dhcem.patchecklev.hisui`（确认/保存/分诊，经 `PatchecklevController.savePatcheckData → OpregistBrokerClient.opRegistAll` 间接进入）。全流程约 2 秒（影响分析 0.6s + 按钮反查 1.0s）。

### 查询 8.1：提交级入口 → 界面 → 菜单访问位置（`commit-impact`）

周报联动专用：消费查询 7 的 `code-impact-<label>.json`，把每个提交的 `entrypoints[]` 反查成前端链路，再叠加《前端界面入口登记表》的菜单信息，输出 `front-chains-<label>.json`。只给证据，不写测试结论。

```bash
python query_front_back_chain.py commit-impact \
  docs/agents/commit-reports/<label>/code-impact-<label>.json --label <label>
```

可选：`--output <path>`（默认与 code-impact 同目录）、`--max-ui-entries 40`（单提交上限；截断按「来源 → 页面 → 元素」选条目，不受菜单置信度影响，保证补登记不会换掉页面集合）、`--ancestor-depth 2`（沿 `page_links` 上溯层数）、`--registry <md>`（默认 `docs/knowledge/前端界面入口登记/界面入口登记表.md`）。

输出结构：

```json
{
  "meta": {"label": "...", "stats": {"commits": 123, "commitsWithUi": 37, "entrypoints": 1230,
           "matchedEntrypoints": 494, "pages": 106, "pagesWithMenu": 16, "pagesViaCsp": 13,
           "pagesWithParentMenu": 20, "pagesNoMenu": 70,
           "unmatchedEntrypoints": 736, "unmatchedUnique": 321,
           "unmatchedReasons": {"client-controller": 224, "cross-service-same-name": 12,
                                "feign-interface-mapping": 2, "no-front-call": 498}}},
  "commits": [{
    "hash": "...", "shortHash": "...", "subject": "...", "entrypoints": 8,
    "uiEntries": [{
      "page": "comoe/exam/html/doc.examapply.html", "pageTitle": "检查申请单集成界面", "module": "comoe",
      "source": "inline",
      "element": {"id": "bt_sendreq", "label": "发送", "event": "click"},
      "request": {"method": "POST", "paths": ["ipcare/exam/examEntryController/saveExamApply"]},
      "backend": {"controller": "com.mediway.his.ipcare...IpcareExamEntryController",
                  "method": "saveExamApply", "http": "POST",
                  "path": "ipcare/exam/examentrycontroller/saveexamapply", "file": "...", "line": 74},
      "entrypoint": {"controller": "IpcareExamEntryController.saveExamApply", "service": "ipcare",
                     "http": "POST ...", "httpResolved": false,
                     "kind": "controller", "heuristic": false},
      "access": {"confidence": "menu|parent|none", "via": "html|csp|",
                 "menus": [{"name": "...", "parentPath": "...", "mode": "安全组菜单|标准配置菜单|系统标准配置", "groups": "...", "csp": "仅 via=csp 时存在"}],
                 "csp": ["仅 confidence=menu 且 via=csp 时存在"],
                 "parents": [{"page": "...", "type": "弹出|跳转|内嵌|包含", "linkSource": "element|page_load",
                              "element": "...", "elementLabel": "...", "elementEvent": "...",
                              "elementSource": "inline|js_binding|config_bar|...",
                              "opener": "...", "via": "html|csp", "csp": ["..."], "menus": ["..."]}]},
      "jsPath": [{"name": "sendExaReq", "file": "...", "line": 1525}],
      "match": "controller|http"
    }],
    "unmatchedEntrypoints": [{"controller": "...", "http": "...", "httpResolved": false,
                              "kind": "controller|feign",
                              "reason": "client-controller|cross-service-same-name|feign-interface-mapping|no-front-call"}]
  }]
}
```

`access.confidence` 的消费口径：

| 取值 | 含义 | 周报怎么写 |
|---|---|---|
| `menu` | 页面本身在登记表中（`via="html"`），或其 `.csp` 菜单入口按 stem 唯一归并到该页面（`via="csp"`，`menus[].csp` 指回登记的 `.csp` 行） | 用 `父菜单路径 / 界面名称` 作为访问位置；`via="csp"` 时可注明「菜单入口为旧 `.csp` 名称」 |
| `parent` | 页面未登记，但沿 `page_links` 上溯到的父页面已登记（父页面同样支持 `.csp` 归并，`parents[].via` 区分来源） | 用父页面菜单 + `element` + `linkSource` 还原打开路径；`page_load` 表示打开父页面即自动弹出 |
| `none` | 页面与父页面都没有菜单登记（多为工作区内嵌 / 弹窗页） | 写「无菜单登记（内嵌/弹窗页）」，只写页面标题 + 元素，不得编造菜单路径 |

`.csp` 归并规则：页面 stem（去 `.html`/`.hui`/非字母数字）≥ 10 且唯一命中登记表中的 `.csp` stem（≥ 6，精确优先、双向后缀兜底）；命中多个不同 `.csp` 视为歧义，保持 `none`。归并只影响访问位置，不增加 `matchedEntrypoints`。

边界：

- 只覆盖落到工作区 Controller 的链路。`unmatchedEntrypoints[].reason` 按优先级互斥归类：`client-controller`（`*ClientController` 服务间门面）→ `feign-interface-mapping`（`http` 为空，映射声明在 Feign 接口）→ `cross-service-same-name`（前端有末两段候选但有效服务不同）→ `no-front-call`（其余）。这些条目都没有页面入口证据，不得据此推断界面。
- `cross-service-same-name` 只用于解释未命中，不产生链路。禁止把 `_norm_controller_seg` 直接加进 URL 匹配，否则会把 ipcare 入口挂到 opcare 页面。
- `feign-interface-mapping` 的 `http` 必须保持为空；不要为了让它有 URL 去扫 Feign 接口注解，那会把接口当 Controller。
- `page_load` 条目是页面加载自动请求，能证明「打开该页面会触发」，不等于用户点击；写操作步骤时优先用 `inline` / `js_binding` / `config_bar` 条目。
- 同一相对 URL 在 opcare / ipcare 都有实现时会保留多条 `backend`，需按页面所属服务或业务场景取舍，不能当成两个不同界面。
- `code-impact` 的入口可能只有「控制器 + 方法」没有 `http`（映射声明在父类 / 接口或注解未被调用图采集）。此时按端点索引的 `控制器短名 + 方法` 补全 URL 再匹配，命中的条目 `entrypoint.httpResolved=true`；仍无命中则照常列入 `unmatchedEntrypoints`。
- 实测（2026-11-W1，123 个提交）：1,230 个入口命中前端 494 个，得到 106 个页面；菜单登记 16 个（其中 `.csp` 归并 13 个）、父页面可达 20 个、70 个无菜单登记。736 个未命中入口按原因分为 ClientController 224 / 跨服务同名 12 / Feign 接口映射 2 / 页面未调用 498。登记表只覆盖 152 个 HTML 页面，多数业务子页面通过弹窗 / 内嵌承载，属于预期口径，不是脚本漏匹配。

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
    "stats": {"call_sites":396,"controller_rooted":353,"method_rooted":43,"method_rooted_with_upstream":43,"feign_interfaces":90,"services":["ipnur","…"],"dispatch_edges_used":634}
  },
  "stats": {"workspace_nodes":53357,"workspace_edges":87788,"workspace_external_nodes":9948,"inbound":{}}
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
14. **提交级界面证据以 `front-chains` 为准**：`uiEntries[].access.confidence=none` 不得升级成菜单路径；`page_load` 条目只在证明页面加载行为时使用，写点击步骤优先用元素触发条目；`unmatchedEntrypoints` 必须原样反映「无页面入口证据」，不能因为同一提交的其他入口有界面就省略。

## 检索踩坑

1. **Feign 匹配不能只看最后一段**：target 格式为 `FeignClass.method`，`split('.')[-1]` 是方法名；需检查全部路径段与 `.feign.` 包路径。
2. **正向穿透而非反向追踪**：从 `method → Feign → 目标服务 Controller` 是正向；从 Feign 反查调用方会形成循环。
3. **BLH 覆写检测不要用「同名 Abstract」一刀切**：覆写方法定义在各服务的 `XxxAbstract` 中，但同名方法（`getData` / `getInfo` / `save*`）遍布全工程；按 `extends` 链取同名覆写子类，兜底只认同服务且图上有直连边，否则会引入大量假入口。
4. **启发式 Controller 匹配要跨服务**：入口在 `comoe`，Controller 可能在 `opcare`/`ipcare`；搜索范围必须包含入口服务与 BLH 覆写所在服务。
5. **排除 DTO/VO 误命中**：关键词（如 `save`）会命中方法签名里的 `SaveMultipleOeOrdItemDTO`；匹配 Controller 时过滤 `DTO`/`VO`/`Model`/`Entity`。
6. **大文件加载**：`impact_db.json` 约 51 MB、`penetration_db.json` 约 41 MB，首次加载数秒属正常；`query_callers.py` / `query_method_feign.py` 每次全量扫描 JSONL，重复查询优先用 `impact_analyzer.py`。
7. **前后端衔接必须带页面路径**：`query_front_back_chain.py` 的每条链路都以 `[HTML 页面]` 开头；只给元素和 URL 的结论无法回到界面，验收时会被当作后端结论。用 `--detail` 展开调用栈。
8. **`config_bar` 元素在 HTML 里查不到 id 是正常的**：按钮来自 `doc_btnbar` 配置表（`config_injection_snapshot.json`），运行期由 `getBtnCfgData` 注入页面；核验应查配置快照里的 `code` / `handler` / `name`，不要到 HTML 里搜 id 后判定「链路错误」。`config_bar` 链路按 handler 的静态可达请求展开，多个按钮共用初始化函数（如 `GetPromptHtml`）时会出现相同 URL 列表，判断「这个按钮到底发哪个请求」需回源码或抓包确认。
9. **`page_load` 链路也是真实入口**：`stats` 里 4,343 条落到 Controller 的链路来自页面加载，不是按钮触发；评估「这个页面调了哪些接口」时不能只看 `inline` / `js_binding` / `config_bar`。
10. **32.0% 是跨仓库口径不是漏扫**：URL 首段为 `api` / `ar` / `msup` / `mrm` / `mchs` / `phkm` / `comcph` / `emnur` / `ipnur-station` 等的请求不在本地 19 个后端仓库内，前端链路仍然完整；报告须写「不属于本工作区后端仓库」，不能写「无链路」。
11. **端点索引与接口改动同步**：新增或改了 Controller 映射后，先跑 gen 的 Step 5 → Step 6；临时排查可用 `--refresh-endpoints` 让查询脚本重扫，不要长期依赖查询期重建。`produces` / `consumes` 里的字符串不是路径，不要把它们当端点核对。
12. **`this.` 自调用边存在，缺的是反向的实现族展开**：`method_call_graph.jsonl` 里 `OpregistBrokerAbstract.opRegistAll → this.preOpRegist` 是真实边（同类边 3,970 条），手工 grep 能看到；但 BLH 父子实现（`OpregBrokerAbstract` / `OpregistBrokerAbstract`）在图上是两个节点，只反查其中一个会漏掉另一条入口链路。`--reverse` 现在自动展开实现族，结论里要说明「已计入同业务另一实现」。
13. **工作区外 Controller 的按钮走 Feign 入站链路**：`trbu` / `emtr` 等产品不在本地源码内，URL 来自 gen 的 Step 3 产物 `maven_controller_endpoints.json`；`impact` 先按 `<X>Client ↔ <X>ClientController` 锁定上游 Feign，再用该方法的注解 URL 精确匹配。只有注解缺失（映射声明在父类/接口）时才退回「类名去 Controller + 方法名」匹配末两段，此时必须在报告中标注「启发式」，不能和注解精确命中混为一谈。
