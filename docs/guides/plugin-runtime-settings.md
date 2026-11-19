# 插件工程运行参数

当前工程在 `ContextRoot/config/project.jsonc` 的 `pluginSettings.<插件 ID>` 保存下表中的参数。插件是否启用仍由同一文件的 `plugins` 节决定。Overlay 的成员使用自己的 ContextRoot。

| 插件 | 已迁移的参数 | 实际读取或写入入口 |
|---|---|---|
| coding-iris-plugin | 前端编码模式、明确声明的前端源码根目录、源码与服务器编码、确认状态及目标指纹 | `frontend-encoding-cli.js confirm` 核验后写入，`frontend-encoding.js` 供检查和部署读取。导出器读编码模式，提升工具优先读显式前端根。工作台展示确认结果 |
| iris-cure-form-dev | WorkRoot、预览 vendor 目录与六个 CSS/JS 资源路径、Chromium 启动程序、响应式部署策略和公用模板迁移配置文件路径 | `cure-form-workspace.js`、`cure-form.js`、`cure-form-browser-runner.js` |
| i18n-iris-plugin | XML 原文和输出目录、术语表目录及 CSP 恢复目录 | `resolve-project-directory.js`；PowerShell 的 XML 同步入口沿用该解析器。本次命令显式目录优先 |
| iris-interface-dev | 接口文档输出目录 outputRoot | `iris-interface-doc-ingest` 读取插件参数，再向 `extract-doc` 传递显式目录；auto 使用 extract-doc 的原默认值 |

在当前工程根目录运行以下命令。standard 工程的 CapabilityRoot 为 `.agents`。新工程沿插件初始化入口生成默认参数；普通更新只处理本次适用的插件。

~~~text
node <CapabilityRoot>/scripts/plugin-settings.js Read <插件ID> .
node <CapabilityRoot>/scripts/plugin-settings.js DryRun <插件ID> .
node <CapabilityRoot>/scripts/plugin-settings.js Write <插件ID> .
~~~

工作台“工程配置”按插件显示参数。前端编码需要开发人员确认目标，继续使用原 confirm 命令。其它已迁移的标量参数可在工作台预览保存，或使用 `Write <插件ID> . <字段> <值>`。回到旧版消费者前，用新版 `Rollback <插件ID> .` 恢复可读的 Markdown 字段，再切换版本。独立传入的表单 target-profile 和 i18n profile 沿用原格式。

## 盘点中的其它来源

- coding 的需求交付类型同时被 source-sync、需求交付和旧入口迁移消费，需联合核对两份 profile 的优先级。按仓库或子路径的编码覆盖还会影响旧导出器的最长路径匹配。本批保留这两项旧读取行为。工程源码根、多仓库差异表和包命名约定仍供 Agent 和提升工具定位源码。
- i18n 的语言表是运行环境语言目录的快照，XML 同步按语言代码读取显示名，初始化时从服务端取得。它随环境内容刷新。种子类调用规则、SQL 审核说明和 CSP 页面组保留在项目适配文档中。
- 表单公用模板迁移 JSON 包含本次操作的表单与模板映射。工作台保存它的引用，数据继续由迁移命令按原格式校验。任务预览清单、恢复快照以及生成的交付文件仍位于任务目录。
- coding 的 ProjectEnv 可含本机凭据；远端策略可能含本机协调目录和资源池身份。连接投影与活动档案沿连接 owner 核对。原生 MCP、VS Code 和 TOML 依各自协议读取。以上内容均不随插件配置迁移复制到主文件。
- 接口 profile 中的转换器偏好、技能路由和规则列表主要供 Agent 阅读。解析器实际消费的是命令行参数；工作台不会据此声称已安装某个转换器。

更新保留 Markdown 中的人工说明、未知字段和示例，也保留主文件中的其它插件节及注释。新旧来源中同名参数不同，按报出的文件和字段核对；两处相同可继续收尾。无法安全解释的参数应先保留原件。
