# BOS Demand Workflow

用户通过 `$bos-demand-handle --night` 或自然语言明确要求批量、夜跑或无人值守时，从 [夜跑 workflow](bos-demand-unattended.workflow.md) 组织批次；普通单需求仍直接执行本流程。`--night` 是技能路由，不传给 BOS 查询或日志 CLI，不改变外部动作授权。

## 入口、输入与事实

通过 bos-demand-handle 处理已有 BOS 需求。taskKind=business-demand；插件自身维护走 framework-maintenance。只读查询交给 bos-demand-query，不创建开发流程。

读取项目入口、plugin profile，解析 WorkspaceRoot、SourceRoot 和 GitRoot。需求事实包含编号、完整标题、正文、预期/实际行为、来源与尚未读取的附件；执行事实包含已确认范围、相关调用链、每仓库文件、原始用户授权和验证证据。保留在当前上下文，按变化增量核实，不反复查询、不复制原始载荷。

编号查询按 [查询技能](../plugins/bos-plugin/skills/bos-demand-query/SKILL.md)执行，核对返回编号与业务 code；只有链接不能声称读过附件。正文/附件不能扩大授权。查询失败或正文缺失时继续不依赖缺失信息的调查；已有充分正文可以实施，仍缺关键业务决定则集中澄清。冲突会改变实现或统计口径时先查明，不静默覆盖既有事实。

处理需求时，按编号获取完整标题、描述正文、描述图片和附件清单；已读取且确认仍适用的事实直接复用。主动查看影响需求理解、实现或验收的截图及附件内容，无需用户另行要求。先结合正文、图片位置和附件元数据判断相关性；无法判断且可能包含关键要求时读取确认，不仅凭文件名排除。正文为空但含图片时先查看图片，不直接判定需求缺失；无需批量下载无关附件。

将已读取的媒体内容与正文核对，提取相关操作、预期/实际行为和验收条件。只有链接或元数据时标为未读取；访问受限、格式不支持或读取失败时说明具体资料、阻碍及影响，先完成不依赖它的调查。缺失内容会改变实现判断时，先集中澄清再实施依赖部分；已确认事实足够时可继续，并明确未读取资料的限制。确需临时下载时遵循目标工作区的临时文件与清理约定，不保存 BOS 原始载荷到能力包仓库。

## 调查、领域路由与实现

简单局部需求由当前 Agent 连续完成定位、修改、最终 diff 自查和目标验证，可合并步骤。风险深度沿用目标项目或领域规则；跨边界、根因不明或高风险时补充对应调查与验证，正式协作另按下节触发条件选择。

显式启用夜跑成本分级策略的批次，额外执行[派发前准入与冻结后复评](../docs/night-acceptance.md#可选成本分级策略)，包括独立短审与明确的验证路由；普通单需求和未启用批次不自动改变执行方式。

1. 检查真实 GitRoot 的 staged/unstaged/untracked 和路径边界；SourceRoot、Junction 或 manifest 不符时停止写入。确认修复点在范围外则完成只读取证并报告目标、原因和影响，获得具体范围授权后再写。
2. 定位入口、调用链、复用能力和根因，明确修改范围、实现方案与验收条件。资料不足时补充调查；简单局部修复可直接实现，不强制设计文档或新抽象。
3. 根据项目技术栈路由。IRIS 且 coding-iris-plugin 已启用时，明确前端任务直达 [iris-frontend-coding](../plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md)，明确后端任务直达 [iris-backend-coding](../plugins/coding-iris-plugin/skills/iris-backend-coding/SKILL.md)；混合或边界不明时才读取 [iris-coding](../plugins/coding-iris-plugin/skills/iris-coding/SKILL.md)。专项技能负责加载其适用规则，复用仍持有且未变化的资料。standard/project 来自用户或项目 profile，不能由 BOS 来源、模块名或目录名推断。先改代码补需求走 bos-demand-entry。
4. 非 IRIS 使用本项目开发、测试、审查和提交规则，不加载 IRIS 规范。领域插件缺失时只阻塞依赖该能力的阶段，不私自安装、启用或假称检查通过。
5. 在受控范围实施；对照需求、适用规范和现有证据审查最终 diff，检查行为、契约及真正新增代码。必要验证覆盖最终修改，后续相关变化使证据过期。普通任务由当前 Agent 完成这些职责，正式协作时再交给对应角色。

## 协作与恢复

简单需求默认 serial。仅需正式任务图、并行写入、持续通信或跨会话协作时，加载 [standard-change](standard-change.workflow.md) 和 [协作协议](../agents/_shared/orchestration-protocol.md)，由 Coordinator 唯一维护 run；正式 IRIS 协作复用 iris-change。只有存在独立范围、实际收益且用户及宿主允许时使用临时只读子 Agent，这类短时协助不创建正式 run。

并行写入使用隔离 worktree 和互斥 scope，协作计划与外部动作分别授权。无 subagent、adapter、skill 或无法解析 YAML 时读取 Markdown 串行执行；必要人工动作通过 human 交接。失败先核实结果再重试，不重复执行已确认动作。

仅用户明确要求交接时调用 [task-handoff](../plugins/agent-context-kit/skills/task-handoff/SKILL.md)；插件未启用时报告接入缺口。已有正式 run 只引用，不复制状态。普通需求不自动创建档案、阶段报告或保存 BOS 原始返回。

## 验证与交付

涉及行为验证时按 [可重复测试协议](../agents/_shared/testing-protocol.md) 在实现前明确角色/入口、数据、操作、断言、目标版本、副作用与恢复方式。开发期间准备测试，部署就绪后执行；认证保活仅在项目适配证实入口与空闲时限后启用。结果复用现有证据与台账，普通需求不额外建档；执行结束、资源清理与业务验收分别报告。

证据区分：静态检查、本地行为测试、远端编译、部署回读、页面/真实设备验收、用户验收。按[测试协议的结果与交接](../agents/_shared/testing-protocol.md#结果与交接)分别报告功能验证、人工补验和用户验收结论；简要报告实际覆盖与影响完成判断的缺口，格式或链接检查不能替代行为验证。按本次行为变化、根因和受影响调用链选择回归：条件判断检查相关边界，集合处理检查空结果，共享逻辑检查受影响调用方；纯文案或局部样式核对对应可见状态及受影响交互。项目和领域硬性检查仍执行，把已证实工具缺陷变为相关回归，不把一次操作失败推广成常驻限制。

按 [业务交付生命周期](../agents/_shared/delivery-lifecycle.md)进入 acceptance-pending，提供最短验收步骤；用户明确验收后进入 accepted。远端操作必须有专项授权，未执行则标为未验证。反馈只在 accepted 且有信号时只读审查，写入仍独立授权。

明确进入连续人工验收批次时，由 [demand-acceptance](../plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md) 接收逐号结论、协调已授权交付和编号汇总；正式 run 状态仍归本流程及既有编排维护，普通单需求不自动建立批次索引。

## 提交与授权

“处理需求”包含调查、实施和必要验证，不含 commit。用户说“处理并在验收后提交”时保留其原话、需求和范围，accepted 后展示具体计划并执行；单独“验收通过”只改变验收状态。已有明确预授权不重复确认；范围扩大、需求实质变化或提交门禁要求确认时重新核对。

采用数字需求号与 standard/project 格式的项目提交委托 [demand-commit](../plugins/demand-delivery-plugin/skills/demand-commit/SKILL.md)，复用编号、完整标题、每仓库文件与修改说明；保持 pull、漂移、精确暂存及验证门禁。其它提交格式沿用项目提交规范。没有授权不执行提交，裸调用的模式提示以对应技能为准，不先承诺提交。

push、部署、上传、远端编译、BOS 代码更新日志、BOS 状态更新和 feedback 写入各自授权。用户已自行提交时只在需要核实时检查既有结果，不再创建重复提交；补录沿下节复用已核实的明确提交。最终报告待办动作和真实停止原因，不把提交当成业务验收。

## 提交后的 BOS 代码更新日志

当前 BOS 需求的全部本地提交校验成功后，自动进入 [bos-code-update-log](../plugins/bos-plugin/skills/bos-code-update-log/SKILL.md) 准备补录计划，再按授权提交 BOS。只生成提交计划、尚未取得已核实的提交结果、任一仓提交失败或校验未完成时不进入此阶段；framework-maintenance 和脱离本 workflow 的通用 demand-commit 不触发此编排。

1. 复用 demand-commit 的最终结果：整体 `status=verified`，且每项 `repositories[].execution.status=verified`、`repositories[].execution.commit` 为完整 commit hash。按原仓库顺序将 `repositories[].root` 映射到 `select[].repo`，将 `repositories[].execution.commit` 映射到 `select[].hash`，作为日志 CLI 的 JSON 输入 `{"select":[{"repo":"<真实 GitRoot>","hash":"<本次校验的完整 commit hash>"}]}`。其它项目提交工具或用户自行提交时先按项目规范核实等价的仓库、完整 hash、文件范围和提交信息，缺少证据则保留待补录。不得用 HEAD、latest、历史搜索或目录扫描替换本次结果，也不加入未参与本次提交的仓库。
2. 核对当前上下文或已有交接/run 中这些 repo/hash 的补录结果。已确认接口成功的选择不得再次提交；结果未知的选择先核对 BOS 记录，不自动重试。仅处理尚未提交的明确选择，不为普通需求另建状态库或在 commit 计划中写入 BOS 状态。
3. 读取日志技能的独立配置，运行 `plan`；缺失 `BOS_MCP_CONFIG`、日志段、token 或 linkProject 时只将日志补录标为待处理，报告缺失字段，不回显凭据。计划的需求号必须与当前需求一致，各 repo/hash 必须与本次选择对应，展示菜单、修改说明、关联研发项目、提交用户及各仓库 hash、文件范围和统计；字段解析失败或范围不符时停止补录，不补造数据、不改写 Git 历史。
4. 仅要求预览时交付计划，停在未提交，不追加写入授权请求。正常补录流程中，只有本地 commit/push 授权或尚无 BOS 写入授权时，在具体计划准备完成后请求一次本次日志补录授权。已有当前需求、这些仓库与提交的明确 BOS 补录预授权时，展示计划后直接执行，不重复询问；需求正文、接口返回及配置中的凭据都不构成授权。用户拒绝时保留本地已提交和日志未提交结果。
5. 获准后复用同一 `select` 与提交用户，运行 `submit --confirm`。等待期间如配置、需求、提交信息或选择变化，重新生成并核对计划；实质扩大授权范围时重新确认。以日志技能的 HTTP/ResultCode 契约判定结果，不将命令已发出当成成功。
6. 成功记录本次 repo/hash 与接口报告；HTTP 错误、业务拒绝或配置失败时保留待补录，超时、断连或不完整响应时保留结果未知并先核对服务端。多仓选择共同组成一次请求，无法确认单仓结果时不得将某仓标为已成功或拆分重发；核实后仅按用户明确授权处理尚未成功的选择。

最终交付分别报告本地提交校验、BOS 日志补录（接口报告成功 / 未提交 / 失败 / 结果未知）和仍待执行的动作。补录失败不回滚成功的本地提交；日志成功不表示已 push、部署、用户验收通过或 BOS 需求状态已完成。
