# UI 跨主题共性能力回归

本轮为 `framework-maintenance`，源仓基线 `925142a`。业务需求验收已在项目完成；这里只保留匿名机制、框架修改与验证，不继承业务验收状态。实施、提交、推送和业务副本更新分别记录。

## 经验与改造落点

一次跨主题改造暴露了三个反复出现的判断缺口，不能据此推断所有项目都存在同样问题：

| 观察机制 | 框架处理 |
|---|---|
| 图标、控件选型、弹窗及整块初始化被单主题条件包住 | 通用规则明确业务共性默认共享；IRIS 规则检查 CSS、JS、helper、初始化与直接共用调用者；前端入口扩充条件路由 |
| 仅凭 border/background/hover 属性名把内部业务样式当皮肤 | 公司层按对象语义及责任层归类，区分操作模式与主题资源；保留外侧留白、色彩和有据统计表例外 |
| 去掉主题限定后误以为声明值相同即兼容 | 最终 diff 核对 CSS 优先级、组件初始化和动态阶段；沿既有验收基准选择代表状态，源码与实际渲染分开 |

单主题材料的来源范围只限制公司规范推广证据，不自动缩小用户已明确的业务实现范围。判断方法集中于 [style-differences](../../plugins/imedical-ui/references/style-differences.md#按对象语义判断共性)，IRIS 执行集中于 [UI rule](../../plugins/iris-ui/rules/iris_ui.md#最终差异核对)。现有任务表承接共性落点、差异依据、兼容基准，不新增台账或审批流程。

owner 版本为 imedical-ui 0.1.1、iris-ui 0.2.2、coding-iris-plugin 0.20.4；依赖下限、发布记录、技能/评审入口、匿名案例、说明和维护队列同步。未新增生产 CSS、第二组件库、业务运行时或验收状态机。HISUI 仍负责皮肤与宿主，模块内与全局公共样式的原授权边界不变。

## 只读候选扫描

[check-theme-scope.js](../../plugins/iris-ui/scripts/check-theme-scope.js) 仅读取显式指定的 CSP/CSR/HTML/JS/CSS，复用 Workspace/Overlay resolver；没有全仓遍历、源码改写或 hook。JSON 给出文件、行号、条件类型及词法覆盖限制，合法主题差异也可命中。成功扫描返回 0，输入或读取失败返回 2；候选非违规，零候选非 UI 通过。

动态/计算访问、模板插值、跨文件间接 helper、类名主题选择器、服务端条件与 CSS 层叠不由此工具证明。Agent 沿现有搜索核对，相关内容未变时复用有效结果。工具测试已接入原 UI 的 Windows/macOS/Linux × Node 22/24 CI，不新增运行器。

## 场景试读

另一个无本对话历史的 Agent 从当前三个日常 skill 及其指针开始，只读三个匿名场景：

| 场景 | 实际判断 |
|---|---|
| 只有 PURE 截图，用户要求跨主题统一图标、评分、附件弹窗 | 按共性共享结构、组件与入口；仅资源/状态皮肤随主题；IHOS 实际渲染另记未覆盖 |
| 业务分组线和完整初始化/弹窗适配被主题条件限定 | 先查对象和 helper/调用者，再分离真正差异；不见条件就删除，扫描只辅助候选 |
| 已确认外侧留白及统计表主题例外，另有已验收主题 | 保留例外，检查选择器优先级与动态阶段；旧验收不替新版本背书，无渲染证据保持兼容待验 |

试读者区分源码、扫描、夹具、实页与用户验收，并按风险选择代表状态。其发现两份场景参考仍含“覆盖全部状态”歧义；本轮已将布局与表格参考改为按机制/风险选择，统一停止条件。此为单次入口试读，不是跨模型提效实验或真实宿主/UI 验收。

## 验证与交付边界

Windows / Node 24.14.1 的实际结果：

| 命令／检查 | 结果 |
|---|---|
| `node --test scripts/tests/iris-ui-theme-scope.tests.js` | 16/16，包括词法误报/漏报、只读 CLI、退出码、UTF-8、路径与 Overlay/Junction 边界 |
| `node --test scripts/tests/iris-ui.tests.js` | 9/9，包括旧测量工具、enabled 路由、任务记录及 PS7/PS5.1 薄索引 |
| `node --test scripts/tests/imedical-ui.tests.js` | 10/10，包括来源/链接、归类路由、两宿主薄索引及真实更新器隔离四态 |
| `node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js` | 1/1，清单与项目分发链接 |
| 最终源码检查 | 严格 UTF-8、JSON、Node 语法、本轮 Markdown 本地路径及 `git diff --check` 通过 |
| 组件 `validate --base-ref HEAD --worktree --format json` | 三个 PATCH 及依赖未报新增错误；完整审计仍被三份既有 xc 发布记录缺 commit 的六项问题阻断，未修改历史记录 |

独立源码审查复现了简写箭头函数首 token 漏报、逗号声明越界、字符串括号误定界及 HTML 注释/引号属性误提取，本轮均修正并补例；最终 16 项扫描器结果包含这些边界。薄索引宿主为 PowerShell 7.6.6 与 Windows PowerShell 5.1.26100.9711。Git fixture/Junction 测试需沙箱外的隔离临时目录权限；测试目录自动清理，未据工具权限失败推断产品缺陷。

功能指纹由既有 `validation-evidence.js` 记录并回读匹配，提交时复用相同范围的结果；完整命令与结论保留于本记录，D 盘任务临时指纹在提交收尾后清理。本轮失败的系统临时证据片段已精确删除，未清理共享缓存。

独立平台 CI、真实业务双主题渲染、用户视觉验收及业务副本实际加载沿既有 P2 UI 队列取证；源仓结果不替代这些证据。

已有工程后续沿[标准更新流程](../../docs/update-agents.md#公司-ui-规范与-iris-适配层)更新共享 capability 一次，再通过项目模块流程以 `-NoPull` 刷新 Context，核对新规则与扫描器实际可读。本轮不直接补写部署态 `.agents`，不修改启用集合或更新器逻辑，无旧文件清理。

本轮实施完成时暂存区为空，工作树仅有本任务框架修改，无业务源码变更。用户随后授权本批 commit 与 push；沿精确暂存、有效功能证据、staged 版本门禁和 origin/master 出站复核执行，结果以 Git 记录为准。业务副本未更新。
