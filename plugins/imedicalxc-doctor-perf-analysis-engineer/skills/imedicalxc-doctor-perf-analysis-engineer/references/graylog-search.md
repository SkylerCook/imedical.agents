# Graylog 日志查询

## 连接方式

**优先级**：只读 MCP 工具 > 经用户明确授权的只读 HTTP API > 用户手动打开 Web UI URL。

### MCP 模式（优先）

MCP 工具可用时优先使用。可用服务器因环境而异，使用前通过 `list_streams` 确认。

具体环境与连接配置只允许保存在用户或目标项目的私有配置中，不得写入本插件。

### HTTP API 模式（MCP 不可用时的备选）

使用 HTTP API 前必须同时满足：

1. 用户已明确确认 Graylog 目标环境和只读查询范围；
2. 凭据来自用户现有的安全存储或临时环境变量，不写入仓库、报告、脚本文件或对话；
3. 当前运行器已允许该只读网络请求；若被拦截，只说明拟执行的目标、方法和数据范围并请求授权，不自行编辑任何运行器配置。

用户选择手动执行时，可提供以下 PowerShell 模板。用户应在本地预先设置临时环境变量 `GRAYLOG_ACCESS_TOKEN`，不要把真实 token 粘贴到对话中：

```powershell
$graylogBaseUrl = "https://{graylog-host}"
$query = [Uri]::EscapeDataString("traceId:{trace-id}")
$pageSize = 500
$offset = 0
$allMessages = @()

do {
  $uri = "$graylogBaseUrl/api/search/universal/relative?query=$query&range={seconds}&limit=$pageSize&offset=$offset&fields=*"
  $response = curl.exe -sS -u "$($env:GRAYLOG_ACCESS_TOKEN):token" -H "Accept: application/json" $uri | ConvertFrom-Json
  $page = @($response.messages)
  $allMessages += $page
  $offset += $page.Count
} while ($page.Count -eq $pageSize -and $offset -lt [int]$response.total_results)

$allMessages | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "trace_{trace-id}.json" -Encoding UTF8
"Done: $($allMessages.Count) messages"
```

> Agent 执行 HTTP 请求时也必须遵守同一授权和凭据边界，不得把命令中的环境变量展开值回显到日志或回复。

端点 `GET /api/search/universal/relative` 有两个变体，通过 `Accept` 头区分：

| 变体 | Accept 头 | 返回格式 | 包含 total_results |
|------|-----------|----------|-------------------|
| `searchRelative` | `application/json` | JSON | ✅ 是 |
| `searchRelativeChunked` | 默认（无 / `*/*`） | CSV | ❌ 否 |

#### 第一步：查总量（JSON，确认日志规模）

**`fields` 参数必填**。先用小 limit 确认 `total_results`，超过限制时提示用户：

```powershell
$query = [Uri]::EscapeDataString("{Lucene query}")
curl.exe -sS -u "$($env:GRAYLOG_ACCESS_TOKEN):token" -H "Accept: application/json" `
  "https://{graylog-host}/api/search/universal/relative?query=$query&range={seconds}&limit=5&fields=*"
```

> **PowerShell 注意**：Windows CMD 中 `&` 是命令分隔符，需在 PowerShell 中执行 curl 命令。

#### 第二步：分页下载全量（JSON）

若 `total_results` > 限制，循环分页：

```powershell
curl.exe -sS -u "$($env:GRAYLOG_ACCESS_TOKEN):token" -H "Accept: application/json" `
  "https://{graylog-host}/api/search/universal/relative?query=$query&range={seconds}&limit=500&offset=0&fields=*"
```

每次递增 `offset`（0, 500, 1000, …），直到返回消息数 < limit。

#### 快速采样（CSV，简洁输出）

需要快速查看日志内容时用 CSV 格式（`searchRelativeChunked`），`fields` 必填：

```powershell
curl.exe -sS -u "$($env:GRAYLOG_ACCESS_TOKEN):token" `
  "https://{graylog-host}/api/search/universal/relative?query=$query&range={seconds}&limit=50&fields=timestamp,message,source,app_name,traceId"
```

#### 其他常用 API

```powershell
# 获取系统信息/版本
curl.exe -sS -u "$($env:GRAYLOG_ACCESS_TOKEN):token" "https://{graylog-host}/api/system"

# Swagger API 文档（查看端点完整参数列表）
curl.exe -sS -u "$($env:GRAYLOG_ACCESS_TOKEN):token" "https://{graylog-host}/api/api-docs/search/universal/relative"

# 聚合统计
curl.exe -sS -u "$($env:GRAYLOG_ACCESS_TOKEN):token" `
  "https://{graylog-host}/api/search/universal/relative/terms?query=$query&range={seconds}&field={field}&limit=20"
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
https://{graylog-host}/search/{view-id}?q={url-encoded-query}&rangetype=relative&from={seconds}
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `graylog-host` | 用户私有配置中的 Graylog 地址 | `{graylog-host}` |
| `view-id` | 用户私有配置中的视图/stream ID | `{view-id}` |
| `q` | URL 编码后的 Lucene 查询 | `traceId%3A%7Btrace-id%7D` |
| `rangetype` | `relative` 或 `absolute` | `relative` |
| `from` | 时间范围（秒）| `259200`（3 天） |

示例：
`https://{graylog-host}/search/{view-id}?q=traceId%3A%7Btrace-id%7D&rangetype=relative&from=259200`

> Web UI 返回 HTML 页面，需人工在浏览器中查看。API 返回 JSON，可由脚本或 Agent 自动解析。

## 环境选择

用户提到具体环境时，根据用户或目标项目的私有配置选择对应 MCP 服务器；未明确时直接向用户确认，不推测连接信息。

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

工具名由当前运行器暴露的 MCP server 决定；按能力名选择 `search_logs_relative`、`trace_request` 等只读操作，不在 canonical 文档中写死环境后缀。

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
  "total_results": 12,
  "time": 120,
  "from": "2026-01-01T00:00:00.000Z",
  "to": "2026-01-01T00:05:00.000Z",
  "messages": [
    {
      "message": {
        "_id": "{message-id}",
        "timestamp": "2026-01-01T00:00:01.000Z",
        "traceId": "{trace-id}",
        "message": "{log-message}",
        "app_name": "{app-name}",
        "source": "{source}"
      },
      "index": "{index-name}",
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
"2026-01-01T00:00:01.000Z","{log-message}","{source}","{app-name}","{trace-id}"
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `total_results` | 匹配日志总数（仅 JSON 模式有） |
| `messages[].message.timestamp` | ISO 8601 时间戳（UTC） |
| `messages[].message.traceId` | 分布式追踪 ID（驼峰形式） |
| `messages[].message.app_name` | 应用名 |
| `messages[].message.source` | 来源主机/pod |
| `messages[].message.message` | 日志正文 |
| `messages[].index` | 所在 Graylog 索引名 |
| `from` / `to` | 查询时间范围 |

## 字段命名规范

- 追踪 ID 字段统一使用 `traceId`（驼峰形式），不使用 `trace` 或 `trace_id`
- Lucene 查询示例：`traceId:{trace-id}`、`_exists_:traceId`

## Graylog Lucene 搜索语法速查

| 需求 | 语法 |
|------|------|
| 按 traceId | `traceId:{trace-id}` |
| 按应用 | `app_name:{app-name}` |
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
