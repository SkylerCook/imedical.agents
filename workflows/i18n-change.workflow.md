
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

## Step 0：启动契约

任何 Explorer 或代码修改开始前，Coordinator 必须完成以下事项：

1. 选择运行模式并立即创建 `00-run-manifest.json`，不得在执行中途把串行运行事后包装成 `multi-agent`。
2. 为每个 actor 声明互斥文件所有权；Backend、Frontend、Template/Seed 和 Verifier 的边界写入 manifest。
3. 根据需求描述列出预计远程动作，并主动一次性询问当前运行授权：
   - `translation-data-write`：新增页面翻译、缺失字典翻译、XML 语言模板新建、已明确列出的 CSP 翻译加载动作。
   - `business-code-deploy`：前端上传、后端上传与编译。
   - `tool-internal-execution`：仅用于已列出的只读核验或翻译操作所需、自清理的临时执行载体；不授权上传命名业务类。
4. 用户在当前任务已明确授权时直接记录，不重复询问；未回答或拒绝时继续本地生成和只读验证。
5. 一次授权只覆盖当前运行、当前配置目标环境和已列 scope。覆盖已有不同值、XML overwrite、删除、回滚、切换环境或扩大范围必须重新确认。
6. 预计存在远程动作时，在派发写入相关角色前完成 MCP capability preflight，并把 `query`、`execute`、`document` 等本次实际需要的能力写入 manifest；不需要的能力标记 `not-required`。

推荐一次性询问文案：

> 本需求可能需要把新增的页面/字典翻译和 XML 语言模板写入当前配置环境。是否授权本次运行在链路确认且本地校验通过后自动写入？仅新增、相同值跳过，不覆盖冲突、不删除；业务代码上传和编译单独授权。

清晰的打印 i18n 需求在用户授权 `multi-agent` 后，应从 Step 0 就启动并行：定向 Explorer/Classifier 完成后，代码与 XML/Seed 在所有权不重叠时并行，独立 Verifier 在所有最终修改和远程写入完成后执行。

### MCP capability preflight

1. `check_config` 只核对目标定位，不作为网络连通证明。
2. 立即执行 `iris_query("SELECT 1 AS Probe")`。探针成功时继续；`connection_source=auto_discovered` 且 `config_file=null` 不构成失败。
3. 只有真实探针失败时才重启一次 MCP 会话并复测。单次 404/405 或单一工具失败只影响对应 capability，不得扩大为整个 MCP 不可用。
4. 查询仍失败且本次已授权 `tool-internal-execution` 时，可使用会自清理的 `iris_execute` + `%SQL.Statement` 只读降级；否则只阻塞 SQL capability。
5. 在编码前只读预扫描目标语言、源/目标 XML、页面翻译冲突和必要字典项。相同值记 `skipped-same`；既有不同值完成分类后记终态 `blocked`；瞬时故障记非终态 `suspended`。

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
6. GB2312 前端文件需要临时 UTF-8 工作副本时默认使用 `$env:TEMP`，不得默认写 `C:\tmp`；修改后按项目编码工具转回并复核 EOF/编码。

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

### 暂停与恢复

- schema 1.2 阶段使用 `attempts[]` 记录每次真实执行。瞬时网络、额度、MCP 会话或工具路由故障结束当前 attempt 为 `suspended`；恢复时追加新 attempt，不创建 `template-seed-resume` 等临时阶段。
- `suspended` 是非终态，运行保持开放，不得启动 Verifier 或生成最终 Summary。翻译冲突、字典缺失等在只读分类完成后可记终态 `blocked`。
- 子 Agent 进入错误模式、120 秒无心跳或未输出约定产物时只替换一次；再次失败由 Coordinator 记录阻塞，不反复创建 Agent。

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
6. 仅当 `finalization.ready=true` 时启动 Verifier：所有已授权远程动作均为终态、没有 suspended attempt，且业务代码、本地 i18n 产物和已授权远程读回均已冻结。
7. `verification.scope` 固定覆盖 `business-code`、`local-i18n-artifacts`、`authorized-remote-readback`。这些范围在 Verifier 后发生修改会使结论失效；manifest、阶段报告、summary、feedback 和维护文档不计入业务验证版本。

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
- Coordinator 必须先完成 finalization 门禁，再派发 Independent Verifier；不得用“稍后补远程写入”作为提前验证的理由。

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
- schema 1.2 的 attempts、capabilities、remote action 终态、finalization 和 verification scope 已完整记录。
- `00-run-manifest.json` 与阶段报告通过事后机械校验。
- 如果对框架文件做了修正，调用 `skills/agent-framework-feedback/SKILL.md` 生成反馈条目。
