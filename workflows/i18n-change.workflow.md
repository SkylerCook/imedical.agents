# i18n-change Workflow

`i18n-change` 是 IRIS 国际化需求处理的领域 workflow。它把 `i18n-workflow-decompose.md` 中的五阶段愿景落地为可执行的 canonical 流程。

默认 Agent：`agents/i18n-agent/AGENT.md`

## 触发条件

用户需求满足任一条件时使用：

- 要求对 IRIS/ObjectScript/CSP/HISUI 页面或后端逻辑做国际化改造。
- 要求处理打印链路国际化。
- 要求生成页面翻译种子、字典翻译种子、XML 模板翻译或 CSP 翻译同步。
- 要求验证 i18n 改造是否完整。

## 必读

1. 目标项目 `AGENTS.md`。
2. 目标项目 `.agents/config/i18n_project_profile.md`。
3. `.agents/agents/i18n-agent/AGENT.md`。
4. `.agents/agents/_shared/handoff-protocol.md`。
5. `.agents/plugins/i18n-iris-plugin/rules/i18n_index.md`。

在本仓库维护时，上述 `.agents/` 路径对应仓库根目录。

## 阶段 1：Explorer

目标：定位实际链路，不预设数据形态或模板形态。

输入：

- 用户需求描述。
- 入口页面、按钮、打印单据或目标文件。
- 项目 profile。

执行：

1. 读取 `plugins/i18n-iris-plugin/rules/i18n_link_tracing.md`。
2. 从入口页或按钮事件定位 JS、CSP、后端类和方法。
3. 抓取或推断实际返回数据形态。
4. 判断是否存在模板字段。
5. 标注中文残留位置。

输出：

```text
docs/agent-reports/{ticket-or-topic}/explorer-i18n-agent.md
```

该报告必须区分已验证事实、推断和待确认项。

## 阶段 2：Classifier

目标：把每个用户可见文本标注为明确处理方式。

输入：

- Explorer 链路事实报告。
- 相关代码片段或模板片段。

执行：

1. 读取 `plugins/i18n-iris-plugin/rules/i18n_field_classification.md`。
2. 后端字典/表字段展示值同时读取 `i18n_dict_translate_facade.md`。
3. 将文本分类为固定文案、字典展示值、业务输入、外部接口返回或未确认来源。
4. 为每一项指定处理方式。

输出：

```text
docs/agent-reports/{ticket-or-topic}/classifier-i18n-agent.md
```

分类清单是 Coder 阶段的主要输入。未确认来源不得进入编码改造。

## 阶段 3：Coder

目标：按分类清单执行最小代码改造。

输入：

- Classifier 字段分类清单。
- 目标源码。
- 项目 profile。

执行：

1. 读取 `plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md`。
2. 前端文件读取 `i18n_coding_frontend.md`。
3. 后端文件读取 `i18n_coding_backend.md`。
4. 打印链路读取 `i18n_coding_print_backend.md`。
5. 按分类清单改造，不扩大范围。

输出：

```text
docs/agent-reports/{ticket-or-topic}/coder-i18n-agent.md
```

同时输出代码 diff 摘要和后续需要生成的翻译表、种子或模板事项。

## 阶段 4：Template/Seed

目标：只在链路和分类结果确认需要时处理翻译种子、字典种子、XML 模板或 CSP 翻译同步。

触发条件：

- 分类清单包含页面级翻译表待生成。
- 分类清单包含字典/表字段展示值待生成。
- Explorer 确认存在 XML 模板记录。
- 用户明确要求 CSP 页面翻译导出、校验或同步。

执行入口：

- `plugins/i18n-iris-plugin/skills/i18n-page-trans-seed/SKILL.md`
- `plugins/i18n-iris-plugin/skills/i18n-bdp-trans-seed/SKILL.md`
- `plugins/i18n-iris-plugin/skills/i18n-xml-template/SKILL.md`
- `plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md`
- `plugins/i18n-iris-plugin/skills/i18n-csp-trans-sync/SKILL.md`

输出：

```text
docs/agent-reports/{ticket-or-topic}/template-seed-i18n-agent.md
```

如果不满足触发条件，本阶段输出“不触发原因”，不得默认执行 XML 模板同步。

## 阶段 5：Verifier

目标：验证改造结果，输出通过项、问题和残余风险。

输入：

- Coder 变更摘要。
- Template/Seed 产物摘要。
- 代码 diff。

执行：

1. 读取 `plugins/i18n-iris-plugin/rules/i18n_verify.md`。
2. 扫描源语言残留、helper 使用、占位符、调试输出。
3. 检查翻译表、种子、XML 模板和 fallback 行为。
4. 在用户明确要求且工具可用时，执行编译、同步或服务器只读验证。

输出：

```text
docs/agent-reports/{ticket-or-topic}/verifier-i18n-agent.md
```

## 条件分支

| Explorer/Classifier 结论 | 后续路径 |
|---|---|
| XML 模板链路 | Coder 处理代码引用，Template/Seed 可触发 XML 模板 skill |
| HTML/CSP 直出 | Coder 按前后端规则处理，不触发 XML 模板同步 |
| 字符串拼接 | Coder 按后端规则处理，必要时生成页面级或字典翻译种子 |
| 第三方接口返回 | 标记外部接口返回，不改代码，输出转交建议 |
| 业务输入 | 不翻译，不改代码 |
| 未确认来源 | 停止对应项改造，要求补充事实 |

## 串行降级

如果当前工具不支持子 Agent，单 Agent 按五阶段顺序执行。每个阶段仍需输出交接产物，避免直接跳到编码。

如果上下文不足以完成所有阶段，优先完成 Explorer 和 Classifier，停止在明确阻塞点，不猜测实现。

## 完成条件

- 链路事实已记录。
- 字段分类清单已覆盖所有已发现用户可见文本。
- 代码改造只覆盖分类清单确认项。
- XML 模板或翻译种子只在条件满足时处理。
- 验证报告列出已执行检查、未执行原因和残余风险。
