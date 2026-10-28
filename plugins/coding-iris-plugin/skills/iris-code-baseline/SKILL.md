---
name: iris-code-baseline
description: 按版本 XML 采集 IRIS 当前源码、维护版本清单；支持将现场完整源码 XML 带回后由本地 AI 修改并回包。
---

# IRIS 代码基线

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，展示范围清单、当前源码、输出和恢复语义后结束；不检查业务配置、连接或创建任务。

## 输入与完成标准

- 输入：目标工程、版本 XML 或明确子集、指定来源环境。XML 表达文件集合，内容是该实例采集时的当前源码。
- 输出：代码源码树、清单来源与摘要、观察时间窗口和逐项回执；图片在网络请求前排除并单独统计，源码基线只收代码。
- 完成：请求范围与 fetched／reused／missing／empty／failed／cancelled 等结果守恒，内容和恢复摘要通过。缺失形成 `partial`；接受差异后仍保留部分基线的事实，不改报 complete。

## 执行

用户带回完整源码 XML、要求本地 AI 修改后带回现场时，先读[现场源码带回与 XML 离线修改](../../references/iris-offline-development.md)，不要求连接配置或在线元数据。固定按对象 XML 编辑，以实际 notes.md 生成仅含修改对象的 changes.xml、对应 rollback.xml、变更说明和摘要 manifest，并用新进程 Verify 后交付；原包、Project 元数据及未修改对象受保护。类保留原生 XML，不自动导入、编译或提交。人工 TXT/XML 范围导出是源仓 `tools/iris-code-export/` 的独立 ZIP，不依赖本 skill 或框架，也不随 `.agents` 分发。

1. 读取目标 AGENTS、上下文及 IRIS profile，解析 WorkspaceRoot、ContextRoot、CapabilityRoot、SourceRoot、GitRoot；读取[代码基线协议](../../references/iris-code-baseline.md)。先区分离线清单维护、纯源码采集与项目按需开发分支。
2. 离线 build／compare 使用 `baseline-catalog.js`，记录来源 ref、版本标签和范围差异。共享版本参考位于能力包 `docs/reference/project-export-map/`；项目增补清单留目标项目，不自动发布到框架。
3. 首次用 `code-baseline.js` 按全清单或明确子集采集。纯采集复用公共读取与持久快照，不强制 project 类型或自动初始化 Git。已确认 `project`＋`intent-first-on-demand-export` 才通过 source-sync 的 `initial-baseline` 建立开发基线。
4. 长采集先以最小批次验证写入和新进程恢复，再扩批。只有当前目标取得多会话资格才启用相应会话数；没有该资格时沿已获基础资格的单会话，不把一次吞吐样本当通用默认值。
5. 逐项区分 404、空内容及请求失败；保留已有文件和现场。首采缺失可 partial，日常必需对象缺失停止核实；未采集／缺失不会自动成为删除决定。断点按目标、范围和内容摘要核对，首次恢复复用历史观测时报告时间窗口。
6. 开发时刷新准备修改的对象及必要上下游，部署前再次核对；命中项目分支时复用 [source-sync 协议](../../references/project-demand-development.md)，日常恢复重新观察需求集合。提交与部署各核有效授权，采集本身不自动提交。

CLI 位于 CapabilityRoot 的 `plugins/coding-iris-plugin/scripts/iris-tools/`，操作参数读取 `baseline-catalog.js --help`、`code-baseline.js --help` 或 `source-sync.js --help`。可导入 XML 包走 [iris-xml-export](../iris-xml-export/SKILL.md)。
