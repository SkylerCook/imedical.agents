# 医生站 AI 源仓验证

项目使用说明见[接入指南](../../docs/guides/iris-imedical-doctor-ai.md)。以下命令从框架源仓根执行：

```powershell
node --test scripts/tests/iris-imedical-doctor-ai.tests.js
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root . --base-ref HEAD --worktree
```

专项场景见[插件验证说明](../../plugins/iris-imedical-doctor-ai/references/verification.md)。源仓测试不调用 HIS，不能替代目标工程的真实集成验收。维护时核对共享页面无 Chat 兼容、事件、实际参数、默认范围、运行依赖和摘要语义；已验证平台与未覆盖范围分别记录。
