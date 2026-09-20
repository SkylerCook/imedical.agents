# 项目上下文配置

本文件保存非敏感项目语义配置，用于判断 Agent 是否可以从本地代码归纳工程事实。不要写入服务器地址、账号、密码、token、namespace 或远程路径。

## 基本信息

- 项目用途：TODO: 简述项目业务用途。
- contextMode：TODO: `codebase-complete` 或 `intent-first-on-demand-export`。
- 代码来源：TODO: 本地完整维护 / 后续按需从服务器导出 / 其它。
- 本地文件完整性：TODO: 代表全量工程 / 不代表全量工程 / 待确认。

## 辅助模式

<!-- agents-update:optional-key guidanceMode -->
`guidanceMode` 可选 auto | concise | assisted；未配置时按 auto 处理。仅在用户明确选择后增加配置项，当前用户明确选择优先。此项只控制辅助资料，不改变权限、领域规则和验证要求；普通更新不自动写入默认值。

## 使用范围

初始化时按 project-context-maintenance 判断模式并填充上述字段，删除无信息占位；日常沿用已确定模式，用户明确变更工程定位时再调整。`intent-first-on-demand-export` 下少量已导出文件不代表完整工程，不据此推断完整架构。

## 待确认项

<!-- 仅填写实际影响执行的未决配置；无待确认项时省略此节，不保留空泛 TODO。 -->
