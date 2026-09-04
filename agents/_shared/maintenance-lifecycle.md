# 框架维护生命周期

本生命周期只适用于 `taskKind=framework-maintenance` 的能力包、rule、skill、workflow、脚本、版本和治理文档维护，不用于业务需求交付。

```text
maintaining -> locally-verified -> maintenance-complete
```

- `maintaining`：正在修改 canonical 框架内容，或最终验证之后又发生了写入。
- `locally-verified`：与改动相关的代码、契约、版本和兼容性测试已通过，并记录验证证据。
- `maintenance-complete`：维护闭环已完成；需要时已同步 README、决策、维护日志、backlog、release record 和业务项目部署副本。

框架维护不进入 `implementing / acceptance-pending / accepted`，不等待业务验收，也不触发或提示需求 feedback。`acceptance.status` 必须为 `not-applicable`，`feedbackDecision.applicable` 必须为 `false`。

若业务需求处理中同时发现并修改框架问题，必须拆成两个独立记录：业务需求继续使用 `taskKind=business-demand` 及需求验收生命周期；框架改动使用 `taskKind=framework-maintenance` 及本生命周期。两者不得共享验收状态、feedback 状态或完成判定。

本地验证、版本记录或同步业务项目均不隐含 commit、merge、push、远程写入或部署授权；这些动作仍按各自授权门禁执行。
