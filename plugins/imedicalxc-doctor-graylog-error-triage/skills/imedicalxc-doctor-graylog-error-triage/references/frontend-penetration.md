# 前端穿透

作用：把报错里的请求 URL 映射到「哪个页面、哪个操作、哪个 JS 方法」。没有它，修正方案只能说到接口层。

## 两种模式

| 模式 | 条件 | 输出 |
|---|---|---|
| `codegraph` | `front_chain_db.json` 已构建 | html / element / jsMethod / jsLine |
| `heuristic` | 索引缺失或未命中 | 候选页面列表，**强制标注**「启发式匹配，未经前端索引确认」 |

当前配置 `frontend.mode = "codegraph"`，但 `penetrate-frontend.js` 的 codegraph 分支尚未实现，实际走 heuristic，报告里会如实标注。

## 慢请求簇天然无前端定位

慢请求日志由 `LogFilter` 打印，只有接口全限定名与耗时，**没有请求 URL**。穿透层按 `classifyClusterUrls` 判为 `no-http-request`，计入 `urlKinds` 后直接跳过，不写 `c.ui`。

所以摘要里慢请求簇不产生命中、报告里前端定位段为空，**这是正确结果，不是穿透失效**，不要去建索引试图改善。要还原是哪个界面触发的，只能按簇里的 traceId 回查全链路（`graylog_trace`），从同 trace 的浏览器请求 URL 反推页面；查不到就写「待穿透」，不编造。

## 构建索引

需用户授权，约 6 分钟、300MB：

```powershell
python .agents\plugins\imedicalxc-doctor-codegraph\scripts\scan_controller_endpoints.py
```

产物 `docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json` 已被 `docs/agents/.gitignore` 排除。

## 穿透失效的常见原因

1. 簇里堆栈没有 URL —— 纯后端定时任务、MQ 消费、SQL 异常常属此类；**慢请求簇全部属此类**（日志本身不含 URL）。无前端可定位，报告写「待穿透」，这是正常的。
2. 堆栈有 URL 但页面目录里找不到 —— `frontend.pageCatalog` 指向的 `src/frontend/README.md` 未覆盖该模块。
3. 索引过期 —— 前端新增页面后未重建。

## 判断值不值得构建索引

先看 `巡检总览` 的「前端穿透」行。若连续多轮命中 0 个本组簇，且本组簇本身就没有 URL，构建索引不会有改善。等出现带 URL 的本组报错再建。