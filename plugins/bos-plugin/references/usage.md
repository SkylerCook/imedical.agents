# 使用与配置

## 本机配置

不提供隐式配置文件路径。使用 BOS_MCP_CONFIG 指定用户选定的仓外私有配置，或提供连接环境变量。跨项目复用建议使用绝对路径；显式相对路径按进程当前目录解析，不按脚本位置解析。配置文件由脚本读取，不作为 Agent 的参考正文加载。

连接优先级：BOS_MCP_CONFIG 指定文件 → BOS_MCP_URL 与 BOS_MCP_TOKEN 环境变量；两者均缺失时报错。显式配置错误时停止，不回退到另一身份。支持顶层 url、headers、enabled、cuser、cgroup；也兼容既有 mcpServers 包装，服务名默认 bos-demand-query，可由 BOS_MCP_SERVER 指定。个人身份优先级：调用参数 cuser → BOS_CUSER → 配置 cuser。当前组优先级：显式 cgroup（包括空字符串）→ BOS_CGROUP → 配置 cgroup；显式空字符串表示全部组。配置中不设默认组时脚本不限制组，常用当前组待办须先确认组。

headers 中的 X-Gateway-Upstream-BOS-MCP-TOKEN 用于个人鉴权，URL 可含网关鉴权参数；实例文件必须先确认 Git 忽略且未被跟踪，再保存凭据。不提供可填真实凭据的共享模板。

## 命令

从已加载技能的真实目录解析 ../../scripts/bos-demand-query.js 的绝对路径：

- defaults：只读取默认 cuser、cgroup，不联网，不输出 URL、headers 或 Token。
- check：SSE 握手与查询工具发现，不取需求数据。
- query '{"id":"12345"}'：精确编号查询。
- query '{"date":"2026-01-01","date2":"2026-01-02"}'：以默认当前人、默认当前组查询指定创建日期范围。项目来源另传 source: "项目"，跨组另传 cgroup: ""。
- query '{"date":"2026-01-01","date2":"2026-01-02","sgroup":"测试"}'：默认当前人、当前组下，筛选发起组为“测试”的需求；需要项目来源时同时传 source: "项目"。sgroup 省略或传空字符串不限制发起组，不改变 cgroup；多选组的上游语法尚未验证，不猜分隔符。
- serve：可选 stdio MCP，暴露 bos_demand_query；不需要原生工具注册时直接由 skill 调用 CLI。

可选字段：title、content、source、status、type、cuser、cgroup、sgroup、datetype、date、date2、product、mod。datetype 可为创建时间、预计完成时间、执行时间、分配时间或操作时间。id 有值时清空其它筛选条件。日期端点包含规则和服务端总量限制尚未确认。

如需原生 MCP 工具，可在目标客户端用户级配置中注册 node + 本脚本绝对路径 + serve；无需每项目配置。本 skill 不自动改宿主 MCP 设置，也不认为文件链接成功等于宿主已加载。

## 待办筛选与核对

待办状态暂用排除法：排除「完成、取消、已拆分」，其余保留原状态。遇到此前未核对的状态或页面数量不符时标为待确认并定向核对，不悄悄丢弃，也不据此宣称已精确复现页面服务端规则。明确查询某个状态时使用 status，不额外套用待办过滤。接口不暴露“待办”布尔条件；不要猜测 status 的多值分隔语法。

对照网页时核对当前人、当前组、来源、日期、排序以及每页需求号；跨页去重后与页脚总数比较。页面默认无日期限制，上述宽日期范围不等于已证明接口无截断。数量变化先检查实时状态或归属变化，不把所有差异归因于状态规则。

待办口径需按实际账号和页面重新核对，不把历史样本数量作为完整性保证。详情中的描述 HTML 可含图片；附件链接和元数据不等于已经读取文件。

## 实现与验证

按 [MCP 2024-11-05](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports) 实现有限 stdio / HTTP+SSE 子集，无 npm 依赖；未复制上游 SDK 源码。仅支持该协议版本，不是任意 MCP 代理，不支持 OAuth 或 Streamable HTTP。SSE endpoint 限同源，禁重定向，30 秒超时，结束关闭连接，错误输出不含原始连接信息。

返回值在序列化前按字符串值脱敏，并解析 MCP 文本中的 JSON 处理转义凭据；未命中时保留原文格式。脱敏对象为完整连接 URL、Authorization / Proxy-Authorization / Cookie、以 token / key / secret / password / passwd 结尾的分段 header，以及 URL 的 access_key / api_key / mcp_key / auth_key / key / access_token / auth_token / token / secret / password / passwd / authorization / auth 参数（不区分大小写，兼容连字符与无分隔形式）。普通 URL 参数和 header 不作为凭据替换；自定义鉴权字段不在此识别范围内时，需补充识别与回归测试。

迁移来源曾在 Windows / Node 24 验证握手、工具发现、编号及当前人日期查询；这些历史证据不等于框架版本或其它宿主已验收。tests/bos-demand-query.tests.js 用合成数据覆盖参数、传输和 stdio。一个标题样本上游返回错误，无标题对照成功，根因未确认。其它平台、Node 22 和真实宿主发现需分别验证；CI 配置不是通过证据。
