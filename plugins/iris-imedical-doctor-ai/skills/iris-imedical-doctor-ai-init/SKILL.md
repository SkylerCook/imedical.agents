---
name: iris-imedical-doctor-ai-init
description: Initialize iris-imedical-doctor-ai using the target project's existing IRIS capability and plugin configuration, without requiring a particular AI source layout or framework implementation.
---

# 初始化

1. 读取项目入口和既有 plugin/context/IRIS 配置，确认工作区与能力源边界，不创建连接配置。
2. 核对 coding-iris-plugin 已启用且满足 manifest；缺失时按原 owner 流程处理。离线分析不因连接不可用而整体停止。
3. 识别目标已有的 AI 集成入口或拟新增的接入位置。不要求特定文件、基类、业务目录或某版原型；新建能力与扩展现有能力均可使用本插件。
4. 用户要求启用时沿用现有 plugin_profile 格式，只更新本插件状态。通过 canonical thin-index wrapper 先 DryRun 再 Write，传入实际 context/capability 参数。
5. 核对开发技能的薄索引与插件内真实初始化 SKILL.md 可读、源映射正确并保留其它配置；纯 init 不生成薄索引。工程私有差异按项目维护规则记录。

本插件不创建绑定某个工程的领域 profile，不自动复制原型或框架源码。
