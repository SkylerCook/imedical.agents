# Git 工作流

本文档是 `AGENTS.md`「Git 工作流」一节的外联详情文档，面向 Developer 视角整理分支模型、日常提交流程、临时分支规范与提交日志格式。

> **完整规范**：分支策略、提升路径、GitLab 保护规则与 MR 流程的权威定义见根目录 `CONTRIBUTING.md`。

---

## 分支模型与权限（Developer 视角）

项目采用 `dev → test → release/* → main` 严格提升路径：

| 操作 | 是否允许 |
|------|---------|
| 直接推送/合并到 `dev` | ✅ 允许 |
| 创建 `feature/*`、`fix/*` 临时分支并发起 MR 合并到 `dev` | ✅ 允许 |
| 推送/合并到 `test`、`release/*`、`main` | ❌ 禁止（直推会被服务端 403 拒绝） |

> **Agent 行为约束**：默认提交目标是 `dev`，**严禁**向 `test`/`release/*`/`main` 执行 `git push`；MR 目标分支只能是 `dev`；推送前必须先 `git pull origin dev` 同步最新代码。

---

## 日常提交流程（直接提交到 dev）

```powershell
cd src/backend          # 或 src/frontend（必须在 submodule 内）
git checkout dev; git pull origin dev
git add <files>
git commit -m "fix(100123): 门诊医生-预约" `
           -m "修改说明: 公共卡预约场景下跳过黑名单证件号校验" `
           -m "需求描述: 预约-使用公共卡预约时提示黑名单错误"
git push origin dev     # 可选，不自动执行
```

> 本机终端为 Windows PowerShell：不支持 `&&` 分隔符，顺序执行用 `;`；多行命令用反引号 `` ` `` 续行。

---

## 临时分支流程（较大功能 / 新功能）

从最新 `dev` 创建临时分支 → 开发提交 → 推送时可用 push options 直接创建 MR（`-o merge_request.create -o merge_request.target=dev -o merge_request.remove_source_branch`）→ MR 合并后**立即删除**远程与本地临时分支。

---

## 临时分支命名规范

| 类型 | 命名格式 | 基分支 | 合并目标 | 合并后处理 |
|------|---------|--------|---------|-----------|
| 功能分支 | `feature/<需求号>-<简述>` | `dev` | `dev` | **立即删除** |
| 修复分支 | `fix/<需求号>-<简述>` | `dev` | `dev` | **立即删除** |
| 热修复分支 | `hotfix/<需求号>-<简述>` | `main` | `main`（+ cherry-pick 到 `dev`） | **立即删除**（仅 Maintainer） |

`<需求号>` 必须为纯数字（须与 commit 中 `({需求序号})` 一致）；`<简述>` 英文小写、连字符分隔；禁止中文、空格、下划线。

---

## 提交日志格式规范

**三行格式模板**：

```
{修改类型}({需求序号}): {菜单路径}
修改说明: {从文件差异提取的修改说明}
需求描述: {完整的需求标题}
```

- 第一行：从需求标题中提取**菜单路径部分**
- 第二行：通过分析 `git diff` 提取技术变更的业务语言描述
- 第三行：保留**完整的需求标题**

**修改类型枚举**：`fix`（Bug 修复）、`feat`（新功能）、`refactor`（重构）、`docs`（文档）、`style`（格式）、`test`（测试）、`chore`（工具链）
