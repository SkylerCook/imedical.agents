---
name: agent-framework-feedback
description: Use when a completed HIS task corrected framework files such as rules, skills, templates, references, scripts, agents, or workflows during execution.
---

# Agent Framework Feedback

## 触发条件

满足以下任一条件时使用本 skill：

- 任务完成后，发现对 `.agents/` 下的框架文件（rules、skills、templates、references、scripts、agents、workflows 等）做了修正。
- 用户明确要求"生成反馈"或"记录本次发现"。

如果只读取了框架文件但未做修正，不触发。

## 目标

- 将任务中发现的框架问题和修正内容结构化记录。
- 提供足够证据，让维护者能判断问题是否值得回归框架。
- 不干扰正常任务流程，反馈生成应快速完成。

## 必读

1. `agents/_shared/feedback-protocol.md`：反馈行为详细规范。
2. `feedback/framework/_template.md`：反馈模板格式。

仅当确认需要生成反馈后读取这些文件。若任务只是读取框架文件、没有修正框架内容，也没有用户明确要求记录反馈，不继续加载反馈模板。

## 工作流

### 1. 记录版本

```bash
git rev-parse HEAD
```

### 2. 创建反馈目录

目录名使用当前时间戳 `YYMMDDHHmmss`（精确到秒），如 `260608143022`。

```text
feedback/framework/YYMMDDHHmmss/
```

### 3. 复制修正文件

将修正后的框架文件按原仓库路径结构放入反馈目录。只放修改过的文件。

示例：
- 修正了 `plugins/i18n-iris-plugin/rules/i18n_coding_backend.md`
  → `feedback/framework/YYMMDDHHmmss/plugins/i18n-iris-plugin/rules/i18n_coding_backend.md`
- 修正了 `scripts/update-agents.ps1`
  → `feedback/framework/YYMMDDHHmmss/scripts/update-agents.ps1`

### 4. 生成 _template.md

按 `feedback/framework/_template.md` 格式生成，必须包含以下内容：

**基本信息**：日期、提交人、基于版本（git hash）、HIS 需求号。

**需求上下文**（脱敏）：
- HIS 需求描述（一句话概括）
- 涉及入口（页面、按钮、打印单据、API 等）
- 涉及代码（类名、方法名、CSP 页面路径，移除业务敏感信息）
- 数据特征（数据结构、字典来源、模板类型等）

**问题发现过程**：
- 读取了哪些框架文件（路径 + 读取目的）
- 框架文件的原始指引（引用关键段落，脱敏后）
- 按原始指引执行的实际结果
- 与预期不符的具体表现

**修改说明**：
- 每个修正文件：改了什么、为什么改

**验证结果**：
- 修正后是否解决了问题
- 修正后是否有副作用
- 适用范围（本次场景 / 可能适用于同类场景 / 不确定）

### 5. 提交

```bash
git add feedback/framework/YYMMDDHHmmss/
git commit -m "feedback: {简短标题}"
git push origin master
```

## 输出要求

- 反馈目录结构正确，文件保持原路径关系。
- `_template.md` 内容完整，维护者可仅凭此文件判断问题是否值得回归。
- 修正文件可与 master 对应文件做 diff。
- 不包含敏感信息（服务器地址、账号、密码、token、namespace、远程路径）。
- 不包含长段日志或完整 diff。

## 禁止事项

- 不在反馈中写入业务项目私有事实（患者数据、业务页面清单、具体业务逻辑）。
- 不修改原始框架文件（修正内容只放在反馈目录中）。
- 不为了完整性复制未修改的文件。
- 不生成空反馈（没有实际修正时不触发本 skill）。
