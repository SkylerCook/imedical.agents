# AGENTS.md — graylog-toolkit

Graylog 巡检的**可复用基础库 + 薄 CLI**。本插件不产出巡检报告，只提供查询、解析、归属/处置判定、日志语句定位四类能力，供其他插件以 `require` 或 CLI 方式复用。

## 何时使用

- 其他智能体插件需要读取 Graylog 的 ERROR / 慢请求日志（两路并集、分页、ES 窗口切片）。
- 需要把原始日志条目归一化成带 `errorHash` 的簇，并判定归属（本组/基础设施/他组/无关/待定）、来源、处置分类与 P0/P1。
- 需要按 `logger_name` + 日志文案反查 `log.*` 源码位置。

## 硬约束

1. **只读 Graylog**；连接信息只从 IDE mcp.json 或 `GRAYLOG_<ENV>_URL/_TOKEN/_COOKIE` 读取，不复制、不落盘、不回显。
2. 规则数据（组映射、异常类清单、关键词、忽略项）必须放配置；代码里只允许兜底默认值。新增项目差异走配置，不改库代码。
3. 水位线、去重状态、报告渲染、通知推送属于消费方职责，不得塞进本库。
4. 日志语句定位是**文案匹配**，不是堆栈证据；消费方渲染时必须标注口径，命中基础设施仓或代码级别不一致时必须提示。
5. 归属判定不得猜前缀：解析不出组名归 `unknown`，由消费方标「待定」。

## 入口

- 库：`lib/index.js`（聚合）或按需 `lib/graylog-client.js`、`lib/classify.js`、`lib/log-site-locate.js`。
- CLI：`bin/graylog-toolkit.js`，子命令 `validate-config` / `collect` / `classify` / `locate`。
- 配置：`config/schema.json`，样例 `config/example.config.json`。

## 消费方

- `imedicalxc-doctor-graylog-error-triage`：通过 `scripts/lib/*` 薄转发与 `scripts/config-env.js` 注入 `repoRoot` / 缓存目录，行为与抽取前逐字节一致（同一份 classified 产物校验通过）。
