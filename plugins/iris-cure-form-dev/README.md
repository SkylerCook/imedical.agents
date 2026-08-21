# iris-cure-form-dev

面向 IRIS/HISUI 的 CA 治疗评估表单与 CR 治疗记录表单自动化插件。插件复用 `extract-doc` 和 `coding-iris-plugin`，提供从医院文档到治疗规格、Excel 多模板边界报告与生成、服务器模板响应式改造，以及受控部署与回滚的统一流程。

## 命令

```text
cure-form intake
cure-form inspect
cure-form prepare --mode create|responsive|common-responsive
cure-form review
cure-form preview
cure-form preview-run
cure-form preview-check
cure-form interaction-prepare
cure-form interaction-check
cure-form plan
cure-form apply
cure-form verify
cure-form rollback
cure-form consolidate
cure-form consolidate-shared
cure-form cleanup
cure-form common-migrate
```

实际安装后对应：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js <command> [options]
```

所有写入型部署命令默认 `dry-run`。新开发表单与现有模板改造采用不同生命周期：新开发表单直接创建正式模板，不使用灰度；只有现有模板改造才使用响应式灰度模板。`MapType` 为空的病理模板始终排除。

## v0.5.0 部署类迁移

治疗表单事务入口已固定迁移到 `DHCDoc.Cure.AI.CureFormDeploy`。插件不再调用或回退到旧部署类，也不会从 target profile 接受可变类名。升级已部署项目时，必须先在目标 IRIS namespace 上传并编译新类，再刷新 `.agents` 和已启用插件的 thin-index；确认所有调用方均已使用 v0.5.0 后，才可删除旧类。该顺序避免旧客户端报类不存在，也避免写事务在不明确的 fallback 路径中被重复执行。

## 新开发与现有改造边界

- 新开发表单以 `expectedVersion=NEW` 判定，直接走 `plan -> apply -> verify` 和部署后人工交互验证；不创建灰度模板，也不进入 `consolidate`、`consolidate-shared` 或 `cleanup`。
- 现有模板改造先在新的响应式灰度 RowID 上完成预览、回归和用户验收。单 Map 独占模板使用 `consolidate` 回归 `APP_LastID` 指向的正式 RowID；多个 Map 共用的公共灰度模板使用 `consolidate-shared` 回归已有正式 RowID。
- 合并写入后必须使用返回的 operation ID 执行 `verify`，并重新检查受影响 Map：全部引用正式 RowID、灰度引用数为 `0`、灰度模板及缓存均不存在，才可宣告现有模板改造完成。
- `cleanup` 只删除完成引用切换后仍遗留的全库零引用旧模板。它保留响应式替代 RowID，不执行“回归正式 RowID”，因此不能替代 `consolidate` 或 `consolidate-shared`。

上述命令依赖目标 `DHCDoc.Cure.AI.CureFormDeploy` 已实现并编译对应的 Inspect、Validate、Apply、staged、Verify 和 Rollback 方法。升级能力包不会自动上传或编译该服务端类；使用新命令前必须按目标工程部署流程单独验证服务端方法契约。

单 Map 现有模板改造的典型收尾顺序如下；共享模板将 `consolidate` 替换为 `consolidate-shared`，并提供明确的 source/target RowID 与预期 Map 数量：

```powershell
# 只读检查并生成绑定快照的合并包
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js consolidate `
  --form-type CA --map-code <MapCode> --expected-count <count> `
  --confirm-remote-execution --snapshot-output <snapshot.json> --output <package.json>

# 真实写入仍需当前任务的用户明确授权
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js consolidate `
  --package <package.json> --confirm-remote-execution --confirm-write `
  --operator <operator> --reason <reason>

node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js verify `
  --operation-id <operationId> --confirm-remote-execution
```

已部署业务工程获取 v0.6.0 时，按既有能力包更新流程刷新 `.agents` 并为已启用的 `coding-iris-plugin`、`iris-cure-form-dev` 重建 thin-index；本次不改变安装器、更新器或 sparse checkout。服务端类升级、编译和真实事务验证仍是独立的目标工程部署动作，必须另行授权。

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

`preview` 从 `changes.templates[]` 生成统一完整页面，并从目标 `cure_form_profile.md` 或 `--page-html` 指定的现有完整页面解析六类必需资源：`hisui.pure.min.css`、`jquery-1.11.3.min.js`、`jquery.hisui.min.js`、`hisui-lang-zh_CN.js`、`asscom.css`、`adaptation.css`。新建 profile 默认把前四项指向随能力包部署的 `.agents/vendor/hisui/`；现有项目配置不被更新器覆盖，仍以 target profile 为准。profile 配置优先于页面引用；路径始终由目标工程提供，插件脚本不写死业务工程路径。本地资源及 CSS `url(...)` 依赖复制到预览目录并写入 SHA-256 清单；远程资源、依赖目标冲突、越界路径、任一六类资源缺失或内容哈希变化都会停止。CSS 源中不存在的相对依赖会显式进入 manifest，随后由真实浏览器 Network 门禁判断是否被请求失败。纯 fragment 转换不要求携带这些资源，但部署前仍必须生成完整预览。

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js preview `
  --snapshot .\.agents\work\cure-form\server-snapshot.json `
  --changes .\.agents\work\cure-form\responsive-changes.json `
  --target-profile .\.agents\config\cure_form_profile.md `
  --output-root .\.agents\work\cure-form\preview
```

生成的 `preview.html` 内置浏览器探针，暴露 `window.__cureFormPreviewCheck()`。`preview-run` 只在 `127.0.0.1` 启动临时服务，通过 Chromium DevTools Protocol 在 `360/390/430/768/810/1024/1080/1194/1280` 九档宽度采集 Network、Console 和页面探针结果，并写入带 runner 来源的 `cure-form-browser-results/v1`。浏览器可由 `--browser-command` 或 profile 的 `PreviewBrowserCommand` 指定；未配置时按 Windows、macOS、Linux 的常见 Chromium 安装位置发现。`preview-check` 只接受当前 canonical runner 生成的 gate v2 结果，并验证资源加载、CSS 依赖、`jQuery`、`$.parser`、HISUI panel、radio `label.radio`、完整三节点配对、横向溢出、Console 和运行时错误：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js preview-run `
  --manifest .\.agents\work\cure-form\preview\preview-manifest.json `
  --target-profile .\.agents\config\cure_form_profile.md `
  --output .\.agents\work\cure-form\preview\browser-results.json

node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js preview-check `
  --manifest .\.agents\work\cure-form\preview\preview-manifest.json `
  --browser-results .\.agents\work\cure-form\preview\browser-results.json `
  --output .\.agents\work\cure-form\preview\preview-verification.json
```

只要 `plan` 提供 `--changes`，就必须同时提供通过的 `--preview-verification`。gate v1 或缺少当前 runner 元数据的旧结果不再接受；验证凭证与当前 gate、runner、snapshot、changes、完整 HTML、六类资源、CSS 依赖和九档结果哈希绑定，预览页在 manifest 生成后被编辑也会立即失败。Chromium 自动验收仍不能替代旧 WebView 和真实触控设备验收。

## 新建表单人工交互门禁

新建表单以最终 package 的 `expectedVersion=NEW` 判定。完成 canonical preview 门禁后，先生成部署前人工交互报告：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js interaction-prepare `
  --stage pre-deploy `
  --spec .\docs\cure-form\ExampleForm\cure-form-spec.json `
  --snapshot .\.agents\work\cure-form\server-snapshot.json `
  --changes .\docs\cure-form\ExampleForm\cure-form-deploy-changes.json `
  --preview-verification .\.agents\work\cure-form\preview\preview-verification.json `
  --output .\.agents\work\cure-form\interaction\ExampleForm-pre-deploy.json
```

命令同时生成 Markdown 清单。numberbox 自动覆盖整数、小数、空值及规格声明的 `min`/`max` 边界；选择控件、`calculations[]`、`visibilityRules[]`、单位和左右侧去重也会进入必测项。BMI、失能、SPPB 等业务联动只从目标规格或报告 `customCases[]` 读取，不写死到插件。

人工完成后填写 JSON 的 `execution`：用户亲自测试并明确告知已通过时使用 `user-attested`，只需测试人、时间、总体摘要和 `overallStatus=passed`；Agent 在本地完整预览逐步自测时使用 `agent-manual`，必须为每项填写通过状态和实际结果。截图或录像均可选。`automated` 模式会被拒绝；任何批量脚本化点击、输入或选择必须另行说明范围、状态影响和清理方式，并取得用户明确确认。只读 `preview-run` 不属于自动交互。

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js interaction-check `
  --report .\.agents\work\cure-form\interaction\ExampleForm-pre-deploy.json `
  --output .\.agents\work\cure-form\interaction\ExampleForm-pre-deploy-verification.json

node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js plan `
  --spec .\docs\cure-form\ExampleForm\cure-form-spec.json `
  --snapshot .\.agents\work\cure-form\server-snapshot.json `
  --changes .\docs\cure-form\ExampleForm\cure-form-deploy-changes.json `
  --preview-verification .\.agents\work\cure-form\preview\preview-verification.json `
  --interaction-verification .\.agents\work\cure-form\interaction\ExampleForm-pre-deploy-verification.json `
  --output .\.agents\work\cure-form\packages\ExampleForm.json
```

存量响应式改造不强制交互凭证。新表单写入后再运行 `interaction-prepare --stage post-deploy --package <package> --operation-id <id>`，人工验证保存、重开、回显和打印；CR 另验 `SaveCureRecord`、`CureExpJsonStr`、`MapID`。部署后失败会阻断任务完成，但不会自动回滚；真实服务器保存仍需写入授权。完整 schema 见 `references/cure-form-interaction-test-v1.md`。

## 公共模板迁移配置

`common-migrate` 不内置业务 MapCode 或模板 RowID。目标工程从 `templates/cure_form_common_migration.template.json` 创建本地配置，并通过 `--migration-config` 或 profile 的 `CommonMigrationConfig` 提供；生成计划绑定规范化配置哈希：

```powershell
node .agents/plugins/iris-cure-form-dev/scripts/cure-form.js common-migrate `
  --inventory .\.agents\work\cure-form\inventory.json `
  --migration-config .\.agents\config\cure_form_common_migration.json `
  --output .\.agents\work\cure-form\common-migration-plan.json
```

## 响应式兼容门禁

现有 CA/CR 模板改造必须保留 HISUI radio 的完整 DOM 组合，包括原生 `label.radio`、业务语义 `i-label-box` / `m-label-box` 与对应 `input name/value`。公共 CSS 仅可在完整配对且浏览器支持相应选择器时重绘圆圈；旧 WebView 保留 HISUI 原生渲染，不得通过无条件隐藏 `label.radio` 造成 radio 消失。旧内核仍把圆圈和文字拆行时，只允许对 `for/id` 一致的完整三节点做幂等原子包装，并必须连同 input 一起移动以保持 HISUI 邻接关系。普通布局与表格单元格中的 radio 都要验证点击同步、选中态和无横向溢出；旧 WebView 另验原子布局、幂等性与未配对节点保护。详细矩阵见 `references/cure-form-responsive-compatibility.md`。

插件只固化兼容契约和验证门禁，不携带或复制业务工程的公共响应式 CSS。实际文件位置、编码、上传和部署继续由目标工程配置并委托 `coding-iris-plugin`。

已部署业务工程获取本门禁时，只需按既有能力包更新流程刷新 `.agents` 并为已启用插件重建 thin-index；无需复制插件中的业务 CSS，也不得自动改写现有表单 DOM。

公共响应式 CSS 只允许跨表单断点、伸缩、触控和 HISUI 兼容规则；moduleId、业务根 ID、表单专属颜色、矩阵和单表 class 必须放入独立业务 CSS。`prepare` 扫描开发源，`plan` 同时扫描开发源和部署副本，发现污染即停止。

新增部署静态资源的 basename 必须语义明确、使用 camelCase 且不超过 24 个字符。业务 `moduleId` / `moduleName` 超长时，保留这些稳定业务标识，另行在规格中声明短资源名；引用路径和部署文件 basename 必须一致。允许 `Struct`、`Func`、`Assess` 以及公认临床缩写，禁止点分命名和 `ass` 等含糊缩写。
