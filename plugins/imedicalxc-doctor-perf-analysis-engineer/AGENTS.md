# iMedicalXC Doctor Performance Analysis Engineer

`imedicalxc-doctor-perf-analysis-engineer` 是 HIS 医生站接口性能分析与优化插件，覆盖前后端全链路追踪、N+1/批量调用优化、Graylog 日志分析和报告输出。

## 插件定位

- 只承载医生站接口性能分析的领域知识和可复用流程。
- 不保存服务器地址、namespace、账号、密码、token、远程路径或任何敏感连接信息。
- 性能数据必须从日志（Graylog MCP）提取，不得硬编码。

## 使用约束

- 不在插件中硬编码服务器地址、namespace、账号、密码、token、远程路径。
- Graylog 日志查询仅通过 `mcp__graylog__*` MCP 工具，禁止 curl/http。
- 分析前必须读取当前代码确认问题仍存在，禁止凭旧报告复述。
- 默认只输出 Markdown 分析报告，代码修改必须由用户确认后执行。
- 报告输出目录由用户在分析时指定，默认输出到当前项目目录。

## Skill 路由

- 首次初始化：`skills/imedicalxc-doctor-perf-analysis-engineer-init/SKILL.md`
- 性能分析主入口：`skills/imedicalxc-doctor-perf-analysis-engineer/SKILL.md`
- 诊断工作流：`skills/imedicalxc-doctor-perf-analysis-engineer/references/diagnosis-workflow.md`
- 后端优化指南：`skills/imedicalxc-doctor-perf-analysis-engineer/references/optimization-guide.md`
- 前端优化指南：`skills/imedicalxc-doctor-perf-analysis-engineer/references/frontend-optimization-guide.md`
- Graylog 搜索：`skills/imedicalxc-doctor-perf-analysis-engineer/references/graylog-search.md`
- 报告模板：`skills/imedicalxc-doctor-perf-analysis-engineer/references/report-template.md`
- 产品组归属：`skills/imedicalxc-doctor-perf-analysis-engineer/references/application-mapping.md`

`imedicalxc-doctor-perf-analysis-engineer-init` 是 bootstrap skill。首次接入目标工程时应直接读取插件真实路径 `.agents/plugins/imedicalxc-doctor-perf-analysis-engineer/skills/imedicalxc-doctor-perf-analysis-engineer-init/SKILL.md`，不要依赖安装后才会生成的 thin-index。

## Thin-Index 暴露范围

本插件的 `scripts/generate-plugin-thin-index.ps1` 是根 canonical thin-index 脚本的 wrapper。默认只暴露 `imedicalxc-doctor-perf-analysis-engineer` 主编排器入口；`imedicalxc-doctor-perf-analysis-engineer-init` 和所有子 reference 文件由主编排器按需读取，不单独生成浅层 skill 入口。

## 内置脚本

- `scripts/analyze_slow_api.py`：慢接口日志分析工具，从 Graylog 导出的 JSON 文件中解析慢接口数据，按产品组汇总。
- `scripts/generate-plugin-thin-index.ps1`：thin-index 生成 wrapper，转发到根 canonical 脚本。不复制到目标工程，初始化和重建索引时直接调用插件内脚本。

## 依赖

本插件依赖 `imedicalxc-doctor-extend-engineer` 提供的 `vendor/superpowers/`（`using-superpowers`、`brainstorming` 等流程 skill）。若 `imedicalxc-doctor-extend-engineer` 未启用，必须停止并提示先初始化该依赖插件。
