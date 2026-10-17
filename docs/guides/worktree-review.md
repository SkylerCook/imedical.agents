# Worktree 创建与审阅交付

创建 worktree 的完成条件同时包含“代码可开发”和“用户可方便审阅”。普通单 Agent 和正式协作均适用，复用 Git、现有配置及任务交付记录，不另建创建器或台账。VS Code 是查看适配，Git 身份与固定基点契约不依赖编辑器。

## 仓库身份与基点

从项目声明的 SourceRoot/GitRoot 或创建计划取得实际仓库，逐仓运行 `git -C <worktree> rev-parse --show-toplevel`、`git -C <worktree> worktree list --porcelain`、`git -C <worktree> rev-parse HEAD` 和 `git -C <worktree> branch --show-current`，核对物理路径、注册关系和分支；branch 输出为空时标为 detached HEAD。`.git` 可以是文件。命令返回父仓根不代表外层容器是独立仓库。

创建时逐仓登记源仓、实际 worktree 路径、分支或 detached HEAD、时间和完整基点 SHA。先解析创建 ref 的 SHA，创建后核对初始 HEAD；后续沿用固定 SHA，不能换成持续推进的主分支或重新计算的 merge-base。夜跑复用保存计划的 `repositories[].revision`。已有 worktree 缺少创建证据时报告基点未知，核实后补录，不把当前 HEAD 冒充创建基点。

## 两种打开入口

在目标工作区按现有命名约定提供 `.code-workspace`，folders 分别指向实际 worktree 仓库，使用相对该文件的路径及可辨识名称。多仓 Overlay 不只添加外层容器，也不以逻辑链接与物理路径重复添加同一仓库。

用户直接打开外层目录时，同时配置该目录的 `.vscode/settings.json`；打开方式未知且存在容器时默认覆盖两种入口。`git.scanRepositories` 相对被打开目录精确列出实际仓库，不填 `.git`、绝对路径或宽泛父目录。两个入口独立生效，不能只配置工作区文件后宣称直接打开目录也已支持。

以下为新建双仓容器示例，路径须从实际映射生成。根下 `review.code-workspace`：

```json
{
  "folders": [
    { "name": "backend-worktree", "path": "repos/backend" },
    { "name": "frontend-worktree", "path": "repos/frontend" }
  ],
  "settings": {
    "git.autoRepositoryDetection": "subFolders",
    "git.openRepositoryInParentFolders": "never"
  }
}
```

同一外层目录的 `.vscode/settings.json`：

```json
{
  "git.autoRepositoryDetection": "subFolders",
  "git.repositoryScanMaxDepth": 0,
  "git.scanRepositories": ["repos/backend", "repos/frontend"],
  "git.openRepositoryInParentFolders": "never"
}
```

局部合并已有 JSON/JSONC，保留注释、folders、任务、扩展及无关设置；扫描清单保留仍有效的用户条目，去重补入本批仓库，不覆盖整文件。深度 0 用于新容器精确扫描，既有工作区按用途保留原扫描范围。只调整当前工作区，不改全局设置；冲突定向解决，不为显示仓库初始化容器 Git、调整分支、修改全局信任或安装扩展。

VS Code 在 autoRepositoryDetection 为 true 或 subFolders 时执行目录扫描，将 scanRepositories 相对各 workspace folder 解析，忽略绝对扫描路径。多根工作区不要机械复制容器相对路径到各仓库根。依据：[官方实现](https://github.com/microsoft/vscode/blob/main/extensions/git/src/model.ts)、[设置定义](https://github.com/microsoft/vscode/blob/main/extensions/git/package.json)（2026-10-17 核对；界面仍按安装版本验证）。

## 本批差异与提交归属

将占位值替换为实际路径和完整固定 SHA，逐仓执行后交付可复制命令：

```text
git -C "<实际worktree>" status --short --branch --untracked-files=all
git -C "<实际worktree>" diff
git -C "<实际worktree>" diff --cached
git -C "<实际worktree>" log --oneline --decorate <创建基点SHA>..HEAD
git -C "<实际worktree>" diff <创建基点SHA> HEAD
```

- 未提交修改：status 覆盖未跟踪文件，diff 与 diff --cached 分别查看未暂存、已暂存差异；普通 diff 不显示未跟踪文件正文。VS Code 在 Source Control 选择对应仓库，点击 Changes / Staged Changes 文件查看逐行差异；未跟踪文件直接打开审阅，不为展示而暂存。
- Worktree 提交：固定基点后的提交及净变更以上述 log/diff 为准，无新增提交时明确说明。合入其它历史时区分外来提交与本批产出，不将范围内全部提交算成本批工作量。历史重写导致基点不再为祖先时报告范围失效并核实，不偷偷移动基点。
- 合回目标仓的提交：已集成时列出实际目标仓、目标分支及 SHA，说明 merge、squash、cherry-pick 或 fast-forward 的对应关系；未集成则明确说明。主工作区与主分支分别核实，不按目录名称猜测。

查看入口不授权 commit、merge、push、rebase 或空提交，也不为显示历史创建分支。

## 验证与交付

逐个解析 folders 和扫描相对路径，确认到达预期 GitRoot，分支/HEAD 与记录一致；执行上述查看命令及 `git -C <worktree> merge-base --is-ancestor <创建基点SHA> HEAD`，核对退出码。新入口和已有设置都要检查。

有界面能力时分别打开工作区文件和外层目录，核对 Source Control 的仓库、分支、未提交文件及逐行差异；有新增提交时核对历史显示。验证后恢复用户原有窗口，文件存在或命令成功不能代替界面验证。无法验证界面时明确“路径、Git 状态与命令已验证，VS Code 界面未验证”，提供准确步骤：

1. `code --new-window "<实际工作区文件>"`，或 File → Open Workspace from File。
2. `code --new-window "<实际外层目录>"`，或 File → Open Folder。
3. 已打开窗口执行 Developer: Reload Window，再在 Source Control 的 Repositories 中选择已核验仓库。CLI 不在 PATH 时使用菜单，不将 CLI 缺失判为入口文件无效。

交付包含两个入口（适用时）、逐仓基点与当前状态、查看命令、集成状态和验证限制。入口与基点记录是正式交付物，保留在目标工作区，不写入能力包副本或当作临时文件删除。正常更新框架取得本指南；已有业务 worktree 在相关任务授权范围内补齐入口，缺失基点单独核实，不批量重建或清理。
