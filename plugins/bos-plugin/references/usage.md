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

用户级绑定不会改变已运行客户端环境。当前验证命令显式注入返回路径，客户端重启后继承 BOS_MCP_CONFIG。凭据填写后分别运行对应脚本 defaults 离线校验；query 的 cuser/cgroup 还须确认不是 TODO，日志 defaults 校验 token/linkProject。命令成功不代表真实连接或 BOS 写入成功，网络操作按独立授权执行。

人员优先级：调用参数 → BOS_CUSER → 本技能段 cuser；组优先级：显式 cgroup（含空字符串）→ BOS_CGROUP → 本技能段 cgroup。access_key/Token 的 TODO 阻止查询连接；身份 TODO 阻止列表，编号查询不要求身份。缺少所在组时停止，只有主动传 cgroup: "" 才是跨组；sgroup 是另一个发起组筛选。

## 命令

从已加载技能的真实目录解析 ../../scripts/bos-demand-query.js 的绝对路径：

- defaults：先离线读取并校验连接配置，再只输出默认 cuser、cgroup；凭据仍为 TODO 时失败，身份 TODO 可能原样返回，须另外核对。不联网，不输出 URL、headers 或 Token，也不证明真实连接可用。
- check：SSE 握手与查询工具发现，不取需求数据。
- query '{"id":"12345"}'：精确编号查询。
- query '{"date":"2026-01-01","date2":"2026-01-02"}'：以默认当前人、默认当前组查询指定创建日期范围。项目来源另传 source: "项目"，跨组另传 cgroup: ""。
- query '{"date":"2026-01-01","date2":"2026-01-02","sgroup":"测试"}'：默认当前人、当前组下，筛选发起组为“测试”的需求；需要项目来源时同时传 source: "项目"。sgroup 省略或传空字符串不限制发起组，不改变 cgroup；多选组的上游语法尚未验证，不猜分隔符。
- serve：可选 stdio MCP，暴露 bos_demand_query；不需要原生工具注册时直接由 skill 调用 CLI。

可选字段：mode、timezone、sort、order、title、content、source、status、type、cuser、cgroup、sgroup、datetype、date、date2、product、mod。datetype 可为创建时间、预计完成时间、执行时间、分配时间或操作时间。id 有值时清空其它筛选条件。日期端点包含规则和服务端总量限制尚未确认。

如需原生 MCP 工具，按 [客户端 MCP 注册](client-mcp.md)获取无凭据配置示例和验收步骤；无需每项目配置。本 skill 不自动改宿主 MCP 设置，也不认为文件链接成功等于宿主已加载。

## 查询模式

- `query '{"mode":"pending"}'`：本人所在组待办。
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

迁移来源曾在 Windows / Node 24 验证握手、工具发现、编号及当前人日期查询；这些历史证据不等于框架版本或其它宿主已验收。tests/bos-demand-query.tests.js 用合成数据覆盖参数、传输和 stdio。一个标题样本上游返回错误，无标题对照成功，根因未确认。其它平台、Node 22 和真实宿主发现需分别验证；CI 配置不是通过证据。
