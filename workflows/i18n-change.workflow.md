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

## 执行模式与报告契约

运行开始时必须选择 `retrospective`、`serial` 或 `multi-agent`，并创建：

```text
docs/agent-reports/{ticket-or-topic}/
  00-run-manifest.json
  10-explorer.md
  11-classifier.md
  20-backend-coder.md
  21-frontend-coder.md
  22-template-seed.md
  30-verifier.md
  40-summary.md
```

- P1 验证使用逐阶段报告；不适用阶段仍保留文件，并说明 `not-applicable` 原因。
- `retrospective` 不修改业务代码、不执行远程写入；无法取得的阶段时间写 `null` 和原因，不得推测。
- `multi-agent` 必须有明确授权；远程写入仍需单独授权。
- 已选定本 workflow 后，agent/workflow registry 不再重复读取。
- 运行结束后使用 `plugins/agent-context-kit/scripts/validate-agent-run.ps1` 对目录做只读机械验收。

## 已批准计划快速路径

用户计划同时明确入口、影响范围、文本分类、模板/种子策略和测试要求时：

1. 将计划作为 Explorer/Classifier 初始输入并在 manifest 标记 `reusedEvidence=true`。
2. 只核验入口、数据来源、实际渲染路径和未确认项，不重新做全量链路探索。
3. Explorer 与 Classifier 可由同一 actor 连续执行，但必须分别输出 `10-explorer.md` 和 `11-classifier.md`。
4. 任一关键事实与计划不符时，停止快速路径并回到标准 Explorer。

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
docs/agent-reports/{ticket-or-topic}/10-explorer.md
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
docs/agent-reports/{ticket-or-topic}/11-classifier.md
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

`multi-agent` 模式下，Backend Coder 与 Frontend Coder 仅在文件所有权互不重叠时并行；存在重叠时由 Coordinator 改为串行。

输出：

```text
docs/agent-reports/{ticket-or-topic}/20-backend-coder.md
docs/agent-reports/{ticket-or-topic}/21-frontend-coder.md
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
docs/agent-reports/{ticket-or-topic}/22-template-seed.md
```

如果不满足触发条件，本阶段输出“不触发原因”，不得默认执行 XML 模板同步。

### XML 保存失败收敛

- 查询、导出和本地翻译成功后必须复用现有 XML、manifest 和备份，不重新执行前序阶段。
- `iris_execute` 内部 stdout/status 出现临时类 `Execute+...<SYNTAX>` 时，按 ObjectScript 载荷编译失败处理，不按 MCP 传输失败处理。
- 除明确且有限的引号修正外，不重复尝试等价长脚本；立即切换为项目已有保存接口，或 Base64 短调用分块写临时 Global、短调用合并保存、清理、一次只读验收。
- 同一失败签名的等价重试不得超过 1 次；`retrospective` 可记录历史违规，但不得在复盘中重演。

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
5. 后端获得编译授权时，在 XML 远程保存前执行 fail-fast 编译；未获授权时执行 ObjectScript 条件分支结构检查并标记编译待验证。

输出：

```text
docs/agent-reports/{ticket-or-topic}/30-verifier.md
```

Root 根据全部 handoff 生成 `40-summary.md`；不得重新执行子 Agent 已完成的检索。

## 多智能体编排

```text
Root Coordinator
  -> Explorer + Classifier actor
  -> Backend Coder / Frontend Coder / Template-Seed actor（范围不重叠时并行）
  -> Independent Verifier
  -> Root 汇总
```

- Coordinator 在并行前声明每个 actor 的文件所有权和远程动作边界。
- Template/Seed actor 默认只生成本地产物；远程保存由 Coordinator 串行执行。
- 子 Agent 只读取 handoff 指定的 profile、skill 和专项规则；同一 actor 不重复读取同一规则。
- Verifier 必须独立于所有 Coder。

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

如果当前工具不支持子 Agent，或任务未明确授权多智能体，选择 `serial`。单 Agent 按同样逻辑阶段顺序执行，P1 验证仍输出全部交接文件；普通快速路径可输出一份合并报告，但完成条件不得减少。

如果上下文不足以完成所有阶段，优先完成 Explorer 和 Classifier，停止在明确阻塞点，不猜测实现。

## 完成条件

- 链路事实已记录。
- 字段分类清单已覆盖所有已发现用户可见文本。
- 代码改造只覆盖分类清单确认项。
- XML 模板或翻译种子只在条件满足时处理。
- 验证报告列出已执行检查、未执行原因和残余风险。
- `00-run-manifest.json` 与阶段报告通过事后机械校验。
- 如果对框架文件做了修正，调用 `skills/agent-framework-feedback/SKILL.md` 生成反馈条目。
