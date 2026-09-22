# 项目工具的源仓验证

以下历史验证说明从项目操作文档分离，命令在框架源仓根执行；结果仍需按当前 scope 和平台核实。

## 任务交接

`node --test scripts/tests/task-handoff.tests.js` 验证实际临时 Git 仓库、worktree、Overlay、未提交修改、恢复、快照及薄索引。框架 CI 复用 Windows/macOS/Linux 与 Node 22/24 矩阵；本地通过不能代表所有平台通过。

## 旧入口兼容

专项验证：`node --test scripts/tests/doctor-extend-routing.tests.js`，覆盖 Windows PowerShell 5.1 / PowerShell 7 的生成、旧入口清理、幂等和自定义文件保护。源仓更新不代表业务项目副本已同步。
