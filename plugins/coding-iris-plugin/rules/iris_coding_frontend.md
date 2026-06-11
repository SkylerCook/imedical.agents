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

- 前端 `.csp` / `.js` / `.css` 源文件编码以实际检测和目标工程 profile 为准，不得假设为 UTF-8。
- HIS 历史前端文件存在 GB2312/GBK 编码风险。未确认 UTF-8 前，不得按 UTF-8 整文件重写。
- 修改前必须确认实际编码、换行和 EOF；修改后必须保持原文件编码，除非用户明确要求永久转码。
- 若原文件为 GB2312/GBK，可以临时转为 UTF-8 工作副本辅助编辑，但交付写回源文件时必须转回原编码。
- 禁止为了方便编辑、格式化或统一风格，把 GB2312/GBK 源文件顺手标准化为 UTF-8。
- 目标服务器若要求 GB2312，上传前使用 `.agents/scripts/convert-gb2312-upload.ps1` 检测并按需转换。上传转换只生成临时上传产物，不改变源文件编码策略。
- 修改前后可使用 `.agents/scripts/check-frontend-encoding.ps1` 检查触碰文件编码；profile 要求前端 GB2312 时，收尾使用 `-ExpectedEncoding gb2312 -ErrorOnMismatch` 拦截 UTF-8 漂移。

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
- 前端文件变更后，报告触碰文件的实际编码；profile 要求前端 GB2312/GBK 时，确认修改后仍保持 GB2312/GBK。
- 调整 DataGrid 列定义后，检查保存、校验、行编辑和回显逻辑中的 editor/列下标是否仍对应正确字段。
- 用户明确要求部署时，先转换编码，再上传，再按目标工程规则编译 CSP 或刷新页面验证。
- CSP 部署验证不能只看上传成功或外层执行成功；必须检查 `$system.OBJ.Load` 内层 status，并确认生成类、`CSPFILE`、`CSPURL` 与 WebApp 虚拟路径一致。
- 上传时若生成 `*.gb2312.*` 临时文件，只上传其内容到原始远端文件名；验证和编译都以原始 `.csp` 文件名为准。
