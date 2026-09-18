# 需求交接与接续

`agent-context-kit` 0.4.0 的 `task-handoff` 为同机、同工作区提供通用串行接续。使用“这个需求支持交接”“交接当前需求”“继续某需求”，或显式 `$task-handoff init|handoff|resume|list`。编码与外部操作继续使用领域 skill，框架维护不进入业务验收生命周期。

## 材料与运行

材料保存在项目 `docs/handoff/<首次本地毫秒时间戳>-<需求ID>/`：最新 `handoff.md`、机器现场 `state.json`、明确交接时追加的 `history/*.md`。无编号使用 `00000`；补编号不改目录。正文包含有效决定、授权原意、断点与下一步，现有任务书只引用；脚本管理发现、快照、路径/Git/内容变化检查，检查通过不等于业务完成。

执行过程、输入格式、降级和退出码以 [工具契约](../plugins/agent-context-kit/skills/task-handoff/references/tool-contract.md) 为唯一来源。先检查现场差异，再更新正文与检查点；意外中断时从实际代码恢复，未知远程结果先核实。默认直接接手，用户须避免旧会话仍在写入；v1 不提供会话锁或自动停止 Agent。

## 接入和兼容

- 新项目初始化：enabled 的 agent-context-kit 生成薄索引，在项目 AGENTS 合并简短路由。尚未启用具体需求时不创建交接目录。
- 既有项目：正常更新能力包并刷新薄索引后可显式调用；自然语言路由在已授权上下文维护中定点加入，保留自定义正文。available/disabled 不自动启用。
- 本机保存：init 使用管理交接目录的 Git 仓库本地 exclude；不修改共享 ignore，不自动取消已有跟踪。材料不是临时文件，任务结束后保留。
- Overlay：目录属于 WorkspaceRoot，代码读取与 Git 查询受声明的 SourceRoot/GitRoot 限制，共享 CapabilityRoot 不写入任务现场。
- 个人 handoff、旧交接文档与正式 run 保持原样；引用已有材料，无强制迁移或兼容清理。
- Obsidian：标准 Markdown 与普通链接可独立查看，本版没有专属语法、配置、同步或聚合副本。

## 验证

`node --test scripts/tests/task-handoff.tests.js` 验证实际临时 Git 仓库、worktree、Overlay、未提交修改、恢复、快照及薄索引。框架 CI 复用 Windows/macOS/Linux 与 Node 22/24 矩阵；本地通过不能代表所有平台通过。

真实接续验收：在任务断点交接，让没有原聊天历史的新会话仅从项目规则与交接入口恢复。检查工作区、范围、授权、证据和第一步均正确，并保留无关修改。新会话由用户打开，生成交接本身不会自动创建或调度任务。
