# 交接工具与格式

## 调用

使用 Node.js >=22.5.0，仅依赖内置模块。安装/更新入口仍执行现有运行时检查。以下 `<tool>` 是已解析 CapabilityRoot 下的 `plugins/agent-context-kit/scripts/task-handoff.js`，不是项目 cwd 中任意同名脚本。

```text
node <tool> init --project-root <WorkspaceRoot> --title <标题> --task-kind business-demand|framework-maintenance|other [--demand-id <编号>] [--context-file <文件>]
node <tool> list --project-root <WorkspaceRoot> [--all] --json
node <tool> inspect --project-root <WorkspaceRoot> --task-directory <目录> [--context-file <文件>]
node <tool> checkpoint --project-root <WorkspaceRoot> --task-directory <目录> [--context-file <文件>]
node <tool> validate --project-root <WorkspaceRoot> --task-directory <目录>
node <tool> snapshot --project-root <WorkspaceRoot> --task-directory <目录>
```

工具总是输出 JSON；`--json` 是显式兼容选项。成功退出 0，错误或 validate 不通过退出 1。inspect 出现漂移仍返回 0，调用者必须检查 valid/changes；它不执行任何修复。list 默认排除 closed，用 --all 查询历史；损坏任务单列 errors，不隐藏正常候选。

## Context 输入

context-file 是调用时的输入；最终归档到 state.inputs。更新 scopes、关联仓库或证据时传入完整替换内容，不能把不相关仓库带入。一次性输入文件使用任务专属临时目录，写入后清理，不修改全局环境配置。

```json
{
  "repositories": [{"root": "<已确认的绝对checkout路径>", "scopes": ["src/changed-file.js", "tests/related.test.js"]}],
  "entrypoints": ["AGENTS.md", "docs/requirement.md"],
  "evidence": [{"repoRoot": "<同一checkout路径>", "suite": "<已有suite>", "evidenceFile": "<现有验证证据绝对路径>"}]
}
```

省略 context 时只列当前工程/Overlay 声明的源码根，scopes 为空并报告 no-content-scopes。这个默认值不证明源码内容未变；Agent 必须补充实际涉及范围，或在纯讨论需求中说明无源码检查范围。关联工程仅接受显式绝对路径；Overlay 限定 SourceRoot/GitRoot。scopes 使用相对路径，可包含已删除路径；目录递归检查，跳过 `.git`、`.agents`、`node_modules` 和本项目交接目录，避免自引用。需要验证工具链文件时引用实际 canonical 根并显式声明范围。目录 scopes 应尽量小，避免无关扫描。

entrypoints 相对 WorkspaceRoot 或为已声明根内的绝对路径。正文普通 Markdown 文件链接同时检查存在性，HTTP 等外链不联网验证；脚本不检查锚点语义或证明目标内容正确。验证证据使用已有 validation-evidence check，未绑定证据不产生通过结论；证据丢失/失效只是明确的未验证项，不阻止如实交接失败状态。

## 文件约定

handoff.md 的 frontmatter 使用工具生成的 JSON 字符串标量（同时为合法 YAML）；保留 schema/taskKey，title/demandId/taskKind/status/updatedAt 可按事实更新。status 只有 active/closed，表示是否仍有待办，不是验收结论。时间使用带时区的 ISO 8601，目录采用本地时间毫秒戳；补编号不改 taskKey 或目录。

正文至少保留“目标 / 当前断点 / 下一步 / 阻塞项”标题，其它章节按需调整。所有 TODO 完成后才允许 snapshot；结构校验不能代替 Agent 检查正文是否足以接续。

state.json 保存 schema、任务身份、项目根、采集时间、正文 hash、inputs 和 observed；不手工填写已验证结论。observed 中的文件 hash、index hash、HEAD/branch 与 Git 状态用于比较实际现场，changes 的 workspace-changed 需要查看前后具体字段，不表示所有证据一律失效。授权与业务阶段只在正文或引用的既有 run 中维护。

先 inspect 识别差异，再修正文、checkpoint 绑定最新状态，validate 后 snapshot。state 原子替换，正文摘要识别双文件中途终止；正文写入中的变化会使采集失败。历史快照包含当时正文和机器现场，保存时为普通 Markdown 相对链接补上一层父目录，使 history 内链接仍可用；代码块保持原样。正常接续始终指向最新正文。

## 降级与本地保存

init 在实际管理 docs/handoff 的仓库追加精确 `.git/info/exclude` 规则（通过 Git 解析路径，支持 worktree），保留已有内容；不改共享 `.gitignore`。已跟踪交接文件停止初始化并报告，交由用户决定跟踪策略，不自动 git rm。非 Git 工程无需 ignore；Git 缺失或读取异常无法确认排除时停止 init，人工解决后继续。

已有记录在 Git 不可用或无首个提交时仍可只读 inspect，明确报告 Git 未验证；无 Git 时 scopes 文件仍可比较。路径越界、符号链接/目录联接和无效 Overlay 阻止工具访问；这是数据边界，不是会话所有权锁。被声明的根及 scopes 改变后必须重新核实，不能用另一个同名目录冒充原 checkout。

材料不含凭据与患者信息，state 只存路径、状态和哈希，不复制文件正文。不要把任意脚本输出或远端载荷塞入交接。Obsidian 仅作为未来阅读入口，v1 不创建配置、不复制第二套正文。
