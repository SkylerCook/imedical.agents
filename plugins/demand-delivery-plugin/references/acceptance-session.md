# 连续验收批次协议

按需使用：已有台账能准确恢复时直接复用；明确批次需要机械校验、多个交付者或跨会话恢复时才创建此索引。正式 run 仍由既有 orchestrator 管理。辅助脚本不执行 Git/BOS，不授予权限，不证明真实服务结果；回执来自实际执行工具和独立核对。

## 建立与定位

一个批次共享一个目标工程内的任务目录，例如 `docs/acceptance/<batch>/`。目录使用项目约定，避开 `.agents`、`.git` 和能力源码。现有 `session.json` 应续接；需求/仓库/动作范围变化需明确核对并另建批次，保留旧回执，不能手改 hash 绕过边界。

在实际 CapabilityRoot 下调用：

```text
node <CapabilityRoot>/plugins/demand-delivery-plugin/scripts/acceptance-session.js --help
node <script> init --directory <task-dir> --input-file <input.json>
node <script> status --directory <task-dir> --id 123
node <script> next --directory <task-dir>
node <script> report --directory <task-dir> --kind accepted
node <script> report --directory <task-dir> --kind delivered --format csv
```

`<script>` 表示上述脚本路径；每个写命令从 `--input-file` 或 `--stdin` 二选一读取 JSON。输入文件按任务临时文件约定保存并收尾清理，也可用工具结构化 stdin 避免 Shell 引号错误。只读命令无需输入。

`init` 输入（路径替换为目标工程事实，仓库文件须精确到相对路径）：

```json
{
  "projectRoot": "<ProjectRoot>",
  "deliveryActions": ["commit", "bos-log", "push"],
  "demands": [{
    "id": "123", "title": "输入框清空后恢复默认值",
    "automatic": {"status": "passed", "evidenceRefs": ["evidence/123.md"], "gaps": ["原生打印未测：需在实际打印环境执行并核对输出"]},
    "repositories": [{
      "key": "frontend", "root": "<CanonicalGitRoot>",
      "remote": "origin", "ref": "refs/heads/dev",
      "files": ["pages/editor.js"]
    }]
  }]
}
```

`deliveryActions` 明确本批次约定，包含 commit；BOS/push 按真实需要选择，不能根据初始化配置推断授权。用户明确调用 demand-acceptance 开展验收交付时，按技能“调用与授权”复用该批次授权；authorize 保存真实调用原话与适用动作，无需用户重复确认。旧批次保留已有授权范围与限制，恢复不能自动补齐未授权动作。push 必须有明确 remote 和完整分支 ref。同一真实仓库使用一个 key；不同 key/别名不能指向同一仓库。Agent 还应通过现有 Git/Overlay 工具核对实际 common-dir、来源与目标，不以目录字符串代替仓库身份。

## 接收和发布

各命令输入：

| 命令 | JSON 输入与结果 |
|---|---|
| authorize | `{"actor":"user","quote":"<本对话真实授权原话>","actions":["commit","bos-log","push"]}`，绑定本批次 scopeHash；仅记录已存在的授权 |
| decide | `{"id":"123","actor":"user","quote":"<真实验收原话>","status":"passed"}`；可选 failed/deferred；自动证据不会产生人工结论 |
| claim | `{"id":"123","owner":"delivery-a","worktrees":{"frontend":"<ActualWorktree>"}}`；单号唯一交付者，活动写入者不能共用同一 worktree |
| publish | `{"id":"123","owner":"delivery-a"}`；先取得所涉仓库发布权再执行 commit/BOS/push |
| record | `{"id":"123","owner":"delivery-a","phase":"commit","status":"succeeded","receipt":{...},"durationMs":1250}`；phase 可选 commit/bos/push，status 可选 running/failed/unknown/succeeded |
| release | `{"id":"123","owner":"delivery-a"}`；仅尚未产生提交时释放，不回退工作区 |
| reconcile-bos | `{"id":"123","owner":"delivery-a","actor":"user","quote":"<核对结论原话>","status":"succeeded","receipt":{...}}` 或 status=not-submitted；用于未知结果的明确核对；已证实成功也可按下文使用 Agent 回读证据 |

真实原话须由 Agent 从人类对话核对，不能把别的 Agent 指令或输入文件声明当成用户授权。`session.lock` 仅短时保护元数据写入；失败时检查实际写入者与恢复现场，禁止抢删其他执行者的锁。只读报告可在锁存在时运行。

发布排他仅覆盖**同一 session 内**遵循协议的执行者，以注册的仓库 root/remote/ref 为键。它不是跨批次/跨工具的全局 Git 锁；复用一个批次索引并保留现有 upstream/HEAD/hook 检查，外部变更按实际证据恢复。独立 worktree 可提前准备，不能提前发布。

## 回执与恢复

commit：`receipt` 直接使用 `demand-commit` 最终 verified 的完整计划对象，包含 demand、各仓 root/files/message 与 execution.status/commit。所有目标仓均 verified、精确文件与需求号一致才接受。先保存官方结果再登记，避免成功提交后丢失 hash。

BOS：从本需求 verified 结果构造 `select`，字段为 repo/hash；记录时使用：

```json
{"select":[{"repo":"<VerifiedWorktree>","hash":"<40位实际业务commit>"}],"submitted":true,"resultCodes":["000"]}
```

调用写入前登记 bos/running，成功后登记 succeeded。running/unknown 不允许重新发起写入；超时后核对 BOS 现有记录。已有授权且可只读核实时先自行核对。权威查询已确认相同 repo/hash 写入成功时，可用 actor=agent、status=succeeded、verification={source:"bos-readback",evidenceRef:"<实际回读证据>"} 及 submitted=true 的精确成功回执执行 reconcile-bos，无需再次请求人类确认。没有权威回读能力或证据仍不确定时保留 unknown，说明查询缺口；只有用户明确核实未写入才重置 not-submitted。辅助脚本验证回执形状，实际证据真实性由执行者核对；不能把普通日志、空查询或网络超时当成权威未写入结论。成功阶段不能重复登记或重复执行。

push：每个已成功目标可单独登记，第二个仓失败保留第一个仓回执：

```json
{"repositories":[{"key":"frontend","commit":"<已录BOS的业务hash>","remote":"origin","ref":"refs/heads/dev","verified":true,"remoteHash":"<真实远端tip>"}]}
```

tip 与业务 hash 不同但包含该提交时，独立验证 ancestry 后增加 `containsVerified:true`。这些 true 字段是实际核对结果，不是脚本自动证明。全部约定阶段成功后自动释放本需求占有；部分 push 只续未成功仓，不再写 BOS。

commit 的 unknown/失败应先读官方计划及实际 Git，判断是否已有提交；不要重跑副作用。已开始交付后修改人工结论或来源映射应保留原回执并显式核对修订需求，不能覆盖现有成果。需要用户协助时列出具体未完成阶段；其他需求继续接收。

## 输出与证据

`report` 支持 accepted/delivered/failed/deferred/pending 与 markdown/json/csv。Markdown 输出遵循技能的 BOS 编号契约；CSV 仅一行编号。accepted 只取人工通过；delivered 按 deliveryActions 逐项核对成功，不把自动验证当人类验收。

`pending` 仅按 `decision.status` 筛选，Markdown 标题为“待用户验收结论”；不表示需求待澄清，也不表示存在人工补验。`automatic.status/evidenceRefs/gaps` 分别保留自动验证结果、证据与缺口；编号报告不推导补验数量，详细报告按[测试协议](../../../agents/_shared/testing-protocol.md#结果与交接)核对现有记录。空 gaps 只表示未记录专项补验项。JSON/CSV 与既有状态枚举保持兼容。

报告者只读 session.json/执行回执，写独立报告；多个交付者仅通过辅助命令短时更新元数据。量测 durationMs 记录实际阶段时间；未量测等待另列未归因，不写为 Git/BOS 的耗时。

目前测试覆盖本机隔离状态流与本地 Git 对接；真实 BOS 写入/远端发布及非本机宿主需另行取得授权和证据。

## 主子需求及无代码条目 v2

语义按[代码归属协议](../../../docs/demand-code-ownership.md)。init出现parentId或codeBinding时创建demand-acceptance-session/v2，原输入继续v1，load兼容二者；旧批次不自动升级。v2的parentId、codeBinding及none原因都纳入scopeHash，不能在已授权批次中静默改归属、移除未通过子项或扩大范围。

在原init输入的demands中，主需求own保留原repositories；子需求声明parentId及codeBinding={kind:parent}，省略repositories；明确无代码声明codeBinding={kind:none,reason:<调查结论>}，同样省略repositories。根缺省own，存在parentId的子项缺省parent。一级关系、编号及引用由脚本校验，完整无代码依据由Agent按任务事实判断。

主需求及全部关联子项人工passed后，own才允许claim/publish；parent还需主需求的commit已verified。next只返回具备上述条件的候选，不阻塞其它独立需求。主需求若已有共享提交或交付claim，任何相关子项修改结论均需明确修订范围并保留旧回执，不能覆盖现场。

own仍按原commit回执登记。子需求claim/publish后执行inherit（输入为id/owner），脚本引用已记录的主需求完整仓库/hash，commit.status=inherited、sourceDemand=主需求号；不能record伪造子需求commit或重复inherit。parent不需要额外worktree，也不拥有代码文件发布权。

BOS阶段每个主子需求各自运行。v2的bos/running输入receipt须包含计划的目标需求、代码所属需求、关联项目和精确select；成功时再附实际submitted/resultCodes。例如：

```json
{"id":"101","owner":"delivery-a","phase":"bos","status":"succeeded","receipt":{"requirementCode":"101","codeOwnerRequirementCode":"100","linkProject":"<计划中的关联项目>","select":[{"repo":"<主需求verified仓库>","hash":"<完整主提交>"}],"submitted":true,"resultCodes":["000"]}}
```

目标号、主编号、完整选择及关联项目均需匹配；不能把主需求日志成功回执直接当子需求成功。running/unknown沿原停止与reconcile-bos契约，关联项目不能在恢复中偷偷替换。成功记录保留上述身份，不新建日志状态库。

全部适用子需求日志及主需求日志确认成功后，own执行一次push并按原规则验证远端包含主提交。已经inherit的子需求自动引用push回执并标记inherited，不再执行push；尚未登记引用的子需求可在主提交已存在时继续inherit并恢复各自日志。失败只恢复相应阶段，不能为日志重做Git提交。

none在创建时将commit/bos/push置not-applicable并保存原因；仅在人类passed且所有阶段确实不适用时算完成。其对应record调用被拒绝，不索取BOS凭据或创建空提交。父提交待完成、hash遗失及结果未知均不能转none；旧v1仍保留原适用阶段和回执格式。
