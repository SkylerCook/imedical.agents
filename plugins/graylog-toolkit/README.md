# graylog-toolkit

可复用的 Graylog 巡检工具链：**查询客户端 + 日志解析 + 归属/处置规则引擎 + 薄 CLI**。零第三方依赖，Node >= 18，CommonJS。

本插件不产生报告、不推送、不维护水位线与去重状态——这些属于消费方（如 `imedicalxc-doctor-graylog-error-triage`）。本插件只回答四个问题：

1. 怎么从 Graylog 取回 ERROR 与慢请求两路日志；
2. 怎么把原始日志解析成带 `errorHash` 的条目与簇；
3. 每条/每簇归谁（本组 / 基础设施 / 他组 / 无关 / 待定）、来源与处置分类、严重度；
4. 无堆栈簇的 `log.error` 语句在源码哪一行。

## 目录

| 路径 | 职责 |
|---|---|
| `lib/config.js` | 环境变量与 IDE mcp.json 连接解析；`createContext({ repoRoot, settingsPath })` 注入工程路径 |
| `lib/graylog-client.js` | Views / legacy 两种搜索、异步轮询、分页、ES 10000 窗口切片、ERROR+慢请求两路并集、traceId 邻域、水位线窗口计算 |
| `lib/log-parse.js` | 堆栈/慢请求解析、`errorHash` 簇键、URL 抽取、`source_*` 归一化 |
| `lib/items.js` | 脱敏、截断、`buildItem`、去重状态清理、原始文件清理 |
| `lib/owner-index.js` | 归属索引：配置声明 ∪ 工作区源码扫描，`classify(item) → ownerKind/ownerGroup/origin/证据等级` |
| `lib/classify.js` | 规则引擎：聚簇、处置分类、严重度、分桶（`groupClusters`），规则全部来自配置 |
| `lib/log-site-locate.js` | 按 `logger_name` + 文案反查源码 `log.*` 语句（缓存可关） |
| `bin/graylog-toolkit.js` | 薄 CLI（JSON 输入输出） |
| `config/schema.json` | 配置 schema；`config/example.config.json` 为可跑样例 |

## 作为库使用

```js
const path = require('node:path');
const toolkit = require('<repo>/.agents/plugins/graylog-toolkit');

const ctx = toolkit.config.createContext({ repoRoot: process.cwd() });
const conn = toolkit.config.resolveConnection(ctx, cfg, 'prod');
const window = { from: new Date(from), to: new Date(to) };
const result = await toolkit.client.fetchWindow(conn, cfg.environments.prod, cfg, window);

const items = result.messages.map((m) => toolkit.items.buildItem(m, cfg));
const index = toolkit.ownerIndex.buildIndex(cfg, { repoRoot: ctx.repoRoot });
const clusters = toolkit.classify.buildClusters(items, index, cfg);
const groups = toolkit.classify.groupClusters(clusters, cfg);
const sites = toolkit.logSiteLocate.locateLogSites(cfg, appOnlyClusters, { repoRoot: ctx.repoRoot });
```

规则数据全部来自配置（`ownerGroups` / `severity` / `disposition` / `classify`），代码里只有兜底默认值。换系统复用时只改配置，不改代码。

## 作为 CLI 使用

```bash
node bin/graylog-toolkit.js validate-config --config config/example.config.json
node bin/graylog-toolkit.js collect  --config cfg.json --env prod --from 2026-11-22T00:00:00Z --to 2026-11-22T01:00:00Z --out raw.json
node bin/graylog-toolkit.js classify --config cfg.json --raw raw.json --out classified.json --repo-root /path/to/repo
node bin/graylog-toolkit.js locate   --config cfg.json --classified classified.json --raw raw.json --out sites.json
```

- `collect` 不维护水位线，一次调用一个窗口；水位线/去重/报告渲染由消费方负责。
- `classify` 输出 `{ stats, groups: { self, infra, external, unrelated, unknown }, clusters }`。
- `locate` 输出 `{ <errorHash>: { file, line, level, scope, loggerScoped, ambiguous, alternatives } }`。
- 退出码：0 成功 / 1 失败 / 2 配置或连接不可用。

## 配置

只写**环境变量名**，真实连接值由 IDE mcp.json 或进程环境提供，本插件不落盘凭据。字段说明见 `config/schema.json`；归属相关关键项：

- `ownerGroups.self.repos`：本组源码仓库（相对 `repoRoot`），用于扫描真实模块前缀与日志语句；
- `ownerGroups.self.packagePrefixTemplate` / `urlPrefixTemplate` / `appKeywords`：模块包与进程识别；
- `ownerGroups.infra.repos|packagePrefixes|loggerPrefixes`：基础设施公共仓；
- `ownerGroups.external.appGroups|packagePrefixes|loggerPrefixes`：他组映射（app 名关键字、包前缀、logger 缩写）。

## 安全边界

- Graylog 只读；不执行任何写操作。
- 输出中的 token、密码、Cookie 等由 `items.maskSecrets` 打码；日志语句定位只读本地源码。
- 只读 IDE mcp.json / 进程环境，不回显连接信息。

## 已知边界

- 日志语句定位是**文案匹配**，不是堆栈证据；命中基础设施仓或代码级别与采集侧不一致时，消费方必须在报告里标注。
- 归属扫描依赖本地仓库可读；仓库缺失时退化为配置声明的前缀，不会猜前缀。
- legacy 搜索仅 Graylog 3.x/4.x；配错时自动降级 views 并告警。
