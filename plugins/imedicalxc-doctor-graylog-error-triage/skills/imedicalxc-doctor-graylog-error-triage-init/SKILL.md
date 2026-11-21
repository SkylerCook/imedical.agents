---
name: imedicalxc-doctor-graylog-error-triage-init
description: |
  Graylog 报错与慢请求巡检插件的首次接入向导。完成连接注册预检、推送配置、前端索引授权、插件注册与薄索引生成、Qoder 自动任务（采集轮 + 分析轮）创建与首轮验证。用于「接入报错巡检」「配置 Graylog 巡检」「建巡检自动任务」。
---

# 初始化：Graylog 报错与慢请求巡检

按顺序执行 8 步。每步先核实事实再动作，缺前置就停下报告，不跳步、不猜。

## 步骤 1：确认工作区与插件状态

1. 读 `AGENTS.md`（父仓库）确认代码位置与搜索约束。
2. 读 `.agents/config/plugin_profile.md`，确认本插件行是否存在及状态。
3. 核实插件目录与必需文件是否落盘：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\verify-install.js
```

输出里 `插件文件完整性` 若显示缺失，按提示的批次补齐；有 FAIL 先补齐文件，不要继续。

## 步骤 2：运行时前置

- Node.js 18+（`node -v`）；脚本使用 `node:` 内置模块与 `Intl`。
- Python 3.8+（`python --version`）仅前端穿透需要，可后置。
- 确认 `mcp-graylog/index.js` 含 `graylog_search_absolute`、`graylog_trace`、offset 分页；缺失则先应用 MCP 扩展。

## 步骤 3：注册 Graylog 连接（阻塞项）

连接信息单一事实源是 IDE 的 mcp.json，默认路径 `<userHome>/.qoder-cn/shared_client/mcp.json`，可用 `QODER_MCP_CONFIG` 或 `--mcp-config` 覆盖。

1. 读取该文件，检查 `mcpServers["graylog-87"]` 是否存在。
2. 若为空，向用户给出注册片段，**由用户填写真实地址与只读 token**，Agent 不写入凭据：

```json
{
  "mcpServers": {
    "graylog-87": {
      "command": "node",
      "args": ["<仓库绝对路径>/mcp-graylog/index.js"],
      "env": {
        "GRAYLOG_URL": "<87环境Graylog地址>",
        "GRAYLOG_TOKEN": "<只读token>"
      }
    }
  }
}
```

3. 不要依赖 `index.js` 里的硬编码默认地址；必须显式配置。`args` 必须是本机绝对路径。
4. 预检（不取数、不回显凭据）：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\collect-errors.js --env 87 --check
```

期望 `status: ready`。`missing-config` / `missing-credentials` / `ambiguous` 均须先解决。

## 步骤 4：推送配置与令牌

本步可跳过。不配置时每轮输出一条 `[WARN] 推送未配置`，不影响采集、分类与报告产出。

1. 复制 `config/graylog-triage-push.template.json` → `config/graylog-triage-push.json`（不入库）。
2. 配置环境变量 `GRAYLOG_TRIAGE_QQBOT_TOKEN`（shell 用户级永久变量，或 `.qoder/settings.local.json` 的 `graylogTriage.env`）。Qoder 自动任务同样是独立进程，会话级变量读不到。
3. 群号默认 925219048，与周报同群；改群只改 push.json。
4. 演练：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\push-notify.js --env 87 --dry-run
```

## 步骤 5：前端索引（需用户授权）

构建约 6 分钟、占用约 300MB，产物已被 `docs/agents/.gitignore` 排除。

```powershell
python .agents\plugins\imedicalxc-doctor-codegraph\scripts\scan_controller_endpoints.py
cd .agents\plugins\imedicalxc-doctor-codegraph\scripts\front
python html_scan.py
python js_scan.py
python build_front_chain_db.py
```

未授权或未构建时，穿透降级为 heuristic，报告强制标注「启发式匹配，未经前端索引确认」。

**先说清当前实现状态再申请授权**：`penetrate-frontend.js` 的 `effectiveMode` 硬编码为 `heuristic`，codegraph 分支尚未实现，所以建好索引也**不会**升级到按钮级，只会把 `degradeReason` 从 `index-missing` 变成 `codegraph-index-present-but-codegraph-mode-not-enabled`。慢请求簇日志里没有 URL，一律计入 `no-http-request` 被跳过，**建索引对慢请求没有任何改善**。只有报错簇带浏览器 URL 且摘要显示 `index-missing` 时，这次构建才值得申请。

## 步骤 6：插件注册与薄索引

```powershell
Copy-Item .agents\config\plugin_profile.md .agents\config\plugin_profile.md.bak
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\update-plugin-profile.ps1 -Plugin imedicalxc-doctor-graylog-error-triage -Status available
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\generate-plugin-thin-index.ps1 -PluginPath .agents\plugins\imedicalxc-doctor-graylog-error-triage -ProjectRoot . -Mode DryRun
```

预演无 conflict 后写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\generate-plugin-thin-index.ps1 -PluginPath .agents\plugins\imedicalxc-doctor-graylog-error-triage -ProjectRoot . -Mode Write
```

复验（应全部 unchanged / skipped / missing）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\generate-plugin-thin-index.ps1 -PluginPath .agents\plugins\imedicalxc-doctor-graylog-error-triage -ProjectRoot . -Mode DryRun
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\update-plugin-profile.ps1 -Plugin imedicalxc-doctor-graylog-error-triage -Status enabled
```

出现 `thin-index-conflict` 停止报告，不得用 `-Force` 绕过所有权校验。注册后核对 profile 差异，只应新增本插件行。

## 步骤 7：首轮手动验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\run-triage.ps1 -Env 87 -SkipNotify
```

检查：退出码 0；`docs/agent-reports/graylog-triage/87/<日期>/` 出现 raw / classified / report-summary / report-self 文档；`config/graylog-triage-state-87.json` 的 cursor 已推进。

还要确认**两路采集都跑了**：日志里同时有 `报错命中 N 条` 与 `慢请求（>=15s）命中 N 条…达标 N 条`，汇总报告有 P0/P1 分布。慢请求达标 0 条可以是正常结果（该窗口确实没有超 15 秒的接口），但整路计数缺失说明 `query.slowSelector` 被清空或解析失败，须先排查。阈值按解析出的毫秒数判，日志文案分档最高只到「15秒」且是「超过」语义，不能靠文案确认。

## 步骤 8：创建 Qoder 自动任务（需用户明确授权）

调度主体是 Qoder 自动化（`qoder_cron`），**不注册 Windows 计划任务**。用户明确说「建自动任务」后，用 `add` 创建两个：

| 项 | 采集轮 | 分析轮 |
|---|---|---|
| 名称 | `医生站 Graylog 报错采集轮（87）` | `医生站 Graylog 报错分析轮（87）` |
| cron（Asia/Shanghai） | `0,15,30,45 * * * *` | `7,37 * * * *` |
| 权限 | **Full Access**（`executionAuthorization: true`） | Auto Approval（`false`） |
| outputMode | `merged` | `merged` |
| cwd | 仓库根目录 | 仓库根目录 |

采集轮 prompt 保持极窄形态：只跑 `run-triage.ps1 -Env 87` 一条命令 + 按退出码（0/1/2/3）回报 + 禁止清单（禁单阶段脚本、禁改配置与脚本、禁 git、禁根因分析、禁动任何调度、禁配令牌或外发）。**必须 Full Access**：Auto Approval 会把 `powershell -ExecutionPolicy Bypass` 拦下，表现为状态 `succeeded` 但流水线一步没跑。

分析轮 prompt 指向主 skill，取材范围是 `config/pending-queue.json` **全量候选**（`pending` + `lastSeen` 前进的 `blocked`，每轮上限 4 条簇，**P0 先于 P1**），不是只看最新一轮报告。队列条目带采集轮打好的 **`origin` 来源标志**（`self` / `self-calls-external` / `external` / `infra` / `unknown`），分析轮据此定责任侧而不是重新猜：`self` 出本组根因与修正方案；`self-calls-external`（本组调用他组失败的跨组报错）只写被调方 + 原始错误 + 本组容错，不写成需要本组改码的缺陷。职责：读报告→报错按来源定根因 / 慢请求按接口全限定名定归属并按 traceId 追全链路做耗时归因→回填 `pending-queue.json`（可用 `analysis.severity` 改判，但必须写 `severityReason`）→按受影响轮次重渲染→整理 `analysis-outbox-<HHmm>.md`。允许只读 Graylog traceId 查询（区别于被禁的 `collect-errors.js` 取数）。禁采集、禁 `push-notify.js`、禁任何外发、禁创建或改动任何调度任务（含自身）。无产物或无新增时提前退出，不补采集。

创建后用 `run` 各触发一次验证，**只看客观证据**：日志 `config/logs/triage-<yyyyMMdd>-87.log` 的 mtime 推进且末尾有 `[SUMMARY]`、当日产物落盘、state cursor 推进；分析轮看 `pending-queue.json` 是否新增 `analyzed`。`lastRunStatus: succeeded` 不作为判据。

两个任务都依赖 Qoder 客户端在线，退出期间不触发，重启后水位线补齐窗口。

### 可选回退：OS 计划任务

只有用户明确要求「客户端退出期间也采集」时才走这条路，且**必须先 `disable` Qoder 采集轮**避免双调度：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\install-schedule.ps1 -Env 87 -DryRun
```

确认 `Repeat: 无限期`、`Principal` 为当前用户、触发间隔与 `config.schedule.intervalMinutes` 一致（当前 15 分钟，OS 路径只认这个值）后去掉 `-DryRun` 执行，然后：

```powershell
Start-ScheduledTask -TaskName "iMedicalxc-GraylogTriage-87"
```

```powershell
Get-ScheduledTaskInfo -TaskName "iMedicalxc-GraylogTriage-87" | Select-Object LastRunTime, LastTaskResult, NextRunTime
```

`LastTaskResult`：`0` 正常、`267009` 运行中、`1` 脚本失败、`2` 连接不可用、`3` 上一轮仍在执行（正常跳过）。

任务只在用户登录期间运行，不存储密码；需要未登录也运行时加 `-UseS4U`。**`-Force` 不能覆盖同名任务**（`Register-ScheduledTask` 仍抛 `0x800700b7`），覆盖走 `-Uninstall` 再注册。

## 完成判据

`node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\verify-install.js --strict` 全 PASS，且首轮手动巡检退出码 0。真实验收按主 skill 与 `references/acceptance-checklist.md` 的 L7 连续 3 轮执行。