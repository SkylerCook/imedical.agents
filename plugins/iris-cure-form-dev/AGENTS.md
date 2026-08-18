# IRIS 治疗表单插件约定

## 范围

- 本插件只处理 `MapType=CA` 的治疗评估表单和 `MapType=CR` 的治疗记录表单。
- `MapType` 为空或其他值时必须停止，病理模板不得进入自动生成、改造或部署流程。
- 服务器现有模板是现有表单的 canonical；本地快照只写入 `.agents/work/`。

## 依赖与职责

- 医院 Word、PDF、Excel 解析委托 `extract-doc`，不得复制解析器。
- ObjectScript、HISUI、MCP 和静态资源上传编译委托 `coding-iris-plugin`。
- 本插件负责治疗语义适配、CA/CR 生成、响应式契约、部署包、业务事务、回读与回滚编排。
- 流程入口为 `node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js <command>`；Node.js 最低版本为 `22.5.0`。
- Excel 多模板新建通过 `cure-form-template-boundaries/v1` 显式声明 Sheet、模板顺序和 A1 范围；范围重叠或合并单元格被边界截断必须进入 `unresolved[]`，不得静默拆分。
- 文档驱动的新表单开发默认以业务项目根为 `--project-root`，从 `docs/` 读取医院需求文件，并将规格、摄取报告及生成源码写入 `docs/cure-form/<moduleId>/`；显式 `--source`、`--docs-root`、`--development-root` 或 `--output-root` 可覆盖。服务器快照和部署临时数据仍只写 `.agents/work/`。

## 安全门禁

- `unresolved[]` 未清零或规格未获人工批准时，不得生成可执行部署包。
- 多模板规格获批前，每个模板必须明确 `rootId` 和 `moduleName`，候选字段必须转换为唯一稳定 ID 和已确认控件类型。
- `apply` 默认只做 `dry-run`；真实写入必须显式传入 `--confirm-write`、`--operator` 和 `--reason`。
- 不允许通用 SQL 写入，不允许修改患者评估或治疗记录数据。
- Map、模板、缓存字段和组成关系必须作为一个业务事务处理，并通过版本与内容哈希防止并发覆盖。
- `.mcp.json`、`.iris-agentic-dev.toml`、本地路径配置、服务器快照和凭据不得提交 Git 或输出到日志。

## 兼容契约

- 保持 DOM ID、缓存标签、radio `name/value`、`Init/OtherInfo/PrintInfo` 稳定。
- 保持 HISUI radio 的完整 DOM 配对：原生生成的 `label.radio`、业务语义 `i-label-box` / `m-label-box` 和对应 `input` 均不得删除、改名或拆散；不得用无条件全局隐藏 `label.radio` 的方式消除重复圆圈。
- 公共响应式 CSS 只能在确认完整配对且浏览器支持所用选择器时重绘 radio；旧 WebView 不支持该选择器时必须保留 HISUI 原生渲染作为 fallback。
- 公共响应式 CSS 只保存跨表单复用的响应式和 HISUI 兼容规则；表单专属配色、矩阵、字段特例和业务选择器必须进入独立业务 CSS。
- 新增部署静态资源 basename 使用语义明确的 camelCase，最长 24 个字符。业务标识过长时只缩短资源名，不改稳定的 moduleId、moduleName、DOM ID 或缓存标签；引用路径与部署文件 basename 必须一致。
- 表单总入口同时声明运行时 `scriptHref` 与落盘 `scriptDeploymentPath`，Map“引用JS”只保存 `scriptHref`；模板仅在确有业务逻辑时保存 `javascriptHref`，无逻辑模板保持空引用，禁止把源码或空壳脚本写回配置。
- 模板生命周期默认由宿主管理；仅在已验证宿主不会可靠调用分模板 `Init` 时启用 `aggregateTemplateInit=true`，由 Map 总入口在 DOM ready 后延迟调度实际业务模块，并要求分模板初始化可重复调用或自行幂等。
- 公共样式路径从目标工程配置或页面现有资源引用解析，插件规则和源码不得写死仓库路径、Web 根或服务器路径。
- 公共样式变更必须按目标工程实际编码模式验证，并同时扫描开发源与部署副本是否混入表单专属选择器；插件不携带业务工程的公共 CSS 副本。
- CA 必须验证保存、重开、回显和打印。
- CR 必须保持 `SaveCureRecord`、`CureExpJsonStr`、`MapID`、回显和打印。
- 新建及改造表单默认覆盖 `360/390/430/768/810/1024/1080/1194/1280`。
