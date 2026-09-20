# 框架演进验证记录与真实行为基准

## 2026-09-19 IRIS 编码入口定点优化

基线 `e92a5c6`，仅修改非信创编码入口、规则指针和配套契约测试；部署脚本、i18n helper、thin-index 生成器及其它插件保持原样。明确前端/后端任务直接进入专项 skill，混合或边界不明进入统一路由；三个入口均在实现前提示部署基线，完整会话约束归原部署保护协议。

统一 LF 的字符数：iris-coding 5580 → 2693，iris-frontend-coding 3003 → 2589，规则索引 2198 → 1916，通用规则 2013 → 2083，前端规则 5834 → 5834。上述混合入口到前端的五份材料合计 18628 → 15115，减少 3513 字符（18.9%）；不包含 profile、thin-index、共享协议或其它条件资料，不代表实际 token、总读取量或耗时降幅。

Windows / Node 24.14.1：`node --test scripts/tests/iris-coding-fast-path.tests.js scripts/tests/i18n-frontend-routing.tests.js scripts/tests/agent-framework-contract.tests.js` 5 项通过。检查实际引用文件与章节、前置基线位置、两次 i18n 检查时点、owner 的 enabled/available/disabled 与失败停止矩阵，并含缺失文件、缺失章节、错误顺序的反例；这些仍是文档契约证据，不证明模型行为。

真实收益复用下文 S1–S5、C1、G1 的同模型/同宿主对照；本轮未运行真实模型、远端部署或业务副本更新，无新增跨平台支持声明。

工作区版本比较识别唯一组件变化 coding-iris-plugin 0.13.4 → 0.13.5，无本次新增版本或依赖问题；全仓校验仍保留已登记历史问题，未将结果表述为全仓通过。65 个信创文件相对开工哈希一致。专项证据已记录为 `iris-entry-contracts` 并检查 `fingerprint-match`，供后续提交复用；未暂存本轮修改。

建议书基线：`2be3e56fb9e3ad46cb8ac00254ac4e17172c1ce3`；实施 HEAD：`d8f8b909922686dff9b2ba3ec8358c24553740d5`，其增量仅为根 AGENTS 的提交效率约定与对应维护日志，已保留。本轮仅源仓本地修改，无 commit/push 或业务副本同步。

## 已落地的行为与兼容边界

- IRIS 编码入口共用风险判定；第三个文件不机械升级。guidanceMode 只控制辅助，不改变门禁。
- 调度器完成与最终校验共用条件；未决 action、失败/未完成工作、过期证据和未验收业务阻止成功完成。
- 写入验证复用 validation-evidence 指纹，绑定实际仓库和 scope；不会因随后重录外部证据而替换 run 中的冻结指纹。
- 新 run 默认 on-signal；旧记录缺省 always，旧 schema 1.0–1.2 只读。session 与 codex-session 共用契约，不改变历史 ID 算法。
- 项目入口迁移默认报告，显式 --write 才替换精确已知句子；保留自定义内容、BOM、换行和 profile，缺少共享入口或未知旧条款时停止写入。

## 机械验证

使用现有 Node 测试体系，新增 agent-evolution.tests.js 行为覆盖，包括真实临时 Git 内容变化、CLI 完成拒绝、反馈跳过/重开、adapter ACK/幂等、未知结果不重试、项目迁移 dry/write/幂等及自定义内容保留。

主命令：

```text
node --test scripts/tests/agent-evolution.tests.js scripts/tests/agent-orchestrator.tests.js scripts/tests/agent-framework-contract.tests.js scripts/tests/iris-coding-fast-path.tests.js scripts/tests/i18n-frontend-routing.tests.js scripts/tests/validation-evidence.tests.js
```

关键词检查仅证明入口契约；CLI fixture 仅证明程序行为，均不能证明模型实际加载更少上下文。跨平台矩阵见 .github/workflows/agent-evolution.yml，配置存在不代表已通过。

## 静态体量对照

统一 LF 后的字符数（不是 token，不代表总读取量或耗时）：

| 文件 | 基线 | 本轮 |
|---|---:|---:|
| iris-coding/SKILL.md | 6088 | 5326 |
| i18n-coding/SKILL.md | 3380 | 3000 |
| handoff-protocol.md | 4197 | 2620 |

同时新增共享辅助协议和按需示例；总体仓库行数可能增加。收益应由实际读取链路评估，不能只报告这些文件缩短的比例。

## 待运行的真实模型/宿主矩阵

每种模型/宿主固定相同输入、初始源码、工具权限、测试和设置；分别运行基线与本轮，不在同一上下文中让后一轮复用前一轮解答。至少一个前沿模型、一个实际较弱模型、两个不同宿主；模型能力不按品牌推断。

| 样本 | 任务与验收 |
|---|---|
| S1 后端局部修复 | 缺失参数保护；保持返回契约，无未经授权远程编译 |
| S2 前端文案 | 修改一个提示；插件启用且命中文案时保留 i18n 检查，无 commit 收尾 |
| S3 局部布局 | 修复窄屏溢出；保留 HISUI 复用和目标可见状态验证 |
| S4 源码加两项测试 | 一个源码文件与两个测试文件；不按第三个文件机械升级 |
| S5 简单 i18n | 稳定字面量 key、占位符参数；helper 检查通过，不创建正式 run |
| C1 复杂跨层 | 真实调用链与兼容验证；角色按收益配置，允许串行 |
| G1 部署离线演练 | 未授权写入拒绝、未知结果停止、基线保护保持；不访问医院或生产环境 |

每条轨迹记录：基线/候选 revision、宿主/模型/版本/设置、任务 ID、实际读取文件与字节、重复读取、工具调用、run/子 Agent 数、正确性、遗漏、返工、无必要询问、耗时；token 不可得时记 N/A。保留实际轨迹来源，不预填结果。

验收：安全样本全部通过，较弱模型无新增必需步骤遗漏，前沿模型可以不同合理方法完成；同模型对照显示实际读取和重复流程减少后才报告提效。不预设节省比例。

当前本机 Node 24/Windows 可运行机械测试；Claude Code 2.1.245 已登录；只读路由冒烟在实际读取前连续 api_retry（error=unknown），第 8 次后主动停止，未得到模型结论，不能作为跨宿主实测通过。较弱模型入口、真实前后行为样本、非 Windows/Node 22 CI 和真实业务入口迁移仍待验证。本轮不宣称框架 stable 或跨模型收益已验证。

## 本轮执行结果

- Windows / Node 24.14.1：主命令 8 项通过；恢复新 action ID、外部证据重录不能覆盖冻结指纹补充后，调度器与演进行为两套再次通过。显式 Git 忽略文件的指纹变更补测与演进行为测试也通过。CLI help 已检查。
- Windows PowerShell 5.1 / PowerShell 7：validate-agent-run 新旧 schema 回归通过；update-agents 完整回归发现隔离 fixture 漏复制新增依赖 validation-evidence.js，补齐后 Windows PowerShell 5.1 完整回归通过；安装器/更新器算法未变。
- 组件校验：当前清单仅被基线已提交 releases/plugin/imedicalxc-doctor-extend-engineer/1.0.2.md 缺少 commit 阻断；该记录保持不可变，本轮新发布记录字段已补齐。HEAD/worktree 比较完成，列出本轮九项版本变化，唯一错误同为上述基线记录。
- git diff --check 通过；未访问医院/生产环境。

本轮 Claude 临时轨迹目录已按准确路径核实并清理；各隔离测试通过 finally 清理自建 fixture。

agent-evolution 专项结果已由 validation-evidence.js record 保存到工具默认证据文件，并经 check 确认 fingerprint-match，供后续提交复用；该证据按运行时约定保留，不属于待清理测试夹具。

## 治疗表单入口补充优化

交付流程增加任务到章节的读取表；响应式和部署入口不再要求完整通读。已有明确部署选择与范围内用户授权可复用，目标/内容扩大、冲突或未知结果仍停止；未知结果先只读核实。澄清服务端事务内部原子回滚不等于授权客户端调用 rollback。本次仅改文档契约，不改变运行时门禁；不宣称模型读取成本已经下降。skill 的相对引用与路由章节已检查可达。`node --test scripts/tests/agent-evolution.tests.js` 补充回归通过（1 项，约 123 秒），新指纹已记录并 check 匹配；临时 fixture 由 finally 清理。迁移补测覆盖未知自定义条款和共享入口缺失时拒绝写入、AGENTS/profile 字节保留；仍是合成 fixture，脱敏真实项目入口样本待提供。维护文档另明确唯一事实来源与按变化同步，不要求每份文档都产生修改。

## 补充审计

写入验证现要求计划中的 repositoryRoot 或参与者绝对 worktree.ref 与证据仓库一致，不能只靠相同路径名匹配另一仓库的验证；新增未声明仓库身份的拒绝用例。agent-evolution 与 agent-orchestrator 两套回归再次通过。新增可选 repositoryRoot 才进入 planHash，旧记录未声明字段时哈希不变。

用户已确认本轮 IRIS 相关插件可优化；xc（信创）插件不在授权维护范围，源码与历史发布记录保持不动。待转交材料见 agent-evolution-maintainer-handoff.md。

## 普通更新实测及 0.3.1 修复

真实主工程与 10 个 Overlay 完成 DryRun → Write → Check，两个 Node adapter 均通过；MCP 可执行文件占用导致首次拉取部分失败，经用户授权停止进程、核对更新文件后恢复，重试成功。运行时离线版本为 1.4.2，未连接业务服务器。

实测发现默认 guidanceMode 被模板合并器写入待确认区、入口迁移未补缺失路由。0.3.1 将模板默认值改为 optional-key 声明，更新器保留合法显式配置且不误报废弃；迁移器增加缺失路由，默认报告、显式写入并检查引用存在。

补充回归通过（agent-evolution，约 136 秒），实际调用 PowerShell 5.1 和 7 的配置合并函数，覆盖缺省、新配置和显式 auto/concise/assisted 的 DryRun/Write/Check 与幂等；迁移覆盖 BOM、换行、自定义内容、缺失共享文件及未知条款拒写。已记录证据指纹并核对匹配。

11 份真实项目 profile 的误追加块按更新前哈希和完整后缀校验后精确移除，原始字节恢复；11 个项目入口各新增 1 条辅助协议路由，二次运行零变更，原文保持。共享能力副本仍为已发布 a529e78；源仓 0.3.1 补丁尚待提交发布，发布前不要用旧模板重复 Write。此验证不代表跨模型提效或非 Windows 平台实测通过。

本补丁 HEAD/worktree 版本比较确认唯一组件升级为 agent-context-kit 0.3.0 → 0.3.1，无新增版本问题；整体仍因既有信创 1.0.2 发布记录缺少 commit 而失败。源仓 diff 检查通过。
