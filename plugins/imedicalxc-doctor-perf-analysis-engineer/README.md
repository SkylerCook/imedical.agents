# imedicalxc-doctor-perf-analysis-engineer

HIS 医生站接口性能分析与优化能力包，覆盖前后端全链路追踪、N+1/批量调用优化、Graylog 日志分析和报告输出。

## 能力范围

- 性能诊断工作流（Controller → BLH → Service → Mapper 完整链路）
- 代码追踪防误判三步法（读实现 / 检查 guard clause / 检查缓存层）
- 后端 N+1 查询、批量调用、缓存优化
- 前端页面加载慢/卡顿/报错诊断
- Graylog 日志查询与分析
- 标准化性能分析报告输出

## 标准目录

```text
imedicalxc-doctor-perf-analysis-engineer/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- scripts/
|   |-- generate-plugin-thin-index.ps1
|   `-- analyze_slow_api.py
`-- skills/
    |-- imedicalxc-doctor-perf-analysis-engineer/
    |   |-- SKILL.md
    |   `-- references/
    |       |-- application-mapping.md
    |       |-- diagnosis-workflow.md
    |       |-- frontend-optimization-guide.md
    |       |-- graylog-search.md
    |       |-- optimization-guide.md
    |       `-- report-template.md
    `-- imedicalxc-doctor-perf-analysis-engineer-init/
        `-- SKILL.md
```

## 安装模式

默认使用 `plugin-reference-thin-index`：

1. 将本插件放到目标工程 `.agents/plugins/imedicalxc-doctor-perf-analysis-engineer/`。
2. 首次初始化时直接读取 init skill `.agents/plugins/imedicalxc-doctor-perf-analysis-engineer/skills/imedicalxc-doctor-perf-analysis-engineer-init/SKILL.md`。日常使用读取 thin-index 生成的 `.agents/skills/imedicalxc-doctor-perf-analysis-engineer/SKILL.md`。
3. 运行插件 wrapper `scripts/generate-plugin-thin-index.ps1`，转发到根 `scripts/generate-plugin-thin-index.ps1`。
4. wrapper 默认只生成 `.agents/skills/imedicalxc-doctor-perf-analysis-engineer/SKILL.md` 主编排器浅层索引；子 reference 文件不单独暴露，由主编排器按需读取。

## 去项目化边界

本插件不保存服务器地址、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。性能数据从日志（Graylog MCP）提取，报告默认输出到当前项目目录，用户也可另行指定。
