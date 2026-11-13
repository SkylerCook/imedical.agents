# 插件按需部署

新项目默认取得基础入口、能力目录和共享脚本。业务插件与必需 vendor 资源通过项目选择落盘。已有全量项目沿原部署方式更新，显式迁移后采用按需方式。所有命令从当前业务工作区执行，CapabilityRoot 沿现有 workspace resolver 解析。

## 按体系选择

支持 general（通用）、iris、xc（信创）、ui 四组。组由源仓维护，用作选择入口；实际插件状态继续保存到 ContextRoot/config/plugin_profile.md。组的成员变化在后续用户再次选组时展开，普通更新保留已经安装的能力。

```powershell
node <CapabilityRoot>/scripts/plugin-deploy.js groups --project-root .
node <CapabilityRoot>/scripts/plugin-deploy.js recommend --project-root .
node <CapabilityRoot>/scripts/plugin-deploy.js plan --project-root . --group general --group iris --group ui
node <CapabilityRoot>/scripts/plugin-deploy.js plan --project-root . --all --exclude-group xc
```

recommend 根据有限的本地源码与工程标识返回建议体系、推荐插件和证据。用户可以选整个体系，也可以只取推荐插件。反选支持 --exclude-group 与 --exclude-plugin。排除规则应用后再检查必需依赖。

发现必需依赖被排除时，返回 conflicts，包含所选插件、完整依赖链、各边的版本要求、manifest 声明位置和被排除体系。Agent 将这些关系展示给用户，明确选择补回依赖还是放弃依赖它的能力，确认后重跑预览。冲突期间保持当前部署和 profile。基础入口也参与排除冲突说明；用户明确保留基础后，可以改为正选其它业务体系。当前实际依赖示例为 codegraph-query → iris-codegraph → coding-iris-plugin；选择通用组并排除 IRIS 时会展示这条关系，由用户确认取舍。

## 首次接入与自动补装

安装器初始只取得基础能力。执行 project-context-maintenance 时，根据 recommend 结果向用户推荐组合，并一次确认是否允许明确任务触发本仓库插件补装。

```powershell
node <CapabilityRoot>/scripts/plugin-deploy.js configure --project-root . --auto-install true
node <CapabilityRoot>/scripts/plugin-deploy.js ensure --project-root . --group iris
```

用户尚未授予自动补装权限时，明确要求的本次安装使用 --explicit。取消后续自动补装使用 configure --auto-install false。偏好保存在 ContextRoot/config/plugin-deployment.json，与部署方式共同管理，插件状态仍以原 profile 为准。

ensure 解析必需依赖、下载插件及资源、校验 manifest 与能力目录的一致性，然后返回 dependency order 下的初始化技能。Agent 依次读取并执行这些技能，集中处理必要配置。已安装能力可直接读取源技能，宿主发现机制需要重新加载时告知用户。

新插件保持 available，直到其初始化闭环、配置和 thin-index 验证完成。再使用既有 update-plugin-profile.ps1 标记 enabled。按需模式会检查发现入口已生成，缺失的插件正文无法标记 enabled。显式 disabled 的插件阻止任务自动补装和启用，恢复须由用户明确要求。

自动补装仅覆盖当前仓库能力包和必需资源。外部账号配置、数据传输、服务器写入、发布等操作沿对应技能和项目的授权范围。

## vendor 与知识库

manifest 的 runtimeResources 声明插件必需 vendor 目录。required skillDependencies 的 provider 同时取得。optional skillDependencies 在任务触发后显式补齐，例如运行 ensure --plugin <owner> --optional-skill <capability>。availableDependencies 继续只表达阶段可用性关系。

业务知识随 coding 知识能力取得，UI 规范随 UI 插件取得，HISUI、编码库、XML 解析器和 MCP 运行时沿调用它们的 owner 或传递依赖取得。多个插件共用同一资源目录。

公司向量数据库继续独立选装，操作见[知识检索指南](knowledge-retrieval.md)。无 Embedding 服务时，已安装知识资料仍可用于本地检索。选择向量库不会自动启用额外业务插件。

## 更新、迁移与清理

普通更新保留当前部署方式、物理安装范围及各项目启用状态。源仓能力目录与代码取同一 revision，新增必需依赖会随更新补齐。停用通过既有 profile 工具操作，移除可识别的受管发现入口并保留物理包；自定义入口发生冲突时保留并报告。

```powershell
node <CapabilityRoot>/scripts/plugin-deploy.js migrate --project-root .
node <CapabilityRoot>/scripts/plugin-deploy.js migrate --project-root . --execute
node <CapabilityRoot>/scripts/plugin-deploy.js prune --project-root .
node <CapabilityRoot>/scripts/plugin-deploy.js prune --project-root . --execute
```

迁移及清理先预览，再在用户明确的范围内执行。已有启用能力及必需依赖保留，available/disabled 且无人使用的物理包可清理。工程配置、任务资料和私有凭据保留。受影响能力包工作区有修改时报告冲突，用户处理后重试。

Overlay 的 CapabilityRoot 保留各 ContextRoot 需求的并集。旧共享目录首次迁移时，使用重复的 --member-project <workspace> 列齐关联工程，再以 --members-complete 表达已核对成员范围。项目暂时不可访问时保留上次已知资源，暂停会移除资源的操作。Overlay 初始化和 Write 更新自动登记当前成员，各项目的 thin-index 仍独立生成。

安装状态与阶段记录放在 CapabilityRoot 的 Git 本地目录，记录物理安装范围、关联项目、revision 和恢复进度。安装、更新、profile 写入和 sparse 刷新共用部署锁。中断后重复原命令复用已下载文件；确认锁持有进程退出时可运行 recover，活跃或未知持有者保持保护。

离线可使用已落盘插件。网络失败时保留恢复记录及现有项目状态。Git 远端支持 filter 时，partial clone 避免取得未选择的 blob；远端拒绝 filter 时 Git 会提示，磁盘检出仍遵循选择。已下载的历史 Git 对象占用由 Git 管理。

## 维护者校验

插件 manifest 或体系分组变化后运行 node scripts/generate-plugin-catalog.js。CI 使用 --check 对比源清单，防止目录过期。新插件须归入一个体系，必需资源须声明并核对实际运行引用。

专项回归使用 node --test scripts/tests/plugin-deployment.tests.js，配合 sparse、更新器、thin-index 及 workspace-overlay 的既有测试。跨平台结果以实际矩阵执行为准。

项目插件管理入口：[plugin-management](../../plugins/agent-context-kit/skills/plugin-management/SKILL.md)，支持体系选择、补装、启用、禁用和恢复；停用前展示受影响依赖。
