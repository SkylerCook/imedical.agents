---
name: plugin-management
description: 管理当前工程的能力包插件。用于查看与推荐体系组合、反选、补装、启用、禁用、恢复及清理插件；任务缺少插件时也使用。适用于 imedical.agents 项目插件。
---

# 项目插件管理

帮助请求先读取 [帮助协议](../../../../docs/guides/capability-help.md)，展示用法后结束。

## 定位与选择

1. 按 [Workspace Context](../../../../docs/workspace-overlay.md) 使用现有 resolver，确定目标工程、ContextRoot 和 CapabilityRoot。读当前项目 profile 与部署策略，运行 CapabilityRoot/scripts/plugin-deploy.js list --project-root <工程>。结果须区分业务选择状态和物理安装状态。
2. 读取 [部署指南](../../../../docs/guides/plugin-deployment.md) 中对应操作。查看、组合、反选及补装使用现有 groups、recommend、plan、ensure；组成员以能力目录为准。展示最终插件及必需依赖。反选默认只约束本次安装选择；已有插件的禁用需有明确要求。
3. 用户明确要求的操作在给定范围内执行。自动补装沿已保存偏好；需要扩大停用范围、解除显式禁用或清理文件时，先取得对应决定。外部服务调用沿领域技能授权。

## 补装、启用与恢复

- ensure 返回后，按依赖顺序读取实际 initSkill，执行初始化并验证配置与发现入口，然后调用根 update-plugin-profile.ps1 标记 enabled。缺配置时集中报告，保留 available，交付可独立使用部分。
- 用户明确恢复 disabled 插件时，先使用 profile 工具将该插件改为 available，再 ensure、初始化及验证；仅恢复用户指定的插件及已获同意恢复的依赖。失败时保留实际状态并报告续接步骤。
- 新宿主入口需要重新加载时说明具体动作；当前 Agent 可读取已安装源 skill 继续任务。生成文件与宿主实际发现分别核实。

## 禁用

1. 从能力目录展开目标组和别名，读取当前项目有效 enabled 状态。遍历所有 enabled 插件的传递 dependencies，找出依赖禁用目标的插件，展示每条完整链、版本要求与 manifest 位置；availableDependencies 单列为受影响阶段。只有明确选定的停用集合没有遗留 enabled 强依赖方，才进入写入。
2. 存在集合外依赖方时，给出保留目标或同时停用列出的依赖方两种选择，等待决定。禁用基础插件时说明相应管理/交接入口也会撤下，给出已解析的根脚本恢复路径。
3. 对全部已选且已落盘目标，用根 generate-plugin-thin-index.ps1 的 -Remove -Mode DryRun 预览。自定义或链接冲突保持原内容，处理冲突前暂停该集合的写入。
4. 按依赖方先于被依赖方的顺序，逐一运行根脚本：

```powershell
& <CapabilityRoot>/scripts/update-plugin-profile.ps1 -ProjectRoot <工程> -ContextRoot <ContextRoot> -CapabilityRoot <CapabilityRoot> -Plugin <名称> -Status disabled
```

5. 每次读回 profile，并再次执行对应 Remove DryRun，确认受管入口已撤下。中途失败即停止后续写入，列明已完成、未完成和冲突，重试从实际状态继续。当前工具逐项处理，批量操作没有事务保证。

禁用只改变当前 ContextRoot 的状态和受管入口，保留配置、项目资料、物理插件与共享 vendor。自定义路由保持原文并报告仍可见的位置；当前会话可能已加载的技能，按宿主重载机制处理。缺少 PowerShell 时保留状态，说明需 PowerShell 7 或 Windows PowerShell 5.1 执行现有入口。

## 迁移、清理与交付

migrate/prune 沿部署指南先预览，再执行明确范围。Overlay 核对成员需求并集、离线成员和本地修改；知识向量库沿独立选装机制。

完成时报告实际 enabled/available/disabled、已撤下入口、保留资源、未完成初始化与宿主重载事项。仅在实际读取或调用成功后报告能力可用。
