---
name: iris_coding_frontend
description: Use when implementing or modifying CSP, JavaScript, CSS, or HISUI frontend code.
task-affinity: [iris, csp, javascript, frontend, hisui, coding]
related:
  - iris_coding_general.md
  - ../references/hisui-widget-index.md
---

# 前端 CSP/JavaScript/HISUI 编码规则

## 技术栈

- 页面技术：CSP + HTML + CSS + JavaScript。
- UI 框架：HISUI，除非目标工程 profile 明确关闭。
- jQuery/HISUI 版本、主题、源码路径以 `.agents/config/iris_project_profile.md` 为准。

## 编码策略

- 目标工程只允许两种前端编码模式：`standard-gb2312`（源码和上传均为 GB2312）与 `project-utf8`（源码和上传均为 UTF-8）。
- 路径覆盖表只映射这两种模式；最长路径匹配优先，未命中时使用工程级模式。
- 目录结构或 Git 仓库角色只提出候选模式，实际文件字节检测是最终门禁。
- 每个触碰文件修改前后必须检测；ASCII 不能单独证明编码，unknown、mixed、配置冲突或证据不足时停止。
- `standard-gb2312` 使用 `check-frontend-encoding.ps1 -ExpectedEncoding gb2312 -ErrorOnMismatch`，不得整文件改写为 UTF-8。
- `project-utf8` 使用 `check-frontend-encoding.ps1 -ExpectedEncoding utf8 -ErrorOnMismatch`，不得调用 GB2312 转换器。
- 正常完成只输出一行编码摘要；仅异常时展开 frontendRoot、候选来源、期望编码、检测编码和冲突原因。

## HISUI 优先原则

- 前端开发优先使用 HISUI 已有控件，不自造按钮、弹窗、面板、表单控件或布局容器。
- 控件 API 不确定时，先读 `../references/hisui-widget-index.md`，再读 `.agents/vendor/hisui/dist/js/jquery.hisui.js` 源码行号确认。
- 新面板/分组区域使用 `hisui-panel`。
- 弹窗使用 `hisui-dialog` / `hisui-window` / `$.messager`。
- 表单输入使用 `hisui-combobox`、`hisui-validatebox`、`hisui-lookup`、`datebox`、`numberbox` 等标准控件。

## CSP 结构

- 采用框架页 + 内容页拆分：框架页负责 `<DOC:HEAD>`、公共参数、脚本引入；内容页负责主体 DOM。
- CSP 页面命名、JS 路径、CSS 路径以目标工程 profile 为准。
- `<Server>` 块只处理页面渲染前必要参数，不承载复杂业务逻辑。
- `#(variable)#` 和 `##(expression)##` 的转义语义需按 CSP 实际语义使用。

## 页面布局

- 查询页优先使用 `hisui-layout`：north 查询条件，center datagrid。
- 表单排版优先复用目标工程公共样式，例如 label/value 表格布局。
- 自定义 CSS 仅限页面级微调，不覆盖公共框架样式。
- 固定格式控件应有稳定尺寸，避免 hover、加载文本或动态内容造成布局跳动。

## JavaScript 组织

- 页面脚本按闭包或目标工程既有模式组织。
- 推荐顺序：常量配置、初始化入口、事件绑定、数据加载、数据采集、业务动作、工具函数。
- 一个函数只承担一个职责：初始化控件、发请求、转换数据、采集表单值应拆开。
- 后端调用使用目标工程 profile 指定的调用封装；若使用 `$cm(className, methodName, params, callback)`，类名和方法名不得硬编码为源工程专属值。
- DOM id 保持语义稳定，不随 UI 文案变化。
- 集中维护选择器，避免同一选择器字符串散落多处。

## 数据与交互

- 保存 JSON 顶层结构必须稳定，字段增删集中在采集函数内完成。
- HisUI `datagrid` / `treegrid` 插入、删除或重排列后，必须检查保存逻辑中是否存在 `editors[n]`、`columns[n]`、单元格下标等硬编码索引；索引会随列顺序偏移。
- 读取编辑器值时优先按 `editors[j].field` 或稳定字段名匹配，不优先依赖数组位置。若保留硬编码索引，必须逐项核对插列前后的字段对应关系。
- 表单值采集不读取显示文案作为业务值；lookup 保存 RowId，combobox 保存 code/id。
- 异步字典加载失败不得阻断其他字段初始化和表单回显。
- 后端返回数据进入控件前先归一化为稳定前端结构，例如 `{id, text}`。
- 远程 lookup/datagrid 使用分页接口，大数据量字典不得一次性加载到本地。

## 验证

- 默认做本地结构和引用检查。
- 前端文件变更后按模式复检所有触碰文件；正常时只报告模式、文件数和保持的编码。
- 调整 DataGrid 列定义后，检查保存、校验、行编辑和回显逻辑中的 editor/列下标是否仍对应正确字段。
- 用户明确要求部署时，先通过目标模式字节门禁；只有 `standard-gb2312` 需要 GB2312 转换或确认，再上传并验证。
- CSP 部署验证不能只看上传成功或外层执行成功；必须检查 `$system.OBJ.Load` 内层 status，并确认生成类、`CSPFILE`、`CSPURL` 与 WebApp 虚拟路径一致。
- 上传时若生成 `*.gb2312.*` 临时文件，只上传其内容到原始远端文件名；验证和编译都以原始 `.csp` 文件名为准。
