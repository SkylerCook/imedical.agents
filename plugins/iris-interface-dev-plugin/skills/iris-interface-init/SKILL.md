---
name: iris-interface-init
description: 当需要为目标项目初始化 IRIS 接口开发工作区、输出目录、接口 profile 和插件 thin-index 时使用。
---

# IRIS 接口初始化

用于在目标项目中准备接口文档解析、字段诊断和后续开发计划所需的最小配置。

## 必读

1. `../../rules/iris_interface_index.md`
2. `../../rules/iris_interface_workflow.md`
3. 目标项目 `AGENTS.md`
4. 目标项目 `.agents/config/iris_project_profile.md`，如果存在

## 职责

- 创建或确认目标项目 `docs/output/iris-interface/` 输出目录。
- 目标项目缺少接口配置时，参考 `../../templates/iris_interface_profile.template.md` 创建项目本地 profile。
- 通过 `scripts/generate-plugin-thin-index.ps1` 生成或刷新插件 thin-index。
- 检查目标项目是否已启用 `coding-iris-plugin`。

## 边界

- 不写入服务器地址、账号、密码、namespace、远程路径、包映射或部署事实。
- 未启用 `coding-iris-plugin` 时，只允许执行文档解析和字段诊断，不进入 ObjectScript 编码实现。
- 接口插件只补接口开发配置，不接管 IRIS 编码、上传、编译、部署边界。

## 输出

只汇报 profile 路径、输出目录、thin-index 状态，以及编码阶段是否可进入、被阻塞或应延后。
