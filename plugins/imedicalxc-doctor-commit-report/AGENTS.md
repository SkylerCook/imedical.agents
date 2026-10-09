# iMedicalXC Doctor Commit Report

`imedicalxc-doctor-commit-report` 是提交记录定时汇总报告插件：确定性采集 + LLM 语义分析两段式，产出医生站团队的月度提交汇总与变更影响评估报告。

## 插件定位

- 只承载可复用的工作流定义与确定性采集脚本。
- 人员名单、工作站清单、时间窗、输出目录等项目差异写入目标工程 `.agents/config/commit-report.json`，不硬编码在插件中。

## 使用约束

- 全程只读 git 仓库（log / show），不触发远端上传、编译、数据库写入。
- 推送凭据不落盘明文，配置模板仅保留 `credentialRef` 占位；推送能力本期未实现（enabled=false）。
- 评估依赖 `imedicalxc-doctor-business-understanding` 插件做高风险提交的深度链路分析。

## Skill 路由

- 汇总工作流入口：`skills/imedicalxc-doctor-commit-report/SKILL.md`

## 内置脚本

- `scripts/collect-commits.js`：遍历 src/ 下 20 个子仓库，按时间窗 + 11 人白名单过滤并排除 merge，输出 `raw-commits-<YYYY-MM>.json`（UTF-8 无 BOM）。
