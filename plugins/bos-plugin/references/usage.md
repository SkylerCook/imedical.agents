# 使用与配置

## Windows 首次使用

请求“初始化 BOS”即可。bos-init 执行 `node <插件脚本绝对路径> init-config`，自动创建 `%LOCALAPPDATA%/imedical-agents/bos/config.json`，并将 Windows 用户级 BOS_MCP_CONFIG 绑定到该文件绝对路径。命令返回 configPath，Agent 展示或打开此文件，使用者只补全其中 TODO：access_key、headers.X-Gateway-Upstream-BOS-MCP-TOKEN、cuser 和 cgroup。凭据由公司服务维护方提供，不发到聊天、不写入工程或框架。

脚本内置的是 MCP 客户端协议，不包含访问凭据。公司不含鉴权参数的默认服务地址来自 [公司默认值](company-defaults.json)，初始化自动设置 BOS_MCP_URL；请求时将私有 access_key 拼接到 URL。无需使用者打开系统环境变量界面。

初始化需在正常 Windows 用户环境执行。工具提权不等于脱离应用包重定向；检测到 LOCALAPPDATA 或目标物理路径落入 Packages 下的 AC / LocalCache 时，应在写入前停止。由正常桌面 PowerShell 初始化，并以物理路径及桌面访问验证；同一工具环境中的 Test-Path 或变量回读不能单独证明成功。

新文件使用 connection: company；实例只在仓外生成，仓内不保存可供填写真实凭据的完整模板。已存在的配置不覆盖，显式 BOS_MCP_CONFIG 路径继续使用，配置缺失/损坏/禁用时不会切换身份。生成和绑定分别验证，绑定失败保留文件，修复后重试。非 Windows 自动初始化明确停止；其它平台仍可显式提供私有配置或连接环境变量。

Windows 子进程不能改变已运行客户端的环境：初始化后，Agent 根据返回的 configPath 为当前验证命令设置 BOS_MCP_CONFIG，并读取已回写的用户级 BOS_MCP_URL / BOS_MANAGED_MCP_URL；之后重启客户端，使后续进程继承用户环境。用户补全凭据后运行 defaults 离线校验配置，并核对返回的 cuser、cgroup 已填写且不是 TODO；命令成功本身不证明身份完整。只有已有查询/连接验证授权才执行 check 或 query。不要回显完整配置。

## 公司地址更新与个人配置

维护者只修改 company-defaults.json 的无凭据 HTTPS 地址并按框架流程发布。已有使用者更新插件后再次运行 bos-init，自动刷新 BOS_MCP_URL；BOS_MANAGED_MCP_URL 记录上次框架设置的地址，仅当前值与其相同才允许覆盖，个人自定义地址保留。查询遇到框架管理的旧地址时使用当前插件默认值，不依赖重启才能取得新公司地址。更新操作不重写个人文件或凭据。

旧完整私有配置（url/headers，或 mcpServers 包装）继续兼容且优先，不与环境连接混用。需要显式迁移到标准目录时运行 `migrate-config <旧私有文件绝对路径>`：核对旧服务与公司默认一致，将 access_key 和 headers/身份转入新文件并绑定新路径，旧文件保留；新目标已存在时停止覆盖。旧文件仍由用户管理，不自动删除。

未指定私有文件时仍支持 BOS_MCP_URL + BOS_MCP_TOKEN；之前的仅身份文件也兼容环境连接。这些是兼容/自动化方式，不是普通用户首次接入流程。完整配置错误不回退。显式服务名由 BOS_MCP_SERVER 选择，默认 bos-demand-query。

人员优先级：调用参数 → BOS_CUSER → 文件 cuser；组优先级：显式 cgroup（含空字符串）→ BOS_CGROUP → 文件 cgroup。TODO 表示未填写；access_key/Token 未完成时停止连接，身份 TODO 阻止列表，按编号不要求身份。缺少所在组的待办查询停止；只有用户主动传 cgroup: "" 才视为跨组。sgroup 是另一个发起组筛选，不是个人所在组。

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
