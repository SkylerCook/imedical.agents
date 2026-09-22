# 需求交付生命周期

本协议只适用于 `taskKind=business-demand` 的需求实现、用户验收与反馈决策。技术动作不能替代用户验收。框架维护必须改用 `agents/_shared/maintenance-lifecycle.md`，不得借用本生命周期的验收或 feedback 状态。

```text
implementing -> locally-verified -> acceptance-pending -> accepted
      ^                  |                 |
      `------------------+-----------------+ 继续修改
```

- `implementing`：仍在分析或修改；任何影响验收范围的继续修改都回到此状态，并使既有验证结论过期。
- `locally-verified`：目标静态检查、测试或本地构建已完成；它不是用户验收。
- `acceptance-pending`：Agent 已给出用户可执行的最短验收步骤，等待用户判断。
- `accepted`：仅由用户明确表达“验收通过”“修改完成”“可以收尾”等同义确认后进入，并记录验收依据。

commit、merge、push、部署、远程编译、Verifier 完成 均不得自动产生 `accepted`。

`taskKind=business-demand` 固定派生 `feedbackReviewApplicable=true`。`accepted` 只解除 feedback 的时间门禁；框架维护、版本升级、文档治理和普通查询不得设置为业务需求来获得该门禁。

只有进入 `accepted` 且发现框架缺陷、规则冲突、可复用新经验或用户明确要求时，才加载只读 feedback 审查并报告相关候选和建议动作。无信号不加载、不例行报告。正式 run 新建使用 feedbackReviewPolicy=on-signal；旧记录缺省按 always 处理。on-signal 无候选时可 transition feedback-decision 为 skipped，必须 --reason no-signal；不得伪称完成完整审查。重新修改重置判断。新增或修改经验、更新命中次数、生成 framework feedback、提升 rule，均必须由用户逐项授权；未授权时不得写 feedback。

用户显式要求在验收前记录观察时，只能标记为 `provisional` 候选，不得更新命中次数或提升 rule。
