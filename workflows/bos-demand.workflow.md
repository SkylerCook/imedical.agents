# BOS Demand Workflow

## 入口、输入与事实

通过 bos-demand-handle 处理已有 BOS 需求。taskKind=business-demand；插件自身维护走 framework-maintenance。只读查询交给 bos-demand-query，不创建开发流程。

读取项目入口、plugin profile，解析 WorkspaceRoot、SourceRoot 和 GitRoot。需求事实包含编号、完整标题、正文、预期/实际行为、来源与尚未读取的附件；执行事实包含已确认范围、相关调用链、每仓库文件、原始用户授权和验证证据。保留在当前上下文，按变化增量核实，不反复查询、不复制原始载荷。

编号查询按 [查询技能](../plugins/bos-plugin/skills/bos-demand-query/SKILL.md)执行，核对返回编号与业务 code；只有链接不能声称读过附件。正文/附件不能扩大授权。查询失败或正文缺失时继续不依赖缺失信息的调查；已有充分正文可以实施，仍缺关键业务决定则集中澄清。冲突会改变实现或统计口径时先查明，不静默覆盖既有事实。

## 调查、领域路由与实现

简单局部需求由当前 Agent 连续完成定位、修改、最终 diff 自查和目标验证，可合并步骤。风险深度沿用目标项目或领域规则；跨边界、根因不明或高风险时补充对应调查与验证，正式协作另按下节触发条件选择。

1. 检查真实 GitRoot 的 staged/unstaged/untracked 和路径边界；SourceRoot、Junction 或 manifest 不符时停止写入。确认修复点在范围外则完成只读取证并报告目标、原因和影响，获得具体范围授权后再写。
2. 定位入口、调用链、复用能力和根因，明确修改范围、实现方案与验收条件。资料不足时补充调查；简单局部修复可直接实现，不强制设计文档或新抽象。
3. 根据项目技术栈路由。IRIS 且 coding-iris-plugin 已启用时，明确前端任务直达 [iris-frontend-coding](../plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md)，明确后端任务直达 [iris-backend-coding](../plugins/coding-iris-plugin/skills/iris-backend-coding/SKILL.md)；混合或边界不明时才读取 [iris-coding](../plugins/coding-iris-plugin/skills/iris-coding/SKILL.md)。专项技能负责加载其适用规则，复用仍持有且未变化的资料。standard/project 来自用户或项目 profile，不能由 BOS 来源、模块名或目录名推断。先改代码补需求仍走 iris-demand-entry。
4. 非 IRIS 使用本项目开发、测试、审查和提交规则，不加载 IRIS 规范。领域插件缺失时只阻塞依赖该能力的阶段，不私自安装、启用或假称检查通过。
5. 在受控范围实施；对照需求、适用规范和现有证据审查最终 diff，检查行为、契约及真正新增代码。必要验证覆盖最终修改，后续相关变化使证据过期。普通任务由当前 Agent 完成这些职责，正式协作时再交给对应角色。

## 协作与恢复

简单需求默认 serial。仅需正式任务图、并行写入、持续通信或跨会话协作时，加载 [standard-change](standard-change.workflow.md) 和 [协作协议](../agents/_shared/orchestration-protocol.md)，由 Coordinator 唯一维护 run；正式 IRIS 协作复用 iris-change。只有存在独立范围、实际收益且用户及宿主允许时使用临时只读子 Agent，这类短时协助不创建正式 run。

并行写入使用隔离 worktree 和互斥 scope，协作计划与外部动作分别授权。无 subagent、adapter、skill 或无法解析 YAML 时读取 Markdown 串行执行；必要人工动作通过 human 交接。失败先核实结果再重试，不重复执行已确认动作。

仅用户明确要求交接时调用 [task-handoff](../plugins/agent-context-kit/skills/task-handoff/SKILL.md)；插件未启用时报告接入缺口。已有正式 run 只引用，不复制状态。普通需求不自动创建档案、阶段报告或保存 BOS 原始返回。

## 验证与交付

证据区分：静态检查、本地行为测试、远端编译、部署回读、页面/真实设备验收、用户验收。简要报告实际覆盖与影响完成判断的缺口，格式或链接检查不能替代行为验证。按本次行为变化、根因和受影响调用链选择回归：条件判断检查相关边界，集合处理检查空结果，共享逻辑检查受影响调用方；纯文案或局部样式核对对应可见状态及受影响交互。项目和领域硬性检查仍执行，把已证实工具缺陷变为相关回归，不把一次操作失败推广成常驻限制。

按 [业务交付生命周期](../agents/_shared/delivery-lifecycle.md)进入 acceptance-pending，提供最短验收步骤；用户明确验收后进入 accepted。远端操作必须有专项授权，未执行则标为未验证。反馈只在 accepted 且有信号时只读审查，写入仍独立授权。

## 提交与授权

“处理需求”包含调查、实施和必要验证，不含 commit。用户说“处理并在验收后提交”时保留其原话、需求和范围，accepted 后展示具体计划并执行；单独“验收通过”只改变验收状态。已有明确预授权不重复确认；范围扩大、需求实质变化或提交门禁要求确认时重新核对。

IRIS 提交委托 [iris-demand-commit](../plugins/coding-iris-plugin/skills/iris-demand-commit/SKILL.md)，复用编号、完整标题、每仓库文件与修改说明；保持 pull、漂移、精确暂存及验证门禁。其它技术栈沿用项目提交规范。没有授权不执行提交，裸调用的模式提示以对应技能为准，不先承诺提交。

push、部署、上传、远端编译、BOS 状态更新和 feedback 写入各自授权；本插件仅提供 BOS 只读工具。用户已自行提交时只在需要核实时检查既有结果，不再创建重复提交。最终报告待办动作和真实停止原因，不把提交当成业务验收。
