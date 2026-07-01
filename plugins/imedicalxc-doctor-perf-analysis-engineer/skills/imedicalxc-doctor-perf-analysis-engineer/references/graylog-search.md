# Graylog 日志查询（MCP 模式）

## 连接方式

**仅使用 MCP 工具**，不直接调用 HTTP API。

可用的 Graylog MCP 服务器因环境而异，使用前通过 `list_streams` 确认可用环境。

具体环境→MCP 服务器映射见**个人 memory**（每人的 Graylog 连接配置不同）。

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

- `total_results`: 匹配总数
- `messages[].timestamp`: ISO 8601 时间戳（UTC）
- `messages[].traceId`: 分布式追踪 ID
- `messages[].source`: 来源主机/pod
- `messages[].app_name`: 应用名
- `messages[].full_message`: 完整格式化日志行
- `messages[].level_name`: 日志级别

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
