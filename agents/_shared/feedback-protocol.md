# Agent Feedback Protocol

本文件定义 Agent 在处理 HIS 需求后，自动生成框架验证反馈的行为规范。

反馈产物写入 `imedical.agents` 仓库的 `feedback/framework/` 目录，不写入业务项目。

## 触发条件

Agent 在任务收尾阶段，检查以下条件是否满足：

1. 本次任务是否读取了 `.agents/` 下的框架文件（rules、skills、templates、references、scripts、agents、workflows 等）？
2. 是否对框架文件内容有修正或补充（不只是业务项目本地文件）？

**两个条件都满足时**，执行反馈生成。否则正常结束，不生成反馈。

## 反馈生成步骤

```text
1. 记录当前仓库 git hash：git rev-parse HEAD
2. 创建反馈目录：feedback/framework/YYMMDDHHmmss/
   - YYMMDDHHmmss 为当前时间戳，精确到秒
3. 将修正后的框架文件按原路径结构复制到反馈目录
   - 修正了 plugins/i18n-iris-plugin/rules/i18n_coding_backend.md
     → 放入 feedback/framework/YYMMDDHHmmss/plugins/i18n-iris-plugin/rules/i18n_coding_backend.md
   - 修正了 scripts/update-agents.ps1
     → 放入 feedback/framework/YYMMDDHHmmss/scripts/update-agents.ps1
4. 生成 _template.md，填写以下内容：
   - 日期、提交人、基于版本（git hash）
   - 场景描述：处理了什么需求
   - 发现的问题：具体描述
   - 本次修改说明：每个修正文件改了什么、为什么改
   - 验证状态：已验证 / 待验证
5. 提交并推送到 origin master
```

## 反馈模板

```markdown
# 反馈：{简短标题}

- 日期：YYYY-MM-DD
- 提交人：姓名
- 基于版本：git commit hash
- HIS 需求号：（可选）
- 状态：待处理

## 场景描述

处理了什么需求，遇到了什么情况。

## 发现的问题

1. 问题 1：描述
2. 问题 2：描述

## 本次修改说明

### 相对路径 1
- 改了什么：...
- 为什么改：...

## 验证状态

- [ ] 已验证：在 HIS-xxx 需求中确认有效
- [ ] 待验证：初步观察，需要更多场景确认
```

## 目录内文件规则

- 只放修正过的框架文件，不放业务项目文件
- 保持原仓库路径结构（从仓库根目录算起）
- 不放敏感信息（服务器地址、账号、密码、token、namespace、远程路径）
- 不放长段日志、完整 diff 或一次性排障流水

## 与业务项目报告的区别

| 产物 | 写入位置 | 用途 |
|---|---|---|
| 交接报告（事实报告、分类清单等） | 业务项目 `docs/agent-reports/` | 阶段化交接，属于业务项目工作产物 |
| 框架验证反馈 | `imedical.agents` 的 `feedback/framework/` | 框架改进输入，属于能力包仓库 |

## 维护者处理流程

```text
1. 定期检查 feedback/framework/ 中状态为"待处理"的反馈
2. 读取 _template.md 和修正文件
3. 对比修正文件与 master 对应文件的 diff
4. 判断：
   - 可直接应用（修改明确、无冲突）→ 应用到 master
   - 需要调整（方向对但细节需改）→ 调整后应用
   - 需要讨论 → 标记"需讨论"
   - 已过时 → 标记"已跳过"
5. 更新 _template.md 状态和处理记录
6. 提交到 master
```
