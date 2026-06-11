# doctor-dev 项目类型默认值

适用于医生站系列项目（DHCDoc 体系）。初始化时只有在用户显式选择 `doctor-dev` 类型后，才用本文件的值填充 profile，减少 TODO。所有默认值仍需通过代码探索或用户确认校验；若目标工程事实不同，以目标工程 profile 为准。

## 通用配置

- Web 技术：CSP / HISUI
- 是否使用 HISUI：是
- HISUI 主题 CSS：`.agents/vendor/hisui/dist/css/hisui.pure.css`
- 源文件编码：前端 GB2312, 后端 UTF-8
- 前端源文件编码策略：preserve-existing
- 历史前端默认编码：GB2312
- 前端编码漂移检查：GB2312 前端文件收尾运行 `check-frontend-encoding.ps1 -ExpectedEncoding gb2312 -ErrorOnMismatch`
- 上传前是否运行 `convert-gb2312-upload.ps1`：否
- 常见 Web 根前缀：`imedical/web`（仅作为医生站项目候选值；写入 `.agents/config/project-env.json` 前必须确认）
- 常见 CSP 前缀：`imedical/web/csp`（仅作为医生站项目候选值；写入 `.agents/config/project-env.json` 前必须确认）
- 常见 Broker 路径：`csp/websys.Broker.cls`（仅作为医生站项目候选值；写入 `.agents/config/project-env.json` 前必须确认）

## 后端约定

- BLH 类命名模板：`<Entity>BLH`（如 `ApplyBLH`、`AttachBLH`）
- DATA 类命名模板：`<Entity>DATA`（如 `ApplyDATA`、`AttachDATA`）
- SQL 类命名模板：`<Entity>SQL`（如 `ApplySQL`、`AttachSQL`）
- 公共 Super 类：`DHCDoc.GetData.COM.Super`（提供 `GetCustomRows()` 通用 SQL-to-JSON），继承自 `DHCDoc.Util.RegisteredObject`
- JSON 工具类：`DHCDoc.Util.FromJSON`、`DHCDoc.Util.JSONAdaptor`、`DHCDoc.Util.QueryToJSON`
- Broker 入口或调用封装：`DHCDoc.Util.Broker`（主 Broker），另有 `DHCAnt.COM.Broker`（抗菌药等专用）

## 前端约定

- CSP 框架页命名模板：`dhcdoc.<module>.<feature>[.hui].csp`（如 `dhcdoc.config.codedata.hui.csp`），各领域有独立前缀：`chemo.`、`dhcant.`、`reg.`、`doccure.`、`alloc.`、`doc.dental.ta.`
- CSP 内容页命名模板：`<feature>.show.csp`（由主页面 `<csp:Include>` 引入）
- JS 文件命名模板：`DHCDoc.<Module>.hui.js`（PascalCase HISUI 版）或 `dhcdoc/<module>/<feature>.js`（小写）
- 公共 HEAD 标签或模板：`<DOC:HEAD notdefurl=1></DOC:HEAD>`，可选 `needprint=1`
- 后端调用 JS 封装：`runClassMethod()` / `serverCall()`（旧，post 到 `dhcapp.broker.csp`）；`$.req()` / `$.fetch()`（新，post 到 `DHCDoc.Util.Broker.cls`）
- 公共 CSS/布局类：`hui.pure.css`（Pure 主题）、`hui.vben.css`（Vben 主题）、`hui.com.css`（公共覆盖）
- 公共 JS 引用：`../scripts/dhcdoc/common/common.js`、`commonfun.js`、`hiscomponent.js`
