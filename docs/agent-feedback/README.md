# Agent Feedback

本目录收集框架验证反馈。团队成员通过 AI Agent 处理 HIS 需求时，Agent 如果发现框架文件（rules、skills、templates、scripts 等）有问题并做了修正，会自动生成反馈条目。

## 目录结构

每个反馈条目是一个独立目录，以时间戳命名：

```
docs/agent-feedback/
├── _template.md        # 反馈模板
├── YYMMDDHHmmss/       # 反馈条目（如 260607143022）
│   ├── _template.md    # 反馈说明
│   └── (修正文件，保持原仓库路径结构)
└── ...
```

## 工作流

1. Agent 处理需求 → 发现框架问题 → 修正 → 自动生成反馈目录
2. 维护者定期检查 → AI 读取并 diff → 确认后应用到 master

详见 `agents/_shared/feedback-protocol.md`。
