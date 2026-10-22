# BOS 代码更新日志：接口与配置

字段映射来源为 Qtz HIS（`qiupeng.qtz-his` 1.6.69）`dist/extension.js` 的只读行为分析，不是上游正式协议文档；没有复制上游实现代码，上游改版后需要重新核对。

## 命令与配置

从已加载 skill 的真实目录解析 `../../scripts/bos-code-update-log.js` 的绝对路径，以 Node.js >=22.5.0 执行：

```text
node <脚本绝对路径> defaults
node <脚本绝对路径> repos [--workspace <目录>] [--depth <层数>]
node <脚本绝对路径> commits --repo <仓库路径> [--limit <条数>]
node <脚本绝对路径> plan '{"select":[{"repo":"<仓库路径>","hash":"<提交>"}]}' [--user <Git用户>]
node <脚本绝对路径> submit '{"select":[{"repo":"<仓库路径>","hash":"<提交>"}]}' --confirm [--user <Git用户>]
```

`defaults` 离线校验本技能配置，只输出来源标记、token 是否已配、关联项目和超时，不返回 token。`repos` 有深度限制，识别 `.git` 目录与 submodule/worktree 的 gitdir 文件，跳过隐藏目录和 node_modules，不跟随目录链接枚举。`commits` 列出最近提交；`plan` 返回 payload 与摘要，不联网。未确认的 `submit` 返回摘要、退出码 1，不发请求。正常结果为 stdout JSON，错误为 stderr 和退出码 1。

配置文件与需求查询共用 `BOS_MCP_CONFIG`，路径和初始化约定见 [共享配置](usage.md)。本技能只读顶层 `bos-code-update-log` 段：

| 字段 | 要求 | 用途 |
|---|---|---|
| `connection` | 公司连接填写 `company` | 从 [公司默认值](company-defaults.json) 的 `codeUpdateLogUrl` 读取地址 |
| `url` | 自定义连接填写，与 `connection` 二选一 | HTTPS 地址，不含用户信息、查询参数或 fragment |
| `token` | 必填，不能为 TODO | `Authorization: Bearer <token>`，与需求查询 token 独立 |
| `linkProject` | 必填，不能为 TODO | 关联研发项目 |
| `timeout` | 可选，默认 30000 | 正整数毫秒数 |
| `enabled` | 可选 | `false` 只禁用本技能 |

`plan` 和 `submit` 都先校验本技能段。`configSource` 为 `private-file:bos-code-update-log`。不读编辑器设置、需求查询凭据或日志专用连接环境变量，不进行配置来源回退。公司地址是组织默认值，不据 URL 路径推断生产/测试用途，实际环境与账号权限分别验证。

## 提交信息与聚合

格式由 [demand-commit](../../demand-delivery-plugin/skills/demand-commit/SKILL.md) 维护：首行 `<type>(<需求号>):<菜单名称>`，正文包含 `修改说明:`；standard 的 `需求描述:` 只用于切分，不进入 payload。没有需求号、菜单或修改说明时整体停止。

一次选择明确的 repo/hash，解析为完整 commit hash；同需求号组成一条 payload，同需求的仓库/提交进入 `Repository`。菜单名称和修改说明按选择顺序分别去重、换行合并，不丢弃后续仓库的说明。重复选择同一仓库提交只处理一次。`UserCode` 来自 `--user` 或首个仓库的当前 Git user.name。

需求处理在全部提交 verified 后自动准备日志，选择映射、独立授权、失败恢复与已确认结果去重以 [bos-demand workflow](../../../workflows/bos-demand.workflow.md#提交后的-bos-代码更新日志) 为准。CLI 的选择内去重只作用于单次调用，不提供服务端幂等或跨次提交去重；不得据此自动重试。plan 与 submit 复用同一选择及明确的提交用户，期间配置或选择变化须重新核对计划。

## 请求与结果

向已配置地址 POST JSON **数组**。每项字段为：

| 字段 | 来源 |
|---|---|
| `TradeCode` | 固定 `1000` |
| `UserCode` | `--user` 或 Git 用户 |
| `RequirementCode` | 提交首行的数字需求号 |
| `MenuNames` / `ModifyDesc` | 上述解析与聚合结果 |
| `LinkProject` | 本技能的 `linkProject` |
| `Repository[].Project` | origin 路径末段去掉 `.git`，无 origin 时使用仓库目录名 |
| `Repository[].CodeRepositoryVersion` | 完整提交 hash |
| `Repository[].ModifyFiles` | 文件列表，换行分隔 |
| `Repository[].AddLines` / `DelLines` | git numstat 合计，二进制记 0 |

拒绝重定向。HTTP 2xx 且响应对象或非空数组中的每个 `ResultCode` 均为 `000` 才报告成功；非 JSON、缺失结果码、任一失败码均失败。错误与成功结果中的已知 token 脱敏。超时/连接异常不自动重试，可能已有服务端写入，先核对再决定。

## 与上游的差异与验证范围

保留上游字段映射和数字需求提交格式。上游编辑器设置改为按技能分段的仓外共享文件；选择范围由明确 repo/hash 决定，不限制是否已推送；确认通过 `--confirm`；超时统一 30000ms；多仓不同说明全部保留；提交后不询问或执行 push。

来源工程曾报告该默认地址上的单账号接口样本，不能替代本框架版本的验收。本次回归只使用合成数据、隔离 Git 仓库和 mock HTTP，不连接或写入真实 BOS。Windows/macOS/Linux、Node 22/24 由现有 CI 矩阵执行，配置存在不等于结果通过；真实地址、账号权限及服务端去重策略仍需各自取证。

## 主子需求复用提交

普通select保持原行为。新输入与select互斥：

```json
{"bindings":[
  {"requirementCode":"100","codeOwnerRequirementCode":"100","select":[{"repo":"<GitRoot>","hash":"<完整40位主提交>"}]},
  {"requirementCode":"101","codeOwnerRequirementCode":"100","select":[{"repo":"<GitRoot>","hash":"<同一个完整主提交>"}]}
]}
```

plan/submit均接受该JSON，不新增命令。Agent只从已确认的主子关系、各自编号和verified提交结果构造映射；编号为数字字符串，映射必须使用完整hash。CLI验证真实commit中的需求号等于codeOwnerRequirementCode，缺失或不一致停止，不能只提供任意目标号覆盖解析结果。代码来源未知时保留待处理，不用none掩盖缺证据。

每个目标需求独立生成payload，RequirementCode使用目标编号；Repository的hash/文件/行数及菜单、原修改说明来自同一真实提交，子需求说明附共享主需求和hash。summary额外提供codeOwnerRequirementCode供回执关联。提交说明与历史不改写，BOS页面及服务端接口不改动。

单次调用按目标编号、关联项目、真实Git仓库身份与完整hash去重；同仓不同worktree去重，不将不同子需求误当重复。关联项目为本次配置中的固定LinkProject。跨次去重继续复用任务/验收回执，不新增全局数据库；已确认成功的不重发，未知结果先核对。共享统计表示复用同一提交，不宣称各子需求独立新增同一批代码。

明确none的条目由调用方先记录代码日志not-applicable及原因，不调用plan/submit、不读取日志凭据。select为空、缺少hash或只有未完成提交仍报错，不等价于无代码。新协议的批次回执需同时保存目标编号、代码所属编号、linkProject和精确select，见[验收批次](../../demand-delivery-plugin/references/acceptance-session.md#主子需求及无代码条目-v2)。
