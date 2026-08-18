# iris-cure-form-dev

面向 IRIS/HISUI 的 CA 治疗评估表单与 CR 治疗记录表单自动化插件。插件复用 `extract-doc` 和 `coding-iris-plugin`，提供从医院文档到治疗规格、Excel 多模板边界报告与生成、服务器模板响应式改造，以及受控部署与回滚的统一流程。

## 命令

```text
cure-form intake
cure-form inspect
cure-form prepare --mode create|responsive|common-responsive
cure-form review
cure-form preview
cure-form preview-check
cure-form plan
cure-form apply
cure-form verify
cure-form rollback
cure-form common-migrate
```

实际安装后对应：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js <command> [options]
```

所有写入型部署命令默认 `dry-run`。`MapType` 为空的病理模板始终排除。

## 默认开发目录

文档驱动的新表单以当前业务项目为默认 `--project-root`：医院提供的 Word、PDF、Excel 文件通常放在项目 `docs/`，规格、摄取报告和生成的 HTML/JavaScript/fragment/CSS 默认写入 `docs/cure-form/<moduleId>/`。插件不再使用 `src-iris` 作为默认或推荐目录。

`docs/` 下只有一个支持的需求文件时可省略 `--source`；存在多个候选时必须显式选择，插件不会猜测。服务器快照、分块传输和部署临时数据仍保留在受忽略的 `.agents/work/cure-form/`。

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js intake `
  --form-type CA --module-id ExampleForm --map-code ExampleForm

node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js prepare `
  --mode create --spec .\docs\cure-form\ExampleForm\cure-form-spec.json `
  --target-profile .\.agents\config\cure_form_profile.md
```

非标准项目可使用 `--project-root`、`--docs-root`、`--development-root`、`--source` 和 `--output-root` 覆盖默认值。

公共模板已存在批准版本时，`plan` 使用来源模板 RowID 到批准版本 RowID 的映射，将对应变更转换为 `referenceOnly`，避免每个业务 Map 重复克隆同一公共模板：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js plan `
  --spec .\form.cure-form-spec.json `
  --snapshot .\server-snapshot.json `
  --changes .\responsive-changes.json `
  --preview-verification .\.agents\work\cure-form\preview\preview-verification.json `
  --approved-clones .\approved-clones.json `
  --output .\form.package.json
```

`approved-clones.json` 可使用 `{ "approvedClones": { "<sourceRowId>": "<approvedRowId>" } }`。生成包记录 `commonTemplateReferences[]`；未列入映射的业务模板仍按版本化克隆处理。

## Excel 多模板摄取

边界配置使用 `cure-form-template-boundaries/v1`，显式给出 Sheet、期望模板数、顺序和 A1 范围：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js intake `
  --source .\docs\hospital-form.xlsx `
  --form-type CA `
  --module-id provisionalModuleId `
  --template-boundaries .\docs\cure-form\provisionalModuleId\template-boundaries.json `
  --report .\docs\cure-form\provisionalModuleId\intake-report.md
```

摄取保留实际非空范围、格式化范围、合并区域、公式、单位/维度、规则文字、候选字段和范围重叠；范围重叠、合并单元格被边界截断以及候选语义都会进入 `unresolved[]`。一个业务模板由不连续区域组成时使用 `sourceRanges[]`，每个合并区域仍必须完整且唯一地归属一个模板。获批的多模板规格会按顺序生成独立 fragment 和 Map composition changes；只有确有计算、联动或初始化逻辑的模板才生成 JavaScript。

完成业务语义建模后，模板可在获批规格中提供 `fragmentHtml`，并仅在需要业务逻辑时提供 `javascript`、`javascriptHref` 与 `javascriptDeploymentPath`。插件会在批准及生成门禁中验证根 `div`、`rootId`、响应式 class、DOM ID/缓存标签完整性、JavaScript 语法，以及 `Init/OtherInfo/PrintInfo` 接口。独立预览页只加载并初始化实际存在的模板脚本；部署时模板“引用JS”保存外部路径，不保存源码。默认仍由宿主管理模板生命周期；当真实宿主不会可靠调用分模板 `Init` 时，可显式设置 `aggregateTemplateInit=true`，由 Map 总入口在 DOM ready 与缓存恢复之后幂等调度实际存在的业务模块，分模板 `Init` 同时必须可重复调用或自行幂等。

规格可通过 `stylesheets[]` 声明本地预览 `path`、目标工程静态资源 `deploymentPath`、`loadMode` 和 CSS 内容。`loadMode=host` 时必须同时声明表单配置使用的运行时 `scriptHref` 与静态资源落盘使用的 `scriptDeploymentPath`，两者 basename 必须一致；生成器把 `scriptHref` 写入 Map“引用JS”，总入口再按 `runtimeHref` 幂等加载 CSS，模板 JS 不重复处理。`loadMode=template` 仅作为无表单级 JS 入口时的 fallback。生成器不会把 CSS 文本写入 JavaScript，也不假设业务 CSS 与公共 CSS 位于同一目录。所有路径均由目标工程规格提供：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js prepare `
  --mode create --spec .\docs\cure-form\ExampleForm\cure-form-spec.json `
  --target-profile .\.agents\config\cure_form_profile.md `
  --public-responsive-css <目标工程公共响应式CSS>

node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js plan `
  --spec .\form.cure-form-spec.json --snapshot .\server-snapshot.json `
  --changes .\cure-form-deploy-changes.json `
  --preview-verification .\.agents\work\cure-form\preview\preview-verification.json `
  --public-responsive-css <开发源> --public-responsive-css-copy <部署副本>
```

## Canonical 完整预览与浏览器门禁

`preview` 从 `changes.templates[]` 生成统一完整页面，并从目标 `cure_form_profile.md` 或 `--page-html` 指定的现有完整页面解析六类必需资源：`hisui.pure.min.css`、`jquery-1.11.3.min.js`、`jquery.hisui.min.js`、`hisui-lang-zh_CN.js`、`asscom.css`、`adaptation.css`。本地资源复制到预览目录 `assets/`，产物不保存源绝对路径；任一资源缺失、重名、basename 不匹配或本地文件不存在时立即停止。纯 fragment 转换不要求携带这些资源，但部署前仍必须生成完整预览。

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js preview `
  --snapshot .\.agents\work\cure-form\server-snapshot.json `
  --changes .\.agents\work\cure-form\responsive-changes.json `
  --target-profile .\.agents\config\cure_form_profile.md `
  --output-root .\.agents\work\cure-form\preview
```

生成的 `preview.html` 内置浏览器探针，暴露 `window.__cureFormPreviewCheck()`。浏览器在 `360/390/430/768/810/1024/1080/1194/1280` 九档宽度分别调用该函数，将结果汇总为 `cure-form-browser-results/v1`，再由 `preview-check` 验证资源加载、`jQuery`、`$.parser`、HISUI panel、radio `label.radio`、横向溢出和运行时错误：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js preview-check `
  --manifest .\.agents\work\cure-form\preview\preview-manifest.json `
  --browser-results .\.agents\work\cure-form\preview\browser-results.json `
  --output .\.agents\work\cure-form\preview\preview-verification.json
```

只要 `plan` 提供 `--changes`，就必须同时提供通过的 `--preview-verification`。验证凭证与 snapshot、changes、资源清单和九档宽度哈希绑定；缺失、失败或内容变化都会阻止 `deploymentReady=true`。浏览器模拟仍不能替代旧 WebView 和真实触控设备验收。

## 响应式兼容门禁

现有 CA/CR 模板改造必须保留 HISUI radio 的完整 DOM 组合，包括原生 `label.radio`、业务语义 `i-label-box` / `m-label-box` 与对应 `input name/value`。公共 CSS 仅可在完整配对且浏览器支持相应选择器时重绘圆圈；旧 WebView 保留 HISUI 原生渲染，不得通过无条件隐藏 `label.radio` 造成 radio 消失。普通布局与表格单元格中的 radio 都要验证点击同步、选中态和无横向溢出。详细矩阵见 `references/cure-form-responsive-compatibility.md`。

插件只固化兼容契约和验证门禁，不携带或复制业务工程的公共响应式 CSS。实际文件位置、编码、上传和部署继续由目标工程配置并委托 `coding-iris-plugin`。

公共响应式 CSS 只允许跨表单断点、伸缩、触控和 HISUI 兼容规则；moduleId、业务根 ID、表单专属颜色、矩阵和单表 class 必须放入独立业务 CSS。`prepare` 扫描开发源，`plan` 同时扫描开发源和部署副本，发现污染即停止。

新增部署静态资源的 basename 必须语义明确、使用 camelCase 且不超过 24 个字符。业务 `moduleId` / `moduleName` 超长时，保留这些稳定业务标识，另行在规格中声明短资源名；引用路径和部署文件 basename 必须一致。允许 `Struct`、`Func`、`Assess` 以及公认临床缩写，禁止点分命名和 `ass` 等含糊缩写。
