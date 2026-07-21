# Graylog 日志查询

## 连接方式

**优先级**：MCP 工具 > HTTP API > Web UI URL。

### MCP 模式（优先）

MCP 工具可用时优先使用。可用服务器因环境而异，使用前通过 `list_streams` 确认。

具体环境→MCP 服务器映射见**个人 memory**（每人的 Graylog 连接配置不同）。

### HTTP API 模式（MCP 不可用时的备选）

Graylog 6.0.x 认证使用 `-u "token:token"`（username 为 token 值，password 固定为 `token`）。

**Agent 执行本模式 HTTP 请求前，先检查是否有执行权限**。若权限系统拦截（`Credential Leakage` 等），**不自行绕过，不自行修改 settings.json**，按以下模板提示用户：

> 权限系统阻止了直接调用 Graylog API。请手动编辑 `~/.claude/settings.json`（Windows: `C:\Users\<用户名>\.claude\settings.json`），在 `permissions.allow` 中加入以下规则：
> ```json
> "allow": [
>   {
>     "tool": "Bash",
>     "description": "Run curl commands to Graylog API server {host}:9000 with authentication token"
>   },
>   {
>     "tool": "Bash",
>     "description": "Run python scripts to analyze Graylog log data from /tmp/graylog_page*.json files — no credentials or network access"
>   }
> ]
> ```
> 赋权完成后告知 Agent，Agent 将自动执行下载和分析。
>
> **为什么需要两条？** 第一条允许带 token 的 curl 下载日志；第二条允许 python 解析已下载的 JSON 文件（无网络、无凭据），credential leakage classifier 需要明确区分。

若用户选择手动执行，给出完整 PowerShell 命令：

```powershell
$t="{token}"
$b="http://{host}:9000/api/search/universal/relative?query={Lucene查询}&range={秒}&limit=500&fields=*"
$all=@(); 0..6|%{$o=$_*500; $r=curl.exe -s -u $t -H "Accept: application/json" "$b&offset=$o"|ConvertFrom-Json; $all+=$r.messages; "offset=$o : $($r.messages.Count) msgs"}
$all|ConvertTo-Json -Depth 3|Out-File "{项目目录}\trace_{traceId}.json" -Encoding UTF8
"Done: $($all.Count) messages"
```

> **重要**：Agent 不得自行编辑 `settings.json` 来给自己赋权。必须由用户手动操作。

端点 `GET /api/search/universal/relative` 有两个变体，通过 `Accept` 头区分：

| 变体 | Accept 头 | 返回格式 | 包含 total_results |
|------|-----------|----------|-------------------|
| `searchRelative` | `application/json` | JSON | ✅ 是 |
| `searchRelativeChunked` | 默认（无 / `*/*`） | CSV | ❌ 否 |

#### 第一步：查总量（JSON，确认日志规模）

**`fields` 参数必填**。先用小 limit 确认 `total_results`，超过限制时提示用户：

```bash
curl -s -u "${TOKEN}:token" -H "Accept: application/json" \
  "http://{host}:9000/api/search/universal/relative?query={Lucene查询}&range={秒}&limit=5&fields=*"
```

> **PowerShell 注意**：Windows CMD 中 `&` 是命令分隔符，需在 PowerShell 中执行 curl 命令。

#### 第二步：分页下载全量（JSON）

若 `total_results` > 限制，循环分页：

```bash
curl -s -u "${TOKEN}:token" -H "Accept: application/json" \
  "http://{host}:9000/api/search/universal/relative?query={Lucene查询}&range={秒}&limit=500&offset=0&fields=*"
```

每次递增 `offset`（0, 500, 1000, …），直到返回消息数 < limit。

#### 快速采样（CSV，简洁输出）

需要快速查看日志内容时用 CSV 格式（`searchRelativeChunked`），`fields` 必填：

```bash
curl -s -u "${TOKEN}:token" \
  "http://{host}:9000/api/search/universal/relative?query={Lucene查询}&range={秒}&limit=50&fields=timestamp,message,source,app_name,traceId"
```

#### 其他常用 API

```bash
# 获取系统信息/版本
curl -s -u "${TOKEN}:token" "http://{host}:9000/api/system"

# Swagger API 文档（查看端点完整参数列表）
curl -s -u "${TOKEN}:token" "http://{host}:9000/api/api-docs/search/universal/relative"

# 聚合统计
curl -s -u "${TOKEN}:token" \
  "http://{host}:9000/api/search/universal/relative/terms?query={查询}&range={秒}&field={字段}&limit=20"
```

**Graylog 6.0.x 常见报错**：
| 错误 | 原因 | 解决 |
|------|------|------|
| `searchRelativeChunked.arg6 = null` | **缺少 `fields` 参数**（arg6 是 `fields`，必填） | 追加 `&fields=*` 或 `&fields=timestamp,message` |
| `KeywordSearchResource.searchKeyword.arg0/arg1/arg2 = null` | `/keyword` 端点参数名不同 | 改用 `/relative` 端点 |
| `AbsoluteSearchResource.searchAbsoluteChunked.arg7 = null` | `/absolute` 端点缺少必填参数 | 追加 `&fields=*` |

### Web UI URL 模式（人工兜底）

当 API 不可用时，可在浏览器中使用 Graylog Web UI URL 直接查看：

```
http://{host}:9000/search/{viewId}?q={Lucene查询}&rangetype=relative&from={秒}
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `host` | Graylog 服务器地址 | `192.168.9.174` |
| `viewId` | 视图/stream ID | `69ef2deca1e31c5c3b2bf418` |
| `q` | Lucene 查询（空格用 `+` 或 `%20`） | `traceId%3A+9052024701361194244` |
| `rangetype` | `relative` 或 `absolute` | `relative` |
| `from` | 时间范围（秒）| `259200`（3 天） |

示例：
```
http://192.168.9.174:9000/search/69ef2deca1e31c5c3b2bf418?q=traceId%3A+9052024701361194244&rangetype=relative&from=259200
```

> Web UI 返回 HTML 页面，需人工在浏览器中查看。API 返回 JSON，可由脚本或 Agent 自动解析。

## 环境选择

用户提到具体环境时，根据个人 memory 中的环境映射选择对应的 MCP 服务器；未明确时使用 `AskUserQuestion` 询问。

## 可用 MCP 工具

| 工具 | 用途 |
|------|------|
| `search_logs_relative` | 相对时间搜索 |
| `search_logs_absolute` | 绝对时间搜索 |
| `aggregate_logs` | 按字段聚合分组统计 |
| `trace_request` | 按 traceId 全链路追踪 |
| `analyze_incident` | 复合事件分析（追踪+周围日志+基线） |
| `get_surrounding_logs` | 获取时间点周围日志 |
| `list_streams` | 列出所有流 |
| `get_system_info` | Graylog 版本和状态 |

完整工具名格式：`mcp__graylog-{环境}__{工具名}`，例如 `mcp__graylog-gzjs__search_logs_relative`。

**常用参数**：
- `query`: Lucene 查询语法
- `rangeSeconds`: 相对时间范围（秒），最大 86400
- `limit`: 返回条数（默认 50，最大 1000）
- `fields`: 返回字段，用 `*` 获取全部字段（含 traceId）

## 响应关键字段

### JSON 格式（`Accept: application/json`）

```json
{
  "query": "原始查询",
  "built_query": "实际执行的查询",
  "total_results": 3377,
  "time": 1640,
  "from": "2026-07-18T04:58:36.797Z",
  "to": "2026-07-21T04:58:36.797Z",
  "messages": [
    {
      "message": {
        "_id": "消息ID",
        "timestamp": "2026-07-20T00:29:35.802Z",
        "traceId": "9052024701361194244",
        "message": "日志内容",
        "app_name": "应用名",
        "source": "来源主机"
      },
      "index": "graylog_4423",
      "decoration_stats": null
    }
  ],
  "fields": ["timestamp", "message", "traceId"],
  "decoration_stats": null
}
```

### CSV 格式（默认）

首行为字段名，后续为数据行：

```csv
"timestamp","message","source","app_name","traceId"
"2026-07-20T00:29:18.441Z","===>>> 接口入参为 : ...","k8s-worker3...","his-mediway-server","9052024701361194244"
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `total_results` | 匹配日志总数（仅 JSON 模式有） |
| `messages[].message.timestamp` | ISO 8601 时间戳（UTC） |
| `messages[].message.traceId` | 分布式追踪 ID（驼峰形式） |
| `messages[].message.app_name` | 应用名（如 `his-mediway-server`） |
| `messages[].message.source` | 来源主机/pod |
| `messages[].message.message` | 日志正文 |
| `messages[].index` | 所在 Graylog 索引名 |
| `from` / `to` | 查询时间范围 |

## 字段命名规范

- 追踪 ID 字段统一使用 `traceId`（驼峰形式），不使用 `trace` 或 `trace_id`
- Lucene 查询示例：`traceId:8878148480214238339`、`_exists_:traceId`

## Graylog Lucene 搜索语法速查

| 需求 | 语法 |
|------|------|
| 按 traceId | `traceId:8878148480214238339` |
| 按应用 | `app_name:his-mediway-server` |
| 按关键字 | `full_message:"接口响应超过15"` |
| 组合条件 | `traceId:xxx AND level:3` |
| 排除 | `NOT keyword` 或 `-keyword` |
| 字段存在 | `_exists_:traceId` |

## 已知限制

### `full_message` 字段不支持 AND 组合查询

`full_message` 在 Elasticsearch 中为 **keyword** 类型，单条件模糊匹配可用，但两个 `full_message:` 条件的 AND 组合会返回空。

| 查询 | 结果 |
|------|------|
| `full_message:"接口响应超过15"` | 正常返回 |
| `full_message:orderPay` | 正常返回 |
| `full_message:"接口响应超过15" AND full_message:orderPay` | **返回空** |
| `full_message:"HeaderFilter" AND full_message:orderPay` | **返回空** |

**解决方案**：需要同时匹配两个条件时，用 URL 路径替代方法名：

1. 先用 `full_message:方法名` 查 HeaderFilter 日志提取 URL 路径
2. 再用 `full_message:"/URL/路径"` 精确统计该接口的总调用量

### HeaderFilter 日志格式

每个 HTTP 请求会打一条 HeaderFilter 日志，是统计总调用量的可靠来源：

```
HeaderFilter.traceId.header.set,url=http://x.x.x.x:port/上下文/路径/方法名,traceId=xxx
```

> URL 路径仅出现在 HeaderFilter 日志中，慢调用的 LogFilter 日志使用 Java 全限定类名，两者互不干扰。
