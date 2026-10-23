# 使用与配置

## 共享私有配置

两项联网技能共用一个仓外 JSON 文件，通过 BOS_MCP_CONFIG 明确指定绝对路径。顶层按实际 skill 名分段：bos-demand-query 与 bos-code-update-log；每项只读取自己的段，另一段缺失、禁用或未填不影响它。凭据分开提供，不能互相代用。普通框架更新只分发能力，不读取或修改个人配置。

| 配置段 | 字段与作用 |
|---|---|
| bos-demand-query | connection: company、access_key、headers.X-Gateway-Upstream-BOS-MCP-TOKEN、cuser、cgroup；或自定义 url/headers 与身份字段 |
| bos-code-update-log | connection: company、token、linkProject、可选 timeout（默认 30000ms）；或自定义 url；见 [日志配置](code-update-log.md) |

公司连接由 [公司默认值](company-defaults.json) 管理：查询取 url，日志取 codeUpdateLogUrl。自定义连接在对应段写 url，与 connection: company 二选一；不猜测生产/测试环境。地址更新只改变公司连接的运行时默认值，不写个人文件。BOS_MCP_CONFIG 仅绑定文件路径，不含凭据；旧连接环境变量和编辑器设置均不再作为连接来源。

## Windows 初始化与旧配置迁移

请求“初始化 BOS 个人配置”，bos-init 执行 node <查询脚本绝对路径> init-config [私有文件绝对路径]。路径优先级：命令参数 → 进程 BOS_MCP_CONFIG → 用户级 BOS_MCP_CONFIG → %LOCALAPPDATA%/imedical-agents/bos/config.json。生成两段 TODO 实例，只绑定用户级 BOS_MCP_CONFIG。返回 configPath 后，Agent 展示或打开文件，使用者通过安全渠道填写各自字段，不把真实凭据发送到聊天。仓内不保存可填写真实凭据的模板。

已有新格式文件保留字段值；仅补充缺失的技能段。普通初始化遇到旧格式停止。明确请求迁移时运行 node <查询脚本绝对路径> migrate-config <原文件绝对路径>：只在原路径一次性把已识别的平铺查询对象移到 bos-demand-query，增加日志 TODO 段，不转换或删除查询字段、不从编辑器导入凭据。写前比对原字节，发生并发修改就停止；原子替换后回读，临时文件清理，无备份副本。已有新格式可重复执行且保留原值。未识别的旧包装或额外字段停止，须人工核对并按技能分段整理，不猜测身份。

本版本运行时只接受按 skill 分段的格式，不兼容旧平铺、mcpServers 包装、仅身份文件或连接环境变量回退。升级到 0.4.0 前应先明确迁移步骤，使用新版本迁移脚本转换私有文件后再启动查询。其它工程主动更新能力包；维护源修改不自动更新业务副本。

自动初始化/迁移仅支持正常 Windows 宿主；拒绝仓内文件、文件链接和 Packages 下 AC/LocalCache 重定向。目录 Junction 须核对物理位置仍在仓外且桌面可访问。绑定失败保留文件，修复后重试；非 Windows 只读 CLI 可用，私有文件与路径绑定由使用者显式配置，自动初始化明确停止。

用户级绑定不会改变已运行客户端环境。当前验证命令显式注入返回路径，客户端重启后继承 BOS_MCP_CONFIG。凭据填写后分别运行对应脚本 defaults 离线校验；使用默认个人查询前确认 cuser/cgroup 不是 TODO，明确其它口径时可清除不用的默认值；日志 defaults 校验 token/linkProject。命令成功不代表真实连接或 BOS 写入成功，网络操作按独立授权执行。

当前人优先级：显式 cuser（含空字符串）→ BOS_CUSER → 本技能段 cuser；当前组优先级：显式 cgroup（含空字符串）→ BOS_CGROUP → 本技能段 cgroup。显式空字符串分别清除对应默认条件。access_key/Token 的 TODO 阻止查询连接；实际采用的人员/组为 TODO 时阻止列表，编号查询不要求身份。旧 pending / project-pending 待办缺少所在组时停止，主动传 cgroup: "" 表示跨组；sgroup / tgroup 是独立的发起组 / 接受组筛选。

## 命令

从已加载技能的真实目录解析 ../../scripts/bos-demand-query.js 的绝对路径：

- defaults：先离线读取并校验连接配置，再只输出默认 cuser、cgroup；凭据仍为 TODO 时失败，身份 TODO 可能原样返回，须另外核对。不联网，不输出 URL、headers 或 Token，也不证明真实连接可用。
- check：SSE 握手与查询工具发现，不取需求数据。
- query '{"id":"12345"}'：精确编号查询。
- query '{"date":"2026-01-01","date2":"2026-01-02"}'：以默认当前人、默认当前组查询指定创建日期范围。项目来源另传 source: "项目"，跨组另传 cgroup: ""。
- query '{"date":"2026-01-01","date2":"2026-01-02","sgroup":"测试"}'：默认当前人、当前组下，筛选发起组为“测试”的需求；需要项目来源时同时传 source: "项目"。sgroup 省略或传空字符串不限制发起组，不改变 cgroup；多选组的上游语法尚未验证，不猜分隔符。
- serve：可选 stdio MCP，暴露 bos_demand_query；不需要原生工具注册时直接由 skill 调用 CLI。

本地入参、上游字段和默认行为见下表。CLI 与可选 stdio 工具 bos_demand_query 使用同一参数校验；未知字段、字符串字段的非 string 值或非对象 body 在联网前报错。

如需原生 MCP 工具，按 [客户端 MCP 注册](client-mcp.md)获取无凭据配置示例和验收步骤；无需每项目配置。本 skill 不自动改宿主 MCP 设置，也不认为文件链接成功等于宿主已加载。

## 查询参数契约

个人 `todo` / `workload` 的固定人员条件与日期处理优先按下节[个人查询口径](#个人待办与工作量口径)执行；本节默认人员/组及宽创建日期说明适用于旧通用模式。

上游工具为 post_imedway_ylxt_bosdata。以下上游声明是 2026-10-14 维护时提供的 tools/list 读取结果快照；本地支持与处理已对照 bos-demand-query.js，不代表本轮重新连接上游或逐字段完成真实查询。上游变化时重新核对 schema 与适配层，不将快照当作实时发现。

上游除 body 外的 18 项均为 string，且列入 required；required 约束字段存在，不代表每项都要有筛选值。适配层开放全部已声明字段并自动补齐字符串：explain 默认 "0"，未使用的筛选项为空字符串；body 仅在调用者提供时发送。无需手填全部 18 项，也不猜测 body 内部字段。

| 字段 | 上游含义或约定 | 本地支持与处理 |
|---|---|---|
| explain | 字段解释说明，非业务参数；默认 "0" | 支持 string，默认 "0"；非空且不为 "0" 时原样交给上游，跳过本地身份/日期默认值和列表处理；非默认值的上游取值规则未确认 |
| id | 需求号；有值时忽略其它条件 | 支持数字字符串；清空其它字符串筛选，不要求默认身份；explain / body 保留，入参名称和类型仍须合法 |
| title | 需求标题，模糊检索关键字 | 支持并透传；上游错误样本见下节 |
| content | 需求描述，模糊检索关键字 | 支持并透传 |
| source | 来源：产品 / 项目 / 用户 / 实施 / 产品部 | 支持并透传；project-pending 固定为“项目”，冲突值停止 |
| status | 需求状态；未公布可选值 | 支持并透传；非空值时不额外应用本地待办状态过滤 |
| type | 需求类型；未公布可选值 | 支持并透传，不猜测枚举 |
| sgroup | 发起组 | 支持，独立于 cgroup；省略或空字符串表示不限发起组 |
| tgroup | 接受组 | 支持并透传，与其它人员/组条件独立 |
| cgroup | 当前组 | 支持；省略取默认当前组，显式空字符串表示跨组；待办模式缺少默认组时停止 |
| suser | 发起人 | 支持并透传；纯发起人查询需清除不用的默认 cuser / cgroup |
| tuser | 接受人 | 支持并透传；纯接受人查询需清除不用的默认 cuser / cgroup |
| cuser | 当前人 | 支持；省略取默认当前人，显式空字符串清除当前人限制；列表可改用其它人员或组条件 |
| datetype | 创建时间 / 预计完成时间 / 执行时间 / 分配时间 / 操作时间；默认创建时间 | 支持上述五值，默认创建时间；非创建时间须提供完整日期范围 |
| date | 起始日期 yyyy-MM-dd；上游默认当日 | 支持合法日期；普通 list 必须提供，待办和 history 未给日期时生成 1900-01-01 |
| date2 | 截止日期 yyyy-MM-dd；上游默认 date 次日 | 支持合法日期且不得早于 date；普通 list 必须提供，待办和 history 未给日期时生成用户时区当天 |
| product | 产品 | 支持并透传 |
| mod | 产品模块 | 支持并透传 |
| body | 可选对象；schema 未定义内部字段 | 支持 JSON 对象并原样透传；省略则不发送，不推断内部结构，也不把内部字段当作已确认的人员/组条件 |

普通列表至少需要一个非空人员或组条件：suser / tuser / cuser / sgroup / tgroup / cgroup 均可；全空、仅空白或 TODO 停止。字段说明请求保留上游返回，由上游判断传入 explain 值是否有效，不套列表口径。旧 pending 查询继续默认本人＋所在组；默认本人缺失且未明确其它查询口径时停止，不悄悄退化为整组查询。

### 人员与组口径示例

下列示例使用虚构条件，不读取或保存真实个人信息。history 仅选择宽创建日期和不做待办状态过滤，人员/组条件仍按显式参数决定：

- 我发起的历史：`query '{"mode":"history","suser":"示例人员","cuser":"","cgroup":""}'`。将默认本人用于 suser，清除默认当前人和当前组，包含已转给其它人处理的需求。
- 指定接受人的历史：`query '{"mode":"history","tuser":"示例人员","cuser":"","cgroup":""}'`。
- 接受组的待办：`query '{"mode":"pending","tgroup":"示例组","cuser":"","cgroup":""}'`。按接受组查询并应用本地暂行待办过滤。
- 当前组的完整列表：`query '{"mode":"history","cgroup":"示例组","cuser":""}'`。不限制当前人，保留全部返回状态。

既有 sgroup 作为额外筛选的调用不变；需要仅发起组口径时，同样显式清除 cuser / cgroup。省略字段与传空字符串含义不同，条件组合保留原样，不自动推断哪项应删除。

### 0.6.0 调用迁移

此前 cuser: "" 会回落到默认本人；0.6.0 起表示明确清除当前人。旧调用如希望继续继承本人，应省略 cuser；cgroup 的空字符串语义不变。默认“我的待办”调用无需调整，私有配置结构不变，不自动改写个人文件或已有调用。

本地扩展参数均为可选 string，不发送到上游：

| 参数 | 取值与本地作用 |
|---|---|
| mode | list / pending / project-pending / history / todo / workload；默认 list，个人两模式见下节 |
| sourceScope | all / project / non-project；仅用于个人 todo/workload，提供且省略 mode 时默认 todo，见来源口径 |
| timezone | 有效 IANA 时区；默认 Asia/Shanghai，用于生成截止日 |
| sort | 创建时间 / 预计完成时间 / 执行时间；通用模式默认创建时间，todo 默认预计完成时间，workload 默认执行时间 |
| order | asc / desc；默认 asc，控制日期排序方向 |

详细模式、日期优先级与排序规则见下节“查询模式”。

## 个人待办与工作量口径

`--todo [日期或范围]` 与 `--workload 日期或范围` 是 skill 和脚本 CLI 的日常入口；JSON/MCP 分别使用 `mode: "todo"` / `"workload"`。单日为 `YYYY-MM-DD`，范围为两个日期或一个 `YYYY-MM-DD~YYYY-MM-DD`。JSON 单日只传 date，date2 省略时等于 date；范围显式传两者，首尾两日均包含。CLI 两入口互斥，格式无效或缺少 workload 日期时在读取配置/联网前停止。

人员以已配置的本人为 subject；JSON 明确 tuser 可指定统计对象。缺少本人或仍为 TODO 时停止，不猜身份。两模式清除默认 cgroup，todo 固定 tuser/cuser 均为 subject，workload 固定 tuser 为 subject、cuser 为空，避免已转测试/项目组的工作被裁剪。与固定人员、组或日期字段冲突的入参停止；额外显式筛选仍保留，status 仅缩小上游查询，不绕过本地分类。

| 模式 | 日期筛选 | 本地纳入条件 |
|---|---|---|
| todo | 无日期时不限制预计完成时间，含预计完成时间为空的需求；有日期时按预计完成时间 | 接受人和当前人均为 subject，状态为新建 / 分配 / 分配(开发) / 活动 / 修正；已有执行时间的返工或重新分配仍纳入 |
| workload | 必填执行日期或范围 | 接受人为 subject，期间有合法执行时间；状态为完成（当前人可仍为本人），或当前人已转他人且状态为测试分配 / 组内测试 / 测试完成 / 更新完成 / 挂起 |

取消、已拆分、回置不计工作量或开发待办。接受人为别人、当前人为本人不构成本人开发工作。缺少人员/状态或不符合上述组合的条目进入待核对清单，不默认为完成，也不悄悄丢弃新状态；它们不计入已确认条数。该口径依据人员职责流转与已观察状态，是当前可执行规则，新增状态/转派语义须另行核对。

带日期时向上游请求 date 至截止日次日，再按返回的原日期字段截取 YYYY-MM-DD 做包含首尾两日的校验，排除次日及无效/缺失日期。无日期 todo 用宽创建日期（1900-01-01 至用户时区今天次日）获取候选，不用预计完成时间预筛，因此保留未填写/未来预计完成的待办。此策略兼容常见含/不含上界的服务端实现，不证明上游没有分页、截断或其它端点差异。

结果仍在 data，汇总仍在 `_meta.bosDemandQuery`；personal 含 subject、dateField、range（全部待办为 null）、basis、excludedReasons、unclassifiedCount 和原待核对条目 unclassified。回复必须展示实际人员、日期字段/范围、人员/状态组合口径、已确认条数，并单列待核对项。字段缺失和上游完整性限制如实说明；工作量是本次快照下已完成开发环节的需求数，不是最终验收数、工时或历史流转次数，执行时间被覆盖时不能还原此前工作量。

旧 pending / project-pending 保留原当前人＋所在组及状态排除行为；明确个人开发待办使用 todo。旧 list/history、按编号详情、explain 与私有配置结构不变。正常更新能力包并刷新已启用索引即可取得新入口，无配置迁移或旧文件清理，不自动部署业务副本。

## 项目与产品非项目来源口径

skill 无参数默认 todo；脚本保留无参数启动 serve 的兼容行为，Agent 显式调用 `--todo`。`--proj` / `--dev` 是互斥来源开关，可单独使用（默认 todo），也可在 `--todo` / `--workload` 和日期前后组合。日期语义不变，workload 始终要求日期。JSON/MCP 使用本地 sourceScope（all / project / non-project），提供且省略 mode 时默认 todo，非个人模式显式传该字段停止；原 query JSON 未给 mode/sourceScope 仍为 list。

- project：上游 source 固定“项目”，并在本地核对返回来源；冲突的显式 source 停止。
- non-project：产品按“非项目”理解，包含产品、用户、实施、产品部及其它实际非空非项目来源。上游 source 不限，再本地排除项目；明确给非项目 source 时保留该精确条件，给 source: "项目" 时停止。不猜测上游排除、多选或逻辑表达式语法。
- all：保留原 source 精确筛选及不限来源的语义，不作额外分类。

来源范围与原人员/状态/日期等条件组合生效，不切换至旧 project-pending 模式。仅在选择来源口径时，缺失、空白或非字符串来源进入 personal.unclassified，不自动归入产品；不匹配的已知来源记 outside-source。返回 data 仍是已处理结果，personal.sourceScope / sourceBasis 展示采用口径，returnedCount / includedCount / excludedCount 及 excludedReasons 反映上游候选与本地排除。分类不证明服务端返回全量；来源缺失的候选也可能受上游 source 预筛影响，不能从 project 查询声称已发现全部缺失来源。

## 参数异常与验证边界

- title 是上游声明支持、适配层已开放的参数。已观察到一个非空标题样本返回 HTTP 500，无标题对照成功；样本量为 1，根因未确认，不能据此认定所有标题筛选不可用。遇到同类错误时报告原筛选与错误，不自动删除 title 或换用 content；只有用户明确调整查询范围时才改变条件。
- schema 未公布 status / type 枚举、多值筛选语法、需求列表分页、排序或“待办”专用参数。使用用户已确认或返回数据中实际出现的值，不猜分隔符或新增字段；本地待办口径见下文。
- 日期端点是否包含、服务端总量限制及返回完整性尚未确认。上游 schema 声明、合成测试通过和真实查询成功是不同证据；单次返回数不能证明全量。

## 查询模式

- `query '{"mode":"pending"}'`：旧当前人/所在组待办；个人开发待办使用 todo。
- `query '{"mode":"project-pending"}'`：另限来源为“项目”。
- `query '{"mode":"history"}'`：历史列表，不过滤待办状态。
- `list` 或省略 mode：明确提供完整日期范围。

前三种未给日期时生成创建时间 1900-01-01 至当前日；timezone 默认 Asia/Shanghai，可显式覆盖。非创建时间及显式日期需提供完整范围。sort 支持创建时间、预计完成时间，order 支持 asc/desc；默认创建时间升序，同日需求号升序，无效日期置后。显式 status 时不额外套待办过滤。

脚本处理筛选、排序和计数；读取 `_meta.bosDemandQuery` 核对条件、returnedCount、includedCount、excludedCount 与状态分布，不再次过滤。上游总量和分页限制未知，返回数不能证明全量。

## 待办筛选与核对

待办状态暂用排除法：排除「完成、取消、已拆分」，其余保留原状态。遇到此前未核对的状态或页面数量不符时标为待确认并定向核对，不悄悄丢弃，也不据此宣称已精确复现页面服务端规则。明确查询某个状态时使用 status，不额外套用待办过滤。接口不暴露“待办”布尔条件；不要猜测 status 的多值分隔语法。

对照网页时核对当前人、当前组、来源、日期、排序以及每页需求号；跨页去重后与页脚总数比较。页面默认无日期限制，上述宽日期范围不等于已证明接口无截断。数量变化先检查实时状态或归属变化，不把所有差异归因于状态规则。

待办口径需按实际账号和页面重新核对，不把历史样本数量作为完整性保证。详情中的描述 HTML 可含图片；附件链接和元数据不等于已经读取文件。

## 实现与验证

按 [MCP 2024-11-05](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports) 实现有限 stdio / HTTP+SSE 子集，无 npm 依赖；未复制上游 SDK 源码。仅支持该协议版本，不是任意 MCP 代理，不支持 OAuth 或 Streamable HTTP。SSE endpoint 限同源，禁重定向，30 秒超时，结束关闭连接，错误输出不含原始连接信息。

返回值在序列化前按字符串值脱敏，并解析 MCP 文本中的 JSON 处理转义凭据；未命中时保留原文格式。脱敏对象为完整连接 URL、Authorization / Proxy-Authorization / Cookie、以 token / key / secret / password / passwd 结尾的分段 header，以及 URL 的 access_key / api_key / mcp_key / auth_key / key / access_token / auth_token / token / secret / password / passwd / authorization / auth 参数（不区分大小写，兼容连字符与无分隔形式）。普通 URL 参数和 header 不作为凭据替换；自定义鉴权字段不在此识别范围内时，需补充识别与回归测试。

迁移来源曾在 Windows / Node 24 验证握手、工具发现、编号及当前人日期查询；这些历史证据不等于框架版本或其它宿主已验收。tests/bos-demand-query.tests.js 用合成数据覆盖参数、传输和 stdio；上游参数声明与错误观察见上文。其它平台、Node 22 和真实宿主发现需分别验证；CI 配置不是通过证据。
