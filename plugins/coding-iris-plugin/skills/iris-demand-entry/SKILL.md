---
name: iris-demand-entry
description: Standard IRIS demand lifecycle with --text, --bind, --plan, --commit and --help modes. Extract demand text from Git changes or commits, optionally add --excel/--Excel, then bind a BOSS number and hand off to iris-demand-commit. Not for project delivery.
---

# 标版需求录入与提交衔接

仅用于 `standard`：代码改动或指定提交 → 需求文本 → 用户录入 BOSS → 回填需求号和最终标题 → 标版 commit message → 获授权后本地提交。用户说“根据提交提需求”“代码改完补需求”“生成 demand text”“标版需求闭环”时使用。此入口明确选择 standard，不修改工程默认交付类型；明确 project 请求转交原流程。

默认输出可复制文本；`--excel` 与 `--Excel` 等价，额外生成 29 列导入表，不是必经步骤。Excel 缺少模块编码时先交付文本，再一次性请求缺失字段；不猜测编号、模块编码、指派人或验收完成事实。只按用户明确需要生成 Excel，不因闭环请求自动导出。

## 模式参数（用户入口）

以下是传给 Agent 的 skill 参数，不是 `demand-entry.js` 的 CLI 参数。Agent 解析模式后执行对应步骤，用户不需要编写 spec 或运行脚本。

| 模式 | 用途 | 底层动作 |
|---|---|---|
| `--help` | 显示用法，不读写业务仓库 | 无 |
| `--text` | 从本次改动或指定历史提交生成需求文本与草稿 | collect → Agent 按实际补丁写 spec → prepare |
| `--bind <需求号>` | 回填 BOSS 编号、最终标题，并立即输出提交消息 | bind → message |
| `--plan` | 根据已绑定草稿生成完整提交信息 | worktree：plan；history：message |
| `--commit` | 明确授权所选需求的本地提交，不包含 push | plan → iris-demand-commit apply --confirm-commit --verify |

```text
$iris-demand-entry --help
$iris-demand-entry --text
$iris-demand-entry --text --excel --module-code DT-20
$iris-demand-entry --text --range HEAD~3..HEAD
$iris-demand-entry --text --rev abc123 --rev def456 --Excel
$iris-demand-entry --bind 7060431 --title "BOSS 最终需求标题"
$iris-demand-entry --bind 7060431 --same-title
$iris-demand-entry --plan
$iris-demand-entry --commit
```

附加参数：

- `--excel` / `--Excel`：仅 `--text` 可用，额外生成导入表；单独使用视为 `--text --excel`。`--module-code <编码>` 仅与 Excel 输出搭配，写入草稿 common 的模块编码，不猜测编码。
- `--rev <hash或ref>` 可重复，或 `--range <base>..<head>`：仅 `--text` 可用，二者互斥；缺省使用本次已确认的未提交改动。Agent 将 `--rev` 转成 collect 的 `--commit` 参数；用户层 `--commit` 始终表示正式提交，不能用来指定历史 hash。
- `--repo <GitRoot>`、`--file <精确路径>`（可重复）：仅 `--text` 可用。缺省复用本任务已确认的仓库与文件，不自动扫描整个工作区或选最近提交；来源范围不明确时补问。
- `--item <key>`：用于 `--bind/--plan/--commit`；草稿只有一条需求或当前条目已明确时省略，否则补问要处理哪个 key，不默认批量提交。
- `--draft <draft.json>`：用于 `--bind/--plan/--commit`，跨会话时提供；同会话复用最近明确的有效草稿。找不到唯一草稿时补问，不全盘搜索。
- `--title "最终标题"` 或 `--same-title`：仅 `--bind` 可用，二者互斥；`--same-title` 表示用户确认 BOSS 沿用所选条目的原始 title。均缺省时仅在上下文已确认最终标题时复用，否则补问。

模式必须单选。未知参数、缺参数值、无效组合或显式模式与自然语言意图冲突时显示用法并停止，不执行写入。`--help` 单独使用；没有模式时继续按明确自然语言路由，仅 Excel 开关的兼容调用按上述规则处理。`--bind` 不可与 `--commit` 合并，先保存映射并展示消息，再由单独的提交模式表达授权。

`--plan` 完成后不追问是否提交；`--commit` 已表示所选需求本地提交授权，展示计划后直接沿用原提交门禁，不重复询问。历史来源的 `--plan` 明确报告“仅生成历史提交对应消息，未创建可执行提交计划”；历史来源的 `--commit` 在 Git 写入前停止，不隐式改写历史。所有模式固定 standard，不修改工程默认类型。

## 取证与整理

1. 读取目标工程 AGENTS、profile 和本任务范围；Overlay 按 manifest 已声明 SourceRoot/GitRoot 定位，不扫描父目录或 sibling。区分取证仓库和最终提交仓库，不因来源是提交记录便假定仍有待提交代码。
2. 读取 [操作与数据协议](../../references/standard-demand-entry.md)。用 `demand-entry.js collect` 获取实际补丁：未提交改动必须传精确 `--file`；历史使用指定 `--commit`（可多次）或 `--range`。每条需求每仓库一份取证；跨仓库保持各自归属。脚本只读 Git，不执行 pull/add/commit。
3. 必须阅读取证 JSON 中 staged/unstaged/history.patch 和未跟踪内容，必要时补读关联源码与验证记录；不能只凭提交标题、文件名推断业务效果。二进制、非 UTF-8 内容和外部运行行为不能凭补丁证明，明确证据限制。确认同一文件没有混入其它需求，否则先按既有工具拆分，不自动提交整文件。
4. 按独立业务目的拆条目。新增功能、功能改进和缺陷修复均可形成需求；测试、兼容与内部配套归入服务的需求。用业务语言写名称、背景、内容，不编造原始业务动机、医院事实、负责人或已验收结果。推断明确标注，已知背景不足则写待确认并通过当前可用 Question/文本补充。
5. 写 spec，运行 `prepare`，默认生成 `draft.json` 和逐条 `<key>.txt`；需要时加 `--excel`。文本与 Excel 描述使用同一渲染函数。每条文本单独连续成块，不混入 Git 归属或工具说明；归属与验证信息留在草稿和交付说明中。用户可以直接复制到 BOSS。

正式产物保存在目标工程约定的需求产物目录；无既有约定时使用 `docs/work/standard-demand/<task>/`，不放能力包源码或 `.agents/`。临时 spec/取证按工程临时目录规则，draft 已内嵌取证后可清理本轮临时输入。含源码补丁的 draft 是私有交接数据，不自动加入 Git，不上传 BOSS；给 BOSS 的只有用户选用的文本或 Excel。跨会话恢复读取用户指定 draft，不全盘搜集需求资料。

## 用户返回 BOSS 编号

- 使用 `bind --item <key> --demand <编号> --title <BOSS最终标题>` 保存新草稿；一条需求对应一个编号，不假定多个编号的顺序。回填最终标题是预期动作，保留原始草稿标题作来源，不要求两者字面相同。若 BOSS 内容实质改变业务范围，先复核代码和需求映射。
- 闭环任务中回填编号后，直接运行 `message` 输出每仓库完整三行 standard 消息，不重复询问是否继续。只给需求号没有最终标题时，仅在用户已明确 BOSS 沿用原题时复用原题，否则补问最终标题。
- `message` 先检查证据。工作区/暂存区/HEAD 漂移时重新取证、复核内容并形成新草稿，保留已确认的 BOSS 映射；不能沿用旧代码说明。历史提交使用固定完整 hash，不因当前分支前进而失效。
- 纯历史来源到消息生成即完成该阶段；不创建空提交，不自动 amend/rebase/cherry-pick。用户若要求修改历史或移植到另一仓库，应作为明确的独立操作处理，不把原始已提交文件假装成当前变更。

## 正式提交

只对 worktree 来源使用 [iris-demand-commit](../iris-demand-commit/SKILL.md)：`demand-entry.js plan` 校验草稿后转交原 `commit-demand.js plan`，固定 `--kind standard`，复用精确文件、每仓库修改说明、BOSS 编号与最终标题。不能把 draft 当作 commit plan，也不能手工编辑生成的 plan。

生成消息或回填编号不授权 commit。用户明确要求提交时，沿用已有授权展示 plan 后执行原 `apply --confirm-commit --verify`，不重复确认；pull 门禁、漂移停止和多仓库部分成功报告均沿用原 skill。已完成验证的有效证据复用，未知验证状态如实报告。push、部署与 BOSS 写入不包含在本流程；BOSS 由用户录入。提交不改变业务验收状态。

无专用 Question 工具时用简短文本补问；无此脚本运行能力时可只读 Git 并生成带明确来源的文本/消息，不宣称已保存草稿、生成 Excel 或执行提交。
