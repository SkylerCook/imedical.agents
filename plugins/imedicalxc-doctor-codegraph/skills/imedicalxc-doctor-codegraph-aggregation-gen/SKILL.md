---
name: imedicalxc-doctor-codegraph-aggregation-gen
description: |
  HIS 服务总线（db_hsb.sm_hsb）生产者/消费者绑定索引构建与查询。用 kingbase-87-aggregation MCP 导出接入系统、注册服务、发布服务、消息订阅与路由证据，推断并归一化为「HIS ↔ 外部系统」的绑定关系，并把 HIS 发布的绑定挂接到代码调用图的 Controller 方法上（改动 Controller 可反查受影响厂家接口），输出 aggregation_db.json / aggregation_raw.json / aggregation_stats.json。
  Use when 需要回答某个外部系统与 HIS 之间是谁生产、谁消费、走 REST 还是消息、绑定证据是什么；首次生成或服务总线登记变化（新增服务、发布/注册端点、消费组、消息路由）后重建索引；aggregation_db.json 缺失或过期。
  只读总线库，不写库、不改配置；纯查询用 query_aggregation.py。
---

# 服务总线绑定索引：构建与查询

## 职责边界

- 本 skill 负责**从服务总线登记数据生成绑定索引**（离线导出 + 归一化），并提供查询脚本。
- 数据源只有服务总线库 `db_hsb.sm_hsb`，不读 HIS 业务库、不读源码。
- 只读：不执行 INSERT/UPDATE/DELETE/DDL，不改总线配置，不触发上传或部署。
- 脚本目录：从项目根进入 `.agents/plugins/imedicalxc-doctor-codegraph/scripts/agg`。
- 输出目录由插件 manifest 的 `projectDirectories[id=aggregation-index]` 声明（当前 `docs/agents/imedicalxc-doctor-aggregation/`），`config.py` 运行时解析，不写死路径。

## 数据源

| 项目 | 值 |
|---|---|
| MCP 服务 | `kingbase-87-aggregation`（工具 `mcp__kingbase_87_aggregation__kb_query`，参数 `{sql}`） |
| 库 / schema | `db_hsb` / `sm_hsb` |
| 只读约束 | `kb_query` 只接受 SELECT/WITH/SHOW/EXPLAIN；单次最多 500 行 |
| 大结果 | 超过约 25k token 时客户端落盘，`tool_result` 里给 `Full output has been saved to: <path>` |

库连接信息由 MCP 配置维护，任何脚本、skill、规则文件里都不出现账号密码。

## 绑定口径

一条绑定 = `(生产方系统, 生产服务, 消费方系统, 消费服务)`，方向以 HIS 为参照。

| 证据表 | 生产方 | 消费方 | kind | 置信 |
|---|---|---|---|---|
| 注册服务 `registered_service.service_provider` | 登记系统（服务提供方） | 服务名 `给X调用` 解析出的系统 | `service-declared` | `declared` |
| 发布服务 `published_service.service_provider` | 描述里的生产方（`发布X…服务`）或端点资源码交集推断 | 登记系统（服务调用方） | `service-declared` / `published-endpoint` | `declared` / `inferred` |
| 发布端点 ∩ 注册端点（`resource_code` 相同） | 注册服务登记系统 | 发布服务登记系统 | `published-endpoint` | `inferred` |
| 消息订阅 `message_center_subscribe` → `message_mq_consumer.group` | `message_list.service_id` → 注册服务提供方 | 消费组所属服务（`REGxxxx` / `PUBxxxx`）的登记系统 | `message-subscription` | `declared`（生产方已知）/ `consumer-only` |
| 消息路由 `message_rule_action` → `service_id` | 同消息生产方 | 目标注册服务的提供方 | `message-routing` | 同上 |

方向：`outbound`（HIS 生产 → 外部消费）、`inbound`（外部生产 → HIS 消费）、`internal`（双方都是 HIS/总线）、`external`（双方都不是 HIS）、`unresolved-producer`（只登记了消费方）、`unresolved-consumer`（只登记了生产方）。

`published_matches` 只按资源码交集推断生产方，资源码在不同模块可能重名，所以这类绑定一律标 `inferred`，不升级为 `declared`。

## 前置条件

1. 会话里可调用 `kingbase-87-aggregation` MCP（先用一条 `SELECT 1` 自检）。
2. Python 3（仅标准库；直连模式另需 `psycopg2`）。
3. 输出目录可写。

自检：

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts/agg
python collect_sm_hsb.py --list
python -c "from config import OUTPUT_DIR; print(OUTPUT_DIR)"
```

`--list` 输出 15 个数据集与当前基线行数；行数是最新快照的完整性基线，总线登记变化后同步更新 `collect_sm_hsb.py` 的 `expected`。

## 全量构建

### Step 1 生成 SQL

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts/agg
python collect_sm_hsb.py --emit-sql > "$HOME/.qoder/tmp/agg_sql.txt"
```

15 个数据集（`messages` 分 2 页，其余单页）：

| 数据集 | 内容 | 基线行数 |
|---|---|---|
| `systems` | 接入系统（`sys_access_system_organ`） | 26 |
| `registered_services` | 注册服务（服务提供方） | 33 |
| `registered_endpoints` | 注册端点按服务+模块聚合 | 111 |
| `published_services` | 发布服务（服务调用方） | 28 |
| `published_endpoints` | 发布端点按服务+模块聚合 | 483 |
| `published_matches` | 发布端点 ∩ 注册端点资源码 | 438 |
| `consumer_groups` | `REGxxxx` / `PUBxxxx` 消费组及主题 | 59 |
| `messages` | 消息定义（2 页 × 400） | 566 |
| `message_routes` | 消息路由目标服务 | 351 |
| `flows` | BPL 流程 | 21 |
| `openapi` | 开放接口目录 | 66 |
| `apps` | 门户应用 | 4 |
| `interfaces` | 接口配置 | 6 |
| `executors` | 执行器 | 2 |
| `table_counts` | 核心表行数（新鲜度校验） | 12 |

### Step 2 用 MCP 执行

在会话里对每条 SQL 调用 `mcp__kingbase_87_aggregation__kb_query`。可按 8 条一批并行提交，但每条都要保留原始 SQL 文本（`capture_mcp_results.py` 按 SQL 精确匹配回填）。

注意事项：

- 单次 500 行上限：`messages` 必须按分页 SQL 执行，`truncated: true` 视为未采集完成。
- 超过 25k token 的结果会落盘，不要手工抄行；Step 3 会按落盘路径读取。
- 查询报错时先修正 SQL 再重跑，错误结果不会被当成空数据。

### Step 3 回填 MCP 结果

```bash
python capture_mcp_results.py \
  --transcript "C:/Users/tanxi/.qoder/projects/D--Git-imedicalxc-doctor-all/<会话>.jsonl"
```

脚本从会话 JSONL 建立 `tool_use(sql)` → `tool_result(rows)` 映射，处理落盘路径并按页拼接。默认输出 `~/.qoder/tmp/aggregation_mcp_dump.json`；缺失任何数据集时以 exit 1 结束并列出缺口，不要跳过。

### Step 4 生成原始快照

```bash
python collect_sm_hsb.py --from-json "$HOME/.qoder/tmp/aggregation_mcp_dump.json"
```

输出 `aggregation_raw.json`（确定性排序：`sort_keys=True`，无时间戳）。

### Step 5 生成绑定库

```bash
python build_aggregation_db.py
```

输出 `aggregation_db.json`（查询契约）与 `aggregation_stats.json`（构建统计、方向/置信分布、缺口）。同一 raw 重复构建逐字节一致（stats 含 `generated_at`）。写完后自动同步刷新全部派生产物：`aggregation_graph.html`、`aggregation_graph.graphml`、`aggregation_request_checklist.md`、`aggregation_controller_impact.md`（`--no-export` 可跳过）；任何一次 build 后这些视图都与 db 同版本，不允许只刷新其一。

构建时自动加载代码调用图端点索引（`docs/agents/imedicalxc-doctor-codegraph/` 下的 `controller_endpoints.json` + `maven_controller_endpoints.json`，工作区优先），把注册端点 URL 归一化后反查 Controller 方法，挂接到 HIS 生产绑定上：

- `bindings[].producer.controllers`：该绑定命中的 Controller 方法 ID（`C0001`…）；`producer.resources[]` 逐资源码记录 `urls` / `status`（`resolved` / `not-indexed` / `ambiguous` / `no-endpoint`）与对应 Controller。
- `bindings[].controller_status`：`resolved` / `partial` / `not-indexed` / `no-resource-code`（服务级声明或消息绑定）/ `not-his-producer`（HIS 为消费方）。
- `controllers[]`：去重后的 Controller 方法目录（`controller`、`controller_fqn`、`method`、`file:line`、`http`、`origin`、`urls`、`resource_codes`、`services`、`systems`（受影响厂家）、`bindings`）。
- `meta.controller_link`：挂接统计与未解析请求码清单（含后端模块名，如 `iMedwayService` / `cssd` / `mrm`）。
- 索引文件缺失时 Controller 挂接整体跳过（状态 `index-missing`），绑定库仍可用。

### 直连兜底（MCP 不可用时）

```bash
KB_HOST=... KB_PORT=54321 KB_DATABASE=db_hsb KB_USER=... KB_PASSWORD=... \
  python collect_sm_hsb.py --from-db
python build_aggregation_db.py
```

凭据只从环境变量读取；缺失时打印 `NEED_CREDS` 并 exit 2，缺 `psycopg2` 打印 `NEED_DEPS` 并 exit 2。不要把凭据写进命令历史、脚本或文档。

### Step 6 导出绑定图、影响矩阵与请求码清单

Step 5 已自动导出以下产物；本步仅在需要自定义输出路径时单独重跑：

```bash
python export_aggregation_graph.py
python export_controller_impact.py
```

输出三张视图：

- `aggregation_graph.html`：自包含交互图，两个页签：
  - **系统概览**：HIS 居中，边按方向着色，悬停显示该配对的具体请求码/消息码/HIS Controller；点边或左侧配对，右侧展开该配对的「请求 / 消息 / Controller」明细；支持方向过滤、系统/服务/请求/消息/Controller 搜索、点节点聚焦。
  - **请求明细**：228 条绑定逐条展开到「生产方系统 / 生产服务 → HIS Controller（未解析的请求码标红并带后端模块名）→ 具体请求码或消息（含消息描述） → 消费方系统 / 消费服务」，并标注 kind、置信、方向、路由动作数；搜索框可直接搜请求码（如 `recPISRequest`）、Controller 名或消息描述。
- `aggregation_graph.graphml`：Gephi 可导入；节点带系统属性，边带绑定数、端点数、消息数、路由数、kind/方向/服务、`request_codes`、`message_codes`，以及聚合后的 `controllers`（Controller.方法 列表）。
- `aggregation_request_checklist.md`：请求码对照清单（Markdown 三表）——表 A 126 条含请求码的绑定逐条列出「生产方系统·服务 → HIS Controller（含未解析标注）→ 具体请求码 → 消费方系统·服务」，表 B 102 条无请求码的绑定（含消息码 + 描述），表 C 按 121 个请求码反查绑定、Controller 与服务。适合评审、贴群或与对端核对。
- `aggregation_controller_impact.md`：**Controller 影响矩阵**——汇总矩阵逐 Controller 列出位置（`file:line` 或 Maven jar 标注）、HIS 服务、对外请求码、受影响厂家系统与绑定数；明细矩阵把每个 Controller 展开到「厂家系统 · 厂家服务 · 资源码 · 接口中文名 · ESB 路径」；另附未解析请求码（19 个，含受影响厂家接口）、服务级声明/消息绑定（27 条）与非 HIS 生产绑定的归类说明。回答「改动这个 Controller 会影响哪些厂家的哪些接口」。

节点 = 接入系统，边 = 生产方 → 消费方并按下述维度聚合：`bindings`、`endpoints`、`requests`、`messages`、`routes`、`kinds`、`directions`、`services`。生产方未登记的绑定指向虚线节点 `(未登记)`。请求码取自两端资源码交集（`evidence.resource_codes`），消息码取自订阅组/路由（`evidence.message_codes`），消息描述来自 `messages[].desc`。导出确定性：节点/边/明细排序固定，HTML 不含时间戳。

## 增量更新

总线配置变更后按影响面重跑，不必每次全量：

| 变更 | 需重跑数据集 | 后续 |
|---|---|---|
| 新增/修改接入系统 | `systems`（其余数据集的系统名依赖它） | Step 3 → Step 5 |
| 新增/修改注册服务或端点 | `registered_services`、`registered_endpoints`、`published_matches` | Step 3 → Step 5 |
| 新增/修改发布服务或端点 | `published_services`、`published_endpoints`、`published_matches` | Step 3 → Step 5 |
| 新增消费组 / 订阅关系 | `consumer_groups` | Step 3 → Step 5 |
| 新增/修改消息或路由 | `messages`（含分页）、`message_routes` | Step 3 → Step 5 |
| 只改 `config.py` 的系统别名/声明解析 | 不重跑导出 | `python build_aggregation_db.py` |
| 无法判断 | 全量 | Step 1 → Step 5 |

新鲜度自检：`aggregation_raw.json` 的 `datasets.table_counts` 与当前库对比；任一核心表行数变化即重建。`messages` 行数应等于 `message_list`，`message_routes` 的 `route_actions` 合计应等于 `message_rule_action`。

## 输出文件

| 文件 | 内容 | 大小（2026-11-10） |
|---|---|---|
| `aggregation_raw.json` | 17 个数据集的原始导出 + `table_counts` + 来源（含注册/发布端点明细：资源码 + URL + 中文名） | ~848 KB |
| `aggregation_db.json` | 查询契约：systems / services / bindings（含 Controller 挂接）/ controllers / messages / message_groups / message_routes / catalogs / unresolved / meta | ~794 KB |
| `aggregation_stats.json` | 规模、方向/置信/kind 分布、数据集行数、Controller 挂接统计、`generated_at` | ~2.6 KB |
| `aggregation_graph.html` | 绑定图（自包含）：系统概览 + 228 条请求级明细（含 HIS Controller 列），可点边下钻、按 Controller 搜索 | ~243 KB |
| `aggregation_graph.graphml` | 绑定图（Gephi；节点=系统，边=聚合绑定，含 request_codes / message_codes / controllers） | ~52 KB |
| `aggregation_request_checklist.md` | 请求码对照清单：126 条含码绑定（含 Controller 列）+ 102 条无码绑定 + 121 个请求码反查 | ~127 KB |
| `aggregation_controller_impact.md` | Controller 影响矩阵：64 个 Controller → 受影响厂家接口（汇总 + 128 行明细 + 19 个未解析码 + 27 条声明/消息绑定） | ~46 KB |

`aggregation_db.json` 关键字段：

- `bindings[]`：`id`（`B0001`…）、`producer` / `consumer`（system、system_id、service、service_name；HIS 生产侧另有 `controllers`、`resources`）、`direction`、`kinds`、`confidence`、`controller_status`、`evidence`（`matched_endpoints`、`modules`、`resource_codes`、`message_codes`、`route_actions`、`route_messages`、`declared_terms`）。`producer.resources[]` 逐资源码给出 `urls`、`name`、`status` 与 `controllers`；`consumer.resources[]` 给出厂家侧接口名与 ESB 路径。
- `controllers[]`：Controller 方法目录（`id` `C0001`…、`controller`、`controller_fqn`、`method`、`file`、`line`、`http`、`origin`、`urls`、`resource_codes`、`services`、`systems`、`bindings`）。
- `services.registered[]` / `services.published[]`：服务名、登记系统、端点总数、模块分布、声明调用方/生产方。
- `messages[]`：消息码、描述、生产系统/服务、消费系统、订阅组、路由目标。
- `message_groups[]`：消费组、类型（`registered` / `published`）、所属服务、系统、主题列表。
- `catalogs`：`flows`、`openapi`、`apps`、`interfaces`、`executors`。
- `unresolved`：`declared_consumers`、`declared_producers`、`declaration_mismatch`、`groups_without_service`、`messages_without_producer`、`messages_without_consumer`、`services_without_consumer`、`published_without_producer`。
- `meta.controller_link` / `meta.controller_index`：Controller 挂接统计（绑定状态分布、解析/未解析请求码）与所用索引规模。

## 查询

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts/agg

python query_aggregation.py --stats
python query_aggregation.py --system HIS
python query_aggregation.py --producer HIS --direction outbound
python query_aggregation.py --consumer LIS --kind published-endpoint
python query_aggregation.py --service PUB0003
python query_aggregation.py --message MSG0001
python query_aggregation.py --search 检验 --limit 20
python query_aggregation.py --system HIS --json
```

- `--system` 先打印系统汇总（生产/消费绑定数、方向分布、服务/端点/消息计数），再列绑定明细。方向按 HIS 视角统计，生产侧和消费侧各累计一次，`internal` 绑定会双侧计数。
- `--service` 同时查注册与发布服务；发布服务额外打印描述与声明调用方。
- `--message` 打印消息的生产方、消费系统、订阅组与路由目标。
- `--json` 输出原始记录，供其他脚本消费。
- 图形化查看：直接打开 `aggregation_graph.html`；想看「哪个请求/消息被谁消费」用「请求明细」页签或点边下钻；按 Controller 评估厂家影响用 `aggregation_controller_impact.md`（或 `--search` 搜 Controller 名）；Gephi 布局用 `aggregation_graph.graphml`；要贴文档/群里核对用 `aggregation_request_checklist.md`。

## 质量规则与已知缺口

构建后必须核对以下数字（2026-11-10 基线）：

| 指标 | 值 | 含义 |
|---|---|---|
| 绑定总数 | 228 | `bindings[]` |
| 方向 | outbound 121 / inbound 24 / external 20 / internal 5 / unresolved-producer 58 | 以 HIS 为参照 |
| 置信 | inferred 126 / declared 44 / consumer-only 58 | 无 `producer-only`（无消费方的服务只进 `unresolved`） |
| kind | published-endpoint 126 / message-subscription 74 / message-routing 44 / service-declared 29 | 一条绑定可合并多种 kind |
| 消息生产方已知 | 32 / 566 | `message_list.service_id` 只有 32 条非空，且全部是 HIS 服务 |
| 无生产方消息 | 534 | 消息订阅绑定降级为 `consumer-only` / `unresolved-producer`，不能当成 HIS 生产 |
| 无消费方消息 | 167 | 既无订阅组也无路由目标 |
| 无消费方注册服务 | 3 | `REG0010`（PE）、`REG0019`（HIS 公共服务2）、`REG0030`（EM） |
| 无生产方发布服务 | 2 | `PUB0025`（HIS2EBillService，声明“电子票据”未匹配）、`PUB0027`（InsuService） |
| 未匹配调用方声明 | 4 | `PDA移动护理`（2 次）、`其他`（1 次）、`应急管理`（1 次）——补别名后重跑 build 即可 |
| 消息路由动作 | 372 → 351 组 | `message_rule.service_id` 全为空，路由证据只能走 `message_rule_action.service_id` |
| 发布资源码精确命中 | 227 / 493 | 其余发布端点没有注册端点对应，生产方无法推断 |
| HIS 请求码挂到 Controller | 67 / 86（按绑定计 265 / 387） | `controller_link`；19 个未解析集中在 `iMedwayService`（14 个）、`cssd`（3）、`mrm`（2），源码不在本工程 |
| Controller 绑定状态 | 完全 54 / 部分 34 / 未解析 11 / 无资源码 27 | `controller_status`；非 HIS 生产绑定 102 条标记 `not-his-producer` |

报告绑定结论时同时给出 `confidence` 与 `evidence`：`inferred` 只能表述为“按资源码交集推断”，不能表述为对方系统已声明。

## 踩坑

1. **软删标志类型不一致**：`sys_access_system_organ.del_flag` 是 varchar，不能与整数 `0` 比较；统一写 `COALESCE(del_flag,'0')='0'` / `(is_delete IS NULL OR is_delete::text='0')`。
2. **MCP 单次 500 行**：任何数据集超过 500 行都必须分页；`truncated: true` 不能当成完整结果。
3. **大结果落盘**：`tool_result` 只给预览和路径，解析时必须读取 `Full output has been saved to:` 指向的文件，预览 JSON 不完整。
4. **`hos_sys_interface.system_id` 不是接入系统 ID**：它引用 `hos_system_app.id`（MD5 形态），不能 join `sys_access_system_organ`，否则报 `invalid input syntax for type bigint`；用 `a.id::text = i.system_id::text`。
5. **发布服务的 `service_provider` 是调用方**：服务名是英文（`HISService`、`RISService`），消费方从 `service_desc` 的“提供给 X 调用”解析，不能按服务名匹配系统。
6. **“发布REST服务…”没有生产方**：描述里 `发布REST` 后面不是系统名，`_declared_owner` 必须跳过，否则会把 `REST` 当成系统。
7. **系统别名按最长词优先**：`检验外送` → `LISDelivery` 必须先于 `检验` → `LIS`；`互联网医院/互联网平台` 先于 `互联网`。新增别名补 `config.SYSTEM_ALIASES`，排序在模块加载时完成。
8. **消费组类型看前缀而不是表**：`message_mq_consumer.group` 以 `REG` 开头表示服务方组，`PUB` 开头表示调用方组；两种组的系统都取对应服务的 `service_provider`。
9. **消息生产方覆盖率低是数据事实**：`message_list.service_id` 只有 32 条，不能把“无生产方”推断成总线或 HIS；这类消息只能给消费侧证据。
10. **`message_rule.service_id` 全空**：路由动作在 `message_rule_action`，并且 `message_id` 是 text 类型，join 用 `m.id::text = a.message_id`。
11. **资源码交集会跨模块重名**：`published_matches` 按资源码等值连接，同一资源码可能对应多个模块；绑定保留 `modules` 与 `resource_codes` 证据，置信固定 `inferred`。
12. **SQL 匹配要折叠空白**：MCP 里常以单行执行 SQL，脚本按多行渲染，回填前必须把空白折叠后再比较，否则会漏采集。
13. **`consumer_groups` 要对子查询分组**：`service_code` 同时存在于注册/发布服务表，直接 `GROUP BY` 别名会有歧义；先子查询再按 `group_code` 聚合。
14. **端点模块口径**：`/api/openapi/<module>/...` 取第 4 段，裸路径取第 1 段；为空记 `(root)`，不要丢弃无模块端点。
15. **注册 URL ↔ Controller 路径归一化**：小写、去首尾斜杠、去 `${...}/` 上下文占位，再各去一次 `api/` 与 `openapi/` 前缀（`api/` 4 字符、`openapi/` 8 字符，别都按 4 截）。只有归一化后唯一命中才算 `resolved`，多候选记 `ambiguous` 并在清单里列出。
16. **未解析不是匹配问题**：`iMedwayService` / `cssd` / `mrm` 等模块的 Controller 不在工作区也不在 Maven jar 索引里，方法名/路径后缀兜底同样命中 0；状态如实标 `not-indexed` 并保留后端模块名，不要强行挂到同名不同路径的 Controller（如 `MaPhmBaseLisController`）。

## 当前规模（2026-11-10）

| 指标 | 数值 |
|---|---|
| 接入系统 / 注册服务 / 发布服务 | 26 / 33 / 28 |
| 注册端点 / 发布端点 / 资源码匹配 | 672 / 493 / 227 |
| 消息 / 消费组 / 路由动作 | 566 / 59 / 372（351 组） |
| BPL 流程 / 开放接口 / 门户应用 / 接口配置 / 执行器 | 21 / 66 / 4 / 6 / 2 |
| 绑定 | 228（HIS 生产侧 126、HIS 消费侧 47，internal 5 条双向计数） |
| 绑定图 | 27 节点（26 系统 + `(未登记)`）/ 81 条聚合边 / 228 条请求级明细 |
| HIS 出站 Top | WeChat 12、RIS 9、AN 8、ICUService 8、PE 8、血透 8 |
| HIS 入站 | WeChat 4、BLD 3、LIS 3，其余 1-2 |
