# CA/CR 治疗表单流程

## 医院文档新建

`extract-doc/structure-v1` → `cure-form-spec/v1` → 人工确认 → CA/CR 生成 → 响应式与运行时契约验证 → 部署前人工交互验证 → 部署包 → 部署后人工交互验证。

默认以业务项目根为 `--project-root`：医院需求文件从 `docs/` 发现，开发规格、摄取报告和生成源码进入 `docs/cure-form/<moduleId>/`。多个 Word/PDF/Excel 候选必须由 `--source` 明确选择；不要用文件排序或修改时间猜测。服务器快照及部署临时数据继续写入 `.agents/work/`，不得混入 `docs/`。

Excel 多模板需求必须通过 `cure-form-template-boundaries/v1` 显式声明边界；摄取报告保留非空范围、格式化范围、合并层级、单位/维度、规则文字和候选字段。配置范围相交时写入 `TEMPLATE_RANGE_OVERLAP`；合并单元格未被某一个模板完整且唯一覆盖时写入 `TEMPLATE_MERGE_SPLIT`，由人工修正边界归属。

扫描 PDF 必须保留 `requiresVisualExtraction=true`、页面来源和置信度；视觉提取结果必须人工确认。`unresolved[]` 不为空时停止。

新建表单以人工交互验收为默认路径。部署前通过 `interaction-prepare` 生成清单，覆盖 numberbox 整数、小数、空值和已声明边界、选择状态、计算、显隐、联动以及单位/左右侧去重；业务联动从规格或目标项目补充，不得写死到 canonical。用户亲自验收并明确反馈通过时可使用总体确认；Agent 在本地完整预览自测时必须逐项记录实际结果。v1 禁止自动交互模式；任何批量脚本化点击、输入或选择必须先向用户申请明确确认。只读 `preview-run` 不属于自动交互。

最终 package 的 `expectedVersion=NEW` 时，`plan` 必须具有与当前规格、snapshot、changes 和 preview 凭证绑定的 `cure-form-interaction-verification/v1`。部署后再验证 CA/CR 保存、重开、回显和打印；CR 同时验证 `SaveCureRecord`、`CureExpJsonStr`、`MapID`。失败时停止交付并报告，不自动回滚；真实服务器保存仍需写入授权。

## 服务器现有模板改造

读取 CA/CR Map、组成模板、HTML、JS、缓存字段及资源 → 本地快照 → 规格化 → 保持运行时契约的响应式改造 → canonical 完整预览与九档浏览器凭证 → 差异和影响报告 → dry-run 部署计划 → 明确确认后写入 → 回读验证。

公共模板使用版本化克隆，不直接原地覆盖。新表单引用最新批准版本；现有 Map 按灰度清单切换，病理 Map 永不自动切换。

## 样式职责边界

- 目标工程的公共响应式样式文件由工程配置或现有页面资源引用解析；插件规则不得固化仓库路径、Web 根或文件绝对位置。
- 完整预览统一加载目标工程解析出的 HISUI CSS、jQuery、HISUI JavaScript、中文 locale、`asscom.css` 和 `adaptation.css`；本地资源复制到受忽略的预览工作目录，预览 manifest 不保存源绝对路径。
- 公共响应式样式只保存跨表单复用的断点布局、宽度伸缩、触控密度、溢出处理和 HISUI 兼容规则。
- moduleId、业务根 ID、专属配色、业务矩阵、题干/规则区及仅由一个表单使用的 class 必须写入该表单独立 CSS。
- 表单配置只能引用 JavaScript 时，`loadMode=host` 必须同时声明运行时 `scriptHref` 和落盘 `scriptDeploymentPath`，两者 basename 一致；Map“引用JS”保存 `scriptHref`，由该总入口按 `runtimeHref` 幂等加载独立 CSS。模板 JavaScript 不重复加载。没有表单级 JS 入口时才显式使用 `loadMode=template` fallback；禁止注入 `<style>` 或 CSS 文本。
- 每个模板只在确有计算、联动或初始化逻辑时配置独立外部 JS。模板的“引用JS”保存 `javascriptHref` 路径，不保存源码；无业务逻辑模板保持为空。默认由宿主按各自配置管理模板生命周期；若已验证宿主不会可靠调用分模板 `Init`，规格可显式启用 `aggregateTemplateInit=true`，由 Map 总入口延迟、幂等调度实际存在的业务模块。该模式要求分模板 `Init` 可重复调用或自行幂等，禁止为空模板制造调用。
- 新增静态资源 basename 使用语义明确的 camelCase，最长 24 个字符。业务 `moduleId` / `moduleName` 超长时允许使用经评审的短资源名映射，保持 DOM、缓存及业务标识稳定；引用路径与部署文件 basename 必须一致。允许 `Struct`、`Func`、`Assess` 和 `SPPB`、`VAS` 等清晰缩写，禁止点分命名及 `ass` 等含糊缩写。
- `stylesheets[]` 分离本地预览 `path`、目标工程静态资源 `deploymentPath` 与可选 fallback `runtimeHref`。路径均由目标工程规格提供；插件不得假设业务 CSS 与公共 CSS 同目录。
- 生成、响应式改造和部署验收都必须执行公共样式污染门禁；发现专属选择器时停止交付。
- 公共 CSS 删除或迁移 selector 前，必须检查目标工程提供的已改造表单快照。若现有表单仍依赖待迁 selector，先部署该表单独立 CSS 与外链 loader 并回归，再在后续发布删除公共规则；不得为兼容单表而把业务规则永久留在公共 CSS。
