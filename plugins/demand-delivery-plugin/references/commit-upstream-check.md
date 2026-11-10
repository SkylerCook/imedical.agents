# 提交同步复核与 upstream 检查去重

需求提交工具独立对每个 upstream 执行 `pull --ff-only`，其内部已包含 fetch，不额外增加前置 fetch。拉取失败或现场漂移时停止；HEAD 前进以退出码 `3`、`refresh-required` 交给 Agent 复核，不在该轮创建 commit。普通提交授权与需求验收的来源沿用 demand-commit，不由同步结果产生。

## HEAD 前进后的自动接续

已有有效提交授权时，以下流程默认执行，无需用户额外声明“后续自行继续”。自动接续由 Agent 复核后发起，脚本不在返回 `refresh-required` 的同一轮直接提交。

1. 读取旧计划，保留本次调用参数、需求信息、各仓精确文件、完整消息和状态指纹；逐仓核实变化来自本轮成功的 fast-forward，旧 HEAD 是当前 HEAD 的祖先，仓库归属、branch、upstream 均未变。来源不明的 HEAD 漂移不能按本分支接续。
2. 检查 `旧 HEAD..当前 HEAD` 内**每个新增提交**的变更路径和实际 diff，包括 merge commit、重命名旧新两端、新增和删除；用 Git 仓库相对路径核对计划文件集合。读取路径用 NUL 分隔，保留中文、空格等字符。不能只比较两端最终净差异：修改后又撤销仍算触及。任一计划文件被触及时退出本自动分支，定向排查。
3. 审查上游是否影响本需求的共享依赖或行为，复用仍有效的验证，按影响补必要检查。仅路径无交集不能代替此项判断；需要人工重新验收时等待该结论。
4. 使用原参数调用正式 `plan`，通过既有 `--output` 将候选计划写入旧计划所在系统临时目录下的本次唯一新路径，保留旧计划用于对比。逐项比较 kind、demand、noId（旧计划未声明时为 false）、type、subject、title、仓库与文件集合、每仓完整 message、branch、upstream、states 和 fingerprint；`noId: true` 必须沿用 `--no-id`，不传 `--demand null` 或生成假编号。计划文件的暂存内容、工作区内容及状态必须未变。允许变化的只有经复核的 HEAD，以及生成时间、计划路径和执行状态等元数据。信息不足或比较不通过时停止接续，不手工修改 HEAD、指纹或完整性摘要。
5. 全部满足后简述新增提交范围、无交集及内容/消息未变的核查结果，展示候选计划，直接执行 `apply --confirm-commit --verify`。已有授权保持有效；只有范围扩大、需要人工重新验收或业务取舍时才请用户决定，技术阻碍先调查并报告。

同一需求单次交付最多自动接续 **2 次**，每次从 `refresh-required` 进入“重新 plan → Apply”计为一次，首次 Apply 不计入接续次数；不能因换计划路径或中断恢复而清零。保留每轮 Apply 的 2 分钟上限；网络失败、同步失败或超时不自动重试。第三次返回 `refresh-required` 时保留计划与次数并报告“上游持续变动，达到自动接续上限”，不再次索取相同提交授权。真正中断交接时，将次数和当前计划路径记入已有任务记录，不另建台账。

`--plan` 仍只生成计划，不 fetch、pull、暂存或提交。成功后的恢复材料按现有交付记录需要保留，失去用途的本次临时计划与消息文件精确清理。

## hook 协作

技能完成同步及现场校验后，仅对对应 commit 使用 `git -c hooks.requireUpToDate=false commit`。此配置仅在该进程及钩子子进程生效，不写入 global/local 配置。project 无 upstream 时仍按原流程提交，不设置该开关；若使用者自己的 hook 要求 upstream，报告约束冲突，不自动关闭检查。

该开关复用显式 opt-in 的全局 upstream 检查约定。没有 hook 或未启用同步检查时，技能仍执行完整同步；不识别该配置的 hook 按自身规则运行。Git 钩子仍执行；凭据扫描、预算检查等其他检查不变，不使用 --no-verify，不修改 core.hooksPath。手动提交仍使用原有配置。

## 适用与同步

先通过 git config --show-origin --show-scope --get-all core.hooksPath 与 git rev-parse --git-path hooks/pre-commit 核对实际生效钩子，不依据 .git/hooks 文件存在判断生效。只有读取 hooks.requireUpToDate 的钩子支持本去重；不识别该配置的钩子保持原行为，不自动改写或替换。

实现、测试与本文随既有 plugins 路径分发，无安装器改动、无钩子模板、无需改全局配置。已有工程完整更新能力包即可；未发布版本可按授权定点对比同步。同步完成不等于框架已提交、发布或其他工程已更新。

## 验证

node --test plugins/demand-delivery-plugin/tests/commit-upstream-check.test.js

模拟执行覆盖成功后仅 commit 设置开关、pull 失败、HEAD 漂移、现场变化阻断及 local-only 不设置开关。隔离 Git 测试另覆盖本地 bare 远端、正式重新 plan 后接续和合成 hook；不操作业务仓库或真实服务。Windows/macOS/Linux × Node 22/24 沿现有 CI 矩阵执行，配置存在不代表平台已通过。
