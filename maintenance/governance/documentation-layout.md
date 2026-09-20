# 文档布局与部署边界

项目阅读入口为 docs/README.md；维护者入口为 maintenance/README.md。维护摘要、决策和未完成队列继续放 memory/，不复制到完整文档。

## 分发规则

- docs/ 只存项目接入、使用、运行协议和可复用参考，沿用安装器与更新器的 /docs/**。
- maintenance/ 存源仓治理、设计历史和验证证据；不加入 sparse 正向清单。
- 项目私有部署材料归目标工程。本轮用户明确授权删除旧口腔部署样本四个文件，不迁到维护区或备份目录。
- 稳定运行入口保留原路径，避免同时修改所有插件和旧工程入口。新使用指南归 guides/，参考资产归 reference/；schema 路径保持。
- 项目文档的本地链接必须在部署范围内。维护文档可引用项目文档，反向不得形成运行依赖。

## 文件迁移清单

[documentation-layout.json](documentation-layout.json)保存本次准确旧/新路径和删除清单，用于迁移回归，不由项目运行时加载。

| 旧路径 | 新路径 |
|---|---|
| docs/capability-catalog.md | docs/guides/capability-catalog.md |
| docs/capability-guide.md | docs/guides/capability-guide.md |
| docs/imedical-knowledge.md | docs/guides/imedical-knowledge.md |
| docs/iris-imedical-doctor-ai.md | docs/guides/iris-imedical-doctor-ai.md |
| docs/ai-coding-workspace-kit-v0.2.0.md | maintenance/design/ai-coding-workspace-kit-v0.2.0.md |
| docs/component-version-management.md | maintenance/governance/component-version-management.md |
| docs/print-i18n-case.md | maintenance/validation/cases/print-i18n-case.md |
| docs/project-export-map/doctor/README.md | docs/reference/project-export-map/doctor/README.md |
| docs/project-export-map/doctor/prj_v8.4.xml | docs/reference/project-export-map/doctor/prj_v8.4.xml |
| docs/project-export-map/doctor/prj_v8.5.xml | docs/reference/project-export-map/doctor/prj_v8.5.xml |
| docs/project-export-map/doctor/prj_v9.0.xml | docs/reference/project-export-map/doctor/prj_v9.0.xml |
| docs/project-export-map/doctor/prj_v9.1.xml | docs/reference/project-export-map/doctor/prj_v9.1.xml |
| docs/validation/agent-evolution-maintainer-handoff.md | maintenance/validation/agent-evolution-maintainer-handoff.md |
| docs/validation/agent-evolution.md | maintenance/validation/agent-evolution.md |
| docs/validation/i18n-agent-p1/README.md | maintenance/validation/i18n-agent-p1/README.md |
| docs/validation/i18n-agent-p1/retrospective-6096150/00-run-manifest.json | maintenance/validation/i18n-agent-p1/retrospective-6096150/00-run-manifest.json |
| docs/validation/i18n-agent-p1/retrospective-6096150/10-explorer.md | maintenance/validation/i18n-agent-p1/retrospective-6096150/10-explorer.md |
| docs/validation/i18n-agent-p1/retrospective-6096150/11-classifier.md | maintenance/validation/i18n-agent-p1/retrospective-6096150/11-classifier.md |
| docs/validation/i18n-agent-p1/retrospective-6096150/20-backend-coder.md | maintenance/validation/i18n-agent-p1/retrospective-6096150/20-backend-coder.md |
| docs/validation/i18n-agent-p1/retrospective-6096150/21-frontend-coder.md | maintenance/validation/i18n-agent-p1/retrospective-6096150/21-frontend-coder.md |
| docs/validation/i18n-agent-p1/retrospective-6096150/22-template-seed.md | maintenance/validation/i18n-agent-p1/retrospective-6096150/22-template-seed.md |
| docs/validation/i18n-agent-p1/retrospective-6096150/30-verifier.md | maintenance/validation/i18n-agent-p1/retrospective-6096150/30-verifier.md |
| docs/validation/i18n-agent-p1/retrospective-6096150/40-summary.md | maintenance/validation/i18n-agent-p1/retrospective-6096150/40-summary.md |
| docs/validation/i18n-agent-p1/standardized-6097891/00-run-manifest.json | maintenance/validation/i18n-agent-p1/standardized-6097891/00-run-manifest.json |
| docs/validation/i18n-agent-p1/standardized-6097891/10-explorer.md | maintenance/validation/i18n-agent-p1/standardized-6097891/10-explorer.md |
| docs/validation/i18n-agent-p1/standardized-6097891/11-classifier.md | maintenance/validation/i18n-agent-p1/standardized-6097891/11-classifier.md |
| docs/validation/i18n-agent-p1/standardized-6097891/20-backend-coder.md | maintenance/validation/i18n-agent-p1/standardized-6097891/20-backend-coder.md |
| docs/validation/i18n-agent-p1/standardized-6097891/21-frontend-coder.md | maintenance/validation/i18n-agent-p1/standardized-6097891/21-frontend-coder.md |
| docs/validation/i18n-agent-p1/standardized-6097891/22-template-seed.md | maintenance/validation/i18n-agent-p1/standardized-6097891/22-template-seed.md |
| docs/validation/i18n-agent-p1/standardized-6097891/30-verifier.md | maintenance/validation/i18n-agent-p1/standardized-6097891/30-verifier.md |
| docs/validation/i18n-agent-p1/standardized-6097891/40-summary.md | maintenance/validation/i18n-agent-p1/standardized-6097891/40-summary.md |

授权删除：`docs/deploy/dental-ta-159/README.md`、`docs/deploy/dental-ta-159/deploy-plan-159.md`、`docs/deploy/dental-ta-159/deploy-frontend.js`、`docs/deploy/dental-ta-159/deploy-backend.js`。

## 已有工程的收敛

本次不增加删除工具。维护者提交并发布后，标准工程由原更新器安全快进到包含迁移的提交，再刷新 sparse。Git 删除已跟踪旧路径、检出 docs 新路径；maintenance 新路径仍在 index 中，但不在业务工作区落盘。旧受管文件所在目录已空时由 Git 清除，不保留跳转壳或旧版副本。

- 本地修改了受管旧文件：更新器应在拉取/迁移前停止，不以强制 checkout 或递归删除覆盖。
- 旧目录含未跟踪自定义文件：未忽略文件会触发 dirty 停止；已忽略的自定义文件由 Git 保留，旧目录因此可继续存在。检查残留内容并报告归属，不为目录外观整洁清空它。
- 新路径有自定义文件冲突：保留文件，停止覆盖；人工明确归属后再恢复原更新流程。
- 无远端、只有历史手工复制的文件：不能假定所有同名文件受管；先恢复正式能力包更新条件。禁止仅按旧路径批量删除。
- Overlay：只更新共享 CapabilityRoot 一次，模块沿既有两阶段更新刷新 ContextRoot；不扫描 sibling，也不迁移业务项目自己的 docs。
- Check 与 DryRun -NoPull 保持只读。普通 DryRun 可能更新 capability，不能把它解释为绝对不写入；确需只读时用前两种方式。

清理是 Git 对受管路径的版本迁移，发布记录和 .git 历史仍保留旧提交；本次不改写 Git 历史。

## 验证与维护

运行 node --test scripts/tests/documentation-layout.tests.js，检查项目链接、准确路径、新装 sparse、旧版本更新、空目录收敛、自定义残留及 dirty 保护。Windows 用 PowerShell 7 和 Windows PowerShell 5.1 跑 scripts/tests/update-agents.tests.ps1，验证真实 updater 的更新路径。跨平台 CI 复用 sparse-refresh 工作流；未实际运行的宿主不得声明通过。

新增或调整文档时检查使用者、分发范围、入站/出站引用和迁移兼容。移动历史验证样本时保留机器记录正文作为历史证据，更新人可读入口；不得将历史验证声明升级成当前结果。
