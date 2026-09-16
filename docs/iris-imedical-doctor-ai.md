# AI 工作站插件接入

组件：`iris-imedical-doctor-ai`，底层依赖 `coding-iris-plugin`。

使用既有 [更新流程](update-agents.md) 同步 capability。插件存在仅代表 available；在业务工程调用初始化入口核对依赖与源码，再启用。初始化复用 IRIS profile，不创建连接配置。standard 和 Overlay 都使用现有 ContextRoot/CapabilityRoot 契约，不能把模块源代码根当作 capability 根。

新增插件本身不需要修改 updater 或 sparse 清单。thin-index wrapper 仅转发根 canonical 脚本，生成开发与初始化两个入口；不覆盖项目原 skills/docs。曾讨论的无 iris 前缀名称没有已发布副本，不作历史名称迁移。

源仓验证：

```powershell
node --test scripts/tests/iris-imedical-doctor-ai.tests.js
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root . --base-ref HEAD --worktree
```

专项场景见[插件验证说明](../plugins/iris-imedical-doctor-ai/references/verification.md)。本地测试不会调用 HIS；业务产物遵循目标工程约定；插件不绑定原型、源码目录或框架接口，设计适配见插件的原型集成方法。

共享页面能力接入卡片时，按验证参考中的脱敏场景选择回归：入口权限来源、实际参数传递、默认范围等价、控件事件、运行依赖和摘要语义。源仓专项检查不能替代目标工程运行时验证。此次参考更新不改初始化、thin-index 或安装清单，无旧文件清理。
