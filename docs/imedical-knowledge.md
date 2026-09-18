# iMedical 知识接入与菜单刷新

共享知识由 coding-iris-plugin 持有检索/同步入口，vendor/imedical-knowledge 持有脱敏参考。医生站 AI 插件按需路由。此次从用户指定 Gitee 源接收 218 份可读资料，包含 Qoder wiki、菜单/安全组和技术文档；1 份生成器缓存只记录排除原因与 hash。来源提交与清单见 [sources.json](../vendor/imedical-knowledge/sources.json)，不等同于当前工程事实或真实环境验收。

## 使用

- 查询：模型自主决定是否使用 `iris-imedical-knowledge`，用户也可显式调用。业务背景、实现复用、跨模块理解等存在信息缺口时按需检索，已有证据足够就继续；无需用户为本地读取另行确认。默认搜索共享参考，指定来源别名后优先查项目当前菜单。
- 刷新：调用 `iris-menu-sync`，指定当前工程与全部/安全组范围。Agent 复用现有 MCP，确认类/方法及表结构、完整读取后生成规范 JSON，再由离线工具 plan/apply 原子切换本地快照。
- 脱机：已有导出可进入相同校验/发布流程；保留导出时间，不声称已联网刷新。

脚本命令、输入格式、失败恢复见 [同步契约](../plugins/coding-iris-plugin/references/menu-knowledge-sync.md)。工具均使用 Node 内置模块，沿项目既有 Node 工具链运行，不增加业务生产运行时。

## 安装与更新

按 [更新 runbook](update-agents.md) 安装或更新，保持 coding-iris-plugin enabled。共享 vendor 原有部署规则已覆盖资料；thin-index wrapper 将两个新 skill 暴露在项目 ContextRoot/skills。Overlay 使用现有 resolver，不复制 shared vendor 到每个 ContextRoot。源仓实现完成不代表任何现存业务副本已更新。

项目数据只写 ContextRoot/work/menu-sync，能力包升级只更新共享参考和脚本；旧资料不迁移、不删除。无菜单快照仍可查共享知识；MCP 不可用不影响离线检索。资料不是 skill，不会被当作自动执行入口。

## 更新来源资料

维护者从固定源提交的临时检出运行 `.agents/skills/agent-kit-maintenance/scripts/import-imedical-knowledge.js <source> <new-staging-target>`。检查来源、逐文件差异、脱敏和可读资料清单后更新 vendor，再验证清单 hash 与检索。该脚本不是业务部署内容，既有 vendor 目标不允许直接覆盖。源仓未提供 LICENSE，本次接收不改变资料权属。

## 验证

`node --test scripts/tests/iris-knowledge-menu.tests.js` 覆盖完整/部分刷新、输入与基线漂移、失败保留、链接边界、检索、共享资料 hash、standard/Overlay 及 PS7/PS5.1 thin-index。Windows/macOS/Linux × Node22/24 的 CI 配置见 knowledge-menu-validation.yml；只声明矩阵不等于已执行。真实 MCP 采集、目标实例菜单范围和页面定位需独立验证，本轮不自动访问医院环境。

## 工程发现入口

新工程初始化与已有工程授权维护时，由 project-context-maintenance 将 AGENTS 模板的“知识资料”一条合并到工程入口；仅适用于已启用 coding-iris-plugin 且 thin-index 可达的工程。已有等价指引复用，完整索引不复制到 AGENTS。模型仍自主决定是否查询。
