---
name: iris-code-baseline
description: 将本地 IRIS / Caché 源码 XML 离线转为源码树（--xtoc）；按 Web 目录、通配符、IRIS 类包或版本 TXT 采集当前代码；维护版本清单与带回源码 XML 回包。
---

# IRIS 代码基线

## 命令

帮助请求优先处理。调用 `iris-code-baseline --` 显示下表并结束；调用参数中独立的 `--`、`--help` 或查看用法均按[统一帮助协议](../../../../docs/guides/capability-help.md)处理。Overlay 按 CapabilityRoot 定位协议。

| 命令 | 执行结果 |
|---|---|
| `--xtoc <XML 文件或目录> [--out <目录>]` | 离线将 XML 转为独立源码树和转换清单 |
| `--plan` | 按 `--baseline <范围 TXT>` 或重复的 `--scope <规则>` 生成采集计划，返回命中范围及 `planPath` |
| `--export` | 使用与 `--plan` 相同的范围参数，规划后采集当前源码 |
| `--capture <plan.json>` | 按已生成的计划开始采集 |
| `--status <plan.json>` | 在本地查看计划状态、计数与回执 |
| `--resume <plan.json>` | 从已保存的采集断点继续 |
| `--catalog-build --out <新 TXT>` | 从本地源码生成版本范围 TXT，更多参数见[清单契约](../../references/iris-code-baseline.md#命令入口) |
| `--catalog-compare --left <旧 TXT> --right <新 TXT>` | 比较两个范围清单的对象集合 |
| `--xml-delivery <完整源码 XML>` | 进入[带回 XML 修改和回包](../../references/iris-offline-development.md#完整源码-xml)流程 |

每次用一个动作命令，`--scope`、`--baseline`、`--out` 等随动作传入。明确使用动作命令时按表分流；自然语言请求按任务语义走相同入口。帮助请求优先于动作命令。

```text
iris-code-baseline --
iris-code-baseline --export --scope "/app/scripts/care/*" --scope "Demo.Care" --out pc/source-snapshot
iris-code-baseline --resume <plan.json>
```

## 按命令执行

- `--xtoc` 进入下方 XML 转源码流程。需带回修改 XML 的请求进入 `--xml-delivery`。
- `--catalog-build`、`--catalog-compare` 分别调用 `baseline-catalog.js build`、`compare`。沿[代码基线协议](../../references/iris-code-baseline.md#命令入口)取得参数和结果含义。
- `--status` 调用 `code-baseline.js status --plan <plan.json>`，报告实际回执后结束。
- `--plan`、`--export` 调用 `code-baseline.js plan`，按下方采集流程核对实际范围与来源。`--plan` 报告计划后结束；`--export` 在有效授权内用该计划继续 `capture`。
- `--capture`、`--resume` 调用 `code-baseline.js capture|resume --plan <plan.json>`。使用指定的计划及原采集约束。

## 本地 XML 转源码

“把这批 XML 转成可入 Git 的源码”或显式 `--xtoc` 进入本节，完成即结束。优先于检查 `developmentMode`、profile 和连接。需要把修改带回现场的 XML 交付任务走下方离线协议。

```text
iris-code-baseline --xtoc pc/incoming --out pc/source-from-xml
iris-code-baseline --xtoc "incoming/care module" --out "work/care source"
```

也可直接说“把 `incoming/care module` 里的 XML 转成源码，输出到 `work/care source`”。只维护单个模块时，输入该模块的 XML 文件或目录即可。指定的输出目录应是尚未创建的新目录，源码写入其下的 `src/`。

1. 按[转换说明](../../references/iris-offline-development.md#xml-转独立源码目录)定位输入与 CapabilityRoot。`--xtoc` 接收单个 XML 文件或目录。目录模式只读直属 XML 文件。用户未指定 `--out` 时，在目标工作区选用可用的 `source-from-xml` 子目录名，可顺延数字后缀。有同名目录的显式输出由脚本报错。
2. 从当前项目调用 `node <iris-tools>/xml-to-source.js --input <输入> --out <新目录>`。本分支只写本地转换产物，无需 IRIS、MCP、Git 初始化或项目开发方式配置。
3. 读取 `manifest.json` 并报告实际输出路径、包数、文件数及失败定位（如有）。转换产物用于本地源码基线，现场导入、编译和提交另按授权处理。

## 带回 XML 修改与回包

`--xml-delivery` 或明确要求把完整源码 XML 修改后带回现场时，先读[现场源码带回与 XML 离线修改](../../references/iris-offline-development.md#完整源码-xml)。沿本地流程收取输入与修改目标，固定按对象 XML 编辑，以实际 `notes.md` 生成 `changes.xml`、对应 `rollback.xml`、变更说明和摘要 manifest，并用新进程 Verify 后交付。保护原包、Project 元数据及未修改对象，类保留原生 XML。现场导入、编译及提交另按授权处理。

## 输入与完成标准

- 输入：目标工程、指定来源环境，以及版本 TXT 清单、明确对象或路径与包规则。采集内容来自该实例的当前源码。
- 输出：代码源码树、清单来源与摘要、观察时间窗口和逐项回执；图片在网络请求前排除并单独统计，源码基线只收代码。
- 完成：请求范围与 fetched／reused／missing／empty／failed／cancelled 等结果守恒，内容和恢复摘要通过。缺失形成 `partial`；接受差异后仍保留部分基线的事实，不改报 complete。

## 执行

先读取当前 ContextRoot 的 `config/project.jsonc` 的 `irisDevelopment` 节。`developmentMode: offline` 时优先按[离线开发协议](../../references/iris-offline-development.md)接收已带回的源码或完整 XML；本地清单 build/compare、既有任务状态检查可用，不请求医院连接或准入，不进入服务器采集、source-sync 或资格执行。缺省沿旧 `connected` 行为，未知值停止核对。

1. 读取目标 AGENTS、上下文及 IRIS profile，解析 WorkspaceRoot、ContextRoot、CapabilityRoot、SourceRoot、GitRoot；读取[代码基线协议](../../references/iris-code-baseline.md)。先区分离线清单维护、纯源码采集与项目按需开发分支。
2. 离线 build／compare 使用 `baseline-catalog.js`，记录来源 ref、版本标签和范围差异。共享版本参考位于能力包 `docs/reference/project-export-map/`；项目增补清单留目标项目，不自动发布到框架。
3. 首次用 `code-baseline.js` 按全清单或明确子集采集。用户指定 Web 目录、对象通配符或 IRIS 类包时，直接把每条规则传给 `plan --scope <规则>`，按回执预览后用同一 `planPath` 采集。工具自动生成并锁定精确 TXT，后续使用 `resume` 读取未完成对象。纯采集复用公共读取与持久快照。已确认 `project`＋`intent-first-on-demand-export` 时，可将回执的 `scopeFile` 交给 source-sync 的 `initial-baseline`，沿原开发流程及授权建立开发基线。
4. 长采集先以最小批次验证写入和新进程恢复，再扩批。只有当前目标取得多会话资格才启用相应会话数；没有该资格时沿已获基础资格的单会话，不把一次吞吐样本当通用默认值。
5. 逐项区分 404、空内容及请求失败；保留已有文件和现场。首采缺失可 partial，日常必需对象缺失停止核实；未采集／缺失不会自动成为删除决定。断点按目标、范围和内容摘要核对，首次恢复复用历史观测时报告时间窗口。
6. 开发时刷新准备修改的对象及必要上下游，部署前再次核对；命中项目分支时复用 [source-sync 协议](../../references/project-demand-development.md)，日常恢复重新观察需求集合。提交与部署各核有效授权，采集本身不自动提交。

CLI 位于 CapabilityRoot 的 `plugins/coding-iris-plugin/scripts/iris-tools/`，操作参数读取 `baseline-catalog.js --help`、`code-baseline.js --help` 或 `source-sync.js --help`。可导入 XML 包走 [iris-xml-export](../iris-xml-export/SKILL.md)。人工 TXT 范围导出归源仓 `tools/iris-code-export/` 独立便携包。
