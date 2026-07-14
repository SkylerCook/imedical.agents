# 反馈：部署态反馈路径错误解析到业务项目根目录

- 日期：2026-07-13
- 提交人：Codex
- 基于版本：7bcf8d49bb90aa0dfc710c8d9c66575a02a2e613
- HIS 需求号：6097879
- 状态：已随提交 `3131d97` 回归 canonical，2026-07-14 审计确认

## 场景描述

在业务项目中执行需求收尾反馈时，项目规则要求写入 `.agents/feedback/framework/`，但已部署 skill 和共享协议仍使用 `imedical.agents` 源仓相对路径 `feedback/framework/`，导致路径可能按业务项目当前工作目录解析错误。

## 发现的问题

1. skill 未区分业务项目部署态与 `imedical.agents` 源仓态。
2. 共享协议明确要求写入源仓 `feedback/framework/`，与业务项目 `AGENTS.md` 冲突。
3. 项目初始化模板继续传播无 `.agents/` 前缀的反馈路径。
4. 协议默认要求提交并推送，与“只有用户明确授权才执行外部写操作”的项目约束不一致。

## 本次修改说明

### skills/agent-framework-feedback/SKILL.md

- 增加 `FRAMEWORK_ROOT` 运行形态判定。
- 部署态固定使用 `.agents/feedback/`，源仓态使用 `feedback/`。
- 明确不得按 shell 当前工作目录盲目解析源仓相对路径。
- 明确部署态反馈包内部去掉 `.agents/` 前缀，保持 owner 仓库路径结构。

### agents/_shared/feedback-protocol.md

- 将单一源仓写入规则改为部署态/源仓态双模式。
- 修正反馈目录、包内路径与提交授权规则。

### feedback/framework/README.md

- 明确当前目录属于业务项目部署态，并补充源仓对应位置和协议真实路径。

### plugins/agent-context-kit/templates/AGENTS.template.md

- 将生成项目中的反馈路径改为 `.agents/feedback/experience/` 和 `.agents/feedback/framework/`。

### plugins/agent-context-kit/templates/AGENTS.context-snippet.md

- 同步修正部署态反馈路径，避免后续初始化继续生成歧义规则。

## 验证状态

- [x] 已验证：五处规则均明确部署态使用 `.agents/feedback/`。
- [x] 已验证：业务项目根级 `feedback/` 未被创建。
- [x] 已验证：反馈包内部保持 `imedical.agents` owner 仓库相对路径。
- [x] 已确认：提交 `3131d97` 已将反馈包内容同步回 canonical；2026-07-14 复核路径规则与当前文件一致。
